import type { IBridleStoredAttachment } from './bridle.types';

export interface IStoreAttachmentInput {
  agentId: string;
  /** Original filename, kept for display only — never used to build a key. */
  name: string;
  mimeType: string;
  body: Buffer;
}

/**
 * Storage contract for chat attachments. The data layer implements it over
 * S3; the service and controller depend only on this abstraction.
 *
 * Deliberately NOT `IFileGateway`: that interface is string-typed end to end
 * (`save(agentId, path, content: string)`), so routing a PNG or a PDF through
 * it would round-trip binary data as UTF-8 and corrupt it.
 */
export abstract class IBridleAttachmentGateway {
  /** Persist the bytes and return the id the message will carry. */
  abstract store(input: IStoreAttachmentInput): Promise<{ id: string }>;

  /** Read an attachment back. Returns null when the object is gone. */
  abstract fetch(
    agentId: string,
    attachmentId: string,
  ): Promise<IBridleStoredAttachment | null>;
}
