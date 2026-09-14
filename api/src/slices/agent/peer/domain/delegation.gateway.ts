import type {
  IAgentDelegationData,
  ICreateDelegationData,
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
}
