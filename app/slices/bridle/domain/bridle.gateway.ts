import type { IBridleAttachment, IBridleReply } from './bridle.types';

/**
 * Contract for talking to the agent runtime. The data layer implements it
 * (`BridleGateway`); the service and store depend only on this abstraction.
 */
export abstract class IBridleGateway {
  /**
   * Send a message. `attachmentIds` are ids returned by `uploadAttachment`;
   * the API expands them into the rich-content parts the agent receives.
   */
  abstract sendMessage(
    agentId: string,
    text: string,
    attachmentIds?: string[],
  ): Promise<IBridleReply>;

  /**
   * Store one file and return the metadata a message will carry.
   * `onProgress` reports 0-100 so a chip can show real progress rather than
   * an unexplained pause on a large file.
   */
  abstract uploadAttachment(
    agentId: string,
    file: File,
    onProgress?: (percent: number) => void,
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
  abstract fetchAttachment(agentId: string, attachmentId: string): Promise<Blob>;
}
