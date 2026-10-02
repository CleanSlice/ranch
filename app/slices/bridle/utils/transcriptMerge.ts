// What a person sees after the conversation is loaded from the server
// (CLEAN-136). The transcript is the conversation; what the browser holds is
// only what the server does not have yet. Pure on purpose: no Vue, no Nuxt
// aliases, so `bun test` runs it — and written with index loops, because
// `bun test` 1.3 on Windows crashes on the for-of + while shape.
//
// Twin of `loadTranscript` in admin/slices/bridle/stores/bridle.ts: the same
// order of decisions. Two things differ, both because this console keeps the
// whole conversation in the browser and the admin one keeps only an outbox:
// the stored-copy clause (UNSAVED_KEEP_MS), and a transcript message standing
// in for ONE message on screen, not for every message with the same words.

import {
  BridleDeliveryStates,
  BridleRoleTypes,
  type IBridleMessage,
  type IBridleTranscriptPage,
} from '../domain/bridle.types';

/**
 * How far apart in time a message on screen and a transcript message with the
 * same text may be and still be the same message. INTERIM, and the admin
 * console's value: the runtime does not store the wire message id, so an id
 * never matches today and the text has to. Goes away, in both consoles, when
 * the runtime persists message ids.
 */
export const PERSISTED_MATCH_WINDOW_MS = 2 * 60_000;

/**
 * How long a message from the browser's stored copy is trusted when the
 * transcript does not hold it. The hub's replay window (`REPLAY_MAX_AGE_MS`):
 * inside it the hub still says whether the conversation was reset
 * (`conversation_reset`), so the copy stands; beyond it the hub can no longer
 * tell, and a message "too fresh to have been saved" cannot be that old — it
 * belonged to a conversation that was closed while this browser was away.
 */
export const UNSAVED_KEEP_MS = 10 * 60_000;

export interface IMergedTranscript {
  /** The page, then what the server does not hold yet. Ordered by `seq`. */
  messages: IBridleMessage[];
  /**
   * The highest `seq` among the local messages the page took over, or null
   * when it took none. A finished thinking block at or below it belonged to a
   * turn that is plain transcript now.
   */
  cutSeq: number | null;
}

function isPending(message: IBridleMessage): boolean {
  return (
    message.delivery !== undefined &&
    message.delivery !== BridleDeliveryStates.Delivered
  );
}

/**
 * Merge the newest transcript page into what is on screen.
 *
 * `page === null` means the load failed: nothing on screen is contradicted,
 * so nothing changes.
 *
 * The page's messages are numbered below the kept local tail rather than from
 * 1, so everything that stays keeps its `seq` — and with it its place among
 * the session's thinking blocks, which this function never sees.
 */
export function mergeTranscript(
  local: readonly IBridleMessage[],
  page: IBridleTranscriptPage | null,
  now: number,
): IMergedTranscript {
  if (!page) return { messages: local.slice(), cutSeq: null };

  const source = page.messages;
  let tailTs = 0;
  const pageIds = new Set<string>();
  for (let i = 0; i < source.length; i++) {
    const message = source[i] as IBridleMessage;
    if (message.ts > tailTs) tailTs = message.ts;
    pageIds.add(message.id);
  }

  // A transcript message answers for one message on screen. Without this,
  // "ok" sent twice with one of them saved would lose the other.
  const taken = new Array<boolean>(source.length).fill(false);
  function takeMatch(message: IBridleMessage): boolean {
    for (let i = 0; i < source.length; i++) {
      if (taken[i]) continue;
      const candidate = source[i] as IBridleMessage;
      if (
        candidate.role === BridleRoleTypes.User &&
        candidate.text === message.text &&
        Math.abs(candidate.ts - message.ts) <= PERSISTED_MATCH_WINDOW_MS
      ) {
        taken[i] = true;
        return true;
      }
    }
    return false;
  }

  const kept: IBridleMessage[] = [];
  let cutSeq: number | null = null;
  for (let i = 0; i < local.length; i++) {
    const message = local[i] as IBridleMessage;
    if (keeps(message)) {
      kept.push(message);
    } else if (
      typeof message.seq === 'number' &&
      (cutSeq === null || message.seq > cutSeq)
    ) {
      cutSeq = message.seq;
    }
  }

  function keeps(message: IBridleMessage): boolean {
    if (pageIds.has(message.id)) return false;
    // In flight: the outbox and the answer being written are never the
    // server's to contradict.
    if (message.streaming) return true;
    if (message.role === BridleRoleTypes.User && isPending(message)) return true;

    const tooOldToBeUnsaved =
      message.cached === true && now - message.ts >= UNSAVED_KEEP_MS;

    if (message.role === BridleRoleTypes.Agent) {
      // Same clock as the transcript: newer than its tail means the runtime
      // has not saved it yet (it saves at the end of a turn).
      return message.ts > tailTs && !tooOldToBeUnsaved;
    }

    if (takeMatch(message)) return false;
    // A delivered message the page does not show is either further back than
    // the page reaches — an older page's — or not saved yet.
    return (
      message.ts >= tailTs - PERSISTED_MATCH_WINDOW_MS && !tooOldToBeUnsaved
    );
  }

  // The kept tail in the order it happened; anything without a `seq` last.
  const order = (seq?: number) => seq ?? Number.MAX_SAFE_INTEGER;
  kept.sort((a, b) => order(a.seq) - order(b.seq));

  // Where the page ends: just below the first thing that stays, and above
  // nothing the page took over.
  let floor = cutSeq === null ? 1 : cutSeq + 1;
  for (let i = 0; i < kept.length; i++) {
    const seq = (kept[i] as IBridleMessage).seq;
    if (typeof seq === 'number' && seq < floor) floor = seq;
  }

  const messages: IBridleMessage[] = [];
  for (let i = 0; i < source.length; i++) {
    messages.push({
      ...(source[i] as IBridleMessage),
      seq: floor - source.length + i,
    });
  }
  let next = floor;
  for (let i = 0; i < kept.length; i++) {
    const message = kept[i] as IBridleMessage;
    if (typeof message.seq === 'number') {
      messages.push(message);
      if (message.seq >= next) next = message.seq + 1;
    } else {
      messages.push({ ...message, seq: next });
      next += 1;
    }
  }
  return { messages, cutSeq };
}
