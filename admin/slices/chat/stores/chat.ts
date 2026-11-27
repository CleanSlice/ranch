import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ChatService } from '#chat/domain';
import type {
  ChatExportFormat,
  ChatScope,
  IChatListQuery,
  IChatMessagesQuery,
  IOwnChatListQuery,
} from '#chat/domain';

// Re-export the domain types so existing consumers that import them from
// `#chat/stores/chat` (chatList/chatDetail Providers, Bubble) keep working.
export type {
  ChatChannel,
  ChatExportFormat,
  ChatMessageRole,
  ChatScope,
  IChatExportFile,
  IChatFeedback,
  IChatInsights,
  IChatListQuery,
  IChatListResult,
  IChatMessage,
  IChatMessagesQuery,
  IChatMessagesResult,
  IChatSession,
  IChatSyncResult,
  IOwnChatListQuery,
} from '#chat/domain';

const getService = createServiceGetter<ChatService>('$chatService');

/** Save an already-fetched blob to disk (client-only DOM side effect). */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * UI-facing facade over `ChatService`. Keeps the same method surface the chat
 * components already call; transport, DTO mapping and envelope-unwrapping now
 * live in the data layer behind the service.
 */
export const useChatStore = defineStore('chat', () => {
  function list(query: IChatListQuery = {}) {
    return getService().list(query);
  }

  /** The viewer's own conversations (CLEAN-269). */
  function listOwn(query: IOwnChatListQuery = {}) {
    return getService().listOwn(query);
  }

  /** Null when the API says "not found"; a failure is thrown. */
  function getById(id: string, scope: ChatScope = 'supervised') {
    return getService().getById(id, scope);
  }

  function messages(
    id: string,
    query: IChatMessagesQuery = {},
    scope: ChatScope = 'supervised',
  ) {
    return getService().messages(id, query, scope);
  }

  function sync(agentId?: string) {
    return getService().sync(agentId);
  }

  function summarize(id: string) {
    return getService().summarize(id);
  }

  function feedback(id: string, scope: ChatScope = 'supervised') {
    return getService().feedback(id, scope);
  }

  function rate(
    id: string,
    messageId: string,
    rating: 1 | -1,
    scope: ChatScope = 'supervised',
  ) {
    return getService().rate(id, messageId, rating, scope);
  }

  function unrate(id: string, messageId: string, scope: ChatScope = 'supervised') {
    return getService().unrate(id, messageId, scope);
  }

  async function exportChat(
    id: string,
    format: ChatExportFormat,
    scope: ChatScope = 'supervised',
  ) {
    const { blob, filename } = await getService().exportChat(id, format, scope);
    triggerDownload(blob, filename);
  }

  return {
    list,
    listOwn,
    getById,
    messages,
    sync,
    summarize,
    feedback,
    rate,
    unrate,
    exportChat,
  };
});
