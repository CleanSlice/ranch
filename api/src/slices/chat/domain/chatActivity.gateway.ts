import { IActivityBucket } from './activityBuckets';
import {
  IActivityPeriods,
  IChatAgentScope,
  IInstallationActivity,
  IPersonActivityHour,
} from './chat.types';

/** Which conversations a settle run takes. */
export interface IChatSettleGate {
  /** Quiet: the last message is older than this. */
  quietBefore: Date;
  /** Recent enough to be shown: the last message is not older than this. */
  activeSince: Date;
  /** Per-run cap. */
  limit: number;
}

/**
 * A conversation whose hours are due: what finds its transcript (`agentId`,
 * `sessionKey`) and what its hour rows copy. Nothing of what was said.
 */
export interface IUnsettledChat {
  id: string;
  agentId: string;
  sessionKey: string;
  channel: string;
  externalUserId: string;
  lastMessageAt: Date;
}

/** The conversation an hour row belongs to, and the fields it copies. */
export type IActivityOwner = Pick<
  IUnsettledChat,
  'id' | 'agentId' | 'channel' | 'externalUserId'
>;

/** What an installation's activity is read with. */
export interface IActivitySummaryOptions {
  /**
   * Also say how the conversations ended (CLEAN-270). Asked for only where
   * the installation produces summaries: it joins each conversation of the
   * period to its row for the summary, and where there are no summaries
   * that would be a read of `ChatSession` for nothing.
   */
  outcomes?: boolean;
}

/**
 * Persistence port of the settle pass over `ChatActivityHour` (CLEAN-261,
 * docs/statistics.md). The live write is not here: it belongs to
 * `IChatGateway.recordActivity`, in one transaction with the lifetime totals.
 */
export abstract class IChatActivityGateway {
  /**
   * Conversations that are quiet, recent, and due, on every channel. Most
   * recently active first, capped at `gate.limit`.
   *
   * Due is exactly `activityRebuiltAt` being null: never read, or moved on
   * since it was. Whatever moves a conversation on sets the column back to
   * null (a counted live event, a reconcile of a changed file), so that the
   * question is one column and an index answers it.
   */
  abstract findUnsettled(gate: IChatSettleGate): Promise<IUnsettledChat[]>;

  /**
   * Set each given hour of the conversation to the higher of what is stored
   * and what was counted, each of the two counts by itself, creating the row
   * when there is none. Never lowers a count, never deletes a row, never
   * touches an hour that is not in `rows`: a compacted transcript is shorter
   * than the conversation was. Returns how many hours it created or raised.
   */
  abstract raise(
    session: IActivityOwner,
    rows: IActivityBucket[],
  ): Promise<number>;

  /**
   * Stamp `activityRebuiltAt` with `at`, the start of the run that read the
   * transcript, unless the conversation has a message later than `at`: that
   * one made it due again, and the stamp must not undo it. A conversation
   * deleted meanwhile is no error.
   */
  abstract markSettled(sessionId: string, at: Date): Promise<void>;

  /** Delete the hours that began before `date`. Returns how many. */
  abstract pruneBefore(date: Date): Promise<number>;

  /**
   * One person's hours on one channel, for a statistics view (CLEAN-258):
   * every row whose hour starts in `[from, to]`, both ends included, oldest
   * first. `agentScope` keeps it to the agents the person reaches; without
   * it no agent is left out.
   *
   * Bounded by the person and the range, never by the history: it is one
   * range of the index on `[externalUserId, channel, hour]`. The widest view
   * asks for 180 days (a 90-day period and the one before it).
   */
  abstract findHoursForPerson(
    externalUserId: string,
    channel: string,
    from: Date,
    to: Date,
    agentScope?: IChatAgentScope,
  ): Promise<IPersonActivityHour[]>;

  /**
   * An installation's activity, counted in the database (CLEAN-265): the
   * distinct conversations a person wrote in during `[from, to]`, by agent
   * and channel, and the distinct people who wrote, in that period and in
   * `[previousFrom, from)`. `agentScope` keeps every count to the agents the
   * caller reaches; without it no agent is left out, and a scope that admits
   * no agent answers empty without a query.
   *
   * Left out everywhere: the `internal` channel (scheduled jobs and
   * heartbeats) and identities that start with `peer:` (another agent's
   * question). Neither is a person.
   *
   * Counted there and not here on purpose. An installation's 180 days are
   * every hour row of every conversation, and the answer is a few dozen
   * numbers; the rows themselves never leave the database, and no identity
   * leaves the query.
   *
   * With `options.outcomes` (CLEAN-270) the answer also says, per agent,
   * how many of those conversations have a summary and how many of them it
   * left `open`: the same statement, with each conversation of the period
   * joined by its id to the two columns of its summary. Which conversations
   * are the period's is still said by the hour rows and by nothing in
   * `ChatSession`, and nothing a person wrote is read: not the question,
   * not the summary. The join is what it costs, and it is paid only when
   * asked for (`agentConversationsQuery` has the measurement): without it
   * `outcomes` is empty and `ChatSession` is not read at all.
   */
  abstract summaryForAgents(
    periods: IActivityPeriods,
    agentScope?: IChatAgentScope,
    options?: IActivitySummaryOptions,
  ): Promise<IInstallationActivity>;
}
