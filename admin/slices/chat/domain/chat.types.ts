// Domain types for the admin chat slice — the clean, envelope-free shapes the
// app works with. The data layer maps SDK DTOs onto these; nothing above the
// data layer touches the generated `#api` types.
//
// The admin view is broader than the end-user one: sessions carry `agentId`,
// the transcript exposes tool/system events, and listing supports filters.

export type ChatExportFormat = 'json' | 'markdown' | 'csv';

export type ChatChannel = 'bridle' | 'telegram' | 'slack' | 'internal';

// LLM-derived structured insights (null until computed).
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

// Admins can inspect tool/system events; end users only see the first three.
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

// A downloaded transcript, ready for the browser to save. The data layer
// resolves the bytes + filename; the store performs the actual download.
export interface IChatExportFile {
  blob: Blob;
  filename: string;
}

/** Defensive empty list — used when the server returns an empty envelope. */
export function emptyChatList(query: IChatListQuery = {}): IChatListResult {
  return { items: [], total: 0, page: query.page ?? 1, perPage: query.perPage ?? 50 };
}

/** Defensive empty message page. */
export function emptyChatMessages(): IChatMessagesResult {
  return { messages: [], nextCursor: null, hasMore: false };
}
