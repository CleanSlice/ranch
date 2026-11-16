// What the limit notice shows for a remaining wait (CLEAN-224,
// specs/030-agent-request-limits/spec.md, "What it says"). Pure on purpose:
// no Vue, no Nuxt aliases, so `bun test` runs it. It decides the KIND of time
// and, for a countdown, its digits; a time of day leaves here as an instant
// and is written in the reader's language by the format module
// (`useFormat().clock`) where it is shown (docs/i18n.md).

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_SECONDS = 3600;

export type ILimitTimeView =
  /** The wait is over. */
  | { kind: 'ready' }
  /** Under an hour: `m:ss`, ticking. */
  | { kind: 'countdown'; text: string }
  /** An hour or more, ending today: `at` is the moment, epoch ms. */
  | { kind: 'clock'; at: number }
  /** Ending on the next local day. */
  | { kind: 'tomorrow'; at: number };

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * `remainingMs` comes from the monotonic clock the store keeps the limit on;
 * `now` is the wall clock (epoch ms), needed only to name a time of day.
 *
 * Everything rounds UP: a started second is shown whole, so the countdown
 * never reads `0:00` while a send would still be refused, and a time of day
 * is the first whole minute at or after the end, never one before it.
 */
export function limitTimeView(remainingMs: number, now: number): ILimitTimeView {
  if (!(remainingMs > 0)) return { kind: 'ready' };

  const seconds = Math.ceil(remainingMs / SECOND_MS);
  if (seconds < HOUR_SECONDS) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return { kind: 'countdown', text: `${m}:${s < 10 ? '0' : ''}${s}` };
  }

  const at = Math.ceil((now + remainingMs) / MINUTE_MS) * MINUTE_MS;
  return { kind: sameLocalDay(now, at) ? 'clock' : 'tomorrow', at };
}
