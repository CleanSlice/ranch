import type { IShareLimits, ShareAttachmentKind } from '../domain/share.types';

// What the visitor's info panel decides in script. Copy chosen here travels
// as a key (docs/i18n.md); the panel renders it with `$t`.

export type ShareStatusKey =
  | 'share.info.status_online'
  | 'share.info.status_starting'
  | 'share.info.status_unavailable';

/**
 * The status as a word a visitor can use. Three, not the console's eight:
 * "failed", "stopped" and "unreachable" are all the same thing to someone who
 * only wants to know whether a message will be answered.
 */
export function shareStatusKey(status: string): ShareStatusKey {
  if (status === 'running') return 'share.info.status_online';
  if (status === 'deploying' || status === 'pending') {
    return 'share.info.status_starting';
  }
  return 'share.info.status_unavailable';
}

export interface IShareLimitRow {
  labelKey: string;
  count: number;
}

/** One row per configured window, shortest first. */
export function shareLimitRows(limits: IShareLimits | null): IShareLimitRow[] {
  if (!limits) return [];
  const windows: [string, number | null][] = [
    ['share.info.limit_minute', limits.perMinute],
    ['share.info.limit_hour', limits.perHour],
    ['share.info.limit_day', limits.perDay],
  ];
  return windows.flatMap(([labelKey, count]) =>
    count === null ? [] : [{ labelKey, count }],
  );
}

export function shareKindKey(kind: ShareAttachmentKind): string {
  return `share.info.kind_${kind}`;
}
