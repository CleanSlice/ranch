import { IAgentLimits, IAgentLoadMinute } from './agentLimit.types';

export interface IAgentLimitRow {
  agentId: string;
  limits: IAgentLimits;
}

/** Counts for one agent in one UTC day (CLEAN-261). */
export interface IAgentLoadDay {
  agentId: string;
  /** Start of the day, UTC. */
  day: Date;
  accepted: number;
  refused: number;
  /** Operator and agent-to-agent requests: seen, never counted toward limits. */
  exempt: number;
}

export abstract class IAgentLimitGateway {
  /** Every agent that has limits. */
  abstract findAll(): Promise<IAgentLimitRow[]>;
  abstract upsert(
    agentId: string,
    limits: IAgentLimits,
    userId: string | null,
  ): Promise<void>;
  /** Limits off. No error when there was no row. */
  abstract remove(agentId: string): Promise<void>;
  /**
   * Add these counts to the agent's per-minute rows, creating the rows that
   * do not exist yet. One transaction per call: all of an agent's minutes
   * land or none do, so a failed flush can be retried without double counting.
   *
   * The same transaction adds the same counts to the row of each minute's
   * UTC day (CLEAN-261), so a day can only equal the sum of its minutes.
   */
  abstract addMinutes(
    agentId: string,
    minutes: IAgentLoadMinute[],
  ): Promise<void>;
  /** The agent's rows from `sinceMs` on, oldest first. */
  abstract minutes(
    agentId: string,
    sinceMs: number,
  ): Promise<IAgentLoadMinute[]>;
  /** Delete rows older than `beforeMs`, for every agent. */
  abstract pruneBefore(beforeMs: number): Promise<void>;

  /**
   * For each UTC day from `sinceDay` to today that has minute rows and no
   * day row, write the day row as the sum of its minutes; answers how many
   * rows it wrote. A day that already has a row is left alone: it was counted
   * as it happened.
   *
   * The caller chooses `sinceDay` so that every minute of it is still kept —
   * a day the prune has reached would be written short and then never
   * corrected — and calls this before the first flush, because a flush that
   * creates today's row first leaves nothing here to fill.
   */
  abstract rebuildMissingDays(sinceDay: Date): Promise<number>;
  /** Delete day rows that start before `date`, for every agent. */
  abstract pruneDaysBefore(date: Date): Promise<void>;
  /**
   * These agents' day rows from `from` up to, not including, `to`, oldest
   * first. Half-open so that a period and the one before it, cut at the same
   * instant, never both count the day that starts there.
   */
  abstract findDays(
    agentIds: string[],
    from: Date,
    to: Date,
  ): Promise<IAgentLoadDay[]>;
  /** The earliest day on record for any agent; null while there is none. */
  abstract firstDayAt(): Promise<Date | null>;
}
