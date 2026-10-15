/** What a sender, or Ranch itself, said about an agent. */
export type AgentEventStatusTypes = 'failed' | 'unreachable' | 'recovered';
export type AgentEventWitnessTypes = 'ranch' | 'external';
export type AgentIncidentStateTypes = 'open' | 'closed';
/** The webhook queues the first and the last; the bot says something at every step. */
export type IncidentNotificationKindTypes = 'opened' | 'joined' | 'running' | 'closed';
/** How the team is told: an incoming webhook, or a bot with a thread per incident. */
export type DestinationKindTypes = 'webhook' | 'bot';
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
  /** The short handle people use: "#12". Unique per install, in opening order. */
  number: number;
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
 * Where the team is told. The secret — the webhook address or the bot token —
 * never comes back from the API, only `hint`, its last characters, so nothing
 * here can leak it. The bot's channel id is not a secret.
 */
export interface INotificationDestination {
  configured: boolean;
  kind: DestinationKindTypes | null;
  hint: string | null;
  channelId: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** `false` while `ADMIN_URL` is unset on the API: messages carry no link. */
  consoleLinks: boolean;
  lastDelivery: INotificationLastDelivery | null;
}

/** What the owner hands in. Not kept on this side once it is sent. */
export type ISaveDestination =
  | { kind: 'webhook'; webhookUrl: string }
  | { kind: 'bot'; botToken: string; channelId: string };

export interface ITestDelivery {
  delivered: boolean;
  error: string | null;
}
