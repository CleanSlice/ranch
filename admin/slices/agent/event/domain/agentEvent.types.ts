/** What a sender, or Ranch itself, said about an agent. */
export type AgentEventStatusTypes = 'failed' | 'unreachable' | 'recovered';
export type AgentEventWitnessTypes = 'ranch' | 'external';
export type AgentIncidentStateTypes = 'open' | 'closed';
export type IncidentNotificationKindTypes = 'opened' | 'closed';
export type IncidentNotificationStatusTypes = 'pending' | 'sent' | 'failed' | 'skipped';

/**
 * One report. `reason`, `senderName`, `tool` and `agentRef` are the sender's
 * own words: shown as received, never translated or reworded.
 */
export interface IAgentEvent {
  id: string;
  /** `null` when the sender named an agent Ranch does not know. */
  agentId: string | null;
  agentRef: string;
  agentName: string | null;
  status: AgentEventStatusTypes;
  reason: string | null;
  witness: AgentEventWitnessTypes;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  /** What Ranch did with the report. A string, not a union: a value a newer
   *  API adds is shown raw (`utils/eventTone.ts`) rather than dropped. */
  outcome: string;
  incidentId: string | null;
  occurredAt: string;
  receivedAt: string;
}

export interface IIncidentNotification {
  kind: IncidentNotificationKindTypes;
  status: IncidentNotificationStatusTypes;
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
}

export interface IAgentIncident {
  id: string;
  agentId: string | null;
  agentName: string;
  state: AgentIncidentStateTypes;
  status: 'failed' | 'unreachable';
  reason: string | null;
  witnesses: string[];
  ranchWitnessed: boolean;
  eventCount: number;
  openedAt: string;
  lastFailureAt: string;
  upSince: string | null;
  closedAt: string | null;
  resolution: string | null;
  notifications: IIncidentNotification[];
}

export interface IAgentEventPage {
  items: IAgentEvent[];
  nextCursor: string | null;
}

export interface IAgentIncidentPage {
  items: IAgentIncident[];
  nextCursor: string | null;
}

/** What both lists share: one agent's rows, a cursor, a page size. */
interface IAgentEventPageQuery {
  agentId?: string;
  before?: string;
  limit?: number;
}

export interface IListAgentEventsQuery extends IAgentEventPageQuery {
  /** Only the events of this incident — its timeline. */
  incidentId?: string;
}

export interface IListAgentIncidentsQuery extends IAgentEventPageQuery {
  state?: AgentIncidentStateTypes;
}

export interface INotificationLastDelivery {
  at: string;
  ok: boolean;
  error: string | null;
}

/**
 * Where the team is told. The address itself never comes back from the API —
 * only `hint`, its last characters — so nothing here can leak it.
 */
export interface INotificationDestination {
  configured: boolean;
  kind: string;
  hint: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** `false` while `ADMIN_URL` is unset on the API: messages carry no link. */
  consoleLinks: boolean;
  lastDelivery: INotificationLastDelivery | null;
}

export interface ITestDelivery {
  delivered: boolean;
  error: string | null;
}
