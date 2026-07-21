import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentChannelService, IAgentChannel } from '#agentChannel/domain';

// Re-export the domain type so `agentChannel/Provider.vue` (and any future
// consumer importing from `#agentChannel/stores/agentChannel`) keeps working.
export type { IAgentChannel } from '#agentChannel/domain';

const getService = createServiceGetter<AgentChannelService>(
  '$agentChannelService',
);

export const useAgentChannelStore = defineStore('agentChannel', () => {
  // Per-agent cache. Reads always go to S3 (no client-side TTL — the tab
  // calls fetchForAgent on mount), but holding the last-read array lets
  // synchronous consumers (the Env tab's computed) reflect the most
  // recent value without waiting on a re-fetch.
  const channelsByAgent = ref<Record<string, IAgentChannel[]>>({});

  function getCached(agentId: string): IAgentChannel[] {
    return channelsByAgent.value[agentId] ?? [];
  }

  async function fetchForAgent(agentId: string): Promise<IAgentChannel[]> {
    const list = await getService().fetchForAgent(agentId);
    channelsByAgent.value = { ...channelsByAgent.value, [agentId]: list };
    return list;
  }

  async function setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    const updated = await getService().setForAgent(agentId, channels);
    channelsByAgent.value = { ...channelsByAgent.value, [agentId]: updated };
    return updated;
  }

  return {
    channelsByAgent,
    getCached,
    fetchForAgent,
    setForAgent,
  };
});
