import { ChatsService } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';

export type ChatExportFormat = 'json' | 'markdown' | 'csv';

// The API wraps every response in { success, data }; unwrap to the payload.
type ApiEnvelope<T> = { success: boolean; data: T };
function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

// hey-api doesn't throw on 4xx/5xx — it returns { error }. Surface it so the UI
// can show the API's message (e.g. a rejected LLM credential) instead of a
// silent no-op.
function throwIfError(
  res: { error?: unknown; response?: { status?: number } },
  action: string,
): void {
  if (res.error === undefined || res.error === null) return;
  const msg = (res.error as { message?: string }).message;
  throw new Error(
    msg ? `${action}: ${msg}` : `${action} failed (HTTP ${res.response?.status ?? '?'})`,
  );
}

export type ChatChannel = 'bridle' | 'telegram' | 'slack' | 'internal';

export interface IChatInsights {
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  resolved: boolean;
  language: string;
}

export interface IChatFeedback {
  id: string;
  messageId: string;
  rating: number; // 1 | -1
  comment: string | null;
  source: string;
  authorId: string | null;
  createdAt: string;
}

export interface IChatSession {
  id: string;
  agentId: string;
  channel: string;
  externalUserId: string;
  sessionKey: string;
  title: string | null;
  preview: string | null;
  lastRole: string | null;
  lastMessageAt: string;
  messageCount: number;
  userMessageCount: number;
  summary: string | null;
  summaryAt: string | null;
  insights: IChatInsights | null; // null when not yet computed
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IChatListResult {
  items: IChatSession[];
  total: number;
  page: number;
  perPage: number;
}

export type ChatMessageRole =
  | 'user'
  | 'assistant'
  | 'summary'
  | 'tool_call'
  | 'tool_result'
  | 'system';

export interface IChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  ts: number;
}

export interface IChatMessagesResult {
  messages: IChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface IChatListQuery {
  agentId?: string;
  channel?: ChatChannel;
  search?: string;
  archived?: boolean;
  includeInternal?: boolean;
  page?: number;
  perPage?: number;
}

export interface IChatMessagesQuery {
  limit?: number;
  cursor?: string;
  types?: string; // comma-separated event types (tool debug toggle)
}

export interface IChatSyncResult {
  scannedAgents: number;
  scannedFiles: number;
  upserted: number;
  skipped: number;
}

export const useChatStore = defineStore('chat', () => {
  async function list(query: IChatListQuery = {}): Promise<IChatListResult> {
    const res = await ChatsService.getChats({ query });
    return (
      unwrap<IChatListResult>(res.data) ?? {
        items: [],
        total: 0,
        page: query.page ?? 1,
        perPage: query.perPage ?? 50,
      }
    );
  }

  async function getById(id: string): Promise<IChatSession | null> {
    const res = await ChatsService.getChat({ path: { id } });
    return unwrap<IChatSession>(res.data);
  }

  async function messages(
    id: string,
    query: IChatMessagesQuery = {},
  ): Promise<IChatMessagesResult> {
    const res = await ChatsService.getChatMessages({ path: { id }, query });
    return (
      unwrap<IChatMessagesResult>(res.data) ?? {
        messages: [],
        nextCursor: null,
        hasMore: false,
      }
    );
  }

  async function sync(agentId?: string): Promise<IChatSyncResult | null> {
    const res = await ChatsService.syncChats({
      body: agentId ? { agentId } : {},
    });
    return unwrap<IChatSyncResult>(res.data);
  }

  async function summarize(id: string): Promise<IChatSession | null> {
    const res = await ChatsService.summarizeChat({ path: { id } });
    throwIfError(res, 'Summarize');
    return unwrap<IChatSession>(res.data);
  }

  async function feedback(id: string): Promise<IChatFeedback[]> {
    const res = await ChatsService.getMyChatFeedback({ path: { id } });
    return unwrap<IChatFeedback[]>(res.data) ?? [];
  }

  async function rate(id: string, messageId: string, rating: 1 | -1): Promise<void> {
    await ChatsService.createChatFeedback({ path: { id }, body: { messageId, rating } });
  }

  async function unrate(id: string, messageId: string): Promise<void> {
    await ChatsService.deleteChatFeedback({ path: { id, messageId } });
  }

  // Export is a file download — use the raw axios client (adds the Bearer header
  // via the interceptor) with a blob response, then trigger a browser download.
  async function exportChat(id: string, format: ChatExportFormat): Promise<void> {
    const res = await apiClient.instance.get(`/chats/${id}/export`, {
      params: { format },
      responseType: 'blob',
    });
    const dispo = (res.headers['content-disposition'] as string) ?? '';
    const filename =
      dispo.match(/filename="?([^"]+)"?/)?.[1] ??
      `chat-${id}.${format === 'markdown' ? 'md' : format}`;
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
