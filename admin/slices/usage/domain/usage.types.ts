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

export interface IOverviewAgentUsage {
  agentId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

/**
 * Workspace-wide usage across all agents (30-day window). DB-backed only —
 * today's not-yet-reported runtime usage is excluded until agents report,
 * unlike the live-merged per-agent shape.
 */
export interface IOverviewUsage {
  last30days: IUsageDailyEntry[];
  totals: IUsageTotals;
  topModel: string | null;
  byAgent: IOverviewAgentUsage[];
}
