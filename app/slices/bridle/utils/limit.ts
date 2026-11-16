// The small decisions around an agent's request limit (CLEAN-224,
// specs/030-agent-request-limits). Pure on purpose: no Vue, no Nuxt aliases,
// so `bun test` runs it; the store, the mapper and the composer feed it.

import {
  BRIDLE_RATE_LIMITED,
  type BridleLimitWindows,
  type IBridleAgentLimitEvent,
  type IBridleLimit,
  type IBridleRateLimitedAck,
  type IBridleSendAck,
} from '../domain/bridle.types';

/**
 * What a refusal that names no usable wait is taken to mean. The contract
 * says `retryAfterMs` is always above zero; a frame that breaks it still has
 * to end in the calm notice and not in a red "not delivered", so it waits a
 * moment and lets the next send ask the hub again.
 */
export const LIMIT_FALLBACK_WAIT_MS = 1000;

/**
 * How long "You can send your message now." stays before the notice leaves:
 * long enough to read five words, short enough not to sit on the composer
 * (contracts/chat-notice.md — the only timing there that is a choice).
 */
export const LIMIT_READY_MS = 2000;

/**
 * How long a reconnected chat waits for the hub to repeat an hour or day
 * limit before it concludes the limit was lifted while the socket was down.
 * The hub announces a full window right after `welcome`.
 */
export const LIMIT_RECHECK_MS = 2000;

function isWindow(value: unknown): value is BridleLimitWindows {
  return value === 'minute' || value === 'hour' || value === 'day';
}

function waitOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * The `RATE_LIMITED` ack out of a raw frame, or null when the frame is some
 * other rejection. A window the console does not know is read as the shortest
 * one: the wait itself is what the notice shows.
 */
export function toRateLimitedAck(
  raw: Record<string, unknown>,
): IBridleRateLimitedAck | null {
  if (raw.status !== 'rejected' || raw.code !== BRIDLE_RATE_LIMITED) return null;
  return {
    status: 'rejected',
    code: BRIDLE_RATE_LIMITED,
    retryAfterMs: waitOf(raw.retryAfterMs) ?? LIMIT_FALLBACK_WAIT_MS,
    window: isWindow(raw.window) ? raw.window : 'minute',
  };
}

/**
 * An `agent_limit` frame, or null when it cannot be read. `limited: true`
 * without a usable wait is unreadable: a notice with no end is worse than no
 * notice, and the person's own send will be told the real wait.
 */
export function toAgentLimitEvent(
  raw: Record<string, unknown>,
): IBridleAgentLimitEvent | null {
  if (raw.limited === false) return { limited: false };
  if (raw.limited !== true) return null;
  const retryAfterMs = waitOf(raw.retryAfterMs);
  if (retryAfterMs === null) return null;
  return {
    limited: true,
    retryAfterMs,
    window: isWindow(raw.window) ? raw.window : 'hour',
  };
}

/** Narrowing by the fields, because every other rejection's `code` is a string too. */
export function isRateLimitedAck(
  ack: IBridleSendAck,
): ack is IBridleRateLimitedAck {
  return (
    ack.status === 'rejected' &&
    ack.code === BRIDLE_RATE_LIMITED &&
    'retryAfterMs' in ack
  );
}

/** The limit a wait announced at `now` (the monotonic clock) stands for. */
export function limitFrom(
  now: number,
  retryAfterMs: number,
  window: BridleLimitWindows,
): IBridleLimit {
  return { until: now + retryAfterMs, window };
}

/** How much of the wait is left; zero once it has passed, or with no limit. */
export function limitRemainingMs(
  limit: IBridleLimit | null | undefined,
  now: number,
): number {
  if (!limit) return 0;
  return Math.max(0, limit.until - now);
}

export function isLimitActive(
  limit: IBridleLimit | null | undefined,
  now: number,
): boolean {
  return limitRemainingMs(limit, now) > 0;
}

/**
 * The composer's text after a refused message comes back to it. Usually the
 * field is empty — it was cleared at send, a moment ago. If the person has
 * already started the next thought, the refused text goes above it: nothing
 * they wrote is lost and the order they wrote it in is kept.
 */
export function restoredDraft(refused: string, current: string): string {
  if (!refused) return current;
  if (!current.trim()) return refused;
  return `${refused}\n${current}`;
}

/**
 * How full the shrinking line is, 0..1. `totalMs` is the wait as it was first
 * seen by this view; a view that opened mid-wait starts its line full.
 */
export function limitFraction(remainingMs: number, totalMs: number): number {
  if (!(totalMs > 0) || !(remainingMs > 0)) return 0;
  return Math.min(1, remainingMs / totalMs);
}
