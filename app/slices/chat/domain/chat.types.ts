// Domain types for the chat slice — the clean, envelope-free shapes the app
// works with. The data layer maps SDK DTOs onto these; nothing above the data
// layer touches the generated `#api` types.

export type ChatExportFormat = 'json' | 'markdown' | 'csv';

// LLM-derived structured insights (null until the cron-batch computes them).
export interface IChatInsights {
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  resolved: boolean;
  language: string;
}

// The current user's 👍/👎 on an assistant message.
export interface IChatFeedback {
  id: string;
  messageId: string;
  rating: number; // 1 | -1
  comment: string | null;
  source: string;
  authorId: string | null;
  createdAt: string;
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
  insights: IChatInsights | null;
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

// A downloaded transcript, ready for the browser to save. The data layer
// resolves the bytes + filename; the store performs the actual download.
export interface IChatExportFile {
  blob: Blob;
  filename: string;
}

/** Defensive empty list — used when the server returns an empty envelope. */
export function emptyChatList(page = 1, perPage = 50): IChatListResult {
  return { items: [], total: 0, page, perPage };
}

/** Defensive empty message page. */
export function emptyChatMessages(): IChatMessagesResult {
  return { messages: [], nextCursor: null, hasMore: false };
}
