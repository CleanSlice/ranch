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

/**
 * What an outbox row says. The webhook transport only ever queues `opened`
 * and `closed`; the bot transport (CLEAN-165) says something at every step.
 */
export type NotificationKindTypes = 'opened' | 'joined' | 'running' | 'closed';
export type NotificationStatusTypes = 'pending' | 'sent' | 'failed' | 'skipped';

/**
 * How the team is told. `webhook`: a Slack incoming webhook — a new message
 * per event, nothing else possible. `bot`: a Slack bot token and a channel —
 * one message per incident, its story in the thread, the state as a reaction.
 */
export type DestinationKindTypes = 'webhook' | 'bot';
export const DESTINATION_KINDS = ['webhook', 'bot'] as const;

/** The one reaction the bot keeps on an incident's root; swapped, never stacked. */
export type SlackReactionTypes =
  | 'red_circle'
  | 'large_green_circle'
  | 'white_check_mark'
  | 'black_square_for_stop';

// Slack posts about one message a second per channel, and a crash loop
// reports every 10–20 s: a minute between "Failed again" replies keeps a loop
// to a handful of replies per incident and still shows that it is going on.
// Reports inside the minute only move the count on the root.
export const JOINED_REPLY_GAP_MS = 60_000;

// The root is one line; the full cause is in the thread reply.
export const ROOT_REASON_MAX = 80;

// A bot *user* token. A user token (xoxp-) carries a person's permissions,
// not the bot's, and is refused with a message saying which one is needed.
export const BOT_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]+$/;
export const BOT_TOKEN_MAX_LENGTH = 300;
// Slack's public (C…) and private (G…) channel ids.
export const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{8,}$/;

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
  // The short handle: "#12". Unique per install, in opening order.
  number: number;
  agentId: string | null;
  agentName: string;
  open: boolean;
  // The destination's kind when the incident opened; null ⇒ none was set.
  // An incident finishes on the transport it started on.
  transport: DestinationKindTypes | null;
  // The bot transport's root message, once posted; `slackTs` set ⇒ never
  // post another root for this incident.
  slackChannel: string | null;
  slackTs: string | null;
  // The one reaction the bot has on the root right now.
  slackReaction: SlackReactionTypes | null;
  // Next `seq` for this incident's outbox rows.
  notificationSeq: number;
  // When the last "Failed again" reply was queued (at most one a minute).
  lastJoinedNotifiedAt: Date | null;
  // A report was swallowed by the minute rule; the sweep rewrites the root.
  rootStale: boolean;
  status: 'failed' | 'unreachable';
  reason: string | null;
  ranchWitnessed: boolean;
  // Sender names, the first reporter first; and how many reports there are.
  witnesses: string[];
  eventCount: number;
  openedAt: Date;
  lastFailureAt: Date;
  upSince: Date | null;
  closedAt: Date | null;
  resolution: IncidentResolutionTypes | null;
}

/** An incident as a list shows it. */
export interface IAgentIncidentView extends IAgentIncidentData {
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
  transport: DestinationKindTypes | null;
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

/** A later report joined the incident (bot transport only). */
export interface IJoinedNotificationPayload {
  kind: 'joined';
  agentId: string | null;
  agentName: string;
  status: 'failed' | 'unreachable';
  reason: string | null;
  occurredAt: string;
  witness: AgentEventWitnessTypes;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  // The count after this report was attached.
  eventCount: number;
}

/** Ranch saw the agent turn running; the quiet period starts (bot only). */
export interface IRunningNotificationPayload {
  kind: 'running';
  agentId: string | null;
  agentName: string;
  at: string;
}

export interface IClosedNotificationPayload {
  kind: 'closed';
  agentId: string | null;
  agentName: string;
  // The webhook transport only ever receives 'recovered' | 'unconfirmed';
  // the bot is told about 'stopped' | 'deleted' too (reply + rewrite, no
  // channel-level message).
  resolution: IncidentResolutionTypes;
  openedAt: string;
  // When the agent was last seen to come up (recovered) or last reported
  // failed (unconfirmed); the closing moment for stopped / deleted.
  upAt: string;
  closedAt: string;
  firstSenderName: string | null;
  eventCount: number;
}

export type INotificationPayload =
  | IOpenedNotificationPayload
  | IJoinedNotificationPayload
  | IRunningNotificationPayload
  | IClosedNotificationPayload;

export interface IAgentNotificationData {
  id: string;
  incidentId: string;
  kind: NotificationKindTypes;
  // Position inside the incident; delivered in this order.
  seq: number;
  payload: INotificationPayload;
  status: NotificationStatusTypes;
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
}

/**
 * The stored destination. `webhookUrl` and `botToken` are secrets — they
 * never leave the API. Exactly one kind's fields are set.
 */
export interface INotificationDestination {
  kind: DestinationKindTypes;
  webhookUrl: string | null;
  botToken: string | null;
  channelId: string | null;
  hint: string;
  updatedBy: string;
  updatedAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliveryOk: boolean | null;
  lastDeliveryError: string | null;
}

/** What the owner hands in. The service validates per kind. */
export type ISaveDestinationInput =
  | { kind: 'webhook'; webhookUrl: string }
  | { kind: 'bot'; botToken: string; channelId: string };

/** What a route, a tool or a page may see of it. No secret. */
export interface INotificationDestinationView {
  configured: boolean;
  kind: DestinationKindTypes | null;
  hint: string | null;
  // The bot's channel; not a secret. null on the webhook kind.
  channelId: string | null;
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
