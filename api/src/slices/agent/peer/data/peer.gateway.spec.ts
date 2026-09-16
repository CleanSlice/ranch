import { PeerGateway } from './peer.gateway';
import { PeerMapper } from './peer.mapper';
import { PeerOrigins } from '../domain';
import type { IA2aAgentCard } from '../domain';

// In-memory Prisma stub in the shape of shareLink.gateway.spec's. It enforces
// both unique constraints — `token` and the composite (agentId, peerAgentId) —
// so "one connection per direction" and "a credential belongs to one pair" are
// exercised here rather than assumed of the database.
function makePrismaStub() {
  const rows: Record<string, Record<string, any>> = {};
  let clock = 0;
  const tick = () => new Date((clock += 1000));

  const find = (where: Record<string, any>) =>
    Object.values(rows).find((r) => {
      if (where.id !== undefined) return r.id === where.id;
      if (where.token !== undefined) return r.token === where.token;
      if (where.agentId_peerAgentId !== undefined) {
        const { agentId, peerAgentId } = where.agentId_peerAgentId;
        return r.agentId === agentId && r.peerAgentId === peerAgentId;
      }
      return false;
    }) ?? null;

  const agentPeer = {
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) =>
      find(where),
    ),
    findMany: jest.fn(
      async ({
        where,
        orderBy,
      }: {
        where: Record<string, any>;
        orderBy?: Record<string, any>;
      }) => {
        const matches = Object.values(rows).filter(
          (r) => r.agentId === where.agentId,
        );
        if (orderBy?.createdAt === 'asc') {
          matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return matches;
      },
    ),
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const clash = Object.values(rows).find(
        (r) =>
          r.token === data.token ||
          (r.agentId === data.agentId && r.peerAgentId === data.peerAgentId),
      );
      if (clash) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      const at = tick();
      const id = `peer-${Object.keys(rows).length + 1}`;
      rows[id] = { id, createdAt: at, updatedAt: at, ...data };
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
        Object.assign(row, data);
        row.updatedAt = tick();
        return row;
      },
    ),
    delete: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      const row = find(where);
      if (!row) {
        throw Object.assign(new Error('Record to delete does not exist'), {
          code: 'P2025',
        });
      }
      delete rows[row.id as string];
      return row;
    }),
  };

  return { agentPeer, rows };
}

const card = (name: string): IA2aAgentCard => ({
  name,
  description: `${name} does things`,
  version: '1',
  supportedInterfaces: [
    {
      url: `https://api.test/a2a/agents/${name}`,
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
  ],
  capabilities: { streaming: false, pushNotifications: false, extensions: [] },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'skill:1',
      name: 'Order lookup',
      description: 'Finds orders',
      tags: ['skill'],
    },
  ],
});

function makeGateway() {
  const prisma = makePrismaStub();
  const gateway = new PeerGateway(prisma as never, new PeerMapper());
  const connect = (agentId: string, peerAgentId: string, token: string) =>
    gateway.create({
      agentId,
      peerAgentId,
      origin: PeerOrigins.Internal,
      token,
      cardSnapshot: card(peerAgentId),
      cardUrl: `https://api.test/a2a/agents/${peerAgentId}/.well-known/agent-card.json`,
      cardReadAt: new Date('2026-09-14T10:00:00.000Z'),
    });
  return { gateway, prisma, connect };
}

describe('PeerGateway', () => {
  it('stores a connection and reads it back with its card', async () => {
    const { gateway, connect } = makeGateway();

    const created = await connect('a', 'b', 'ap_token_b');

    expect(created).toMatchObject({
      agentId: 'a',
      peerAgentId: 'b',
      token: 'ap_token_b',
      cardReadAt: '2026-09-14T10:00:00.000Z',
    });
    expect(created.cardSnapshot.skills[0].name).toBe('Order lookup');
    await expect(gateway.findById(created.id)).resolves.toMatchObject({
      id: created.id,
    });
  });

  it('resolves a presented credential to the pair it was issued for', async () => {
    const { gateway, connect } = makeGateway();
    await connect('a', 'b', 'ap_token_b');

    const found = await gateway.findByToken('ap_token_b');

    expect(found).toMatchObject({ agentId: 'a', peerAgentId: 'b' });
    await expect(gateway.findByToken('ap_unknown')).resolves.toBeNull();
  });

  it('lists only the connections this agent holds, not the ones pointing at it', async () => {
    const { gateway, connect } = makeGateway();
    await connect('a', 'b', 'ap_1');
    await connect('c', 'a', 'ap_2');

    await expect(gateway.listByAgent('a')).resolves.toHaveLength(1);
    await expect(gateway.listByAgent('a')).resolves.toMatchObject([
      { peerAgentId: 'b' },
    ]);
  });

  it('refuses a second connection to the same peer', async () => {
    const { connect } = makeGateway();
    await connect('a', 'b', 'ap_1');

    await expect(connect('a', 'b', 'ap_2')).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows the opposite direction as its own connection', async () => {
    const { gateway, connect } = makeGateway();
    await connect('a', 'b', 'ap_1');

    await expect(connect('b', 'a', 'ap_2')).resolves.toMatchObject({
      agentId: 'b',
      peerAgentId: 'a',
    });
    await expect(gateway.listByAgent('b')).resolves.toHaveLength(1);
  });

  it('refuses to reuse one credential for two pairs', async () => {
    const { connect } = makeGateway();
    await connect('a', 'b', 'ap_same');

    await expect(connect('a', 'c', 'ap_same')).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('replaces the snapshot on refresh and leaves the credential alone', async () => {
    const { gateway, connect } = makeGateway();
    const created = await connect('a', 'b', 'ap_1');

    const refreshed = await gateway.updateSnapshot(created.id, {
      cardSnapshot: { ...card('b'), description: 'a new description' },
      cardUrl: created.cardUrl,
      cardReadAt: new Date('2026-09-14T12:00:00.000Z'),
    });

    expect(refreshed.cardSnapshot.description).toBe('a new description');
    expect(refreshed.cardReadAt).toBe('2026-09-14T12:00:00.000Z');
    expect(refreshed.token).toBe('ap_1');
  });

  it('kills the credential when the connection is removed', async () => {
    const { gateway, connect } = makeGateway();
    const created = await connect('a', 'b', 'ap_1');

    await gateway.delete(created.id);

    await expect(gateway.findByToken('ap_1')).resolves.toBeNull();
    await expect(gateway.listByAgent('a')).resolves.toEqual([]);
  });

  it('finds a connection by the pair it belongs to', async () => {
    const { gateway, connect } = makeGateway();
    await connect('a', 'b', 'ap_1');

    await expect(gateway.findByPair('a', 'b')).resolves.toMatchObject({
      token: 'ap_1',
    });
    await expect(gateway.findByPair('b', 'a')).resolves.toBeNull();
  });
});
