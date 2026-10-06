import { Injectable } from '@nestjs/common';
import type {
  AgentEvent,
  AgentEventDestination,
  AgentIncident,
  AgentNotification,
} from '@prisma/client';
import {
  AgentEventOutcomeTypes,
  AgentEventStatusTypes,
  AgentEventWitnessTypes,
  IAgentEventData,
  IAgentIncidentData,
  IAgentNotificationData,
  IAgentNotificationSummary,
  INotificationDestination,
  INotificationPayload,
  IncidentResolutionTypes,
  NotificationKindTypes,
  NotificationStatusTypes,
} from '../domain/agentEvent.types';

@Injectable()
export class AgentEventMapper {
  toEvent(record: AgentEvent): IAgentEventData {
    return {
      id: record.id,
      agentId: record.agentId,
      agentRef: record.agentRef,
      agentName: record.agentName,
      status: record.status as AgentEventStatusTypes,
      reason: record.reason,
      witness: record.witness as AgentEventWitnessTypes,
      apiKeyId: record.apiKeyId,
      senderName: record.senderName,
      tool: record.tool,
      ranchStatus: record.ranchStatus,
      outcome: record.outcome as AgentEventOutcomeTypes,
      incidentId: record.incidentId,
      occurredAt: record.occurredAt,
      receivedAt: record.receivedAt,
    };
  }

  toIncident(record: AgentIncident): IAgentIncidentData {
    return {
      id: record.id,
      agentId: record.agentId,
      agentName: record.agentName,
      open: record.openKey !== null,
      status: record.status as 'failed' | 'unreachable',
      reason: record.reason,
      ranchWitnessed: record.ranchWitnessed,
      witnesses: record.witnesses,
      eventCount: record.eventCount,
      openedAt: record.openedAt,
      lastFailureAt: record.lastFailureAt,
      upSince: record.upSince,
      closedAt: record.closedAt,
      resolution: record.resolution as IncidentResolutionTypes | null,
    };
  }

  toNotification(record: AgentNotification): IAgentNotificationData {
    return {
      id: record.id,
      incidentId: record.incidentId,
      kind: record.kind as NotificationKindTypes,
      payload: record.payload as unknown as INotificationPayload,
      status: record.status as NotificationStatusTypes,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt,
      createdAt: record.createdAt,
    };
  }

  toNotificationSummary(record: AgentNotification): IAgentNotificationSummary {
    return {
      kind: record.kind as NotificationKindTypes,
      status: record.status as NotificationStatusTypes,
      attempts: record.attempts,
      sentAt: record.sentAt,
      lastError: record.lastError,
    };
  }

  toDestination(record: AgentEventDestination): INotificationDestination {
    return {
      kind: 'slack',
      webhookUrl: record.webhookUrl,
      hint: record.hint,
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt,
      lastDeliveryAt: record.lastDeliveryAt,
      lastDeliveryOk: record.lastDeliveryOk,
      lastDeliveryError: record.lastDeliveryError,
    };
  }
}
