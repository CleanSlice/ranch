import { formatStampDate } from '#common/utils/format';

/** Bytes → "856 B" / "2.1 KB" / "5.9 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ISO date → "16:02" (today), "Sep 21" (this year) or "Sep 21, 2025".
 * `''` for a date that cannot be read.
 */
export function formatModified(iso: string, now: Date = new Date()): string {
  return formatStampDate(iso, now);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
