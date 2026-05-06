import { IPaddockJudgeConfig } from './evaluation.types';
import { IPaddockScenarioData } from '../../scenario/domain';

export interface IPaddockJudgeCredential {
  provider: string;
  model: string;
  apiKey: string;
}

export interface IPaddockRunnerInput {
  agentId: string;
  agentDir: string;
  scenarios: IPaddockScenarioData[];
  judges: IPaddockJudgeCredential[];
  /**
   * Credential used by the agent's own runtime (passed via env vars to the
   * paddock CLI). If omitted, paddock falls back to the first judge credential
   * and its hardcoded default model "claude-sonnet-4-6".
   */
  agentLlm?: IPaddockJudgeCredential;
  config: IPaddockJudgeConfig;
  personality?: string;
  /**
   * Called when the runner detects a scenario starting. Used by callers to
   * persist live progress so polled UIs can highlight the current scenario.
   */
  onProgress?: (event: IPaddockRunnerProgress) => void | Promise<void>;
}

export interface IPaddockRunnerProgress {
  /** 1-indexed position in the planned set. */
  index: number;
  total: number;
  scenarioId: string;
}

export interface IPaddockRunnerOutput {
  passRate: number;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  skippedCount: number;
  results: Array<{
    scenarioId: string;
    verdict: 'pass' | 'fail' | 'partial' | 'skipped';
    finalScore: number;
    agreement: number;
    dimensionScores: Record<string, number>;
    judges: Array<{
      judgeModel: string;
      scores: Record<string, number>;
      reasoning: Record<string, string>;
      overallScore: number;
      verdict: 'pass' | 'fail' | 'partial' | 'skipped';
      confidence: number;
      suggestions: string[];
    }>;
    failureReasons: string[];
  }>;
  reportJson: object;
  reportMd: string;
  errorMessage: string | null;
  traces: Record<string, object>;
}

/**
 * Adapter that wraps `@cleanslice/paddock` runEvaluation() for ranch.
 * Implementations vary in how they materialize the agent runtime
 * (FilesystemAgentRunner against monorepo, future HttpAgentRunner against pods).
 */
export abstract class IPaddockRunner {
  abstract run(input: IPaddockRunnerInput): Promise<IPaddockRunnerOutput>;
  /**
   * Best-effort cancellation of an in-flight run. Returns true if the runner
   * had a process to kill, false otherwise.
   */
  abstract abort(agentId: string): boolean;
  /**
   * Live tail of paddock CLI stdout+stderr for the most recent (or in-flight)
   * eval of an agent. Empty array if nothing has run yet, or if the buffer
   * was cleared at the start of a fresh run for the same agent.
   * Implementations are expected to keep at least a bounded ring buffer
   * (lost on process restart — acceptable for live debugging).
   */
  abstract getLogs(agentId: string): string[];
}
