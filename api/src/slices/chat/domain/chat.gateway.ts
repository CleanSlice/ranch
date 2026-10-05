import {
  IChatActivity,
  IChatFeedbackData,
  IChatFilter,
  IChatInsightGate,
  IChatInsights,
  IChatListResult,
  IChatReconcileInput,
  IChatSessionData,
  IUpsertChatFeedback,
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
  abstract reconcileUpsert(
    input: IChatReconcileInput,
  ): Promise<IChatSessionData>;

  /**
   * A conversation was closed (CLEAN-136): its live session file became
   * `<sessionKey>.<ts>.archived.jsonl`. Move the row to that key and mark it
   * archived, so the closed conversation keeps its id, counts, summary and
   * ratings and is listed once. Recreating it from the file would orphan all
   * of those on a row whose transcript is gone. A no-op when the conversation
   * was never indexed; the next conversation gets a row of its own.
   */
  abstract archiveSession(
    agentId: string,
    sessionKey: string,
    archivedSessionKey: string,
  ): Promise<void>;

  /**
   * Apply a live activity signal: create the row if new, else bump the
   * monotonic counts (+1, dedup'd by eventId) and refresh
   * lastMessageAt/preview/lastRole. Realtime is the authoritative count owner.
   */
  abstract recordActivity(
    agentId: string,
    activity: IChatActivity,
  ): Promise<void>;

  /**
   * Sessions eligible for insight generation: not internal, not archived,
   * enough user messages, settled (no recent activity), and with new activity
   * since the last summary (`summaryAt IS NULL OR lastMessageAt > summaryAt`).
   * Ordered most-recently-active first, capped at `gate.limit`.
   */
  abstract findEligibleForInsight(
    gate: IChatInsightGate,
  ): Promise<IChatSessionData[]>;

  /** Persist an LLM summary + structured insights; stamps `summaryAt = now`. */
  abstract saveInsights(
    id: string,
    summary: string,
    insights: IChatInsights,
  ): Promise<void>;

  /** Upsert one author's 👍/👎 on a message (unique per session+message+author). */
  abstract upsertFeedback(
    input: IUpsertChatFeedback,
  ): Promise<IChatFeedbackData>;

  /** Remove an author's feedback on a message (toggle-off / clear). */
  abstract deleteFeedback(
    sessionId: string,
    messageId: string,
    authorId: string,
  ): Promise<void>;

  /** One author's feedback across a session (for rendering their ratings). */
  abstract listFeedbackByAuthor(
    sessionId: string,
    authorId: string,
  ): Promise<IChatFeedbackData[]>;
}
