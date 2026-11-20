import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '#/user/auth/guards/jwtAuth.guard';
import { clientIdFromJwtPayload } from '#/bridle/domain/chatIdentity';
import { HandoverService, type IHandover } from './handover';

/**
 * The hand-over token (CLEAN-236), on a real `JwtService`: the claim under
 * test is that it cannot be forged, moved to another agent, or used as a
 * credential of its own. `verify` never throws; whatever does not check out
 * is null, and a null is a question from nobody.
 */

const SECRET = 'handover-test-secret';
const TTL = 180;

const make = (secret = SECRET) => {
  const jwt = new JwtService({ secret });
  return { jwt, service: new HandoverService(jwt) };
};

const handover = (over: Partial<IHandover> = {}): IHandover => ({
  agentId: 'agent-b',
  connectionId: 'connection-1',
  chain: ['agent-a'],
  forUserId: 'user-1',
  contextId: 'ctx-1',
  ...over,
});

describe('HandoverService', () => {
  it('reads back what it signed, for the agent it was minted for', async () => {
    const { service } = make();
    const token = await service.mint(handover(), TTL);
    expect(await service.verify(token, 'agent-b')).toEqual(handover());
  });

  it('a chain nobody started carries no person', async () => {
    const { service } = make();
    const token = await service.mint(handover({ forUserId: undefined }), TTL);
    const read = await service.verify(token, 'agent-b');
    expect(read).not.toBeNull();
    expect(read && 'forUserId' in read).toBe(false);
  });

  it('carries no role and no power: only who, through what, and how far', async () => {
    const { service, jwt } = make();
    const payload = jwt.decode(await service.mint(handover(), TTL));
    expect(payload).toMatchObject({
      typ: 'handover',
      aud: 'agent:agent-b',
      via: 'connection-1',
      chain: ['agent-a'],
      for: 'user-1',
      ctx: 'ctx-1',
      roles: [],
      sub: 'handover:connection-1',
    });
    expect(payload.exp - payload.iat).toBe(TTL);
  });

  it('wrong audience: presented at another agent', async () => {
    const { service } = make();
    const token = await service.mint(handover(), TTL);
    expect(await service.verify(token, 'agent-c')).toBeNull();
  });

  it('forged: signed with another secret', async () => {
    const forged = await make('another-secret').service.mint(handover(), TTL);
    expect(await make().service.verify(forged, 'agent-b')).toBeNull();
  });

  it('expired: a second past its lifetime', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
    try {
      const { service } = make();
      const token = await service.mint(handover(), TTL);
      jest.setSystemTime(new Date(Date.now() + (TTL - 1) * 1000));
      expect(await service.verify(token, 'agent-b')).not.toBeNull();
      jest.setSystemTime(new Date(Date.now() + 2000));
      expect(await service.verify(token, 'agent-b')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('not a hand-over: an acting token, a console token, an agent’s own', async () => {
    const { service, jwt } = make();
    const others = [
      {
        sub: 'user-1',
        email: '',
        roles: [],
        typ: 'acting',
        aud: 'agent:agent-b',
      },
      { sub: 'user-1', email: '', roles: ['Owner'], sid: 'sid-1' },
      { sub: 'agent:agent-b', email: '', roles: ['Agent'] },
    ];
    for (const payload of others) {
      const token = await jwt.signAsync(payload);
      expect(await service.verify(token, 'agent-b')).toBeNull();
    }
  });

  it('a shape that is off: no connection, an empty chain, a person that is not a name', async () => {
    const { service, jwt } = make();
    const base = {
      sub: 'handover:c',
      email: '',
      roles: [],
      typ: 'handover',
      aud: 'agent:agent-b',
      via: 'c',
      chain: ['agent-a'],
      ctx: 'ctx-1',
    };
    for (const bad of [
      { ...base, via: '' },
      { ...base, chain: [] },
      { ...base, chain: 'agent-a' },
      { ...base, chain: ['agent-a', 7] },
      { ...base, ctx: undefined },
      { ...base, for: '' },
      { ...base, for: 42 },
    ]) {
      const token = await jwt.signAsync(bad);
      expect([bad, await service.verify(token, 'agent-b')]).toEqual([
        bad,
        null,
      ]);
    }
  });

  it('nothing, or garbage, is nobody and no error', async () => {
    const { service } = make();
    for (const token of [undefined, null, '', 'not-a-token']) {
      expect(await service.verify(token, 'agent-b')).toBeNull();
    }
    expect(await service.verify('x.y.z', '')).toBeNull();
  });
});

describe('a hand-over token as a credential of its own', () => {
  it('JwtAuthGuard refuses it as TOKEN_INVALID and sets no user', async () => {
    const { service, jwt } = make();
    const token = await service.mint(handover(), TTL);
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/agents',
    } as { headers: Record<string, string>; user?: unknown };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;

    let code: string | undefined;
    try {
      new JwtAuthGuard(jwt, reflector).canActivate(context);
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      code = ((e as UnauthorizedException).getResponse() as { code?: string })
        .code;
    }
    expect(code).toBe('TOKEN_INVALID');
    expect(req.user).toBeUndefined();
  });

  it('is no chat identity either: its subject is a reserved name', async () => {
    const { service, jwt } = make();
    const payload = jwt.decode(await service.mint(handover(), TTL));
    expect(clientIdFromJwtPayload(payload)).toBeNull();
  });
});
