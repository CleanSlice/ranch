import { ChatsService } from '#api';

// The API wraps every response in { success, data }; unwrap to the payload.
interface IEnvelope<T> {
  success?: boolean;
  data?: T;
}
function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as IEnvelope<T>)) {
    return ((body as IEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

// One of the current user's own chat sessions (index metadata). Server-scoped
// to the caller's JWT — the app never passes a user id.
export interface IChatSession {
  id: string;
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
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// End users only ever see conversational roles — tool events are filtered
// server-side; `summary` marks where compaction folded older turns.
export type ChatMessageRole = 'user' | 'assistant' | 'summary';

export interface IChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  ts: number;
}

export interface IChatListResult {
  items: IChatSession[];
  total: number;
  page: number;
  perPage: number;
}

export interface IChatMessagesResult {
  messages: IChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface IChatMessagesQuery {
  limit?: number;
  cursor?: string;
}

export interface IChatSyncResult {
  scannedAgents: number;
  scannedFiles: number;
  upserted: number;
  skipped: number;
}

export const useChatStore = defineStore('chat', () => {
  async function listMine(page = 1, perPage = 50): Promise<IChatListResult> {
    const res = await ChatsService.getMyChats({ query: { page, perPage } });
    return (
      unwrap<IChatListResult>(res.data) ?? {
        items: [],
        total: 0,
        page,
        perPage,
      }
    );
  }

  async function getMine(id: string): Promise<IChatSession | null> {
    const res = await ChatsService.getMyChat({ path: { id } });
    return unwrap<IChatSession>(res.data);
  }

  async function messages(
    id: string,
    query: IChatMessagesQuery = {},
  ): Promise<IChatMessagesResult> {
    const res = await ChatsService.getMyChatMessages({ path: { id }, query });
    return (
      unwrap<IChatMessagesResult>(res.data) ?? {
        messages: [],
        nextCursor: null,
        hasMore: false,
      }
    );
  }

  // Self-service reconcile — pull the caller's own chats from S3 into the index
  // when realtime indexing hasn't caught up. Server-scoped to the current user.
  async function syncMine(agentId?: string): Promise<IChatSyncResult | null> {
    const res = await ChatsService.syncMyChats({
      body: agentId ? { agentId } : {},
    });
    return unwrap<IChatSyncResult>(res.data);
  }

  return { listMine, getMine, messages, syncMine };
});
