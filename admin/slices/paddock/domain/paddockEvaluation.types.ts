// Domain types for paddock evaluations.

export type PaddockEvaluationStatus = 'running' | 'done' | 'failed' | 'aborted';
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
  description: string;
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

export interface IPaddockEvaluationFilter {
  agentId?: string;
  templateId?: string;
  limit?: number;
}

export interface IPaddockEvaluationReport {
  json: object;
  md: string;
}
