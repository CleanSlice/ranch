import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { ILlmGateway } from '#/llm/domain';
import { IPaddockScenarioGateway } from '../../scenario/domain';
import {
  IPaddockEvaluationGateway,
  IPaddockEvaluationData,
  IPaddockJudgeConfig,
  IRunPaddockEvaluationData,
  DEFAULT_PADDOCK_JUDGE_CONFIG,
  IPaddockReportGateway,
  IPaddockRunner,
  IPaddockJudgeCredential,
} from './';
import { IPaddockScenarioData } from '../../scenario/domain';
import type { IPaddockRunScope } from './evaluation.types';
import { RanchAgentEnvelope } from '../data/ranchAgentEnvelope';
import { captureBackgroundError } from '#/setup/sentry';

// Stable execution order for paddock. Logical "easy → hard" progression
// keyed by category, with difficulty + name as deterministic tie-breakers.
// BunCliPaddockRunner materializes scenarios with zero-padded filenames
// in this order, so paddock's readdirSync sees them in the same sequence.
const CATEGORY_ORDER: Record<string, number> = {
  conversation: 0,
  memory: 1,
  multi_turn: 2,
  tool_use: 3,
  error_recovery: 4,
  edge_case: 5,
  patching_workflow: 6,
};

const DIFFICULTY_ORDER: Record<string, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  adversarial: 3,
};

function sortScenarios(
  scenarios: IPaddockScenarioData[],
): IPaddockScenarioData[] {
  return [...scenarios].sort((a, b) => {
    const catA = CATEGORY_ORDER[a.category] ?? 99;
    const catB = CATEGORY_ORDER[b.category] ?? 99;
    if (catA !== catB) return catA - catB;
    const diffA = DIFFICULTY_ORDER[a.difficulty] ?? 99;
    const diffB = DIFFICULTY_ORDER[b.difficulty] ?? 99;
    if (diffA !== diffB) return diffA - diffB;
    return a.name.localeCompare(b.name);
  });
}

@Injectable()
export class PaddockEvaluationService {
  private readonly logger = new Logger(PaddockEvaluationService.name);

  constructor(
    private evaluationGateway: IPaddockEvaluationGateway,
    private scenarioGateway: IPaddockScenarioGateway,
    private agentGateway: IAgentGateway,
    private templateGateway: ITemplateGateway,
    private llmGateway: ILlmGateway,
    private reportGateway: IPaddockReportGateway,
    private runner: IPaddockRunner,
    private envelope: RanchAgentEnvelope,
  ) {}

  async start(
    input: IRunPaddockEvaluationData,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    const agent = await this.agentGateway.findById(input.agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const running = await this.evaluationGateway.findRunning(input.agentId);
    if (running) {
      throw new ConflictException(
        `Evaluation ${running.id} is already running for this agent`,
      );
    }

    const template = agent.templateId
      ? await this.templateGateway.findById(agent.templateId)
      : null;
    const templateConfig = (template?.defaultConfig as Record<string, unknown>)
      ?.paddockConfig as Partial<IPaddockJudgeConfig> | undefined;
    const judgeConfig: IPaddockJudgeConfig = {
      ...DEFAULT_PADDOCK_JUDGE_CONFIG,
      ...(templateConfig ?? {}),
      ...(input.judgeOverride ?? {}),
    };

    const scenarios = await this.resolveScenarios(input, agent, scope);
    if (scenarios.length === 0) {
      throw new BadRequestException(
        'No scenarios found for this agent. Add scenarios to its template first.',
      );
    }

    const evaluation = await this.evaluationGateway.create({
      agentId: input.agentId,
      templateId: agent.templateId ?? null,
      judgeConfig,
      scenariosSnapshot: scenarios,
    });

    // Fire-and-forget — we don't block the HTTP response on the eval run
    void this.runInBackground(evaluation.id, agent.id, scenarios, judgeConfig);

    return evaluation;
  }

  async listForAgent(agentId: string): Promise<IPaddockEvaluationData[]> {
    return this.evaluationGateway.findAll({ agentId });
  }

  async list(
    filter: {
      agentId?: string;
      templateId?: string;
      limit?: number;
    },
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData[]> {
    return (await this.evaluationGateway.findAll(filter)).filter(
      (ev) => !this.keptFrom(ev, scope),
    );
  }

  async getById(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    const ev = await this.evaluationGateway.findById(id);
    // The same answer for an evaluation that does not exist and for one
    // this reader is not to read: the one place the question is asked.
    if (!ev || this.keptFrom(ev, scope)) {
      throw new NotFoundException('Evaluation not found');
    }
    return ev;
  }

  // ── A run that holds scenarios its reader may not read (CLEAN-271) ──
  //
  // An evaluation keeps a COPY of the scenarios it ran, and everything
  // else it holds is about them: results, counts, a pass rate, a trace per
  // scenario, a report, a log, the runner's error text. An ordinary agent
  // may sit on a template the Ranch assistant is built from, and a run of
  // it started by the Owner holds that template's scenarios, which only
  // the Owner reads.
  //
  // Such a run is not taken apart for anybody else. Three attempts at
  // leaving the kept scenarios out field by field each missed a field (a
  // count, a summary list, free text of an error, a log line), and the
  // next field added to an evaluation would be missed the same way. So the
  // run is refused WHOLE: for a reader it keeps a scenario from, it does
  // not exist. One question, `keptFrom`, asked in one place, `getById`,
  // which every read and every action below goes through before anything
  // is read; a list leaves the run out.
  //
  // What this costs is small and is the Owner's territory anyway. A run
  // holds a scenario only of its own agent or of that agent's template
  // (`resolveScenarios`), so only an agent that sits ON a template the
  // assistant is built from can have such a run; and a run started by
  // anybody but the Owner leaves those scenarios out, so such a run is
  // always one the Owner started.

  /** Whether `ev` holds a scenario `scope` keeps from its reader. */
  private keptFrom(
    ev: IPaddockEvaluationData,
    scope: IPaddockRunScope,
  ): boolean {
    const hides = scope.hidesTemplate;
    if (!hides) return false;
    return ev.scenariosSnapshot.some(
      (s) => !s.agentId && Boolean(s.templateId) && hides(s.templateId!),
    );
  }

  async abort(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    const ev = await this.getById(id, scope);
    if (ev.status !== 'running') return ev;
    // Best-effort: kill the underlying paddock CLI subprocess (if any).
    const killed = this.runner.abort(ev.agentId);
    if (killed) {
      this.logger.log(
        `Killed paddock CLI subprocess for evaluation ${id} (agent ${ev.agentId})`,
      );
    }
    return this.evaluationGateway.update(id, {
      status: 'aborted',
      finishedAt: new Date(),
      currentScenarioId: null,
      errorMessage: killed
        ? 'Aborted by user'
        : 'Aborted (no live process to kill)',
    });
  }

  /**
   * Re-run an evaluation, but skip scenarios that passed in the source run.
   * Only failed / partial / skipped / unevaluated scenarios are retried.
   * Use this to iterate on agent fixes without burning judge tokens on
   * already-passing cases.
   *
   * If the source has no `results` (e.g. crashed before producing any),
   * everything is rerun — there's nothing to skip.
   */
  async rerun(
    sourceId: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    const source = await this.evaluationGateway.findById(sourceId);
    if (!source || this.keptFrom(source, scope)) {
      throw new NotFoundException('Source evaluation not found');
    }

    const agent = await this.agentGateway.findById(source.agentId);
    if (!agent) {
      throw new NotFoundException(
        `Agent ${source.agentId} no longer exists; cannot rerun.`,
      );
    }

    const running = await this.evaluationGateway.findRunning(source.agentId);
    if (running) {
      throw new ConflictException(
        `Evaluation ${running.id} is already running for this agent`,
      );
    }

    if (source.scenariosSnapshot.length === 0) {
      throw new BadRequestException(
        'Source evaluation has no scenarios to rerun.',
      );
    }

    const passedIds = new Set(
      source.results
        .filter((r) => r.verdict === 'pass')
        .map((r) => r.scenarioId),
    );
    const scenariosToRun = sortScenarios(
      source.scenariosSnapshot.filter((s) => !passedIds.has(s.id)),
    );

    if (scenariosToRun.length === 0) {
      throw new BadRequestException(
        'All scenarios passed in the source evaluation — nothing to rerun.',
      );
    }

    const evaluation = await this.evaluationGateway.create({
      agentId: source.agentId,
      templateId: source.templateId,
      judgeConfig: source.judgeConfig,
      scenariosSnapshot: scenariosToRun,
    });

    void this.runInBackground(
      evaluation.id,
      source.agentId,
      scenariosToRun,
      source.judgeConfig,
    );

    return evaluation;
  }

  async getLogs(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<{ lines: string[] }> {
    await this.getById(id, scope);
    // The runner keeps one buffer per run, under the evaluation's id.
    return { lines: this.runner.getLogs(id) };
  }

  // Fetch a scenario as it was captured into this evaluation's snapshot.
  // The live `paddock_scenarios` table can drift (rancher auto-sync wipes
  // and reseeds with new UUIDs on every deploy), so the only reliable
  // source for "what did this run actually use" is the snapshot.
  async getScenario(
    id: string,
    scenarioId: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockScenarioData> {
    const ev = await this.getById(id, scope);
    const scenario = ev.scenariosSnapshot.find((s) => s.id === scenarioId);
    if (!scenario)
      throw new NotFoundException(
        `Scenario ${scenarioId} is not part of evaluation ${id}`,
      );
    return scenario;
  }

  async getReport(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<{ json: object; md: string }> {
    const ev = await this.getById(id, scope);
    if (!ev.reportS3Key) {
      throw new NotFoundException(
        'Report not yet available — evaluation may still be running or failed before producing one',
      );
    }
    const report = await this.reportGateway.loadReport(id, ev.reportS3Key);
    if (!report)
      throw new NotFoundException('Report blob missing from storage');
    return report;
  }

  async getTrace(
    id: string,
    scenarioId: string,
    scope: IPaddockRunScope = {},
  ): Promise<object | null> {
    await this.getById(id, scope);
    return this.reportGateway.loadTrace(id, scenarioId);
  }

  /**
   * The scenarios of one run: the agent's own and its template's, or the
   * ones named among those.
   *
   * A named scenario used to be taken by its id alone, whatever it was
   * scoped to. The run copies its scenarios into a snapshot the person who
   * started it reads, so naming the id of a scenario of an agent they do
   * not reach, of the Ranch assistant or of its template, read it to them
   * past every rule about scenarios (CLEAN-231, CLEAN-268, CLEAN-271). A
   * scenario runs for the agent it is scoped to and for no other.
   */
  private async resolveScenarios(
    input: IRunPaddockEvaluationData,
    agent: { id: string; templateId?: string | null },
    scope: IPaddockRunScope,
  ): Promise<IPaddockScenarioData[]> {
    const ofThisAgent = (s: IPaddockScenarioData): boolean =>
      s.agentId
        ? s.agentId === agent.id
        : Boolean(s.templateId) && s.templateId === agent.templateId;
    const shown = (s: IPaddockScenarioData): boolean =>
      Boolean(s.agentId) ||
      !s.templateId ||
      !scope.hidesTemplate?.(s.templateId);
    let scenarios: IPaddockScenarioData[];
    if (input.scenarioIds && input.scenarioIds.length > 0) {
      scenarios = [];
      for (const id of input.scenarioIds) {
        const s = await this.scenarioGateway.findById(id);
        if (s) scenarios.push(s);
      }
    } else {
      scenarios = await this.scenarioGateway.findForAgent(input.agentId);
    }
    return sortScenarios(scenarios.filter(ofThisAgent).filter(shown));
  }

  /**
   * Looks up the agent's configured LlmCredential (Agent.llmCredentialId).
   * Returns undefined if the agent has none — paddock will then fall back to
   * its hardcoded default (claude-sonnet-4-6) using whichever Claude key the
   * judges provided.
   */
  private async resolveAgentLlm(
    agentId: string,
  ): Promise<IPaddockJudgeCredential | undefined> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.llmCredentialId) return undefined;
    const cred = await this.llmGateway.findById(agent.llmCredentialId);
    if (!cred) return undefined;
    return {
      provider: cred.provider,
      model: cred.model,
      apiKey: cred.apiKey,
    };
  }

  private async resolveJudgeCredentials(
    judgeConfig: IPaddockJudgeConfig,
  ): Promise<IPaddockJudgeCredential[]> {
    if (judgeConfig.credentialIds.length === 0) {
      const all = await this.llmGateway.findActive();
      return all.map((c) => ({
        provider: c.provider,
        model: c.model,
        apiKey: c.apiKey,
      }));
    }
    const creds: IPaddockJudgeCredential[] = [];
    for (const id of judgeConfig.credentialIds) {
      const c = await this.llmGateway.findById(id);
      if (c)
        creds.push({ provider: c.provider, model: c.model, apiKey: c.apiKey });
    }
    return creds;
  }

  private async runInBackground(
    evaluationId: string,
    agentId: string,
    scenarios: IPaddockScenarioData[],
    judgeConfig: IPaddockJudgeConfig,
  ): Promise<void> {
    let envelope: { agentDir: string; cleanup: () => Promise<void> } | null =
      null;
    try {
      const judges = await this.resolveJudgeCredentials(judgeConfig);
      const agentLlm = await this.resolveAgentLlm(agentId);
      envelope = await this.envelope.materialize(agentId);

      const output = await this.runner.run({
        evaluationId,
        agentId,
        agentDir: envelope.agentDir,
        scenarios,
        judges,
        agentLlm,
        config: judgeConfig,
        onProgress: async (event) => {
          try {
            await this.evaluationGateway.update(evaluationId, {
              currentScenarioId: event.scenarioId,
            });
          } catch (err) {
            this.logger.warn(
              `Failed to record progress for ${evaluationId}: ${(err as Error).message}`,
            );
          }
        },
      });

      await this.reportGateway.saveSnapshot(evaluationId, scenarios);

      const reportKey = await this.reportGateway.saveReport(evaluationId, {
        json: output.reportJson,
        md: output.reportMd,
      });

      for (const [scenarioId, trace] of Object.entries(output.traces)) {
        try {
          await this.reportGateway.saveTrace(evaluationId, scenarioId, trace);
        } catch (err) {
          this.logger.warn(
            `Failed to save trace ${scenarioId}: ${(err as Error).message}`,
          );
        }
      }

      await this.evaluationGateway.addResults(
        evaluationId,
        output.results.map((r) => ({
          scenarioId: r.scenarioId,
          verdict: r.verdict,
          finalScore: r.finalScore,
          agreement: r.agreement,
          dimensionScores: r.dimensionScores,
          judges: r.judges,
          failureReasons: r.failureReasons,
        })),
      );

      await this.evaluationGateway.update(evaluationId, {
        status: output.errorMessage ? 'failed' : 'done',
        finishedAt: new Date(),
        currentScenarioId: null,
        passRate: output.passRate,
        scenarioCount: output.scenarioCount,
        passCount: output.passCount,
        failCount: output.failCount,
        partialCount: output.partialCount,
        skippedCount: output.skippedCount,
        reportS3Key: reportKey,
        errorMessage: output.errorMessage,
      });
    } catch (err) {
      this.logger.error(
        `Evaluation ${evaluationId} failed: ${(err as Error).message}`,
      );
      captureBackgroundError(err, 'paddock.evaluation');
      try {
        await this.evaluationGateway.update(evaluationId, {
          status: 'failed',
          finishedAt: new Date(),
          currentScenarioId: null,
          errorMessage: (err as Error).message,
        });
      } catch {
        // swallow — we already errored
      }
    } finally {
      if (envelope) await envelope.cleanup();
    }
  }
}
