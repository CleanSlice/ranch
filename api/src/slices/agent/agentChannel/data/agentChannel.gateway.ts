import { Injectable, NotFoundException } from '@nestjs/common';
import { IAgentChannelGateway } from '../domain/agentChannel.gateway';
import {
  IAgentChannel,
  IChannelsFile,
  IChannelStatusFile,
  ITelegramFileEntry,
} from '../domain/agentChannel.types';
import { AgentChannelMapper } from './agentChannel.mapper';
import { IFileGateway } from '#/agent/file/domain';

// Source of truth — the runtime's per-channel layout, mutated by its
// channel_* tools and by PUT /agents/:id/channels (read-modify-write so
// neither writer clobbers the other's fields). Keep the paths in sync with
// runtime/src/slices/setup/channel/data/channelFiles.ts.
const TELEGRAM_PATH = 'data/channels/telegram.json';
// Runtime-written live state (connected/error per type). Read-only here.
const STATUS_PATH = 'data/channels/status.json';
// Pre-split flat layout — frozen: read-only fallback for agents configured
// before the per-channel convergence. Never written, never deleted.
const LEGACY_CHANNELS_PATH = 'data/channels.json';

@Injectable()
export class AgentChannelGateway extends IAgentChannelGateway {
  constructor(
    private files: IFileGateway,
    private mapper: AgentChannelMapper,
  ) {
    super();
  }

  async getForAgent(agentId: string): Promise<IAgentChannel[]> {
    const [aggregate, status] = await Promise.all([
      this.readAggregate(agentId),
      // Status is advisory — a broken/missing file must not take GET down.
      this.readJson<IChannelStatusFile>(agentId, STATUS_PATH).catch(() => null),
    ]);
    return this.mapper.fileToArray(aggregate, status ?? undefined);
  }

  async setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    const desired = this.mapper.arrayToFile(channels);

    if (desired.telegram) {
      // RMW: keep runtime-owned fields (groups) intact, credentials clear a
      // prior tombstone.
      const current =
        (await this.readJson<ITelegramFileEntry>(agentId, TELEGRAM_PATH)) ?? {};
      const next: ITelegramFileEntry = { ...current, ...desired.telegram };
      delete next.removed;
      await this.files.save(agentId, TELEGRAM_PATH, toJson(next));
    } else {
      // Channel omitted from the exhaustive PUT list — tombstone it (a
      // deleted file would let the runtime's env fallback resurrect it on
      // restart), but only when something is actually configured.
      const aggregate = await this.readAggregate(agentId);
      if (aggregate.telegram?.botToken && !aggregate.telegram.removed) {
        await this.files.save(agentId, TELEGRAM_PATH, toJson({ removed: true }));
      }
    }

    // Re-derive so the response mirrors what the next GET will return.
    return this.getForAgent(agentId);
  }

  /**
   * Effective config per type: the per-channel file is authoritative when it
   * carries credentials or a tombstone; a groups-only file (bot configured
   * via env/panel while the runtime tracked groups into the new layout)
   * still defers to the frozen legacy file.
   */
  private async readAggregate(agentId: string): Promise<IChannelsFile> {
    const telegram = await this.readJson<ITelegramFileEntry>(
      agentId,
      TELEGRAM_PATH,
    );
    if (telegram && (telegram.botToken || telegram.removed)) {
      return { telegram };
    }
    const legacy = await this.readJson<IChannelsFile>(
      agentId,
      LEGACY_CHANNELS_PATH,
    );
    return legacy ?? {};
  }

  // NotFound is the empty-state path, not an error condition; parse errors
  // and other S3 failures bubble up.
  private async readJson<T extends object>(
    agentId: string,
    path: string,
  ): Promise<T | null> {
    let raw: string;
    try {
      const file = await this.files.read(agentId, path);
      raw = file.content;
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  }
}

function toJson(data: object): string {
  return JSON.stringify(data, null, 2);
}
