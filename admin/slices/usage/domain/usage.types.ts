// Domain types for per-agent LLM usage.

export interface IUsageDailyEntry {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

export interface IUsageTotals {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

export interface IUsageToday {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}

export interface IAgentUsage {
  last30days: IUsageDailyEntry[];
  totals: IUsageTotals;
  topModel: string | null;
  today: IUsageToday;
}
