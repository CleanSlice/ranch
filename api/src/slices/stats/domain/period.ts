// What a period is, and which day an hour belongs to (CLEAN-261; spec 038,
// contracts/collection.md section 7).
//
// Personal figures are cut on the viewer's days, installation figures on UTC
// days. Activity is stored by UTC hour, so both come down to the same
// questions: where does a local day begin, and on which local day does an
// instant fall. Everything here answers those two and nothing else: no Nest,
// no database, no clock of its own except where a parameter says so.
//
// A day is passed around as its calendar date, `YYYY-MM-DD`, in the zone it
// was computed for. Every function that takes a zone expects one that went
// through `resolveZone`; an unknown name makes `Intl` throw a RangeError.

/** The periods a statistics view can be asked for, in days. */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

/** The zone of every installation figure, and the fallback for a personal one. */
export const UTC_ZONE = 'UTC';

export interface IPeriodRange {
  /** Start of the first day of the period. Inclusive. */
  from: Date;
  /** The moment the view was asked for: the period includes today so far. */
  to: Date;
  /**
   * Start of the period before this one, which ends where this one starts:
   * the comparison is `[previousFrom, from)` against `[from, to]`.
   */
  previousFrom: Date;
}

/** The part of an activity row that day arithmetic needs. */
export interface IHourRow {
  /** Start of the hour, UTC. */
  hour: Date;
  sessionId: string;
  userMessages: number;
  agentMessages: number;
}

export interface IDayBucket {
  /** `YYYY-MM-DD` in the zone the buckets were made for. */
  day: string;
  /** Distinct conversations written in on that day. */
  conversations: number;
  userMessages: number;
  agentMessages: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A zone name starts with a letter: `Europe/Kyiv`, `Etc/GMT+3`, `UTC`. Newer
// Node versions also accept a bare offset such as `+03:00` as a time zone.
// It is refused here because it is not a zone (it has no DST, so it would cut
// half the year's days an hour off) and because older Node versions throw on
// it, so the answer would depend on the runtime.
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+/-]*$/;

// The longest name in the IANA database is 32 characters
// (`America/Argentina/ComodRivadavia`). Twice that leaves room for a future
// name and keeps an arbitrary query-string value away from `Intl`.
const ZONE_NAME_MAX = 64;

// Building a formatter costs far more than using one, and a view formats
// every hour row of 13 weeks. People of one installation live in a handful of
// zones, so a handful of entries is the normal case. The cap is there because
// `Intl` ignores case in a zone name: one zone can arrive under many
// spellings, and the map must not grow with what callers send.
const FORMATTER_CACHE_MAX = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached) return cached;
  // The locale only fixes the digits; the parts are read by type, never as
  // text. `h23` is stated because a 24-hour en-US clock without it writes
  // midnight as hour 24 on some runtimes.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (formatters.size >= FORMATTER_CACHE_MAX) formatters.clear();
  formatters.set(zone, formatter);
  return formatter;
}

interface IWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What a clock on the wall in `zone` shows at `instant`. */
function wallClock(instant: Date, zone: string): IWallClock {
  const clock: IWallClock = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  };
  for (const part of formatterFor(zone).formatToParts(instant)) {
    if (part.type in clock) {
      clock[part.type as keyof IWallClock] = Number(part.value);
    }
  }
  return clock;
}

/** How far `zone` is ahead of UTC at `instantMs`, in milliseconds. */
function offsetMs(instantMs: number, zone: string): number {
  const c = wallClock(new Date(instantMs), zone);
  const asUtc = Date.UTC(
    c.year,
    c.month - 1,
    c.day,
    c.hour,
    c.minute,
    c.second,
  );
  // The wall clock has no milliseconds, so compare whole seconds.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function dayKey(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The UTC midnight that carries the same calendar date as `day`. */
function dayAsUtc(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError(`Not a day (YYYY-MM-DD): ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * The zone to cut a person's days in: what the browser sent when it names a
 * zone this runtime knows, UTC otherwise. The name is returned as it was
 * given, not as `Intl` canonicalises it (which still answers `Europe/Kiev`
 * for `Europe/Kyiv`), because the response says which zone was used and the
 * page compares that with its own.
 */
export function resolveZone(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > ZONE_NAME_MAX ||
    !ZONE_NAME.test(input)
  ) {
    return UTC_ZONE;
  }
  try {
    formatterFor(input);
    return input;
  } catch {
    return UTC_ZONE;
  }
}

/**
 * The calendar date in `zone` at `instant`. For an activity row the instant
 * is the start of its UTC hour, so in a zone with a half-hour or 45-minute
 * offset the hour that straddles local midnight goes whole to the day it
 * starts in. That is the known limit of hourly rows (research R3).
 */
export function localDay(instant: Date, zone: string): string {
  const c = wallClock(instant, zone);
  return dayKey(c.year, c.month, c.day);
}

/** The day `n` days after `day` (before it, for a negative `n`). */
export function shiftDay(day: string, n: number): string {
  const d = new Date(dayAsUtc(day) + n * DAY_MS);
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Day of the week of a calendar date, Monday = 0 … Sunday = 6. */
export function weekdayOf(day: string): number {
  // getUTCDay counts from Sunday.
  return (new Date(dayAsUtc(day)).getUTCDay() + 6) % 7;
}

/**
 * The first instant of `day` in `zone`.
 *
 * The date read as UTC is off by the zone's offset, and the offset is not
 * known until the instant is. So take the offset a day before and a day
 * after, which are the two it can have on either side of a clock change
 * near that midnight, and keep the earliest of the two resulting instants
 * that really falls on the day. That also covers the zones that change
 * their clocks at midnight itself, where 00:00 does not exist and the day
 * begins at 01:00 (Beirut), or where it comes round twice.
 */
export function startOfDay(day: string, zone: string): Date {
  const asUtc = dayAsUtc(day);
  const candidates = [
    asUtc - offsetMs(asUtc - DAY_MS, zone),
    asUtc - offsetMs(asUtc + DAY_MS, zone),
  ].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (localDay(new Date(candidate), zone) === day) return new Date(candidate);
  }
  return new Date(candidates[0]);
}

/**
 * A period of N days as one person sees it: from the start of their local
 * day N−1 days ago to now, so today counts as a day of the period. The
 * previous period is the N local days before that. Days are local, so a
 * period that crosses a clock change is an hour shorter or longer than
 * N × 24 hours.
 */
export function personalRange(
  period: Period,
  zone: string,
  now: Date,
): IPeriodRange {
  const firstDay = shiftDay(localDay(now, zone), -(period - 1));
  return {
    from: startOfDay(firstDay, zone),
    to: new Date(now.getTime()),
    previousFrom: startOfDay(shiftDay(firstDay, -period), zone),
  };
}

/**
 * The same period for an installation: UTC days, whoever is looking. Spend
 * (`Usage.date`) and refusals (`AgentLoadDay.day`) are already kept on that
 * boundary, and it is the only one on which two administrators in different
 * zones see the same number.
 */
export function installationRange(period: Period, now: Date): IPeriodRange {
  return personalRange(period, UTC_ZONE, now);
}

/**
 * Hour rows as days in `zone`: exactly `days` entries ending with the day
 * `now` falls on, oldest first, a day without activity present with zeros.
 * Rows outside those days are left out. A conversation written in on three
 * days counts on each of them, and once on a day however many of its hours
 * fall there.
 */
export function bucketByDay(
  rows: readonly IHourRow[],
  zone: string,
  days: number,
  now: Date = new Date(),
): IDayBucket[] {
  const today = localDay(now, zone);
  const buckets = new Map<string, IDayBucket>();
  const sessions = new Map<string, Set<string>>();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = shiftDay(today, -back);
    buckets.set(day, {
      day,
      conversations: 0,
      userMessages: 0,
      agentMessages: 0,
    });
    sessions.set(day, new Set());
  }

  // Rows of one hour share their day, and a busy person has many per hour.
  const dayOfHour = new Map<number, string>();
  for (const row of rows) {
    const hourMs = row.hour.getTime();
    let day = dayOfHour.get(hourMs);
    if (day === undefined) {
      day = localDay(row.hour, zone);
      dayOfHour.set(hourMs, day);
    }
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.userMessages += row.userMessages;
    bucket.agentMessages += row.agentMessages;
    sessions.get(day)?.add(row.sessionId);
  }

  for (const [day, bucket] of buckets) {
    bucket.conversations = sessions.get(day)?.size ?? 0;
  }
  return [...buckets.values()];
}
