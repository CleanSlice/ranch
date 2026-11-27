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
    return (await this.evaluationGateway.findAll(filter)).map((ev) =>
      this.shownTo(ev, scope),
    );
  }

  async getById(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    const ev = await this.evaluationGateway.findById(id);
    if (!ev) throw new NotFoundException('Evaluation not found');
    return this.shownTo(ev, scope);
  }

  // ── What a run holds of scenarios its reader may not read (CLEAN-271) ──
  //
  // An evaluation keeps a COPY of the scenarios it ran: the snapshot, a
  // result and a trace per scenario, and a report and a log about all of
  // them. An ordinary agent may sit on a template the Ranch assistant is
  // built from, and a run of it started by the Owner (or before this rule)
  // holds that template's scenarios, which only the Owner reads. Whoever
  // reaches the agent reads the run, so the copy is read through the same
  // scope as the live rows: the scenario and its result are left out, by
  // id they are "not part of this evaluation", and the report and the log,
  // which are one text about every scenario and cannot be taken apart, are
  // the Owner's for such a run.

  /** The ids of the snapshot's scenarios `scope` keeps from its reader. */
  private keptFrom(
    ev: IPaddockEvaluationData,
    scope: IPaddockRunScope,
  ): Set<string> {
    const hides = scope.hidesTemplate;
    if (!hides) return new Set();
    return new Set(
      ev.scenariosSnapshot
        .filter(
          (s) => !s.agentId && Boolean(s.templateId) && hides(s.templateId!),
        )
        .map((s) => s.id),
    );
  }

  /** `ev` as the reader of `scope` gets it. */
  private shownTo(
    ev: IPaddockEvaluationData,
    scope: IPaddockRunScope,
  ): IPaddockEvaluationData {
    const kept = this.keptFrom(ev, scope);
    if (kept.size === 0) return ev;
    // One place builds the whole view, and every field that was derived
    // from the snapshot is derived again from what is left of it. A kept
    // scenario is not listed, not counted and not hinted at: no "hidden: n",
    // because that a template of the assistant has scenarios, and how many,
    // is the Owner's business as much as their text.
    const scenariosSnapshot = ev.scenariosSnapshot.filter(
      (s) => !kept.has(s.id),
    );
    const results = ev.results.filter((r) => !kept.has(r.scenarioId));
    const count = (verdict: string) =>
      results.filter((r) => r.verdict === verdict).length;
    const passCount = count('pass');
    const names = ev.scenariosSnapshot
      .filter((s) => kept.has(s.id))
      .flatMap((s) => [s.id, s.name])
      .filter((word) => typeof word === 'string' && word !== '');
    return {
      ...ev,
      scenariosSnapshot,
      scenarios: ev.scenarios.filter((s) => !kept.has(s.id)),
      results,
      currentScenarioId:
        ev.currentScenarioId && kept.has(ev.currentScenarioId)
          ? null
          : ev.currentScenarioId,
      scenarioCount: scenariosSnapshot.length,
      passCount,
      failCount: count('fail'),
      partialCount: count('partial'),
      skippedCount: count('skipped'),
      passRate:
        ev.passRate === null
          ? null
          : scenariosSnapshot.length === 0
            ? 0
            : passCount / scenariosSnapshot.length,
      // The report is one text about every scenario and cannot be taken
      // apart: for this reader the run has none, as a run that stopped
      // before writing one has none.
      reportS3Key: null,
      // A message of the runner may name the scenario it stopped at.
      errorMessage:
        ev.errorMessage && names.some((word) => ev.errorMessage!.includes(word))
          ? 'The run stopped with an error.'
          : ev.errorMessage,
    };
  }

  /**
   * Which evaluation the runner's log of an agent belongs to. The runner
   * keeps ONE buffer per agent, cleared when a run of that agent starts, so
   * the lines under an agent are those of its latest run, whichever
   * evaluation is asked about. Kept here, next to the buffer and for as
   * long: both are this process's memory.
   */
  private readonly logOf = new Map<string, string>();

  async abort(
    id: string,
    scope: IPaddockRunScope = {},
  ): Promise<IPaddockEvaluationData> {
    return this.shownTo(await this.abortRun(id), scope);
  }

  private async abortRun(id: string): Promise<IPaddockEvaluationData> {
    const ev = await this.evaluationGateway.findById(id);
    if (!ev) throw new NotFoundException('Evaluation not found');
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
    const stored = await this.evaluationGateway.findById(sourceId);
    if (!stored) throw new NotFoundException('Source evaluation not found');
    // The source as the person rerunning it reads it: a scenario kept from
    // them is not sent again under their run (CLEAN-271).
    const source = this.shownTo(stored, scope);

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
    const stored = await this.evaluationGateway.findById(id);
    if (!stored) throw new NotFoundException('Evaluation not found');
    // The buffer is the agent's, not this evaluation's. It is this
    // evaluation's log only when this is the run that filled it: asked
    // about an earlier run, it used to answer with the lines of a later
    // one, which may hold scenarios this reader does not read (CLEAN-271).
    // And a run that holds any has no log for this reader, as one that
    // never started has none.
    if (this.logOf.get(stored.agentId) !== id) return { lines: [] };
    if (this.keptFrom(stored, scope).size > 0) return { lines: [] };
    return { lines: this.runner.getLogs(stored.agentId) };
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
    const stored = await this.evaluationGateway.findById(id);
    if (!stored) throw new NotFoundException('Evaluation not found');
    if (this.keptFrom(stored, scope).has(scenarioId)) {
      throw new NotFoundException(
        `Scenario ${scenarioId} is not part of evaluation ${id}`,
      );
    }
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
      // From here the agent's log buffer is this evaluation's: emptied and
      // handed over in one step, before anything is awaited, so that no line
      // of the run before is ever read under this id.
      this.runner.clearLogs(agentId);
      this.logOf.set(agentId, evaluationId);
      const judges = await this.resolveJudgeCredentials(judgeConfig);
      const agentLlm = await this.resolveAgentLlm(agentId);
      envelope = await this.envelope.materialize(agentId);

      const output = await this.runner.run({
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
