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
