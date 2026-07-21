import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { IAgentUsage, UsageService } from '#usage/domain';

// Re-export the domain types for consumers importing from
// `#usage/stores/usage`.
export type {
  IAgentUsage,
  IUsageDailyEntry,
  IUsageToday,
  IUsageTotals,
} from '#usage/domain';

const getService = createServiceGetter<UsageService>('$usageService');

export const useUsageStore = defineStore('usage', () => {
  const byAgent = ref<Record<string, IAgentUsage>>({});

  async function fetchForAgent(agentId: string) {
    const data = await getService().findForAgent(agentId);
    if (data) byAgent.value[agentId] = data;
    return data;
  }

  function getForAgent(agentId: string): IAgentUsage | null {
    return byAgent.value[agentId] ?? null;
  }

  return { byAgent, fetchForAgent, getForAgent };
});
