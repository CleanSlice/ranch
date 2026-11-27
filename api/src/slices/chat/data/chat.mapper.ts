import { Injectable } from '@nestjs/common';
import { ChatSession, Prisma } from '@prisma/client';
import {
  ChatOutcome,
  ChatSentiment,
  IChatActivity,
  IChatReconcileInput,
  IChatSessionData,
  IChatSessionOutcome,
} from '../domain';

/** The four tones a summary names; anything else in the Json is not one. */
const SENTIMENTS: readonly ChatSentiment[] = [
  'positive',
  'neutral',
  'mixed',
  'negative',
];

/** The columns `findOutcomesForSessions` selects. */
type OutcomeRecord = Pick<
  ChatSession,
  | 'id'
  | 'agentId'
  | 'lastMessageAt'
  | 'userMessageCount'
  | 'summaryAt'
  | 'outcome'
  | 'question'
  | 'topicIds'
  | 'insights'
>;

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
      // A column of text: what is in it is one of the three, written by
      // `saveInsights` or by the migration's backfill.
      outcome: record.outcome as ChatOutcome | null,
      question: record.question,
      topicIds: record.topicIds,
      insightVersion: record.insightVersion,
      archived: record.archived,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * A conversation as a person's statistics read its summary (CLEAN-270).
   * `insights` is Json written by whichever prompt summarised it: the tone
   * and the language are taken when they are what they should be, and
   * nothing else of it is passed on.
   */
  toOutcome(record: OutcomeRecord): IChatSessionOutcome {
    const insights: Prisma.JsonObject =
      record.insights !== null &&
      typeof record.insights === 'object' &&
      !Array.isArray(record.insights)
        ? record.insights
        : {};
    const sentiment = SENTIMENTS.find((s) => s === insights.sentiment);
    const language =
      typeof insights.language === 'string'
        ? insights.language.trim().toLowerCase()
        : '';
    return {
      id: record.id,
      agentId: record.agentId,
      lastMessageAt: record.lastMessageAt,
      userMessageCount: record.userMessageCount,
      summaryAt: record.summaryAt,
      outcome: record.outcome as ChatOutcome | null,
      question: record.question,
      topicIds: record.topicIds,
      sentiment: sentiment ?? null,
      language: language || null,
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

  // First-ever activity for a session → create the row with count 1.
  toActivityCreate(agentId: string, a: IChatActivity) {
    return {
      id: `chat-${crypto.randomUUID()}`,
      agentId,
      channel: a.channel,
      externalUserId: a.externalUserId,
      sessionKey: a.sessionKey,
      preview: a.preview,
      lastRole: a.role,
      lastMessageAt: new Date(a.ts),
      messageCount: 1,
      userMessageCount: a.role === 'user' ? 1 : 0,
      lastIndexedEventId: a.eventId,
      lastIndexedSize: 0, // realtime doesn't know the S3 size; reconcile sets it
      archived: false,
    };
  }

  // Reconcile update: freshness always overwrites; counts are monotonic
  // (never lowered — the existing row's value is the floor).
  toReconcileUpdate(input: IChatReconcileInput, existing: ChatSession) {
    return {
      // The reconcile only updates a row whose file changed, so the
      // transcript has something the settle pass has not read: due again
      // (CLEAN-261). A row it creates starts null, the column has no default.
      activityRebuiltAt: null,
      channel: input.channel,
      externalUserId: input.externalUserId,
      title: input.title ?? existing.title,
      preview: input.preview,
      lastRole: input.lastRole,
      lastMessageAt: input.lastMessageAt,
      archived: input.archived,
      lastIndexedSize: input.size,
      messageCount: Math.max(existing.messageCount, input.messageCount),
      userMessageCount: Math.max(
        existing.userMessageCount,
        input.userMessageCount,
      ),
    };
  }
}
