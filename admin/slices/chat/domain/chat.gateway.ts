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
 * The contract the domain depends on. The data layer provides the concrete
 * implementation (`ChatGateway`); the service and store know only this
 * abstraction, so the SDK/transport stays swappable and mockable.
 */
export abstract class IChatGateway {
  abstract list(query: IChatListQuery): Promise<IChatListResult>;
  abstract getById(id: string): Promise<IChatSession | null>;
  abstract messages(
    id: string,
    query: IChatMessagesQuery,
  ): Promise<IChatMessagesResult>;
  abstract sync(agentId?: string): Promise<IChatSyncResult | null>;
  abstract summarize(id: string): Promise<IChatSession | null>;
  abstract feedback(id: string): Promise<IChatFeedback[]>;
  abstract rate(id: string, messageId: string, rating: 1 | -1): Promise<void>;
  abstract unrate(id: string, messageId: string): Promise<void>;
  abstract exportChat(
    id: string,
    format: ChatExportFormat,
  ): Promise<IChatExportFile>;
}
