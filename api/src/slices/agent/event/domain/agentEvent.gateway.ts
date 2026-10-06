import {
  IAgentEventData,
  IAgentIncidentData,
  IAgentIncidentView,
  IAgentNotificationData,
  IClosedNotificationPayload,
  ICreateAgentEventData,
  IEventListFilter,
  IIncidentListFilter,
  INotificationDestination,
  IOpenedNotificationPayload,
  IOpenIncidentInput,
  IOpenIncidentWithAgent,
  IncidentResolutionTypes,
  IPage,
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
  // Inserts the incident and its opening message in one transaction.
  // `null` ⇒ another event opened one for this agent first.
  abstract openIncident(
    input: IOpenIncidentInput,
    payload: IOpenedNotificationPayload,
  ): Promise<IAgentIncidentData | null>;
  // Counts the report, adds its sender to the witnesses and restarts the
  // quiet period. false ⇒ the incident closed in the meantime.
  abstract touchIncidentFailure(
    id: string,
    at: Date,
    ranchWitnessed: boolean,
    senderName: string,
  ): Promise<boolean>;
  // A report filed with an incident without changing where it stands (a
  // `recovered` from outside): counted and its sender remembered, no more.
  abstract noteIncidentReport(id: string, senderName: string): Promise<void>;
  abstract setIncidentUpSince(agentId: string, at: Date): Promise<void>;
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

  // ── Notifications (the outbox) ────────────────────────────────────────
  // Takes one due message for this process, or null. Two replicas asking at
  // once get different rows, or one of them gets nothing.
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
  // The only read that returns the address. For the notifier, nothing else.
  abstract getDestination(): Promise<INotificationDestination | null>;
  abstract saveDestination(input: {
    webhookUrl: string;
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
