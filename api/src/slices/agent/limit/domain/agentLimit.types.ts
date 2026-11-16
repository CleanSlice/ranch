/**
 * Request limits for one agent (CLEAN-224).
 *
 * One allowance per agent, shared by everyone who talks to it: up to three
 * limits, each over a window that moves with time. No row means "off".
 */
export const LIMIT_WINDOWS = ['minute', 'hour', 'day'] as const;
export type LimitWindow = (typeof LIMIT_WINDOWS)[number];

export const WINDOW_MS: Record<LimitWindow, number> = {
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

/**
 * Sanity cap, not a product decision: the per-agent log holds at most this
 * many timestamps (8 bytes each), so one agent can never cost more than 8 MB.
 */
export const LIMIT_MAX = 1_000_000;

export interface IAgentLimits {
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
}

/** What a caller may send: absent and null both mean "this window is not limited". */
export type AgentLimitsInput = Partial<Record<keyof IAgentLimits, unknown>>;

export const LIMIT_FIELD: Record<LimitWindow, keyof IAgentLimits> = {
  minute: 'perMinute',
  hour: 'perHour',
  day: 'perDay',
};

/**
 * Who sent a request, decided from what the caller already verified. Only a
 * `visitor` can be refused or counted; the default everywhere is `visitor`,
 * so a caller that forgets to say is limited rather than exempt.
 */
export type RequestSource = 'visitor' | 'operator' | 'peer';

export type LimitDecision =
  | { admitted: true }
  | {
      admitted: false;
      /** Until a request will be accepted. Always > 0. */
      retryAfterMs: number;
      /** The window that set the wait. */
      window: LimitWindow;
    };

export const LimitRefusalCodes = {
  PublicAgentNeedsLimits: 'PUBLIC_AGENT_NEEDS_LIMITS',
  OutOfRange: 'LIMIT_OUT_OF_RANGE',
  WindowsContradict: 'LIMIT_WINDOWS_CONTRADICT',
} as const;
export type LimitRefusalCode =
  (typeof LimitRefusalCodes)[keyof typeof LimitRefusalCodes];

/**
 * What open chats are told ahead of a send. Only an hour or day window is
 * ever announced: a minute window clears inside a minute, and announcing it
 * would make the notice flicker for people who are only reading.
 */
export type AgentLimitState =
  | { limited: true; retryAfterMs: number; window: 'hour' | 'day' }
  | { limited: false };

/** Counts for one agent in one minute. No content, nobody's identity. */
export interface IAgentLoadMinute {
  /** Start of the minute, epoch ms (UTC). */
  minute: number;
  accepted: number;
  refused: number;
  refusedByMinute: number;
  refusedByHour: number;
  refusedByDay: number;
  /** Operator and agent-to-agent requests: seen, never counted toward limits. */
  exempt: number;
}

export interface IAgentLoadWindow {
  window: LimitWindow;
  used: number;
  limit: number | null;
  /** Seconds until this window has room again; null when it has room. */
  retryAfterSec: number | null;
}

export interface IAgentLoadSnapshot {
  limits: IAgentLimits | null;
  isPublic: boolean;
  /** Public with no limits: allowed only for agents saved before CLEAN-224. */
  needsLimits: boolean;
  windows: IAgentLoadWindow[];
  /** Conversations of this agent with a turn open right now. */
  inFlight: number;
  /** The last 60 minutes, oldest first, gaps filled with zeros. */
  series: IAgentLoadMinute[];
  refused: {
    lastHour: number;
    lastAt: string | null;
    byWindow: Record<LimitWindow, number>;
  };
  /** Operator and agent-to-agent requests in the last hour. */
  exemptLastHour: number;
  /** Highest rolling totals of accepted requests in the last 30 days. */
  peaks: Record<LimitWindow, number>;
  /** More than 1 means these figures are this copy's share only. */
  apiReplicas: number;
}

export interface IAgentLimitSummary {
  agentId: string;
  enabled: boolean;
  atLimit: boolean;
  needsLimits: boolean;
}

/** What the limiter needs from the hub, handed over by the hub itself so the
 *  two modules do not import each other. */
export interface IAgentLimitHub {
  inFlight(agentId: string): number;
  broadcast(agentId: string, state: AgentLimitState): void;
}

export function limitFor(
  limits: IAgentLimits | null,
  window: LimitWindow,
): number | null {
  return limits ? limits[LIMIT_FIELD[window]] : null;
}

export function hasAnyLimit(limits: IAgentLimits | null): boolean {
  return LIMIT_WINDOWS.some((w) => limitFor(limits, w) !== null);
}
