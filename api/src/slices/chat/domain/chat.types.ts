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

/**
 * The agents a read may show, for a caller whose access lists hide some
 * (CLEAN-231): what `AgentReach.where()` hands back. Absent means every
 * agent; `{ in: [] }` means none.
 */
export interface IChatAgentScope {
  in?: string[];
  notIn?: string[];
}

export interface IChatFilter {
  agentId?: string;
  /**
   * The agents the list may show, for a caller whose access lists hide some
   * (CLEAN-231): what `AgentReach.where()` hands back. Used when no single
   * `agentId` is asked for.
   */
  agentScope?: IChatAgentScope;
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
 * What a statistics view reads of a conversation (CLEAN-258): which agent it
 * is with and when it last moved. Nothing of what was said.
 */
export interface IChatSessionRef {
  id: string;
  agentId: string;
  lastMessageAt: Date;
}

/** One author's ratings over a period: how many up, how many down. */
export interface IChatFeedbackCounts {
  up: number;
  down: number;
}

/**
 * One conversation's messages in one UTC hour, as a statistics view reads
 * them (CLEAN-258). Counts only: the table holds no text.
 */
export interface IPersonActivityHour {
  sessionId: string;
  agentId: string;
  /** Start of the hour, UTC. */
  hour: Date;
  userMessages: number;
  agentMessages: number;
}

/**
 * Where the people of a conversation write from, as the installation's
 * statistics name it (CLEAN-265). Not the stored `channel`: the console chat
 * is `bridle` there, and a share link's visitors write on it too.
 */
export const ActivityChannelTypes = {
  Console: 'console',
  Telegram: 'telegram',
  Slack: 'slack',
  Share: 'share',
  Other: 'other',
} as const;
export type ActivityChannel =
  (typeof ActivityChannelTypes)[keyof typeof ActivityChannelTypes];

/**
 * A period and the one before it, as an installation view asks for them:
 * `[from, to]` is the period, `[previousFrom, from)` the one before.
 */
export interface IActivityPeriods {
  from: Date;
  to: Date;
  previousFrom: Date;
}

/** Conversations one agent had on one channel in a period. */
export interface IAgentChannelConversations {
  agentId: string;
  channel: ActivityChannel;
  /** Distinct conversations a person wrote in. */
  conversations: number;
}

/**
 * An installation's activity over a period (CLEAN-265): counts by agent and
 * channel, and how many different people wrote. No identity leaves the
 * query: a person is counted and never named.
 */
export interface IInstallationActivity {
  /** One entry per agent and channel with at least one conversation. */
  conversations: IAgentChannelConversations[];
  /** Distinct people who wrote, in the period and in the one before it. */
  people: { value: number; previous: number };
}

/** The ratings the answers of one agent got in a period. */
export interface IAgentFeedbackCounts {
  agentId: string;
  /** Every rating, up or down. */
  rated: number;
  /** The ones that were down. */
  down: number;
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

/** One run of the activity settle pass (ChatActivityService, CLEAN-261). */
export interface IChatSettleResult {
  picked: number; // conversations whose transcript the run set out to read
  raised: number; // hour rows it created or raised
  failed: number; // conversations it could not settle; they stay due
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
