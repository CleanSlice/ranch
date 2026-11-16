// Domain types for an agent's request limits and its live load (CLEAN-224).
// Envelope-free; the data layer maps the API's DTOs onto these.

export type LimitWindowTypes = 'minute' | 'hour' | 'day';

export const LIMIT_WINDOWS: readonly LimitWindowTypes[] = ['minute', 'hour', 'day'];

/** The server's sanity cap; the smallest limit is one. */
export const LIMIT_MAX = 1_000_000;

/** `null` in a field: that window is not limited. */
export interface IAgentLimits {
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
}

/** One line of `GET /agent-limits` — what the list marks are drawn from. */
export interface IAgentLimitSummary {
  agentId: string;
  /** The agent has at least one limit. */
  enabled: boolean;
  /** A limit is full right now: the next visitor request is refused. */
  atLimit: boolean;
  /** Public with no limits — only an agent made public before limits existed. */
  needsLimits: boolean;
}

export interface IAgentLoadWindow {
  window: LimitWindowTypes;
  used: number;
  /** `null`: no ceiling for this window. */
  limit: number | null;
  /** Seconds until the window has room again; `null` while it has room. */
  retryAfterSec: number | null;
}

export interface IAgentLoadMinute {
  /** Start of the minute, ISO 8601 (UTC). */
  minute: string;
  accepted: number;
  refused: number;
  /** Operator and agent-to-agent requests; not counted toward limits. */
  exempt: number;
}

export interface IAgentLoadByWindow {
  minute: number;
  hour: number;
  day: number;
}

export interface IAgentLoad {
  limits: IAgentLimits | null;
  isPublic: boolean;
  needsLimits: boolean;
  windows: IAgentLoadWindow[];
  /** Conversations with a turn open right now. */
  inFlight: number;
  /** The last 60 minutes, oldest first, empty minutes included. */
  series: IAgentLoadMinute[];
  refused: {
    lastHour: number;
    lastAt: string | null;
    byWindow: IAgentLoadByWindow;
  };
  exemptLastHour: number;
  /** Highest accepted requests in any minute, hour and day of the last 30 days. */
  peaks: IAgentLoadByWindow;
  /** Above 1 the figures are the share of one API copy only. */
  apiReplicas: number;
}

/**
 * Everything the console knows about one agent's limits, in one record
 * (docs/state.md). The three flags come with the summary; `limits` and `load`
 * are absent until something asked for them — `limits: null` means "known to
 * be off", which is not the same as "not loaded yet".
 */
export interface IAgentLimitEntry {
  enabled: boolean;
  atLimit: boolean;
  needsLimits: boolean;
  limits?: IAgentLimits | null;
  load?: IAgentLoad;
}

/** Why the server refused a save (HTTP 400, `code` in the body). */
export const AgentLimitRefusalCodes = {
  PublicAgentNeedsLimits: 'PUBLIC_AGENT_NEEDS_LIMITS',
  OutOfRange: 'LIMIT_OUT_OF_RANGE',
  WindowsContradict: 'LIMIT_WINDOWS_CONTRADICT',
} as const;

/** What `save` answers: saved, or refused with the server's `code` when it gave one. */
export type AgentLimitSaveResult =
  | { ok: true }
  | { ok: false; code: string | null; message: string };

/**
 * The `code` a failed request carried, if any. Gateways attach it to the Error
 * they throw (`error.code`), so a caller can tell a refusal it knows how to
 * word from a failure it can only repeat.
 */
export function refusalCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : null;
}

/** An Error that keeps the `code` of the response body it was built from. */
export function errorWithCode(message: string, body: unknown): Error {
  const error = new Error(message);
  const code = refusalCodeOf(body);
  if (code) (error as Error & { code?: string }).code = code;
  return error;
}
