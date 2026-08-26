export interface INavMapItem {
  id: string;
  isUser: boolean;
  snippet: string;
}

export function formatMessageTime(ts: number, locale?: string): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
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
