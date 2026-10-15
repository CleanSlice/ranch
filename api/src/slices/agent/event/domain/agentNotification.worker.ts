import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  IAgentIncidentData,
  IAgentNotificationData,
  INCIDENT_SWEEP_MS,
  INotificationDestination,
  NOTIFICATION_LOCK_MS,
  OUTBOX_TICK_MS,
  RETENTION_DAYS,
  RETENTION_SWEEP_MS,
  RETRY_DELAYS_MS,
} from './agentEvent.types';
import { AgentIncidentService } from './agentIncident.service';
import { NotificationDestinationService } from './notificationDestination.service';
import {
  renderClosed,
  renderOpened,
  renderReply,
  renderRoot,
  rootStateOf,
} from './notificationText';
import {
  INotifier,
  ISlackBotCredentials,
  ISlackBotNotifier,
  NotifyResultTypes,
} from './notifier';

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
 *   for ten quiet minutes (AgentIncidentService.sweep), and on the bot
 *   transport rewrites roots whose count fell behind;
 * - **retention** — drops history older than RETENTION_DAYS.
 *
 * Every replica runs all three. Each step is safe to run twice at once: a
 * message is claimed by a conditional update, an incident is closed by one,
 * a delete is a delete, a root rewrite renders from the row.
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
    private readonly bot: ISlackBotNotifier,
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
      await this.rewriteStaleRoots(now);
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

  /**
   * A report swallowed by the one-reply-a-minute rule moved the count but
   * nothing was delivered to carry the rewrite; the sweep carries it. At
   * most one rewrite per incident per sweep, whatever the flood.
   */
  async rewriteStaleRoots(now: Date = new Date()): Promise<number> {
    const stale = await this.gateway.listStaleBotIncidents();
    if (stale.length === 0) return 0;
    const destination = await this.gateway.getDestination();
    const cred = destination && this.destinations.botCredentials(destination);
    const environment = await this.destinations.environment();
    let rewritten = 0;
    for (const incident of stale) {
      // The flag is cleared first: a report arriving during the rewrite sets
      // it again and the next sweep catches it.
      await this.gateway.clearRootStale(incident.id);
      if (!cred) continue;
      const error = await this.rewriteRoot(cred, incident, environment);
      if (error) await this.gateway.recordDelivery(now, false, error);
      else rewritten += 1;
    }
    return rewritten;
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

    const incident = await this.gateway.findIncidentById(
      notification.incidentId,
    );
    if (!incident) {
      await this.gateway.markNotificationSkipped(notification.id);
      return;
    }

    // An incident finishes on the transport it started on (FR-022). One
    // that opened with no destination at all takes whatever is set now.
    const transport = incident.transport ?? destination.kind;
    const cred = this.destinations.botCredentials(destination);
    const environment = await this.destinations.environment();
    let sideEffect: string | null = null;
    // A bot incident whose bot is gone (the owner switched to the webhook
    // and the token with it) has no thread to speak in: its rows are skipped
    // rather than spoken through the other transport.
    const result =
      transport === 'bot'
        ? cred
          ? await this.deliverBot(
              cred,
              incident,
              notification,
              environment,
              (error) => {
                sideEffect = error;
              },
            )
          : 'silent'
        : await this.deliverWebhook(destination, notification, environment);
    if (result === 'silent') {
      // A row the current transport has nothing to say for (a webhook
      // asked to speak mid-incident, or a bot row with no bot any more).
      await this.gateway.markNotificationSkipped(notification.id);
      return;
    }
    await this.settle(notification, result, now);
    // After the delivery's own record, so a lost rewrite is what the owner
    // sees last — the reply itself went through (FR-020).
    if (sideEffect) await this.gateway.recordDelivery(now(), false, sideEffect);
  }

  /** Today's two messages, unchanged (SC-004). */
  private async deliverWebhook(
    destination: INotificationDestination,
    notification: IAgentNotificationData,
    environment: string | null,
  ): Promise<NotifyResultTypes | 'silent'> {
    const { payload } = notification;
    if (!destination.webhookUrl) return 'silent';
    if (payload.kind === 'opened') {
      return this.notifier.send(
        destination.webhookUrl,
        renderOpened(payload, this.destinations.consoleUrl(), environment),
      );
    }
    if (
      payload.kind === 'closed' &&
      (payload.resolution === 'recovered' ||
        payload.resolution === 'unconfirmed')
    ) {
      return this.notifier.send(
        destination.webhookUrl,
        renderClosed(payload, environment),
      );
    }
    return 'silent';
  }

  /**
   * The bot transport, step by step (contracts/slack-bot.md): the root once
   * — posted by whichever delivery finds it missing, so a late root arrives
   * already in its final state — then this row's reply in the thread, then
   * the root rewritten and its reaction swapped from the incident as it is
   * now. The reply is the delivery; the rewrite and the reaction are side
   * effects whose failure is recorded, not retried (FR-020).
   */
  private async deliverBot(
    cred: ISlackBotCredentials,
    incident: IAgentIncidentData,
    notification: IAgentNotificationData,
    environment: string | null,
    onSideEffectError: (error: string) => void,
  ): Promise<NotifyResultTypes> {
    let current = incident;
    if (!current.slackTs) {
      // The mention is for an alarm. A root that could only be posted after
      // the incident closed (Slack was down throughout) is history, not news.
      const root = await this.bot.post(
        cred,
        renderRoot(current, this.destinations.consoleUrl(), {
          mention: notification.kind === 'opened' && current.open,
          environment,
        }),
      );
      if (!root.ok) return root;
      await this.gateway.setIncidentRoot(current.id, cred.channelId, root.ts);
      current = { ...current, slackChannel: cred.channelId, slackTs: root.ts };
      // A retry that finds the root in place skips straight to the reply.
    }

    const reply = await this.bot.post(
      { ...cred, channelId: current.slackChannel ?? cred.channelId },
      renderReply(notification.payload),
      current.slackTs!,
    );
    if (!reply.ok) return reply;

    // Rendered from the row as it is after this row's cause took effect —
    // not from the payload — so whichever rewrite lands last is right.
    const fresh = (await this.gateway.findIncidentById(current.id)) ?? current;
    const error = await this.rewriteRoot(
      { ...cred, channelId: fresh.slackChannel ?? cred.channelId },
      fresh,
      environment,
      // The very first delivery may legitimately keep the mention: the root
      // was just posted with it and nothing has changed since.
      notification.kind === 'opened' && fresh.open && !fresh.upSince,
    );
    if (error) onSideEffectError(error);
    return { ok: true };
  }

  /**
   * Rewrites the root and settles the reaction. Returns the first error, or
   * null when both landed; the caller decides where the error goes.
   */
  private async rewriteRoot(
    cred: ISlackBotCredentials,
    incident: IAgentIncidentData,
    environment: string | null,
    keepMention = false,
  ): Promise<string | null> {
    if (!incident.slackTs) return 'no root message to rewrite';
    let error: string | null = null;
    const updated = await this.bot.update(
      cred,
      incident.slackTs,
      renderRoot(incident, this.destinations.consoleUrl(), {
        mention: keepMention,
        environment,
      }),
    );
    if (!updated.ok) error = updated.error;
    const wanted = rootStateOf(incident).reaction;
    if (wanted !== incident.slackReaction) {
      const reacted = await this.bot.setReaction(
        cred,
        incident.slackTs,
        wanted,
        incident.slackReaction,
      );
      if (reacted.ok) {
        await this.gateway.setIncidentReaction(incident.id, wanted);
      } else {
        error ??= reacted.error;
      }
    }
    return error;
  }

  private async settle(
    notification: IAgentNotificationData,
    result: NotifyResultTypes,
    now: () => Date,
  ): Promise<void> {
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
      run().catch((err) =>
        this.logger.warn(`${name} failed: ${(err as Error).message}`),
      );
    }, ms);
    // Never keep the process alive for a timer.
    timer.unref?.();
    this.timers.push(timer);
  }
}
