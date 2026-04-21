import { UsageService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

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

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useUsageStore = defineStore('usage', () => {
  const byAgent = ref<Record<string, IAgentUsage>>({});

  async function fetchForAgent(agentId: string) {
    const res = await UsageService.usageControllerFindForAgent({
      path: { agentId },
    });
    const data = unwrap<IAgentUsage>(res.data);
    if (data) byAgent.value[agentId] = data;
    return data;
  }

  function getForAgent(agentId: string): IAgentUsage | null {
    return byAgent.value[agentId] ?? null;
  }

  return { byAgent, fetchForAgent, getForAgent };
});
