import { PeersService } from '#api/data';
import type {
  AgentCardDto,
  AgentDelegationDto,
  AgentPeerCandidateDto,
  AgentPeerDto,
} from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
  IPeersState,
} from '../domain/peer.types';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * The generated client answers a failed request with `{ error }` rather than
 * throwing, so an unchecked `unwrapEnvelope` turns a 409 or a 502 into an
 * empty result. That matters more here than almost anywhere else in the
 * console: "Could not read the card of «Support Bot». The card answered 401"
 * is the entire reason an operator can fix a bad connection, and it arrives
 * inside exactly the body this would discard.
 */
function unwrapOrThrow(res: HeyApiResult, action: string): unknown {
  const err = res.error as { message?: string; code?: string } | undefined;
  if (err !== undefined && err !== null) {
    const status = res.response?.status;
    if (err.message) throw new Error(err.message);
    if (status && status >= 400) throw new Error(`${action} failed: HTTP ${status}`);
    throw new Error(
      `${action} failed: could not reach the API. Check that the API is ` +
        "running and that this app's origin is listed in CORS_ORIGIN.",
    );
  }
  return unwrapEnvelope(res.data);
}

/**
 * The only place the console talks to the peers API (CLEAN-74). The DTOs and
 * the domain types are the same shape, so these are structural casts rather
 * than a mapper — there is nothing to convert, and inventing one would only
 * hide that fact.
 */
export class PeerGateway extends BaseGateway {
  list(agentId: string): Promise<IAgentPeer[]> {
    return this.execute(async () => {
      const res = await PeersService.listAgentPeers({ path: { agentId } });
      return ((unwrapOrThrow(res, 'Loading peers') as AgentPeerDto[]) ??
        []) as IAgentPeer[];
    });
  }

  candidates(agentId: string): Promise<IAgentPeerCandidate[]> {
    return this.execute(async () => {
      const res = await PeersService.listAgentPeerCandidates({
        path: { agentId },
      });
      return ((unwrapOrThrow(
        res,
        'Loading agents',
      ) as AgentPeerCandidateDto[]) ?? []) as IAgentPeerCandidate[];
    });
  }

  /** An agent's own card. Also used to preview a candidate before connecting. */
  card(agentId: string): Promise<IAgentCard | null> {
    return this.execute(async () => {
      const res = await PeersService.getAgentCard({ path: { agentId } });
      return ((unwrapOrThrow(res, 'Loading the card') as AgentCardDto) ??
        null) as IAgentCard | null;
    });
  }

  connect(agentId: string, peerAgentId: string): Promise<IAgentPeer> {
    return this.execute(async () => {
      const res = await PeersService.connectAgentPeer({
        path: { agentId },
        body: { peerAgentId },
      });
      return unwrapOrThrow(res, 'Connecting the peer') as IAgentPeer;
    });
  }

  /** Import an external A2A agent by address (CLEAN-95). Re-importing the
   *  same address updates the stored entry instead of duplicating it. */
  importByUrl(
    agentId: string,
    url: string,
    token?: string,
  ): Promise<IAgentPeer> {
    return this.execute(async () => {
      const res = await PeersService.connectAgentPeer({
        path: { agentId },
        body: { url, ...(token !== undefined ? { token } : {}) },
      });
      return unwrapOrThrow(res, 'Importing the agent') as IAgentPeer;
    });
  }

  /** Read an external card without saving anything — the preview an
   *  operator reviews before Connect (CLEAN-95). */
  previewByUrl(
    agentId: string,
    url: string,
    token?: string,
  ): Promise<IAgentCard | null> {
    return this.execute(async () => {
      const res = await PeersService.previewAgentPeerUrl({
        path: { agentId },
        body: { url, ...(token !== undefined ? { token } : {}) },
      });
      return ((unwrapOrThrow(res, 'Reading the card') as AgentCardDto) ??
        null) as IAgentCard | null;
    });
  }

  /** Whether the running pod has loaded the current peer set (CLEAN-95). */
  peersState(agentId: string): Promise<IPeersState> {
    return this.execute(async () => {
      const res = await PeersService.getAgentPeersState({ path: { agentId } });
      return (unwrapOrThrow(res, 'Reading the peer state') ?? {
        armed: false,
        servedAt: null,
      }) as IPeersState;
    });
  }

  refresh(agentId: string, peerId: string): Promise<IAgentPeer> {
    return this.execute(async () => {
      const res = await PeersService.refreshAgentPeer({
        path: { agentId, peerId },
      });
      return unwrapOrThrow(res, 'Refreshing the card') as IAgentPeer;
    });
  }

  remove(agentId: string, peerId: string): Promise<void> {
    return this.execute(async () => {
      const res = await PeersService.removeAgentPeer({
        path: { agentId, peerId },
      });
      // 204: nothing to unwrap, but an error still has to surface.
      const err = (res as HeyApiResult).error;
      if (err) {
        const message = (err as { message?: string }).message;
        throw new Error(message ?? 'Disconnecting the peer failed');
      }
    });
  }

  delegations(agentId: string, limit = 20): Promise<IAgentDelegation[]> {
    return this.execute(async () => {
      const res = await PeersService.listAgentDelegations({
        path: { agentId },
        query: { limit },
      });
      return ((unwrapOrThrow(res, 'Loading delegations') as AgentDelegationDto[]) ??
        []) as IAgentDelegation[];
    });
  }
}
