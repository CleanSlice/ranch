import type { IChatGateway } from './chat.gateway';
import type {
  ChatExportFormat,
  IChatExportFile,
  IChatFeedback,
  IChatListResult,
  IChatMessagesQuery,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
} from './chat.types';

/**
 * Domain service for the current user's chats. Holds the use-case surface the
 * store consumes and owns default query params. Today every method delegates
 * straight to the gateway; cross-cutting rules (caching, event emission,
 * multi-gateway orchestration) would land here without touching callers.
 */
export class ChatService {
  constructor(private gateway: IChatGateway) {}

  listMine(page = 1, perPage = 50): Promise<IChatListResult> {
    return this.gateway.listMine(page, perPage);
  }

  getMine(id: string): Promise<IChatSession | null> {
    return this.gateway.getMine(id);
  }

  messages(
    id: string,
    query: IChatMessagesQuery = {},
  ): Promise<IChatMessagesResult> {
    return this.gateway.messages(id, query);
  }

  // Self-service reconcile — pull the caller's own chats from S3 into the index
  // when realtime indexing hasn't caught up. Server-scoped to the current user.
  syncMine(agentId?: string): Promise<IChatSyncResult | null> {
    return this.gateway.syncMine(agentId);
  }

  feedback(id: string): Promise<IChatFeedback[]> {
    return this.gateway.feedback(id);
  }

  rate(id: string, messageId: string, rating: 1 | -1): Promise<void> {
    return this.gateway.rate(id, messageId, rating);
  }

  unrate(id: string, messageId: string): Promise<void> {
    return this.gateway.unrate(id, messageId);
  }

  exportChat(id: string, format: ChatExportFormat): Promise<IChatExportFile> {
    return this.gateway.exportChat(id, format);
  }
}
