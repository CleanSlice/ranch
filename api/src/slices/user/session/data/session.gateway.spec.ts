import { PrismaService } from '#/setup/prisma/prisma.service';
import { SessionGateway } from './session.gateway';
import { SessionMapper } from './session.mapper';

const DAY_MS = 86_400_000;

// In-memory Prisma stub — mirrors chat.gateway.spec's pattern.
function makePrismaStub() {
  const rows: Record<string, Record<string, any>> = {};

  const session = {
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const now = new Date();
      rows[data.id] = {
        lastSeenAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      return rows[data.id];
    }),
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      if (where.id) return rows[where.id] ?? null;
      if (where.secretHash) {
        return (
          Object.values(rows).find((r) => r.secretHash === where.secretHash) ??
          null
        );
      }
      return null;
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: any }) => {
        rows[where.id] = { ...rows[where.id], ...data, updatedAt: new Date() };
        return rows[where.id];
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, any>; data: any }) => {
        let count = 0;
        for (const r of Object.values(rows)) {
          if (r.id !== where.id) continue;
          if (where.revokedAt === null && r.revokedAt !== null) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      },
    ),
    deleteMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      let count = 0;
      for (const [id, r] of Object.entries(rows)) {
        if (r.userId !== where.userId) continue;
        const [abs, rev] = where.OR as Array<Record<string, any>>;
        const pastAbsolute = r.absoluteExpiresAt < abs.absoluteExpiresAt.lt;
        const longRevoked = r.revokedAt && r.revokedAt < rev.revokedAt.lt;
        if (pastAbsolute || longRevoked) {
          delete rows[id];
          count++;
        }
      }
      return { count };
    }),
  };

  return { prisma: { session } as unknown as PrismaService, rows, session };
}

function makeGateway() {
  const { prisma, rows, session } = makePrismaStub();
  return {
    gateway: new SessionGateway(prisma, new SessionMapper()),
    rows,
    session,
  };
}

const baseInput = (userId = 'user-1', secretHash = 'hash-1') => ({
  userId,
  secretHash,
  expiresAt: new Date(Date.now() + DAY_MS),
  absoluteExpiresAt: new Date(Date.now() + 30 * DAY_MS),
  userAgent: 'ua',
});

describe('SessionGateway', () => {
  it('creates a row with a session- id and finds it by hash', async () => {
    const { gateway } = makeGateway();
    const created = await gateway.create(baseInput());

    expect(created.id).toMatch(/^session-/);
    expect(created.revokedAt).toBeNull();
    expect(await gateway.findByHash('hash-1')).toEqual(created);
    expect(await gateway.findByHash('hash-x')).toBeNull();
  });

  it('touch slides expiresAt and stamps lastSeenAt', async () => {
    const { gateway, rows } = makeGateway();
    const created = await gateway.create(baseInput());
    rows[created.id].lastSeenAt = new Date(0);
    const next = new Date(Date.now() + 3 * DAY_MS);

    const touched = await gateway.touch(created.id, next);

    expect(touched.expiresAt).toEqual(next);
    expect(touched.lastSeenAt.getTime()).toBeGreaterThan(0);
  });

  it('revoke is idempotent and keeps the first revokedAt', async () => {
    const { gateway, rows } = makeGateway();
    const created = await gateway.create(baseInput());

    await gateway.revoke(created.id);
    const first = rows[created.id].revokedAt;
    expect(first).toBeInstanceOf(Date);

    await gateway.revoke(created.id);
    expect(rows[created.id].revokedAt).toBe(first);
  });

  it("pruneForUser removes only that user's stale rows", async () => {
    const { gateway, rows } = makeGateway();
    const live = await gateway.create(baseInput('user-1', 'h-live'));
    const stale = await gateway.create(baseInput('user-1', 'h-stale'));
    const revoked = await gateway.create(baseInput('user-1', 'h-rev'));
    const foreign = await gateway.create(baseInput('user-2', 'h-foreign'));
    rows[stale.id].absoluteExpiresAt = new Date(Date.now() - 1);
    rows[revoked.id].revokedAt = new Date(Date.now() - 40 * DAY_MS);
    rows[foreign.id].absoluteExpiresAt = new Date(Date.now() - 1);

    const count = await gateway.pruneForUser('user-1', {
      absoluteBefore: new Date(),
      revokedBefore: new Date(Date.now() - 30 * DAY_MS),
    });

    expect(count).toBe(2);
    expect(rows[live.id]).toBeDefined();
    expect(rows[foreign.id]).toBeDefined();
    expect(rows[stale.id]).toBeUndefined();
    expect(rows[revoked.id]).toBeUndefined();
  });
});
