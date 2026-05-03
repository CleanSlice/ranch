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
import { RanchAgentEnvelope } from '../data/ranchAgentEnvelope';

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

    const scenarios = await this.resolveScenarios(input);
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

  async list(filter: {
    agentId?: string;
    templateId?: string;
    limit?: number;
  }): Promise<IPaddockEvaluationData[]> {
    return this.evaluationGateway.findAll(filter);
  }

  async getById(id: string): Promise<IPaddockEvaluationData> {
    const ev = await this.evaluationGateway.findById(id);
    if (!ev) throw new NotFoundException('Evaluation not found');
    return ev;
  }

  async abort(id: string): Promise<IPaddockEvaluationData> {
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
   * Re-run an evaluation with the exact same scenarios + judge config as a
   * source run. Useful for comparing eval results across prompt/agent changes
   * without re-resolving the scenario set (which may have drifted).
   */
  async rerun(sourceId: string): Promise<IPaddockEvaluationData> {
    const source = await this.evaluationGateway.findById(sourceId);
    if (!source) throw new NotFoundException('Source evaluation not found');

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

    const evaluation = await this.evaluationGateway.create({
      agentId: source.agentId,
      templateId: source.templateId,
      judgeConfig: source.judgeConfig,
      scenariosSnapshot: source.scenariosSnapshot,
    });

    void this.runInBackground(
      evaluation.id,
      source.agentId,
      source.scenariosSnapshot,
      source.judgeConfig,
    );

    return evaluation;
  }

  async getReport(id: string): Promise<{ json: object; md: string }> {
    const ev = await this.evaluationGateway.findById(id);
    if (!ev) throw new NotFoundException('Evaluation not found');
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

  async getTrace(id: string, scenarioId: string): Promise<object | null> {
    const ev = await this.evaluationGateway.findById(id);
    if (!ev) throw new NotFoundException('Evaluation not found');
    return this.reportGateway.loadTrace(id, scenarioId);
  }

  private async resolveScenarios(
    input: IRunPaddockEvaluationData,
  ): Promise<IPaddockScenarioData[]> {
    if (input.scenarioIds && input.scenarioIds.length > 0) {
      const scenarios: IPaddockScenarioData[] = [];
      for (const id of input.scenarioIds) {
        const s = await this.scenarioGateway.findById(id);
        if (s) scenarios.push(s);
      }
      return scenarios;
    }
    return this.scenarioGateway.findForAgent(input.agentId);
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
