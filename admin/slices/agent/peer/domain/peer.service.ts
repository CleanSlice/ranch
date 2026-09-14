import type { PeerGateway } from '../data/peer.gateway';
import type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
} from './peer.types';

/** Pass-through to the gateway, in the slice shape the console uses everywhere. */
export class PeerService {
  constructor(private readonly gateway: PeerGateway) {}

  list(agentId: string): Promise<IAgentPeer[]> {
    return this.gateway.list(agentId);
  }

  candidates(agentId: string): Promise<IAgentPeerCandidate[]> {
    return this.gateway.candidates(agentId);
  }

  card(agentId: string): Promise<IAgentCard | null> {
    return this.gateway.card(agentId);
  }

  connect(agentId: string, peerAgentId: string): Promise<IAgentPeer> {
    return this.gateway.connect(agentId, peerAgentId);
  }

  refresh(agentId: string, peerId: string): Promise<IAgentPeer> {
    return this.gateway.refresh(agentId, peerId);
  }

  remove(agentId: string, peerId: string): Promise<void> {
    return this.gateway.remove(agentId, peerId);
  }

  delegations(agentId: string, limit?: number): Promise<IAgentDelegation[]> {
    return this.gateway.delegations(agentId, limit);
  }
}
