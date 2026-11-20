import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  isHandoverToken,
  type IAuthTokenPayload,
  type ICallerParty,
} from '#/user/auth/domain/auth.types';
import type { IPeerPartyResolver } from '#/mcp/interfaces/peer-party.interface';

/**
 * The token that travels with a question one agent hands to another
 * (CLEAN-236, `specs/033-identity-boundaries/contracts/handover.md` §1).
 *
 * Until now the agent that received a question could not tell it from a
 * visitor's. It ran the visitor gate on its colleague, it was given a
 * visitor's tools, which included the ones that rewire it, and "which chain
 * is this part of" was kept in one slot per agent, so two questions at once
 * overwrote each other's. The token is the answer to all three, by the
 * mechanism the acting token already uses: the API signs it, the receiving
 * runtime carries it verbatim on its tool calls, and the API reads it back.
 *
 * It states four things and grants none: which agent it is for (`aud`),
 * which connection it came through (`via`), every agent the question has
 * passed (`chain`, the asker last) and, when a person started the chain, who
 * (`for`). That person's power does not travel with it. A question written
 * by another agent's model must not run with the Owner's power because the
 * Owner asked that agent something; `for` only decides which further peers
 * may be asked.
 *
 * Never stored, never logged.
 */

const AGENT_AUD_PREFIX = 'agent:';

/** The subject names the connection, and is no identity anywhere else. */
export const HANDOVER_SUB_PREFIX = 'handover:';

/** What a verified hand-over says. */
export interface IHandover {
  /** The agent the question was handed to. */
  agentId: string;
  /** The connection it travelled through. */
  connectionId: string;
  /** Every agent so far, the one that asked last. */
  chain: string[];
  /** The person the chain was started for, when there is one. */
  forUserId?: string;
  contextId: string;
}

interface IHandoverPayload extends IAuthTokenPayload {
  via?: unknown;
  chain?: unknown;
  for?: unknown;
  ctx?: unknown;
}

@Injectable()
export class HandoverService implements IPeerPartyResolver {
  private readonly logger = new Logger(HandoverService.name);

  constructor(private readonly jwt: JwtService) {}

  /**
   * The party of a tool call that states a hand-over (`PEER_PARTY_RESOLVER`).
   * The token is worth something only on the token of the agent it was
   * minted for; a person's console token, another agent's, or anything that
   * does not verify is a guest.
   */
  async resolvePeer(
    bearer: IAuthTokenPayload | null | undefined,
    token: unknown,
  ): Promise<ICallerParty> {
    const sub = typeof bearer?.sub === 'string' ? bearer.sub : '';
    if (!sub.startsWith(AGENT_AUD_PREFIX)) return { kind: 'guest' };
    const handover = await this.verify(
      typeof token === 'string' ? token : null,
      sub.slice(AGENT_AUD_PREFIX.length),
    );
    if (!handover) return { kind: 'guest' };
    return {
      kind: 'peer',
      chain: handover.chain,
      connectionId: handover.connectionId,
      ...(handover.forUserId ? { forUserId: handover.forUserId } : {}),
    };
  }

  /**
   * Sign a hand-over. `ttlSeconds` is the caller's: the time the receiving
   * agent has to answer, plus the slack for its last tool call.
   */
  mint(handover: IHandover, ttlSeconds: number): Promise<string> {
    const payload: IHandoverPayload = {
      sub: `${HANDOVER_SUB_PREFIX}${handover.connectionId}`,
      email: '',
      roles: [],
      typ: 'handover',
      aud: `${AGENT_AUD_PREFIX}${handover.agentId}`,
      via: handover.connectionId,
      chain: handover.chain,
      ...(handover.forUserId ? { for: handover.forUserId } : {}),
      ctx: handover.contextId,
    };
    return this.jwt.signAsync(payload, { expiresIn: ttlSeconds });
  }

  /**
   * Read a hand-over back. Null for anything that does not check out: a bad
   * signature, an expired token, a token of another kind, one minted for
   * another agent, or one whose shape is off. Never throws, and a null is a
   * question from nobody, never an error the caller could mistake for power.
   *
   * `agentId` is the agent the token is presented at: the one in the path of
   * the A2A request, or the one whose runtime made the tool call.
   */
  async verify(
    token: string | null | undefined,
    agentId: string,
  ): Promise<IHandover | null> {
    if (typeof token !== 'string' || !token || !agentId) return null;

    let payload: IHandoverPayload;
    try {
      payload = await this.jwt.verifyAsync<IHandoverPayload>(token);
    } catch (e) {
      const name = (e as { name?: unknown } | null)?.name;
      return this.refuse(
        agentId,
        name === 'TokenExpiredError'
          ? 'the hand-over token has expired'
          : 'the hand-over token does not verify',
      );
    }

    if (!isHandoverToken(payload)) {
      return this.refuse(agentId, 'not a hand-over token');
    }
    if (payload.aud !== `${AGENT_AUD_PREFIX}${agentId}`) {
      return this.refuse(agentId, 'minted for another agent');
    }
    if (typeof payload.via !== 'string' || !payload.via) {
      return this.refuse(agentId, 'names no connection');
    }
    if (
      !Array.isArray(payload.chain) ||
      payload.chain.length === 0 ||
      !payload.chain.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return this.refuse(agentId, 'carries no chain');
    }
    if (typeof payload.ctx !== 'string' || !payload.ctx) {
      return this.refuse(agentId, 'names no context');
    }
    if (
      payload.for !== undefined &&
      (typeof payload.for !== 'string' || !payload.for)
    ) {
      return this.refuse(agentId, 'names a person it cannot name');
    }

    return {
      agentId,
      connectionId: payload.via,
      chain: payload.chain as string[],
      ...(typeof payload.for === 'string' ? { forUserId: payload.for } : {}),
      contextId: payload.ctx,
    };
  }

  private refuse(agentId: string, why: string): null {
    this.logger.warn(`Hand-over refused at agent=${agentId}: ${why}`);
    return null;
  }
}
