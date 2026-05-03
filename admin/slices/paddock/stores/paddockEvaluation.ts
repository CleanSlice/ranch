import { PaddockEvaluationsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type PaddockEvaluationStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'aborted';
export type PaddockVerdict = 'pass' | 'fail' | 'partial' | 'skipped';

export interface IPaddockJudgeConfig {
  credentialIds: string[];
  threshold: number;
  maxLlmCalls: number;
  maxTimeMs: number;
}

export interface IPaddockJudgeScore {
  judgeModel: string;
  scores: Record<string, number>;
  reasoning: Record<string, string>;
  overallScore: number;
  verdict: PaddockVerdict;
  confidence: number;
  suggestions: string[];
}

export interface IPaddockEvaluationResult {
  id: string;
  evaluationId: string;
  scenarioId: string;
  verdict: PaddockVerdict;
  finalScore: number;
  agreement: number;
  dimensionScores: Record<string, number>;
  judges: IPaddockJudgeScore[];
  failureReasons: string[];
}

export interface IPaddockEvaluationScenarioSummary {
  id: string;
  name: string;
  category: string;
  difficulty: string;
}

export interface IPaddockEvaluation {
  id: string;
  agentId: string;
  templateId: string | null;
  status: PaddockEvaluationStatus;
  startedAt: string;
  finishedAt: string | null;
  currentScenarioId: string | null;
  passRate: number | null;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  skippedCount: number;
  judgeConfig: IPaddockJudgeConfig;
  scenarios: IPaddockEvaluationScenarioSummary[];
  reportS3Key: string | null;
  errorMessage: string | null;
  results: IPaddockEvaluationResult[];
}

export interface IRunPaddockEvaluation {
  agentId: string;
  scenarioIds?: string[];
  judgeOverride?: Partial<IPaddockJudgeConfig>;
}

export const usePaddockEvaluationStore = defineStore(
  'paddockEvaluation',
  () => {
    const evaluations = ref<IPaddockEvaluation[]>([]);

    async function fetchAll(filter: {
      agentId?: string;
      templateId?: string;
      limit?: number;
    } = {}) {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerList({
          query: {
            agentId: filter.agentId,
            templateId: filter.templateId,
            limit: filter.limit?.toString(),
          },
        });
      const env = res.data as ApiEnvelope<IPaddockEvaluation[]> | undefined;
      evaluations.value = env?.data ?? [];
      return evaluations.value;
    }

    async function fetchById(id: string) {
      const res = await PaddockEvaluationsService.paddockEvaluationControllerGet(
        { path: { id } },
      );
      const env = res.data as ApiEnvelope<IPaddockEvaluation | null> | undefined;
      return env?.data ?? null;
    }

    async function start(input: IRunPaddockEvaluation) {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerStart({
          body: input,
        });
      const env = res.data as ApiEnvelope<IPaddockEvaluation>;
      evaluations.value = [env.data, ...evaluations.value];
      return env.data;
    }

    async function abort(id: string) {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerAbort({
          path: { id },
        });
      const env = res.data as ApiEnvelope<IPaddockEvaluation>;
      evaluations.value = evaluations.value.map((e) =>
        e.id === id ? env.data : e,
      );
      return env.data;
    }

    async function rerun(id: string): Promise<IPaddockEvaluation> {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerRerun({
          path: { id },
        });
      const env = res.data as ApiEnvelope<IPaddockEvaluation> | undefined;
      if (!env) {
        const err = res.error as { message?: string } | undefined;
        throw new Error(err?.message ?? 'Failed to rerun evaluation');
      }
      evaluations.value = [env.data, ...evaluations.value];
      return env.data;
    }

    async function fetchReport(id: string): Promise<{
      json: object;
      md: string;
    }> {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerReport({
          path: { id },
        });
      const env = res.data as
        | ApiEnvelope<{ json: object; md: string }>
        | undefined;
      if (!env) throw new Error('Report not available');
      return env.data;
    }

    async function fetchTrace(
      id: string,
      scenarioId: string,
    ): Promise<object | null> {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerTrace({
          path: { id },
          query: { scenarioId },
        });
      const env = res.data as ApiEnvelope<object | null> | undefined;
      return env?.data ?? null;
    }

    return {
      evaluations,
      fetchAll,
      fetchById,
      start,
      abort,
      rerun,
      fetchReport,
      fetchTrace,
    };
  },
);
