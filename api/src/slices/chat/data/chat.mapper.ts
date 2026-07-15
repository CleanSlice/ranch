import { Injectable } from '@nestjs/common';
import { ChatSession } from '@prisma/client';
import { IChatReconcileInput, IChatSessionData } from '../domain';

@Injectable()
export class ChatMapper {
  toEntity(record: ChatSession): IChatSessionData {
    return {
      id: record.id,
      agentId: record.agentId,
      channel: record.channel,
      externalUserId: record.externalUserId,
      sessionKey: record.sessionKey,
      title: record.title,
      preview: record.preview,
      lastRole: record.lastRole,
      lastMessageAt: record.lastMessageAt,
      messageCount: record.messageCount,
      userMessageCount: record.userMessageCount,
      lastIndexedEventId: record.lastIndexedEventId,
      lastIndexedSize: record.lastIndexedSize,
      summary: record.summary,
      summaryAt: record.summaryAt,
      insights: record.insights,
      archived: record.archived,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(input: IChatReconcileInput) {
    return {
      id: `chat-${crypto.randomUUID()}`,
      agentId: input.agentId,
      channel: input.channel,
      externalUserId: input.externalUserId,
      sessionKey: input.sessionKey,
      title: input.title,
      preview: input.preview,
      lastRole: input.lastRole,
      lastMessageAt: input.lastMessageAt,
      messageCount: input.messageCount,
      userMessageCount: input.userMessageCount,
      lastIndexedSize: input.size,
      archived: input.archived,
    };
  }

  // Reconcile update: freshness always overwrites; counts are monotonic
  // (never lowered — the existing row's value is the floor).
  toReconcileUpdate(input: IChatReconcileInput, existing: ChatSession) {
    return {
      channel: input.channel,
      externalUserId: input.externalUserId,
      title: input.title ?? existing.title,
      preview: input.preview,
      lastRole: input.lastRole,
      lastMessageAt: input.lastMessageAt,
      archived: input.archived,
      lastIndexedSize: input.size,
      messageCount: Math.max(existing.messageCount, input.messageCount),
      userMessageCount: Math.max(existing.userMessageCount, input.userMessageCount),
    };
  }
}
