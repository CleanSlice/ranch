import { Injectable } from '@nestjs/common';
import {
  IAgentChannel,
  IChannelsFile,
  IChannelStatusFile,
} from '../domain/agentChannel.types';

@Injectable()
export class AgentChannelMapper {
  // Object → array. Iterates known types so unknown keys in the file
  // (added by future runtime versions ahead of the API) don't blow up.
  // Tombstoned entries are omitted; live status (when supplied) is merged
  // per type — no entry means unknown, not disconnected.
  fileToArray(file: IChannelsFile, status?: IChannelStatusFile): IAgentChannel[] {
    const out: IAgentChannel[] = [];
    const telegram = file.telegram;
    if (telegram?.botToken && !telegram.removed) {
      const live = status?.telegram;
      out.push({
        type: 'telegram',
        config: {
          botToken: telegram.botToken,
          botName: telegram.botName,
          adminIds: telegram.adminIds,
        },
        connected: live ? live.connected : null,
        statusReason: live?.error ?? null,
        statusUpdatedAt: live?.updatedAt ?? null,
      });
    }
    return out;
  }

  // Array → object. Last-wins per type — runtime allows one bot per
  // platform and the DTO already caps the array length.
  arrayToFile(channels: IAgentChannel[]): IChannelsFile {
    const file: IChannelsFile = {};
    for (const ch of channels) {
      if (ch.type === 'telegram') {
        file.telegram = {
          botToken: ch.config.botToken,
          botName: ch.config.botName,
          adminIds: ch.config.adminIds,
        };
      }
    }
    return file;
  }
}
