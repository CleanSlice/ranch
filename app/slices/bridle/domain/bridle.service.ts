import type { IBridleGateway } from './bridle.gateway';
import type { IBridleAttachment, IBridleReply } from './bridle.types';

/**
 * Domain service for the live agent chat. Exposes the send and upload
 * use-cases; the store layers conversation state, optimistic updates and
 * persistence on top. Named after the slice — the generated `#api` SDK class
 * of the same name is imported under an alias in the data gateway to avoid
 * the collision.
 */
export class BridleService {
  constructor(private gateway: IBridleGateway) {}

  sendMessage(
    agentId: string,
    text: string,
    attachmentIds?: string[],
  ): Promise<IBridleReply> {
    return this.gateway.sendMessage(agentId, text, attachmentIds);
  }

  uploadAttachment(
    agentId: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<IBridleAttachment> {
    return this.gateway.uploadAttachment(agentId, file, onProgress);
  }
}
