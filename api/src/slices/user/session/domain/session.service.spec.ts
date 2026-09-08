import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { ISessionGateway, IPruneSessionsBefore } from './session.gateway';
import { ICreateSessionData, ISessionData } from './session.types';

const DAY_MS = 86_400_000;

function makeGateway() {
  const rows = new Map<string, ISessionData>();
  let seq = 0;
  const gateway = {
    create: jest.fn(async (data: ICreateSessionData) => {
      const now = new Date();
      const row: ISessionData = {
        id: `session-${++seq}`,
        userId: data.userId,
        secretHash: data.secretHash,
        expiresAt: data.expiresAt,
        absoluteExpiresAt: data.absoluteExpiresAt,
        lastSeenAt: now,
        revokedAt: null,
        userAgent: data.userAgent ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    }),
    findByHash: jest.fn(
      async (secretHash: string) =>
        [...rows.values()].find((r) => r.secretHash === secretHash) ?? null,
    ),
    touch: jest.fn(async (id: string, expiresAt: Date) => {
      const row = rows.get(id)!;
      const next = { ...row, expiresAt, lastSeenAt: new Date() };
      rows.set(id, next);
      return next;
    }),
    revoke: jest.fn(async (id: string) => {
      const row = rows.get(id)!;
      if (!row.revokedAt) rows.set(id, { ...row, revokedAt: new Date() });
    }),
    pruneForUser: jest.fn(
      async (userId: string, before: IPruneSessionsBefore) => {
        let n = 0;
        for (const [id, r] of rows) {
          if (r.userId !== userId) continue;
          if (
            r.absoluteExpiresAt < before.absoluteBefore ||
            (r.revokedAt && r.revokedAt < before.revokedBefore)
          ) {
            rows.delete(id);
            n++;
          }
        }
        return n;
      },
    ),
  };
  return {
    gateway: gateway as unknown as ISessionGateway,
    rows,
    stub: gateway,
  };
}

function makeService(env: Record<string, string> = {}) {
  const { gateway, rows, stub } = makeGateway();
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return { service: new SessionService(gateway, config), rows, stub };
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

describe('SessionService — create', () => {
  it('mints an rs_ secret and stores only its sha256', async () => {
    const { service, rows } = makeService();
    const issue = await service.create('user-1', 'Mozilla/5.0');

    expect(issue.secret).toMatch(/^rs_[A-Za-z0-9_-]{43}$/);
    const row = rows.get(issue.sessionId)!;
    expect(row.secretHash).toBe(
      createHash('sha256').update(issue.secret).digest('hex'),
    );
    expect(JSON.stringify(row)).not.toContain(issue.secret);
    expect(row.userAgent).toBe('Mozilla/5.0');
  });

  it('applies the configured idle and absolute windows', async () => {
    const { service, rows } = makeService({
      SESSION_IDLE_DAYS: '2',
      SESSION_ABSOLUTE_DAYS: '10',
    });
    const before = Date.now();
    const issue = await service.create('user-1');
    const row = rows.get(issue.sessionId)!;

    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 2 * DAY_MS - 50,
    );
    expect(row.absoluteExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 10 * DAY_MS - 50,
    );
    expect(issue.cookieMaxAgeSeconds).toBe(2 * 86_400);
  });

  it('falls back to 7 / 30 days on missing or garbage config', async () => {
    const { service } = makeService({ SESSION_IDLE_DAYS: 'nope' });
    expect(service.config()).toMatchObject({ idleDays: 7, absoluteDays: 30 });
  });
});

describe('SessionService — refresh', () => {
  it('slides expiresAt, touches lastSeenAt and keeps the same row and secret', async () => {
    const { service, rows, stub } = makeService({ SESSION_IDLE_DAYS: '1' });
    const issue = await service.create('user-1');
    const original = rows.get(issue.sessionId)!;
    // Pretend the row is half-way through its window.
    rows.set(issue.sessionId, {
      ...original,
      expiresAt: new Date(Date.now() + DAY_MS / 2),
      lastSeenAt: new Date(0),
    });

    const result = await service.refresh(issue.secret);

    expect(result.session.id).toBe(issue.sessionId);
    expect(result.session.secretHash).toBe(original.secretHash);
    expect(result.session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + DAY_MS - 5_000,
    );
    expect(result.session.lastSeenAt.getTime()).toBeGreaterThan(0);
    expect(result.cookieMaxAgeSeconds).toBe(86_400);
    expect(stub.touch).toHaveBeenCalledTimes(1);
  });

  it('answers SESSION_MISSING for an empty secret', async () => {
    const { service } = makeService();
    expect(await codeOf(service.refresh(''))).toBe('SESSION_MISSING');
  });

  it('answers SESSION_INVALID for a wrong prefix or an unknown secret', async () => {
    const { service } = makeService();
    expect(await codeOf(service.refresh('rk_not_a_session'))).toBe(
      'SESSION_INVALID',
    );
    expect(await codeOf(service.refresh('rs_unknownunknownunknown'))).toBe(
      'SESSION_INVALID',
    );
  });

  it('answers SESSION_EXPIRED for revoked, idle-expired and absolute-expired rows', async () => {
    const { service, rows } = makeService();

    const revoked = await service.create('user-1');
    await service.revoke(revoked.secret);
    expect(await codeOf(service.refresh(revoked.secret))).toBe(
      'SESSION_EXPIRED',
    );

    const idle = await service.create('user-1');
    rows.set(idle.sessionId, {
      ...rows.get(idle.sessionId)!,
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await codeOf(service.refresh(idle.secret))).toBe('SESSION_EXPIRED');

    const absolute = await service.create('user-1');
    rows.set(absolute.sessionId, {
      ...rows.get(absolute.sessionId)!,
      absoluteExpiresAt: new Date(Date.now() - 1),
    });
    expect(await codeOf(service.refresh(absolute.secret))).toBe(
      'SESSION_EXPIRED',
    );
  });
});

describe('SessionService — revoke and prune', () => {
  it('revokes once and reports false afterwards or for unknown secrets', async () => {
    const { service } = makeService();
    const issue = await service.create('user-1');

    expect(await service.revoke(issue.secret)).toBe(true);
    expect(await service.revoke(issue.secret)).toBe(false);
    expect(await service.revoke('')).toBe(false);
    expect(await service.revoke('rs_nope')).toBe(false);
  });

  it('prunes only rows past their absolute deadline or revoked more than 30 days ago', async () => {
    const { service, rows } = makeService();
    const live = await service.create('user-1');
    const old = await service.create('user-1');
    const recentlyRevoked = await service.create('user-1');
    const longRevoked = await service.create('user-1');
    const otherUser = await service.create('user-2');

    rows.set(old.sessionId, {
      ...rows.get(old.sessionId)!,
      absoluteExpiresAt: new Date(Date.now() - 1),
    });
    rows.set(recentlyRevoked.sessionId, {
      ...rows.get(recentlyRevoked.sessionId)!,
      revokedAt: new Date(Date.now() - DAY_MS),
    });
    rows.set(longRevoked.sessionId, {
      ...rows.get(longRevoked.sessionId)!,
      revokedAt: new Date(Date.now() - 40 * DAY_MS),
    });
    rows.set(otherUser.sessionId, {
      ...rows.get(otherUser.sessionId)!,
      absoluteExpiresAt: new Date(Date.now() - 1),
    });

    expect(await service.pruneForUser('user-1')).toBe(2);
    expect(rows.has(live.sessionId)).toBe(true);
    expect(rows.has(recentlyRevoked.sessionId)).toBe(true);
    expect(rows.has(old.sessionId)).toBe(false);
    expect(rows.has(longRevoked.sessionId)).toBe(false);
    expect(rows.has(otherUser.sessionId)).toBe(true);
  });
});

describe('SessionService — cookie options', () => {
  it('is httpOnly, lax, scoped to /auth and honours SESSION_COOKIE_SECURE', () => {
    const { service } = makeService({ SESSION_COOKIE_SECURE: 'false' });
    expect(service.cookieOptions(60)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/auth',
      secure: false,
      maxAge: 60_000,
    });
    expect(service.clearCookieOptions().maxAge).toBe(0);

    const secure = makeService().service;
    expect(secure.cookieOptions(1).secure).toBe(true);
  });
});
