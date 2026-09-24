import type { TranscriptResponseDto } from '#api';
import type {
  IBridleProposalRow,
  IBridleProposalSnapshot,
  IBridleProposalUpdate,
} from '../domain/bridle.types';
import { mergeProposals, proposalMessageId, proposalTs } from '../utils/proposalMerge';
import {
  BridleAttachmentKinds,
  BridleRoleTypes,
  BridleThinkingStepStates,
  type IBridleAttachment,
  type IBridleMessage,
  type IBridleReply,
  type IBridleSendAck,
  type IBridleThinkingEvent,
  type IBridleThinkingStep,
  type IBridleUserMessageEvent,
  type IBridleWelcome,
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
      ...seqOf(o),
    };
  }

  /**
   * The hub's per-identity sequence, carried by every hub → browser frame
   * (CLEAN-102). A hub that predates it sends none — the store then treats
   * the frame as live.
   */
  toSeq(raw: unknown): number | undefined {
    return seqOf(asRecord(raw)).seq;
  }

  toWelcome(raw: unknown): IBridleWelcome {
    const o = asRecord(raw);
    return {
      clientId: typeof o.clientId === 'string' && o.clientId ? o.clientId : null,
      seq: seqOf(o).seq ?? null,
    };
  }

  /**
   * The ack of one `message` emit. Anything that is not a well-formed verdict
   * counts as a rejection: showing "delivered" on the strength of a frame we
   * could not read is the one mistake the ack exists to prevent.
   */
  toSendAck(raw: unknown, clientMessageId: string): IBridleSendAck {
    const o = asRecord(raw);
    if (o.status === 'accepted') {
      return {
        status: 'accepted',
        messageId:
          typeof o.messageId === 'string' && o.messageId
            ? o.messageId
            : clientMessageId,
        ts: typeof o.ts === 'number' ? o.ts : Date.now(),
        ...(o.duplicate === true ? { duplicate: true as const } : {}),
      };
    }
    return {
      status: 'rejected',
      code: typeof o.code === 'string' && o.code ? o.code : 'UNKNOWN',
      ...(typeof o.message === 'string' && o.message
        ? { message: o.message }
        : {}),
    };
  }

  /** A `user_message` echo, or null when it names no message to match by. */
  toUserMessage(raw: unknown): IBridleUserMessageEvent | null {
    const o = asRecord(raw);
    if (typeof o.messageId !== 'string' || !o.messageId) return null;
    const attachments = Array.isArray(o.attachments)
      ? o.attachments.map((a) => this.toAttachment(a)).filter((a) => a.id)
      : [];
    return {
      messageId: o.messageId,
      text: typeof o.text === 'string' ? o.text : '',
      ts: typeof o.ts === 'number' ? o.ts : null,
      ...(attachments.length ? { attachments } : {}),
      ...seqOf(o),
    };
  }

  /**
   * A transcript page as conversation messages, oldest first as the API
   * returns them. Typed by the generated DTO — this one arrives over the SDK,
   * not as an untyped socket frame.
   */
  toTranscript(dto: TranscriptResponseDto | null): IBridleMessage[] {
    const messages: IBridleMessage[] = (dto?.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role === 'user' ? BridleRoleTypes.User : BridleRoleTypes.Agent,
      text: m.text,
      ts: m.ts,
    }));
    // Proposal cards (CLEAN-112) take their place by creation time.
    const proposals = ((dto as { proposals?: unknown[] } | null)?.proposals ?? [])
      .map((p) => this.toProposal(p))
      .filter((p): p is IBridleProposalSnapshot => p !== null);
    const byId = new Map(proposals.map((p) => [p.id, p]));
    return mergeProposals(messages, proposals, (p) =>
      this.toProposalMessage(byId.get(p.id) as IBridleProposalSnapshot),
    );
  }

  /** The bubble that carries one proposal card. */
  toProposalMessage(proposal: IBridleProposalSnapshot): IBridleMessage {
    return {
      id: proposalMessageId(proposal.id),
      role: BridleRoleTypes.Agent,
      text: '',
      ts: proposalTs(proposal),
      proposal,
    };
  }

  toProposal(raw: unknown): IBridleProposalSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) return null;
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const nnum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const nstr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const statuses = ['pending', 'applied', 'skipped', 'stale', 'refused'] as const;
    const summary = o.summary && typeof o.summary === 'object' ? (o.summary as Record<string, unknown>) : null;
    const counts = summary?.counts && typeof summary.counts === 'object' ? (summary.counts as Record<string, unknown>) : null;
    const actions = ['add', 'change', 'unchanged', 'remove', 'skip'] as const;
    const rows: IBridleProposalRow[] = Array.isArray(summary?.rows)
      ? summary.rows
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .filter((r) => typeof r.path === 'string')
          .map((r) => ({
            path: r.path as string,
            action: actions.includes(r.action as (typeof actions)[number])
              ? (r.action as (typeof actions)[number])
              : 'unchanged',
            size: num(r.size),
          }))
      : [];
    return {
      id: o.id,
      agentId: typeof o.agentId === 'string' ? o.agentId : '',
      agentName: typeof o.agentName === 'string' ? o.agentName : '',
      kind: o.kind === 'set' ? 'set' : 'single',
      op: o.op === 'create' ? 'create' : o.op === 'import' ? 'import' : 'write',
      path: nstr(o.path),
      mode: o.mode === 'replace' ? 'replace' : o.mode === 'merge' ? 'merge' : null,
      proposedBytes: num(o.proposedBytes),
      diffStatus:
        o.diffStatus === 'too_large' || o.diffStatus === 'binary' || o.diffStatus === 'none'
          ? o.diffStatus
          : 'ok',
      additions: nnum(o.additions),
      deletions: nnum(o.deletions),
      changedLines: nnum(o.changedLines),
      firstChangedLine: nnum(o.firstChangedLine),
      inlineDiff: nstr(o.inlineDiff),
      counts: counts
        ? {
            add: num(counts.add),
            change: num(counts.change),
            unchanged: num(counts.unchanged),
            remove: num(counts.remove),
            skip: num(counts.skip),
          }
        : null,
      rows,
      more: num(summary?.more),
      status: statuses.includes(o.status as (typeof statuses)[number])
        ? (o.status as (typeof statuses)[number])
        : 'pending',
      actedAt: nstr(o.actedAt),
      reason: nstr(o.reason),
      restartRequired: o.restartRequired === true,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    };
  }

  toProposalUpdate(raw: unknown): IBridleProposalUpdate | null {
    const o = asRecord(raw);
    if (typeof o.proposalId !== 'string' || !o.proposalId) return null;
    const statuses = ['pending', 'applied', 'skipped', 'stale', 'refused'] as const;
    if (!statuses.includes(o.status as (typeof statuses)[number])) return null;
    return {
      proposalId: o.proposalId,
      status: o.status as (typeof statuses)[number],
      actedAt: typeof o.actedAt === 'number' ? o.actedAt : Date.now(),
      reason: typeof o.reason === 'string' ? o.reason : null,
      ...(typeof o.restartRequired === 'boolean' ? { restartRequired: o.restartRequired } : {}),
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
      ...seqOf(o),
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

/** Spreadable, so a frame without a `seq` yields no `seq` key at all. */
function seqOf(o: Record<string, unknown>): { seq?: number } {
  return typeof o.seq === 'number' && Number.isFinite(o.seq)
    ? { seq: o.seq }
    : {};
}
