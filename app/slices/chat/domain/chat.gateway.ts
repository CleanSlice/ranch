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
 * The contract the domain depends on. The data layer provides the concrete
 * implementation (`ChatGateway`); the service and store know only this
 * abstraction, so the SDK/transport stays swappable and mockable.
 */
export abstract class IChatGateway {
  /**
   * The caller's own conversations, newest first. `archived` picks which
   * ones: the current conversations, or the ones closed by "New chat"
   * (CLEAN-136). The API's filter is exclusive, so it is one or the other.
   */
  abstract listMine(
    page: number,
    perPage: number,
    archived: boolean,
  ): Promise<IChatListResult>;
  abstract getMine(id: string): Promise<IChatSession | null>;
  abstract messages(
    id: string,
    query: IChatMessagesQuery,
  ): Promise<IChatMessagesResult>;
  abstract syncMine(agentId?: string): Promise<IChatSyncResult | null>;
  abstract feedback(id: string): Promise<IChatFeedback[]>;
  abstract rate(id: string, messageId: string, rating: 1 | -1): Promise<void>;
  abstract unrate(id: string, messageId: string): Promise<void>;
  abstract exportChat(
    id: string,
    format: ChatExportFormat,
  ): Promise<IChatExportFile>;
}
