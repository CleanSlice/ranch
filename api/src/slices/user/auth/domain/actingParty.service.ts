import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISessionGateway } from '#/user/session/domain/session.gateway';
import { SessionService } from '#/user/session/domain/session.service';
import {
  highestPersonRole,
  IAuthTokenPayload,
  ICallerParty,
  isActingToken,
} from './auth.types';

/**
 * Longer than any turn: the runtime keeps the token for the turn that the
 * message started, and tool calls late in a long turn must still be the
 * person's. A turn that outlives it loses the person's tools (its calls
 * become a guest's), and the person's next message carries a fresh token.
 */
export const ACTING_TOKEN_TTL = '60m';

const AGENT_SUB_PREFIX = 'agent:';
const GUEST: ICallerParty = { kind: 'guest' };

/** What a tool call says about who it is for: `_meta["ranch/actor"]`. */
export interface IStatedActor {
  kind?: unknown;
  token?: unknown;
}

/**
 * Who a tool call is made for (CLEAN-232).
 *
 * An agent runtime calls Ranch tools with its own token, and the Ranch admin
 * agent's token carries Owner. Without a second fact, that agent does Owner
 * things for whoever is chatting with it. The second fact is the acting
 * token: the hub mints one with every message a signed-in console person
 * sends, the runtime carries it verbatim to the tool call, and `resolve`
 * turns it back into the person. The agent cannot make one, and one minted
 * for another agent is refused (`aud`).
 *
 * The token carries no role on purpose: the role is read from the database
 * when the token is used, so a demotion or a disabled account takes effect on
 * the next tool call, not when the token runs out.
 */
@Injectable()
export class ActingPartyService {
  private readonly logger = new Logger(ActingPartyService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly sessionGateway: ISessionGateway,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  /** Sign the token for one person, one agent and one console session. */
  mint(input: {
    userId: string;
    agentId: string;
    sid: string;
  }): Promise<string> {
    const payload: IAuthTokenPayload = {
      sub: input.userId,
      email: '',
      roles: [],
      sid: input.sid,
      typ: 'acting',
      aud: `${AGENT_SUB_PREFIX}${input.agentId}`,
    };
    return this.jwt.signAsync(payload, { expiresIn: ACTING_TOKEN_TTL });
  }

  /**
   * The party behind a tool call. Never throws: whatever does not check out
   * is a guest, and a guest has no management power.
   *
   * `bearer` is the verified token of the HTTP request (`req.user`), `actor`
   * is what the call states in `_meta["ranch/actor"]`. A person's console
   * token speaks for that person and the stated actor is ignored. An agent's
   * token speaks for the agent, and the actor says on whose behalf: a
   * `person` only with an acting token that proves it, `trusted` on the
   * agent's own word (bounded by its token), anything else a guest.
   */
  async resolve(
    bearer: IAuthTokenPayload | null | undefined,
    actor: IStatedActor | null | undefined,
  ): Promise<ICallerParty> {
    const bearerSub = typeof bearer?.sub === 'string' ? bearer.sub : '';
    if (!bearerSub) return GUEST;

    if (!bearerSub.startsWith(AGENT_SUB_PREFIX)) {
      const role = highestPersonRole(bearer?.roles);
      return role ? { kind: 'person', userId: bearerSub, role } : GUEST;
    }

    if (!actor || typeof actor !== 'object') return GUEST;
    if (actor.kind === 'trusted') return { kind: 'trusted' };
    if (actor.kind !== 'person') return GUEST;
    if (typeof actor.token !== 'string' || !actor.token) {
      return this.refuse(bearerSub, 'a person was named without a token');
    }

    try {
      return await this.personBehind(actor.token, bearerSub);
    } catch (e) {
      // A database that is down must not turn into management power either.
      return this.refuse(
        bearerSub,
        `lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async personBehind(
    token: string,
    bearerSub: string,
  ): Promise<ICallerParty> {
    let payload: IAuthTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<IAuthTokenPayload>(token);
    } catch (e) {
      const name = (e as { name?: unknown } | null)?.name;
      return this.refuse(
        bearerSub,
        name === 'TokenExpiredError'
          ? 'the acting token has expired'
          : 'the acting token does not verify',
      );
    }
    if (!isActingToken(payload)) {
      return this.refuse(bearerSub, 'the token is not an acting token');
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const sid = typeof payload.sid === 'string' ? payload.sid : '';
    if (!userId || !sid) {
      return this.refuse(bearerSub, 'the acting token names no person');
    }
    if (payload.aud !== bearerSub) {
      return this.refuse(
        bearerSub,
        `the acting token of user ${userId} was minted for another agent`,
      );
    }

    const session = await this.sessionGateway.findById(sid);
    if (!session || session.userId !== userId) {
      return this.refuse(bearerSub, `no session of user ${userId} matches`);
    }
    if (!this.sessions.isLive(session)) {
      return this.refuse(bearerSub, `the session of user ${userId} has ended`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!user) return this.refuse(bearerSub, `user ${userId} is gone`);
    if (user.status !== 'active') {
      return this.refuse(bearerSub, `user ${userId} is ${user.status}`);
    }
    const role = highestPersonRole([user.role]);
    if (!role) {
      return this.refuse(bearerSub, `user ${userId} holds no person role`);
    }
    return { kind: 'person', userId: user.id, role };
  }

  /** One line per refusal, never the token. */
  private refuse(bearerSub: string, reason: string): ICallerParty {
    this.logger.warn(`Acting party refused for ${bearerSub}: ${reason}`);
    return GUEST;
  }
}
