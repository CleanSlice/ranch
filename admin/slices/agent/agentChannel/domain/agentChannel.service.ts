import type { IAgentChannelGateway } from './agentChannel.gateway';
import type { IAgentChannel } from './agentChannel.types';

/**
 * Domain service for an agent's channels. The store layers a per-agent cache
 * (so synchronous consumers can read the last-fetched value) on top.
 */
export class AgentChannelService {
  constructor(private gateway: IAgentChannelGateway) {}

  fetchForAgent(agentId: string): Promise<IAgentChannel[]> {
    return this.gateway.fetchForAgent(agentId);
  }

  setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    return this.gateway.setForAgent(agentId, channels);
  }
}
