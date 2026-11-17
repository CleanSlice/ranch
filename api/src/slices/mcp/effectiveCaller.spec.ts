/**
 * Who a tool call is made for, and what that caller may do (CLEAN-232).
 *
 * The table of contracts/acting-party.md section 2, row by row, through the
 * real pieces: `ActingPartyService` turns the bearer and the stated actor
 * into a party (real `JwtService`, so "valid" means it verifies), and the
 * helpers of `tooling.ts` answer with the lesser of the token's power and
 * the party's.
 *
 * The defect this closes: the Ranch admin agent's token carries Owner, and
 * "operator" used to mean "the token carries Owner". So the agent did Owner
 * things for whoever was chatting with it, a plain User included.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import type {
  IAuthTokenPayload,
  ICallerParty,
} from '#/user/auth/domain/auth.types';
import {
  agentBearer,
  makeActingParty,
} from '#/user/auth/domain/__fixtures__/actingParty';
import {
  GUEST_REFUSAL,
  OPERATOR_REFUSAL,
  PERSON_REFUSAL,
  audienceAllows,
  callerAgentId,
  callerIsOperator,
  callerIsOwner,
  callerLevel,
  callerParty,
  callerPerson,
  requireAgent,
  requireOperator,
  requireOwner,
  requirePerson,
  setCallerParty,
  withCallerParty,
} from './tooling';
import { TOOL_AUDIENCES, type ToolAudienceTypes } from './decorators';

type Bearer = Pick<IAuthTokenPayload, 'sub' | 'email' | 'roles'> & {
  sid?: string;
};

const requestOf = (bearer: Bearer): Request =>
  ({ user: bearer }) as unknown as Request;

const consoleBearer = (sub: string, role: UserRoleTypes): Bearer => ({
  sub,
  email: `${sub}@example.test`,
  roles: [role],
  sid: `sid-${sub}`,
});

const RANCH = agentBearer('ranch', true);
const HELPER = agentBearer('helper', false);

/** What the handler does for one call: resolve the party, hand out a view. */
async function callFor(
  acting: ReturnType<typeof makeActingParty>,
  bearer: Bearer,
  actor?: Record<string, unknown> | null,
): Promise<Request> {
  const base = requestOf(bearer);
  return withCallerParty(base, await acting.service.resolve(bearer, actor));
}

const allowed = (req: Request): ToolAudienceTypes[] =>
  TOOL_AUDIENCES.filter((audience) => audienceAllows(audience, req));

describe('effective caller: a person’s console token', () => {
  it('Owner: operator and owner, a person, not an agent', async () => {
    const acting = makeActingParty();
    const req = await callFor(
      acting,
      consoleBearer('user-o', UserRoleTypes.Owner),
    );

    expect(callerParty(req)).toEqual({
      kind: 'person',
      userId: 'user-o',
      role: UserRoleTypes.Owner,
    });
    expect(callerIsOperator(req)).toBe(true);
    expect(callerIsOwner(req)).toBe(true);
    expect(allowed(req)).toEqual(['everyone', 'person', 'admin', 'owner']);
  });

  it('Admin: operator, not owner', async () => {
    const acting = makeActingParty();
    const req = await callFor(
      acting,
      consoleBearer('user-a', UserRoleTypes.Admin),
    );

    expect(callerIsOperator(req)).toBe(true);
    expect(callerIsOwner(req)).toBe(false);
    expect(allowed(req)).toEqual(['everyone', 'person', 'admin']);
    expect(() => requireOperator(req)).not.toThrow();
    expect(() => requireOwner(req)).toThrow(
      new ForbiddenException(OPERATOR_REFUSAL),
    );
  });

  it('User: a person and nothing more', async () => {
    const acting = makeActingParty();
    const req = await callFor(
      acting,
      consoleBearer('user-1', UserRoleTypes.User),
    );

    expect(callerIsOperator(req)).toBe(false);
    expect(callerPerson(req)).toEqual({
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
    expect(allowed(req)).toEqual(['everyone', 'person']);
    expect(() => requireOperator(req)).toThrow(
      new ForbiddenException(OPERATOR_REFUSAL),
    );
  });

  it('the stated actor is ignored: a User stating trusted stays a User', async () => {
    const acting = makeActingParty();
    const owner = acting.signIn('user-o', UserRoleTypes.Owner);
    const ownersToken = await acting.service.mint({
      userId: owner.userId,
      agentId: 'ranch',
      sid: owner.sid,
    });
    const user = consoleBearer('user-1', UserRoleTypes.User);

    for (const actor of [
      { kind: 'trusted' },
      { kind: 'person', token: ownersToken },
    ]) {
      const req = await callFor(acting, user, actor);
      expect(callerIsOperator(req)).toBe(false);
      expect(callerPerson(req)?.userId).toBe('user-1');
    }
  });
});

describe('effective caller: an agent runtime with role Agent', () => {
  it('a valid person: that person, for person tools only; otherwise the agent itself', async () => {
    const acting = makeActingParty();
    const owner = acting.signIn('user-o', UserRoleTypes.Owner);
    const token = await acting.service.mint({
      userId: owner.userId,
      agentId: 'helper',
      sid: owner.sid,
    });
    const req = await callFor(acting, HELPER, { kind: 'person', token });

    // The actor never raises what the token allows: the Owner is proven,
    // and this is still a plain agent.
    expect(callerPerson(req)).toEqual({
      userId: 'user-o',
      role: UserRoleTypes.Owner,
    });
    expect(callerIsOperator(req)).toBe(false);
    expect(callerIsOwner(req)).toBe(false);
    expect(callerLevel(req)).toBe(0);
    expect(callerAgentId(req)).toBe('helper');
    expect(allowed(req)).toEqual(['everyone', 'agent', 'person']);
    expect(requirePerson(req).userId).toBe('user-o');
  });

  it('trusted: the agent itself, agent and everyone tools as today', async () => {
    const acting = makeActingParty();
    const req = await callFor(acting, HELPER, {
      kind: 'trusted',
      via: 'internal',
    });

    expect(callerParty(req)).toEqual({ kind: 'trusted' });
    expect(callerIsOperator(req)).toBe(false);
    expect(callerPerson(req)).toBeNull();
    expect(allowed(req)).toEqual(['everyone', 'agent']);
    expect(requireAgent(req)).toBe('helper');
    expect(() => requireOperator(req)).toThrow(
      new ForbiddenException(OPERATOR_REFUSAL),
    );
  });

  it('guest, absent or unproven: the agent itself', async () => {
    const acting = makeActingParty();
    acting.signIn('user-o', UserRoleTypes.Owner);

    for (const actor of [
      undefined,
      null,
      { kind: 'guest' },
      { kind: 'person', token: 'made-up' },
      { kind: 'person', userId: 'user-o' },
    ]) {
      const req = await callFor(acting, HELPER, actor);
      expect(callerParty(req)).toEqual({ kind: 'guest' });
      expect(callerIsOperator(req)).toBe(false);
      expect(allowed(req)).toEqual(['everyone', 'agent']);
      expect(() => requirePerson(req)).toThrow(
        new ForbiddenException(PERSON_REFUSAL),
      );
    }
  });
});

describe('effective caller: the Ranch admin agent (token carries Owner)', () => {
  it('trusted: the agent, full power, as today', async () => {
    const acting = makeActingParty();
    const req = await callFor(acting, RANCH, {
      kind: 'trusted',
      via: 'internal',
    });

    expect(callerIsOperator(req)).toBe(true);
    expect(callerIsOwner(req)).toBe(true);
    expect(callerPerson(req)).toBeNull();
    expect(allowed(req)).toEqual(['everyone', 'agent', 'admin', 'owner']);
    expect(() => requireOwner(req)).not.toThrow();
  });

  it.each([
    [UserRoleTypes.Owner, ['everyone', 'agent', 'person', 'admin', 'owner']],
    [UserRoleTypes.Admin, ['everyone', 'agent', 'person', 'admin']],
    [UserRoleTypes.User, ['everyone', 'agent', 'person']],
  ])(
    'a valid person who is %s: that person, role read from the database',
    async (role, audiences) => {
      const acting = makeActingParty();
      const person = acting.signIn('user-x', role);
      const token = await acting.service.mint({
        userId: person.userId,
        agentId: 'ranch',
        sid: person.sid,
      });
      const req = await callFor(acting, RANCH, { kind: 'person', token });

      expect(callerPerson(req)).toEqual({ userId: 'user-x', role });
      expect(allowed(req)).toEqual(audiences);
    },
  );

  it('a User asking for a deletion: the Owner token does not carry them', async () => {
    const acting = makeActingParty();
    const user = acting.signIn('user-1', UserRoleTypes.User);
    const token = await acting.service.mint({
      userId: user.userId,
      agentId: 'ranch',
      sid: user.sid,
    });
    const req = await callFor(acting, RANCH, { kind: 'person', token });

    expect(callerIsOperator(req)).toBe(false);
    expect(audienceAllows('admin', req)).toBe(false);
    expect(() => requireOperator(req)).toThrow(
      new ForbiddenException(OPERATOR_REFUSAL),
    );
  });

  it('a demotion lands on the next call, on the same token', async () => {
    const acting = makeActingParty();
    const admin = acting.signIn('user-a', UserRoleTypes.Admin);
    const token = await acting.service.mint({
      userId: admin.userId,
      agentId: 'ranch',
      sid: admin.sid,
    });

    expect(
      callerIsOperator(await callFor(acting, RANCH, { kind: 'person', token })),
    ).toBe(true);

    acting.users.get(admin.userId)!.role = UserRoleTypes.User;

    expect(
      callerIsOperator(await callFor(acting, RANCH, { kind: 'person', token })),
    ).toBe(false);
  });

  it('a person whose token is invalid, expired, for another agent, or whose session or account ended: a guest', async () => {
    const acting = makeActingParty();
    const owner = acting.signIn('user-o', UserRoleTypes.Owner);
    const mint = (agentId = 'ranch') =>
      acting.service.mint({ userId: owner.userId, agentId, sid: owner.sid });
    const guest = async (token: string) => {
      const req = await callFor(acting, RANCH, { kind: 'person', token });
      expect(callerParty(req)).toEqual({ kind: 'guest' });
      expect(callerIsOperator(req)).toBe(false);
      expect(allowed(req)).toEqual(['everyone', 'agent']);
      expect(() => requireOperator(req)).toThrow(
        new ForbiddenException(GUEST_REFUSAL),
      );
    };

    // invalid
    await guest('made-up');
    const [header, body, signature] = (await mint()).split('.');
    await guest(
      `${header}.${body}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`,
    );
    // wrong audience
    await guest(await mint('helper'));
    // expired
    const expired = await acting.jwt.signAsync(
      {
        sub: owner.userId,
        email: '',
        roles: [],
        sid: owner.sid,
        typ: 'acting',
        aud: 'agent:ranch',
      },
      { expiresIn: -60 },
    );
    await guest(expired);

    // session ended
    const good = await mint();
    expect(
      callerIsOwner(
        await callFor(acting, RANCH, { kind: 'person', token: good }),
      ),
    ).toBe(true);
    acting.sessions.get(owner.sid)!.revokedAt = new Date();
    await guest(good);
    acting.sessions.get(owner.sid)!.revokedAt = null;

    // user inactive, then gone
    acting.users.get(owner.userId)!.status = 'disabled';
    await guest(good);
    acting.users.delete(owner.userId);
    await guest(good);
  });

  it('guest, absent, malformed: a guest', async () => {
    const acting = makeActingParty();

    for (const actor of [
      { kind: 'guest' },
      undefined,
      null,
      {},
      { kind: 'admin' },
      { kind: 'person' },
    ]) {
      const req = await callFor(acting, RANCH, actor);
      expect(callerParty(req)).toEqual({ kind: 'guest' });
      expect(callerIsOperator(req)).toBe(false);
      expect(callerIsOwner(req)).toBe(false);
      expect(allowed(req)).toEqual(['everyone', 'agent']);
    }
  });
});

describe('effective caller: nothing attached to the request', () => {
  it('an agent bearer is a guest, whatever roles its token carries', () => {
    const req = requestOf(RANCH);

    expect(callerParty(req)).toEqual({ kind: 'guest' });
    expect(callerIsOperator(req)).toBe(false);
    expect(callerIsOwner(req)).toBe(false);
    expect(() => requireOperator(req)).toThrow(
      new ForbiddenException(GUEST_REFUSAL),
    );
    // Still an agent for its own self-service tools.
    expect(callerAgentId(req)).toBe('ranch');
    expect(allowed(req)).toEqual(['everyone', 'agent']);
  });

  it('a console bearer derives the person from its own token', () => {
    const admin = requestOf(consoleBearer('user-a', UserRoleTypes.Admin));
    const user = requestOf(consoleBearer('user-1', UserRoleTypes.User));

    expect(callerIsOperator(admin)).toBe(true);
    expect(callerIsOwner(admin)).toBe(false);
    expect(callerPerson(admin)).toEqual({
      userId: 'user-a',
      role: UserRoleTypes.Admin,
    });
    expect(callerIsOperator(user)).toBe(false);
    expect(callerPerson(user)?.role).toBe(UserRoleTypes.User);
  });

  it('no bearer at all is a guest', () => {
    for (const req of [{} as Request, { user: {} } as unknown as Request]) {
      expect(callerParty(req)).toEqual({ kind: 'guest' });
      expect(allowed(req)).toEqual(['everyone']);
    }
  });
});

describe('effective caller: the lesser of the token and the party', () => {
  const cases: Array<[string, Bearer, ICallerParty, number]> = [
    ['Owner token, trusted', RANCH, { kind: 'trusted' }, 3],
    [
      'Owner token, Admin person',
      RANCH,
      { kind: 'person', userId: 'u', role: UserRoleTypes.Admin },
      2,
    ],
    [
      'Owner token, User person',
      RANCH,
      { kind: 'person', userId: 'u', role: UserRoleTypes.User },
      1,
    ],
    ['Owner token, guest', RANCH, { kind: 'guest' }, 0],
    ['Agent token, trusted', HELPER, { kind: 'trusted' }, 0],
    [
      'Agent token, Owner person',
      HELPER,
      { kind: 'person', userId: 'u', role: UserRoleTypes.Owner },
      0,
    ],
    [
      'Admin console token, a party claiming Owner',
      consoleBearer('user-a', UserRoleTypes.Admin),
      { kind: 'person', userId: 'user-a', role: UserRoleTypes.Owner },
      2,
    ],
    [
      'User console token, trusted',
      consoleBearer('user-1', UserRoleTypes.User),
      { kind: 'trusted' },
      1,
    ],
  ];

  it.each(cases)('%s', (_label, bearer, party, level) => {
    expect(callerLevel(withCallerParty(requestOf(bearer), party))).toBe(level);
  });

  it('a person party with a role that is not a person’s grants nothing', () => {
    const req = withCallerParty(requestOf(RANCH), {
      kind: 'person',
      userId: 'agent:ranch',
      role: UserRoleTypes.Agent,
    });
    expect(callerLevel(req)).toBe(0);
  });

  it('a malformed party on the request is a guest', () => {
    for (const bad of [
      { kind: 'owner' },
      { kind: 'person' },
      { kind: 'person', userId: 'u', role: 'Superuser' },
      { kind: 'person', userId: '', role: UserRoleTypes.Owner },
      'trusted',
      null,
    ]) {
      const req = requestOf(RANCH);
      setCallerParty(req, bad as never);
      expect(callerParty(req)).toEqual({ kind: 'guest' });
      expect(callerIsOperator(req)).toBe(false);
    }
  });
});

describe('withCallerParty: one view per call', () => {
  it('reads the request through and keeps the party to itself', () => {
    const base = requestOf(RANCH);
    const forUser = withCallerParty(base, {
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
    const forItself = withCallerParty(base, { kind: 'trusted' });

    expect((forUser as unknown as { user: Bearer }).user).toBe(RANCH);
    expect(callerIsOperator(forUser)).toBe(false);
    expect(callerIsOperator(forItself)).toBe(true);
    // The shared request learned nothing from either call.
    expect(callerParty(base)).toEqual({ kind: 'guest' });
    expect(Object.keys(forUser)).toEqual([]);
    expect(JSON.stringify(forUser)).toBe('{}');
  });
});
