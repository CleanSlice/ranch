import { ChatActivityGateway } from './chatActivity.gateway';

type Row = Record<string, unknown>;
type Limit = { lt?: number | Date };

// What `prisma.chatSession.fields.lastMessageAt` stands for in the stub: a
// reference to the row's own column, not a value.
const LAST_MESSAGE_AT = { column: 'lastMessageAt' };

const below = (value: unknown, limit: Limit | undefined) =>
  limit?.lt === undefined || (value as number | Date) < limit.lt;

function makePrismaStub(stored: Row[] = []) {
  const hours = stored;

  const chatActivityHour = {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: { sessionId: string; hour: { in: Date[] } };
      }) =>
        hours.filter(
          (h) =>
            h.sessionId === where.sessionId &&
            where.hour.in.some(
              (d) => d.getTime() === (h.hour as Date).getTime(),
            ),
        ),
    ),
    // INSERT … ON CONFLICT DO NOTHING on (sessionId, hour).
    createMany: jest.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Row[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of data) {
          const clash = hours.some(
            (h) =>
              h.sessionId === d.sessionId &&
              (h.hour as Date).getTime() === (d.hour as Date).getTime(),
          );
          if (clash) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
          }
          hours.push({ ...d });
          count++;
        }
        return { count };
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          sessionId: string;
          hour: Date;
          userMessages?: Limit;
          agentMessages?: Limit;
        };
        data: Row;
      }) => {
        let count = 0;
        for (const h of hours) {
          if (h.sessionId !== where.sessionId) continue;
          if ((h.hour as Date).getTime() !== where.hour.getTime()) continue;
          if (!below(h.userMessages, where.userMessages)) continue;
          if (!below(h.agentMessages, where.agentMessages)) continue;
          Object.assign(h, data);
          count++;
        }
        return { count };
      },
    ),
    deleteMany: jest.fn(async ({ where }: { where: { hour: Limit } }) => {
      const kept = hours.filter((h) => !below(h.hour, where.hour));
      const count = hours.length - kept.length;
      hours.splice(0, hours.length, ...kept);
      return { count };
    }),
  };

  const chatSession = {
    fields: { lastMessageAt: LAST_MESSAGE_AT },
    findMany: jest.fn(async (_args: Row): Promise<Row[]> => []),
    updateMany: jest.fn(async (_args: Row) => ({ count: 1 })),
  };

  const prisma = { chatActivityHour, chatSession };
  const gateway = new ChatActivityGateway(
    prisma as unknown as ConstructorParameters<typeof ChatActivityGateway>[0],
  );
  return { gateway, prisma, hours };
}

const SESSION = {
  id: 'c1',
  agentId: 'agent-1',
  channel: 'bridle',
  externalUserId: 'admin',
};

const stored = (iso: string, userMessages: number, agentMessages: number) => ({
  sessionId: 'c1',
  agentId: 'agent-1',
  channel: 'bridle',
  externalUserId: 'admin',
  hour: new Date(iso),
  userMessages,
  agentMessages,
});

const counted = (iso: string, userMessages: number, agentMessages: number) => ({
  hour: new Date(iso),
  userMessages,
  agentMessages,
});

const counts = (hours: Row[]) =>
  [...hours]
    .sort((a, b) => (a.hour as Date).getTime() - (b.hour as Date).getTime())
    .map((h) => [
      (h.hour as Date).toISOString(),
      h.userMessages,
      h.agentMessages,
    ]);

describe('ChatActivityGateway.findUnsettled', () => {
  const gate = {
    quietBefore: new Date('2026-11-27T11:00:00Z'),
    activeSince: new Date('2026-05-31T12:00:00Z'),
    limit: 100,
  };

  it('asks for quiet, recent conversations not read since their last message, newest first', async () => {
    const { gateway, prisma } = makePrismaStub();

    await gateway.findUnsettled(gate);

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lastMessageAt: { lt: gate.quietBefore, gte: gate.activeSince },
          OR: [
            { activityRebuiltAt: null },
            { activityRebuiltAt: { lt: LAST_MESSAGE_AT } },
          ],
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      }),
    );
  });

  it('returns what the pass needs to find the transcript and to own the rows, and no more', async () => {
    const { gateway, prisma } = makePrismaStub();
    const row = {
      id: 'c1',
      agentId: 'agent-1',
      sessionKey: 'bridle:admin',
      channel: 'bridle',
      externalUserId: 'admin',
      lastMessageAt: new Date('2026-11-27T09:00:00Z'),
    };
    prisma.chatSession.findMany.mockResolvedValueOnce([
      { ...row, preview: 'what the person wrote', summary: 'a summary' },
    ]);

    expect(await gateway.findUnsettled(gate)).toEqual([row]);
    // The text of the conversation is not even fetched.
    expect(prisma.chatSession.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      agentId: true,
      sessionKey: true,
      channel: true,
      externalUserId: true,
      lastMessageAt: true,
    });
  });
});

describe('ChatActivityGateway.raise', () => {
  it('creates the hours that are missing, with whose conversation it is', async () => {
    const { gateway, hours } = makePrismaStub();

    const changed = await gateway.raise(SESSION, [
      counted('2026-11-20T09:00:00Z', 2, 2),
      counted('2026-11-20T10:00:00Z', 1, 0),
    ]);

    expect(changed).toBe(2);
    expect(hours).toEqual([
      stored('2026-11-20T09:00:00Z', 2, 2),
      stored('2026-11-20T10:00:00Z', 1, 0),
    ]);
  });

  it('raises a lower hour, leaves an equal and a higher one, each count by itself', async () => {
    const { gateway, hours } = makePrismaStub([
      stored('2026-11-20T09:00:00Z', 1, 0),
      stored('2026-11-20T10:00:00Z', 2, 2),
      stored('2026-11-20T11:00:00Z', 4, 4),
      stored('2026-11-20T12:00:00Z', 5, 0),
    ]);

    const changed = await gateway.raise(SESSION, [
      counted('2026-11-20T09:00:00Z', 2, 2),
      counted('2026-11-20T10:00:00Z', 2, 2),
      counted('2026-11-20T11:00:00Z', 1, 1),
      counted('2026-11-20T12:00:00Z', 1, 2),
    ]);

    expect(changed).toBe(2);
    expect(counts(hours)).toEqual([
      ['2026-11-20T09:00:00.000Z', 2, 2],
      ['2026-11-20T10:00:00.000Z', 2, 2],
      ['2026-11-20T11:00:00.000Z', 4, 4],
      ['2026-11-20T12:00:00.000Z', 5, 2],
    ]);
  });

  it('touches neither the hours the transcript does not mention nor another conversation', async () => {
    const other = { ...stored('2026-11-20T09:00:00Z', 1, 1), sessionId: 'c2' };
    const { gateway, prisma, hours } = makePrismaStub([
      stored('2026-11-19T08:00:00Z', 3, 3),
      other,
    ]);

    await gateway.raise(SESSION, [counted('2026-11-20T09:00:00Z', 2, 2)]);

    expect(counts(hours)).toEqual([
      ['2026-11-19T08:00:00.000Z', 3, 3],
      ['2026-11-20T09:00:00.000Z', 1, 1],
      ['2026-11-20T09:00:00.000Z', 2, 2],
    ]);
    expect(hours[1]).toEqual(other);
    expect(prisma.chatActivityHour.deleteMany).not.toHaveBeenCalled();
  });

  it('changes nothing when given the same counts again', async () => {
    const { gateway, hours } = makePrismaStub();
    const rows = [
      counted('2026-11-20T09:00:00Z', 2, 2),
      counted('2026-11-20T10:00:00Z', 1, 0),
    ];
    await gateway.raise(SESSION, rows);
    const after = structuredClone(hours);

    expect(await gateway.raise(SESSION, rows)).toBe(0);
    expect(hours).toEqual(after);
  });

  // A live event can write the hour between this pass's read and its write.
  // The stored value it did not see must still be the floor.
  it('does not lower an hour that was written after it looked', async () => {
    const { gateway, prisma, hours } = makePrismaStub([
      stored('2026-11-20T09:00:00Z', 5, 5),
      stored('2026-11-20T10:00:00Z', 1, 0),
    ]);
    prisma.chatActivityHour.findMany.mockResolvedValueOnce([]);

    const changed = await gateway.raise(SESSION, [
      counted('2026-11-20T09:00:00Z', 2, 2),
      counted('2026-11-20T10:00:00Z', 2, 2),
    ]);

    expect(changed).toBe(1);
    expect(counts(hours)).toEqual([
      ['2026-11-20T09:00:00.000Z', 5, 5],
      ['2026-11-20T10:00:00.000Z', 2, 2],
    ]);
  });

  it('asks the database nothing for a transcript with no messages', async () => {
    const { gateway, prisma } = makePrismaStub();

    expect(await gateway.raise(SESSION, [])).toBe(0);
    expect(prisma.chatActivityHour.findMany).not.toHaveBeenCalled();
    expect(prisma.chatActivityHour.createMany).not.toHaveBeenCalled();
  });
});

describe('ChatActivityGateway.markSettled', () => {
  it('stamps the conversation, and is quiet about one that is gone', async () => {
    const { gateway, prisma } = makePrismaStub();
    prisma.chatSession.updateMany.mockResolvedValueOnce({ count: 0 });
    const when = new Date('2026-11-27T12:00:00Z');

    await gateway.markSettled('c1', when);

    expect(prisma.chatSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { activityRebuiltAt: when },
    });
  });
});

describe('ChatActivityGateway.pruneBefore', () => {
  it('deletes the hours before the date and says how many', async () => {
    const { gateway, hours } = makePrismaStub([
      stored('2025-10-01T09:00:00Z', 1, 1),
      stored('2025-10-23T12:00:00Z', 1, 1),
      stored('2026-11-20T09:00:00Z', 1, 1),
    ]);

    const removed = await gateway.pruneBefore(new Date('2025-10-23T12:00:00Z'));

    expect(removed).toBe(1);
    expect(counts(hours).map((c) => c[0])).toEqual([
      '2025-10-23T12:00:00.000Z',
      '2026-11-20T09:00:00.000Z',
    ]);
  });
});
