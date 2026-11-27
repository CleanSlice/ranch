import {
  browserTimeZone,
  formatClock,
  formatCompact,
  formatCompactParts,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatEstimate,
  formatFullDate,
  formatList,
  formatLongDate,
  formatMoney,
  formatMonthShort,
  formatNumber,
  formatPercent,
  formatSize,
  formatStamp,
  formatStampTitle,
  formatWeekdayShort,
  languageName,
  type Instant,
} from '../utils/format';

/**
 * The format module, bound to the console's active language.
 *
 * Every function reads the language when it is called, not when the component
 * was set up, so a value rendered in a template or a `computed` follows a
 * language switch without a reload.
 *
 *   const format = useFormat();
 *   format.clock(message.ts)      // 12:46 AM · 00:46
 *   format.size(file.size)        // 5.9 MB · 5,9 МБ
 *   format.compact(tokens)        // 1.2M · 1,2 млн
 */
export function useFormat() {
  const { locale, t } = useI18n();

  return {
    date: (value: Instant) => formatDate(locale.value, value),
    dateTime: (value: Instant) => formatDateTime(locale.value, value),
    clock: (value: Instant) => formatClock(locale.value, value),
    stamp: (value: Instant, now?: Date) => formatStamp(locale.value, value, now),
    stampTitle: (value: Instant) => formatStampTitle(locale.value, value),
    longDate: (value: Instant) => formatLongDate(locale.value, value),
    fullDate: (value: Instant) => formatFullDate(locale.value, value),
    /** A `YYYY-MM-DD` string is that calendar day in any zone; the rest are instants. */
    dayMonth: (value: Instant) => formatDayMonth(locale.value, value),
    /** 0 = Monday … 6 = Sunday. */
    weekdayShort: (weekday: number) => formatWeekdayShort(locale.value, weekday),
    /** 0 = January … 11 = December. */
    monthShort: (month: number) => formatMonthShort(locale.value, month),
    /** The browser's IANA zone, read when called; it has no language. */
    timeZone: () => browserTimeZone(),
    number: (value: number | null | undefined) => formatNumber(locale.value, value),
    percent: (ratio: number | null | undefined) => formatPercent(locale.value, ratio),
    compact: (value: number | null | undefined) => formatCompact(locale.value, value),
    /** The number and its unit apart, for a unit set in smaller type. */
    compactParts: (value: number | null | undefined) => formatCompactParts(locale.value, value),
    money: (value: number | null | undefined, currency?: string) =>
      formatMoney(locale.value, value, currency),
    /**
     * An amount computed from a price list: `≈ $212` · `≈ 212 $`; above zero
     * and under half a cent, `< $0.01` · `< 0,01 $`.
     */
    estimate: (value: number | null | undefined, currency?: string) =>
      formatEstimate(locale.value, value, currency),
    /** The number in the language's notation, the unit from `unit.*`. */
    size: (bytes: number | null | undefined, precise = false) => {
      const { value, unit } = formatSize(locale.value, bytes, precise);
      return t(`unit.${unit}`, { value });
    },
    /** Names in a sentence: `Ada, Bo, and Cy` · `Ада, Бо и Cy`. Each as received. */
    list: (items: readonly string[] | null | undefined) => formatList(locale.value, items),
    languageName: (code: string | null | undefined) => languageName(locale.value, code),
  };
}
