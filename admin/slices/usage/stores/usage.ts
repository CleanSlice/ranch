import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IAgentUsage,
  IOverviewUsage,
  UsageService,
} from '#usage/domain';

// Re-export the domain types for consumers importing from
// `#usage/stores/usage`.
export type {
  IAgentUsage,
  IOverviewAgentUsage,
  IOverviewUsage,
  IUsageDailyEntry,
  IUsageToday,
  IUsageTotals,
} from '#usage/domain';

const getService = createServiceGetter<UsageService>('$usageService');

export const useUsageStore = defineStore('usage', () => {
  const byAgent = ref<Record<string, IAgentUsage>>({});
  const overview = ref<IOverviewUsage | null>(null);

  async function fetchForAgent(agentId: string) {
    const data = await getService().findForAgent(agentId);
    if (data) byAgent.value[agentId] = data;
    return data;
  }

  function getForAgent(agentId: string): IAgentUsage | null {
    return byAgent.value[agentId] ?? null;
  }

  async function fetchOverview() {
    const data = await getService().findOverview();
    if (data) overview.value = data;
    return data;
  }

  function getOverview(): IOverviewUsage | null {
    return overview.value;
  }

  return { byAgent, overview, fetchForAgent, getForAgent, fetchOverview, getOverview };
});
