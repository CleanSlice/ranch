// How long something lasted, as a key and its numbers (CLEAN-265): the
// template turns that into words, so the unit and its place in the sentence
// belong to the locale file. Pure on purpose: no Vue, no Nuxt aliases, so
// `bun test` runs it.

export interface ISpan {
  /** One of `stats.span.*`. */
  key: string;
  params: Record<string, number>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The time between two instants at the grain a reader of an incident needs:
 * minutes under an hour, hours and minutes under a day, days and hours
 * beyond. Rounded down, so "2 h" is never an incident of 1 h 59 min.
 *
 * Null when either end is missing or unreadable, and when the end is before
 * the start: no duration is better than a negative one.
 */
export function spanOf(
  from: Date | null | undefined,
  to: Date | null | undefined,
): ISpan | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  if (ms < MINUTE) return { key: 'stats.span.under_minute', params: {} };
  if (ms < HOUR) return { key: 'stats.span.minutes', params: { minutes: Math.floor(ms / MINUTE) } };
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes > 0
      ? { key: 'stats.span.hours_minutes', params: { hours, minutes } }
      : { key: 'stats.span.hours', params: { hours } };
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours > 0
    ? { key: 'stats.span.days_hours', params: { days, hours } }
    : { key: 'stats.span.days', params: { days } };
}
