import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController, sessionCookieOf } from './auth.controller';
import type { AuthService } from './domain/auth.service';
import type { ApiKeyService } from '../apiKey/domain/apiKey.service';
import type { SessionService } from '../session/domain/session.service';

/**
 * The controller is where the cookie is written and cleared; the specs pin
 * the attributes a browser needs to keep the secret out of page code.
 */

const user = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'Owner',
  status: 'active',
};

function makeController(
  stubs: Partial<Record<keyof AuthService, jest.Mock>> = {},
) {
  const authServiceStub = {
    login: jest.fn(async () => sessionResult('rs_login')),
    register: jest.fn(async () => sessionResult('rs_register')),
    refresh: jest.fn(async (secret: string) => {
      if (!secret) {
        throw new UnauthorizedException({
          code: 'SESSION_MISSING',
          message: 'x',
        });
      }
      return sessionResult(secret);
    }),
    logout: jest.fn(async (secret: string) => secret === 'rs_live'),
    ...stubs,
  };
  const authService = authServiceStub as unknown as AuthService;
  const sessions = {
    cookieOptions: (maxAgeSeconds: number) => ({
      httpOnly: true,
      sameSite: 'lax',
      path: '/auth',
      secure: false,
      maxAge: maxAgeSeconds * 1000,
    }),
    clearCookieOptions: () => ({
      httpOnly: true,
      sameSite: 'lax',
      path: '/auth',
      secure: false,
      maxAge: 0,
    }),
  } as unknown as SessionService;
  const controller = new AuthController(
    authService,
    {} as unknown as ApiKeyService,
    sessions,
  );
  return { controller, authServiceStub };
}

function sessionResult(secret: string) {
  return {
    // Deliberately unrelated to the secret so the "never in the body" checks bite.
    accessToken: `jwt-${secret.length}`,
    expiresIn: 900,
    user,
    cookie: { value: secret, maxAgeSeconds: 604_800 },
  };
}

function makeRes() {
  const cookies: Array<[string, string, Record<string, unknown>]> = [];
  const cleared: Array<[string, Record<string, unknown>]> = [];
  const res = {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => {
      cookies.push([name, value, opts]);
      return res;
    },
    clearCookie: (name: string, opts: Record<string, unknown>) => {
      cleared.push([name, opts]);
      return res;
    },
  } as unknown as Response;
  return { res, cookies, cleared };
}

function makeReq(
  cookies?: Record<string, string>,
  userAgent = 'UA/1',
): Request {
  return {
    cookies,
    headers: { 'user-agent': userAgent },
  } as unknown as Request;
}

describe('AuthController — login', () => {
  it('sets the httpOnly /auth cookie and returns the DTO without the secret', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    const dto = await controller.login(
      { email: 'ada@example.com', password: 'pw' },
      makeReq(),
      res,
    );

    expect(dto).toEqual({ accessToken: 'jwt-8', expiresIn: 900, user });
    expect(JSON.stringify(dto)).not.toContain('rs_login');
    expect(cookies).toEqual([
      [
        'ranch_session',
        'rs_login',
        {
          httpOnly: true,
          sameSite: 'lax',
          path: '/auth',
          secure: false,
          maxAge: 604_800_000,
        },
      ],
    ]);
    expect(authServiceStub.login).toHaveBeenCalledWith(
      'ada@example.com',
      'pw',
      'UA/1',
    );
  });
});

describe('AuthController — refresh', () => {
  it('reads the cookie, re-sets it and returns a fresh token', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    const dto = await controller.refresh(
      makeReq({ ranch_session: 'rs_live' }),
      res,
    );

    expect(authServiceStub.refresh).toHaveBeenCalledWith('rs_live');
    expect(dto.accessToken).toBe('jwt-7');
    expect(dto.expiresIn).toBe(900);
    expect(cookies[0][1]).toBe('rs_live');
  });

  it('answers 401 SESSION_MISSING without a cookie and sets nothing', async () => {
    const { controller } = makeController();
    const { res, cookies } = makeRes();

    const err = await controller.refresh(makeReq(), res).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'SESSION_MISSING' });
    expect(cookies).toHaveLength(0);
  });

  it('ignores non-string cookie values', () => {
    expect(sessionCookieOf(makeReq({ ranch_session: 'rs_x' }))).toBe('rs_x');
    expect(sessionCookieOf(makeReq())).toBe('');
    expect(
      sessionCookieOf({
        cookies: { ranch_session: ['a'] },
      } as unknown as Request),
    ).toBe('');
  });
});

describe('AuthController — logout', () => {
  it('revokes a live session and clears the cookie', async () => {
    const { controller } = makeController();
    const { res, cleared } = makeRes();

    const dto = await controller.logout(
      makeReq({ ranch_session: 'rs_live' }),
      res,
    );

    expect(dto).toEqual({ revoked: true });
    expect(cleared).toEqual([
      [
        'ranch_session',
        {
          httpOnly: true,
          sameSite: 'lax',
          path: '/auth',
          secure: false,
          maxAge: 0,
        },
      ],
    ]);
  });

  it('is 200 with revoked=false and still clears the cookie when nothing matched', async () => {
    const { controller } = makeController();
    const { res, cleared } = makeRes();

    const dto = await controller.logout(makeReq(), res);

    expect(dto).toEqual({ revoked: false });
    expect(cleared).toHaveLength(1);
  });
});
