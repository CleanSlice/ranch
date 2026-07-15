// Channels a chat session can originate from. `internal` = cron/heartbeat
// sessions — indexed but hidden from the default list.
export const ChatChannelTypes = {
  Bridle: 'bridle',
  Telegram: 'telegram',
  Slack: 'slack',
  Internal: 'internal',
} as const;
export type ChatChannel = (typeof ChatChannelTypes)[keyof typeof ChatChannelTypes];

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
  insights: unknown | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChatFilter {
  agentId?: string;
  channel?: string;
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
