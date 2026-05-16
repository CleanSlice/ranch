import { IAgentChannel } from './agentChannel.types';

export abstract class IAgentChannelGateway {
  abstract getForAgent(agentId: string): Promise<IAgentChannel[]>;
  abstract setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]>;
}
