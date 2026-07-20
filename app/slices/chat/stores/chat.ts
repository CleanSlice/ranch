import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ChatService } from '#chat/domain';
import type { ChatExportFormat, IChatMessagesQuery } from '#chat/domain';

// Re-export the domain types so existing consumers that import them from
// `#chat/stores/chat` (Bubble, Card, chatDetail/Provider) keep working.
export type {
  ChatExportFormat,
  ChatMessageRole,
  IChatExportFile,
  IChatFeedback,
  IChatInsights,
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
 * components already call; the transport, DTO mapping and envelope-unwrapping
 * now live in the data layer behind the service.
 */
export const useChatStore = defineStore('chat', () => {
  function listMine(page = 1, perPage = 50) {
    return getService().listMine(page, perPage);
  }

  function getMine(id: string) {
    return getService().getMine(id);
  }

  function messages(id: string, query: IChatMessagesQuery = {}) {
    return getService().messages(id, query);
  }

  function syncMine(agentId?: string) {
    return getService().syncMine(agentId);
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
    listMine,
    getMine,
    messages,
    syncMine,
    feedback,
    rate,
    unrate,
    exportChat,
  };
});
