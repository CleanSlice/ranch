import type { IBridleGateway } from './bridle.gateway';
import type {
  IBridleAttachment,
  IBridleReply,
  IBridleShareContext,
} from './bridle.types';

/**
 * Domain service for the live agent chat. Exposes the send and upload
 * use-cases; the store layers conversation state, optimistic updates and
 * persistence on top. Named after the slice — the generated `#api` SDK class
 * of the same name is imported under an alias in the data gateway to avoid
 * the collision.
 *
 * `share` is the share-link visitor's credentials, forwarded verbatim to the
 * gateway. The console never passes it.
 */
export class BridleService {
  constructor(private gateway: IBridleGateway) {}

  sendMessage(
    agentId: string,
    text: string,
    attachmentIds?: string[],
    share?: IBridleShareContext,
  ): Promise<IBridleReply> {
    return this.gateway.sendMessage(agentId, text, attachmentIds, share);
  }

  uploadAttachment(
    agentId: string,
    file: File,
    onProgress?: (percent: number) => void,
    share?: IBridleShareContext,
  ): Promise<IBridleAttachment> {
    return this.gateway.uploadAttachment(agentId, file, onProgress, share);
  }

  fetchAttachment(
    agentId: string,
    attachmentId: string,
    share?: IBridleShareContext,
  ): Promise<Blob> {
    return this.gateway.fetchAttachment(agentId, attachmentId, share);
  }
}
