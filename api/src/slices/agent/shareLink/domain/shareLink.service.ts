import { randomBytes } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IShareLinkGateway } from './shareLink.gateway';
import {
  IShareLinkData,
  IShareLinkState,
  IShareResolved,
  SHARE_CLIENT_PREFIX,
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_PREFIX,
  SHARE_VISITOR_RE,
  ShareLinkErrorCodes,
} from './shareLink.types';
import { IAgentGateway } from '#/agent/agent/domain';

/**
 * The share-link grant for one agent (CLEAN-66).
 *
 * Owner side (`getState` / `share` / `regenerate` / `revoke`) always runs
 * behind a JWT and 404s when the agent does not exist. Visitor side
 * (`resolveForVisitor` / `authorizeChat`) is unauthenticated, so it answers
 * with deliberately uniform errors: an unknown token and a revoked token are
 * indistinguishable (FR-013), and a rejected chat request is 403 — never 401,
 * which the console's axios interceptor would turn into a /login redirect.
 *
 * Tokens are secrets: they are returned to the owner and to nobody else, and
 * are never written to a log line.
 */
@Injectable()
export class ShareLinkService {
  constructor(
    private gateway: IShareLinkGateway,
    private agents: IAgentGateway,
  ) {}

  async getState(agentId: string): Promise<IShareLinkState> {
    await this.requireAgent(agentId);
    return this.toState(await this.gateway.findByAgent(agentId));
  }

  /** Create-or-return: idempotent while the link is active, mints a fresh
   *  token when there is no row or the link was revoked. */
  async share(agentId: string, userId: string): Promise<IShareLinkState> {
    await this.requireAgent(agentId);
    return this.ensureLink(agentId, userId, false);
  }

  /** Always ends with a token that has never been valid before; the previous
   *  one dies in the same UPDATE (FR-007). */
  async regenerate(agentId: string, userId: string): Promise<IShareLinkState> {
    await this.requireAgent(agentId);
    return this.ensureLink(agentId, userId, true);
  }

  /** No-op (still 200 with the current state) when there is nothing to
   *  revoke, so the console never has to special-case the button. */
  async revoke(agentId: string, userId: string): Promise<IShareLinkState> {
    await this.requireAgent(agentId);
    const existing = await this.gateway.findByAgent(agentId);
    if (!existing || existing.revokedAt) return this.toState(existing);
    return this.toState(await this.gateway.revoke(agentId, userId));
  }

  /** Visitor-facing lookup for `/share?token=…`. Everything that is not an
   *  active link pointing at a live agent answers with one identical 404. */
  async resolveForVisitor(token: string): Promise<IShareResolved> {
    const link = token ? await this.gateway.findByToken(token) : null;
    if (!link || link.revokedAt) throw this.notFound();

    const agent = await this.agents.findById(link.agentId);
    if (!agent) throw this.notFound();

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
    };
  }

  /**
   * Per-request authorization for a share visitor's chat traffic. Returns the
   * chat client id (`share-<visitorId>`) so the caller can register the
   * visitor on the bridle hub. Revocation therefore takes effect on the very
   * next message — there is no cached decision anywhere.
   */
  async authorizeChat(
    token: string,
    agentId: string,
    visitorId: string,
  ): Promise<string> {
    const link = token ? await this.gateway.findByToken(token) : null;
    if (!link || link.revokedAt || link.agentId !== agentId) {
      throw new ForbiddenException({ code: ShareLinkErrorCodes.LinkInvalid });
    }
    if (!visitorId || !SHARE_VISITOR_RE.test(visitorId)) {
      throw new ForbiddenException({
        code: ShareLinkErrorCodes.VisitorInvalid,
      });
    }
    return `${SHARE_CLIENT_PREFIX}${visitorId}`;
  }

  /**
   * Share and Regenerate differ in one bit: whether an *active* link is left
   * alone (Share is idempotent) or rotated (Regenerate always mints).
   * Everything else — create the first row, revive a revoked one — is shared.
   *
   * `agentId` is unique in the database, so two console users pressing Share
   * at the same moment race on the INSERT; the loser gets P2002 and re-reads
   * instead of surfacing a 500 on a button that is meant to be idempotent.
   */
  private async ensureLink(
    agentId: string,
    userId: string,
    rotateWhenActive: boolean,
  ): Promise<IShareLinkState> {
    const existing = await this.gateway.findByAgent(agentId);
    if (existing)
      return this.settle(existing, agentId, userId, rotateWhenActive);

    try {
      return this.toState(
        await this.gateway.create({ agentId, token: this.mint(), userId }),
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.gateway.findByAgent(agentId);
      if (!winner) throw err;
      return this.settle(winner, agentId, userId, rotateWhenActive);
    }
  }

  private async settle(
    link: IShareLinkData,
    agentId: string,
    userId: string,
    rotateWhenActive: boolean,
  ): Promise<IShareLinkState> {
    if (!rotateWhenActive && !link.revokedAt) return this.toState(link);
    return this.toState(
      await this.gateway.rotate(agentId, this.mint(), userId),
    );
  }

  /** `sl_` + 32 random bytes base64url — 43 chars after the prefix, ~256 bits
   *  (FR-003). Same recipe as ApiKeyService, minus the hashing: the owner must
   *  be able to reopen the panel and read the link back (research.md R1). */
  private mint(): string {
    return `${SHARE_TOKEN_PREFIX}${randomBytes(SHARE_TOKEN_BYTES).toString(
      'base64url',
    )}`;
  }

  private async requireAgent(agentId: string): Promise<void> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: ShareLinkErrorCodes.NotFound });
  }

  /** The token is exposed only while the link is active — a revoked token is
   *  dead and must never be shown again, let alone reused. */
  private toState(link: IShareLinkData | null): IShareLinkState {
    if (!link) {
      return {
        active: false,
        token: null,
        createdAt: null,
        revokedAt: null,
        rotatedAt: null,
        rotationCount: 0,
      };
    }
    const active = link.revokedAt === null;
    return {
      active,
      token: active ? link.token : null,
      createdAt: link.createdAt,
      revokedAt: link.revokedAt,
      rotatedAt: link.rotatedAt,
      rotationCount: link.rotationCount,
    };
  }
}

/** Prisma's unique-constraint code, matched structurally so the domain layer
 *  keeps its distance from `@prisma/client`. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}
