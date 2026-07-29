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

  async function load() {
    loading.value = true;
    try {
      const agents = await agentStore.fetchAll();

      const settled = await Promise.allSettled(
        agents.map(async (agent) => {
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
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => void load());

  return { rows, totals, loading, load };
}
