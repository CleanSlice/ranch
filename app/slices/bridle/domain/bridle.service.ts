import type { IBridleGateway } from './bridle.gateway';
import type {
  IBridleAttachment,
  IBridleChannel,
  IBridleChannelAuth,
  IBridleChannelEvents,
  IBridleShareContext,
  IBridleSourceDocument,
  IBridleTranscriptPage,
} from './bridle.types';

/**
 * Domain service for the live agent chat. Exposes the channel and upload
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

  openChannel(
    agentId: string,
    auth: IBridleChannelAuth,
    events: IBridleChannelEvents,
  ): IBridleChannel {
    return this.gateway.openChannel(agentId, auth, events);
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

  transcriptPage(
    agentId: string,
    channel: string,
    cursor?: string | null,
    share?: IBridleShareContext,
  ): Promise<IBridleTranscriptPage> {
    return this.gateway.transcriptPage(agentId, channel, cursor, share);
  }

  openCitedSource(
    agentId: string,
    messageId: string,
    n: number,
    share?: IBridleShareContext,
  ): Promise<IBridleSourceDocument> {
    return this.gateway.openCitedSource(agentId, messageId, n, share);
  }

  /** `null` withdraws the reader's rating. */
  rateCitedSource(
    agentId: string,
    messageId: string,
    n: number,
    rating: 1 | -1 | null,
    share?: IBridleShareContext,
  ): Promise<void> {
    return rating === null
      ? this.gateway.unrateCitedSource(agentId, messageId, n, share)
      : this.gateway.rateCitedSource(agentId, messageId, n, rating, share);
  }

  archiveTranscript(
    agentId: string,
    channel: string,
    share?: IBridleShareContext,
  ): Promise<void> {
    return this.gateway.archiveTranscript(agentId, channel, share);
  }
}
