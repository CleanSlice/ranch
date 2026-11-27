import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  agentNotFound,
  agentNotFoundAdvice,
  agentNotFoundText,
  callerAgentId,
  callerIsOperator,
  confirmed,
  err,
  ok,
  requireAgent,
  requireOperator,
  audienceAllows,
  callerLevel,
  callerParty,
  callerPerson,
  manageCaller,
  OWNER_ONLY_LEFT_OUT_FIELD,
  OWNER_ONLY_REASON,
  ownerOnlyConversationsLeftOut,
  ownerOnlyRefusal,
  ownerOnlyText,
  requirePerson,
  setCallerManagesAgents,
  setCallerOwnerOnlyAgent,
  setCallerParty,
  stripSecrets,
} from './tooling';
import { UserRoleTypes } from '#/user/user/domain';
import { asGuest, asPeer, asPerson, asTrustedAgent } from './testing';

const request = (sub: string, roles: UserRoleTypes[]): Request =>
  ({ user: { sub, email: '', roles } }) as unknown as Request;

describe('tooling', () => {
  it('ok wraps strings as-is and objects as pretty JSON', () => {
    expect(ok('hi').content[0].text).toBe('hi');
    expect(ok({ a: 1 }).content[0].text).toBe('{\n  "a": 1\n}');
    expect(ok({}).isError).toBeUndefined();
  });

  it('err marks the result', () => {
    expect(err('no')).toEqual({
      content: [{ type: 'text', text: 'no' }],
      isError: true,
    });
  });

  it('reads the caller agent id from agent tokens only', () => {
    expect(callerAgentId(request('agent:a-1', [UserRoleTypes.Agent]))).toBe(
      'a-1',
    );
    expect(callerAgentId(request('user-1', [UserRoleTypes.Owner]))).toBeNull();
    expect(callerAgentId({} as Request)).toBeNull();
  });

  // Who counts as an operator is the subject of effectiveCaller.spec.ts
  // (CLEAN-232). Here: an agent acting for itself, on each kind of token.
  it('operator means an Owner token, for an agent acting for itself', () => {
    expect(
      callerIsOperator(
        asTrustedAgent(request('agent:admin', [UserRoleTypes.Owner])),
      ),
    ).toBe(true);
    expect(
      callerIsOperator(
        asTrustedAgent(request('agent:a', [UserRoleTypes.Agent])),
      ),
    ).toBe(false);
  });

  it('requireOperator accepts Owner and refuses Agent with the console hint', () => {
    expect(() =>
      requireOperator(
        asTrustedAgent(request('agent:admin', [UserRoleTypes.Owner])),
      ),
    ).not.toThrow();
    expect(() =>
      requireOperator(
        asTrustedAgent(request('agent:a', [UserRoleTypes.Agent])),
      ),
    ).toThrow(ForbiddenException);
    try {
      requireOperator(
        asTrustedAgent(request('agent:a', [UserRoleTypes.Agent])),
      );
    } catch (e) {
      expect((e as Error).message).toContain('operator role');
      expect((e as Error).message).toContain('console');
    }
  });

  it('requireOperator tells a guest that nobody is signed in', () => {
    for (const guest of [
      request('agent:admin', [UserRoleTypes.Owner]),
      asGuest(request('agent:admin', [UserRoleTypes.Owner])),
      {} as Request,
    ]) {
      expect(() => requireOperator(guest)).toThrow(
        new ForbiddenException('This needs a signed-in administrator.'),
      );
    }
  });

  it('requireAgent returns the id for agents and refuses people', () => {
    expect(requireAgent(request('agent:a-2', [UserRoleTypes.Agent]))).toBe(
      'a-2',
    );
    expect(() =>
      requireAgent(request('user-1', [UserRoleTypes.Owner])),
    ).toThrow(ForbiddenException);
  });

  it('confirmed refuses without confirm and names what would happen', () => {
    const refusal = confirmed({}, 'delete agent «bot»');
    expect(refusal?.isError).toBe(true);
    expect(refusal?.content[0].text).toBe(
      'This will delete agent «bot». Ask the person to confirm, then call again with confirm: true.',
    );
    expect(confirmed({ confirm: false }, 'x')).not.toBeNull();
    expect(confirmed({ confirm: 'yes' }, 'x')).not.toBeNull();
    expect(confirmed({ confirm: true }, 'x')).toBeNull();
  });

  it('stripSecrets removes credential fields recursively and keeps the rest', () => {
    const input = {
      id: '1',
      apiKey: 'sk-secret',
      nested: {
        authValue: 'bearer x',
        name: 'n',
        list: [{ token: 't', keep: 1 }],
      },
      value: 'plain',
      when: new Date('2026-09-22T00:00:00Z'),
    };
    const out = stripSecrets(input);
    expect(out).toEqual({
      id: '1',
      nested: { name: 'n', list: [{ keep: 1 }] },
      value: 'plain',
      when: input.when,
    });
    expect(stripSecrets({ value: 'v', id: 1 }, ['value'])).toEqual({ id: 1 });
    expect(stripSecrets('str')).toBe('str');
    expect(stripSecrets(null)).toBeNull();
  });
});

// A refusal names the next move, and the next move must be a tool the caller
// has (CLEAN-232). `list_agents` is a `reader` tool since CLEAN-231: every
// signed-in person has it, as well as an operator. A caller that is nobody
// does not, and is told only that there is no such agent.
describe('agentNotFound', () => {
  const ranch = () => request('agent:agent-ranch', [UserRoleTypes.Owner]);
  const consoleToken = (role: UserRoleTypes) => request('user-1', [role]);
  const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

  const OPERATOR_TEXT =
    'Agent agent-x not found — call list_agents to find the id';
  const BELOW_TEXT =
    'Agent agent-x not found — there is no such agent for this caller';

  it('names list_agents for a caller who has it', () => {
    for (const caller of [
      asTrustedAgent(ranch()),
      asPerson(ranch(), UserRoleTypes.Owner),
      asPerson(ranch(), UserRoleTypes.Admin),
      consoleToken(UserRoleTypes.Owner),
      consoleToken(UserRoleTypes.Admin),
    ]) {
      expect(callerIsOperator(caller)).toBe(true);
      expect(agentNotFoundText(caller, 'agent-x')).toBe(OPERATOR_TEXT);
    }
  });

  it('names list_agents for a signed-in person below Admin: they have it too', () => {
    const creator = asPerson(ranch(), UserRoleTypes.User);
    setCallerManagesAgents(creator, true);
    for (const caller of [
      creator,
      asPerson(ranch(), UserRoleTypes.User),
      consoleToken(UserRoleTypes.User),
    ]) {
      expect(callerIsOperator(caller)).toBe(false);
      expect(agentNotFoundText(caller, 'agent-x')).toBe(OPERATOR_TEXT);
    }
  });

  it('names no tool for a caller that is nobody', () => {
    for (const caller of [
      asGuest(ranch()),
      asTrustedAgent(request('agent:a', [UserRoleTypes.Agent])),
      // A token that names nobody is a guest.
      ranch(),
      {} as Request,
    ]) {
      expect(callerIsOperator(caller)).toBe(false);
      const text = agentNotFoundText(caller, 'agent-x');
      expect(text).toBe(BELOW_TEXT);
      expect(text).not.toContain('list_agents');
      expect(text).not.toContain('list_');
      expect(text).not.toContain('console');
    }
  });

  it('follows the listing: a person named by a plain agent has list_agents, as a person', () => {
    // A plain agent acting for a proven person gets the person's `reader`
    // tools and nothing above (toolAudience.spec.ts), so the advice may name
    // one of them.
    const caller = asPerson(
      request('agent:a', [UserRoleTypes.Agent]),
      UserRoleTypes.Owner,
    );
    expect(callerIsOperator(caller)).toBe(false);
    expect(agentNotFoundText(caller, 'agent-x')).toBe(OPERATOR_TEXT);
  });

  it('hands the text back as an ordinary result, and the advice alone for a tool with its own sentence', () => {
    const below = asGuest(ranch());
    expect(textOf(agentNotFound(below, 'agent-x'))).toBe(
      JSON.stringify({ error: BELOW_TEXT }, null, 2),
    );
    expect(agentNotFound(below, 'agent-x').isError).toBeUndefined();
    expect(agentNotFoundAdvice(asTrustedAgent(ranch()))).toBe(
      'call list_agents to find the id',
    );
    expect(agentNotFoundAdvice(below)).toBe(
      'there is no such agent for this caller',
    );
  });
});

// The Ranch assistant is the one agent a refusal names (CLEAN-263): a person
// who is talking to it and is not the Owner is told who manages it. The
// handler notes the agent on the call; without a note everything is not
// found, as before.
describe('ownerOnlyRefusal', () => {
  const ranch = () => request('agent:agent-ranch', [UserRoleTypes.Owner]);
  const jsonOf = (r: { content: { text: string }[] }) =>
    JSON.parse(r.content[0].text) as Record<string, unknown>;
  const noted = () => {
    const caller = asPerson(ranch(), UserRoleTypes.User);
    setCallerOwnerOnlyAgent(caller, { id: 'agent-ranch', name: 'Rancher' });
    return caller;
  };

  it('says who manages the assistant, with a reason beside the sentence and nothing after it', () => {
    const result = agentNotFound(noted(), 'agent-ranch');

    expect(jsonOf(result)).toEqual({
      error:
        'Rancher is the Ranch assistant. Only the Owner can restart, stop or change it.',
      reason: 'owner_only',
    });
    expect(OWNER_ONLY_REASON).toBe('owner_only');
    expect(result.isError).toBeUndefined();
    expect(ownerOnlyText('Rancher')).not.toMatch(
      /not found|list_agents|again|later|retry|another/i,
    );
  });

  it('knows the agent by its name too, as the tools that take a name read one', () => {
    expect(jsonOf(agentNotFound(noted(), '  rancher '))).toMatchObject({
      reason: 'owner_only',
    });
  });

  it('leaves every other id not found, in the words it had', () => {
    const result = agentNotFound(noted(), 'agent-x');

    expect(jsonOf(result)).toEqual({
      error: 'Agent agent-x not found — call list_agents to find the id',
    });
    expect(ownerOnlyRefusal(noted(), 'agent-x')).toBeNull();
    expect(ownerOnlyRefusal(noted(), '')).toBeNull();
  });

  it('with nothing noted the assistant is not found like anything else', () => {
    const unnoted = asPerson(ranch(), UserRoleTypes.User);
    const cleared = asPerson(ranch(), UserRoleTypes.User);
    setCallerOwnerOnlyAgent(cleared, null);

    for (const caller of [unnoted, cleared, asGuest(ranch()), {} as Request]) {
      expect(ownerOnlyRefusal(caller, 'agent-ranch')).toBeNull();
      expect(jsonOf(agentNotFound(caller, 'agent-ranch'))).not.toHaveProperty(
        'reason',
      );
    }
  });

  it('a note does not travel when the request is spread', () => {
    expect(
      ownerOnlyRefusal({ ...noted() } as Request, 'agent-ranch'),
    ).toBeNull();
  });

  it('an agent without a name is still not called not found', () => {
    const caller = asPerson(ranch(), UserRoleTypes.Admin);
    setCallerOwnerOnlyAgent(caller, { id: 'agent-ranch', name: '' });

    expect(jsonOf(agentNotFound(caller, 'agent-ranch')).error).toBe(
      'This agent is the Ranch assistant. Only the Owner can restart, stop or change it.',
    );
  });
});

// A refusal says what the tool was asked to do (CLEAN-267): the assistant's
// conversations are the Owner's to read, and "restart, stop or change" is
// not what a chat tool was asked for.
describe('ownerOnlyRefusal, by kind', () => {
  const ranch = () => request('agent:agent-ranch', [UserRoleTypes.Owner]);
  const jsonOf = (r: { content: { text: string }[] }) =>
    JSON.parse(r.content[0].text) as Record<string, unknown>;
  /** As the handler notes it: for a tool that manages an agent, or not. */
  const noted = (managing: boolean, name = 'Rancher') => {
    const caller = asPerson(ranch(), UserRoleTypes.Admin);
    setCallerOwnerOnlyAgent(caller, { id: 'agent-ranch', name }, managing);
    return caller;
  };
  const READ = {
    error:
      'Rancher is the Ranch assistant. Only the Owner can read its conversations.',
    reason: 'owner_only',
  };

  it('a tool that reads conversations says who reads them, whatever its audience', () => {
    for (const caller of [noted(false), noted(true)]) {
      expect(
        jsonOf(agentNotFound(caller, 'agent-ranch', 'conversations')),
      ).toEqual(READ);
      expect(
        jsonOf(ownerOnlyRefusal(caller, ' rancher ', 'conversations')!),
      ).toEqual(READ);
    }
    expect(ownerOnlyText('Rancher', 'conversations')).not.toMatch(
      /not found|list_|again|later|retry|another|restart|stop|change/i,
    );
  });

  it('a tool that does not manage an agent keeps its not-found: nobody asked it to restart anything', () => {
    // An `admin` tool that reads an agent by id, handed the assistant's
    // name where the id belongs. The Admin may read it, by its id.
    for (const ref of ['agent-ranch', 'Rancher']) {
      expect(ownerOnlyRefusal(noted(false), ref)).toBeNull();
      expect(jsonOf(agentNotFound(noted(false), ref))).toEqual({
        error: `Agent ${ref} not found — call list_agents to find the id`,
      });
    }
    // A manage-agent tool is answered as it was (CLEAN-263).
    expect(jsonOf(agentNotFound(noted(true), 'agent-ranch')).error).toBe(
      'Rancher is the Ranch assistant. Only the Owner can restart, stop or change it.',
    );
  });

  it('every other agent is not found, for either kind', () => {
    for (const caller of [noted(false), noted(true)]) {
      expect(ownerOnlyRefusal(caller, 'agent-x', 'conversations')).toBeNull();
      expect(jsonOf(agentNotFound(caller, 'agent-x', 'conversations'))).toEqual(
        { error: 'Agent agent-x not found — call list_agents to find the id' },
      );
    }
  });

  it('a list that left the assistant’s conversations out has a sentence to say so, for the same person only', () => {
    expect(ownerOnlyConversationsLeftOut(noted(false))).toBe(
      'The conversations of Rancher, the Ranch assistant, are not included: ' +
        'only the Owner can read them. That is an access limit, not an empty list.',
    );
    expect(ownerOnlyConversationsLeftOut(noted(false, ''))).toBe(
      'The conversations of the Ranch assistant are not included: ' +
        'only the Owner can read them. That is an access limit, not an empty list.',
    );
    expect(OWNER_ONLY_LEFT_OUT_FIELD).toBe('notIncluded');

    const cleared = asPerson(ranch(), UserRoleTypes.Admin);
    setCallerOwnerOnlyAgent(cleared, null);
    for (const caller of [
      cleared,
      asPerson(ranch(), UserRoleTypes.Owner),
      asTrustedAgent(ranch()),
      asGuest(ranch()),
      {} as Request,
    ]) {
      expect(ownerOnlyConversationsLeftOut(caller)).toBeNull();
      expect(
        ownerOnlyRefusal(caller, 'agent-ranch', 'conversations'),
      ).toBeNull();
    }
  });
});

// A colleague's question (CLEAN-236). The party carries the chain and, at
// most, the name of the person the chain was started for. That name is asked
// about reach elsewhere; here it must buy nothing.
describe('a peer party', () => {
  const owners = () => request('agent:admin', [UserRoleTypes.Owner]);
  const plain = () => request('agent:b', [UserRoleTypes.Agent]);

  it('is kept as stated, with its chain and the person it is for', () => {
    const req = asPeer(plain(), {
      chain: ['agent-a'],
      connectionId: 'c-1',
      forUserId: 'user-owner',
    });
    expect(callerParty(req)).toEqual({
      kind: 'peer',
      chain: ['agent-a'],
      connectionId: 'c-1',
      forUserId: 'user-owner',
    });
  });

  it('has no power, even on the Ranch admin agent and even for the Owner', () => {
    const req = asPeer(owners(), { forUserId: 'user-owner' });
    expect(callerLevel(req)).toBe(0);
    expect(callerIsOperator(req)).toBe(false);
    expect(callerPerson(req)).toBeNull();
    expect(manageCaller(req).kind).toBe('peer');
  });

  it('is admitted to the everyone and agent audiences and to no other', () => {
    const req = asPeer(owners(), { forUserId: 'user-owner' });
    setCallerManagesAgents(req, true);
    expect(audienceAllows('everyone', req)).toBe(true);
    expect(audienceAllows('agent', req)).toBe(true);
    for (const audience of [
      'person',
      'reader',
      'manage-agent',
      'admin',
      'owner',
    ] as const) {
      expect([audience, audienceAllows(audience, req)]).toEqual([
        audience,
        false,
      ]);
    }
  });

  it('is refused as nobody signed in, never sent to a console', () => {
    const req = asPeer(owners());
    expect(() => requirePerson(req)).toThrow(
      new ForbiddenException('This needs a signed-in person.'),
    );
    expect(() => requireOperator(req)).toThrow(
      new ForbiddenException('This needs a signed-in administrator.'),
    );
  });

  it('a malformed one reads as nobody at all', () => {
    for (const bad of [
      { kind: 'peer' },
      { kind: 'peer', chain: 'agent-a', connectionId: 'c-1' },
      { kind: 'peer', chain: ['agent-a'], connectionId: '' },
      { kind: 'peer', chain: [1], connectionId: 'c-1' },
      { kind: 'peer', chain: [], connectionId: 'c-1', forUserId: '' },
    ]) {
      const req = plain();
      setCallerParty(req, bad as never);
      expect([bad, callerParty(req)]).toEqual([bad, { kind: 'guest' }]);
    }
  });
});
