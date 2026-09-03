/** Human-readable byte count for tables and previews; `-` when unknown. */
export function formatBytes(size: number | null): string {
  if (size === null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Readable message out of an unknown thrown value.
 *
 * The API wraps failures in an envelope, so the sentence worth showing sits at
 * `response.data.message` rather than on the Error itself. Everything else
 * falls back to the caller's wording: rendering `[object Object]` in a red box
 * tells a user nothing.
 */
export function errorMessageOf(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err;
  if (!isRecord(err)) return fallback;

  const response = err.response;
  if (isRecord(response) && isRecord(response.data)) {
    const message = response.data.message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  const message = err.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date only, for table columns where the time of day is noise. */
export function formatDate(iso: string | null | undefined): string {
  return parseDate(iso)?.toLocaleDateString() ?? '-';
}

/** Date and time, for "when did this last finish" readouts. */
export function formatDateTime(iso: string | null | undefined): string {
  return parseDate(iso)?.toLocaleString() ?? 'never';
}
