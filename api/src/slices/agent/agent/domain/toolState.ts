import {
  IAgentToolState,
  IAgentToolStateDetail,
  IToolServerState,
  TOOL_PHASES,
  TOOL_SERVER_STATES,
  ToolPhaseTypes,
  ToolServerStateTypes,
  ToolSummaryTypes,
} from './toolState.types';

export const MAX_TOOL_SERVERS = 20;
const MAX_NAME_LENGTH = 100;
const MAX_ID_LENGTH = 100;
const MAX_ERROR_LENGTH = 300;
const MAX_ATTEMPTS = 1_000_000;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function cut(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * An error line as it may be shown to a person who manages the agent. The
 * runtime redacts before it reports; this is the API not taking its word
 * for it: first line only, no page of HTML, nothing shaped like a
 * credential, cut to 300 characters.
 */
export function redactToolError(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/<\s*(!doctype|html|head|body)\b/i.test(value)) {
    return 'the server answered with an error page';
  }
  const line = (value.split(/\r?\n/).find((l) => l.trim()) ?? '').trim();
  const clean = line
    .replace(
      /(authorization|x-[\w-]*(key|token)[\w-]*|api[-_]?key|token|secret|password)(["']?\s*[:=]\s*)(bearer\s+)?["']?[^\s"',;]+/gi,
      '$1$3[redacted]',
    )
    .replace(/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1')
    .replace(/\?[^\s"')]*/g, '');
  return clean ? cut(clean, MAX_ERROR_LENGTH) : null;
}

function parseServer(raw: unknown): IToolServerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const server = raw as Record<string, unknown>;
  const name = typeof server.name === 'string' ? server.name.trim() : '';
  if (!name) return null;
  if (!TOOL_SERVER_STATES.includes(server.state as ToolServerStateTypes)) {
    return null;
  }
  const since = isoOrNull(server.since);
  if (!since) return null;
  const attempts = Number(server.attempts);
  if (!Number.isInteger(attempts) || attempts < 0) return null;
  const state = server.state as ToolServerStateTypes;
  return {
    id:
      typeof server.id === 'string' && server.id.trim()
        ? cut(server.id.trim(), MAX_ID_LENGTH)
        : null,
    name: cut(name, MAX_NAME_LENGTH),
    state,
    since,
    attempts: Math.min(attempts, MAX_ATTEMPTS),
    lastError: state === 'connected' ? null : redactToolError(server.lastError),
  };
}

/**
 * A runtime's `tool_state` as the API will keep it, or null when it is not
 * one. A report is taken whole or not at all: an unknown phase, an unknown
 * state, a server without a name, more than `MAX_TOOL_SERVERS` servers —
 * any of them and nothing changes.
 */
export function parseReport(raw: unknown): IAgentToolState | null {
  if (!raw || typeof raw !== 'object') return null;
  const report = raw as Record<string, unknown>;
  if (!TOOL_PHASES.includes(report.phase as ToolPhaseTypes)) return null;
  const since = isoOrNull(report.since);
  const startedAt = isoOrNull(report.startedAt);
  if (!since || !startedAt) return null;
  if (!Array.isArray(report.servers)) return null;
  if (report.servers.length > MAX_TOOL_SERVERS) return null;
  const servers: IToolServerState[] = [];
  for (const item of report.servers) {
    const server = parseServer(item);
    if (!server) return null;
    servers.push(server);
  }
  return { phase: report.phase as ToolPhaseTypes, since, startedAt, servers };
}

/** The one word anyone may read. `ready` and "no report" are both null. */
export function summaryOf(state: IAgentToolState | null): ToolSummaryTypes {
  if (!state || state.phase === 'ready') return null;
  return state.phase;
}

/**
 * Which servers are missing, for an incident and the operator's
 * notification: names only, never an error text. Null when none is missing.
 */
export function reasonOf(state: IAgentToolState | null): string | null {
  const missing = (state?.servers ?? [])
    .filter((s) => s.state !== 'connected')
    .map((s) => s.name);
  if (missing.length === 0) return null;
  if (missing.length === 1) return `${missing[0]} not connected`;
  return `${missing.length} tool servers not connected: ${missing.join(', ')}`;
}

/** The record for a person who manages the agent. */
export function detailOf(
  state: IAgentToolState | null,
): IAgentToolStateDetail | null {
  if (!state) return null;
  return {
    phase: state.phase,
    since: state.since,
    servers: state.servers.map((s) => ({ ...s })),
  };
}
