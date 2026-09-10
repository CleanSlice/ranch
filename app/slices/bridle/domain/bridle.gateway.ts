import type {
  IBridleAttachment,
  IBridleChannel,
  IBridleChannelAuth,
  IBridleChannelEvents,
  IBridleShareContext,
} from './bridle.types';

/**
 * Contract for talking to the agent runtime. The data layer implements it
 * (`BridleGateway`); the service and store depend only on this abstraction.
 *
 * Messages travel over a live channel (the hub's browser socket), which is
 * what carries the agent's `typing` / `thinking` / `stream` events — the
 * synchronous HTTP send never could. Attachments stay on HTTP: an upload
 * wants progress, a download wants bytes, and neither needs to be live.
 *
 * The HTTP calls take an optional `share`: on a public share-link page there
 * is no JWT, so the visitor's credentials travel per request. Omitted in the
 * console, where the Bearer interceptor already authenticates the caller.
 */
export abstract class IBridleGateway {
  /**
   * Open the live channel to one agent. Reconnects on its own after a network
   * drop; a hub rejection arrives as `onRejected` and is the caller's to act
   * on (renew and `reconnect()`, or give up and `close()`).
   */
  abstract openChannel(
    agentId: string,
    auth: IBridleChannelAuth,
    events: IBridleChannelEvents,
  ): IBridleChannel;

  /**
   * Store one file and return the metadata a message will carry.
   * `onProgress` reports 0-100 so a chip can show real progress rather than
   * an unexplained pause on a large file.
   */
  abstract uploadAttachment(
    agentId: string,
    file: File,
    onProgress?: (percent: number) => void,
    share?: IBridleShareContext,
  ): Promise<IBridleAttachment>;

  /**
   * Read a stored attachment back as bytes.
   *
   * The download route is behind the JWT guard, and a browser sends no
   * Authorization header for `<img src>` or a plain link — so the URL on
   * `IBridleAttachment` cannot be rendered directly. Fetching through the
   * API client (which carries the base URL and the Bearer interceptor) and
   * handing the UI an object URL is what makes an attachment visible.
   */
  abstract fetchAttachment(
    agentId: string,
    attachmentId: string,
    share?: IBridleShareContext,
  ): Promise<Blob>;
}
