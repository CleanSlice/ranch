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
 * The contract the domain depends on. The data layer provides the concrete
 * implementation (`ChatGateway`); the service and store know only this
 * abstraction, so the SDK/transport stays swappable and mockable.
 */
export abstract class IChatGateway {
  abstract list(query: IChatListQuery): Promise<IChatListResult>;
  /** The viewer's own conversations (`/me/chats`). */
  abstract listOwn(query: IOwnChatListQuery): Promise<IChatListResult>;
  /** Null when the API answers "not found"; any other failure is thrown. */
  abstract getById(id: string, scope: ChatScope): Promise<IChatSession | null>;
  abstract messages(
    id: string,
    query: IChatMessagesQuery,
    scope: ChatScope,
  ): Promise<IChatMessagesResult>;
  abstract sync(agentId?: string): Promise<IChatSyncResult | null>;
  abstract summarize(id: string): Promise<IChatSession | null>;
  abstract feedback(id: string, scope: ChatScope): Promise<IChatFeedback[]>;
  abstract rate(
    id: string,
    messageId: string,
    rating: 1 | -1,
    scope: ChatScope,
  ): Promise<void>;
  abstract unrate(id: string, messageId: string, scope: ChatScope): Promise<void>;
  abstract exportChat(
    id: string,
    format: ChatExportFormat,
    scope: ChatScope,
  ): Promise<IChatExportFile>;
}
