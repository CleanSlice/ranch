export interface IUsageData {
  id: string;
  agentId: string;
  llmCredentialId: string | null;
  model: string;
  date: Date;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReportUsageData {
  date: string;
  byModel: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      callCount: number;
      llmCredentialId?: string;
    }
  >;
}

export interface IUsageDailyEntry {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

export interface IAgentUsageResponse {
  last30days: IUsageDailyEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    costUsd: number;
  };
  topModel: string | null;
  today: {
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
  };
}

/**
 * Aggregate usage for a single LlmCredential across all agents using it.
 * Shape mirrors IAgentUsageResponse so the admin UI can render the same
 * cards; adds per-agent breakdown since that's the missing dimension.
 */
export interface ICredentialUsageResponse {
  /** Daily totals across all agents on this credential. */
  last30days: IUsageDailyEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    costUsd: number;
  };
  topModel: string | null;
  /** One row per agent that has reported usage on this credential. */
  byAgent: Array<{
    agentId: string;
    agentName: string;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    costUsd: number;
  }>;
}
