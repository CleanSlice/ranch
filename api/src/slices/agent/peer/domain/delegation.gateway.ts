import type {
  IAgentDelegationData,
  ICreateDelegationData,
  IDelegationAgentScope,
  IDelegationCounts,
  IFinishDelegationData,
} from './peer.types';

/**
 * Persistence for the delegation audit trail (CLEAN-74, FR-016).
 *
 * A row is written before the outbound call and finished after it, so a crash
 * mid-flight still leaves evidence that the delegation was attempted. Nothing
 * updates a row twice: `finish` is the only transition out of `waiting`.
 */
export abstract class IDelegationGateway {
  abstract create(input: ICreateDelegationData): Promise<IAgentDelegationData>;
  abstract finish(
    id: string,
    input: IFinishDelegationData,
  ): Promise<IAgentDelegationData>;
  /** Newest first — what the Peers tab shows under "Recent delegations". */
  abstract listRecent(
    agentId: string,
    limit: number,
  ): Promise<IAgentDelegationData[]>;

  /**
   * The hand-overs made while answering one chat client, started in
   * `[from, to]`, both ends included: how many, how many were answered, and
   * how often each peer was asked (CLEAN-258, docs/statistics.md). Read from
   * the audit rows themselves, which are the record; nothing is counted
   * ahead. `agentScope` keeps it to the asking agents the person reaches.
   *
   * One range of the index on `[clientId, startedAt]`, grouped by the
   * database: the answer is as large as the peers of that person's period.
   * A hand-over made for no chat client (`clientId` null) is nobody's.
   */
  abstract countForClient(
    clientId: string,
    from: Date,
    to: Date,
    agentScope?: IDelegationAgentScope,
  ): Promise<IDelegationCounts>;

  /**
   * When the earliest hand-over on record started, or null when there is
   * none: since when the hand-overs figure is complete.
   */
  abstract firstRecordAt(): Promise<Date | null>;
}
