import { IActivityBucket } from './activityBuckets';

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

/**
 * Persistence port of the settle pass over `ChatActivityHour` (CLEAN-261,
 * docs/statistics.md). The live write is not here: it belongs to
 * `IChatGateway.recordActivity`, in one transaction with the lifetime totals.
 */
export abstract class IChatActivityGateway {
  /**
   * Conversations that are quiet, recent, and not read since their last
   * message (`activityRebuiltAt` is null or older than `lastMessageAt`), on
   * every channel. Most recently active first, capped at `gate.limit`.
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

  /** Stamp `activityRebuiltAt`. A conversation deleted meanwhile is no error. */
  abstract markSettled(sessionId: string, at: Date): Promise<void>;

  /** Delete the hours that began before `date`. Returns how many. */
  abstract pruneBefore(date: Date): Promise<number>;
}
