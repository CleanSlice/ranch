import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  IAgentNotificationData,
  INCIDENT_SWEEP_MS,
  NOTIFICATION_LOCK_MS,
  OUTBOX_TICK_MS,
  RETENTION_DAYS,
  RETENTION_SWEEP_MS,
  RETRY_DELAYS_MS,
} from './agentEvent.types';
import { AgentIncidentService } from './agentIncident.service';
import { NotificationDestinationService } from './notificationDestination.service';
import { renderClosed, renderOpened } from './notificationText';
import { INotifier } from './notifier';

// A tick that finds a backlog (a fleet-wide failure) sends this many and
// leaves the rest to the next one, so one tick cannot run for minutes.
const DRAIN_BATCH = 20;

const DAY_MS = 24 * 60 * 60_000;

/**
 * The three things this feature does on a clock:
 *
 * - **the outbox** — sends queued messages, retrying on a schedule, so the
 *   sender's answer never waits for Slack and Slack being down loses nothing;
 * - **the incident sweep** — closes incidents whose agent has been running
 *   for ten quiet minutes (AgentIncidentService.sweep);
 * - **retention** — drops history older than RETENTION_DAYS.
 *
 * Every replica runs all three. Each step is safe to run twice at once: a
 * message is claimed by a conditional update, an incident is closed by one,
 * a delete is a delete.
 *
 * Ranch has no scheduler facility, so these are plain `setInterval`s in an
 * OnModuleInit service — the pattern of indexReconcile.service and
 * agentStatus.service's driftTimer.
 */
@Injectable()
export class AgentNotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentNotificationWorker.name);
  private timers: ReturnType<typeof setInterval>[] = [];
  private draining = false;
  private sweeping = false;

  constructor(
    private readonly gateway: IAgentEventGateway,
    private readonly notifier: INotifier,
    private readonly destinations: NotificationDestinationService,
    private readonly incidents: AgentIncidentService,
  ) {}

  onModuleInit(): void {
    this.every(OUTBOX_TICK_MS, 'outbox', () => this.drainOutbox());
    this.every(INCIDENT_SWEEP_MS, 'incident sweep', () =>
      this.sweepIncidents(),
    );
    this.every(RETENTION_SWEEP_MS, 'retention', () => this.purge());
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
  }

  /** A message was just queued — do not make it wait for the next tick. */
  kick(): void {
    void this.drainOutbox().catch((err) =>
      this.logger.warn(`outbox kick failed: ${(err as Error).message}`),
    );
  }

  /** Sends what is due. Returns how many messages were attempted. */
  async drainOutbox(now: () => Date = () => new Date()): Promise<number> {
    // Ticks must not overlap: a slow Slack would otherwise stack them up.
    if (this.draining) return 0;
    this.draining = true;
    let attempted = 0;
    try {
      while (attempted < DRAIN_BATCH) {
        const at = now();
        const notification = await this.gateway.claimDueNotification(
          at,
          new Date(at.getTime() + NOTIFICATION_LOCK_MS),
        );
        if (!notification) break;
        attempted += 1;
        await this.deliver(notification, now);
      }
    } finally {
      this.draining = false;
    }
    return attempted;
  }

  async sweepIncidents(now: Date = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const queued = await this.incidents.sweep(now);
      if (queued > 0) this.kick();
      return queued;
    } finally {
      this.sweeping = false;
    }
  }

  async purge(now: Date = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    const events = await this.gateway.deleteEventsBefore(cutoff);
    const incidents = await this.gateway.deleteClosedIncidentsBefore(cutoff);
    if (events > 0 || incidents > 0) {
      this.logger.log(
        `Retention: removed ${events} event(s) and ${incidents} closed incident(s) older than ${RETENTION_DAYS} days`,
      );
    }
  }

  private async deliver(
    notification: IAgentNotificationData,
    now: () => Date,
  ): Promise<void> {
    const destination = await this.gateway.getDestination();
    if (!destination) {
      // Stored and shown in the console; nobody outside it to tell.
      await this.gateway.markNotificationSkipped(notification.id);
      return;
    }

    const message =
      notification.payload.kind === 'opened'
        ? renderOpened(notification.payload, this.destinations.consoleUrl())
        : renderClosed(notification.payload);
    const result = await this.notifier.send(destination.webhookUrl, message);
    const at = now();

    if (result.ok) {
      await this.gateway.markNotificationSent(notification.id, at);
      await this.gateway.recordDelivery(at, true, null);
      return;
    }

    await this.gateway.recordDelivery(at, false, result.error);
    const attempts = notification.attempts + 1;
    if (!result.retryable || attempts >= RETRY_DELAYS_MS.length) {
      this.logger.warn(
        `Notification ${notification.id} not delivered after ${attempts} attempt(s): ${result.error}`,
      );
      await this.gateway.markNotificationFailed(
        notification.id,
        attempts,
        result.error,
      );
      return;
    }

    // The wait is the gap between this slot of the schedule and the next,
    // counted from the attempt that just failed — not from when the message
    // was queued. Counted from the queue time, a message that comes due late
    // (the API was down for twenty minutes) would find every earlier slot
    // already in the past and fire its retries back to back. A destination
    // that names its own delay ("come back in 30 s") is believed when that
    // is longer.
    const gap = RETRY_DELAYS_MS[attempts] - RETRY_DELAYS_MS[attempts - 1];
    await this.gateway.markNotificationRetry(
      notification.id,
      attempts,
      new Date(at.getTime() + Math.max(gap, result.retryAfterMs ?? 0)),
      result.error,
    );
  }

  private every(ms: number, name: string, run: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      void run().catch((err) =>
        this.logger.warn(`${name} failed: ${(err as Error).message}`),
      );
    }, ms);
    // Nothing here should keep the process alive on its own.
    timer.unref?.();
    this.timers.push(timer);
  }
}
