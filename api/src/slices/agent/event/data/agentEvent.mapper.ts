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
  DestinationKindTypes,
  SlackReactionTypes,
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
      number: record.number,
      agentId: record.agentId,
      agentName: record.agentName,
      open: record.openKey !== null,
      transport: record.transport as DestinationKindTypes | null,
      slackChannel: record.slackChannel,
      slackTs: record.slackTs,
      slackReaction: record.slackReaction as SlackReactionTypes | null,
      notificationSeq: record.notificationSeq,
      lastJoinedNotifiedAt: record.lastJoinedNotifiedAt,
      rootStale: record.rootStale,
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
      seq: record.seq,
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
      // Rows written before CLEAN-165 say 'slack'; the migration rewrites
      // them, and anything that is not the bot reads as the webhook anyway.
      kind: record.kind === 'bot' ? 'bot' : 'webhook',
      webhookUrl: record.webhookUrl,
      botToken: record.botToken,
      channelId: record.channelId,
      hint: record.hint,
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt,
      lastDeliveryAt: record.lastDeliveryAt,
      lastDeliveryOk: record.lastDeliveryOk,
      lastDeliveryError: record.lastDeliveryError,
    };
  }
}
