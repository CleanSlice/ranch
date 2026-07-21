import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ChatService } from '#chat/domain';
import type {
  ChatExportFormat,
  IChatListQuery,
  IChatMessagesQuery,
} from '#chat/domain';

// Re-export the domain types so existing consumers that import them from
// `#chat/stores/chat` (chatList/chatDetail Providers, Bubble) keep working.
export type {
  ChatChannel,
  ChatExportFormat,
  ChatMessageRole,
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

  function getById(id: string) {
    return getService().getById(id);
  }

  function messages(id: string, query: IChatMessagesQuery = {}) {
    return getService().messages(id, query);
  }

  function sync(agentId?: string) {
    return getService().sync(agentId);
  }

  function summarize(id: string) {
    return getService().summarize(id);
  }

  function feedback(id: string) {
    return getService().feedback(id);
  }

  function rate(id: string, messageId: string, rating: 1 | -1) {
    return getService().rate(id, messageId, rating);
  }

  function unrate(id: string, messageId: string) {
    return getService().unrate(id, messageId);
  }

  async function exportChat(id: string, format: ChatExportFormat) {
    const { blob, filename } = await getService().exportChat(id, format);
    triggerDownload(blob, filename);
  }

  return {
    list,
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
