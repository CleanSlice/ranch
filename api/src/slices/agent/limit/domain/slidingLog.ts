import {
  IAgentLimits,
  LIMIT_WINDOWS,
  LimitDecision,
  LimitWindow,
  WINDOW_MS,
  limitFor,
} from './agentLimit.types';

/**
 * Exact sliding-window counting over a log of accepted-request timestamps
 * (ascending, epoch ms). Pure functions: the service owns the array and the
 * clock.
 *
 * Why a log and not a counter per clock minute: "N per minute" has to hold
 * for ANY sixty seconds, not for the ones that happen to start at :00. A
 * fixed window lets 2×N through around the boundary.
 *
 * The log never needs more than the largest configured limit: whether a
 * window with limit L is full depends only on the L-th most recent entry.
 */

/** The longest window that has a limit, or 0 when none has. */
export function longestWindowMs(limits: IAgentLimits | null): number {
  let longest = 0;
  for (const w of LIMIT_WINDOWS) {
    if (limitFor(limits, w) !== null) longest = Math.max(longest, WINDOW_MS[w]);
  }
  return longest;
}

/** The largest configured limit, or 0 when none is configured. */
export function largestLimit(limits: IAgentLimits | null): number {
  let largest = 0;
  for (const w of LIMIT_WINDOWS) {
    largest = Math.max(largest, limitFor(limits, w) ?? 0);
  }
  return largest;
}

/** Index of the first entry strictly newer than `t`. */
function firstAfter(log: number[], t: number): number {
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (log[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Accepted requests in the `windowMs` that end at `now`. */
export function countIn(log: number[], now: number, windowMs: number): number {
  return log.length - firstAfter(log, now - windowMs);
}

/**
 * Drop what no configured window can still see, and anything beyond the
 * largest limit. Mutates `log`.
 */
export function trim(
  log: number[],
  limits: IAgentLimits | null,
  now: number,
): void {
  const longest = longestWindowMs(limits);
  if (longest === 0) {
    log.length = 0;
    return;
  }
  let drop = firstAfter(log, now - longest);
  const cap = largestLimit(limits);
  if (log.length - drop > cap) drop = log.length - cap;
  if (drop > 0) log.splice(0, drop);
}

/**
 * Would a request at `now` be accepted? Does not record it.
 *
 * A window with limit L is full when the L-th most recent accepted request is
 * still inside it; it has room again the moment that one request leaves. The
 * reported wait is the longest among all full windows, so the countdown a
 * person is shown never ends in a refusal by another window.
 */
export function decide(
  log: number[],
  limits: IAgentLimits | null,
  now: number,
  windows: readonly LimitWindow[] = LIMIT_WINDOWS,
): LimitDecision {
  let retryAfterMs = 0;
  let by: LimitWindow | null = null;
  for (const w of windows) {
    const limit = limitFor(limits, w);
    if (limit === null || log.length < limit) continue;
    const mustLeave = log[log.length - limit];
    const wait = mustLeave + WINDOW_MS[w] - now;
    if (wait > retryAfterMs) {
      retryAfterMs = wait;
      by = w;
    }
  }
  if (by === null) return { admitted: true };
  return { admitted: false, retryAfterMs: Math.ceil(retryAfterMs), window: by };
}

/** Record an accepted request. Mutates `log`. */
export function admit(log: number[], now: number): void {
  // The clock can step back (NTP); the log must stay ascending for the
  // binary search, so a late timestamp is clamped to the newest one.
  const last = log.length ? log[log.length - 1] : 0;
  log.push(now < last ? last : now);
}

/**
 * Rebuild a log from per-minute counts — after a restart, or when limits are
 * switched on for an agent that already has traffic.
 *
 * Each minute's requests are placed at the END of that minute (never in the
 * future). That can only make them look more recent than they were, so a
 * restart never hands out allowance that was already spent; the price is a
 * wait overstated by up to a minute, once.
 */
export function rebuild(
  minutes: ReadonlyArray<{ minute: number; accepted: number }>,
  limits: IAgentLimits | null,
  now: number,
): number[] {
  const longest = longestWindowMs(limits);
  const cap = largestLimit(limits);
  if (longest === 0 || cap === 0) return [];
  const recent = minutes
    .map((m) => ({
      at: Math.min(m.minute + 60_000 - 1, now),
      accepted: m.accepted,
    }))
    .filter((m) => m.accepted > 0 && m.at > now - longest)
    .sort((a, b) => b.at - a.at);
  // Newest first, stopping at the cap: older entries cannot change a decision.
  const log: number[] = [];
  for (const m of recent) {
    const take = Math.min(m.accepted, cap - log.length);
    for (let i = 0; i < take; i++) log.push(m.at);
    if (log.length >= cap) break;
  }
  return log.reverse();
}
