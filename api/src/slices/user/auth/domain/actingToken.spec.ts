import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRoleTypes } from '#/user/user/domain';
import { JwtAuthGuard } from '../guards/jwtAuth.guard';
import { ACTING_TOKEN_TTL } from './actingParty.service';
import type { IAuthTokenPayload } from './auth.types';
import {
  ACTING_TEST_SECRET,
  agentBearer,
  makeActingParty,
} from './__fixtures__/actingParty';

/**
 * The acting token (CLEAN-232): proof that a tool call is made for one
 * signed-in person, at one agent, during one console session. Everything
 * here runs on a real `JwtService`, because the claim under test is that the
 * token cannot be forged, moved to another agent, or outlive what it names.
 *
 * `resolve` never throws: whatever does not check out is a guest.
 */

const GUEST = { kind: 'guest' };
const RANCH = agentBearer('ranch', true);

const MINUTE_MS = 60_000;

describe('ActingPartyService.mint', () => {
  it('signs person, agent and session, for sixty minutes, and no role', async () => {
    const { service, jwt, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);

    const token = await service.mint({ userId, agentId: 'ranch', sid });
    const claims = jwt.verify<IAuthTokenPayload & { iat: number; exp: number }>(
      token,
    );

    expect(claims.typ).toBe('acting');
    expect(claims.sub).toBe('user-owner');
    expect(claims.aud).toBe('agent:ranch');
    expect(claims.sid).toBe(sid);
    // The role is read from the database when the token is used, so a
    // demotion lands on the next tool call. Nothing to trust in the token.
    expect(claims.roles).toEqual([]);
    expect(claims.email).toBe('');
    expect(ACTING_TOKEN_TTL).toBe('60m');
    expect(claims.exp - claims.iat).toBe(60 * 60);
  });
});

describe('ActingPartyService.resolve: a valid token', () => {
  it('is that person, with the role the database holds', async () => {
    const { service, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-admin', UserRoleTypes.Admin);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual({
      kind: 'person',
      userId: 'user-admin',
      role: UserRoleTypes.Admin,
    });
  });

  it('follows a role change made after the token was minted', async () => {
    const { service, signIn, users } = makeActingParty();
    const { userId, sid } = signIn('user-admin', UserRoleTypes.Admin);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    users.get(userId)!.role = UserRoleTypes.User;

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual({
      kind: 'person',
      userId: 'user-admin',
      role: UserRoleTypes.User,
    });
  });

  it('proves the person to a plain agent too', async () => {
    const { service, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-1', UserRoleTypes.User);
    const token = await service.mint({ userId, agentId: 'helper', sid });

    expect(
      await service.resolve(agentBearer('helper', false), {
        kind: 'person',
        token,
      }),
    ).toEqual({ kind: 'person', userId: 'user-1', role: UserRoleTypes.User });
  });
});

describe('ActingPartyService.resolve: a token that does not check out is a guest', () => {
  it('forged: signed with another secret', async () => {
    const { service, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const forger = new JwtService({ secret: 'not-the-api-secret' });
    const forged = await forger.signAsync(
      {
        sub: userId,
        email: '',
        roles: [],
        sid,
        typ: 'acting',
        aud: 'agent:ranch',
      },
      { expiresIn: '60m' },
    );

    expect(
      await service.resolve(RANCH, { kind: 'person', token: forged }),
    ).toEqual(GUEST);
  });

  it('tampered: a valid token with one character changed', async () => {
    const { service, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });
    const [header, body, signature] = token.split('.');
    const flipped = signature.startsWith('A') ? 'B' : 'A';

    expect(
      await service.resolve(RANCH, {
        kind: 'person',
        token: `${header}.${body}.${flipped}${signature.slice(1)}`,
      }),
    ).toEqual(GUEST);
  });

  describe('expired', () => {
    afterEach(() => jest.useRealTimers());

    it('holds for a turn shorter than the lifetime and not a minute longer', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-11-17T10:00:00.000Z'));
      const { service, signIn } = makeActingParty();
      const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
      const token = await service.mint({ userId, agentId: 'ranch', sid });

      jest.setSystemTime(new Date(Date.now() + 59 * MINUTE_MS));
      expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual({
        kind: 'person',
        userId: 'user-owner',
        role: UserRoleTypes.Owner,
      });

      jest.setSystemTime(new Date(Date.now() + 2 * MINUTE_MS));
      expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
        GUEST,
      );
    });
  });

  it('wrong audience: minted for another agent', async () => {
    const { service, signIn } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const forHelper = await service.mint({ userId, agentId: 'helper', sid });

    // The Owner chatted with «helper»; the token then turns up on a call
    // from «ranch», or from any third agent.
    expect(
      await service.resolve(RANCH, { kind: 'person', token: forHelper }),
    ).toEqual(GUEST);
    expect(
      await service.resolve(agentBearer('other', false), {
        kind: 'person',
        token: forHelper,
      }),
    ).toEqual(GUEST);
  });

  it('session revoked', async () => {
    const { service, signIn, sessions } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    sessions.get(sid)!.revokedAt = new Date();

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it('session expired, by inactivity and by its absolute deadline', async () => {
    const { service, signIn, sessions } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });
    const past = new Date(Date.now() - MINUTE_MS);
    const live = { ...sessions.get(sid)! };

    sessions.set(sid, { ...live, expiresAt: past });
    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );

    sessions.set(sid, { ...live, absoluteExpiresAt: past });
    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it('session gone', async () => {
    const { service, signIn, sessions } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    sessions.delete(sid);

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it("session belongs to another user: a User's token naming the Owner's session", async () => {
    const { service, signIn } = makeActingParty();
    const owner = signIn('user-owner', UserRoleTypes.Owner);
    signIn('user-1', UserRoleTypes.User);
    // The hub never mints this; it is what a correctly signed token would
    // have to look like to borrow someone else's live session.
    const token = await service.mint({
      userId: 'user-1',
      agentId: 'ranch',
      sid: owner.sid,
    });

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it('user missing', async () => {
    const { service, signIn, users } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    users.delete(userId);

    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it('user disabled, or not active yet', async () => {
    const { service, signIn, users } = makeActingParty();
    const { userId, sid } = signIn('user-admin', UserRoleTypes.Admin);
    const token = await service.mint({ userId, agentId: 'ranch', sid });

    users.get(userId)!.status = 'disabled';
    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );

    users.get(userId)!.status = 'invited';
    expect(await service.resolve(RANCH, { kind: 'person', token })).toEqual(
      GUEST,
    );
  });

  it('a lookup that fails is a guest, not an error', async () => {
    const { service, signIn, sessions } = makeActingParty();
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });
    sessions.get = () => {
      throw new Error('database is down');
    };

    await expect(
      service.resolve(RANCH, { kind: 'person', token }),
    ).resolves.toEqual(GUEST);
  });
});

describe('ActingPartyService.resolve: what an agent says without proof', () => {
  it('a role-Agent runtime naming the Owner with a made-up token is a guest', async () => {
    const { service, signIn, jwt } = makeActingParty();
    const owner = signIn('user-owner', UserRoleTypes.Owner);
    const plain = agentBearer('helper', false);

    for (const token of ['made-up', '', 'a.b.c', owner.userId]) {
      expect(await service.resolve(plain, { kind: 'person', token })).toEqual(
        GUEST,
      );
    }
    // Not a token at all: the id alone, the way a bare `userId` would travel.
    expect(
      await service.resolve(plain, {
        kind: 'person',
        userId: owner.userId,
      } as never),
    ).toEqual(GUEST);
    expect(await service.resolve(plain, { kind: 'person', token: 42 })).toEqual(
      GUEST,
    );

    // Nor the Owner's own console token, were the agent ever to see one: it
    // is correctly signed and names the Owner, and it is not an acting token.
    const consoleToken = await jwt.signAsync({
      sub: owner.userId,
      email: 'owner@example.test',
      roles: [UserRoleTypes.Owner],
      sid: owner.sid,
    });
    expect(
      await service.resolve(plain, { kind: 'person', token: consoleToken }),
    ).toEqual(GUEST);
    expect(
      await service.resolve(RANCH, { kind: 'person', token: consoleToken }),
    ).toEqual(GUEST);
  });

  it('an embed token is not an acting token either', async () => {
    const { service, jwt } = makeActingParty();
    const embed = await jwt.signAsync({
      sub: 'wslid-A1234567',
      email: '',
      roles: [UserRoleTypes.Owner],
      typ: 'embed',
      aud: 'agent:ranch',
    });

    expect(
      await service.resolve(RANCH, { kind: 'person', token: embed }),
    ).toEqual(GUEST);
  });

  it('trusted is taken on the agent’s word; its token bounds it elsewhere', async () => {
    const { service } = makeActingParty();

    expect(
      await service.resolve(RANCH, {
        kind: 'trusted',
        via: 'internal',
      } as never),
    ).toEqual({ kind: 'trusted' });
    expect(
      await service.resolve(agentBearer('helper', false), { kind: 'trusted' }),
    ).toEqual({ kind: 'trusted' });
  });

  it('guest, absent and malformed actors are guests', async () => {
    const { service } = makeActingParty();

    for (const actor of [
      { kind: 'guest' },
      undefined,
      null,
      {},
      { kind: 'owner' },
      { kind: ['trusted'] },
      'trusted',
      { token: 'x' },
    ]) {
      expect(await service.resolve(RANCH, actor as never)).toEqual(GUEST);
    }
  });

  it('no bearer, or one without a subject, is a guest whatever is stated', async () => {
    const { service } = makeActingParty();

    expect(await service.resolve(undefined, { kind: 'trusted' })).toEqual(
      GUEST,
    );
    expect(await service.resolve(null, { kind: 'trusted' })).toEqual(GUEST);
    expect(
      await service.resolve(
        { email: '', roles: [UserRoleTypes.Owner] } as never,
        { kind: 'trusted' },
      ),
    ).toEqual(GUEST);
  });
});

describe('ActingPartyService.resolve: a person’s own console token', () => {
  const consoleBearer = (sub: string, roles: UserRoleTypes[]) => ({
    sub,
    email: `${sub}@example.test`,
    roles,
    sid: `sid-${sub}`,
  });

  it('speaks for that person, with the role on the token', async () => {
    const { service } = makeActingParty();

    expect(
      await service.resolve(
        consoleBearer('user-1', [UserRoleTypes.User]),
        undefined,
      ),
    ).toEqual({ kind: 'person', userId: 'user-1', role: UserRoleTypes.User });
    expect(
      await service.resolve(
        consoleBearer('user-a', [UserRoleTypes.Admin]),
        null,
      ),
    ).toEqual({ kind: 'person', userId: 'user-a', role: UserRoleTypes.Admin });
  });

  it('ignores the actor: a User cannot state trusted, nor another person', async () => {
    const { service, signIn } = makeActingParty();
    const owner = signIn('user-owner', UserRoleTypes.Owner);
    const ownersToken = await service.mint({
      userId: owner.userId,
      agentId: 'ranch',
      sid: owner.sid,
    });
    const user = consoleBearer('user-1', [UserRoleTypes.User]);
    const asUser = {
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    };

    expect(await service.resolve(user, { kind: 'trusted' })).toEqual(asUser);
    expect(
      await service.resolve(user, { kind: 'person', token: ownersToken }),
    ).toEqual(asUser);
    expect(await service.resolve(user, { kind: 'guest' })).toEqual(asUser);
  });

  it('a token that carries no person role is a guest', async () => {
    const { service } = makeActingParty();

    expect(
      await service.resolve(consoleBearer('user-x', []), undefined),
    ).toEqual(GUEST);
    expect(
      await service.resolve(
        consoleBearer('odd', [UserRoleTypes.Agent]),
        undefined,
      ),
    ).toEqual(GUEST);
  });
});

describe('an acting token as a bearer', () => {
  function guardFor(jwt: JwtService) {
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;
    return new JwtAuthGuard(jwt, reflector);
  }

  function contextFor(token: string) {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/users',
    } as { headers: Record<string, string>; user?: IAuthTokenPayload };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    return { context, req };
  }

  it('JwtAuthGuard refuses a real one as TOKEN_INVALID and sets no user', async () => {
    const { service, jwt, signIn } = makeActingParty(ACTING_TEST_SECRET);
    const { userId, sid } = signIn('user-owner', UserRoleTypes.Owner);
    const token = await service.mint({ userId, agentId: 'ranch', sid });
    const { context, req } = contextFor(token);

    let code: string | undefined;
    try {
      guardFor(jwt).canActivate(context);
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      code = ((e as UnauthorizedException).getResponse() as { code?: string })
        .code;
    }

    expect(code).toBe('TOKEN_INVALID');
    expect(req.user).toBeUndefined();
  });

  it('the same guard still passes the console token it was minted next to', async () => {
    const { jwt } = makeActingParty(ACTING_TEST_SECRET);
    const consoleToken = await jwt.signAsync({
      sub: 'user-owner',
      email: 'owner@example.test',
      roles: [UserRoleTypes.Owner],
      sid: 'sid-user-owner',
    });
    const { context, req } = contextFor(consoleToken);

    expect(guardFor(jwt).canActivate(context)).toBe(true);
    expect(req.user?.sub).toBe('user-owner');
  });
});
