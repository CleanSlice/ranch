import { ChatGateway } from './chat.gateway';
import { ChatMapper } from './chat.mapper';
import { IChatReconcileInput } from '../domain';

// In-memory Prisma stub — mirrors ranch's browser.gateway.spec pattern.
function makePrismaStub() {
  const rows: Record<string, Record<string, unknown>> = {};

  const matches = (r: Record<string, unknown>, where: Record<string, unknown> = {}) => {
    if (where.agentId && r.agentId !== where.agentId) return false;
    if (where.channel !== undefined) {
      const c = where.channel as string | { not?: string };
      if (typeof c === 'string' && r.channel !== c) return false;
      if (typeof c === 'object' && c.not !== undefined && r.channel === c.not) return false;
    }
    if (where.archived !== undefined && r.archived !== where.archived) return false;
    return true;
  };

  const chatSession = {
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      if (where.id) return rows[where.id as string] ?? null;
      if (where.agentId_sessionKey) {
        const { agentId, sessionKey } = where.agentId_sessionKey;
        return (
          Object.values(rows).find(
            (r) => r.agentId === agentId && r.sessionKey === sessionKey,
          ) ?? null
        );
      }
      return null;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      rows[data.id as string] = {
        summary: null,
        summaryAt: null,
        insights: null,
        lastIndexedEventId: null,
        title: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...data,
      };
      return rows[data.id as string];
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      rows[where.id] = { ...rows[where.id], ...data };
      return rows[where.id];
    }),
    findMany: jest.fn(
      async ({ where, skip = 0, take = 1000 }: { where?: Record<string, unknown>; skip?: number; take?: number }) => {
        const list = Object.values(rows)
          .filter((r) => matches(r, where))
          .sort((a, b) => (b.lastMessageAt as Date).getTime() - (a.lastMessageAt as Date).getTime());
        return list.slice(skip, skip + take);
      },
    ),
    count: jest.fn(async ({ where }: { where?: Record<string, unknown> }) =>
      Object.values(rows).filter((r) => matches(r, where)).length,
    ),
  };

  const prisma = {
    chatSession,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, rows };
}

function input(over: Partial<IChatReconcileInput> = {}): IChatReconcileInput {
  return {
    agentId: 'agent-1',
    sessionKey: 'bridle:admin',
    channel: 'bridle',
    externalUserId: 'admin',
    title: null,
    archived: false,
    size: 100,
    lastMessageAt: new Date(1000),
    preview: 'hi',
    lastRole: 'user',
    messageCount: 4,
    userMessageCount: 2,
    ...over,
  };
}

function newGateway() {
  const { prisma, rows } = makePrismaStub();
  const gw = new ChatGateway(
    prisma as unknown as ConstructorParameters<typeof ChatGateway>[0],
    new ChatMapper(),
  );
  return { gw, rows };
}

describe('ChatGateway.reconcileUpsert', () => {
  it('creates a row on first index with the file counts as the floor', async () => {
    const { gw } = newGateway();
    const s = await gw.reconcileUpsert(input({ messageCount: 4, userMessageCount: 2 }));
    expect(s.messageCount).toBe(4);
    expect(s.userMessageCount).toBe(2);
    expect(s.lastIndexedSize).toBe(100);
  });

  it('never lowers counts after compaction shrinks the file, but refreshes preview/lastMessageAt', async () => {
    const { gw } = newGateway();
    await gw.reconcileUpsert(input({ messageCount: 40, userMessageCount: 20, size: 5000 }));

    // Compaction shrank the file → fewer viewable messages, newer last message.
    const after = await gw.reconcileUpsert(
      input({
        messageCount: 12,
        userMessageCount: 6,
        size: 900,
        preview: 'latest',
        lastMessageAt: new Date(2000),
      }),
    );

    expect(after.messageCount).toBe(40); // monotonic — not lowered
    expect(after.userMessageCount).toBe(20);
    expect(after.preview).toBe('latest'); // freshness refreshed
    expect(after.lastMessageAt).toEqual(new Date(2000));
    expect(after.lastIndexedSize).toBe(900);
  });

  it('raises counts when the file grew', async () => {
    const { gw } = newGateway();
    await gw.reconcileUpsert(input({ messageCount: 4, userMessageCount: 2 }));
    const after = await gw.reconcileUpsert(input({ messageCount: 9, userMessageCount: 5 }));
    expect(after.messageCount).toBe(9);
    expect(after.userMessageCount).toBe(5);
  });
});

describe('ChatGateway.list', () => {
  it('hides internal channel unless includeInternal, and returns total', async () => {
    const { gw } = newGateway();
    await gw.reconcileUpsert(input({ sessionKey: 'bridle:a', channel: 'bridle', lastMessageAt: new Date(3000) }));
    await gw.reconcileUpsert(input({ sessionKey: 'telegram:b', channel: 'telegram', lastMessageAt: new Date(2000) }));
    await gw.reconcileUpsert(input({ sessionKey: 'internal:heartbeat', channel: 'internal', lastMessageAt: new Date(1000) }));

    const visible = await gw.list({ agentId: 'agent-1' });
    expect(visible.total).toBe(2);
    expect(visible.items.map((i) => i.channel)).toEqual(['bridle', 'telegram']); // desc by lastMessageAt

    const all = await gw.list({ agentId: 'agent-1', includeInternal: true });
    expect(all.total).toBe(3);
  });
});
