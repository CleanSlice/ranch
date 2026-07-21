import type { IAgentChannel } from './agentChannel.types';

/**
 * Contract for an agent's channel configuration. Implemented by
 * `AgentChannelGateway` in the data layer.
 */
export abstract class IAgentChannelGateway {
  abstract fetchForAgent(agentId: string): Promise<IAgentChannel[]>;
  abstract setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]>;
}
