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
  setCallerManagesAgents,
  stripSecrets,
} from './tooling';
import { UserRoleTypes } from '#/user/user/domain';
import { asGuest, asPerson, asTrustedAgent } from './testing';

const request = (sub: string, roles: UserRoleTypes[]): Request =>
  ({ user: { sub, email: '', roles } }) as unknown as Request;

describe('tooling', () => {
  it('ok wraps strings as-is and objects as pretty JSON', () => {
    expect(ok('hi').content[0].text).toBe('hi');
    expect(ok({ a: 1 }).content[0].text).toBe('{\n  "a": 1\n}');
    expect(ok({}).isError).toBeUndefined();
  });

  it('err marks the result', () => {
    expect(err('no')).toEqual({ content: [{ type: 'text', text: 'no' }], isError: true });
  });

  it('reads the caller agent id from agent tokens only', () => {
    expect(callerAgentId(request('agent:a-1', [UserRoleTypes.Agent]))).toBe('a-1');
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
    expect(requireAgent(request('agent:a-2', [UserRoleTypes.Agent]))).toBe('a-2');
    expect(() => requireAgent(request('user-1', [UserRoleTypes.Owner]))).toThrow(
      ForbiddenException,
    );
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
      nested: { authValue: 'bearer x', name: 'n', list: [{ token: 't', keep: 1 }] },
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
// has (CLEAN-232). `list_agents` is an `admin` tool; a User who manages the
// agents they created reaches the `manage-agent` tools without it.
describe('agentNotFound', () => {
  const ranch = () => request('agent:agent-ranch', [UserRoleTypes.Owner]);
  const consoleToken = (role: UserRoleTypes) => request('user-1', [role]);
  const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

  const OPERATOR_TEXT =
    'Agent agent-x not found — call list_agents to find the id';
  const BELOW_TEXT =
    'Agent agent-x not found — there is no such agent among the ones this person manages';

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

  it('names no tool for a caller below Admin, a User who manages agents included', () => {
    const creator = asPerson(ranch(), UserRoleTypes.User);
    setCallerManagesAgents(creator, true);
    const ownConsole = consoleToken(UserRoleTypes.User);
    setCallerManagesAgents(ownConsole, true);
    for (const caller of [
      creator,
      ownConsole,
      asPerson(ranch(), UserRoleTypes.User),
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

  it('is the bounded caller that decides: an Owner named by a plain agent has no list_agents', () => {
    // The token caps the party (callerLevel), and `list_agents` is listed by
    // the same rule, so the advice follows the listing.
    const caller = asPerson(
      request('agent:a', [UserRoleTypes.Agent]),
      UserRoleTypes.Owner,
    );
    expect(agentNotFoundText(caller, 'agent-x')).toBe(BELOW_TEXT);
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
      'there is no such agent among the ones this person manages',
    );
  });
});
