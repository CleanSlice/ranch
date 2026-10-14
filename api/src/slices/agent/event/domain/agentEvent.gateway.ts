import {
  DestinationKindTypes,
  IAgentEventData,
  IAgentIncidentData,
  IAgentIncidentView,
  IAgentNotificationData,
  IClosedNotificationPayload,
  ICreateAgentEventData,
  IEventListFilter,
  IIncidentListFilter,
  IJoinedNotificationPayload,
  INotificationDestination,
  IOpenedNotificationPayload,
  IOpenIncidentInput,
  IOpenIncidentWithAgent,
  IRunningNotificationPayload,
  IncidentResolutionTypes,
  IPage,
  SlackReactionTypes,
} from './agentEvent.types';

export abstract class IAgentEventGateway {
  // ── Events ────────────────────────────────────────────────────────────
  // A dedupeKey that is already stored surfaces as `null`: the caller reads
  // the first event back instead of treating a sender's retry as an error.
  abstract createEvent(
    data: ICreateAgentEventData,
  ): Promise<IAgentEventData | null>;
  abstract findEventByDedupeKey(key: string): Promise<IAgentEventData | null>;
  abstract countEventsByKeySince(
    apiKeyId: string,
    since: Date,
  ): Promise<number>;
  abstract oldestEventAtByKeySince(
    apiKeyId: string,
    since: Date,
  ): Promise<Date | null>;
  abstract listEvents(
    filter: IEventListFilter,
  ): Promise<IPage<IAgentEventData>>;

  // ── Incidents ─────────────────────────────────────────────────────────
  abstract findOpenIncident(
    agentId: string,
  ): Promise<IAgentIncidentData | null>;
  abstract findIncidentById(id: string): Promise<IAgentIncidentData | null>;
  // Inserts the incident and its opening message (seq 0) in one transaction.
  // `null` ⇒ another event opened one for this agent first.
  abstract openIncident(
    input: IOpenIncidentInput,
    payload: IOpenedNotificationPayload,
  ): Promise<IAgentIncidentData | null>;
  // Counts the report, adds its sender to the witnesses and restarts the
  // quiet period. With a `reply`, also queues a "Failed again" row — unless
  // one was queued less than `gapMs` ago, in which case the incident is only
  // marked stale ('joined_quiet'). 'closed' ⇒ the incident closed in the
  // meantime, nothing was written.
  abstract touchIncidentFailure(
    id: string,
    at: Date,
    ranchWitnessed: boolean,
    senderName: string,
    reply: Omit<IJoinedNotificationPayload, 'eventCount'> | null,
    gapMs: number,
  ): Promise<'joined' | 'joined_quiet' | 'closed'>;
  // A report filed with an incident without changing where it stands (a
  // `recovered` from outside): counted and its sender remembered, no more.
  abstract noteIncidentReport(id: string, senderName: string): Promise<void>;
  // Marks when Ranch saw the agent come up. With a `reply`, queues a
  // "Running again" row — only when this is the first up-turn since the
  // last failure (upSince was null), so a flapping agent says it once.
  abstract setIncidentUpSince(
    agentId: string,
    at: Date,
    reply: IRunningNotificationPayload | null,
  ): Promise<void>;
  abstract listOpenIncidentsWithAgent(): Promise<IOpenIncidentWithAgent[]>;
  // Closes only if still open, and queues the closing message in the same
  // transaction. false ⇒ someone else closed it; nothing was queued.
  abstract closeIncident(
    id: string,
    resolution: IncidentResolutionTypes,
    closedAt: Date,
    payload: IClosedNotificationPayload | null,
  ): Promise<boolean>;
  abstract listIncidents(
    filter: IIncidentListFilter,
  ): Promise<IPage<IAgentIncidentView>>;

  // ── The bot's root message on an incident ─────────────────────────────
  abstract setIncidentRoot(
    id: string,
    channel: string,
    ts: string,
  ): Promise<void>;
  abstract setIncidentReaction(
    id: string,
    name: SlackReactionTypes,
  ): Promise<void>;
  // Bot incidents whose root count fell behind (a report was swallowed by
  // the minute rule); the sweep rewrites them.
  abstract listStaleBotIncidents(): Promise<IAgentIncidentData[]>;
  abstract clearRootStale(id: string): Promise<void>;

  // ── Notifications (the outbox) ────────────────────────────────────────
  // Takes one due message for this process, or null. Two replicas asking at
  // once get different rows, or one of them gets nothing. A row is not
  // claimed while an earlier `seq` of its incident is still pending: rows of
  // one incident go out in order.
  abstract claimDueNotification(
    now: Date,
    lockedUntil: Date,
  ): Promise<IAgentNotificationData | null>;
  abstract markNotificationSent(id: string, at: Date): Promise<void>;
  abstract markNotificationRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string,
  ): Promise<void>;
  abstract markNotificationFailed(
    id: string,
    attempts: number,
    error: string,
  ): Promise<void>;
  abstract markNotificationSkipped(id: string): Promise<void>;

  // ── Destination ───────────────────────────────────────────────────────
  // The only read that returns the secrets. For the notifiers, nothing else.
  abstract getDestination(): Promise<INotificationDestination | null>;
  // Replaces the row; the other kind's secret is nulled.
  abstract saveDestination(input: {
    kind: DestinationKindTypes;
    webhookUrl: string | null;
    botToken: string | null;
    channelId: string | null;
    hint: string;
    updatedBy: string;
  }): Promise<INotificationDestination>;
  // Also marks every message still waiting as skipped.
  abstract removeDestination(): Promise<void>;
  abstract recordDelivery(
    at: Date,
    ok: boolean,
    error: string | null,
  ): Promise<void>;

  // ── Retention ─────────────────────────────────────────────────────────
  abstract deleteEventsBefore(cutoff: Date): Promise<number>;
  abstract deleteClosedIncidentsBefore(cutoff: Date): Promise<number>;
}
