import { AgentsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

// Discriminated union — mirrors the API shape. v1 is telegram-only; add new
// variants here as the backend gains support.
export type IAgentChannel = {
  type: 'telegram';
  config: {
    botToken: string;
    botName?: string;
    adminIds?: string;
  };
};

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
    const res = await AgentsService.getAgentChannels({ path: { id: agentId } });
    const env = res.data as ApiEnvelope<IAgentChannel[]> | undefined;
    const list = env?.data ?? [];
    channelsByAgent.value = { ...channelsByAgent.value, [agentId]: list };
    return list;
  }

  async function setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    const res = await AgentsService.setAgentChannels({
      path: { id: agentId },
      body: { channels },
    });
    const env = res.data as ApiEnvelope<IAgentChannel[]> | undefined;
    const updated = env?.data ?? channels;
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
