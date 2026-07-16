// Channels a chat session can originate from. `internal` = cron/heartbeat
// sessions — indexed but hidden from the default list.
export const ChatChannelTypes = {
  Bridle: 'bridle',
  Telegram: 'telegram',
  Slack: 'slack',
  Internal: 'internal',
} as const;
export type ChatChannel =
  (typeof ChatChannelTypes)[keyof typeof ChatChannelTypes];

/** A ChatSession index row (domain view of the Prisma model). */
export interface IChatSessionData {
  id: string;
  agentId: string;
  channel: string;
  externalUserId: string;
  sessionKey: string;
  title: string | null;
  preview: string | null;
  lastRole: string | null;
  lastMessageAt: Date;
  messageCount: number;
  userMessageCount: number;
  lastIndexedEventId: string | null;
  lastIndexedSize: number;
  summary: string | null;
  summaryAt: Date | null;
  insights: unknown; // Prisma Json? — null when not yet computed
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChatFilter {
  agentId?: string;
  channel?: string;
  externalUserId?: string; // scope to one end user (App "my history")
  search?: string; // matches title / preview / externalUserId
  archived?: boolean; // default false (hide archived)
  includeInternal?: boolean; // default false (hide internal channel)
  page?: number;
  perPage?: number;
}

export interface IChatListResult {
  items: IChatSessionData[];
  total: number;
}

/**
 * Metadata derived from a session's S3 JSONL file during reconciliation.
 * Counts are the current *viewable* (post-hygiene) user/assistant totals — the
 * gateway seeds/raises with them but never lowers an existing count.
 */
export interface IChatReconcileInput {
  agentId: string;
  sessionKey: string;
  channel: string;
  externalUserId: string;
  title: string | null;
  archived: boolean;
  size: number; // S3 object byte size (change detection)
  lastMessageAt: Date;
  preview: string | null;
  lastRole: string | null;
  messageCount: number;
  userMessageCount: number;
}

export interface IChatSyncResult {
  scannedAgents: number;
  scannedFiles: number;
  upserted: number;
  skipped: number; // unchanged since last reconcile
}

/**
 * A live per-message signal emitted by the agent runtime over the hub socket
 * (Phase 3). `agentId` is NOT here — it's taken from the authenticated socket,
 * never trusted from the payload.
 */
export interface IChatActivity {
  sessionKey: string;
  channel: string;
  externalUserId: string;
  eventId: string; // Event.id — monotonic-count dedup watermark
  role: 'user' | 'assistant';
  ts: number; // unix ms
  preview: string;
}

export type ChatSentiment = 'positive' | 'neutral' | 'negative' | 'mixed';

/** LLM-derived structured insights, stored in `ChatSession.insights` (Json). */
export interface IChatInsights {
  topics: string[];
  sentiment: ChatSentiment;
  resolved: boolean;
  language: string; // ISO 639-1, e.g. "en", "ru"
}

/** Eligibility gate for the insight cron-batch (never summarize empty/unchanged). */
export interface IChatInsightGate {
  cooldownMs: number; // lastMessageAt must be older than now - cooldown (settled)
  minUserMessages: number; // skip trivial chats
  limit: number; // per-run batch cap (bounds token spend)
}

export interface IChatInsightBatchResult {
  eligible: number;
  summarized: number;
  failed: number;
}

/** A 👍/👎 on one assistant message. `source` = admin | app | telegram. */
export interface IChatFeedbackData {
  id: string;
  sessionId: string;
  messageId: string; // Event.id of the rated assistant message
  rating: number; // 1 | -1
  comment: string | null;
  source: string;
  authorId: string | null;
  createdAt: Date;
}

export interface IUpsertChatFeedback {
  sessionId: string;
  messageId: string;
  rating: number; // 1 | -1
  comment?: string | null;
  source: string;
  authorId: string;
}
