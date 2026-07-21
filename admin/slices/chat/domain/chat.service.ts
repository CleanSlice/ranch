import type { IChatGateway } from './chat.gateway';
import type {
  ChatExportFormat,
  IChatExportFile,
  IChatFeedback,
  IChatListQuery,
  IChatListResult,
  IChatMessagesQuery,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
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

  getById(id: string): Promise<IChatSession | null> {
    return this.gateway.getById(id);
  }

  messages(
    id: string,
    query: IChatMessagesQuery = {},
  ): Promise<IChatMessagesResult> {
    return this.gateway.messages(id, query);
  }

  sync(agentId?: string): Promise<IChatSyncResult | null> {
    return this.gateway.sync(agentId);
  }

  summarize(id: string): Promise<IChatSession | null> {
    return this.gateway.summarize(id);
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
