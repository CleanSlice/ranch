import { NotFoundException } from '@nestjs/common';
import { BrowserGateway } from './browser.gateway';
import { BrowserMapper } from './browser.mapper';
import { BrowserlessClient } from './browserless.client';
import { BrowserWarmerService } from './browser-warmer.service';
import { BrowserSessionStatusTypes } from '../domain';

// Minimal in-memory stub for the parts of PrismaService the gateway uses.
// Keeps tests free of a real DB while still exercising the gateway's own
// logic (authz, status transitions, expiry rules).
function makePrismaStub() {
  const rows: Record<
    string,
    ReturnType<BrowserMapper['toCreate']> & {
      createdAt: Date;
      updatedAt: Date;
    }
  > = {};

  return {
    rows,
    browserSession: {
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = Object.values(rows).find(
          (r) =>
            r.userId === where.userId_accountKey.userId &&
            r.accountKey === where.userId_accountKey.accountKey,
        );
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        const row = { ...create, createdAt: now, updatedAt: now };
        rows[create.id] = row as (typeof rows)[string];
        return row;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; userId: string } }) => {
          const row = rows[where.id];
          if (!row) return null;
          return row.userId === where.userId ? row : null;
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { userId: string; status?: string } }) => {
          return Object.values(rows)
            .filter(
              (r) =>
                r.userId === where.userId &&
                // Enum and string compare by value via String() — eslint's
                // no-unsafe-enum-comparison flags raw `===` between branded
                // enum and plain string.
                (where.status === undefined ||
                  String(r.status) === String(where.status)),
            )
            .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows[where.id];
          if (!row) throw new Error('record not found');
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows[where.id];
        delete rows[where.id];
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of Object.values(rows)) {
          if (where.lastUsedAt?.lt && row.lastUsedAt >= where.lastUsedAt.lt)
            continue;
          if (where.status?.notIn?.includes(row.status)) continue;
          Object.assign(row, data, { updatedAt: new Date() });
          count++;
        }
        return { count };
      }),
    },
  };
}

function makePool(): BrowserlessClient {
  return {
    buildCdpUrl: jest.fn(
      (u: string, a: string) => `ws://pool/chromium?u=${u}&a=${a}`,
    ),
    // Same URL pattern as the runtime-facing one in tests — the
    // host-vs-cluster distinction the production code makes doesn't
    // matter for the gateway's logic.
    buildWarmCdpUrl: jest.fn(
      (u: string, a: string) => `ws://pool-warm/chromium?u=${u}&a=${a}`,
    ),
    buildVncUrl: jest.fn(
      (u: string, s: string) => `https://browser.example/live?id=${s}&u=${u}`,
    ),
    profilePath: jest.fn((u: string, a: string) => `/profiles/${u}/${a}`),
  } as unknown as BrowserlessClient;
}

// Warmer normally opens a CDP WebSocket; in tests we just track that it was
// asked to warm/release so we can assert lifecycle integration without
// pulling in `ws` or pretending to be browserless.
function makeWarmer(): BrowserWarmerService & {
  warm: jest.Mock;
  release: jest.Mock;
} {
  return {
    warm: jest.fn(async () => ({ ok: true })),
    release: jest.fn(),
    onModuleDestroy: jest.fn(),
  } as unknown as BrowserWarmerService & {
    warm: jest.Mock;
    release: jest.Mock;
  };
}

// FileGateway here is just a `.save()` spy — the gateway tests assert
// what we ask it to write, not the actual S3 round-trip (covered by the
// existing FileGateway tests in agent/file).
type IFileGatewayMock = { save: jest.Mock };
function makeFiles(): IFileGatewayMock {
  return { save: jest.fn(async () => undefined) };
}

describe('BrowserGateway', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let pool: BrowserlessClient;
  let warmer: ReturnType<typeof makeWarmer>;
  let files: IFileGatewayMock;
  let gateway: BrowserGateway;

  beforeEach(() => {
    prisma = makePrismaStub();
    pool = makePool();
    warmer = makeWarmer();
    files = makeFiles();
    gateway = new BrowserGateway(
      // The PrismaService dep is typed as the full client; the gateway only
      // touches `browserSession`, so a structural stub is enough.
      prisma as unknown as ConstructorParameters<typeof BrowserGateway>[0],
      new BrowserMapper(),
      pool,
      warmer,
      files as unknown as ConstructorParameters<typeof BrowserGateway>[4],
    );
  });

  describe('openSession', () => {
    it('creates a row on first call and returns CDP + VNC URLs', async () => {
      const conn = await gateway.openSession('alice', 'instagram');

      expect(conn.session.userId).toBe('alice');
      expect(conn.session.accountKey).toBe('instagram');
      expect(conn.session.status).toBe(BrowserSessionStatusTypes.Idle);
      expect(conn.cdpUrl).toContain('alice');
      expect(conn.cdpUrl).toContain('instagram');
      expect(conn.vncUrl).toContain(conn.session.id);
    });

    it('reuses the same row when called twice for the same (userId, accountKey)', async () => {
      const first = await gateway.openSession('alice', 'instagram');
      const second = await gateway.openSession('alice', 'instagram');

      // Same row id → same profile path → cookies aren't orphaned.
      expect(second.session.id).toBe(first.session.id);
      // Status flips to Active on reuse (we know the runtime is connecting).
      expect(second.session.status).toBe(BrowserSessionStatusTypes.Active);
    });

    it('keeps separate rows per (userId, accountKey)', async () => {
      const a = await gateway.openSession('alice', 'instagram');
      const b = await gateway.openSession('bob', 'instagram');
      const c = await gateway.openSession('alice', 'paypal');
      expect(new Set([a.session.id, b.session.id, c.session.id]).size).toBe(3);
    });

    it('warms Chrome with a service-specific login URL when caller omits it', async () => {
      await gateway.openSession('alice', 'instagram:miybot');
      // 3rd warmer arg is the URL we navigate Chrome to. Verifies the
      // accountKey → loginUrl mapping kicks in for the common case where
      // the agent forgot to pass loginUrl.
      expect(warmer.warm).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'https://www.instagram.com/accounts/login/',
      );
    });

    it.each([
      ['instagram', 'https://www.instagram.com/accounts/login/'],
      ['instagram_miybot_v3', 'https://www.instagram.com/accounts/login/'],
      ['Instagram-test', 'https://www.instagram.com/accounts/login/'],
      ['twitter', 'https://x.com/login'],
      ['x', 'https://x.com/login'],
      ['twitter_main', 'https://x.com/login'],
      ['facebook_ads_q2', 'https://www.facebook.com/login/'],
      ['facebook:personal', 'https://www.facebook.com/login/'],
      ['paypal_business', 'https://www.paypal.com/signin'],
    ])('routes %s → %s regardless of delimiter', async (key, expected) => {
      await gateway.openSession('alice', key);
      expect(warmer.warm).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expected,
      );
    });

    it('warms with caller-provided loginUrl when present', async () => {
      await gateway.openSession(
        'alice',
        'paypal',
        'https://www.paypal.com/some/deep/link',
      );
      expect(warmer.warm).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'https://www.paypal.com/some/deep/link',
      );
    });

    it('falls back to about:blank for an unknown service prefix', async () => {
      await gateway.openSession('alice', 'novel:thing');
      expect(warmer.warm).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'about:blank',
      );
    });
  });

  describe('importStorageState', () => {
    const cookies = [
      {
        name: 'sessionid',
        value: 'xyz',
        domain: '.instagram.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ];

    it('writes a Playwright-shaped storageState file under the agent prefix', async () => {
      const res = await gateway.importStorageState(
        'agent-abc',
        'admin',
        'instagram',
        cookies,
      );
      // Single-source-of-truth for the path shape: runtime\'s localStatePath
      // must compose the same value or the file lands somewhere browser_play
      // doesn\'t look.
      expect(res).toEqual({
        path: 'browser-state/admin-instagram.json',
        cookies: 1,
      });
      expect(files.save).toHaveBeenCalledTimes(1);
      const [agentId, path, content] = files.save.mock.calls[0];
      expect(agentId).toBe('agent-abc');
      expect(path).toBe('browser-state/admin-instagram.json');
      const parsed = JSON.parse(content as string) as {
        cookies: unknown[];
        origins: unknown[];
      };
      expect(parsed.cookies).toHaveLength(1);
      expect(parsed.origins).toEqual([]);
    });

    it('sanitises userId and profile to filename-safe segments', async () => {
      await gateway.importStorageState(
        'agent-abc',
        '55212224/../../etc',
        'paypal:business main',
        cookies,
      );
      const [, path] = files.save.mock.calls[0];
      // No slashes, no spaces, no dots-as-traversal: the runtime\'s
      // localStatePath uses the same regex pair so they line up.
      expect(path).toBe(
        'browser-state/55212224_.._.._etc-paypal:business_main.json',
      );
      expect(path).not.toContain('/etc');
    });
  });

  describe('authz (requireOwned via mutating methods)', () => {
    it("throws 404 when one user tries to act on another user's session", async () => {
      const conn = await gateway.openSession('alice', 'instagram');

      // 404 (not 403) — we deliberately conflate "doesn't exist" with "not
      // yours" so an attacker can't probe for the existence of other users'
      // session IDs.
      await expect(
        gateway.closeSession('eve', conn.session.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        gateway.setStatus(
          'eve',
          conn.session.id,
          BrowserSessionStatusTypes.NeedsLogin,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        gateway.deleteSession('eve', conn.session.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        gateway.resetSession('eve', conn.session.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 for a session id that does not exist', async () => {
      await expect(
        gateway.closeSession('alice', 'browser-does-not-exist'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mintVncUrl returns null (not throws) for cross-user — used by polling UIs', async () => {
      const conn = await gateway.openSession('alice', 'instagram');
      const eveUrl = await gateway.mintVncUrl('eve', conn.session.id);
      expect(eveUrl).toBeNull();
    });
  });

  describe('findAll', () => {
    it('only returns sessions owned by the caller', async () => {
      await gateway.openSession('alice', 'instagram');
      await gateway.openSession('alice', 'paypal');
      await gateway.openSession('bob', 'instagram');

      const aliceRows = await gateway.findAll({ userId: 'alice' });
      expect(aliceRows.map((r) => r.accountKey).sort()).toEqual([
        'instagram',
        'paypal',
      ]);
    });

    it('filters by status when provided', async () => {
      await gateway.openSession('alice', 'instagram');
      const conn = await gateway.openSession('alice', 'paypal');
      await gateway.setStatus(
        'alice',
        conn.session.id,
        BrowserSessionStatusTypes.NeedsLogin,
      );

      const onlyNeedsLogin = await gateway.findAll({
        userId: 'alice',
        status: BrowserSessionStatusTypes.NeedsLogin,
      });
      expect(onlyNeedsLogin).toHaveLength(1);
      expect(onlyNeedsLogin[0].accountKey).toBe('paypal');
    });
  });

  describe('expireIdleSessions', () => {
    it('marks Idle/Active rows older than the cutoff as Expired', async () => {
      await gateway.openSession('alice', 'a');
      const old = await gateway.openSession('alice', 'b');

      // Backdate one row to simulate an idle session.
      prisma.rows[old.session.id].lastUsedAt = new Date(
        Date.now() - 60 * 60 * 1000,
      );

      const expired = await gateway.expireIdleSessions(30);
      expect(expired).toBe(1);
      const after = await gateway.findAll({ userId: 'alice' });
      const oldRow = after.find((r) => r.id === old.session.id)!;
      expect(oldRow.status).toBe(BrowserSessionStatusTypes.Expired);
    });

    it("leaves NeedsLogin sessions alone (user is mid-login, don't reset state)", async () => {
      const conn = await gateway.openSession('alice', 'needslogin');
      await gateway.setStatus(
        'alice',
        conn.session.id,
        BrowserSessionStatusTypes.NeedsLogin,
      );
      prisma.rows[conn.session.id].lastUsedAt = new Date(
        Date.now() - 60 * 60 * 1000,
      );

      const expired = await gateway.expireIdleSessions(30);
      expect(expired).toBe(0);
      const row = prisma.rows[conn.session.id];
      expect(row.status).toBe(BrowserSessionStatusTypes.NeedsLogin);
    });

    it('leaves already-Expired sessions alone (idempotent)', async () => {
      const conn = await gateway.openSession('alice', 'expired');
      prisma.rows[conn.session.id].lastUsedAt = new Date(
        Date.now() - 60 * 60 * 1000,
      );
      await gateway.expireIdleSessions(30);
      // Second call should be a no-op for the same row.
      const second = await gateway.expireIdleSessions(30);
      expect(second).toBe(0);
    });
  });
});
