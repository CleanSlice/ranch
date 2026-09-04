import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from './attachment.constants';
import { IBridleAttachmentGateway } from './attachment.gateway';
import {
  extractDocumentText,
  isExtractableDocument,
} from './documentText.extractor';
import {
  BridleAttachmentKinds,
  BridlePartTypes,
  isReadableByAgent,
  resolveAttachmentKind,
  resolveAttachmentMimeType,
} from './bridle.types';
import type {
  BridlePart,
  IBridleAttachment,
  IBridleStoredAttachment,
} from './bridle.types';

export interface IUploadAttachmentInput {
  agentId: string;
  name: string;
  mimeType: string | undefined;
  body: Buffer;
}

/** Text plus the parts to append, produced by expanding attachment ids. */
export interface IExpandedAttachments {
  text: string;
  parts: BridlePart[];
  attachments: IBridleAttachment[];
}

/**
 * Everything the attachment feature actually decides: what may be uploaded,
 * what a stored file becomes on its way to the agent, and how much of a text
 * file the agent gets to see.
 *
 * The asymmetry between kinds is not arbitrary. The agent runtime folds image
 * parts into the model call and discards file parts before it, so an attached
 * document is only usable because its contents are inlined here. Binary files
 * we cannot decode travel as a named reference, and the UI says so up front
 * rather than letting someone discover it from a confused reply.
 */
@Injectable()
export class BridleAttachmentService {
  constructor(private readonly gateway: IBridleAttachmentGateway) {}

  /** Validate and store one upload, returning what the message will carry. */
  async upload(input: IUploadAttachmentInput): Promise<IBridleAttachment> {
    if (!input.body?.length) {
      throw new BadRequestException(`"${input.name}" is empty`);
    }
    if (input.body.length > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        `"${input.name}" is larger than the ${formatMb(MAX_ATTACHMENT_BYTES)} limit`,
      );
    }

    const mimeType = resolveAttachmentMimeType(input.mimeType, input.name);
    const kind = resolveAttachmentKind(mimeType);
    if (!kind) {
      throw new BadRequestException(
        `"${input.name}" is not a supported file type. ` +
          `Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    const { id } = await this.gateway.store({
      agentId: input.agentId,
      name: input.name,
      mimeType,
      body: input.body,
    });

    return {
      id,
      name: input.name,
      mimeType,
      size: input.body.length,
      kind,
      url: BridleAttachmentService.urlFor(input.agentId, id),
      readableByAgent: isReadableByAgent(kind, mimeType),
    };
  }

  /**
   * Turn attachment ids into the parts the agent receives, plus whatever text
   * had to be folded into the message for the agent to be able to read it.
   *
   * `baseText` comes back unchanged when nothing was inlined, so a message
   * with only images or only binaries reads exactly as the person typed it.
   */
  async expand(
    agentId: string,
    baseText: string,
    attachmentIds: string[] | undefined,
  ): Promise<IExpandedAttachments> {
    if (!attachmentIds?.length) {
      return { text: baseText, parts: [], attachments: [] };
    }
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(
        `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`,
      );
    }

    const parts: BridlePart[] = [];
    const attachments: IBridleAttachment[] = [];
    const textBlocks: string[] = [];
    let totalBytes = 0;

    for (const id of attachmentIds) {
      const stored = await this.gateway.fetch(agentId, id);
      if (!stored) {
        throw new BadRequestException(
          `Attachment ${id} is no longer available`,
        );
      }

      totalBytes += stored.size;
      if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
        throw new BadRequestException(
          `Attachments on one message must total less than ` +
            `${formatMb(MAX_MESSAGE_ATTACHMENT_BYTES)}`,
        );
      }

      // A file may claim a text type and hold undecodable bytes. Deciding the
      // effective kind here — after we have the bytes — is what keeps mojibake
      // out of the prompt.
      const kind = this.effectiveKind(stored);
      const url = BridleAttachmentService.urlFor(agentId, id);

      if (kind === BridleAttachmentKinds.Image) {
        parts.push({
          type: BridlePartTypes.Image,
          base64: stored.body.toString('base64'),
          mediaType: stored.mimeType,
        });
      } else {
        parts.push({
          type: BridlePartTypes.File,
          url,
          name: stored.name,
          mimeType: stored.mimeType,
        });
        if (kind === BridleAttachmentKinds.Text) {
          textBlocks.push(this.inlineTextBlock(stored));
        } else if (isExtractableDocument(stored.mimeType)) {
          // Office documents and PDFs get their text extracted and inlined
          // like any text attachment. A broken or text-less file (a scanned
          // PDF) degrades to the named-reference notice, never a failure.
          const extracted = await extractDocumentText(
            stored.mimeType,
            stored.body,
          );
          textBlocks.push(
            extracted !== null
              ? BridleAttachmentService.fencedBlock(stored.name, extracted)
              : BridleAttachmentService.binaryNoticeBlock(stored),
          );
        } else {
          // The runtime drops file parts before the model call, so without
          // this line the model never learns the file exists — it would deny
          // seeing an attachment the person is looking right at. The notice
          // names the file and its limits; the contents stay unread.
          textBlocks.push(BridleAttachmentService.binaryNoticeBlock(stored));
        }
      }

      attachments.push({
        id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        kind,
        url,
        readableByAgent: isReadableByAgent(kind, stored.mimeType),
      });
    }

    const text = textBlocks.length
      ? [baseText.trim(), ...textBlocks].filter(Boolean).join('\n\n')
      : baseText;

    return { text, parts, attachments };
  }

  /**
   * The kind we can actually honour, given the bytes in hand. A text-typed
   * file that fails a strict UTF-8 decode, or that carries NUL bytes, is
   * downgraded to `binary`: the agent gets a named reference instead of
   * garbage in its prompt.
   */
  private effectiveKind(
    stored: IBridleStoredAttachment,
  ): BridleAttachmentKinds {
    const declared = resolveAttachmentKind(stored.mimeType);
    if (declared !== BridleAttachmentKinds.Text) {
      return declared ?? BridleAttachmentKinds.Binary;
    }
    return decodeUtf8Strict(stored.body) === null
      ? BridleAttachmentKinds.Binary
      : BridleAttachmentKinds.Text;
  }

  /** The fenced block appended to the message for a text attachment. */
  private inlineTextBlock(stored: IBridleStoredAttachment): string {
    return BridleAttachmentService.fencedBlock(
      stored.name,
      decodeUtf8Strict(stored.body) ?? '',
    );
  }

  /** Fenced, truncation-capped block for any inlined attachment content. */
  static fencedBlock(name: string, content: string): string {
    const truncated = content.length > MAX_EXTRACTED_TEXT_CHARS;
    const body = truncated
      ? content.slice(0, MAX_EXTRACTED_TEXT_CHARS)
      : content;

    // Mirrors the runtime's own wording for truncated over-long user messages,
    // so the model meets one convention rather than two.
    const removed = content.length - MAX_EXTRACTED_TEXT_CHARS;
    const notice = truncated
      ? `\n\n[… ${removed.toLocaleString('en-US')} characters truncated — ` +
        `attached file was longer than the ` +
        `${MAX_EXTRACTED_TEXT_CHARS.toLocaleString('en-US')}-character limit …]`
      : '';

    const fence = '```';
    return `[Attached file: ${name}]\n${fence}\n${body}${notice}\n${fence}`;
  }

  /**
   * What the model is told about a binary attachment: name, type, size —
   * and that the contents are out of reach, so it answers honestly instead
   * of denying the file exists.
   */
  static binaryNoticeBlock(stored: IBridleStoredAttachment): string {
    return (
      `[Attached file: ${stored.name} ` +
      `(${stored.mimeType}, ${stored.size.toLocaleString('en-US')} bytes). ` +
      `Its contents are not readable in this chat — it is delivered as a ` +
      `named reference only.]`
    );
  }

  /** Path of the authenticated download route — never an S3 URL. */
  static urlFor(agentId: string, attachmentId: string): string {
    return `/api/agent/${encodeURIComponent(agentId)}/attachment/${attachmentId}`;
  }
}

/**
 * Decode as UTF-8, refusing anything that is not valid. Node's default decoder
 * replaces bad bytes with U+FFFD, which would quietly turn a JPEG into a page
 * of question marks — exactly what this guards against. NUL bytes count as
 * binary too: legal UTF-8, but a reliable sign the file is not text.
 */
function decodeUtf8Strict(body: Buffer): string | null {
  // A zero byte is legal UTF-8 but a reliable sign the file is not text.
  // Checked on the buffer rather than the decoded string, so no escape
  // sequence has to survive a round-trip through tooling.
  if (body.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
