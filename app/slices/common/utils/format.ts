/**
 * The app format module: the one place in `app` where a date, a number or a
 * size is turned into text.
 *
 * Every function takes the language as its first argument and nothing here
 * asks the browser for one. Components reach it through `useFormat()`, which
 * supplies the console's active language; pure utilities that already carry a
 * `locale` parameter call it directly.
 *
 * Nothing outside this file may call `toLocale*String`, `Intl.*` or
 * `localeCompare` — `bun run locale:check` fails the build if something does.
 *
 * Each language keeps its own conventions (English has AM/PM, Russian does
 * not): specs/018-english-admin-locale/contracts/app-format.md.
 *
 * Reasons, error details and anything else received from the server are not
 * values: they are shown as received and never pass through here.
 */

export type Instant = string | number | Date | null | undefined;

/** Translation key suffix for a size unit: `unit.b`, `unit.kb`, `unit.mb`. */
export type SizeUnit = 'b' | 'kb' | 'mb';

function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const CLOCK = { hour: '2-digit', minute: '2-digit' } as const;

const DATE_KINDS = {
  date: {},
  dateTime: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  },
  clock: CLOCK,
  monthDayClock: { month: 'short', day: 'numeric', ...CLOCK },
  stampTitle: { dateStyle: 'long', timeStyle: 'medium' },
  longDate: { dateStyle: 'long' },
  fullDate: { dateStyle: 'full' },
  dayMonth: { day: 'numeric', month: 'short' },
  // The three below format a calendar day or a name, not an instant. They are
  // read in UTC because they are built in UTC: the browser's zone must not
  // get a say in which day or which month it is.
  calendarDayMonth: { day: 'numeric', month: 'short', timeZone: 'UTC' },
  weekdayShort: { weekday: 'short', timeZone: 'UTC' },
  monthShort: { month: 'short', timeZone: 'UTC' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

type DateKind = keyof typeof DATE_KINDS;

// Building a formatter is the expensive part and a chat renders one value per
// message, so each is built once per language. A formatter for `ru` stays
// right for `ru`; switching language only picks a different one.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function format(locale: string, kind: DateKind, value: Instant): string {
  const date = toDate(value);
  if (!date) return '';
  const key = `${locale}|${kind}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, DATE_KINDS[kind]);
    dateFormats.set(key, formatter);
  }
  return formatter.format(date);
}

function numberFormat(
  locale: string,
  kind: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${kind}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, formatter);
  }
  return formatter;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// ------------------------------------------------------------------- dates

/** `8/21/2026` · `21.08.2026` */
export const formatDate = (locale: string, value: Instant): string =>
  format(locale, 'date', value);

/** `8/21/2026, 12:46:00 AM` · `21.08.2026, 00:46:00` */
export const formatDateTime = (locale: string, value: Instant): string =>
  format(locale, 'dateTime', value);

/** `12:46 AM` · `00:46` */
export const formatClock = (locale: string, value: Instant): string =>
  format(locale, 'clock', value);

/** When something was said: the time today, `Aug 21, 12:46 AM` · `21 авг., 00:46` earlier. */
export function formatStamp(locale: string, value: Instant, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  return format(locale, sameDay(date, now) ? 'clock' : 'monthDayClock', date);
}

/** `August 21, 2026 at 12:46:00 AM` · `21 августа 2026 г. в 00:46:00` — a message's tooltip. */
export const formatStampTitle = (locale: string, value: Instant): string =>
  format(locale, 'stampTitle', value);

/** `August 21, 2026` · `21 августа 2026 г.` — the line between days in a chat. */
export const formatLongDate = (locale: string, value: Instant): string =>
  format(locale, 'longDate', value);

/** `Friday, August 21, 2026` · `пятница, 21 августа 2026 г.` */
export const formatFullDate = (locale: string, value: Instant): string =>
  format(locale, 'fullDate', value);

// ----------------------------------------------------------- calendar days

const DAY_MS = 86_400_000;
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Any Monday will do; 1 January 2024 was one. */
const A_MONDAY = Date.UTC(2024, 0, 1);

/**
 * A `YYYY-MM-DD` day as the UTC midnight that carries it; null for a string
 * of another shape and for a day that does not exist (`2026-02-30`), which an
 * engine would otherwise roll over into March.
 */
function calendarDay(value: string): Date | null {
  const match = CALENDAR_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}

/**
 * `Nov 26` · `26 нояб.` — a day where the year is plain from what surrounds it.
 *
 * A `YYYY-MM-DD` string is a calendar day and is shown as that day whatever
 * the browser's zone: the statistics API has already decided which day a
 * conversation belongs to. Anything else is an instant and is shown in the
 * browser's zone, like every other date here.
 */
export function formatDayMonth(locale: string, value: Instant): string {
  if (typeof value === 'string' && CALENDAR_DAY.test(value)) {
    return format(locale, 'calendarDayMonth', calendarDay(value));
  }
  return format(locale, 'dayMonth', value);
}

/**
 * `Mon` · `пн` — a weekday by its place in a week that starts on Monday:
 * 0 = Monday … 6 = Sunday. Not `Date#getDay()`, where 0 is Sunday.
 */
export function formatWeekdayShort(locale: string, weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return '';
  return format(locale, 'weekdayShort', A_MONDAY + weekday * DAY_MS);
}

/**
 * `Nov` · `нояб.` — a month by its number, 0–11, standing on its own (Russian
 * `май`; next to a day `formatDayMonth` writes `3 мая`).
 */
export function formatMonthShort(locale: string, month: number): string {
  if (!Number.isInteger(month) || month < 0 || month > 11) return '';
  return format(locale, 'monthShort', Date.UTC(2024, month, 1));
}

/**
 * The browser's IANA time zone, `Europe/Kyiv`: what the statistics page sends
 * so that the API can put a conversation on the viewer's day. `UTC` when the
 * browser will not say, which is also what the API assumes without it.
 *
 * Asked on every call and not kept: a laptop changes zones without a reload.
 */
export function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ----------------------------------------------------------------- numbers

/** `12,345` · `12 345` */
export const formatNumber = (locale: string, value: number | null | undefined): string =>
  isNumber(value) ? numberFormat(locale, 'number', {}).format(value) : '';

/** A ratio as a percentage: `0.42` → `42%` · `42 %`. */
export const formatPercent = (locale: string, ratio: number | null | undefined): string =>
  isNumber(ratio)
    ? numberFormat(locale, 'percent', { style: 'percent', maximumFractionDigits: 1 }).format(
        ratio,
      )
    : '';

/**
 * `1.2M` · `1,2 млн`, `340K` · `340 тыс.` — a count where the size matters
 * and the last digits do not: a chart axis, a token total. Whole below a
 * thousand, at most one decimal above.
 */
export const formatCompact = (locale: string, value: number | null | undefined): string =>
  isNumber(value)
    ? numberFormat(locale, 'compact', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value)
    : '';

/** From this many units up, cents are noise next to the amount. */
const WHOLE_MONEY_FROM = 100;

/**
 * `$12.50` · `12,50 $` below a hundred, `$1,235` · `1 235 $` from a hundred up.
 *
 * `currency` is an ISO 4217 code. One the platform does not know is shown as
 * it came, after the amount, instead of failing the page that renders it.
 */
export function formatMoney(
  locale: string,
  value: number | null | undefined,
  currency = 'USD',
): string {
  if (!isNumber(value)) return '';
  // Decided on the amount as it will be printed, so 99.996 is `$100` and not
  // `$100.00`.
  const whole = Math.abs(Math.round(value * 100) / 100) >= WHOLE_MONEY_FROM;
  const digits = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 };
  const kind = whole ? 'whole' : 'cents';
  try {
    return numberFormat(locale, `money|${currency}|${kind}`, {
      style: 'currency',
      currency,
      ...digits,
    }).format(value);
  } catch {
    // `Intl.NumberFormat` throws on text that is not shaped like a currency code.
    return `${numberFormat(locale, `amount|${kind}`, digits).format(value)} ${currency}`;
  }
}

/**
 * A byte count as a number in the language's own notation plus the unit to
 * translate it with: `{ value: '5,9', unit: 'mb' }`. The unit is a key and not
 * a word so that English stays the source and `i18n:sync` writes the rest.
 *
 * Rounding is what the console showed before: bytes whole, kilobytes rounded,
 * megabytes to one decimal. `precise` keeps one decimal in kilobytes too, for
 * small files where `1 KB` and `1.4 KB` are different news.
 */
export function formatSize(
  locale: string,
  bytes: number | null | undefined,
  precise = false,
): { value: string; unit: SizeUnit } {
  const whole = numberFormat(locale, 'whole', { maximumFractionDigits: 0 });
  const tenth = numberFormat(locale, 'tenth', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  if (!isNumber(bytes) || bytes < 0) return { value: whole.format(0), unit: 'b' };
  if (bytes < 1024) return { value: whole.format(bytes), unit: 'b' };
  if (bytes < 1024 * 1024) {
    return { value: (precise ? tenth : whole).format(bytes / 1024), unit: 'kb' };
  }
  return { value: tenth.format(bytes / (1024 * 1024)), unit: 'mb' };
}

// ------------------------------------------------------------------- names

const languageNames = new Map<string, Intl.DisplayNames>();

/**
 * An ISO 639-1 code as that language's name: `uk` → `Ukrainian` · `украинский`.
 * A code the platform does not know is shown as it came.
 */
export function languageName(locale: string, code: string | null | undefined): string {
  if (!code) return '';
  try {
    let names = languageNames.get(locale);
    if (!names) {
      // `fallback: 'none'` so an unknown code yields nothing instead of being
      // echoed back in a different case.
      names = new Intl.DisplayNames(locale, { type: 'language', fallback: 'none' });
      languageNames.set(locale, names);
    }
    return names.of(code) ?? code;
  } catch {
    // `of` throws on text that is not shaped like a language tag.
    return code;
  }
}
