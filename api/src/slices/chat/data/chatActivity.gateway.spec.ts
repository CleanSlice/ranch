import {
  ChatActivityGateway,
  agentConversationsQuery,
  peopleQuery,
} from './chatActivity.gateway';
// The helper every aggregate of the slice runs through, and its queue: in a
// file of its own since the topic statement joined it (CLEAN-270, review).
import { AGGREGATE_CONCURRENCY, AGGREGATE_WORK_MEM } from './aggregate';

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

// ── The installation's activity (CLEAN-265) ───────────────────
//
// The two statements count in the database and cannot run here. What can
// be held here is everything around them: which agents each is told to
// keep, that every value is bound and none is written into the text, what
// is made of the rows, and that a caller who reaches no agent costs no
// query. The SQL itself is proven only against a real database.

const PERIODS = {
  from: new Date('2026-10-29T00:00:00.000Z'),
  to: new Date('2026-11-27T10:30:00.000Z'),
  previousFrom: new Date('2026-09-29T00:00:00.000Z'),
};

const EVERY_AGENT = { matchesAny: true, in: null, notIn: null };

/** The statement on one line, so a condition can be looked for in it. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * A bound moment as the statements must write it: read as UTC whatever zone
 * the database session is in. `hour` has no zone, a bound `Date` has one,
 * and without this the comparison follows the session (CLEAN-265: two hours
 * off on a session in Europe/Kyiv, with nothing failing).
 */
const UTC = (parameter: string) =>
  `(${parameter}::timestamptz AT TIME ZONE 'UTC')`;

describe('the bounds of every statement', () => {
  it('are read as UTC, never in the zone of the session', () => {
    for (const query of [
      agentConversationsQuery(PERIODS, EVERY_AGENT),
      agentConversationsQuery(PERIODS, EVERY_AGENT, true),
      peopleQuery(PERIODS, EVERY_AGENT),
    ]) {
      const text = flat(query.text);
      // Every comparison of `hour` is with a moment written the UTC way:
      // none is left with a bare parameter.
      const compared = text.match(/"hour" (>=|<=|<|>) \S+/g) ?? [];
      expect(compared.length).toBeGreaterThan(1);
      for (const comparison of compared) {
        expect(comparison).toMatch(/"hour" (>=|<=|<|>) \(\$\d+::timestamptz$/);
      }
      expect(text.match(/AT TIME ZONE 'UTC'/g)).toHaveLength(compared.length);
    }
  });
});

describe('agentConversationsQuery', () => {
  it('reads the period only, bound by its two ends', () => {
    const query = agentConversationsQuery(PERIODS, EVERY_AGENT);

    expect(flat(query.text)).toContain(
      `"hour" >= ${UTC('$2')} AND "hour" <= ${UTC('$3')}`,
    );
    expect(query.values).toEqual([
      'share-%',
      PERIODS.from,
      PERIODS.to,
      'internal',
      'peer:%',
    ]);
  });

  it('counts only hours a person wrote in, and leaves out scheduled jobs and other agents’ questions', () => {
    const text = flat(agentConversationsQuery(PERIODS, EVERY_AGENT).text);

    expect(text).toContain('"userMessages" > 0');
    expect(text).toContain('"channel" <> $4');
    expect(text).toContain('"externalUserId" NOT LIKE $5');
  });

  it('counts a conversation once, however many of its hours fall in the period', () => {
    const text = flat(agentConversationsQuery(PERIODS, EVERY_AGENT).text);

    // One row per conversation first, then the rows are counted.
    expect(text).toContain(
      'GROUP BY "sessionId", "agentId", "channel", "externalUserId"',
    );
    expect(text).toContain('COUNT(*) AS "conversations"');
    expect(text).toContain('GROUP BY c."agentId", c."channel", c."share"');
  });

  // The whole statement, as it has shipped since CLEAN-265. An installation
  // that produces no summaries, the ordinary one, runs exactly this: one
  // table, no join (CLEAN-270).
  it('is this statement and no more when the outcomes are not asked for: `ChatSession` is not read', () => {
    const plain = agentConversationsQuery(PERIODS, EVERY_AGENT);
    const said = agentConversationsQuery(PERIODS, EVERY_AGENT, false);

    expect(flat(plain.text)).toBe(
      'SELECT c."agentId", c."channel", c."share", COUNT(*) AS "conversations" ' +
        'FROM ( ' +
        'SELECT "sessionId", "agentId", "channel", ' +
        '("externalUserId" LIKE $1) AS "share" ' +
        'FROM "ChatActivityHour" ' +
        `WHERE "hour" >= ${UTC('$2')} AND "hour" <= ${UTC('$3')} ` +
        'AND "userMessages" > 0 ' +
        'AND "channel" <> $4 ' +
        'AND "externalUserId" NOT LIKE $5 ' +
        'GROUP BY "sessionId", "agentId", "channel", "externalUserId" ' +
        ') c ' +
        'GROUP BY c."agentId", c."channel", c."share"',
    );
    expect(plain.text).not.toContain('ChatSession');
    expect(plain.text).not.toContain('JOIN');
    expect(said.text).toBe(plain.text);
    expect(said.values).toEqual(plain.values);
  });

  it('names no agent for a caller nothing is hidden from', () => {
    const text = flat(agentConversationsQuery(PERIODS, EVERY_AGENT).text);

    expect(text).not.toContain('"agentId" IN');
    expect(text).not.toContain('"agentId" NOT IN');
  });

  it('keeps a limited caller to their agents, each id bound', () => {
    const query = agentConversationsQuery(PERIODS, {
      matchesAny: true,
      in: ['agent-1', 'agent-2'],
      notIn: null,
    });

    expect(flat(query.text)).toContain('AND "agentId" IN ($6,$7)');
    expect(flat(query.text)).not.toContain('NOT IN');
    expect(query.values.slice(5)).toEqual(['agent-1', 'agent-2']);
    expect(query.text).not.toContain('agent-1');
  });

  it('leaves out the denied agents of a caller who is not limited', () => {
    const query = agentConversationsQuery(PERIODS, {
      matchesAny: true,
      in: null,
      notIn: ['agent-3'],
    });

    expect(flat(query.text)).toContain('AND "agentId" NOT IN ($6)');
    expect(flat(query.text)).not.toContain('"agentId" IN');
    expect(query.values.slice(5)).toEqual(['agent-3']);
  });

  it('applies both lists when both are given', () => {
    const query = agentConversationsQuery(PERIODS, {
      matchesAny: true,
      in: ['agent-1', 'agent-2'],
      notIn: ['agent-2'],
    });

    expect(flat(query.text)).toContain(
      'AND "agentId" IN ($6,$7) AND "agentId" NOT IN ($8)',
    );
    expect(query.values.slice(5)).toEqual(['agent-1', 'agent-2', 'agent-2']);
  });

  // An id is whatever the access lists hold. It travels as a value.
  it('never writes an id into the statement, whatever it holds', () => {
    const hostile = `x') OR 1=1 --`;
    const query = agentConversationsQuery(PERIODS, {
      matchesAny: true,
      in: [hostile],
      notIn: null,
    });

    expect(query.text).not.toContain('OR 1=1');
    expect(query.values).toContain(hostile);
  });
});

describe('peopleQuery', () => {
  it('reads the period and the one before it in one pass, and tells them apart at the period’s start', () => {
    const query = peopleQuery(PERIODS, EVERY_AGENT);
    const text = flat(query.text);

    expect(text).toContain(`"hour" >= ${UTC('$3')} AND "hour" <= ${UTC('$4')}`);
    expect(text).toContain(`bool_or("hour" >= ${UTC('$1')}) AS "inPeriod"`);
    expect(text).toContain(`bool_or("hour" < ${UTC('$2')}) AS "inPrevious"`);
    expect(query.values).toEqual([
      PERIODS.from,
      PERIODS.from,
      PERIODS.previousFrom,
      PERIODS.to,
      'internal',
      'peer:%',
    ]);
  });

  it('counts a person once per period, whichever agents and channels they wrote on', () => {
    const text = flat(peopleQuery(PERIODS, EVERY_AGENT).text);

    expect(text).toContain('GROUP BY "externalUserId"');
    expect(text).toContain('COUNT(*) FILTER (WHERE p."inPeriod") AS "value"');
    expect(text).toContain(
      'COUNT(*) FILTER (WHERE p."inPrevious") AS "previous"',
    );
    // The identity is grouped on and never selected: nobody is named.
    expect(text).not.toMatch(/SELECT[^()]*"externalUserId"/);
  });

  it('counts only people: hours somebody wrote in, no scheduled job, no other agent', () => {
    const text = flat(peopleQuery(PERIODS, EVERY_AGENT).text);

    expect(text).toContain('"userMessages" > 0');
    expect(text).toContain('"channel" <> $5');
    expect(text).toContain('"externalUserId" NOT LIKE $6');
  });

  it('carries the same agents as the conversations query', () => {
    const limited = peopleQuery(PERIODS, {
      matchesAny: true,
      in: ['agent-1', 'agent-2'],
      notIn: null,
    });
    expect(flat(limited.text)).toContain('AND "agentId" IN ($7,$8)');
    expect(limited.values.slice(6)).toEqual(['agent-1', 'agent-2']);

    const excluding = peopleQuery(PERIODS, {
      matchesAny: true,
      in: null,
      notIn: ['agent-3'],
    });
    expect(flat(excluding.text)).toContain('AND "agentId" NOT IN ($7)');
    expect(excluding.values.slice(6)).toEqual(['agent-3']);

    const everyone = flat(peopleQuery(PERIODS, EVERY_AGENT).text);
    expect(everyone).not.toContain('"agentId"');
  });
});

// How the period's conversations ended (CLEAN-270): the open share of the
// installation's quality block. Not a statement of its own. It was one, for
// a day: it scanned and hashed the hour rows the conversations statement
// had just scanned and hashed, and took a 90-day view from 0.65 s to 1.65 s
// on a database of a million conversations. The conversations statement
// now carries the two counts, from a join to each conversation's summary,
// and only where summaries are produced.
describe('agentConversationsQuery, with how the conversations ended', () => {
  const withOutcomes = (
    scope: Parameters<typeof agentConversationsQuery>[1] = EVERY_AGENT,
  ) => agentConversationsQuery(PERIODS, scope, true);

  it('is the same statement with each conversation joined to its summary, and two counts more', () => {
    const query = withOutcomes();

    expect(flat(query.text)).toBe(
      'SELECT c."agentId", c."channel", c."share", COUNT(*) AS "conversations", ' +
        'COUNT(s."id") AS "summarised", ' +
        'COUNT(*) FILTER (WHERE s."outcome" = $1) AS "open" ' +
        'FROM ( ' +
        'SELECT "sessionId", "agentId", "channel", ' +
        '("externalUserId" LIKE $2) AS "share" ' +
        'FROM "ChatActivityHour" ' +
        `WHERE "hour" >= ${UTC('$3')} AND "hour" <= ${UTC('$4')} ` +
        'AND "userMessages" > 0 ' +
        'AND "channel" <> $5 ' +
        'AND "externalUserId" NOT LIKE $6 ' +
        'GROUP BY "sessionId", "agentId", "channel", "externalUserId" ' +
        ') c ' +
        'LEFT JOIN "ChatSession" s ' +
        'ON s."id" = c."sessionId" AND s."summaryAt" IS NOT NULL ' +
        'GROUP BY c."agentId", c."channel", c."share"',
    );
    expect(query.values).toEqual([
      'open',
      'share-%',
      PERIODS.from,
      PERIODS.to,
      'internal',
      'peer:%',
    ]);
  });

  // A LEFT join, with "has a summary" in its condition: a conversation
  // without one keeps its row and is counted as a conversation, with
  // nothing to count under the other two.
  it('counts every conversation as before: the join drops none', () => {
    const text = flat(withOutcomes().text);

    expect(text).toContain('LEFT JOIN "ChatSession" s');
    // "Has a summary" is a condition of the join, not of the rows: after
    // the join nothing is filtered.
    expect(text.slice(text.indexOf(') c LEFT JOIN'))).not.toContain('WHERE');
    expect(text).toContain('COUNT(*) AS "conversations"');
    // One row per conversation first, by primary key after: the hour rows
    // are scanned and hashed once, for all three counts.
    expect(text.match(/FROM "ChatActivityHour"/g)).toHaveLength(1);
  });

  // An installation view names no person and repeats nothing that was
  // written (FR-021, FR-033): the statement reads no column that could.
  it('reads nothing a person wrote: not the question, the summary, the preview or the title', () => {
    const text = flat(withOutcomes().text);

    for (const column of ['question', 'summary"', 'preview', 'title']) {
      expect(text).not.toContain(column);
    }
  });

  it('carries the same agents, each id bound, one place further on', () => {
    const limited = withOutcomes({
      matchesAny: true,
      in: ['agent-1', 'agent-2'],
      notIn: null,
    });
    expect(flat(limited.text)).toContain('AND "agentId" IN ($7,$8)');
    expect(limited.values.slice(6)).toEqual(['agent-1', 'agent-2']);
    expect(limited.text).not.toContain('agent-1');

    const excluding = withOutcomes({
      matchesAny: true,
      in: null,
      notIn: ['agent-3'],
    });
    expect(flat(excluding.text)).toContain('AND "agentId" NOT IN ($7)');
    expect(excluding.values.slice(6)).toEqual(['agent-3']);
  });
});

describe('ChatActivityGateway.summaryForAgents', () => {
  type Sql = { text: string; values: unknown[] };

  /** `$queryRaw` that answers by which of the two statements it was given. */
  function makeSummaryStub(
    conversations: Row[] = [],
    people: Row[] = [{ value: 0n, previous: 0n }],
  ) {
    const $queryRaw = jest.fn(async (query: Sql) =>
      query.text.includes('"inPeriod"') ? people : conversations,
    );
    // What each transaction did, in order: the setting, then the statement.
    const transactions: string[][] = [];
    const $transaction = jest.fn(
      async (
        run: (tx: unknown) => Promise<unknown>,
        _options?: { timeout?: number },
      ) => {
        const steps: string[] = [];
        transactions.push(steps);
        return run({
          $executeRaw: jest.fn(
            async (strings: TemplateStringsArray, ...values: unknown[]) => {
              steps.push(`${strings.join('?')} <- ${values.join(',')}`);
              return 1;
            },
          ),
          $queryRaw: jest.fn(async (query: Sql) => {
            steps.push('statement');
            return $queryRaw(query);
          }),
        });
      },
    );
    const gateway = new ChatActivityGateway({
      $transaction,
    } as unknown as ConstructorParameters<typeof ChatActivityGateway>[0]);
    return { gateway, $queryRaw, $transaction, transactions };
  }

  it('gives each statement its memory in the statement’s own transaction, before it runs', async () => {
    const { gateway, $transaction, transactions } = makeSummaryStub();

    await gateway.summaryForAgents(PERIODS);

    // Memory to hash in, and a plan made for the dates asked: both local to
    // the transaction.
    const SETTINGS =
      "SELECT set_config('work_mem', ?, true), " +
      "set_config('plan_cache_mode', 'force_custom_plan', true) <- " +
      AGGREGATE_WORK_MEM;
    // Two statements, a transaction each: neither waits for the other.
    expect(transactions).toEqual([
      [SETTINGS, 'statement'],
      [SETTINGS, 'statement'],
    ]);
    // Longer than the five seconds a transaction gets by default: the first
    // read after a restart scans from disk.
    for (const [, options] of $transaction.mock.calls) {
      expect(options?.timeout).toBeGreaterThan(5_000);
    }
  });

  it('answers conversations by agent and channel, and the people of both periods, as numbers', async () => {
    const { gateway } = makeSummaryStub(
      [
        { agentId: 'a1', channel: 'bridle', share: false, conversations: 12n },
        { agentId: 'a1', channel: 'bridle', share: true, conversations: 2n },
        { agentId: 'a2', channel: 'telegram', share: false, conversations: 5n },
        { agentId: 'a2', channel: 'whatsapp', share: false, conversations: 1n },
      ],
      [{ value: 9n, previous: 7n }],
    );

    expect(await gateway.summaryForAgents(PERIODS)).toEqual({
      conversations: [
        { agentId: 'a1', channel: 'console', conversations: 12 },
        { agentId: 'a1', channel: 'share', conversations: 2 },
        { agentId: 'a2', channel: 'other', conversations: 1 },
        { agentId: 'a2', channel: 'telegram', conversations: 5 },
      ],
      // Not asked for: no agent, which is not "none was left open".
      outcomes: [],
      people: { value: 9, previous: 7 },
    });
  });

  // How the conversations ended comes with them (CLEAN-270): the same rows,
  // each agent's added up over its channels.
  it('answers how each agent’s conversations ended when asked, from the statement that counts them', async () => {
    const { gateway, $queryRaw } = makeSummaryStub(
      [
        {
          agentId: 'a1',
          channel: 'bridle',
          share: false,
          conversations: 12n,
          summarised: 9n,
          open: 3n,
        },
        {
          agentId: 'a1',
          channel: 'bridle',
          share: true,
          conversations: 2n,
          summarised: 1n,
          open: 1n,
        },
        {
          agentId: 'a2',
          channel: 'telegram',
          share: false,
          conversations: 5n,
          summarised: 0n,
          open: 0n,
        },
      ],
      [{ value: 9n, previous: 7n }],
    );

    const summary = await gateway.summaryForAgents(PERIODS, undefined, {
      outcomes: true,
    });

    expect(summary.conversations).toEqual([
      { agentId: 'a1', channel: 'console', conversations: 12 },
      { agentId: 'a1', channel: 'share', conversations: 2 },
      { agentId: 'a2', channel: 'telegram', conversations: 5 },
    ]);
    // An agent none of whose conversations has a summary is absent.
    expect(summary.outcomes).toEqual([
      { agentId: 'a1', summarised: 10, open: 4 },
    ]);
    // Still two statements, a transaction each: nothing was added to them.
    expect($queryRaw).toHaveBeenCalledTimes(2);
    const joined = $queryRaw.mock.calls.filter(([query]) =>
      query.text.includes('"ChatSession"'),
    );
    expect(joined).toHaveLength(1);
    expect(joined[0][0].values).toContain('open');
  });

  it('reads no summary unless asked: neither statement names `ChatSession`', async () => {
    const { gateway, $queryRaw } = makeSummaryStub();

    await gateway.summaryForAgents(PERIODS);
    await gateway.summaryForAgents(PERIODS, undefined, { outcomes: false });

    expect($queryRaw).toHaveBeenCalledTimes(4);
    for (const [query] of $queryRaw.mock.calls) {
      expect(query.text).not.toContain('ChatSession');
    }
  });

  it('asks twice, once for conversations and once for people, each as a bound statement', async () => {
    const { gateway, $queryRaw } = makeSummaryStub();

    await gateway.summaryForAgents(PERIODS, { in: ['agent-1'] });

    expect($queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of $queryRaw.mock.calls) {
      expect(flat(query.text)).toContain('FROM "ChatActivityHour"');
      expect(flat(query.text)).toMatch(/AND "agentId" IN \(\$\d+\)/);
      expect(query.values).toContain('agent-1');
      expect(query.text).not.toContain('agent-1');
    }
  });

  it('passes the denied agents of an unlimited caller to both statements', async () => {
    const { gateway, $queryRaw } = makeSummaryStub();

    await gateway.summaryForAgents(PERIODS, { notIn: ['agent-3'] });

    for (const [query] of $queryRaw.mock.calls) {
      expect(flat(query.text)).toMatch(/AND "agentId" NOT IN \(\$\d+\)/);
      expect(query.values).toContain('agent-3');
    }
  });

  it('names no agent when the caller reaches every one', async () => {
    const { gateway, $queryRaw } = makeSummaryStub();

    await gateway.summaryForAgents(PERIODS);
    await gateway.summaryForAgents(PERIODS, { notIn: [] });

    expect($queryRaw).toHaveBeenCalledTimes(4);
    for (const [query] of $queryRaw.mock.calls) {
      expect(query.text).not.toContain('"agentId" IN');
      expect(query.text).not.toContain('"agentId" NOT IN');
    }
  });

  it('answers empty for a caller who reaches no agent, and asks the database nothing', async () => {
    const { gateway, $queryRaw } = makeSummaryStub(
      [{ agentId: 'a1', channel: 'bridle', share: false, conversations: 12n }],
      [{ value: 9n, previous: 7n }],
    );

    expect(await gateway.summaryForAgents(PERIODS, { in: [] })).toEqual({
      conversations: [],
      outcomes: [],
      people: { value: 0, previous: 0 },
    });
    expect(
      await gateway.summaryForAgents(PERIODS, { in: [] }, { outcomes: true }),
    ).toEqual({
      conversations: [],
      outcomes: [],
      people: { value: 0, previous: 0 },
    });
    expect($queryRaw).not.toHaveBeenCalled();
  });
});

/**
 * From the second review of CLEAN-265. Each aggregate holds a connection of
 * the pool, and memory to hash in, for as long as it runs; nothing capped
 * how many ran. A few operators switching between 7, 30 and 90 days could
 * hold every connection while chat and sign-in waited for one. The API is
 * one process, so a limit kept in it is a limit.
 */
describe('ChatActivityGateway: aggregates wait their turn', () => {
  type Sql = { text: string; values: unknown[] };

  /** Let everything that can run without the spec's help run. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  /**
   * A `$transaction` whose statement stays open until the spec ends it:
   * which view each one let in belongs to, in the order they were let in,
   * and how many were inside together at the most.
   */
  function makeHeldStub() {
    const entered: string[] = [];
    const end: Array<(error?: Error) => void> = [];
    let inside = 0;
    let peak = 0;
    const $transaction = jest.fn(
      async (
        run: (tx: unknown) => Promise<unknown>,
        _options?: { timeout?: number },
      ) => {
        inside += 1;
        peak = Math.max(peak, inside);
        try {
          return await run({
            $executeRaw: jest.fn(async () => 1),
            $queryRaw: jest.fn(async (query: Sql) => {
              // The agent id a view was asked with is its last bound value.
              entered.push(String(query.values[query.values.length - 1]));
              await new Promise<void>((resolve, reject) => {
                end.push((error) => (error ? reject(error) : resolve()));
              });
              return query.text.includes('"inPeriod"')
                ? [{ value: 0n, previous: 0n }]
                : [];
            }),
          });
        } finally {
          inside -= 1;
        }
      },
    );
    const gateway = new ChatActivityGateway({
      $transaction,
    } as unknown as ConstructorParameters<typeof ChatActivityGateway>[0]);
    return { gateway, $transaction, entered, end, peak: () => peak };
  }

  const viewOf = (gateway: ChatActivityGateway, n: number): Promise<unknown> =>
    gateway.summaryForAgents(PERIODS, { in: [`view-${n}`] });

  it('is two: the pair of statements one view runs', () => {
    expect(AGGREGATE_CONCURRENCY).toBe(2);
  });

  it('lets in two at a time when five views arrive together, in the order they arrived, and answers all five', async () => {
    const { gateway, entered, end, peak } = makeHeldStub();
    const answered: number[] = [];

    const views = [1, 2, 3, 4, 5].map((n) =>
      viewOf(gateway, n).then(() => {
        answered.push(n);
      }),
    );

    // Ten statements. Before the n-th of them ends, exactly two more than
    // have ended were let in: the rest are waiting, not inside.
    for (let ended = 0; ended < 10; ended += 1) {
      await settle();
      expect(end).toHaveLength(Math.min(10, ended + AGGREGATE_CONCURRENCY));
      end[ended]();
    }
    await Promise.all(views);

    expect(peak()).toBe(AGGREGATE_CONCURRENCY);
    expect(entered).toEqual([
      'view-1',
      'view-1',
      'view-2',
      'view-2',
      'view-3',
      'view-3',
      'view-4',
      'view-4',
      'view-5',
      'view-5',
    ]);
    expect(answered).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives the place of a statement that failed to the next one waiting', async () => {
    const { gateway, entered, end, peak } = makeHeldStub();

    const views = [1, 2, 3].map((n) => viewOf(gateway, n));
    await settle();
    expect(entered).toEqual(['view-1', 'view-1']);

    end[0](new Error('canceling statement due to statement timeout'));
    await expect(views[0]).rejects.toThrow('statement timeout');

    for (let ended = 1; ended < 6; ended += 1) {
      await settle();
      expect(end).toHaveLength(Math.min(6, ended + AGGREGATE_CONCURRENCY));
      end[ended]();
    }
    await expect(Promise.all([views[1], views[2]])).resolves.toHaveLength(2);
    expect(peak()).toBe(AGGREGATE_CONCURRENCY);

    // And nothing was left held: the next view runs at once.
    const later = viewOf(gateway, 4);
    await settle();
    expect(entered.slice(6)).toEqual(['view-4', 'view-4']);
    end[6]();
    end[7]();
    await later;
  });

  // The queue is before the transaction, so `maxWait` and `timeout` are
  // counted from a statement's own turn, not from the moment it was asked.
  it('opens a transaction only for a statement whose turn it is, with the same timeout as before', async () => {
    const { gateway, $transaction, end } = makeHeldStub();

    const views = [1, 2].map((n) => viewOf(gateway, n));
    await settle();

    expect($transaction).toHaveBeenCalledTimes(AGGREGATE_CONCURRENCY);
    for (const [, options] of $transaction.mock.calls) {
      expect(options?.timeout).toBe(30_000);
    }
    for (let ended = 0; ended < 4; ended += 1) {
      await settle();
      end[ended]();
    }
    await Promise.all(views);
    expect($transaction).toHaveBeenCalledTimes(4);
  });
});
