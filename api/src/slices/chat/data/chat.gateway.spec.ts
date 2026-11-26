import { ChatGateway } from './chat.gateway';
import { ChatMapper } from './chat.mapper';
import { IChatActivity, IChatReconcileInput } from '../domain';

type Row = Record<string, unknown>;
// What a transaction wrote, as steps that take it back. Present only inside
// `$transaction(fn)`; a write outside one is kept as it always was.
type Undo = Array<() => void>;

const remember = (
  undo: Undo | undefined,
  store: Record<string, Row>,
  key: string,
) => {
  if (!undo) return;
  const before = store[key] ? { ...store[key] } : undefined;
  undo.push(() => {
    if (before) store[key] = before;
    else delete store[key];
  });
};

const uniqueViolation = () =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const hourKey = (sessionId: string, hour: Date) =>
  `${sessionId}|${hour.getTime()}`;

// In-memory Prisma stub — mirrors ranch's browser.gateway.spec pattern.
function makePrismaStub() {
  const rows: Record<string, Row> = {};
  // ChatActivityHour, by (sessionId, hour).
  const hours: Record<string, Row> = {};

  const matches = (
    r: Record<string, unknown>,
    where: Record<string, unknown> = {},
  ) => {
    if (where.agentId && r.agentId !== where.agentId) return false;
    if (where.channel !== undefined) {
      const c = where.channel as string | { not?: string };
      if (typeof c === 'string' && r.channel !== c) return false;
      if (typeof c === 'object' && c.not !== undefined && r.channel === c.not)
        return false;
    }
    if (where.archived !== undefined && r.archived !== where.archived)
      return false;
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
      // Enforce @@unique([agentId, sessionKey]), as createMany does below.
      const clash = Object.values(rows).find(
        (r) => r.agentId === data.agentId && r.sessionKey === data.sessionKey,
      );
      if (clash) throw uniqueViolation();
      rows[data.id as string] = {
        summary: null,
        summaryAt: null,
        insights: null,
        lastIndexedEventId: null,
        // No default in the schema: a new conversation is due.
        activityRebuiltAt: null,
        title: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...data,
      };
      return rows[data.id as string];
    }),
    // INSERT … ON CONFLICT DO NOTHING: a row that is already there is not an
    // error, it is a count of 0. What recordActivity creates a conversation
    // with, so that losing the race to create it (or a repeated event) does
    // not end the transaction the way an error would.
    createMany: jest.fn(
      async (
        {
          data,
          skipDuplicates,
        }: { data: Row | Row[]; skipDuplicates?: boolean },
        undo?: Undo,
      ) => {
        let count = 0;
        for (const d of Array.isArray(data) ? data : [data]) {
          const clash = Object.values(rows).find(
            (r) => r.agentId === d.agentId && r.sessionKey === d.sessionKey,
          );
          if (clash) {
            if (skipDuplicates) continue;
            throw uniqueViolation();
          }
          remember(undo, rows, d.id as string);
          rows[d.id as string] = {
            summary: null,
            summaryAt: null,
            insights: null,
            lastIndexedEventId: null,
            activityRebuiltAt: null,
            title: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            ...d,
          };
          count++;
        }
        return { count };
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
        rows[where.id] = { ...rows[where.id], ...data };
        return rows[where.id];
      },
    ),
    updateMany: jest.fn(
      async (
        {
          where,
          data,
        }: {
          where: Record<string, any>;
          data: Record<string, any>;
        },
        undo?: Undo,
      ) => {
        let count = 0;
        for (const r of Object.values(rows)) {
          if (where.agentId && r.agentId !== where.agentId) continue;
          if (where.sessionKey && r.sessionKey !== where.sessionKey) continue;
          // The watermark, compared as SQL compares it: a NULL column is
          // neither equal nor unequal to a value, so `NOT (col = x)` and
          // `col <> x` both leave a NULL row out. A fake that used `!==`
          // here let a real bug through: a conversation the reconcile
          // created (no watermark) never took a live event.
          const mark = r.lastIndexedEventId as string | null;
          if (
            where.NOT?.lastIndexedEventId !== undefined &&
            (mark === null || mark === where.NOT.lastIndexedEventId)
          )
            continue;
          if (Array.isArray(where.OR)) {
            const admitted = (
              where.OR as Array<{
                lastIndexedEventId?: null | { not?: string };
              }>
            ).some((branch) => {
              const cond = branch.lastIndexedEventId;
              if (cond === null) return mark === null;
              if (cond?.not !== undefined)
                return mark !== null && mark !== cond.not;
              return false;
            });
            if (!admitted) continue;
          }
          remember(undo, rows, r.id as string);
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in v) {
              r[k] = ((r[k] as number) ?? 0) + (v.increment as number);
            } else {
              r[k] = v;
            }
          }
          count++;
        }
        return { count };
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        skip = 0,
        take = 1000,
      }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        const list = Object.values(rows)
          .filter((r) => matches(r, where))
          .sort(
            (a, b) =>
              (b.lastMessageAt as Date).getTime() -
              (a.lastMessageAt as Date).getTime(),
          );
        return list.slice(skip, skip + take);
      },
    ),
    count: jest.fn(
      async ({ where }: { where?: Record<string, unknown> }) =>
        Object.values(rows).filter((r) => matches(r, where)).length,
    ),
  };

  const feedback: Record<string, Record<string, any>> = {};
  const fbMatch = (r: Record<string, any>, w: Record<string, any>) =>
    r.sessionId === w.sessionId &&
    (w.messageId === undefined || r.messageId === w.messageId) &&
    r.authorId === w.authorId;

  const chatFeedback = {
    upsert: jest.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { sessionId_messageId_authorId: Record<string, any> };
        create: Record<string, any>;
        update: Record<string, any>;
      }) => {
        const key = where.sessionId_messageId_authorId;
        const existing = Object.values(feedback).find(
          (r) =>
            r.sessionId === key.sessionId &&
            r.messageId === key.messageId &&
            r.authorId === key.authorId,
        );
        if (existing) return Object.assign(existing, update);
        feedback[create.id as string] = {
          comment: null,
          createdAt: new Date(0),
          ...create,
        };
        return feedback[create.id as string];
      },
    ),
    deleteMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      let count = 0;
      for (const [id, r] of Object.entries(feedback)) {
        if (fbMatch(r, where)) {
          delete feedback[id];
          count++;
        }
      }
      return { count };
    }),
    findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
      Object.values(feedback).filter((r) => fbMatch(r, where)),
    ),
  };

  const chatActivityHour = {
    upsert: jest.fn(
      async (
        {
          where,
          create,
          update,
        }: {
          where: { sessionId_hour: { sessionId: string; hour: Date } };
          create: Row;
          update: Record<string, { increment: number }>;
        },
        undo?: Undo,
      ) => {
        const { sessionId, hour } = where.sessionId_hour;
        const key = hourKey(sessionId, hour);
        remember(undo, hours, key);
        const existing = hours[key];
        if (!existing) {
          hours[key] = { userMessages: 0, agentMessages: 0, ...create };
          return hours[key];
        }
        for (const [k, v] of Object.entries(update)) {
          existing[k] = (existing[k] as number) + v.increment;
        }
        return existing;
      },
    ),
  };

  // The models as a transaction sees them: the same store, with every write
  // noted so that a throw takes all of them back, as a rollback does.
  const inTransaction = (undo: Undo) => ({
    chatSession: {
      findUniqueOrThrow: async (args: { where: Record<string, any> }) => {
        const found = await chatSession.findUnique(args);
        if (!found) throw new Error('No ChatSession found');
        return found;
      },
      updateMany: (args: Parameters<typeof chatSession.updateMany>[0]) =>
        chatSession.updateMany(args, undo),
      createMany: (args: Parameters<typeof chatSession.createMany>[0]) =>
        chatSession.createMany(args, undo),
    },
    chatActivityHour: {
      upsert: (args: Parameters<typeof chatActivityHour.upsert>[0]) =>
        chatActivityHour.upsert(args, undo),
    },
  });

  const prisma = {
    chatSession,
    chatFeedback,
    chatActivityHour,
    $transaction: jest.fn(
      async (
        work:
          | Promise<unknown>[]
          | ((tx: ReturnType<typeof inTransaction>) => Promise<unknown>),
        // How long it may wait for a connection and run. Nothing waits in
        // this fake; it is taken so that the calls record it.
        _options?: { maxWait?: number; timeout?: number },
      ) => {
        if (Array.isArray(work)) return Promise.all(work);
        const undo: Undo = [];
        try {
          return await work(inTransaction(undo));
        } catch (err) {
          while (undo.length) undo.pop()!();
          throw err;
        }
      },
    ),
  };
  return { prisma, rows, hours, feedback };
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
  const { prisma, rows, hours } = makePrismaStub();
  const gw = new ChatGateway(
    prisma as unknown as ConstructorParameters<typeof ChatGateway>[0],
    new ChatMapper(),
  );
  return { gw, rows, hours, prisma };
}

describe('ChatGateway.reconcileUpsert', () => {
  it('creates a row on first index with the file counts as the floor', async () => {
    const { gw } = newGateway();
    const s = await gw.reconcileUpsert(
      input({ messageCount: 4, userMessageCount: 2 }),
    );
    expect(s.messageCount).toBe(4);
    expect(s.userMessageCount).toBe(2);
    expect(s.lastIndexedSize).toBe(100);
  });

  it('never lowers counts after compaction shrinks the file, but refreshes preview/lastMessageAt', async () => {
    const { gw } = newGateway();
    await gw.reconcileUpsert(
      input({ messageCount: 40, userMessageCount: 20, size: 5000 }),
    );

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
    const after = await gw.reconcileUpsert(
      input({ messageCount: 9, userMessageCount: 5 }),
    );
    expect(after.messageCount).toBe(9);
    expect(after.userMessageCount).toBe(5);
  });

  // The settle pass takes a conversation exactly when activityRebuiltAt is
  // null (CLEAN-261). The reconcile only comes back to a row whose file
  // changed, so there is something in the transcript the pass has not read.
  it('makes an existing conversation due for the settle pass again', async () => {
    const { gw, rows } = newGateway();
    const first = await gw.reconcileUpsert(input());
    rows[first.id].activityRebuiltAt = new Date(5000);

    await gw.reconcileUpsert(
      input({ size: 900, messageCount: 5, lastMessageAt: new Date(6000) }),
    );

    expect(rows[first.id].activityRebuiltAt).toBeNull();
  });

  it('creates a conversation due, by leaving the column to the database', async () => {
    const { gw, rows } = newGateway();
    const mapper = new ChatMapper();

    const created = await gw.reconcileUpsert(input());

    expect(rows[created.id].activityRebuiltAt).toBeNull();
    expect(mapper.toCreate(input())).not.toHaveProperty('activityRebuiltAt');
    expect(mapper.toActivityCreate('agent-1', activity())).not.toHaveProperty(
      'activityRebuiltAt',
    );
  });
});

function activity(over: Partial<IChatActivity> = {}): IChatActivity {
  return {
    sessionKey: 'bridle:admin',
    channel: 'bridle',
    externalUserId: 'admin',
    eventId: 'ev-1',
    role: 'user',
    ts: 2000,
    preview: 'hi',
    ...over,
  };
}

describe('ChatGateway.recordActivity', () => {
  it('creates the row on the first activity with count 1', async () => {
    const { gw } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ role: 'user', preview: 'first' }),
    );
    const { items } = await gw.list({ agentId: 'agent-1' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      messageCount: 1,
      userMessageCount: 1,
      preview: 'first',
      lastRole: 'user',
    });
  });

  it('increments monotonic counts and refreshes freshness on later activities', async () => {
    const { gw } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e1', role: 'user' }),
    );
    await gw.recordActivity(
      'agent-1',
      activity({
        eventId: 'e2',
        role: 'assistant',
        preview: 'reply',
        ts: 3000,
      }),
    );
    const s = (await gw.list({ agentId: 'agent-1' })).items[0];
    expect(s.messageCount).toBe(2);
    expect(s.userMessageCount).toBe(1); // only the user event counted
    expect(s.preview).toBe('reply');
    expect(s.lastRole).toBe('assistant');
  });

  it('is idempotent for a repeated eventId (socket retry)', async () => {
    const { gw } = newGateway();
    await gw.recordActivity('agent-1', activity({ eventId: 'dup' }));
    await gw.recordActivity('agent-1', activity({ eventId: 'dup' }));
    const s = (await gw.list({ agentId: 'agent-1' })).items[0];
    expect(s.messageCount).toBe(1);
  });
});

/**
 * Who is due for the settle pass (CLEAN-261): a conversation whose
 * activityRebuiltAt is null, and only that. So the live write has to clear
 * the stamp whenever it counts an event, in the statement that counts it.
 */
describe('ChatGateway.recordActivity, and the settle pass', () => {
  const STAMP = new Date('2026-11-20T11:00:00Z');

  it('makes a settled conversation due again with the event it counts', async () => {
    const { gw, rows, prisma } = newGateway();
    await gw.recordActivity('agent-1', activity({ eventId: 'e1' }));
    const [session] = Object.values(rows);
    session.activityRebuiltAt = STAMP;
    prisma.chatSession.updateMany.mockClear();

    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e2', role: 'assistant' }),
    );

    expect(session.messageCount).toBe(2);
    expect(session.activityRebuiltAt).toBeNull();
    // With the increment, not after it: one statement.
    expect(prisma.chatSession.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.chatSession.updateMany.mock.calls[0][0].data).toMatchObject({
      messageCount: { increment: 1 },
      activityRebuiltAt: null,
    });
  });

  it('leaves the stamp of a settled conversation alone for a repeated event', async () => {
    const { gw, rows } = newGateway();
    const event = activity({ eventId: 'dup' });
    await gw.recordActivity('agent-1', event);
    const [session] = Object.values(rows);
    session.activityRebuiltAt = STAMP;

    await gw.recordActivity('agent-1', event);

    expect(session.messageCount).toBe(1);
    expect(session.activityRebuiltAt).toEqual(STAMP);
  });

  it('puts the stamp back when the event could not be counted', async () => {
    const { gw, rows, prisma } = newGateway();
    await gw.recordActivity('agent-1', activity({ eventId: 'e1' }));
    Object.values(rows)[0].activityRebuiltAt = STAMP;
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    await expect(
      gw.recordActivity('agent-1', activity({ eventId: 'e2' })),
    ).rejects.toThrow('connection lost');

    // Rolled back with the totals. The message is in the transcript all the
    // same, and the reconcile is what makes the conversation due for it.
    expect(Object.values(rows)[0].activityRebuiltAt).toEqual(STAMP);
  });

  it('creates a conversation due', async () => {
    const { gw, rows } = newGateway();

    await gw.recordActivity('agent-1', activity());

    expect(Object.values(rows)[0].activityRebuiltAt).toBeNull();
  });
});

/**
 * Activity by the hour (CLEAN-261, spec 038 contracts/collection.md section
 * 2). The hour is written with the lifetime totals or not at all, so the two
 * can never disagree about what was counted.
 */
describe('ChatGateway.recordActivity, by the hour', () => {
  const at = (iso: string) => Date.parse(iso);
  const sum = (list: Row[], field: string) =>
    list.reduce((n, r) => n + (r[field] as number), 0);

  // Section 2's invariant, for every conversation in the store.
  const expectHoursToEqualTotals = (
    rows: Record<string, Row>,
    hours: Record<string, Row>,
  ) => {
    for (const session of Object.values(rows)) {
      const own = Object.values(hours).filter(
        (h) => h.sessionId === session.id,
      );
      expect(sum(own, 'userMessages')).toBe(session.userMessageCount);
      expect(sum(own, 'userMessages') + sum(own, 'agentMessages')).toBe(
        session.messageCount,
      );
    }
  };

  it('creates the conversation and its hour on the first event, with whose it is copied', async () => {
    const { gw, rows, hours } = newGateway();

    await gw.recordActivity(
      'agent-1',
      activity({
        sessionKey: 'telegram:42',
        channel: 'telegram',
        externalUserId: '42',
        ts: at('2026-11-20T09:41:07Z'),
      }),
    );

    const [session] = Object.values(rows);
    expect(Object.values(hours)).toEqual([
      {
        sessionId: session.id,
        hour: new Date('2026-11-20T09:00:00Z'),
        agentId: 'agent-1',
        channel: 'telegram',
        externalUserId: '42',
        userMessages: 1,
        agentMessages: 0,
      },
    ]);
  });

  it('adds a new event to the lifetime totals and to its hour in one transaction', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e1', ts: at('2026-11-20T09:10:00Z') }),
    );
    prisma.$transaction.mockClear();

    await gw.recordActivity(
      'agent-1',
      activity({
        eventId: 'e2',
        role: 'assistant',
        ts: at('2026-11-20T09:10:30Z'),
      }),
    );

    // One transaction holds both writes: there is no moment at which one is
    // in the database without the other.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
    const [session] = Object.values(rows);
    expect(session).toMatchObject({ messageCount: 2, userMessageCount: 1 });
    expect(Object.values(hours)).toEqual([
      expect.objectContaining({
        hour: new Date('2026-11-20T09:00:00Z'),
        userMessages: 1,
        agentMessages: 1,
      }),
    ]);
  });

  // Prisma gives an interactive transaction 2 s to get a connection and 5 s
  // to run. This one is started for every message and nobody waits for it:
  // a burst larger than the pool lost the events at the back of the queue,
  // from the lifetime totals too. It queues, as the bare statement it
  // replaced did.
  it('lets the transaction wait 15 s for a connection, and run as long, on every attempt', async () => {
    const { gw, prisma } = newGateway();
    const patient = { maxWait: 15_000, timeout: 15_000 };

    await gw.recordActivity('agent-1', activity({ eventId: 'e1' }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      patient,
    );

    // The retry after a unique-key race is a transaction of its own.
    prisma.$transaction.mockClear();
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw uniqueViolation();
    });
    await gw.recordActivity('agent-1', activity({ eventId: 'e2' }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      patient,
    );
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      patient,
    );
  });

  it('starts a new row when the conversation goes on into another hour', async () => {
    const { gw, rows, hours } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e1', ts: at('2026-11-20T09:59:59Z') }),
    );
    await gw.recordActivity(
      'agent-1',
      activity({
        eventId: 'e2',
        role: 'assistant',
        ts: at('2026-11-20T10:00:00Z'),
      }),
    );

    expect(
      Object.values(hours).map((h) => [
        (h.hour as Date).toISOString(),
        h.userMessages,
        h.agentMessages,
      ]),
    ).toEqual([
      ['2026-11-20T09:00:00.000Z', 1, 0],
      ['2026-11-20T10:00:00.000Z', 0, 1],
    ]);
    expectHoursToEqualTotals(rows, hours);
  });

  it('changes neither the totals nor the hour for a repeated eventId', async () => {
    const { gw, rows, hours } = newGateway();
    const event = activity({ eventId: 'dup', ts: at('2026-11-20T09:10:00Z') });
    await gw.recordActivity('agent-1', event);
    const [session] = Object.values(rows);
    const before = { session: { ...session }, hours: structuredClone(hours) };

    await gw.recordActivity('agent-1', event);

    expect(session).toEqual(before.session);
    expect(hours).toEqual(before.hours);
  });

  it('counts a live event for a conversation the reconcile indexed, which has no watermark yet', async () => {
    const { gw, rows, hours } = newGateway();
    await gw.reconcileUpsert({
      agentId: 'agent-1',
      sessionKey: 'bridle:admin',
      channel: 'bridle',
      externalUserId: 'admin',
      title: null,
      archived: false,
      size: 100,
      lastMessageAt: new Date(at('2026-11-20T08:00:00Z')),
      preview: 'from the file',
      lastRole: 'assistant',
      messageCount: 6,
      userMessageCount: 3,
    });
    const [session] = Object.values(rows);
    expect(session.lastIndexedEventId).toBeNull();

    const event = activity({
      sessionKey: 'bridle:admin',
      externalUserId: 'admin',
      eventId: 'first-live',
      role: 'user',
      ts: at('2026-11-20T09:10:00Z'),
      preview: 'typed just now',
    });
    await gw.recordActivity('agent-1', event);

    expect(session.messageCount).toBe(7);
    expect(session.userMessageCount).toBe(4);
    expect(session.preview).toBe('typed just now');
    expect(session.lastMessageAt).toEqual(new Date(at('2026-11-20T09:10:00Z')));
    expect(session.lastIndexedEventId).toBe('first-live');
    expect(Object.values(hours)).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        hour: new Date(at('2026-11-20T09:00:00Z')),
        userMessages: 1,
        agentMessages: 0,
      }),
    ]);

    // And the same event again is the one counted last: refused.
    await gw.recordActivity('agent-1', event);
    expect(session.messageCount).toBe(7);
    expect(Object.values(hours)[0].userMessages).toBe(1);
  });

  it('retries once when the hour row was created under it, and counts the event once', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e1', ts: at('2026-11-20T09:10:00Z') }),
    );
    prisma.$transaction.mockClear();
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw uniqueViolation();
    });

    await gw.recordActivity(
      'agent-1',
      activity({
        eventId: 'e2',
        role: 'assistant',
        ts: at('2026-11-20T10:10:00Z'),
      }),
    );

    // The attempt that lost the race was rolled back whole, so the second
    // one is the only one that counted.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const [session] = Object.values(rows);
    expect(session).toMatchObject({ messageCount: 2, userMessageCount: 1 });
    expect(Object.values(hours)).toHaveLength(2);
    expectHoursToEqualTotals(rows, hours);
  });

  it('gives up after that one retry, with nothing counted', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    prisma.chatActivityHour.upsert.mockImplementation(async () => {
      throw uniqueViolation();
    });

    await expect(
      gw.recordActivity('agent-1', activity()),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(prisma.chatActivityHour.upsert).toHaveBeenCalledTimes(2);
    expect(rows).toEqual({});
    expect(hours).toEqual({});
  });

  it('rolls the lifetime increment back and tells the caller when the hour cannot be written', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    await gw.recordActivity(
      'agent-1',
      activity({ eventId: 'e1', preview: 'first' }),
    );
    const [session] = Object.values(rows);
    const before = { session: { ...session }, hours: structuredClone(hours) };
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    await expect(
      gw.recordActivity(
        'agent-1',
        activity({ eventId: 'e2', role: 'assistant', preview: 'reply' }),
      ),
    ).rejects.toThrow('connection lost');

    // Not retried: only a unique-key race is.
    expect(prisma.chatActivityHour.upsert).toHaveBeenCalledTimes(2);
    expect(Object.values(rows)).toEqual([before.session]);
    expect(hours).toEqual(before.hours);
  });

  it('does not leave a conversation behind when its first hour cannot be written', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    await expect(gw.recordActivity('agent-1', activity())).rejects.toThrow(
      'connection lost',
    );

    expect(rows).toEqual({});
    expect(hours).toEqual({});
  });

  it('counts an event delivered again after its write failed', async () => {
    const { gw, rows, hours, prisma } = newGateway();
    await gw.recordActivity('agent-1', activity({ eventId: 'e1' }));
    prisma.chatActivityHour.upsert.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });
    const lost = activity({ eventId: 'e2', role: 'assistant' });
    await expect(gw.recordActivity('agent-1', lost)).rejects.toThrow();

    // The watermark went back with the totals, so the retry is not a repeat.
    await gw.recordActivity('agent-1', lost);

    expect(Object.values(rows)[0]).toMatchObject({ messageCount: 2 });
    expectHoursToEqualTotals(rows, hours);
  });

  it('keeps the hours equal to the totals after new, repeated and simultaneous deliveries', async () => {
    const { gw, rows, hours } = newGateway();
    const event = (eventId: string, role: 'user' | 'assistant', iso: string) =>
      activity({ eventId, role, ts: at(iso) });

    // Two different first events of one conversation at once: one creates
    // the row, the other finds it created and increments.
    await Promise.all([
      gw.recordActivity('agent-1', event('e1', 'user', '2026-11-20T09:58:00Z')),
      gw.recordActivity(
        'agent-1',
        event('e2', 'assistant', '2026-11-20T09:58:20Z'),
      ),
    ]);
    expect(Object.values(rows)).toHaveLength(1);
    expectHoursToEqualTotals(rows, hours);

    // Two different events of an existing conversation at once, across the
    // turn of the hour.
    await Promise.all([
      gw.recordActivity('agent-1', event('e3', 'user', '2026-11-20T09:59:50Z')),
      gw.recordActivity(
        'agent-1',
        event('e4', 'assistant', '2026-11-20T10:00:05Z'),
      ),
    ]);
    expectHoursToEqualTotals(rows, hours);

    // The last event again, alone and then twice at once.
    const last = event('e4', 'assistant', '2026-11-20T10:00:05Z');
    await gw.recordActivity('agent-1', last);
    await Promise.all([
      gw.recordActivity('agent-1', last),
      gw.recordActivity('agent-1', last),
    ]);

    // One event, delivered twice at once, of a conversation nobody has seen.
    const other = activity({
      sessionKey: 'bridle:user-2',
      externalUserId: 'user-2',
      eventId: 'x1',
      ts: at('2026-11-20T10:30:00Z'),
    });
    await Promise.all([
      gw.recordActivity('agent-1', other),
      gw.recordActivity('agent-1', other),
    ]);

    const [first, second] = Object.values(rows);
    expect(first).toMatchObject({ messageCount: 4, userMessageCount: 2 });
    expect(second).toMatchObject({ messageCount: 1, userMessageCount: 1 });
    expect(Object.values(hours)).toHaveLength(3);
    expectHoursToEqualTotals(rows, hours);
  });
});

/**
 * Closing a conversation (CLEAN-136). The row IS the conversation's record —
 * its id, its ratings, its summary — so it moves to the archived key instead
 * of being left behind as a hollow duplicate of the archived file.
 */
describe('ChatGateway.archiveSession', () => {
  const ARCHIVED = 'bridle:admin.2026-10-02T09-14-03-512Z.archived';

  it('moves the live row to the archived key and keeps what it carries', async () => {
    const { gw, rows } = newGateway();
    const live = await gw.reconcileUpsert(input({ messageCount: 6 }));
    rows[live.id].summary = 'asked about billing';
    const settledAt = new Date(5000);
    rows[live.id].activityRebuiltAt = settledAt;

    await gw.archiveSession('agent-1', 'bridle:admin', ARCHIVED);

    const moved = await gw.findById(live.id);
    expect(moved?.sessionKey).toBe(ARCHIVED);
    expect(moved?.archived).toBe(true);
    expect(moved?.externalUserId).toBe('admin');
    expect(moved?.messageCount).toBe(6);
    expect(moved?.summary).toBe('asked about billing');
    // The row and its file move together, nothing was said: a settled
    // conversation stays settled.
    expect(rows[live.id].activityRebuiltAt).toEqual(settledAt);
    expect(Object.keys(rows)).toHaveLength(1);
  });

  it('does nothing, quietly, when the conversation was never indexed', async () => {
    const { gw, rows } = newGateway();

    await gw.archiveSession('agent-1', 'bridle:admin', ARCHIVED);

    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('leaves the same conversation key of another agent alone', async () => {
    const { gw } = newGateway();
    const other = await gw.reconcileUpsert(input({ agentId: 'agent-2' }));
    await gw.reconcileUpsert(input());

    await gw.archiveSession('agent-1', 'bridle:admin', ARCHIVED);

    const untouched = await gw.findById(other.id);
    expect(untouched?.sessionKey).toBe('bridle:admin');
    expect(untouched?.archived).toBe(false);
  });

  it('lets the next conversation start a row of its own', async () => {
    const { gw, rows } = newGateway();
    await gw.reconcileUpsert(input());
    await gw.archiveSession('agent-1', 'bridle:admin', ARCHIVED);

    await gw.reconcileUpsert(input({ preview: 'new chat', messageCount: 1 }));

    expect(Object.keys(rows)).toHaveLength(2);
  });
});

describe('ChatGateway.list', () => {
  it('hides internal channel unless includeInternal, and returns total', async () => {
    const { gw } = newGateway();
    await gw.reconcileUpsert(
      input({
        sessionKey: 'bridle:a',
        channel: 'bridle',
        lastMessageAt: new Date(3000),
      }),
    );
    await gw.reconcileUpsert(
      input({
        sessionKey: 'telegram:b',
        channel: 'telegram',
        lastMessageAt: new Date(2000),
      }),
    );
    await gw.reconcileUpsert(
      input({
        sessionKey: 'internal:heartbeat',
        channel: 'internal',
        lastMessageAt: new Date(1000),
      }),
    );

    const visible = await gw.list({ agentId: 'agent-1' });
    expect(visible.total).toBe(2);
    expect(visible.items.map((i) => i.channel)).toEqual(['bridle', 'telegram']); // desc by lastMessageAt

    const all = await gw.list({ agentId: 'agent-1', includeInternal: true });
    expect(all.total).toBe(3);
  });

  // What the list was asked for, as Prisma saw it.
  const searchedFields = (
    prisma: ReturnType<typeof makePrismaStub>['prisma'],
  ) => {
    const calls = prisma.chatSession.findMany.mock.calls as unknown as [
      { where: { OR?: Record<string, unknown>[] } },
    ][];
    const where = calls[calls.length - 1][0].where;
    return (where.OR ?? []).map((condition) => Object.keys(condition)[0]);
  };

  it('searches title, preview and the end user’s id across everyone’s chats', async () => {
    const { gw, prisma } = newGateway();
    await gw.list({ search: 'anna' });
    expect(searchedFields(prisma)).toEqual([
      'title',
      'preview',
      'externalUserId',
    ]);
  });

  // CLEAN-248. In one person's own list the id matches every row or none:
  // a search that is a fragment of their id would return the whole list.
  it('leaves the id out of the search when the list is one end user’s', async () => {
    const { gw, prisma } = newGateway();
    await gw.list({ externalUserId: 'user-1', search: 'user' });
    expect(searchedFields(prisma)).toEqual(['title', 'preview']);
  });
});

describe('ChatGateway feedback', () => {
  const fb = (over: Record<string, unknown> = {}) => ({
    sessionId: 'c1',
    messageId: 'm1',
    rating: 1,
    source: 'admin',
    authorId: 'u1',
    ...over,
  });

  it('upserts then lists an author’s feedback', async () => {
    const { gw } = newGateway();
    await gw.upsertFeedback(fb({ rating: 1 }));
    const list = await gw.listFeedbackByAuthor('c1', 'u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ messageId: 'm1', rating: 1 });
  });

  it('re-rating the same message updates in place (no duplicate row)', async () => {
    const { gw } = newGateway();
    await gw.upsertFeedback(fb({ rating: 1 }));
    await gw.upsertFeedback(fb({ rating: -1 }));
    const list = await gw.listFeedbackByAuthor('c1', 'u1');
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBe(-1);
  });

  it('deleteFeedback clears it (toggle-off)', async () => {
    const { gw } = newGateway();
    await gw.upsertFeedback(fb());
    await gw.deleteFeedback('c1', 'm1', 'u1');
    expect(await gw.listFeedbackByAuthor('c1', 'u1')).toHaveLength(0);
  });

  it('scopes listing to the requesting author', async () => {
    const { gw } = newGateway();
    await gw.upsertFeedback(fb({ authorId: 'u1' }));
    await gw.upsertFeedback(fb({ authorId: 'u2', messageId: 'm2' }));
    expect(await gw.listFeedbackByAuthor('c1', 'u1')).toHaveLength(1);
    expect(await gw.listFeedbackByAuthor('c1', 'u2')).toHaveLength(1);
  });
});
