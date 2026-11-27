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
  /** How it ended, by the latest summary; null while there is none. */
  outcome: ChatOutcome | null;
  /** The person's main question, one line; null when there is none. */
  question: string | null;
  /** `ChatTopic.id` of each topic the summary assigned; at most two. */
  topicIds: string[];
  /** Which prompt wrote the summary: 0 none, 1 before CLEAN-270, 2 since. */
  insightVersion: number;
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

/**
 * What a person's statistics read of one of their conversations' summary
 * (CLEAN-270): the two judgments, the topics, the tone and the language,
 * with what says whether a summary is still to come. `question` is the
 * person's own words, so this is read only for the person it is shown to
 * (spec 038, FR-033); the summary's text is not here at all.
 */
export interface IChatSessionOutcome extends IChatSessionRef {
  /** Messages from the person so far: what the summary batch's floor compares. */
  userMessageCount: number;
  /** When the summary was written; null while there is none. */
  summaryAt: Date | null;
  /** Null while there is no summary, and for one an older release wrote. */
  outcome: ChatOutcome | null;
  question: string | null;
  /** `ChatTopic.id`s as stored: a merged one is still under its own id. */
  topicIds: string[];
  /** From `insights`; null when it holds none of the four. */
  sentiment: ChatSentiment | null;
  /** From `insights`: an ISO 639-1 code in lower case, or null. */
  language: string | null;
}

/**
 * How the conversations one agent had in a period ended, as far as their
 * summaries say (CLEAN-270). Counts only, and of the same conversations
 * `IAgentChannelConversations` counts for that agent: `open` is a part of
 * `summarised`, which is a part of its conversations.
 */
export interface IAgentOutcomeCounts {
  agentId: string;
  /** Conversations a person wrote in during the period that have a summary. */
  summarised: number;
  /** The ones among them whose summary says the person was left without an answer. */
  open: number;
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
  /**
   * How those conversations ended, per agent, when that was asked for
   * (CLEAN-270): an agent none of whose conversations has a summary is
   * absent. Empty when it was not asked for, which says nothing about how
   * anything ended.
   */
  outcomes: IAgentOutcomeCounts[];
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

/**
 * How a conversation ended, as its summary judged it (CLEAN-270, spec 038
 * contracts/summary-judgments.md, judgment 2). `unknown` is an answer of its
 * own: the summary could not tell, and the conversation is then neither
 * resolved nor an open question.
 */
export const ChatOutcomeTypes = {
  Resolved: 'resolved',
  Open: 'open',
  Unknown: 'unknown',
} as const;
export type ChatOutcome =
  (typeof ChatOutcomeTypes)[keyof typeof ChatOutcomeTypes];

/**
 * What `ChatSession.insights` (Json) holds. The shape version 1 wrote, kept
 * as it is for the admin console's chat pages (spec 038, data-model.md):
 * `topics` are English labels, and `resolved` is true for the outcome
 * `resolved` and false for the other two.
 */
export interface IChatInsights {
  topics: string[];
  sentiment: ChatSentiment;
  resolved: boolean;
  language: string; // ISO 639-1, e.g. "en", "ru"
}

/**
 * What one summary writes on its conversation (version 2, CLEAN-270): the
 * text, the two judgments as columns a period view can read, and the Json
 * of version 1 beside them.
 */
export interface IChatSummaryData {
  summary: string;
  question: string | null;
  outcome: ChatOutcome;
  /** `ChatTopic.id` of each clear fit, at most two. */
  topicIds: string[];
  insights: IChatInsights;
}

/** A topic's label per language of the app console: `{ en, ru }`. */
export type IChatTopicLabels = Record<string, string>;

/** One subject, as the installation's summaries name it (`ChatTopic`). */
export interface IChatTopicData {
  id: string;
  /** Lower-case English slug; what the model chooses between. */
  key: string;
  labels: IChatTopicLabels;
  /** The topic this one was folded into, when an operator merged it. */
  mergedIntoId: string | null;
  createdAt: Date;
}

/**
 * A topic with how many conversations carry it, those of the topics folded
 * into it included; a conversation is counted once.
 */
export interface IChatTopicUsage {
  topic: IChatTopicData;
  conversations: number;
  /** Keys of the topics merged into this one. */
  merged: string[];
}

/** Eligibility gate for the insight cron-batch (never summarize empty/unchanged). */
export interface IChatInsightGate {
  cooldownMs: number; // lastMessageAt must be older than now - cooldown (settled)
  minUserMessages: number; // skip trivial chats
  limit: number; // per-run batch cap (bounds token spend)
  /**
   * A summary written by an older prompt is redone when the conversation's
   * last message is not older than this (CLEAN-270).
   */
  resummarizeWindowMs: number;
  /**
   * Conversations to leave out though they are eligible: ones the batch has
   * set aside (`ChatInsightService`), each as it stood then. One whose last
   * message has moved since is no longer the conversation named, and is
   * taken. They do not count against `limit`. Absent when there is none.
   */
  exclude?: IChatInsightExclusion[];
}

/** One conversation at one moment of it: its id and its last message then. */
export interface IChatInsightExclusion {
  id: string;
  lastMessageAt: Date;
}

export interface IChatInsightBatchResult {
  eligible: number;
  /** Summaries written. */
  summarized: number;
  /** Conversations with no transcript, or no message in it: nothing to summarise. */
  skipped: number;
  /** The model's answer was unusable, or the transcript could not be read. */
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
