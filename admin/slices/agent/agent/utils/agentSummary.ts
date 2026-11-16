/**
 * The four read-only figures at the top of Overview (CLEAN-228,
 * specs/031-agent-overview-redesign/data-model.md "Summary"): status, spend,
 * pod load, requests. Each cell is worked out on its own, so a source that
 * failed makes ONE cell "unavailable" and leaves the other three alone.
 *
 * Numbers that are counted are worded here; dates, money and byte sizes stay
 * raw for the component, which formats them with the format module.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
import type {
  AgentStatusTypes,
  IAgentData,
  IAgentMetrics,
} from '#agent/domain/agent.types';
import type { IAgentLoad } from '#agent/domain/agentLimit.types';
import type { IAgentPodStatus } from '#agent/domain/agentStatus.types';
import type { IUsageTotals } from '#usage/domain/usage.types';
import { formatNumber } from '#common/utils/format';

export interface ISummaryInput {
  agent: Pick<IAgentData, 'status' | 'statusReason' | 'updatedAt'>;
  /** The status stream's pod for this agent; `null` when there is none. */
  pod: IAgentPodStatus | null;
  /** `null`: no pod to measure, or the request failed. */
  metrics: IAgentMetrics | null;
  /** `null`: the usage request failed (or has not answered yet). */
  usage: { totals: IUsageTotals } | null;
  /** `null`: the load request failed (or has not answered yet). */
  load: IAgentLoad | null;
}

export interface ISummaryUnavailable {
  state: 'unavailable';
  /** Why, in words — shown in place of the figure. */
  text: string;
}

export type SummaryTone = 'ok' | 'busy' | 'off' | 'bad';

export interface ISummaryStatus {
  state: 'ok';
  status: AgentStatusTypes;
  /** `Running`, `Stopped`, … */
  label: string;
  /** The colour of the marker next to the word. */
  tone: SummaryTone;
  /** `Pod ready`, `Pod starting`, `CrashLoopBackOff`, `No pod`. */
  podText: string;
  restarts: number;
  /** Why it failed or cannot be reached; `null` otherwise. */
  reason: string | null;
  /** Raw instant; the component formats it. */
  updatedAt: string;
}

export interface ISummarySpend {
  state: 'ok';
  costUsd: number;
  calls: number;
  inputTokens: number;
}

export interface ISummaryMeter {
  used: number;
  limit: number;
  /** 0–100. */
  pct: number;
}

export interface ISummaryPod {
  state: 'ok';
  /** `null`: the pod reports no limit for this one, so there is no share to draw. */
  cpu: ISummaryMeter | null;
  memory: ISummaryMeter | null;
}

export interface ISummaryRequests {
  state: 'ok';
  /** Accepted in the current minute window. */
  used: number;
  /** `null`: no per-minute limit. */
  limit: number | null;
  /** `of 60 allowed`, or `no limit per minute`. */
  limitText: string;
  peakThisHour: number;
  refusedThisHour: number;
  /** `3 refused this hour` when any were, else `Peak this hour: 7 per minute`. */
  detail: string;
}

export interface IAgentSummary {
  status: ISummaryStatus;
  spend: ISummarySpend | ISummaryUnavailable;
  pod: ISummaryPod | ISummaryUnavailable;
  requests: ISummaryRequests | ISummaryUnavailable;
}

const STATUS_LABEL: Record<AgentStatusTypes, string> = {
  running: 'Running',
  deploying: 'Deploying',
  pending: 'Pending',
  stopped: 'Stopped',
  failed: 'Failed',
  unreachable: 'Unreachable',
};

const STATUS_TONE: Record<AgentStatusTypes, SummaryTone> = {
  running: 'ok',
  deploying: 'busy',
  pending: 'busy',
  stopped: 'off',
  failed: 'bad',
  unreachable: 'bad',
};

function podText(pod: IAgentPodStatus | null): string {
  if (!pod) return 'No pod';
  if (pod.containerWaitingReason) return pod.containerWaitingReason;
  if (pod.phase === 'Running') return pod.ready ? 'Pod ready' : 'Pod starting';
  return `Pod ${pod.phase.toLowerCase()}`;
}

function statusCell(input: ISummaryInput): ISummaryStatus {
  const { agent, pod } = input;
  return {
    state: 'ok',
    status: agent.status,
    label: STATUS_LABEL[agent.status] ?? agent.status,
    tone: STATUS_TONE[agent.status] ?? 'off',
    podText: podText(pod),
    restarts: pod?.restartCount ?? 0,
    reason: agent.statusReason || null,
    updatedAt: agent.updatedAt,
  };
}

function spendCell(input: ISummaryInput): ISummarySpend | ISummaryUnavailable {
  if (!input.usage) return { state: 'unavailable', text: 'Usage is not available' };
  const totals = input.usage.totals;
  return {
    state: 'ok',
    costUsd: totals.costUsd,
    calls: totals.callCount,
    inputTokens: totals.inputTokens,
  };
}

function meter(used: number, limit: number): ISummaryMeter | null {
  // A limit of 0 is "none reported" (the mapper's default), never a full or an
  // empty bar: there is nothing to take a share of.
  if (!(limit > 0)) return null;
  const share = Math.round((Math.max(0, used) / limit) * 100);
  return { used: Math.max(0, used), limit, pct: Math.min(100, Math.max(0, share)) };
}

function podCell(input: ISummaryInput): ISummaryPod | ISummaryUnavailable {
  const { agent, pod, metrics } = input;
  if (agent.status === 'stopped') {
    return { state: 'unavailable', text: 'Not available — the agent is stopped' };
  }
  if (!pod) return { state: 'unavailable', text: 'Not available — there is no pod' };
  if (!metrics) return { state: 'unavailable', text: 'Pod load is not available' };
  const cpu = meter(metrics.pod.cpuMilli, metrics.pod.cpuLimitMilli);
  const memory = meter(metrics.pod.memBytes, metrics.pod.memLimitBytes);
  if (!cpu && !memory) {
    return { state: 'unavailable', text: 'Not available — the pod reports no limits' };
  }
  return { state: 'ok', cpu, memory };
}

function requestsCell(input: ISummaryInput): ISummaryRequests | ISummaryUnavailable {
  const load = input.load;
  if (!load) return { state: 'unavailable', text: 'Request load is not available' };

  let used = 0;
  let limit: number | null = load.limits?.perMinute ?? null;
  for (let i = 0; i < load.windows.length; i += 1) {
    const window = load.windows[i]!;
    if (window.window !== 'minute') continue;
    used = window.used;
    limit = window.limit;
  }

  let peak = 0;
  for (let i = 0; i < load.series.length; i += 1) {
    if (load.series[i]!.accepted > peak) peak = load.series[i]!.accepted;
  }

  const refused = load.refused.lastHour;
  return {
    state: 'ok',
    used,
    limit,
    limitText: limit === null ? 'no limit per minute' : `of ${formatNumber(limit)} allowed`,
    peakThisHour: peak,
    refusedThisHour: refused,
    detail:
      refused > 0
        ? `${formatNumber(refused)} refused this hour`
        : `Peak this hour: ${formatNumber(peak)} per minute`,
  };
}

export function agentSummary(input: ISummaryInput): IAgentSummary {
  return {
    status: statusCell(input),
    spend: spendCell(input),
    pod: podCell(input),
    requests: requestsCell(input),
  };
}
