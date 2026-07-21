import { AgentsService } from '#api/data';
import type { AgentChannelDto } from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentChannelGateway } from '../domain/agentChannel.gateway';
import type { IAgentChannel } from '../domain/agentChannel.types';
import { AgentChannelMapper } from './agentChannel.mapper';

export class AgentChannelGateway
  extends BaseGateway
  implements IAgentChannelGateway
{
  private mapper = new AgentChannelMapper();

  fetchForAgent(agentId: string): Promise<IAgentChannel[]> {
    return this.execute(async () => {
      const res = await AgentsService.getAgentChannels({ path: { id: agentId } });
      const dto = unwrapEnvelope<AgentChannelDto[]>(res.data);
      return dto ? this.mapper.toList(dto) : [];
    });
  }

  setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    return this.execute(async () => {
      const res = await AgentsService.setAgentChannels({
        path: { id: agentId },
        body: { channels: this.mapper.toDtoList(channels) },
      });
      const dto = unwrapEnvelope<AgentChannelDto[]>(res.data);
      // On an empty envelope, fall back to the just-submitted channels so the
      // caller's optimistic view stays correct.
      return dto ? this.mapper.toList(dto) : channels;
    });
  }
}
