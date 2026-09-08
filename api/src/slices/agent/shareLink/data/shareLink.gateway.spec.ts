import { ShareLinkGateway } from './shareLink.gateway';
import { ShareLinkMapper } from './shareLink.mapper';

// In-memory Prisma stub — same shape as chat.gateway.spec's makePrismaStub.
// It enforces the two @unique columns (agentId, token) so the "one link per
// agent" invariant is exercised here rather than assumed.
function makePrismaStub() {
  const rows: Record<string, Record<string, any>> = {};
  let clock = 0;
  const tick = () => new Date((clock += 1000));

  const find = (where: Record<string, any>) =>
    Object.values(rows).find((r) => {
      if (where.id !== undefined) return r.id === where.id;
      if (where.agentId !== undefined) return r.agentId === where.agentId;
      if (where.token !== undefined) return r.token === where.token;
      return false;
    }) ?? null;

  const agentShareLink = {
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) =>
      find(where),
    ),
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const clash = Object.values(rows).find(
        (r) => r.agentId === data.agentId || r.token === data.token,
      );
      if (clash) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      const at = tick();
      const id = (data.id as string) ?? `link-${Object.keys(rows).length + 1}`;
      rows[id] = {
        id,
        revokedAt: null,
        rotatedAt: null,
        rotationCount: 0,
        createdAt: at,
        updatedAt: at,
        ...data,
      };
      return rows[id];
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, any>;
        data: Record<string, any>;
      }) => {
        const row = find(where);
        if (!row) {
          throw Object.assign(new Error('Record to update not found'), {
            code: 'P2025',
          });
        }
        for (const [k, v] of Object.entries(data)) {
          if (
            v &&
            typeof v === 'object' &&
            !(v instanceof Date) &&
            'increment' in v
          ) {
            row[k] = ((row[k] as number) ?? 0) + (v.increment as number);
          } else {
            row[k] = v;
          }
        }
        row.updatedAt = tick();
        return row;
      },
    ),
  };

  return { prisma: { agentShareLink }, rows };
}

function newGateway() {
  const { prisma, rows } = makePrismaStub();
  const gw = new ShareLinkGateway(
    prisma as unknown as ConstructorParameters<typeof ShareLinkGateway>[0],
    new ShareLinkMapper(),
  );
  return { gw, rows, prisma };
}

describe('ShareLinkGateway.create / findByAgent / findByToken', () => {
  it('round-trips a new link by agent and by token', async () => {
    const { gw } = newGateway();
    const created = await gw.create({
      agentId: 'agent-1',
      token: 'sl_token-1',
      userId: 'user-1',
    });

    expect(created).toMatchObject({
      agentId: 'agent-1',
      token: 'sl_token-1',
      revokedAt: null,
      rotatedAt: null,
      rotationCount: 0,
      createdBy: 'user-1',
      updatedBy: 'user-1',
    });
    // Dates leave the data layer as ISO strings.
    expect(typeof created.createdAt).toBe('string');
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);

    expect(await gw.findByAgent('agent-1')).toEqual(created);
    expect(await gw.findByToken('sl_token-1')).toEqual(created);
  });

  it('returns null for an agent or token that has no row', async () => {
    const { gw } = newGateway();
    expect(await gw.findByAgent('nobody')).toBeNull();
    expect(await gw.findByToken('sl_nope')).toBeNull();
  });

  it('rejects a second link for the same agent with P2002', async () => {
    const { gw } = newGateway();
    await gw.create({ agentId: 'agent-1', token: 'sl_a', userId: 'user-1' });

    await expect(
      gw.create({ agentId: 'agent-1', token: 'sl_b', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('ShareLinkGateway.rotate', () => {
  it('replaces the token, clears revokedAt and increments rotationCount', async () => {
    const { gw } = newGateway();
    await gw.create({ agentId: 'agent-1', token: 'sl_a', userId: 'user-1' });
    await gw.revoke('agent-1', 'user-1');

    const rotated = await gw.rotate('agent-1', 'sl_b', 'user-2');

    expect(rotated.token).toBe('sl_b');
    expect(rotated.revokedAt).toBeNull();
    expect(rotated.rotatedAt).not.toBeNull();
    expect(rotated.rotationCount).toBe(1);
    expect(rotated.updatedBy).toBe('user-2');
    // createdBy is the first sharer and never moves.
    expect(rotated.createdBy).toBe('user-1');

    expect(await gw.findByToken('sl_a')).toBeNull();
    expect(await gw.findByToken('sl_b')).toEqual(rotated);
  });

  it('keeps counting rotations', async () => {
    const { gw } = newGateway();
    await gw.create({ agentId: 'agent-1', token: 'sl_a', userId: 'user-1' });
    await gw.rotate('agent-1', 'sl_b', 'user-1');
    const third = await gw.rotate('agent-1', 'sl_c', 'user-1');
    expect(third.rotationCount).toBe(2);
  });
});

describe('ShareLinkGateway.revoke', () => {
  it('stamps revokedAt and updatedBy without touching the token', async () => {
    const { gw } = newGateway();
    const created = await gw.create({
      agentId: 'agent-1',
      token: 'sl_a',
      userId: 'user-1',
    });

    const revoked = await gw.revoke('agent-1', 'user-2');

    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.updatedBy).toBe('user-2');
    expect(revoked.token).toBe(created.token);
    expect(revoked.rotationCount).toBe(0);
  });
});
