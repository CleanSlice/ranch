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
