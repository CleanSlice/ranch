import {
  BridleAttachmentKinds,
  type IBridleAttachment,
  type IBridleReply,
} from '../domain/bridle.types';

/**
 * Maps the agent runtime's sync response onto the domain reply. The SDK types
 * this endpoint's body as `unknown`, so we defensively read the three fields
 * we care about and normalize `text` to a string. Time/id fallbacks are left to
 * the store (they depend on "now").
 */
export class BridleMapper {
  toReply(raw: unknown): IBridleReply {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      messageId: typeof o.messageId === 'string' ? o.messageId : null,
      text: typeof o.text === 'string' ? o.text : '',
      ts: typeof o.ts === 'number' ? o.ts : null,
    };
  }

  /**
   * Maps the upload response onto the domain attachment. Defensive in the same
   * spirit as `toReply` — every field is checked rather than trusted, and an
   * unrecognized `kind` degrades to `binary`, which is the conservative
   * outcome: the UI will say the agent can't read it rather than promise that
   * it can.
   */
  toAttachment(raw: unknown): IBridleAttachment {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const kind = this.toKind(o.kind);
    return {
      id: typeof o.id === 'string' ? o.id : '',
      name: typeof o.name === 'string' ? o.name : '',
      mimeType:
        typeof o.mimeType === 'string' ? o.mimeType : 'application/octet-stream',
      size: typeof o.size === 'number' ? o.size : 0,
      kind,
      url: typeof o.url === 'string' ? o.url : '',
      readableByAgent:
        typeof o.readableByAgent === 'boolean'
          ? o.readableByAgent
          : kind !== BridleAttachmentKinds.Binary,
    };
  }

  private toKind(raw: unknown): BridleAttachmentKinds {
    switch (raw) {
      case BridleAttachmentKinds.Image:
        return BridleAttachmentKinds.Image;
      case BridleAttachmentKinds.Text:
        return BridleAttachmentKinds.Text;
      default:
        return BridleAttachmentKinds.Binary;
    }
  }
}
