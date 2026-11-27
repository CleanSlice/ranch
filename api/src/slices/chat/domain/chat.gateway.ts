import {
  IAgentFeedbackCounts,
  IChatActivity,
  IChatAgentScope,
  IChatFeedbackCounts,
  IChatFeedbackData,
  IChatFilter,
  IChatInsightGate,
  IChatListResult,
  IChatReconcileInput,
  IChatSessionData,
  IChatSessionOutcome,
  IChatSessionRef,
  IChatSummaryData,
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
   * Sessions eligible for insight generation: not internal, enough user
   * messages, settled (no recent activity), and one of
   *
   *  - never summarised, or something was said since the summary
   *    (`summaryAt IS NULL OR lastMessageAt > summaryAt`);
   *  - summarised by an older prompt (`insightVersion` below the current
   *    one) and active within `gate.resummarizeWindowMs` (CLEAN-270).
   *
   * Archived conversations are taken too (CLEAN-270): one closed with New
   * chat before its hour of quiet had passed was archived unsummarised and
   * stayed so. Nothing is said in an archived conversation again, so it is
   * taken once, and again only for a newer prompt.
   *
   * Ordered most-recently-active first, capped at `gate.limit`: new
   * conversations and old summaries share the one cap.
   *
   * `gate.exclude` names conversations to leave out all the same, each by
   * its id and the last message it had: the ones the batch has set aside.
   */
  abstract findEligibleForInsight(
    gate: IChatInsightGate,
  ): Promise<IChatSessionData[]>;

  /**
   * Persist what one summary says: the text, the question, the outcome, the
   * topics, and `insights` (Json) in the shape the admin console reads.
   * Stamps `summaryAt = now` and `insightVersion` with the current prompt's.
   * Every field is written, so "no question" and "no topic" replace what an
   * earlier summary said.
   */
  abstract saveInsights(id: string, summary: IChatSummaryData): Promise<void>;

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

  // ── What a statistics view reads (CLEAN-258, docs/statistics.md) ──

  /**
   * The conversations named, each with its agent and the time of its last
   * message; an id that names nothing is absent from the answer. With
   * `agentScope`, a conversation with an agent outside it is absent too.
   * The ids come from the hours a period view has already read, so the read
   * is as large as that person's period.
   */
  abstract findSessionsByIds(
    ids: readonly string[],
    agentScope?: IChatAgentScope,
  ): Promise<IChatSessionRef[]>;

  /**
   * The same conversations with what their summaries say (CLEAN-270): the
   * outcome, the main question, the topics, the tone and the language, and
   * the two things that tell a summary still to come from one that never
   * will (`summaryAt`, `userMessageCount`). Not the summary's text, the
   * preview or the title.
   *
   * By id, like `findSessionsByIds`, and bounded the same way: the ids are
   * the conversations the hour rows of one person's period named, never a
   * condition on `ChatSession` that would have it searched. It carries the
   * person's question, so it is for that person's own view and no other.
   */
  abstract findOutcomesForSessions(
    ids: readonly string[],
    agentScope?: IChatAgentScope,
  ): Promise<IChatSessionOutcome[]>;

  /**
   * How many answers one author rated up and down with `createdAt` in
   * `[from, to]`, both ends included. The ratings are read where they are:
   * one changed or withdrawn since is counted as it stands now. With
   * `agentScope`, only ratings in conversations with those agents.
   */
  abstract countFeedbackByAuthor(
    authorId: string,
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IChatFeedbackCounts>;

  /**
   * The ratings given with `createdAt` in `[from, to]`, both ends included,
   * by the agent of the conversation each was given in (CLEAN-265): how many
   * there were and how many of them were down. Whoever gave them; nobody is
   * named. Read where they are, as they stand now. An agent with no rating
   * in the range is absent. With `agentScope`, only the agents inside it.
   */
  abstract feedbackByAgent(
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IAgentFeedbackCounts[]>;

  /**
   * When the earliest rating there is was given, or null when there is none:
   * how far back a period can reach and still count ratings whole.
   */
  abstract firstFeedbackAt(): Promise<Date | null>;
}
