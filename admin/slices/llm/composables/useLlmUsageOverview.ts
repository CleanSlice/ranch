import { ownerOnlyAssistant, ownerOnlyLeftOutText } from '#agent/utils/agentAccess';

export interface IPerAgentUsage {
  agentId: string;
  agentName: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  topModel: string | null;
  todayCallCount: number;
  todayCostUsd: number;
}

/**
 * Per-agent token/cost usage across the last 30 days, sorted by cost.
 * Today's numbers are hot (live usage.json snapshot per agent); the rest
 * comes from reported daily aggregates. Loads on mount.
 */
export function useLlmUsageOverview() {
  const agentStore = useAgentStore();
  const usageStore = useUsageStore();
  const authStore = useAuthStore();

  // The Ranch assistant's usage is the Owner's to read (CLEAN-268): for
  // anybody else `GET /agents/:id/usage` answers "not found" for it. It is
  // not asked for (CLEAN-269), and the page says in one line that the totals
  // are without it, so that they are not read as all the installation spent.
  const leftOutText = ref('');

  const loading = ref(false);
  const rows = ref<IPerAgentUsage[]>([]);

  const totals = computed(() =>
    rows.value.reduce(
      (acc, r) => ({
        callCount: acc.callCount + r.callCount,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        costUsd: acc.costUsd + r.costUsd,
        todayCallCount: acc.todayCallCount + r.todayCallCount,
        todayCostUsd: acc.todayCostUsd + r.todayCostUsd,
      }),
      {
        callCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        todayCallCount: 0,
        todayCostUsd: 0,
      },
    ),
  );

  // The agent list could not be read (CLEAN-231). The rows already on screen
  // stay; the page says the numbers are not fresh.
  const failed = ref(false);

  async function load() {
    loading.value = true;
    failed.value = false;
    try {
      const agents = await agentStore.fetchAll();
      const assistant = ownerOnlyAssistant(authStore.user?.role, agents);
      leftOutText.value = assistant
        ? ownerOnlyLeftOutText('usage figures', assistant.name)
        : '';
      const readable = agents.filter((agent) => agent.id !== assistant?.id);

      const settled = await Promise.allSettled(
        readable.map(async (agent) => {
          const usage = await usageStore.fetchForAgent(agent.id);
          if (!usage) return null;
          const todayKey = new Date().toISOString().slice(0, 10);
          const todayCostUsd = usage.last30days
            .filter((e) => e.date === todayKey)
            .reduce((a, b) => a + b.costUsd, 0);
          return {
            agentId: agent.id,
            agentName: agent.name,
            callCount: usage.totals.callCount,
            inputTokens: usage.totals.inputTokens,
            outputTokens: usage.totals.outputTokens,
            costUsd: usage.totals.costUsd,
            topModel: usage.topModel,
            todayCallCount: usage.today.callCount,
            todayCostUsd,
          } satisfies IPerAgentUsage;
        }),
      );

      rows.value = settled
        .filter(
          (r): r is PromiseFulfilledResult<IPerAgentUsage | null> =>
            r.status === 'fulfilled' && r.value !== null,
        )
        .map((r) => r.value as IPerAgentUsage)
        .sort((a, b) => b.costUsd - a.costUsd);
    } catch {
      // `fetchAll` throws when the list is refused or unreachable. Called
      // from `onMounted` and from a click, so nothing above would catch it.
      failed.value = true;
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => void load());

  return { rows, totals, loading, failed, load, leftOutText };
}
