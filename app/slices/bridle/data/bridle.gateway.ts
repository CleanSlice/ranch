// The generated SDK class is also named `BridleService`; alias it to `BridleApi`
// so it doesn't collide with the domain service of the same name.
import { BridleService as BridleApi } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IBridleGateway } from '../domain/bridle.gateway';
import type { IBridleReply } from '../domain/bridle.types';
import { BridleMapper } from './bridle.mapper';

export class BridleGateway extends BaseGateway implements IBridleGateway {
  private mapper = new BridleMapper();

  sendMessage(agentId: string, text: string): Promise<IBridleReply> {
    return this.execute(async () => {
      const res = await BridleApi.sendBridleMessageSync({
        path: { agentId },
        body: { text },
      });
      return this.mapper.toReply(unwrapEnvelope(res.data));
    });
  }
}
