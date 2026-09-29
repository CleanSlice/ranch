import { formatStamp } from '../../common/utils/format';

export interface INavMapItem {
  id: string;
  isUser: boolean;
  snippet: string;
}

/**
 * When a message was sent: the time today, `Aug 21, 12:46 AM` · `21 авг., 00:46`
 * earlier. `locale` is required — left out, the date would follow the browser
 * instead of the language the customer picked.
 */
export function formatMessageTime(ts: number, locale: string, now: Date = new Date()): string {
  return formatStamp(locale, ts, now);
}

/** One-line plain-text snippet for the navigation mini-map. */
export function snippet(text: string, max = 64): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/[#*_`>~-]/g, '').trim())
      .find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
