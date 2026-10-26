import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwtAuth.guard';
import type { IAuthTokenPayload } from '../domain/auth.types';

/**
 * The guard's 401 body is a contract with both consoles: `TOKEN_EXPIRED`
 * means "renew and retry", `TOKEN_INVALID` means "renew once, then end the
 * session", `TOKEN_MISSING` means "you are logged out". Pin each one.
 */

function makeGuard(
  verify: (token: string) => IAuthTokenPayload = () => ({
    sub: 'user-1',
    email: 'u@example.com',
    roles: ['User'] as IAuthTokenPayload['roles'],
  }),
  isPublic = false,
) {
  const jwt = {
    verify,
    decode: () => ({ sub: 'user-1' }),
  } as unknown as JwtService;
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  return new JwtAuthGuard(jwt, reflector);
}

function makeContext(headers: Record<string, string | undefined>) {
  const req = { headers, method: 'GET', url: '/auth/me' } as unknown as {
    headers: Record<string, string | undefined>;
    user?: IAuthTokenPayload;
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, req };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof UnauthorizedException) {
      return (err.getResponse() as { code?: string }).code;
    }
    throw err;
  }
  return undefined;
}

describe('JwtAuthGuard', () => {
  it('lets a valid bearer through and stores the payload on req.user', () => {
    const guard = makeGuard();
    const { context, req } = makeContext({ authorization: 'Bearer good' });

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user?.sub).toBe('user-1');
  });

  it('answers TOKEN_MISSING for no header or a non-bearer scheme', () => {
    const guard = makeGuard();
    expect(codeOf(() => guard.canActivate(makeContext({}).context))).toBe(
      'TOKEN_MISSING',
    );
    expect(
      codeOf(() =>
        guard.canActivate(makeContext({ authorization: 'Basic abc' }).context),
      ),
    ).toBe('TOKEN_MISSING');
  });

  it('answers TOKEN_EXPIRED when verification fails with TokenExpiredError', () => {
    const guard = makeGuard(() => {
      throw Object.assign(new Error('jwt expired'), {
        name: 'TokenExpiredError',
      });
    });
    const { context } = makeContext({ authorization: 'Bearer stale' });
    expect(codeOf(() => guard.canActivate(context))).toBe('TOKEN_EXPIRED');
  });

  it('answers TOKEN_INVALID for any other verification failure', () => {
    const guard = makeGuard(() => {
      throw Object.assign(new Error('invalid signature'), {
        name: 'JsonWebTokenError',
      });
    });
    const { context } = makeContext({ authorization: 'Bearer forged' });
    expect(codeOf(() => guard.canActivate(context))).toBe('TOKEN_INVALID');
  });

  it('keeps a human message next to the code', () => {
    const guard = makeGuard();
    try {
      guard.canActivate(makeContext({}).context);
      fail('expected a throw');
    } catch (err) {
      expect((err as UnauthorizedException).getResponse()).toMatchObject({
        code: 'TOKEN_MISSING',
        message: 'Missing access token',
      });
    }
  });

  it('bypasses the check for @Public() routes', () => {
    const guard = makeGuard(() => {
      throw new Error('should not verify');
    }, true);
    expect(guard.canActivate(makeContext({}).context)).toBe(true);
  });
});

describe('JwtAuthGuard — embed tokens (CLEAN-175)', () => {
  // An embed token is signed with the same secret as a console login, so the
  // signature alone proves nothing about WHERE it may be used. The typ claim
  // does: the platform surface refuses it, the chat surface (which verifies
  // tokens itself) keeps accepting it.
  it('refuses a verified embed token as TOKEN_INVALID and leaves req.user unset', () => {
    const guard = makeGuard(() => ({
      sub: 'wslid-A1234567',
      email: '',
      roles: [] as IAuthTokenPayload['roles'],
      typ: 'embed',
    }));
    const { context, req } = makeContext({ authorization: 'Bearer embed' });

    expect(codeOf(() => guard.canActivate(context))).toBe('TOKEN_INVALID');
    expect(req.user).toBeUndefined();
  });

  it('refuses an admin embed token too: roles do not widen where it may be used', () => {
    const guard = makeGuard(() => ({
      sub: 'kiosk',
      email: '',
      roles: ['Owner'] as IAuthTokenPayload['roles'],
      typ: 'embed',
    }));
    const { context, req } = makeContext({ authorization: 'Bearer embed' });

    expect(codeOf(() => guard.canActivate(context))).toBe('TOKEN_INVALID');
    expect(req.user).toBeUndefined();
  });

  it('keeps passing a token without the claim exactly as before', () => {
    const guard = makeGuard();
    const { context, req } = makeContext({ authorization: 'Bearer good' });

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user?.sub).toBe('user-1');
  });
});
