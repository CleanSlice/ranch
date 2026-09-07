import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ShareLinkService } from '#/agent/shareLink/domain';
import { BridleChatAuthGuard } from './bridleChatAuth.guard';
import type { IChatAuthRequest } from './bridleChatAuth.guard';

/**
 * The guard is the only thing standing between a share visitor and every
 * attachment ever uploaded to an agent, so each branch is pinned here: who is
 * let through, what identity they end up with, and which status code the
 * refusals carry (403 for a rejected share link — a 401 would bounce the
 * console's axios interceptor to /login).
 */

interface IStubs {
  verify?: (token: string) => Record<string, unknown>;
  authorizeChat?: (
    token: string,
    agentId: string,
    visitorId: string,
  ) => Promise<string>;
}

function makeGuard(stubs: IStubs = {}) {
  const calls: Array<[string, string, string]> = [];
  const jwt = {
    verify: stubs.verify ?? (() => ({ sub: 'user-1', roles: ['User'] })),
  } as unknown as JwtService;
  const shareLinks = {
    authorizeChat: async (
      token: string,
      agentId: string,
      visitorId: string,
    ) => {
      calls.push([token, agentId, visitorId]);
      if (stubs.authorizeChat)
        return stubs.authorizeChat(token, agentId, visitorId);
      return `share-${visitorId}`;
    },
  } as unknown as ShareLinkService;

  return { guard: new BridleChatAuthGuard(jwt, shareLinks), calls };
}

function makeContext(
  headers: Record<string, string | undefined>,
  params: Record<string, string> = { agentId: 'agent-1' },
): { context: ExecutionContext; req: IChatAuthRequest } {
  const req = { headers, params } as unknown as IChatAuthRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('BridleChatAuthGuard — JWT callers', () => {
  it('accepts a valid bearer token and uses its sub as the chat client id', async () => {
    const { guard } = makeGuard();
    const { context, req } = makeContext({ authorization: 'Bearer jwt-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.chatClientId).toBe('user-1');
    expect(req.user?.sub).toBe('user-1');
  });

  it('maps owner/admin roles to the shared "admin" client id', async () => {
    // Same mapping as resolveClientId and the websocket handler: console
    // admins share one chat identity so history stays in one channel.
    const { guard } = makeGuard({
      verify: () => ({ sub: 'user-9', roles: ['Owner'] }),
    });
    const { context, req } = makeContext({ authorization: 'Bearer jwt-token' });

    await guard.canActivate(context);
    expect(req.chatClientId).toBe('admin');
  });

  it('never consults the share link service for a JWT caller', async () => {
    const { guard, calls } = makeGuard();
    const { context } = makeContext({
      authorization: 'Bearer jwt-token',
      'x-share-token': 'sl_token',
      'x-share-visitor': 'v1',
    });

    await guard.canActivate(context);
    expect(calls).toHaveLength(0);
  });

  it('rejects a bad bearer token with 401 when no share headers are offered', async () => {
    const { guard } = makeGuard({
      verify: () => {
        throw new Error('jwt expired');
      },
    });
    const { context } = makeContext({ authorization: 'Bearer stale' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('falls through to the share pair when a stale token rides along', async () => {
    // A console user whose session expired opening a share link would
    // otherwise be 401'd on upload while message/sync happily accepted them.
    const { guard } = makeGuard({
      verify: () => {
        throw new Error('jwt expired');
      },
    });
    const { context, req } = makeContext({
      authorization: 'Bearer stale',
      'x-share-token': 'sl_token',
      'x-share-visitor': 'v1',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.chatClientId).toBe('share-v1');
  });
});

describe('BridleChatAuthGuard — share visitors', () => {
  it('accepts the header pair and adopts the share client id', async () => {
    const { guard, calls } = makeGuard();
    const { context, req } = makeContext({
      'x-share-token': 'sl_token',
      'x-share-visitor': 'visitor-7',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.chatClientId).toBe('share-visitor-7');
    expect(calls).toEqual([['sl_token', 'agent-1', 'visitor-7']]);
    expect(req.user).toBeUndefined();
  });

  it('authorizes against the agent id in the path, not one the caller picks', async () => {
    const { guard, calls } = makeGuard();
    const { context } = makeContext(
      { 'x-share-token': 'sl_token', 'x-share-visitor': 'v1' },
      { agentId: 'agent-42' },
    );

    await guard.canActivate(context);
    expect(calls[0][1]).toBe('agent-42');
  });

  it('propagates the service 403 for a revoked or foreign token', async () => {
    const { guard } = makeGuard({
      authorizeChat: () =>
        Promise.reject(new ForbiddenException({ code: 'SHARE_LINK_INVALID' })),
    });
    const { context } = makeContext({
      'x-share-token': 'sl_dead',
      'x-share-visitor': 'v1',
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_LINK_INVALID' },
    });
  });

  it('propagates the service 403 for a missing or malformed visitor id', async () => {
    const { guard, calls } = makeGuard({
      authorizeChat: () =>
        Promise.reject(
          new ForbiddenException({ code: 'SHARE_VISITOR_INVALID' }),
        ),
    });
    const { context } = makeContext({ 'x-share-token': 'sl_token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'SHARE_VISITOR_INVALID' },
    });
    // The empty visitor still reaches the service, which owns the format rule.
    expect(calls).toEqual([['sl_token', 'agent-1', '']]);
  });
});

describe('BridleChatAuthGuard — no credentials', () => {
  it('answers 401 with the unchanged message', async () => {
    const { guard } = makeGuard();
    const { context } = makeContext({});

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
      message: 'Missing access token',
    });
  });

  it('treats a visitor id without a token as no credentials at all', async () => {
    const { guard, calls } = makeGuard();
    const { context } = makeContext({ 'x-share-visitor': 'v1' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(calls).toHaveLength(0);
  });
});
