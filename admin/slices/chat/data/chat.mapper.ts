import type {
  ChatFeedbackDto,
  ChatListResponseDto,
  ChatMessageDto,
  ChatMessagesResponseDto,
  ChatSessionDto,
  SyncChatsResponseDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IChatFeedback,
  IChatInsights,
  IChatListResult,
  IChatMessage,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
} from '../domain/chat.types';

/**
 * The OpenAPI generator types several free-form nullable string fields
 * (`title`, `preview`, `summary`, `summaryAt`, `nextCursor`, `comment`,
 * `authorId`) as `{ [key: string]: unknown } | null`. Coerce them to a clean
 * `string | null` at the boundary so the domain never sees the generator noise.
 */
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const KNOWN_SENTIMENTS = new Set<IChatInsights['sentiment']>([
  'positive',
  'neutral',
  'negative',
  'mixed',
]);

/**
 * Maps generated chat DTOs onto the slice's domain shapes. The one place in the
 * admin chat slice that imports from `#api`.
 */
export class ChatMapper {
  toList(dto: ChatListResponseDto): IChatListResult {
    return {
      items: dto.items.map((s) => this.toSession(s)),
      total: dto.total,
      page: dto.page,
      perPage: dto.perPage,
    };
  }

  toSession(dto: ChatSessionDto): IChatSession {
    return {
      id: dto.id,
      agentId: dto.agentId,
      channel: dto.channel,
      externalUserId: dto.externalUserId,
      sessionKey: dto.sessionKey,
      title: str(dto.title),
      preview: str(dto.preview),
      lastRole: dto.lastRole ?? null,
      lastMessageAt: dto.lastMessageAt,
      messageCount: dto.messageCount,
      userMessageCount: dto.userMessageCount,
      summary: str(dto.summary),
      summaryAt: str(dto.summaryAt),
      insights: this.toInsights(dto.insights),
      archived: dto.archived,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    };
  }

  toMessages(dto: ChatMessagesResponseDto): IChatMessagesResult {
    return {
      messages: dto.messages.map((m) => this.toMessage(m)),
      nextCursor: str(dto.nextCursor),
      hasMore: dto.hasMore,
    };
  }

  toSync(dto: SyncChatsResponseDto): IChatSyncResult {
    return {
      scannedAgents: dto.scannedAgents,
      scannedFiles: dto.scannedFiles,
      upserted: dto.upserted,
      skipped: dto.skipped,
    };
  }

  toFeedbackList(dtos: ChatFeedbackDto[]): IChatFeedback[] {
    return dtos.map((f) => this.toFeedback(f));
  }

  // ── internals ──────────────────────────────────────────────────────────

  private toInsights(raw: unknown): IChatInsights | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const sentiment = o.sentiment as IChatInsights['sentiment'];
    return {
      topics: Array.isArray(o.topics)
        ? o.topics.filter((t): t is string => typeof t === 'string')
        : [],
      sentiment: KNOWN_SENTIMENTS.has(sentiment) ? sentiment : 'neutral',
      resolved: o.resolved === true,
      language: typeof o.language === 'string' ? o.language : 'unknown',
    };
  }

  // Admin transcripts expose every role, so the DTO union already matches the
  // domain union — pass it through.
  private toMessage(dto: ChatMessageDto): IChatMessage {
    return {
      id: dto.id,
      role: dto.role,
      text: dto.text,
      ts: dto.ts,
    };
  }

  private toFeedback(dto: ChatFeedbackDto): IChatFeedback {
    return {
      id: dto.id,
      messageId: dto.messageId,
      rating: dto.rating,
      comment: str(dto.comment),
      source: dto.source,
      authorId: str(dto.authorId),
      createdAt: dto.createdAt,
    };
  }
}
