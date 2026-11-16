import { IAgentLimits, IAgentLoadMinute } from './agentLimit.types';

export interface IAgentLimitRow {
  agentId: string;
  limits: IAgentLimits;
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
}
