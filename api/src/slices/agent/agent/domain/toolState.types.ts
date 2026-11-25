/**
 * What an agent's runtime says about its tool servers (CLEAN-245). The
 * runtime reports it over the hub as `tool_state`; the API keeps the last
 * report in memory for as long as the agent's socket lives.
 */

export const TOOL_SERVER_STATES = ['connected', 'retrying', 'refused'] as const;
export type ToolServerStateTypes = (typeof TOOL_SERVER_STATES)[number];

export const TOOL_PHASES = ['connecting', 'limited', 'ready'] as const;
export type ToolPhaseTypes = (typeof TOOL_PHASES)[number];

/** What anyone may know: no server name, no error. `null` is "nothing to say". */
export type ToolSummaryTypes = 'connecting' | 'limited' | null;

export interface IToolServerState {
  id: string | null;
  name: string;
  state: ToolServerStateTypes;
  /** ISO time it entered this state. */
  since: string;
  /** Attempts since it last was connected; 0 when connected. */
  attempts: number;
  lastError: string | null;
}

export interface IAgentToolState {
  phase: ToolPhaseTypes;
  /** ISO time this phase began. */
  since: string;
  /** ISO time the runtime started. */
  startedAt: string;
  servers: IToolServerState[];
}

/** What a person who manages the agent reads: the record without `startedAt`. */
export interface IAgentToolStateDetail {
  phase: ToolPhaseTypes;
  since: string;
  servers: IToolServerState[];
}

export type ToolAlertTypes = 'limited' | 'recovered';

/** An agent stayed `limited` past the threshold, or came back from it. */
export interface IToolAlert {
  kind: ToolAlertTypes;
  agentId: string;
  /** Names of the servers, never an error text. Null on `recovered`. */
  reason: string | null;
  at: Date;
}
