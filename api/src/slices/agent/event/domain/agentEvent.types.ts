export type AgentEventStatusTypes = 'failed' | 'unreachable' | 'recovered';

/** What an outside sender may post. 'unreachable' is Ranch's own word. */
export const EXTERNAL_EVENT_STATUSES = ['failed', 'recovered'] as const;
export type ExternalEventStatusTypes = (typeof EXTERNAL_EVENT_STATUSES)[number];

export type AgentEventWitnessTypes = 'ranch' | 'external';

/** What an event did, decided once on arrival. */
export type AgentEventOutcomeTypes =
  | 'opened'
  | 'joined'
  | 'suppressed_stopped'
  | 'suppressed_starting'
  | 'unmatched'
  | 'evidence';

export type IncidentResolutionTypes =
  | 'recovered'
  | 'unconfirmed'
  | 'stopped'
  | 'deleted';

export type NotificationKindTypes = 'opened' | 'closed';
export type NotificationStatusTypes = 'pending' | 'sent' | 'failed' | 'skipped';

/** The name Ranch's own events carry as their sender. */
export const RANCH_SENDER_NAME = 'Ranch';

// One event a second is far above any honest sender on an install with tens
// of agents, and low enough that a runaway sender cannot fill the record.
export const FLOOD_LIMIT_PER_MINUTE = 60;
export const FLOOD_WINDOW_MS = 60_000;

// Kubernetes resets a container's crash back-off only after it has run for
// ten minutes — the cluster's own line between "still restarting" and
// "stable". An incident closes after the same quiet stretch, so a recovery
// that does not hold is never announced.
export const QUIET_MS = 10 * 60_000;

// Same as AgentStatusService's drift sweep: a closing message lags no more
// than a status itself can.
export const INCIDENT_SWEEP_MS = 30_000;

// Keeps "a message within a minute" with a wide margin; the first attempt is
// kicked at once, the tick is the safety net.
export const OUTBOX_TICK_MS = 5_000;

// When each attempt is due if every one is made on time; the worker waits
// the gap between two neighbours after a failed attempt. About 53 minutes in
// all: long enough for the outages Slack has, short enough that an alarm is
// not delivered as news the next morning — past that the console is the
// record.
export const RETRY_DELAYS_MS = [
  0, 10_000, 30_000, 120_000, 300_000, 900_000, 1_800_000,
];

// A healthy webhook answers in well under a second; a hung one must not hold
// a worker tick.
export const NOTIFY_TIMEOUT_MS = 5_000;

// A claim outlives the send it covers (timeout + bookkeeping) and no longer:
// a replica that died mid-send frees the row within half a minute.
export const NOTIFICATION_LOCK_MS = 30_000;

// The spec's choice; a common default for operational records.
export const RETENTION_DAYS = 90;
export const RETENTION_SWEEP_MS = 60 * 60_000;

export const REASON_MAX_LENGTH = 2000;
export const TOOL_MAX_LENGTH = 100;
export const EVENT_ID_MAX_LENGTH = 200;
export const AGENT_REF_MAX_LENGTH = 100;

export const EVENT_PAGE_DEFAULT = 50;
export const EVENT_PAGE_MAX = 200;

export interface IAgentEventData {
  id: string;
  agentId: string | null;
  agentRef: string;
  agentName: string | null;
  status: AgentEventStatusTypes;
  reason: string | null;
  witness: AgentEventWitnessTypes;
  apiKeyId: string | null;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  outcome: AgentEventOutcomeTypes;
  incidentId: string | null;
  occurredAt: Date;
  receivedAt: Date;
}

export interface ICreateAgentEventData {
  agentId: string | null;
  agentRef: string;
  agentName: string | null;
  status: AgentEventStatusTypes;
  reason: string | null;
  witness: AgentEventWitnessTypes;
  apiKeyId: string | null;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  outcome: AgentEventOutcomeTypes;
  incidentId: string | null;
  occurredAt: Date;
  receivedAt: Date;
  dedupeKey: string | null;
}

export interface IAgentNotificationSummary {
  kind: NotificationKindTypes;
  status: NotificationStatusTypes;
  attempts: number;
  sentAt: Date | null;
  lastError: string | null;
}

export interface IAgentIncidentData {
  id: string;
  agentId: string | null;
  agentName: string;
  open: boolean;
  status: 'failed' | 'unreachable';
  reason: string | null;
  ranchWitnessed: boolean;
  openedAt: Date;
  lastFailureAt: Date;
  upSince: Date | null;
  closedAt: Date | null;
  resolution: IncidentResolutionTypes | null;
}

/** An incident as a list shows it. */
export interface IAgentIncidentView extends IAgentIncidentData {
  witnesses: string[];
  eventCount: number;
  notifications: IAgentNotificationSummary[];
}

/** An open incident with what the sweep needs to judge it. */
export interface IOpenIncidentWithAgent {
  incident: IAgentIncidentData;
  // null ⇒ the agent no longer exists.
  agentStatus: string | null;
  // Who reported first — named in the closing message of a false alarm.
  firstSenderName: string | null;
}

export interface IOpenIncidentInput {
  agentId: string;
  agentName: string;
  status: 'failed' | 'unreachable';
  reason: string | null;
  ranchWitnessed: boolean;
  openedAt: Date;
  lastFailureAt: Date;
}

/**
 * What a message says, fixed at the moment it was queued. Dates travel as
 * ISO strings because the row is JSON. No secret and nothing of an agent's
 * configuration ever goes in here.
 */
export interface IOpenedNotificationPayload {
  kind: 'opened';
  agentId: string | null;
  agentName: string;
  status: 'failed' | 'unreachable';
  reason: string | null;
  occurredAt: string;
  witness: AgentEventWitnessTypes;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
}

export interface IClosedNotificationPayload {
  kind: 'closed';
  agentId: string | null;
  agentName: string;
  resolution: 'recovered' | 'unconfirmed';
  openedAt: string;
  // When the agent was last seen to come up (recovered) or last reported
  // failed (unconfirmed).
  upAt: string;
  firstSenderName: string | null;
}

export type INotificationPayload =
  | IOpenedNotificationPayload
  | IClosedNotificationPayload;

export interface IAgentNotificationData {
  id: string;
  incidentId: string;
  kind: NotificationKindTypes;
  payload: INotificationPayload;
  status: NotificationStatusTypes;
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
}

/** The stored destination. `webhookUrl` is a secret — never leaves the API. */
export interface INotificationDestination {
  kind: 'slack';
  webhookUrl: string;
  hint: string;
  updatedBy: string;
  updatedAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliveryOk: boolean | null;
  lastDeliveryError: string | null;
}

/** What a route, a tool or a page may see of it. No address. */
export interface INotificationDestinationView {
  configured: boolean;
  kind: 'slack' | null;
  hint: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  // false ⇒ ADMIN_URL is not set on the API; messages carry no link.
  consoleLinks: boolean;
  lastDelivery: { at: Date; ok: boolean; error: string | null } | null;
}

export interface IEventListFilter {
  agentId?: string;
  incidentId?: string;
  since?: Date;
  limit: number;
  before?: string;
}

export interface IIncidentListFilter {
  agentId?: string;
  state?: 'open' | 'closed';
  since?: Date;
  limit: number;
  before?: string;
}

export interface IPage<T> {
  items: T[];
  nextCursor: string | null;
}
