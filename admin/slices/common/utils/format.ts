/**
 * The admin format module: the one place in `admin` where a date, a number or
 * a name order is turned into text.
 *
 * The admin console is English whatever the operator's browser says, so the
 * language is fixed here and is not a parameter. Nothing outside this file may
 * call `toLocale*String`, `Intl.*` or `localeCompare` — `bun run locale:check`
 * fails the build if something does.
 *
 * One format per kind of value: the table is in
 * specs/018-english-admin-locale/contracts/admin-format.md. A kind that is not
 * here gets a function here first; it is not formatted by hand in a component.
 *
 * Names are chosen so they do not collide with what slices already auto-import
 * (`formatCount`, `formatMessageTime`, `formatModified`, `formatBytes`).
 *
 * No Vue in here, so pure utilities can import it and be tested alone. Relative
 * time, which needs a live clock, is `composables/useRelativeTime.ts`.
 *
 * Logs, error details and anything else received from the server are not
 * values: they are shown as received and never pass through here.
 */
/** Month before day, matching the screens that were already English. */
export const ADMIN_LOCALE = 'en-US';
/** 24-hour clock, confirmed by the product owner (CLEAN-127). `h23` and not
 *  `hour12: false`, which is allowed to render midnight as `24:46`. */
const ADMIN_HOUR_CYCLE = 'h23';

export type Instant = string | number | Date | null | undefined;

export function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Explicit fields rather than `dateStyle` / `timeStyle`: the styles cannot be
// combined with `hourCycle` in every engine, the fields can.
const DAY = { year: 'numeric', month: 'short', day: 'numeric' } as const;
const MONTH_DAY = { month: 'short', day: 'numeric' } as const;
const CLOCK = { hour: '2-digit', minute: '2-digit', hourCycle: ADMIN_HOUR_CYCLE } as const;

const DATE_KINDS = {
  date: DAY,
  dateTime: { ...DAY, ...CLOCK },
  clock: CLOCK,
  clockSeconds: { ...CLOCK, second: '2-digit' },
  monthDay: MONTH_DAY,
  monthDayClock: { ...MONTH_DAY, ...CLOCK },
  longDate: { year: 'numeric', month: 'long', day: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

type DateKind = keyof typeof DATE_KINDS;

// Building a formatter is the expensive part and a file tree or a chat renders
// one value per row, so each is built once. There is nothing to go stale: the
// language never changes.
const dateFormats = new Map<DateKind, Intl.DateTimeFormat>();

function format(kind: DateKind, value: Instant): string {
  const date = toDate(value);
  if (!date) return '';
  let formatter = dateFormats.get(kind);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(ADMIN_LOCALE, DATE_KINDS[kind]);
    dateFormats.set(kind, formatter);
  }
  return formatter.format(date);
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// ------------------------------------------------------------------- dates

/** `Aug 21, 2026` — table columns, "created", "expires". */
export const formatDate = (value: Instant): string => format('date', value);

/** `Aug 21, 2026, 00:46` — "last synced", "last modified", tooltips. */
export const formatDateTime = (value: Instant): string => format('dateTime', value);

/** `00:46` — "saved at", a rate-limit reset. */
export const formatClock = (value: Instant): string => format('clock', value);

/** `00:46:12` — the debug panel, anything read next to a log. */
export const formatClockSeconds = (value: Instant): string => format('clockSeconds', value);

/** `August 21, 2026` — the line between days in a chat. */
export const formatLongDate = (value: Instant): string => format('longDate', value);

/**
 * When something was said: `00:46` today, `Aug 21, 00:46` earlier this year,
 * `Aug 21, 2026, 00:46` before that. The day is the viewer's own.
 */
export function formatStamp(value: Instant, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  if (sameDay(date, now)) return format('clock', date);
  return format(date.getFullYear() === now.getFullYear() ? 'monthDayClock' : 'dateTime', date);
}

/**
 * When something was last touched, for dense rows: `00:46` today, `Aug 21`
 * earlier this year, `Aug 21, 2026` before that.
 */
export function formatStampDate(value: Instant, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  if (sameDay(date, now)) return format('clock', date);
  return format(date.getFullYear() === now.getFullYear() ? 'monthDay' : 'date', date);
}

// ----------------------------------------------------------------- numbers

const numberFormat = new Intl.NumberFormat(ADMIN_LOCALE);
const moneyFormats = new Map<number, Intl.NumberFormat>();

function moneyFormat(maxDecimals: number): Intl.NumberFormat {
  let formatter = moneyFormats.get(maxDecimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat(ADMIN_LOCALE, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: maxDecimals,
    });
    moneyFormats.set(maxDecimals, formatter);
  }
  return formatter;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** `1,234,567` — tokens, files, rows. */
export const formatNumber = (value: number | null | undefined): string =>
  isNumber(value) ? numberFormat.format(value) : '';

/**
 * `$1,234.50` — cost. `maxDecimals` is for token prices, where a request costs
 * `$0.0012` and two decimals would print every one of them as `$0.00`.
 */
export const formatMoney = (value: number | null | undefined, maxDecimals = 2): string =>
  isNumber(value) ? moneyFormat(Math.max(2, maxDecimals)).format(value) : '';

// ------------------------------------------------------------------- order

const collator = new Intl.Collator(ADMIN_LOCALE);

/** Name order, the same for every operator: `a` before `B` before `c`. */
export const compareText = (a: string, b: string): number => collator.compare(a, b);

/** Earliest first, by the instant and not by its text. Unreadable sorts first. */
export function compareInstants(a: Instant, b: Instant): number {
  const x = toDate(a)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const y = toDate(b)?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}
