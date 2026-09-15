import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { IAgentGateway } from '#/agent/agent/domain';
import { IPeerGateway } from './peer.gateway';
import { AgentCardService } from './agentCard.service';
import { A2aClient } from './a2a.client';
import {
  PEER_TOKEN_BYTES,
  PEER_TOKEN_PREFIX,
  PeerCardUnreachableError,
  PeerErrorCodes,
  type IAgentPeerCandidate,
  type IAgentPeerData,
  type IAgentPeerView,
} from './peer.types';

/**
 * Connecting, refreshing and removing peers (CLEAN-74).
 *
 * The shape worth knowing: a connection is created BEFORE its card is read,
 * because the credential has to exist for the read to be authorised. A failed
 * read then deletes the row — so "connected" always means "we proved, with
 * this very credential, that the card is readable", and an operator never ends
 * up holding a connection that cannot be used.
 */
@Injectable()
export class PeerService {
  private readonly logger = new Logger(PeerService.name);

  constructor(
    private readonly peers: IPeerGateway,
    private readonly agents: IAgentGateway,
    private readonly cards: AgentCardService,
    private readonly client: A2aClient,
  ) {}

  async list(agentId: string): Promise<IAgentPeerView[]> {
    const rows = await this.peers.listByAgent(agentId);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  /** Every other agent of this installation, marked with what is already connected. */
  async candidates(agentId: string): Promise<IAgentPeerCandidate[]> {
    const [all, connected] = await Promise.all([
      this.agents.findAll(),
      this.peers.listByAgent(agentId),
    ]);
    const connectedIds = new Set(connected.map((p) => p.peerAgentId));

    return all
      .filter((agent) => agent.id !== agentId)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        connected: connectedIds.has(agent.id),
      }));
  }

  async connect(agentId: string, peerAgentId: string): Promise<IAgentPeerView> {
    if (agentId === peerAgentId) {
      throw new BadRequestException({
        code: PeerErrorCodes.Self,
        message: 'An agent cannot be its own peer',
      });
    }

    const [caller, peerAgent] = await Promise.all([
      this.agents.findById(agentId),
      this.agents.findById(peerAgentId),
    ]);
    if (!caller || !peerAgent) {
      throw new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Agent not found',
      });
    }

    const existing = await this.peers.findByPair(agentId, peerAgentId);
    if (existing) {
      throw new ConflictException({
        code: PeerErrorCodes.Exists,
        message: `«${peerAgent.name}» is already a peer of this agent`,
      });
    }

    const cardUrl = await this.cards.cardUrlFor(peerAgentId);
    const token = this.mintToken();

    // Created first: the card route requires the credential, so reading the
    // card IS the proof that this connection works end to end.
    let row = await this.peers.create({
      agentId,
      peerAgentId,
      token,
      cardSnapshot: await this.cards.build(peerAgentId),
      cardUrl,
      cardReadAt: new Date(),
    });

    try {
      const card = await this.client.fetchCard(cardUrl, token);
      row = await this.peers.updateSnapshot(row.id, {
        cardSnapshot: card,
        cardUrl,
        cardReadAt: new Date(),
      });
    } catch (err) {
      await this.peers.delete(row.id);
      throw this.cardUnreachable(err, peerAgent.name);
    }

    return this.toView(row);
  }

  /**
   * Re-reads a peer's card. A failed read keeps the old snapshot: a stale
   * description is worth more than none, and the operator is told what failed.
   */
  async refresh(agentId: string, peerId: string): Promise<IAgentPeerView> {
    const row = await this.requireOwned(agentId, peerId);
    const cardUrl = await this.cards.cardUrlFor(row.peerAgentId);

    try {
      const card = await this.client.fetchCard(cardUrl, row.token);
      const updated = await this.peers.updateSnapshot(row.id, {
        cardSnapshot: card,
        cardUrl,
        cardReadAt: new Date(),
      });
      return this.toView(updated);
    } catch (err) {
      throw this.cardUnreachable(err, row.cardSnapshot?.name ?? 'the peer');
    }
  }

  /** Deleting the row is what revokes the credential — there is no other copy. */
  async remove(agentId: string, peerId: string): Promise<void> {
    const row = await this.requireOwned(agentId, peerId);
    await this.peers.delete(row.id);
    this.logger.log(
      `Peer removed: agent=${agentId} peer=${row.peerAgentId} (credential revoked)`,
    );
  }

  private async requireOwned(
    agentId: string,
    peerId: string,
  ): Promise<IAgentPeerData> {
    const row = await this.peers.findById(peerId);
    // Same answer for "no such connection" and "not yours": one agent must not
    // be able to probe another's peer list by guessing ids.
    if (!row || row.agentId !== agentId) {
      throw new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Peer connection not found',
      });
    }
    return row;
  }

  private mintToken(): string {
    return (
      PEER_TOKEN_PREFIX +
      crypto.randomBytes(PEER_TOKEN_BYTES).toString('base64url')
    );
  }

  private cardUnreachable(err: unknown, peerName: string): BadGatewayException {
    const detail =
      err instanceof PeerCardUnreachableError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    this.logger.warn(`Card read failed for «${peerName}»: ${detail}`);
    return new BadGatewayException({
      code: PeerErrorCodes.CardUnreachable,
      message: `Could not read the card of «${peerName}». ${detail}`,
    });
  }

  /**
   * The public shape of a connection. `token` is dropped here, once, so no
   * controller has to remember to: a credential that reaches a browser is a
   * credential that has left the building.
   */
  private async toView(row: IAgentPeerData): Promise<IAgentPeerView> {
    const peerAgent = await this.agents.findById(row.peerAgentId);
    return {
      id: row.id,
      agentId: row.agentId,
      peerAgentId: row.peerAgentId,
      peerName: peerAgent?.name ?? row.cardSnapshot?.name ?? 'Unknown agent',
      peerStatus: peerAgent?.status ?? 'unknown',
      peerExists: Boolean(peerAgent),
      card: row.cardSnapshot,
      cardUrl: row.cardUrl,
      cardReadAt: row.cardReadAt,
      createdAt: row.createdAt,
    };
  }
}
