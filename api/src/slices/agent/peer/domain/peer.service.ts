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
import { A2aClient, assertPublicPeerAddress } from './a2a.client';
import { A2A_CARD_PATH, A2A_VERSION } from './a2a.types';
import {
  EXTERNAL_PEER_STATUS,
  PEER_TOKEN_BYTES,
  PEER_TOKEN_PREFIX,
  PeerCardUnreachableError,
  PeerErrorCodes,
  PeerOrigins,
  hashPeerIds,
  type IAgentPeerCandidate,
  type IAgentPeerData,
  type IAgentPeerView,
  type IPeersState,
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
      origin: PeerOrigins.Internal,
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
   * Imports (or re-imports) an agent living outside this installation
   * (CLEAN-95). The card is read before anything persists, and a canonical
   * URL that is already connected is UPDATED in place — snapshot, address
   * form, credential — never duplicated.
   */
  async connectByUrl(
    agentId: string,
    rawUrl: string,
    outboundToken?: string,
  ): Promise<IAgentPeerView> {
    const caller = await this.agents.findById(agentId);
    if (!caller) {
      throw new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Agent not found',
      });
    }

    const cardUrl = this.canonicalCardUrl(rawUrl);
    try {
      assertPublicPeerAddress(cardUrl);
    } catch (err) {
      throw this.invalidUrl(err instanceof Error ? err.message : String(err));
    }

    const ownBase = await this.cards.ownA2aBase();
    if (cardUrl.startsWith(ownBase)) {
      throw new BadRequestException({
        code: PeerErrorCodes.SelfUrl,
        message:
          'This address belongs to an agent of this installation — pick it ' +
          'in the agent list instead of importing it by URL.',
      });
    }

    // Empty string clears a stored credential on re-import; undefined keeps it.
    const token =
      outboundToken === undefined ? undefined : outboundToken.trim() || null;

    let card;
    try {
      card = await this.client.fetchCard(cardUrl, token ?? undefined);
    } catch (err) {
      throw this.importUnreadable(err, cardUrl);
    }

    const version = card.supportedInterfaces?.[0]?.protocolVersion;
    if (version !== A2A_VERSION) {
      throw new BadRequestException({
        code: PeerErrorCodes.Version,
        message: `This agent speaks A2A ${version ?? 'unknown'}; only ${A2A_VERSION} is supported`,
      });
    }

    const existing = await this.peers.findByCardUrl(agentId, cardUrl);
    const row = existing
      ? await this.peers.updateSnapshot(existing.id, {
          cardSnapshot: card,
          cardUrl,
          cardReadAt: new Date(),
          ...(token !== undefined ? { outboundToken: token } : {}),
        })
      : await this.peers.create({
          agentId,
          peerAgentId: null,
          origin: PeerOrigins.External,
          token: null,
          outboundToken: token ?? null,
          cardSnapshot: card,
          cardUrl,
          cardReadAt: new Date(),
        });

    this.logger.log(
      `External peer ${existing ? 're-imported' : 'imported'}: agent=${agentId} url=${cardUrl}`,
    );
    return this.toView(row);
  }

  /**
   * Re-reads a peer's card. A failed read keeps the old snapshot: a stale
   * description is worth more than none, and the operator is told what failed.
   */
  async refresh(agentId: string, peerId: string): Promise<IAgentPeerView> {
    const row = await this.requireOwned(agentId, peerId);
    const external = row.origin === PeerOrigins.External;
    const cardUrl = external
      ? row.cardUrl
      : await this.cards.cardUrlFor(row.peerAgentId!);
    const credential = external
      ? (row.outboundToken ?? undefined)
      : (row.token ?? undefined);

    try {
      const card = await this.client.fetchCard(cardUrl, credential);
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

  /** Whether the running pod has loaded the current peer set (CLEAN-95). */
  async peersState(agentId: string): Promise<IPeersState> {
    const [rows, served] = await Promise.all([
      this.peers.listByAgent(agentId),
      this.peers.readPeersServed(agentId),
    ]);
    return {
      armed:
        served !== null && served.hash === hashPeerIds(rows.map((r) => r.id)),
      servedAt: served?.servedAt ?? null,
    };
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

  /**
   * Accepts both address forms an operator may paste — the agent base URL or
   * its `…/.well-known/agent-card.json` — and returns the card URL, which is
   * the identity external dedup runs on (same shape internal rows store).
   */
  private canonicalCardUrl(rawUrl: string): string {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw this.invalidUrl('not an absolute URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw this.invalidUrl('only http(s) addresses are supported');
    }
    url.hash = '';
    url.search = '';
    let path = url.pathname.replace(/\/+$/, '');
    if (!path.endsWith(`/${A2A_CARD_PATH}`)) {
      path = `${path}/${A2A_CARD_PATH}`;
    }
    url.pathname = path;
    return url.toString();
  }

  private invalidUrl(detail: string): BadRequestException {
    return new BadRequestException({
      code: PeerErrorCodes.UrlInvalid,
      message: `This does not look like an A2A agent address: ${detail}`,
    });
  }

  /** Import-time read failures: 400 for "reached it, not a card", 502 for
   *  "could not reach it" — the operator fixes different things for each. */
  private importUnreadable(err: unknown, cardUrl: string): Error {
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.warn(`External card read failed at ${cardUrl}: ${detail}`);
    if (err instanceof PeerCardUnreachableError && err.kind === 'invalid') {
      return new BadRequestException({
        code: PeerErrorCodes.UrlInvalid,
        message: detail,
      });
    }
    return new BadGatewayException({
      code: PeerErrorCodes.UrlUnreachable,
      message: detail,
    });
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
    if (row.origin === PeerOrigins.External) {
      // No live status is knowable for a foreign agent; existence was proven
      // by the card read, so the row never shows as "gone".
      return {
        id: row.id,
        agentId: row.agentId,
        peerAgentId: null,
        origin: row.origin,
        peerName: row.cardSnapshot?.name ?? 'External agent',
        peerStatus: EXTERNAL_PEER_STATUS,
        peerExists: true,
        card: row.cardSnapshot,
        cardUrl: row.cardUrl,
        cardReadAt: row.cardReadAt,
        createdAt: row.createdAt,
      };
    }

    const peerAgent = await this.agents.findById(row.peerAgentId!);
    return {
      id: row.id,
      agentId: row.agentId,
      peerAgentId: row.peerAgentId,
      origin: row.origin,
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
