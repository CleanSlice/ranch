import type { AgentStatusTypes, IAgentPodStatus } from '#agent/domain';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export const AGENT_STATUS_VARIANT: Record<AgentStatusTypes, BadgeVariant> = {
  running: 'default',
  deploying: 'secondary',
  pending: 'secondary',
  stopped: 'outline',
  failed: 'destructive',
};

// Date formatting comes from the shared `formatDateTime` in
// slices/common/utils/formatDate.ts (auto-imported).

export function formatCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function formatUsd(n: number) {
  if (n <= 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatCpuMilli(milli: number): string {
  if (!milli || milli < 0) return '0';
  if (milli < 1000) return `${Math.round(milli)}m`;
  return `${(milli / 1000).toFixed(2)} CPU`;
}

export function usagePct(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

export function usagePctClass(p: number): string {
  if (p >= 90) return 'bg-destructive';
  if (p >= 70) return 'bg-amber-500';
  return 'bg-primary';
}

export const maskSecret = (v: string) =>
  v
    ? v.length <= 6
      ? '•'.repeat(v.length)
      : `${v.slice(0, 3)}${'•'.repeat(Math.max(6, v.length - 6))}${v.slice(-3)}`
    : '';

export function podPhaseLabel(pod: IAgentPodStatus | null): string | null {
  if (!pod) return null;
  if (pod.containerWaitingReason) return pod.containerWaitingReason;
  if (pod.phase === 'Running' && !pod.ready) return 'Starting…';
  if (pod.phase === 'Running' && pod.ready) return 'Ready';
  return pod.phase;
}
