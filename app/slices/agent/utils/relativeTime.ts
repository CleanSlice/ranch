// "{n} minutes ago" as a bucket and a number; the template turns that into
// words. The unit suffix is part of the message, so a language that writes
// it differently — or reorders it — only edits the locale file.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export interface RelativeTime {
  key: string;
  count: number;
}

export function relativeTime(
  iso: string | null | undefined,
  now = Date.now(),
): RelativeTime | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return { key: 'relative_time.just_now', count: 0 };
  if (diff < hour)
    return { key: 'relative_time.minutes', count: Math.floor(diff / minute) };
  if (diff < day)
    return { key: 'relative_time.hours', count: Math.floor(diff / hour) };
  return { key: 'relative_time.days', count: Math.floor(diff / day) };
}
