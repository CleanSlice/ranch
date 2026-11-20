import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController, consoleOf, sessionCookieOf } from './auth.controller';
import type { AuthService } from './domain/auth.service';
import type { ApiKeyService } from '../apiKey/domain/apiKey.service';
import type { SessionService } from '../session/domain/session.service';

/**
 * The controller is where the cookie is written and cleared; the specs pin
 * the attributes a browser needs to keep the secret out of page code, and
 * that each console has a cookie of its own (CLEAN-236): both consoles call
 * this one host, so under one name it was one sign-in for both.
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
    logout: jest.fn(async (secret: string) => secret.startsWith('rs_live')),
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

/** A request as a console sends it: naming itself, unless `console` is null. */
function makeReq(
  cookies?: Record<string, string>,
  // A console's name, anything else a caller might send, or null for none.
  console: string | null = 'admin',
  userAgent = 'UA/1',
): Request {
  return {
    cookies,
    headers: {
      'user-agent': userAgent,
      ...(console === null ? {} : { 'x-ranch-console': console }),
    },
  } as unknown as Request;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/auth',
  secure: false,
  maxAge: 604_800_000,
};
const CLEARED = { ...COOKIE_OPTIONS, maxAge: 0 };

describe('AuthController — login', () => {
  it('sets the httpOnly /auth cookie of the console and returns the DTO without the secret', async () => {
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
      ['ranch_session_admin', 'rs_login', COOKIE_OPTIONS],
    ]);
    expect(authServiceStub.login).toHaveBeenCalledWith(
      'ada@example.com',
      'pw',
      'admin',
      'UA/1',
    );
  });

  it('signs the user console in under its own cookie, and leaves the other alone', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies, cleared } = makeRes();

    await controller.login(
      { email: 'ada@example.com', password: 'pw' },
      // The management console is signed in already, in the same browser.
      makeReq({ ranch_session_admin: 'rs_owner' }, 'app'),
      res,
    );

    expect(cookies.map(([name]) => name)).toEqual(['ranch_session_app']);
    expect(cleared).toEqual([]);
    expect(authServiceStub.login).toHaveBeenCalledWith(
      'ada@example.com',
      'pw',
      'app',
      'UA/1',
    );
  });

  // A script that signs in for a token, as the settings pages describe:
  // it names no console, and nothing of its sign-in is left in a browser.
  it.each([null, 'dashboard', ''])(
    'signs in without any cookie when no console is named (%p)',
    async (stated) => {
      const { controller, authServiceStub } = makeController();
      const { res, cookies } = makeRes();

      const dto = await controller.login(
        { email: 'ada@example.com', password: 'pw' },
        makeReq({ ranch_session_admin: 'rs_owner' }, stated),
        res,
      );

      expect(dto).toEqual({ accessToken: 'jwt-8', expiresIn: 900, user });
      expect(authServiceStub.login).toHaveBeenCalledWith(
        'ada@example.com',
        'pw',
        null,
        'UA/1',
      );
      expect(cookies).toEqual([]);
    },
  );

  it('reads the name of the console whatever its case', async () => {
    const { controller } = makeController();
    const { res, cookies } = makeRes();

    await controller.login(
      { email: 'ada@example.com', password: 'pw' },
      makeReq(undefined, 'ADMIN '),
      res,
    );

    expect(cookies[0][0]).toBe('ranch_session_admin');
  });
});

describe('AuthController — register', () => {
  it('creates the sign-in in the console that registered', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    await controller.register(
      { name: 'Ada', email: 'ada@example.com', password: 'pw' },
      makeReq(undefined, 'app'),
      res,
    );

    expect(authServiceStub.register).toHaveBeenCalledWith(
      'Ada',
      'ada@example.com',
      'pw',
      'app',
      'UA/1',
    );
    expect(cookies.map(([name]) => name)).toEqual(['ranch_session_app']);
  });

  it('registers without any cookie when no console is named', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    await controller.register(
      { name: 'Ada', email: 'ada@example.com', password: 'pw' },
      makeReq(undefined, null),
      res,
    );

    expect(authServiceStub.register).toHaveBeenCalledWith(
      'Ada',
      'ada@example.com',
      'pw',
      null,
      'UA/1',
    );
    expect(cookies).toEqual([]);
  });
});

describe('AuthController — refresh', () => {
  it('reads the cookie of its console, re-sets it and returns a fresh token', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    const dto = await controller.refresh(
      makeReq({ ranch_session_admin: 'rs_live' }),
      res,
    );

    expect(authServiceStub.refresh).toHaveBeenCalledWith('rs_live', 'admin');
    expect(dto.accessToken).toBe('jwt-7');
    expect(dto.expiresIn).toBe(900);
    expect(cookies).toEqual([
      ['ranch_session_admin', 'rs_live', COOKIE_OPTIONS],
    ]);
  });

  // The reproduction of 2026-11-20: the user console signed in as a User,
  // the management console then signed in as the Owner in the same browser,
  // and the user console's next renewal came back as the Owner.
  it('two consoles in one browser each renew their own sign-in', async () => {
    const { controller, authServiceStub } = makeController();
    const jar = {
      ranch_session_app: 'rs_of_the_user',
      ranch_session_admin: 'rs_of_the_owner',
    };

    const app = makeRes();
    await controller.refresh(makeReq(jar, 'app'), app.res);
    const admin = makeRes();
    await controller.refresh(makeReq(jar, 'admin'), admin.res);

    expect(authServiceStub.refresh.mock.calls).toEqual([
      ['rs_of_the_user', 'app'],
      ['rs_of_the_owner', 'admin'],
    ]);
    expect(app.cookies).toEqual([
      ['ranch_session_app', 'rs_of_the_user', COOKIE_OPTIONS],
    ]);
    expect(admin.cookies).toEqual([
      ['ranch_session_admin', 'rs_of_the_owner', COOKIE_OPTIONS],
    ]);
  });

  it('answers 401 SESSION_MISSING when its own cookie is not there, whatever the other console has', async () => {
    const { controller } = makeController();
    const { res, cookies } = makeRes();

    const err = await controller
      .refresh(makeReq({ ranch_session_admin: 'rs_owner' }, 'app'), res)
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'SESSION_MISSING' });
    expect(cookies).toHaveLength(0);
  });

  it('a request that does not say which console it is has no sign-in at all', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies } = makeRes();

    const err = await controller
      .refresh(
        makeReq(
          { ranch_session_admin: 'rs_owner', ranch_session_app: 'rs_user' },
          null,
        ),
        res,
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'SESSION_INVALID' });
    expect(authServiceStub.refresh).not.toHaveBeenCalled();
    expect(cookies).toHaveLength(0);
  });

  it('never reads the cookie both consoles used to share, and clears it when the browser still sends it', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cookies, cleared } = makeRes();

    const err = await controller
      .refresh(makeReq({ ranch_session: 'rs_from_before' }, 'admin'), res)
      .catch((e) => e);

    // Each console asks for a sign-in once: the old session cannot be said
    // to belong to either.
    expect(err.getResponse()).toMatchObject({ code: 'SESSION_MISSING' });
    expect(authServiceStub.refresh).toHaveBeenCalledWith('', 'admin');
    expect(cookies).toHaveLength(0);
    expect(cleared).toEqual([['ranch_session', CLEARED]]);
  });

  it('reads the cookie of the named console and ignores non-string values', () => {
    const jar = { ranch_session_admin: 'rs_a', ranch_session_app: 'rs_b' };
    expect(sessionCookieOf(makeReq(jar), 'admin')).toBe('rs_a');
    expect(sessionCookieOf(makeReq(jar), 'app')).toBe('rs_b');
    expect(sessionCookieOf(makeReq(), 'admin')).toBe('');
    expect(sessionCookieOf(makeReq({ ranch_session: 'rs_x' }), 'admin')).toBe(
      '',
    );
    expect(
      sessionCookieOf(
        { cookies: { ranch_session_admin: ['a'] } } as unknown as Request,
        'admin',
      ),
    ).toBe('');
  });

  it('reads the console from the header, case and spaces aside, and nothing else', () => {
    expect(consoleOf(makeReq(undefined, 'app'))).toBe('app');
    expect(consoleOf(makeReq(undefined, ' Admin '))).toBe('admin');
    expect(consoleOf(makeReq(undefined, null))).toBeNull();
    expect(consoleOf(makeReq(undefined, 'owner'))).toBeNull();
    expect(
      consoleOf({
        headers: { 'x-ranch-console': ['app', 'admin'] },
      } as unknown as Request),
    ).toBe('app');
  });
});

describe('AuthController — logout', () => {
  it('revokes the sign-in of its console and clears that cookie only', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cleared } = makeRes();

    const dto = await controller.logout(
      makeReq(
        {
          ranch_session_admin: 'rs_live_admin',
          ranch_session_app: 'rs_live_app',
        },
        'app',
      ),
      res,
    );

    expect(dto).toEqual({ revoked: true });
    expect(authServiceStub.logout).toHaveBeenCalledWith('rs_live_app', 'app');
    // The management console stays signed in.
    expect(cleared).toEqual([['ranch_session_app', CLEARED]]);
  });

  it('is 200 with revoked=false and still clears the cookie when nothing matched', async () => {
    const { controller } = makeController();
    const { res, cleared } = makeRes();

    const dto = await controller.logout(makeReq(), res);

    expect(dto).toEqual({ revoked: false });
    expect(cleared).toEqual([['ranch_session_admin', CLEARED]]);
  });

  it('signs nobody out for a request that does not say which console it is', async () => {
    const { controller, authServiceStub } = makeController();
    const { res, cleared } = makeRes();

    const dto = await controller.logout(
      makeReq({ ranch_session_admin: 'rs_live' }, null),
      res,
    );

    expect(dto).toEqual({ revoked: false });
    expect(authServiceStub.logout).not.toHaveBeenCalled();
    expect(cleared).toEqual([]);
  });
});
