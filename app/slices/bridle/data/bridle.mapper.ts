import {
  BridleAttachmentKinds,
  BridleThinkingStepStates,
  type IBridleAttachment,
  type IBridleReply,
  type IBridleThinkingEvent,
  type IBridleThinkingStep,
} from '../domain/bridle.types';

/**
 * Maps hub socket frames onto domain objects. Frames are untyped on the wire,
 * so every field is checked rather than trusted and `text` is normalized to a
 * string. Time/id fallbacks are left to the store (they depend on "now").
 */
export class BridleMapper {
  /** `message`, `stream` and `stream_end` all carry this shape. */
  toReply(raw: unknown): IBridleReply {
    const o = asRecord(raw);
    return {
      messageId: typeof o.messageId === 'string' ? o.messageId : null,
      text: typeof o.text === 'string' ? o.text : '',
      ts: typeof o.ts === 'number' ? o.ts : null,
    };
  }

  /**
   * A `thinking` frame, or null when it names no turn — the store keys every
   * block by turn, so a frame without one could only corrupt the timeline.
   */
  toThinkingEvent(raw: unknown): IBridleThinkingEvent | null {
    const o = asRecord(raw);
    if (typeof o.turnId !== 'string' || !o.turnId) return null;
    const step = this.toThinkingStep(o.step);
    return {
      turnId: o.turnId,
      ...(step ? { step } : {}),
      ...(o.done === true ? { done: true } : {}),
      ts: typeof o.ts === 'number' ? o.ts : Date.now(),
    };
  }

  private toThinkingStep(raw: unknown): IBridleThinkingStep | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) return null;
    return {
      id: o.id,
      label: typeof o.label === 'string' ? o.label : '',
      ...(typeof o.detail === 'string' && o.detail ? { detail: o.detail } : {}),
      // Anything but an explicit `done` is still running: a step that is
      // mislabelled as finished would stop shimmering while the tool runs.
      state:
        o.state === BridleThinkingStepStates.Done
          ? BridleThinkingStepStates.Done
          : BridleThinkingStepStates.Active,
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

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}
