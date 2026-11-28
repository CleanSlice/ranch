import { IPaddockJudgeConfig } from './evaluation.types';
import { IPaddockScenarioData } from '../../scenario/domain';

export interface IPaddockJudgeCredential {
  provider: string;
  model: string;
  apiKey: string;
}

export interface IPaddockRunnerInput {
  /** The run this is: its log is kept under this id, and under no other. */
  evaluationId: string;
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
   * Live tail of paddock CLI stdout+stderr of ONE run, by its evaluation
   * id. Empty for a run that has not started, or whose buffer is gone.
   *
   * One buffer per run, never per agent: the process of a run appends to
   * the buffer it was given when it was spawned and to no other, so the
   * lines of one run cannot be read under another, whichever started last
   * and however long the earlier child keeps writing (CLEAN-271). A
   * bounded ring per run, and a bounded number of runs; lost on restart,
   * which is acceptable for live debugging.
   */
  abstract getLogs(evaluationId: string): string[];
}
