import type {
  AgentEventDto,
  AgentEventPageDto,
  AgentIncidentDto,
  AgentIncidentPageDto,
  NotificationDestinationDto,
  TestDeliveryDto,
} from '#api/data';
import type {
  IAgentEvent,
  IAgentEventPage,
  IAgentIncident,
  IAgentIncidentPage,
  INotificationDestination,
  ITestDelivery,
} from '../domain/agentEvent.types';

/**
 * DTO → domain for agent events. Copies field by field so a field the API
 * adds later does not ride into the store unseen, and fills the gaps an older
 * API would leave (`witnesses`, `notifications`) so components never guard
 * for `undefined`. Sender-supplied text is passed through untouched.
 */
export class AgentEventMapper {
  toEvent(dto: AgentEventDto): IAgentEvent {
    return {
      id: dto.id,
      agentId: dto.agentId ?? null,
      agentRef: dto.agentRef,
      agentName: dto.agentName ?? null,
      status: dto.status,
      reason: dto.reason ?? null,
      witness: dto.witness,
      senderName: dto.senderName,
      tool: dto.tool ?? null,
      ranchStatus: dto.ranchStatus ?? null,
      outcome: dto.outcome,
      incidentId: dto.incidentId ?? null,
      occurredAt: dto.occurredAt,
      receivedAt: dto.receivedAt,
    };
  }

  toEventPage(dto: AgentEventPageDto | null): IAgentEventPage {
    return {
      items: (dto?.items ?? []).map((item) => this.toEvent(item)),
      nextCursor: dto?.nextCursor ?? null,
    };
  }

  toIncident(dto: AgentIncidentDto): IAgentIncident {
    return {
      id: dto.id,
      agentId: dto.agentId ?? null,
      agentName: dto.agentName,
      state: dto.state,
      status: dto.status,
      reason: dto.reason ?? null,
      witnesses: dto.witnesses ?? [],
      ranchWitnessed: dto.ranchWitnessed === true,
      eventCount: dto.eventCount ?? 0,
      openedAt: dto.openedAt,
      lastFailureAt: dto.lastFailureAt,
      upSince: dto.upSince ?? null,
      closedAt: dto.closedAt ?? null,
      resolution: dto.resolution ?? null,
      notifications: (dto.notifications ?? []).map((n) => ({
        kind: n.kind,
        status: n.status,
        attempts: n.attempts ?? 0,
        sentAt: n.sentAt ?? null,
        lastError: n.lastError ?? null,
      })),
    };
  }

  toIncidentPage(dto: AgentIncidentPageDto | null): IAgentIncidentPage {
    return {
      items: (dto?.items ?? []).map((item) => this.toIncident(item)),
      nextCursor: dto?.nextCursor ?? null,
    };
  }

  toDestination(dto: NotificationDestinationDto): INotificationDestination {
    return {
      configured: dto.configured === true,
      kind: dto.kind,
      hint: dto.hint ?? null,
      updatedBy: dto.updatedBy ?? null,
      updatedAt: dto.updatedAt ?? null,
      consoleLinks: dto.consoleLinks === true,
      lastDelivery: dto.lastDelivery
        ? {
            at: dto.lastDelivery.at,
            ok: dto.lastDelivery.ok === true,
            error: dto.lastDelivery.error ?? null,
          }
        : null,
    };
  }

  toTestDelivery(dto: TestDeliveryDto): ITestDelivery {
    return { delivered: dto.delivered === true, error: dto.error ?? null };
  }
}
