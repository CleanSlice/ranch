import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISettingGateway } from '#/setting/domain';
import { SessionService } from '#/user/session/domain/session.service';
import { UserMapper } from '../../user/data/user.mapper';
import { AuthService } from './auth.service';

/**
 * The service is the only console-token minter. What matters here: every
 * sign-in path returns a session cookie next to the token, refresh keeps the
 * session id and never the secret in the DTO half, and a gone/disabled user
 * cannot be refreshed even with a live session row.
 */

interface IUserRow {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeDeps(opts: { users?: IUserRow[]; jwtExpiresIn?: string } = {}) {
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const prisma = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return users.get(where.id) ?? null;
          return (
            [...users.values()].find((u) => u.email === where.email) ?? null
          );
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<IUserRow>;
        }) => {
          const next = { ...users.get(where.id)!, ...data };
          users.set(where.id, next);
          return next;
        },
      ),
      create: jest.fn(),
    },
  } as unknown as PrismaService;

  const signed: Array<Record<string, unknown>> = [];
  const jwt = {
    signAsync: jest.fn(async (payload: Record<string, unknown>) => {
      signed.push(payload);
      return `jwt-${signed.length}`;
    }),
    decode: jest.fn(() => ({ exp: 0 })),
  } as unknown as JwtService;

  let seq = 0;
  const liveSecrets = new Map<string, { sessionId: string; userId: string }>();
  const sessionsStub = {
    create: jest.fn(async (userId: string) => {
      const secret = `rs_secret-${++seq}`;
      liveSecrets.set(secret, { sessionId: `session-${seq}`, userId });
      return {
        sessionId: `session-${seq}`,
        secret,
        cookieMaxAgeSeconds: 604_800,
      };
    }),
    refresh: jest.fn(async (secret: string) => {
      const found = liveSecrets.get(secret);
      if (!found) {
        throw new UnauthorizedException({
          code: 'SESSION_INVALID',
          message: 'x',
        });
      }
      return {
        session: { id: found.sessionId, userId: found.userId },
        cookieMaxAgeSeconds: 604_800,
      };
    }),
    revoke: jest.fn(async (secret: string) => liveSecrets.delete(secret)),
    pruneForUser: jest.fn(async () => 0),
  };
  const sessions = sessionsStub as unknown as SessionService;

  const config = {
    get: (key: string) =>
      key === 'JWT_EXPIRES_IN' ? opts.jwtExpiresIn : undefined,
  } as unknown as ConfigService;

  const settings = {
    findByKey: jest.fn(async () => null),
  } as unknown as ISettingGateway;

  const service = new AuthService(
    prisma,
    new UserMapper(),
    jwt,
    settings,
    sessions,
    config,
  );
  return { service, signed, sessions, sessionsStub, prisma, liveSecrets };
}

async function makeUser(overrides: Partial<IUserRow> = {}): Promise<IUserRow> {
  return {
    id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    password: await bcrypt.hash('correct horse', 4),
    role: 'Owner',
    status: 'active',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof UnauthorizedException) {
      return (err.getResponse() as { code?: string }).code;
    }
    throw err;
  }
  return undefined;
}

describe('AuthService — login issues a session', () => {
  it('returns token + expiresIn + cookie, signs sid, prunes the user first', async () => {
    const user = await makeUser();
    const { service, signed, sessionsStub } = makeDeps({
      users: [user],
      jwtExpiresIn: '15m',
    });

    const result = await service.login(
      'ADA@example.com',
      'correct horse',
      'UA/1',
    );

    expect(result.accessToken).toBe('jwt-1');
    expect(result.expiresIn).toBe(900);
    expect(result.user.id).toBe('user-1');
    expect(result.cookie).toEqual({
      value: 'rs_secret-1',
      maxAgeSeconds: 604_800,
    });
    expect(signed[0]).toMatchObject({
      sub: 'user-1',
      roles: ['Owner'],
      sid: 'session-1',
    });
    expect(sessionsStub.pruneForUser).toHaveBeenCalledWith('user-1');
    expect(sessionsStub.create).toHaveBeenCalledWith('user-1', 'UA/1');
  });

  it('keeps the secret out of the token and the user', async () => {
    const user = await makeUser();
    const { service, signed } = makeDeps({ users: [user] });
    const result = await service.login('ada@example.com', 'correct horse');

    expect(
      JSON.stringify({ token: result.accessToken, user: result.user, signed }),
    ).not.toContain(result.cookie.value);
  });

  it('falls back to 15 minutes when JWT_EXPIRES_IN is unset or malformed', async () => {
    expect(makeDeps().service.jwtExpiresInSeconds()).toBe(900);
    expect(
      makeDeps({ jwtExpiresIn: 'soon' }).service.jwtExpiresInSeconds(),
    ).toBe(900);
    expect(makeDeps({ jwtExpiresIn: '2h' }).service.jwtExpiresInSeconds()).toBe(
      7200,
    );
  });
});

describe('AuthService — refresh', () => {
  it('signs a new token bound to the same session and re-issues the same cookie value', async () => {
    const user = await makeUser();
    const { service, signed } = makeDeps({ users: [user] });
    const first = await service.login('ada@example.com', 'correct horse');

    const renewed = await service.refresh(first.cookie.value);

    expect(renewed.accessToken).not.toBe(first.accessToken);
    expect(signed[1]).toMatchObject({ sub: 'user-1', sid: 'session-1' });
    expect(renewed.cookie.value).toBe(first.cookie.value);
    expect(renewed.expiresIn).toBe(900);
    expect(renewed.user.email).toBe('ada@example.com');
  });

  it('refuses with SESSION_INVALID when the user is gone or disabled', async () => {
    const user = await makeUser();
    const { service, prisma } = makeDeps({ users: [user] });
    const first = await service.login('ada@example.com', 'correct horse');

    await (
      prisma as unknown as {
        user: { update: (a: unknown) => Promise<unknown> };
      }
    ).user.update({
      where: { id: 'user-1' },
      data: { status: 'disabled' },
    });
    expect(await codeOf(service.refresh(first.cookie.value))).toBe(
      'SESSION_INVALID',
    );

    const gone = makeDeps({ users: [] });
    (gone.sessions.refresh as jest.Mock).mockResolvedValueOnce({
      session: { id: 'session-x', userId: 'nobody' },
      cookieMaxAgeSeconds: 1,
    });
    expect(await codeOf(gone.service.refresh('rs_whatever'))).toBe(
      'SESSION_INVALID',
    );
  });

  it('propagates the session service refusal after logout', async () => {
    const user = await makeUser();
    const { service } = makeDeps({ users: [user] });
    const first = await service.login('ada@example.com', 'correct horse');

    expect(await service.logout(first.cookie.value)).toBe(true);
    expect(await codeOf(service.refresh(first.cookie.value))).toBe(
      'SESSION_INVALID',
    );
  });
});

describe('AuthService — issueSession for the first-run bootstrap', () => {
  it('produces the same shape as login', async () => {
    const user = await makeUser({ id: 'owner-1', role: 'Owner' });
    const { service, signed } = makeDeps();
    const result = await service.issueSession(
      new UserMapper().toEntity(user as never),
      null,
    );

    expect(result.cookie.value).toMatch(/^rs_/);
    expect(signed[0]).toMatchObject({ sub: 'owner-1', sid: 'session-1' });
    expect(result.expiresIn).toBe(900);
  });
});
