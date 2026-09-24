import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { IAgentGateway } from '#/agent/agent/domain';
import { IPeerGateway } from './peer.gateway';
import { AgentCardService } from './agentCard.service';
import {
  A2aClient,
  assertPublicPeerAddress,
  assertResolvesPublic,
} from './a2a.client';
import {
  A2A_CARD_PATH,
  A2A_JSONRPC_BINDING,
  A2A_VERSION,
  isA2aCardShape,
  type IA2aAgentCard,
  type IA2aAgentInterface,
} from './a2a.types';
import { parse as parseYaml } from 'yaml';
import {
  A2A_LEGACY_VERSION,
  normalizeLegacyCard,
  selectCallableInterface,
} from './a2a.legacy';
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
    // Empty string clears a stored credential on re-import; undefined keeps it.
    const token =
      outboundToken === undefined ? undefined : outboundToken.trim() || null;

    const { cardUrl, card } = await this.readExternalCard(
      agentId,
      rawUrl,
      token ?? undefined,
    );

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
   * Reads an external card WITHOUT saving anything — the preview an operator
   * reviews before Connect (FR-002). The same read connectByUrl performs, so
   * what they approve is literally what gets stored.
   */
  async previewByUrl(agentId: string, rawUrl: string, outboundToken?: string) {
    const { card } = await this.readExternalCard(
      agentId,
      rawUrl,
      outboundToken?.trim() || undefined,
    );
    return card;
  }

  /**
   * Connect from a card somebody handed us rather than from an address
   * (CLEAN-116). Plenty of cards are never published at a URL: one arrives in
   * an email, one lives in a repository as YAML, one belongs to an agent
   * still on a laptop.
   *
   * Everything after the parse is the address path exactly: the same vetting,
   * so a pasted card cannot reach anywhere an imported address could not.
   */
  async connectByCard(
    agentId: string,
    text: string,
    outboundToken?: string,
  ): Promise<IAgentPeerView> {
    const token =
      outboundToken === undefined ? undefined : outboundToken.trim() || null;
    const { cardUrl, card } = await this.readPastedCard(agentId, text);

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
      `External peer ${existing ? 're-imported' : 'imported'} from a pasted card: agent=${agentId} url=${cardUrl}`,
    );
    return this.toView(row);
  }

  /** The same read, saving nothing — what the operator approves first. */
  async previewCard(agentId: string, text: string): Promise<IA2aAgentCard> {
    const { card } = await this.readPastedCard(agentId, text);
    return card;
  }

  /**
   * Parse, vet, and work out what address this card would have been read
   * from. That derived URL is the peer's identity: importing the same agent
   * later by its address lands on the same row instead of a duplicate, and
   * Re-read has somewhere to go. When the agent publishes no card there, the
   * refresh fails and the stored snapshot stays — which is the existing,
   * documented behaviour for an unreachable card.
   */
  private async readPastedCard(agentId: string, text: string) {
    const caller = await this.agents.findById(agentId);
    if (!caller) {
      throw new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Agent not found',
      });
    }

    const card = this.cardFromText(text);
    const ownBase = await this.cards.ownA2aBase();
    const iface = await this.vetExternalCard(card, ownBase);
    const cardUrl = this.canonicalCardUrl(iface.url);

    return { cardUrl, card };
  }

  /**
   * JSON or YAML, because cards in the wild are written both ways — and a
   * document whose only top-level key is `card` is unwrapped, because that is
   * how agent frameworks write the file an operator will copy to us.
   */
  private cardFromText(text: string): IA2aAgentCard {
    const trimmed = text.trim();
    if (!trimmed) throw this.notACard('it is empty');
    if (trimmed.length > MAX_CARD_CHARS) {
      throw this.notACard(
        `it is larger than ${MAX_CARD_CHARS} characters — a card is a small document`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      try {
        parsed = parseYaml(trimmed);
      } catch (err) {
        throw this.notACard(
          `it is neither JSON nor YAML: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
        );
      }
    }

    const unwrapped = unwrapCardDocument(parsed);
    if (isA2aCardShape(unwrapped)) return unwrapped;

    const legacy = normalizeLegacyCard(unwrapped);
    if (legacy) return legacy;

    throw this.notACard(
      'an agent card needs a name, a list of skills, and an address — ' +
        'either `supportedInterfaces` (A2A 1.0) or a top-level `url`',
    );
  }

  private notACard(detail: string): BadRequestException {
    return new BadRequestException({
      code: PeerErrorCodes.Body,
      message: `This is not an agent card: ${detail}`,
    });
  }

  /** Shared validate-and-fetch for preview and import: canonicalize, SSRF
   *  guards, own-installation refusal, card read, protocol version check. */
  private async readExternalCard(
    agentId: string,
    rawUrl: string,
    token?: string,
  ) {
    const caller = await this.agents.findById(agentId);
    if (!caller) {
      throw new NotFoundException({
        code: PeerErrorCodes.NotFound,
        message: 'Agent not found',
      });
    }

    const cardUrl = this.canonicalCardUrl(rawUrl);

    // Compared after normalizing, not as a string prefix: `//a2a`, `%61gents`
    // or a trailing dot on the host all reach our own card route, and each
    // used to slip past a startsWith (CLEAN-97).
    const ownBase = await this.cards.ownA2aBase();
    if (isOwnA2aAddress(cardUrl, ownBase)) throw this.selfUrl();

    try {
      assertPublicPeerAddress(cardUrl);
      await assertResolvesPublic(cardUrl);
    } catch (err) {
      throw this.invalidUrl(err instanceof Error ? err.message : String(err));
    }

    let card;
    try {
      card = await this.client.fetchCard(cardUrl, token);
    } catch (err) {
      throw this.importUnreadable(err, cardUrl);
    }

    await this.vetExternalCard(card, ownBase);

    return { cardUrl, card };
  }

  /**
   * What an external card must satisfy before it is stored, beyond "it is a
   * card" (CLEAN-97). The pasted address was already checked; these checks
   * are about the card's own claims, which is where delegation will actually
   * send requests:
   *
   * - it offers a JSON-RPC interface on the version we speak — picked the
   *   same way delegation picks it, so the operator approves what gets dialled;
   * - that interface is not this installation — our own card names our real
   *   base, so this catches every alias of our host that the address check
   *   cannot know about;
   * - that interface is publicly reachable — otherwise the row saves fine and
   *   every delegation fails later with nothing in the console to explain it.
   */
  private async vetExternalCard(
    card: IA2aAgentCard,
    ownBase: string,
  ): Promise<IA2aAgentInterface> {
    // JSON-RPC on 1.0 or on the old dialect — both are callable, and the
    // choice here is the choice delegation makes later (CLEAN-114).
    const callable = selectCallableInterface(card);
    if (!callable) {
      const interfaces = card.supportedInterfaces ?? [];
      if (!interfaces.length) {
        throw new BadRequestException({
          code: PeerErrorCodes.Version,
          message: 'This card names no address Ranch can call',
        });
      }
      // It speaks JSON-RPC, just not a version we know: a future 2.0 is not
      // a dialect to guess at (CLEAN-114).
      const jsonRpc = interfaces.filter(
        (i) =>
          String(i?.protocolBinding ?? '').toUpperCase() ===
          A2A_JSONRPC_BINDING,
      );
      if (jsonRpc.length) {
        const versions = unique(jsonRpc.map((i) => i?.protocolVersion));
        throw new BadRequestException({
          code: PeerErrorCodes.Version,
          message: `This agent speaks A2A ${versions.join(', ') || 'an unnamed version'}; Ranch speaks ${A2A_VERSION} and ${A2A_LEGACY_VERSION}`,
        });
      }
      const bindings = unique(interfaces.map((i) => i?.protocolBinding));
      const offered = unique(interfaces.map((i) => i?.protocolVersion));
      throw new BadRequestException({
        code: PeerErrorCodes.Binding,
        message: `This agent offers A2A ${offered.join(', ') || 'an unnamed version'} only over ${bindings.join(', ') || 'an unnamed transport'}; Ranch calls agents over JSON-RPC`,
      });
    }
    const iface = callable.iface;

    if (isOwnA2aAddress(iface.url, ownBase)) throw this.selfUrl();

    try {
      assertPublicPeerAddress(iface.url);
      await assertResolvesPublic(iface.url);
    } catch (err) {
      throw new BadRequestException({
        code: PeerErrorCodes.UrlInvalid,
        message: `This card sends delegations to ${iface.url}, which cannot be used: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    return iface;
  }

  private selfUrl(): BadRequestException {
    return new BadRequestException({
      code: PeerErrorCodes.SelfUrl,
      message:
        'This address belongs to an agent of this installation — pick it ' +
        'in the agent list instead of importing it by URL.',
    });
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
      if (external) {
        // The stored address was vetted at import, but its DNS may have
        // moved to a private range since (SSRF, CLEAN-95).
        assertPublicPeerAddress(cardUrl);
        await assertResolvesPublic(cardUrl);
      }
      const card = await this.client.fetchCard(cardUrl, credential);
      if (external) {
        // A refreshed card is new remote content: held to the same bar as an
        // import, so a peer cannot move its interface somewhere private (or
        // onto us) between import and refresh (CLEAN-97).
        await this.vetExternalCard(card, await this.cards.ownA2aBase());
      }
      const updated = await this.peers.updateSnapshot(row.id, {
        cardSnapshot: card,
        cardUrl,
        cardReadAt: new Date(),
      });
      return this.toView(updated);
    } catch (err) {
      // A refusal from vetting already names its cause and code; only
      // transport failures need translating.
      if (err instanceof HttpException) throw err;
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
    // An address that already names a JSON document is a card URL as it is:
    // the pre-1.0 `/.well-known/agent.json` and custom card paths used to get
    // `/.well-known/agent-card.json` glued onto them (CLEAN-97).
    if (!path.toLowerCase().endsWith('.json')) {
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
    if (err instanceof PeerCardUnreachableError && err.kind === 'version') {
      return new BadRequestException({
        code: PeerErrorCodes.Version,
        message: detail,
      });
    }
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

/** A card is a small document; anything this size is a mistake or a probe. */
const MAX_CARD_CHARS = 256_000;

/**
 * Agent frameworks write the card as one key of a larger config file — the
 * Adobe Learning Manager example nests everything under `card:`. An operator
 * copying that file to us is handing us the card; digging it out for them
 * costs four lines and saves an explanation.
 */
function unwrapCardDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const doc = value as Record<string, unknown>;
  if (typeof doc.name === 'string') return doc;
  const inner = doc.card ?? doc.agentCard ?? doc.agent_card;
  return inner && typeof inner === 'object' ? inner : value;
}

function unique(values: Array<string | undefined | null>): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
}

/**
 * An address reduced to what decides which route it reaches: host without a
 * trailing dot, explicit port, and a path decoded once, collapsed and
 * lower-cased — the way the server itself resolves it. The scheme is left
 * out on purpose: http and https of our host are both us.
 */
function normalizeAddress(
  raw: string,
): { host: string; port: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: compare the raw form rather than give up.
  }
  path = path.replace(/\/{2,}/g, '/').toLowerCase();
  try {
    path = new URL(path, 'http://normalize.invalid').pathname;
  } catch {
    // Keep the collapsed form.
  }
  if (!path.endsWith('/')) path = `${path}/`;

  return {
    host: url.hostname.toLowerCase().replace(/\.+$/, ''),
    port: url.port,
    path,
  };
}

/** True when `candidate` points into this installation's A2A surface. */
function isOwnA2aAddress(candidate: string, ownBase: string): boolean {
  const address = normalizeAddress(candidate);
  const own = normalizeAddress(ownBase);
  if (!address || !own) return false;
  return (
    address.host === own.host &&
    address.port === own.port &&
    address.path.startsWith(own.path)
  );
}
