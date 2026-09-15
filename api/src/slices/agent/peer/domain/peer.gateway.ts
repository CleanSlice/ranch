import type { IAgentPeerData } from './peer.types';
import type { IA2aAgentCard } from './a2a.types';

export interface ICreatePeerInput {
  agentId: string;
  peerAgentId: string;
  token: string;
  cardSnapshot: IA2aAgentCard;
  cardUrl: string;
  cardReadAt: Date;
}

export interface IUpdateSnapshotInput {
  cardSnapshot: IA2aAgentCard;
  cardUrl: string;
  cardReadAt: Date;
}

/**
 * Persistence for directed peer connections (CLEAN-74).
 *
 * `findByToken` is the one read on the hot path of every inbound A2A request,
 * which is why the credential is a unique column rather than a hashed one:
 * a lookup, not a scan.
 */
export abstract class IPeerGateway {
  /** Peers of this caller, oldest first. Never the connections pointing AT it. */
  abstract listByAgent(agentId: string): Promise<IAgentPeerData[]>;
  abstract findById(id: string): Promise<IAgentPeerData | null>;
  abstract findByPair(
    agentId: string,
    peerAgentId: string,
  ): Promise<IAgentPeerData | null>;
  /** Resolves a presented `ap_` credential to the pair it was issued for. */
  abstract findByToken(token: string): Promise<IAgentPeerData | null>;
  /** `@@unique([agentId, peerAgentId])` turns a double-connect into P2002. */
  abstract create(input: ICreatePeerInput): Promise<IAgentPeerData>;
  abstract updateSnapshot(
    id: string,
    input: IUpdateSnapshotInput,
  ): Promise<IAgentPeerData>;
  /** Deleting the row is what revokes the credential. */
  abstract delete(id: string): Promise<void>;
}
