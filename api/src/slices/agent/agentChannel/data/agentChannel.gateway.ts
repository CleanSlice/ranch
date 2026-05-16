import { Injectable, NotFoundException } from '@nestjs/common';
import { IAgentChannelGateway } from '../domain/agentChannel.gateway';
import { IAgentChannel, IChannelsFile } from '../domain/agentChannel.types';
import { AgentChannelMapper } from './agentChannel.mapper';
import { IFileGateway } from '#/agent/file/domain';

// Single source of truth — the runtime reads/writes the same path on
// boot and via channel_* tools (runtime/src/slices/setup/channel/data
// /channelsFile.ts). Keep this string in sync.
const CHANNELS_PATH = 'data/channels.json';

@Injectable()
export class AgentChannelGateway extends IAgentChannelGateway {
  constructor(
    private files: IFileGateway,
    private mapper: AgentChannelMapper,
  ) {
    super();
  }

  async getForAgent(agentId: string): Promise<IAgentChannel[]> {
    let raw: string;
    try {
      const file = await this.files.read(agentId, CHANNELS_PATH);
      raw = file.content;
    } catch (err) {
      // No file → no channels. A NotFound here is the empty-state path,
      // not an error condition; anything else (parse, S3, …) bubbles up.
      if (err instanceof NotFoundException) return [];
      throw err;
    }
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return this.mapper.fileToArray(parsed as IChannelsFile);
  }

  async setForAgent(
    agentId: string,
    channels: IAgentChannel[],
  ): Promise<IAgentChannel[]> {
    const file = this.mapper.arrayToFile(channels);
    const body = JSON.stringify(file, null, 2);
    await this.files.save(agentId, CHANNELS_PATH, body);
    // Re-derive from the file body so the response mirrors what the next
    // GET will return (e.g. unknown channel types in the input were dropped).
    return this.mapper.fileToArray(file);
  }
}
