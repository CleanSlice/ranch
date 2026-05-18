import { Injectable } from '@nestjs/common';
import { IAgentChannel, IChannelsFile } from '../domain/agentChannel.types';

@Injectable()
export class AgentChannelMapper {
  // Object → array. Iterates known types so unknown keys in the file
  // (added by future runtime versions ahead of the API) don't blow up.
  fileToArray(file: IChannelsFile): IAgentChannel[] {
    const out: IAgentChannel[] = [];
    if (file.telegram?.botToken) {
      out.push({
        type: 'telegram',
        config: {
          botToken: file.telegram.botToken,
          botName: file.telegram.botName,
          adminIds: file.telegram.adminIds,
        },
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
