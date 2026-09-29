import {
  formatClock,
  formatDate,
  formatDateTime,
  formatFullDate,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatSize,
  formatStamp,
  formatStampTitle,
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
    number: (value: number | null | undefined) => formatNumber(locale.value, value),
    percent: (ratio: number | null | undefined) => formatPercent(locale.value, ratio),
    /** The number in the language's notation, the unit from `unit.*`. */
    size: (bytes: number | null | undefined, precise = false) => {
      const { value, unit } = formatSize(locale.value, bytes, precise);
      return t(`unit.${unit}`, { value });
    },
    languageName: (code: string | null | undefined) => languageName(locale.value, code),
  };
}
