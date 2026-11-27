import { ChatTopicGateway, topicUsageQuery } from './chatTopic.gateway';
import { AGGREGATE_CONCURRENCY, AGGREGATE_WORK_MEM } from './aggregate';
import { ChatTopicMergeRefused, agentScopeCondition } from '../domain';

type Row = Record<string, unknown>;
type Sql = { text: string; values: unknown[] };
type Count = { topicId: string; conversations: number };

const uniqueViolation = () =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const at = (day: number) => new Date(Date.UTC(2026, 10, day));

const row = (key: string, over: Row = {}): Row => ({
  id: `topic-${key}`,
  key,
  labels: { en: key, ru: `${key}-ru` },
  mergedIntoId: null,
  createdAt: at(1),
  ...over,
});

/**
 * `ChatTopic` in memory, with the unique key the table has. `counts` is what
 * the usage statement answers: conversations by topic, already folded into
 * the topic that stands.
 *
 * `$transaction` is the form with a function: the work is handed a client
 * and everything it does through it is one transaction. The fake hands it
 * the same tables, and keeps what was asked of it in `asked`, in order.
 */
function makeStub(topics: Row[] = [], counts: Count[] = []) {
  const asked: string[] = [];
  const chatTopic = {
    findMany: jest.fn(
      async (args?: {
        where?: { id?: { in: string[] }; mergedIntoId?: null };
        take?: number;
      }) => {
        const ids = args?.where?.id?.in;
        const standing = args?.where && 'mergedIntoId' in args.where;
        return topics
          .filter((t) => !ids || ids.includes(t.id as string))
          .filter((t) => !standing || t.mergedIntoId === null)
          .slice(0, args?.take ?? topics.length);
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { key?: string; id?: string } }) =>
        topics.find((t) =>
          where.key !== undefined ? t.key === where.key : t.id === where.id,
        ) ?? null,
    ),
    count: jest.fn(
      async ({ where }: { where: { mergedIntoId: null } }) =>
        topics.filter((t) => t.mergedIntoId === where.mergedIntoId).length,
    ),
    create: jest.fn(async ({ data }: { data: Row }) => {
      if (topics.some((t) => t.key === data.key)) throw uniqueViolation();
      const created = { mergedIntoId: null, createdAt: at(20), ...data };
      topics.push(created);
      return created;
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Row }) => {
        asked.push('update');
        const found = topics.find((t) => t.id === where.id);
        if (!found) throw new Error('No ChatTopic found');
        return Object.assign(found, data);
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { mergedIntoId: string };
        data: Row;
      }) => {
        asked.push('updateMany');
        const hit = topics.filter((t) => t.mergedIntoId === where.mergedIntoId);
        for (const t of hit) Object.assign(t, data);
        return { count: hit.length };
      },
    ),
  };
  const $queryRaw = jest.fn(async (_query: Sql) => {
    asked.push('count');
    return counts;
  });
  // The rows a merge locks: the ones its statement names, as they stand at
  // that moment.
  const lock = jest.fn(async (query: Sql) => {
    asked.push('lock');
    return topics.filter((t) => query.values.includes(t.id));
  });
  const $executeRaw = jest.fn(
    async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
      asked.push('settings');
      return 1;
    },
  );
  const tx = {
    chatTopic,
    $executeRaw,
    $queryRaw: (query: Sql) =>
      /FOR UPDATE/.test(query.text) ? lock(query) : $queryRaw(query),
  };
  const $transaction = jest.fn(
    async (
      work: (client: typeof tx) => Promise<unknown>,
      _options?: { maxWait?: number; timeout?: number },
    ) => work(tx),
  );
  const prisma = { chatTopic, $queryRaw, $transaction };
  const gw = new ChatTopicGateway(
    prisma as unknown as ConstructorParameters<typeof ChatTopicGateway>[0],
  );
  return {
    gw,
    topics,
    chatTopic,
    $queryRaw,
    $executeRaw,
    $transaction,
    lock,
    asked,
  };
}

// The topics the model is offered, ordered by counts the caller hands in
// (CLEAN-270). The counts are a pass over every conversation
// (`usageCounts`); the summary batch makes it once per run and keeps the
// tally, and this read, made for every conversation, touches `ChatTopic`
// alone.
describe('ChatTopicGateway.vocabulary', () => {
  const stored = () => [
    row('billing', { createdAt: at(1) }),
    row('refunds', { createdAt: at(2) }),
    row('vacation', { createdAt: at(3) }),
    row('invoices', { createdAt: at(4), mergedIntoId: 'topic-billing' }),
  ];
  const NOBODY = new Map<string, number>();

  it('answers the topics most used first, by the counts it is handed', async () => {
    const { gw } = makeStub(stored());
    const tally = new Map([
      ['topic-vacation', 9],
      ['topic-billing', 4],
    ]);

    expect((await gw.vocabulary(60, tally)).map((t) => t.key)).toEqual([
      'vacation',
      'billing',
      'refunds',
    ]);
  });

  // An operator folded it into another: the subject has one name now, and
  // offering both would have the model choose between them again.
  it('does not offer a merged topic', async () => {
    const { gw } = makeStub(stored());
    expect((await gw.vocabulary(60, NOBODY)).map((t) => t.key)).not.toContain(
      'invoices',
    );
  });

  it('answers at most the cap, the most used', async () => {
    const { gw } = makeStub(stored());
    const tally = new Map([
      ['topic-refunds', 5],
      ['topic-vacation', 2],
    ]);
    expect((await gw.vocabulary(2, tally)).map((t) => t.key)).toEqual([
      'refunds',
      'vacation',
    ]);
  });

  it('reads the topics and nothing else: the conversations are not passed over', async () => {
    const { gw, chatTopic, $queryRaw } = makeStub(stored(), [
      // What the table would say; it is not asked.
      { topicId: 'topic-vacation', conversations: 9 },
    ]);
    const tally = new Map([
      ['topic-refunds', 3],
      ['topic-billing', 2],
    ]);

    expect((await gw.vocabulary(60, tally)).map((t) => t.key)).toEqual([
      'refunds',
      'billing',
      'vacation',
    ]);
    expect((await gw.vocabulary(1, tally)).map((t) => t.key)).toEqual([
      'refunds',
    ]);
    expect(chatTopic.findMany).toHaveBeenCalledTimes(2);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('answers the topic as the domain reads it', async () => {
    const { gw } = makeStub([
      row('billing', { labels: { en: 'Billing', ru: 'Оплата', n: 5 } }),
    ]);
    expect(await gw.vocabulary(60, NOBODY)).toEqual([
      {
        id: 'topic-billing',
        key: 'billing',
        // What is not a label is not passed on as one.
        labels: { en: 'Billing', ru: 'Оплата' },
        mergedIntoId: null,
        createdAt: at(1),
      },
    ]);
  });

  // It read the whole table: fine at tens of rows, and nothing kept the
  // table at tens (CLEAN-270, review). The topics that stand, and no more of
  // them than may stand.
  it('reads the topics that stand, at most the hundred that may', async () => {
    const { gw, chatTopic } = makeStub(stored());

    await gw.vocabulary(60, NOBODY);

    expect(chatTopic.findMany).toHaveBeenCalledWith({
      where: { mergedIntoId: null },
      // The oldest first: which hundred, were there ever more, does not
      // depend on the order the rows happen to come back in.
      orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
      take: 100,
    });
  });

  // A topic the run coined a conversation ago has one use and the newest
  // date. With the cap's worth of topics in use it stood past the cap.
  it('lists a topic the run coined whatever its count, in the place of the least used', async () => {
    const { gw } = makeStub(stored());
    const tally = new Map([
      ['topic-billing', 9],
      ['topic-refunds', 4],
      ['topic-vacation', 1],
    ]);

    expect((await gw.vocabulary(2, tally)).map((t) => t.key)).toEqual([
      'billing',
      'refunds',
    ]);
    expect(
      (await gw.vocabulary(2, tally, new Set(['topic-vacation']))).map(
        (t) => t.key,
      ),
    ).toEqual(['billing', 'vacation']);
  });
});

describe('ChatTopicGateway.standingByKey', () => {
  it('answers the topic that has the key, the one it was folded into for a merged key, and null for no topic', async () => {
    const { gw, chatTopic } = makeStub([
      row('billing'),
      row('invoices', { mergedIntoId: 'topic-billing' }),
    ]);

    expect((await gw.standingByKey('billing'))?.id).toBe('topic-billing');
    expect((await gw.standingByKey('invoices'))?.id).toBe('topic-billing');
    expect(await gw.standingByKey('refunds')).toBeNull();
    // A look, and nothing written.
    expect(chatTopic.create).not.toHaveBeenCalled();
  });
});

describe('ChatTopicGateway.countStanding', () => {
  it('counts the topics that are not merged', async () => {
    const { gw } = makeStub([
      row('billing'),
      row('refunds'),
      row('invoices', { mergedIntoId: 'topic-billing' }),
    ]);
    expect(await gw.countStanding()).toBe(2);
  });
});

describe('ChatTopicGateway.findOrCreateByKey', () => {
  const LABELS = { en: 'Refunds', ru: 'Возврат денег' };

  it('creates the topic when the key is new', async () => {
    const { gw, topics, chatTopic } = makeStub([row('billing')]);

    const created = await gw.findOrCreateByKey('refunds', LABELS);

    expect(created).toMatchObject({
      key: 'refunds',
      labels: LABELS,
      mergedIntoId: null,
    });
    expect(created.id).toMatch(/^topic-[0-9a-f-]{36}$/);
    expect(topics).toHaveLength(2);
    expect(chatTopic.create).toHaveBeenCalledTimes(1);
  });

  it('reuses the topic that has the key, with the labels it has', async () => {
    const { gw, topics, chatTopic } = makeStub([
      row('refunds', { labels: { en: 'Refunds', ru: 'Возврат' } }),
    ]);

    const found = await gw.findOrCreateByKey('refunds', {
      en: 'Money back',
      ru: 'Деньги назад',
    });

    expect(found.id).toBe('topic-refunds');
    expect(found.labels).toEqual({ en: 'Refunds', ru: 'Возврат' });
    expect(topics).toHaveLength(1);
    expect(chatTopic.create).not.toHaveBeenCalled();
  });

  // The model is no longer shown a merged key, so it can propose it again.
  it('answers the topic a merged key was folded into', async () => {
    const { gw, topics } = makeStub([
      row('billing'),
      row('invoices', { mergedIntoId: 'topic-billing' }),
    ]);

    const found = await gw.findOrCreateByKey('invoices', {
      en: 'Invoices',
      ru: 'Счета',
    });

    expect(found.id).toBe('topic-billing');
    expect(topics).toHaveLength(2);
  });

  // The on-demand summary can run beside the batch, and both can coin the
  // same key. The table has one row for it; the loser reads that row.
  it('reads the topic when it was created under it', async () => {
    const { gw, topics, chatTopic } = makeStub();
    chatTopic.findUnique.mockImplementationOnce(async () => {
      // Not there when looked for; there by the time of the insert.
      topics.push(row('refunds', { id: 'topic-first' }));
      return null;
    });

    const found = await gw.findOrCreateByKey('refunds', LABELS);

    expect(found.id).toBe('topic-first');
    expect(topics).toHaveLength(1);
  });

  it('lets any other failure of the insert through', async () => {
    const { gw, chatTopic } = makeStub();
    chatTopic.create.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });
    await expect(gw.findOrCreateByKey('refunds', LABELS)).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('ChatTopicGateway.findByKey', () => {
  it('answers the topic with that key, merged or not, and null for none', async () => {
    const { gw } = makeStub([
      row('billing'),
      row('invoices', { mergedIntoId: 'topic-billing' }),
    ]);

    expect((await gw.findByKey('billing'))?.id).toBe('topic-billing');
    expect((await gw.findByKey('invoices'))?.mergedIntoId).toBe(
      'topic-billing',
    );
    expect(await gw.findByKey('nope')).toBeNull();
  });
});

describe('ChatTopicGateway.merge', () => {
  it('points the topic at the one it is folded into', async () => {
    const { gw, topics } = makeStub([row('billing'), row('invoices')]);

    await gw.merge('topic-invoices', 'topic-billing');

    expect(topics.find((t) => t.key === 'invoices')?.mergedIntoId).toBe(
      'topic-billing',
    );
    expect(topics.find((t) => t.key === 'billing')?.mergedIntoId).toBeNull();
  });

  // A reader follows `mergedIntoId` once. What was folded into the topic
  // that is now merged must arrive in one step too.
  it('re-points what was folded into it earlier, in the same transaction', async () => {
    const { gw, topics, $transaction } = makeStub([
      row('billing'),
      row('invoices'),
      row('receipts', { mergedIntoId: 'topic-invoices' }),
    ]);

    await gw.merge('topic-invoices', 'topic-billing');

    expect(topics.map((t) => [t.key, t.mergedIntoId])).toEqual([
      ['billing', null],
      ['invoices', 'topic-billing'],
      ['receipts', 'topic-billing'],
    ]);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * The caller looks at the two topics, then merges (`topicMergeRefusal`,
   * `merge_chat_topics`). Between the look and the write another merge can
   * land, and two of them, each allowed when it was looked at, left a chain
   * A → B → C: a reader follows `mergedIntoId` once, so the conversations of
   * A were counted under B, which no list shows (CLEAN-270, review). The
   * rules are asked again inside the transaction, of rows it has locked.
   */
  describe('looks again inside its transaction', () => {
    it('locks both topics, in one order, before it reads or writes them', async () => {
      const { gw, lock, asked } = makeStub([row('billing'), row('invoices')]);

      await gw.merge('topic-invoices', 'topic-billing');

      const [statement] = lock.mock.calls[0];
      expect(statement.text).toMatch(/FROM "ChatTopic"/);
      expect(statement.text).toMatch(/ORDER BY "id"\s+FOR UPDATE/);
      expect(statement.values).toEqual(['topic-invoices', 'topic-billing']);
      expect(asked).toEqual(['lock', 'updateMany', 'update']);
    });

    it('refuses a target that was merged since the caller looked, and writes nothing', async () => {
      // B was folded into C a moment ago; this call was allowed A into B.
      const { gw, topics, asked } = makeStub([
        row('a'),
        row('b', { mergedIntoId: 'topic-c' }),
        row('c'),
      ]);

      await expect(gw.merge('topic-a', 'topic-b')).rejects.toThrow(
        ChatTopicMergeRefused,
      );
      await expect(gw.merge('topic-a', 'topic-b')).rejects.toThrow(
        /«b» was merged into another topic itself/,
      );

      // No chain: A still stands.
      expect(topics.find((t) => t.key === 'a')?.mergedIntoId).toBeNull();
      expect(asked).toEqual(['lock', 'lock']);
    });

    it('refuses a topic that was merged since the caller looked', async () => {
      const { gw, topics } = makeStub([
        row('a', { mergedIntoId: 'topic-c' }),
        row('b'),
        row('c'),
      ]);

      await expect(gw.merge('topic-a', 'topic-b')).rejects.toThrow(
        /«a» is already merged/,
      );
      expect(topics.find((t) => t.key === 'a')?.mergedIntoId).toBe('topic-c');
    });

    it('refuses a topic that is no longer there', async () => {
      const { gw, asked } = makeStub([row('billing')]);

      await expect(gw.merge('topic-gone', 'topic-billing')).rejects.toThrow(
        ChatTopicMergeRefused,
      );
      expect(asked).toEqual(['lock']);
    });

    // The other order of the same two merges: B into C lands second, and
    // finds A already folded into B. It takes A along.
    it('re-points what another merge folded into the topic a moment ago', async () => {
      const { gw, topics } = makeStub([
        row('a', { mergedIntoId: 'topic-b' }),
        row('b'),
        row('c'),
      ]);

      await gw.merge('topic-b', 'topic-c');

      expect(topics.map((t) => [t.key, t.mergedIntoId])).toEqual([
        ['a', 'topic-c'],
        ['b', 'topic-c'],
        ['c', null],
      ]);
    });
  });
});

describe('ChatTopicGateway.findByIds', () => {
  const stored = () => [
    row('billing', { labels: { en: 'Billing', ru: 'Оплата' } }),
    row('refunds'),
    row('invoices', { mergedIntoId: 'topic-billing' }),
  ];

  it('answers each topic by the id asked, a merged one as the topic it was folded into', async () => {
    const { gw } = makeStub(stored());

    const found = await gw.findByIds([
      'topic-refunds',
      'topic-invoices',
      'topic-gone',
    ]);

    expect([...found.keys()].sort()).toEqual([
      'topic-invoices',
      'topic-refunds',
    ]);
    expect(found.get('topic-refunds')?.key).toBe('refunds');
    expect(found.get('topic-invoices')).toMatchObject({
      id: 'topic-billing',
      key: 'billing',
      labels: { en: 'Billing', ru: 'Оплата' },
    });
  });

  it('follows a merge once, and no further', async () => {
    // Not a state `merge` leaves behind; a row edited by hand could be.
    const { gw } = makeStub([
      row('a', { mergedIntoId: 'topic-b' }),
      row('b', { mergedIntoId: 'topic-c' }),
      row('c'),
    ]);
    expect((await gw.findByIds(['topic-a'])).get('topic-a')?.key).toBe('b');
  });

  it('keeps the topic itself when what it was merged into is gone', async () => {
    const { gw } = makeStub([row('a', { mergedIntoId: 'topic-gone' })]);
    expect((await gw.findByIds(['topic-a'])).get('topic-a')?.key).toBe('a');
  });

  it('asks nothing when no id is given', async () => {
    const { gw, chatTopic } = makeStub(stored());
    expect((await gw.findByIds([])).size).toBe(0);
    expect(chatTopic.findMany).not.toHaveBeenCalled();
  });
});

describe('ChatTopicGateway.listWithCounts', () => {
  const stored = () => [
    row('billing', { createdAt: at(1) }),
    row('refunds', { createdAt: at(2) }),
    row('invoices', { createdAt: at(3), mergedIntoId: 'topic-billing' }),
  ];

  it('lists every standing topic with its conversations and the keys folded into it', async () => {
    const { gw } = makeStub(stored(), [
      { topicId: 'topic-billing', conversations: 6 },
    ]);

    expect(
      (await gw.listWithCounts()).map((u) => [
        u.topic.key,
        u.conversations,
        u.merged,
      ]),
    ).toEqual([
      ['billing', 6, ['invoices']],
      ['refunds', 0, []],
    ]);
  });

  it('counts the conversations of the agents in the scope only', async () => {
    const { gw, $queryRaw } = makeStub(stored());

    await gw.listWithCounts({ notIn: ['agent-ranch'] });
    expect($queryRaw.mock.calls[0][0].text).toContain('NOT IN');
    expect($queryRaw.mock.calls[0][0].values).toEqual(['agent-ranch']);

    await gw.listWithCounts({ in: ['agent-1', 'agent-2'] });
    expect($queryRaw.mock.calls[1][0].values).toEqual(['agent-1', 'agent-2']);
  });

  // `IN ()` is not SQL, and leaving the condition out would count for
  // every agent.
  it('counts nothing, without a query, for a scope that admits no agent', async () => {
    const { gw, $queryRaw } = makeStub(stored(), [
      { topicId: 'topic-billing', conversations: 6 },
    ]);

    expect(
      (await gw.listWithCounts({ in: [] })).map((u) => u.conversations),
    ).toEqual([0, 0]);
    expect($queryRaw).not.toHaveBeenCalled();
  });
});

// The one read that passes over the conversations (CLEAN-270). The batch
// asks it once per run, the topics tool once per call.
describe('ChatTopicGateway.usageCounts', () => {
  it('answers how many conversations carry each standing topic, by its id, from one statement', async () => {
    const { gw, chatTopic, $queryRaw } = makeStub(
      [row('billing'), row('refunds')],
      [
        { topicId: 'topic-billing', conversations: 6 },
        { topicId: 'topic-refunds', conversations: 2 },
      ],
    );

    const counts = await gw.usageCounts();

    expect([...counts]).toEqual([
      ['topic-billing', 6],
      ['topic-refunds', 2],
    ]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    // Over every agent, and without a look at the topics themselves.
    expect($queryRaw.mock.calls[0][0].values).toEqual([]);
    expect(chatTopic.findMany).not.toHaveBeenCalled();
  });

  it('keeps to the agents of the scope, and asks nothing for a scope that admits none', async () => {
    const { gw, $queryRaw } = makeStub(
      [row('billing')],
      [{ topicId: 'topic-billing', conversations: 6 }],
    );

    await gw.usageCounts({ in: ['agent-1'] });
    expect($queryRaw.mock.calls[0][0].values).toEqual(['agent-1']);

    expect((await gw.usageCounts({ in: [] })).size).toBe(0);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  /**
   * It ran as a bare `$queryRaw` (CLEAN-270, review): a pass over every
   * conversation with the session's default of five seconds, no say over the
   * plan once the statement had run five times with agent ids bound, and
   * outside the queue that keeps such passes to two at a time. It goes the
   * way the activity aggregates go (`runAggregate`), in the same queue.
   */
  it('runs in a transaction of its own, with the settings and the time an aggregate gets', async () => {
    const { gw, $transaction, $executeRaw, asked } = makeStub(
      [row('billing')],
      [{ topicId: 'topic-billing', conversations: 6 }],
    );

    await gw.usageCounts({ in: ['agent-1'] });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({
      maxWait: 30_000,
      timeout: 30_000,
    });
    // The settings first, in the transaction the statement runs in.
    expect(asked).toEqual(['settings', 'count']);
    const [strings, ...values] = $executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain(
      "set_config('plan_cache_mode', 'force_custom_plan', true)",
    );
    expect(values).toEqual([AGGREGATE_WORK_MEM]);
  });

  it('waits its turn among the aggregates: two at a time, whoever asks', async () => {
    const stub = makeStub([row('billing')]);
    const end: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    stub.$transaction.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((done) => end.push(done));
      running--;
      return [];
    });

    const all = Promise.all(
      Array.from({ length: 5 }, () => stub.gw.usageCounts()),
    );
    for (let ended = 0; ended < 5; ended++) {
      await new Promise((tick) => setImmediate(tick));
      expect(running).toBeLessThanOrEqual(AGGREGATE_CONCURRENCY);
      end[ended]();
    }
    await all;

    expect(peak).toBe(AGGREGATE_CONCURRENCY);
    expect(stub.$transaction).toHaveBeenCalledTimes(5);
  });
});

describe('the usage statement', () => {
  const everyAgent = agentScopeCondition(undefined);

  it('counts conversations by the topic that stands for each id they carry', () => {
    const query = topicUsageQuery(everyAgent) as unknown as Sql;
    // One row per topic id a conversation carries …
    expect(query.text).toMatch(/unnest\(s\."topicIds"\)/);
    // … read as the topic it was folded into, when it was …
    expect(query.text).toContain('COALESCE(t."mergedIntoId", t."id")');
    // … and once per conversation, before anything is counted: one that
    // carries a topic and another folded into it is one conversation.
    expect(query.text).toMatch(/SELECT DISTINCT COALESCE/);
    expect(query.text).toMatch(/GROUP BY r\."topicId"/);
    expect(query.values).toEqual([]);
  });

  it('answers a number, not a bigint', () => {
    const query = topicUsageQuery(everyAgent) as unknown as Sql;
    expect(query.text).toContain('COUNT(*)::int AS "conversations"');
  });

  it('binds every agent id as a value', () => {
    const hostile = `x') OR 1=1 --`;
    const query = topicUsageQuery(
      agentScopeCondition({ in: ['agent-1', hostile], notIn: ['agent-3'] }),
    ) as unknown as Sql;
    expect(query.text).not.toContain('agent-1');
    expect(query.text).not.toContain('OR 1=1');
    expect(query.values).toEqual(['agent-1', hostile, 'agent-3']);
  });
});
