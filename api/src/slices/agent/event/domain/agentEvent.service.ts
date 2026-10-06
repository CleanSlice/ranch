import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import {
  AgentStatusChanges,
  IAgentGateway,
  IAgentStatusChange,
} from '#/agent/agent/domain';
import { IApiKeyData } from '#/user/apiKey/domain/apiKey.types';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  AgentEventOutcomeTypes,
  ExternalEventStatusTypes,
  FLOOD_LIMIT_PER_MINUTE,
  FLOOD_WINDOW_MS,
  IAgentEventData,
  IAgentIncidentView,
  IEventListFilter,
  IIncidentListFilter,
  IPage,
  RANCH_SENDER_NAME,
} from './agentEvent.types';
import { AgentIncidentService } from './agentIncident.service';
import { AgentNotificationWorker } from './agentNotification.worker';
import { decideDisposition } from './outcome';

export interface IExternalEventInput {
  agentId: string;
  status: ExternalEventStatusTypes;
  datetime?: string;
  reason?: string;
  source?: string;
  eventId?: string;
}

export interface IAcceptedEvent {
  event: IAgentEventData;
  duplicate: boolean;
}

/** 429 with the delay a sender should wait before trying again. */
export class TooManyEventsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many events from this key — at most ${FLOOD_LIMIT_PER_MINUTE} a minute`,
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Takes an event in — from an outside sender, or from Ranch's own watch —
 * decides once what it does, and stores it. An event informs: nothing here
 * writes an agent's status. That stays with AgentStatusService, which knows
 * about restarts, stale pods and grace windows an outside sender does not.
 */
@Injectable()
export class AgentEventService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentEventService.name);
  private statusSub: Subscription | null = null;

  constructor(
    private readonly gateway: IAgentEventGateway,
    private readonly incidents: AgentIncidentService,
    private readonly agents: IAgentGateway,
    private readonly statusChanges: AgentStatusChanges,
    private readonly worker: AgentNotificationWorker,
  ) {}

  onModuleInit(): void {
    this.statusSub = this.statusChanges.changes$().subscribe((change) => {
      // An error here must cost this one change, never the subscription:
      // a rejected handler inside `subscribe` would otherwise end it for
      // every later transition.
      void this.onStatusChange(change).catch((err) =>
        this.logger.warn(
          `Could not record status change of agent ${change.agentId}: ${(err as Error).message}`,
        ),
      );
    });
  }

  onModuleDestroy(): void {
    this.statusSub?.unsubscribe();
  }

  async acceptExternal(
    apiKey: IApiKeyData,
    input: IExternalEventInput,
  ): Promise<IAcceptedEvent> {
    const receivedAt = new Date();

    // Counted in the database, not in memory: a per-process counter would
    // allow the limit once per API replica and forget it on every deploy.
    const windowStart = new Date(receivedAt.getTime() - FLOOD_WINDOW_MS);
    const recent = await this.gateway.countEventsByKeySince(
      apiKey.id,
      windowStart,
    );
    if (recent >= FLOOD_LIMIT_PER_MINUTE) {
      const oldest = await this.gateway.oldestEventAtByKeySince(
        apiKey.id,
        windowStart,
      );
      const freesAt = (oldest ?? receivedAt).getTime() + FLOOD_WINDOW_MS;
      throw new TooManyEventsException(
        Math.max(1, Math.ceil((freesAt - receivedAt.getTime()) / 1000)),
      );
    }

    const dedupeKey = this.dedupeKeyOf(apiKey.id, input);
    if (dedupeKey) {
      const first = await this.gateway.findEventByDedupeKey(dedupeKey);
      if (first) return { event: first, duplicate: true };
    }

    const agent = await this.agents.findById(input.agentId);
    const occurredAt = input.datetime ? new Date(input.datetime) : receivedAt;
    const reason = input.reason?.trim() ? input.reason : null;
    const tool = input.source?.trim() ? input.source.trim() : null;

    const disposition = decideDisposition({
      status: input.status,
      witness: 'external',
      agentFound: agent !== null,
      ranchStatus: agent?.status ?? null,
    });

    let outcome: AgentEventOutcomeTypes;
    let incidentId: string | null = null;
    if (disposition === 'incident' && agent) {
      const attached = await this.incidents.attachFailure({
        agentId: agent.id,
        agentName: agent.name,
        status: 'failed',
        reason,
        witness: 'external',
        senderName: apiKey.name,
        tool,
        ranchStatus: agent.status,
        occurredAt,
        receivedAt,
      });
      outcome = attached.outcome;
      incidentId = attached.incidentId;
    } else {
      outcome = disposition as AgentEventOutcomeTypes;
      // A recovery report is filed with the incident it speaks about, if one
      // is open — it changes nothing there.
      if (disposition === 'evidence' && agent) {
        incidentId = (await this.gateway.findOpenIncident(agent.id))?.id ?? null;
      }
    }

    const event = await this.gateway.createEvent({
      agentId: agent?.id ?? null,
      agentRef: input.agentId,
      agentName: agent?.name ?? null,
      status: input.status,
      reason,
      witness: 'external',
      apiKeyId: apiKey.id,
      // Who sent it is the key, never what the body says about itself.
      senderName: apiKey.name,
      tool,
      ranchStatus: agent?.status ?? null,
      outcome,
      incidentId,
      occurredAt,
      receivedAt,
      dedupeKey,
    });
    if (outcome === 'opened') this.worker.kick();

    if (!event) {
      // The same event arrived twice at once and the other copy won.
      const first = dedupeKey
        ? await this.gateway.findEventByDedupeKey(dedupeKey)
        : null;
      if (!first) throw new Error('event was neither stored nor found');
      return { event: first, duplicate: true };
    }
    return { event, duplicate: false };
  }

  /**
   * A failure Ranch noticed itself. Its transitions to 'failed' and
   * 'unreachable' are already filtered for restarts, stops and stale pods, so
   * every one of them is a real failure as far as the product knows.
   */
  async recordRanchFailure(change: IAgentStatusChange): Promise<void> {
    if (change.status !== 'failed' && change.status !== 'unreachable') return;
    const agent = await this.agents.findById(change.agentId);
    if (!agent) return;

    const attached = await this.incidents.attachFailure({
      agentId: agent.id,
      agentName: agent.name,
      status: change.status,
      reason: change.reason,
      witness: 'ranch',
      senderName: RANCH_SENDER_NAME,
      tool: null,
      ranchStatus: change.status,
      occurredAt: change.at,
      receivedAt: change.at,
    });
    await this.gateway.createEvent({
      agentId: agent.id,
      agentRef: agent.id,
      agentName: agent.name,
      status: change.status,
      reason: change.reason,
      witness: 'ranch',
      apiKeyId: null,
      senderName: RANCH_SENDER_NAME,
      tool: null,
      ranchStatus: change.status,
      outcome: attached.outcome,
      incidentId: attached.incidentId,
      occurredAt: change.at,
      receivedAt: change.at,
      dedupeKey: null,
    });
    if (attached.outcome === 'opened') this.worker.kick();
  }

  listEvents(filter: IEventListFilter): Promise<IPage<IAgentEventData>> {
    return this.gateway.listEvents(filter);
  }

  listIncidents(
    filter: IIncidentListFilter,
  ): Promise<IPage<IAgentIncidentView>> {
    return this.gateway.listIncidents(filter);
  }

  private async onStatusChange(change: IAgentStatusChange): Promise<void> {
    if (change.status === 'failed' || change.status === 'unreachable') {
      await this.recordRanchFailure(change);
    } else if (change.status === 'running') {
      await this.incidents.noteRunning(change.agentId, change.at);
    }
    // 'stopped' and 'deleted' need nothing here: the sweep reads the agent
    // as it is and closes the incident quietly.
  }

  /**
   * What makes a retry the same event. With an `eventId` the sender says so;
   * with a `datetime` the same agent, status and moment from the same key is
   * the same event. With neither, two identical bodies cannot be told from
   * two failures, so they are two events.
   */
  private dedupeKeyOf(
    apiKeyId: string,
    input: IExternalEventInput,
  ): string | null {
    if (input.eventId?.trim()) return `${apiKeyId}:id:${input.eventId.trim()}`;
    if (input.datetime) {
      const at = new Date(input.datetime).toISOString();
      return `${apiKeyId}:at:${input.agentId}:${input.status}:${at}`;
    }
    return null;
  }
}
