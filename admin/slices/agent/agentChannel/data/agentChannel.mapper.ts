import type { AgentChannelDto } from '#api/data/repositories/api/types.gen';
import type { IAgentChannel } from '../domain/agentChannel.types';

/**
 * Maps the agent-channels API onto the domain shape. `IAgentChannel` is
 * structurally the wire `AgentChannelDto`; the mapper still exists to keep
 * `#api` types out of the domain and to drop malformed channels defensively.
 */
export class AgentChannelMapper {
  toList(raw: unknown): IAgentChannel[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toChannel(item))
      .filter((c): c is IAgentChannel => c !== null);
  }

  toDtoList(channels: IAgentChannel[]): AgentChannelDto[] {
    return channels.map((c) => ({
      type: c.type,
      config: {
        botToken: c.config.botToken,
        botName: c.config.botName,
        adminIds: c.config.adminIds,
      },
    }));
  }

  private toChannel(raw: unknown): IAgentChannel | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (o.type !== 'telegram') return null;
    const config =
      o.config && typeof o.config === 'object'
        ? (o.config as Record<string, unknown>)
        : {};
    if (typeof config.botToken !== 'string') return null;
    return {
      type: 'telegram',
      config: {
        botToken: config.botToken,
        botName: typeof config.botName === 'string' ? config.botName : undefined,
        adminIds: typeof config.adminIds === 'string' ? config.adminIds : undefined,
      },
    };
  }
}
