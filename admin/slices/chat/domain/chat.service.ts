import type { IChatGateway } from './chat.gateway';
import type {
  ChatExportFormat,
  ChatScope,
  IChatExportFile,
  IChatFeedback,
  IChatListQuery,
  IChatListResult,
  IChatMessagesQuery,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
  IOwnChatListQuery,
} from './chat.types';

/**
 * Domain service for admin chat inspection. Holds the use-case surface the
 * store consumes and owns default query params. Today every method delegates
 * straight to the gateway; cross-cutting rules would land here without touching
 * callers.
 */
export class ChatService {
  constructor(private gateway: IChatGateway) {}

  list(query: IChatListQuery = {}): Promise<IChatListResult> {
    return this.gateway.list(query);
  }

  listOwn(query: IOwnChatListQuery = {}): Promise<IChatListResult> {
    return this.gateway.listOwn(query);
  }

  getById(
    id: string,
    scope: ChatScope = 'supervised',
  ): Promise<IChatSession | null> {
    return this.gateway.getById(id, scope);
  }

  messages(
    id: string,
    query: IChatMessagesQuery = {},
    scope: ChatScope = 'supervised',
  ): Promise<IChatMessagesResult> {
    return this.gateway.messages(id, query, scope);
  }

  sync(agentId?: string): Promise<IChatSyncResult | null> {
    return this.gateway.sync(agentId);
  }

  summarize(id: string): Promise<IChatSession | null> {
    return this.gateway.summarize(id);
  }

  feedback(id: string, scope: ChatScope = 'supervised'): Promise<IChatFeedback[]> {
    return this.gateway.feedback(id, scope);
  }

  rate(
    id: string,
    messageId: string,
    rating: 1 | -1,
    scope: ChatScope = 'supervised',
  ): Promise<void> {
    return this.gateway.rate(id, messageId, rating, scope);
  }

  unrate(
    id: string,
    messageId: string,
    scope: ChatScope = 'supervised',
  ): Promise<void> {
    return this.gateway.unrate(id, messageId, scope);
  }

  exportChat(
    id: string,
    format: ChatExportFormat,
    scope: ChatScope = 'supervised',
  ): Promise<IChatExportFile> {
    return this.gateway.exportChat(id, format, scope);
  }
}
