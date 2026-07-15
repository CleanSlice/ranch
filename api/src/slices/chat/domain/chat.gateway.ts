import {
  IChatActivity,
  IChatFilter,
  IChatListResult,
  IChatReconcileInput,
  IChatSessionData,
} from './chat.types';

/**
 * Persistence port for the chat-history index. Abstract class (not interface)
 * so it can double as a Nest DI token — see ranch's IUsageGateway/ILlmGateway.
 */
export abstract class IChatGateway {
  abstract list(filter: IChatFilter): Promise<IChatListResult>;
  abstract findById(id: string): Promise<IChatSessionData | null>;

  /**
   * Upsert a session row from reconciled file metadata. Freshness fields
   * (lastMessageAt/preview/lastRole/title/archived/size) are always written;
   * counts are monotonic — seeded on first index, only ever raised, never
   * lowered (compaction shrinks the file, realtime owns the true total).
   */
  abstract reconcileUpsert(input: IChatReconcileInput): Promise<IChatSessionData>;

  /**
   * Apply a live activity signal: create the row if new, else bump the
   * monotonic counts (+1, dedup'd by eventId) and refresh
   * lastMessageAt/preview/lastRole. Realtime is the authoritative count owner.
   */
  abstract recordActivity(agentId: string, activity: IChatActivity): Promise<void>;
}
