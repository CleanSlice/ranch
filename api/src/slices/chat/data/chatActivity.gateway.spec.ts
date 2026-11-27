import { ChatActivityGateway } from './chatActivity.gateway';

type Row = Record<string, unknown>;
type Limit = { lt?: number | Date };

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

  it('asks for quiet, recent conversations that are due, newest first', async () => {
    const { gateway, prisma } = makePrismaStub();

    await gateway.findUnsettled(gate);

    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activityRebuiltAt: null,
          lastMessageAt: { lt: gate.quietBefore, gte: gate.activeSince },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      }),
    );
  });

  // Due is null and nothing else. The index on [activityRebuiltAt,
  // lastMessageAt] answers an equality and a range; it cannot answer one
  // column compared with another, or an OR over the two.
  it('asks nothing the index cannot answer: no OR, no column compared with a column', async () => {
    const { gateway, prisma } = makePrismaStub();

    await gateway.findUnsettled(gate);

    const { where } = prisma.chatSession.findMany.mock.calls[0][0] as {
      where: Row;
    };
    expect(Object.keys(where).sort()).toEqual([
      'activityRebuiltAt',
      'lastMessageAt',
    ]);
    expect(where.activityRebuiltAt).toBeNull();
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
  // A message that arrived while the transcript was being read is later
  // than the start of the run and has set the column to null. The condition
  // is what keeps this stamp from overwriting that.
  it('stamps the conversation only if it has no message later than the start of the run', async () => {
    const { gateway, prisma } = makePrismaStub();
    const when = new Date('2026-11-27T12:00:00Z');

    await gateway.markSettled('c1', when);

    expect(prisma.chatSession.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.chatSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', lastMessageAt: { lte: when } },
      data: { activityRebuiltAt: when },
    });
  });

  it('is quiet about a conversation that is gone, or that has moved on', async () => {
    const { gateway, prisma } = makePrismaStub();
    prisma.chatSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      gateway.markSettled('c1', new Date('2026-11-27T12:00:00Z')),
    ).resolves.toBeUndefined();
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

// ── One person's hours over a range (CLEAN-258) ───────────────

type AgentScope = { in?: string[]; notIn?: string[] };

interface IPersonHoursArgs {
  where: {
    externalUserId: string;
    channel: string;
    hour: { gte: Date; lte: Date };
    agentId?: AgentScope;
  };
  select: Record<string, boolean>;
  orderBy: { hour: 'asc' | 'desc' };
}

/**
 * The table as `findHoursForPerson` asks it. Each condition is applied the
 * way Postgres applies it, a condition this fake does not know fails the
 * test instead of matching everything, and only the selected columns come
 * back, as from Prisma. None of the columns compared here can be NULL.
 */
function makePersonStub(rows: Row[]) {
  const findMany = jest.fn(
    async ({ where, select, orderBy }: IPersonHoursArgs) => {
      const known = ['externalUserId', 'channel', 'hour', 'agentId'];
      const unknown = Object.keys(where).filter((k) => !known.includes(k));
      if (unknown.length) {
        throw new Error(`the fake cannot answer: ${unknown.join(', ')}`);
      }
      const scope = where.agentId;
      const matched = rows.filter((r) => {
        const at = (r.hour as Date).getTime();
        const agentId = r.agentId as string;
        return (
          r.externalUserId === where.externalUserId &&
          r.channel === where.channel &&
          at >= where.hour.gte.getTime() &&
          at <= where.hour.lte.getTime() &&
          (scope?.in === undefined || scope.in.includes(agentId)) &&
          (scope?.notIn === undefined || !scope.notIn.includes(agentId))
        );
      });
      const direction = orderBy.hour === 'asc' ? 1 : -1;
      matched.sort(
        (a, b) =>
          direction * ((a.hour as Date).getTime() - (b.hour as Date).getTime()),
      );
      return matched.map((r) =>
        Object.fromEntries(Object.keys(select).map((key) => [key, r[key]])),
      );
    },
  );
  const prisma = { chatActivityHour: { findMany } };
  const gateway = new ChatActivityGateway(
    prisma as unknown as ConstructorParameters<typeof ChatActivityGateway>[0],
  );
  return { gateway, findMany };
}

describe('ChatActivityGateway.findHoursForPerson', () => {
  const hourRow = (sessionId: string, iso: string, over: Row = {}): Row => ({
    sessionId,
    agentId: 'agent-1',
    channel: 'bridle',
    externalUserId: 'user-1',
    hour: new Date(iso),
    userMessages: 2,
    agentMessages: 3,
    ...over,
  });

  const FROM = new Date('2026-11-20T22:00:00Z');
  const TO = new Date('2026-11-27T10:30:00Z');

  it('returns that person’s hours on that channel inside the range, both ends included, oldest first', async () => {
    const { gateway } = makePersonStub([
      hourRow('c1', '2026-11-27T10:00:00Z'),
      hourRow('c1', '2026-11-20T22:00:00Z'),
      // An hour too early, and one that has not begun.
      hourRow('c1', '2026-11-20T21:00:00Z'),
      hourRow('c1', '2026-11-27T11:00:00Z'),
      // Somebody else, and the same person on another channel.
      hourRow('c2', '2026-11-25T09:00:00Z', { externalUserId: 'user-2' }),
      hourRow('c3', '2026-11-25T09:00:00Z', { channel: 'telegram' }),
    ]);

    const rows = await gateway.findHoursForPerson('user-1', 'bridle', FROM, TO);

    expect(rows).toEqual([
      {
        sessionId: 'c1',
        agentId: 'agent-1',
        hour: new Date('2026-11-20T22:00:00Z'),
        userMessages: 2,
        agentMessages: 3,
      },
      {
        sessionId: 'c1',
        agentId: 'agent-1',
        hour: new Date('2026-11-27T10:00:00Z'),
        userMessages: 2,
        agentMessages: 3,
      },
    ]);
  });

  it('keeps to the agents of an allowed list', async () => {
    const { gateway } = makePersonStub([
      hourRow('c1', '2026-11-25T09:00:00Z', { agentId: 'agent-1' }),
      hourRow('c2', '2026-11-25T09:00:00Z', { agentId: 'agent-2' }),
    ]);

    const rows = await gateway.findHoursForPerson(
      'user-1',
      'bridle',
      FROM,
      TO,
      { in: ['agent-2'] },
    );

    expect(rows.map((r) => r.agentId)).toEqual(['agent-2']);
  });

  it('leaves out the agents of a denied list', async () => {
    const { gateway } = makePersonStub([
      hourRow('c1', '2026-11-25T09:00:00Z', { agentId: 'agent-1' }),
      hourRow('c2', '2026-11-25T09:00:00Z', { agentId: 'agent-2' }),
    ]);

    const rows = await gateway.findHoursForPerson(
      'user-1',
      'bridle',
      FROM,
      TO,
      { notIn: ['agent-2'] },
    );

    expect(rows.map((r) => r.agentId)).toEqual(['agent-1']);
  });

  it('returns nothing for an account that reaches no agent', async () => {
    const { gateway } = makePersonStub([hourRow('c1', '2026-11-25T09:00:00Z')]);

    expect(
      await gateway.findHoursForPerson('user-1', 'bridle', FROM, TO, {
        in: [],
      }),
    ).toEqual([]);
  });

  // The index is [externalUserId, channel, hour]: two equalities and a
  // range, which is all this asks besides the agents. Anything else in the
  // condition would be a filter over rows the index could not narrow.
  it('asks only what the person’s index answers, and names no agent when there is no list', async () => {
    const { gateway, findMany } = makePersonStub([]);

    await gateway.findHoursForPerson('user-1', 'bridle', FROM, TO);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        externalUserId: 'user-1',
        channel: 'bridle',
        hour: { gte: FROM, lte: TO },
      },
      select: {
        sessionId: true,
        agentId: true,
        hour: true,
        userMessages: true,
        agentMessages: true,
      },
      orderBy: { hour: 'asc' },
    });
  });
});
