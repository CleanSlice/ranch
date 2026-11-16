import type { ComputedRef } from 'vue';
import type { IAgentUsage } from '#usage/domain/usage.types';

/**
 * One agent's 30-day usage for the Overview page (CLEAN-228): the summary
 * strip and the Usage block read the same record, fetched once.
 *
 * The request shares its `useAsyncData` key with the header's usage line and
 * the full usage panel, so the page asks for it once however many of them are
 * mounted. What renders is the usage store's record for the agent
 * (docs/state.md); the request is only asked whether it is still running and
 * whether it came back with anything.
 */
export type AgentUsageState = 'loading' | 'failed' | 'ready';

export interface IAgentUsageFeed {
  /** The store's record; `null` until there is one. */
  usage: ComputedRef<IAgentUsage | null>;
  state: ComputedRef<AgentUsageState>;
}

export function useAgentUsage(agentId: string): IAgentUsageFeed {
  const usageStore = useUsageStore();

  const { data, status, error } = useAsyncData(
    `usage-panel-agent-${agentId}`,
    () => usageStore.fetchForAgent(agentId),
    { lazy: true },
  );

  const stored = computed(() => usageStore.byAgent[agentId] ?? null);

  const state = computed<AgentUsageState>(() => {
    if (!data.value && (status.value === 'pending' || status.value === 'idle')) {
      return 'loading';
    }
    // The gateway answers `null` for a failed request rather than throwing.
    if (error.value || !data.value) return 'failed';
    return stored.value ? 'ready' : 'failed';
  });

  const usage = computed(() => (state.value === 'ready' ? stored.value : null));

  return { usage, state };
}
