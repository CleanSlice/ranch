import type { IBridleGateway } from './bridle.gateway';
import type { IBridleReply } from './bridle.types';

/**
 * Domain service for the live agent chat. Exposes the send use-case; the store
 * layers conversation state, optimistic updates and persistence on top. Named
 * after the slice — the generated `#api` SDK class of the same name is imported
 * under an alias in the data gateway to avoid the collision.
 */
export class BridleService {
  constructor(private gateway: IBridleGateway) {}

  sendMessage(agentId: string, text: string): Promise<IBridleReply> {
    return this.gateway.sendMessage(agentId, text);
  }
}
