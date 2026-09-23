import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  callerAgentId,
  callerIsOperator,
  confirmed,
  err,
  ok,
  requireAgent,
  requireOperator,
  stripSecrets,
} from './tooling';
import { UserRoleTypes } from '#/user/user/domain';

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

  it('operator means the Owner role', () => {
    expect(callerIsOperator(request('agent:admin', [UserRoleTypes.Owner]))).toBe(true);
    expect(callerIsOperator(request('agent:a', [UserRoleTypes.Agent]))).toBe(false);
  });

  it('requireOperator accepts Owner and refuses Agent with the console hint', () => {
    expect(() => requireOperator(request('agent:admin', [UserRoleTypes.Owner]))).not.toThrow();
    expect(() => requireOperator(request('agent:a', [UserRoleTypes.Agent]))).toThrow(
      ForbiddenException,
    );
    try {
      requireOperator(request('agent:a', [UserRoleTypes.Agent]));
    } catch (e) {
      expect((e as Error).message).toContain('operator role');
      expect((e as Error).message).toContain('console');
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
