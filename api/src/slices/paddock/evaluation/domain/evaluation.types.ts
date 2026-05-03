import {
  IPaddockScenarioData,
  PaddockEvalDimension,
} from '../../scenario/domain';

export type PaddockEvaluationStatus = 'running' | 'done' | 'failed' | 'aborted';

export type PaddockVerdict = 'pass' | 'fail' | 'partial' | 'skipped';

export interface IPaddockJudgeConfig {
  credentialIds: string[];
  threshold: number;
  maxLlmCalls: number;
  maxTimeMs: number;
}

export const DEFAULT_PADDOCK_JUDGE_CONFIG: IPaddockJudgeConfig = {
  credentialIds: [],
  threshold: 0.8,
  maxLlmCalls: 100,
  maxTimeMs: 30 * 60 * 1000,
};

export interface IPaddockJudgeScoreData {
  judgeModel: string;
  scores: Partial<Record<PaddockEvalDimension, number>>;
  reasoning: Partial<Record<PaddockEvalDimension, string>>;
  overallScore: number;
  verdict: PaddockVerdict;
  confidence: number;
  suggestions: string[];
}

export interface IPaddockEvaluationResultData {
  id: string;
  evaluationId: string;
  scenarioId: string;
  verdict: PaddockVerdict;
  finalScore: number;
  agreement: number;
  dimensionScores: Partial<Record<PaddockEvalDimension, number>>;
  judges: IPaddockJudgeScoreData[];
  failureReasons: string[];
}

export interface IPaddockEvaluationScenarioSummary {
  id: string;
  name: string;
  category: string;
  difficulty: string;
}

export interface IPaddockEvaluationData {
  id: string;
  agentId: string;
  templateId: string | null;
  status: PaddockEvaluationStatus;
  startedAt: Date;
  finishedAt: Date | null;
  currentScenarioId: string | null;
  passRate: number | null;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  skippedCount: number;
  judgeConfig: IPaddockJudgeConfig;
  scenariosSnapshot: IPaddockScenarioData[];
  scenarios: IPaddockEvaluationScenarioSummary[];
  reportS3Key: string | null;
  errorMessage: string | null;
  results: IPaddockEvaluationResultData[];
}

export interface IRunPaddockEvaluationData {
  agentId: string;
  scenarioIds?: string[];
  judgeOverride?: Partial<IPaddockJudgeConfig>;
}

export interface IUpdatePaddockEvaluationData {
  status?: PaddockEvaluationStatus;
  finishedAt?: Date | null;
  currentScenarioId?: string | null;
  passRate?: number | null;
  scenarioCount?: number;
  passCount?: number;
  failCount?: number;
  partialCount?: number;
  skippedCount?: number;
  reportS3Key?: string | null;
  errorMessage?: string | null;
}

export interface IPaddockEvaluationReportData {
  json: object;
  md: string;
}
