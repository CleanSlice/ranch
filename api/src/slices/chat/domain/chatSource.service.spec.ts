import { ChatSourceService } from './chatSource.service';
import { IChatSourceGateway, ISourceRatingReader } from './chatSource.gateway';
import {
  IChatMessageSourceData,
  ICitationGroup,
  ICitationRange,
  ICitedAnswer,
  ICreateChatMessageSource,
  IChatSourceInput,
} from './chatSource.types';
import { ISourceGateway } from '#/reins/source/domain/source.gateway';
import { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { ITemplateGateway } from '#/agent/template/domain';

// In-memory rows keyed by (messageId, n) — enough to prove the service's
// rules without Prisma.
function makeGateway(seed: IChatMessageSourceData[] = []) {
  const rows = new Map<string, IChatMessageSourceData>();
  for (const r of seed) rows.set(`${r.messageId}:${r.n}`, r);
  const gateway: IChatSourceGateway = {
    upsertMany: jest.fn(async (input: ICreateChatMessageSource[]) => {
      for (const r of input) {
        rows.set(`${r.messageId}:${r.n}`, {
          id: `row-${r.messageId}-${r.n}`,
          createdAt: new Date(0),
          ...r,
        });
      }
    }),
    findByMessageIds: jest.fn(async (ids: string[]) =>
      [...rows.values()].filter((r) => ids.includes(r.messageId)),
    ),
    findOne: jest.fn(async (agentId: string, messageId: string, n: number) => {
      const r = rows.get(`${messageId}:${n}`);
      return r && r.agentId === agentId ? r : null;
    }),
    // The three period reads (CLEAN-258), over the same rows and with the
    // conditions the real queries carry: the client, the range with both
    // ends, and the agents of the scope.
    findCitedAnswers: jest.fn(async (range: ICitationRange) => {
      const first = new Map<string, ICitedAnswer>();
      for (const r of inRange(rows.values(), range)) {
        const key = `${r.agentId}|${r.messageId}`;
        const seen = first.get(key);
        if (!seen || r.createdAt < seen.at) {
          first.set(key, {
            agentId: r.agentId,
            messageId: r.messageId,
            at: r.createdAt,
          });
        }
      }
      return [...first.values()].sort(
        (a, b) => a.at.getTime() - b.at.getTime(),
      );
    }),
    countCitationsBySource: jest.fn(async (range: ICitationRange) => {
      const groups = new Map<string, ICitationGroup>();
      for (const r of inRange(rows.values(), range)) {
        const key = JSON.stringify([r.kind, r.knowledgeId, r.knowledgeName]);
        const group = groups.get(key) ?? {
          kind: r.kind,
          knowledgeId: r.knowledgeId,
          knowledgeName: r.knowledgeName,
          citations: 0,
          lastCitedAt: r.createdAt,
        };
        group.citations += 1;
        if (r.createdAt > group.lastCitedAt) group.lastCitedAt = r.createdAt;
        groups.set(key, group);
      }
      return [...groups.values()];
    }),
    firstCreatedAt: jest.fn(async () => {
      const times = [...rows.values()].map((r) => r.createdAt.getTime());
      return times.length ? new Date(Math.min(...times)) : null;
    }),
  };
  return { gateway, rows };
}

function inRange(
  rows: Iterable<IChatMessageSourceData>,
  range: ICitationRange,
): IChatMessageSourceData[] {
  const scope = range.agentScope;
  return [...rows].filter(
    (r) =>
      r.clientId === range.clientId &&
      r.createdAt >= range.from &&
      r.createdAt <= range.to &&
      (scope?.in === undefined || scope.in.includes(r.agentId)) &&
      (scope?.notIn === undefined || !scope.notIn.includes(r.agentId)),
  );
}

// Every existing source belongs to base k1 unless the test says otherwise.
function makeSources(
  existing: string[],
  baseOf: Record<string, string> = {},
): ISourceGateway {
  return {
    findById: jest.fn(async (id: string) =>
      existing.includes(id)
        ? { id, name: `Doc ${id}`, knowledgeId: baseOf[id] ?? 'k1' }
        : null,
    ),
  } as unknown as ISourceGateway;
}

function makeKnowledge(access: Record<string, 'open' | 'closed'>) {
  return {
    findExistingByIds: jest.fn(async (ids: string[]) =>
      ids
        .filter((id) => id in access)
        .map((id) => ({ id, name: `Base ${id}`, readerAccess: access[id] })),
    ),
  } as unknown as IKnowledgeGateway;
}

// agent-1 is bound to k1 and k-real; nothing else.
const agents = {
  findById: jest.fn(async (id: string) =>
    id === 'agent-1'
      ? { id, knowledgeIds: ['k1', 'k-real'], templateId: 'tpl-1' }
      : null,
  ),
} as unknown as IAgentGateway;
const templates = {
  findById: jest.fn(async () => null),
} as unknown as ITemplateGateway;

function makeService(
  gateway: IChatSourceGateway,
  sources: ISourceGateway,
  knowledge: IKnowledgeGateway,
  ratings?: ISourceRatingReader,
) {
  return new ChatSourceService(
    gateway,
    sources,
    knowledge,
    agents,
    templates,
    ratings,
  );
}

const knowledgeSource: IChatSourceInput = {
  kind: 'knowledge',
  id: 's1',
  name: 'Contract 2025.pdf',
  knowledgeId: 'k1',
  knowledgeName: 'Legal',
};
const webSource: IChatSourceInput = {
  kind: 'web',
  url: 'https://example.com/page',
  title: 'Example',
};

function record(sources: IChatSourceInput[], clientId = 'user-1') {
  return { agentId: 'agent-1', clientId, messageId: 'm1', sources };
}

describe('ChatSourceService.record — what the hub writes on a sources event', () => {
  it('writes one row per entry with dense numbers and the Source id when it exists', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'closed' }),
    );
    await service.record(record([knowledgeSource, webSource]));
    expect(rows.get('m1:1')).toMatchObject({
      agentId: 'agent-1',
      clientId: 'user-1',
      sessionKey: 'bridle:user-1',
      kind: 'knowledge',
      sourceId: 's1',
      knowledgeId: 'k1',
      knowledgeName: 'Base k1',
      name: 'Contract 2025.pdf',
      url: null,
    });
    expect(rows.get('m1:2')).toMatchObject({
      kind: 'web',
      sourceId: null,
      name: 'Example',
      url: 'https://example.com/page',
    });
  });

  it('takes the base from the Source row, not from the event', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(
      gateway,
      makeSources(['s1'], { s1: 'k-real' }),
      makeKnowledge({ 'k-real': 'closed', 'k-open': 'open' }),
    );
    // A runtime claiming the document belongs to an open base gains nothing.
    await service.record(
      record([
        { ...knowledgeSource, knowledgeId: 'k-open', knowledgeName: 'Public' },
      ]),
    );
    expect(rows.get('m1:1')).toMatchObject({
      knowledgeId: 'k-real',
      knowledgeName: 'Base k-real',
    });
    const entries = (
      await service.forMessages(['m1'], { clientId: 'user-1', isAdmin: false })
    ).get('m1')!;
    expect(entries[0].canOpen).toBe(false);
  });

  it('keeps the name but no id when the Source is already gone', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    await service.record(record([knowledgeSource]));
    expect(rows.get('m1:1')).toMatchObject({
      sourceId: null,
      name: 'Contract 2025.pdf',
    });
  });

  it('names a web source by its address when the page had no title', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    await service.record(
      record([
        { kind: 'web', url: 'https://docs.example.com/a/b?x=1', title: null },
      ]),
    );
    expect(rows.get('m1:1')?.name).toBe('docs.example.com/a/b');
  });

  it('refuses a list that is too long or carries a non-web address, and writes nothing', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      kind: 'web' as const,
      url: `https://example.com/${i}`,
      title: null,
    }));
    await expect(service.record(record(tooMany))).rejects.toThrow(/50/);
    await expect(
      service.record(
        record([{ kind: 'web', url: 'javascript:alert(1)', title: 'x' }]),
      ),
    ).rejects.toThrow(/address/);
    await expect(
      service.record(
        record([{ kind: 'web', url: 'file:///etc/passwd', title: 'x' }]),
      ),
    ).rejects.toThrow(/address/);
    expect(rows.size).toBe(0);
  });

  it('is idempotent on a replayed event', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({}),
    );
    await service.record(record([knowledgeSource]));
    await service.record(record([knowledgeSource]));
    expect(rows.size).toBe(1);
  });
});

describe('ChatSourceService.forMessages — what a reader is shown', () => {
  const seeded: IChatMessageSourceData[] = [
    {
      id: 'r1',
      agentId: 'agent-1',
      clientId: 'user-1',
      sessionKey: 'bridle:user-1',
      messageId: 'm1',
      n: 1,
      kind: 'knowledge',
      sourceId: 's1',
      knowledgeId: 'k1',
      knowledgeName: 'Legal',
      name: 'Contract 2025.pdf',
      url: null,
      createdAt: new Date(0),
    },
    {
      id: 'r2',
      agentId: 'agent-1',
      clientId: 'user-1',
      sessionKey: 'bridle:user-1',
      messageId: 'm1',
      n: 2,
      kind: 'web',
      sourceId: null,
      knowledgeId: null,
      knowledgeName: null,
      name: 'Example',
      url: 'https://example.com/page',
      createdAt: new Date(0),
    },
    {
      id: 'r3',
      agentId: 'agent-1',
      clientId: 'user-1',
      sessionKey: 'bridle:user-1',
      messageId: 'm2',
      n: 1,
      kind: 'knowledge',
      sourceId: null,
      knowledgeId: 'k1',
      knowledgeName: 'Legal',
      name: 'Deleted.pdf',
      url: null,
      createdAt: new Date(0),
    },
  ];
  const viewer = { clientId: 'user-1', isAdmin: false };

  it('closes knowledge documents while the base is closed and keeps web open', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'closed' }),
    );
    const byMessage = await service.forMessages(['m1'], viewer);
    expect(byMessage.get('m1')).toEqual([
      {
        n: 1,
        kind: 'knowledge',
        name: 'Contract 2025.pdf',
        knowledgeName: 'Legal',
        canOpen: false,
      },
      {
        n: 2,
        kind: 'web',
        name: 'Example',
        url: 'https://example.com/page',
        canOpen: true,
      },
    ]);
  });

  it('opens knowledge documents once the base is open — read at serve time', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'open' }),
    );
    const entries = (await service.forMessages(['m1'], viewer)).get('m1')!;
    expect(entries[0].canOpen).toBe(true);
  });

  it('opens for the admin identity whatever the policy says', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'closed' }),
    );
    const entries = (
      await service.forMessages(['m1'], { clientId: 'admin', isAdmin: true })
    ).get('m1')!;
    expect(entries[0].canOpen).toBe(true);
  });

  it('never opens a source that no longer exists, even on an open base', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(
      gateway,
      makeSources([]),
      makeKnowledge({ k1: 'open' }),
    );
    const entries = (
      await service.forMessages(['m2'], { clientId: 'admin', isAdmin: true })
    ).get('m2')!;
    expect(entries[0]).toMatchObject({ name: 'Deleted.pdf', canOpen: false });
  });

  it('leaks neither the source id nor the knowledge id', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'open' }),
    );
    const json = JSON.stringify([
      ...(await service.forMessages(['m1'], viewer)).values(),
    ]);
    expect(json).not.toContain('s1');
    expect(json).not.toContain('k1');
  });

  it('adds the viewer’s own rating when a reader is bound', async () => {
    const { gateway } = makeGateway(seeded);
    const mine = jest.fn(async () => ({ 'm1:s1': -1 as const }));
    const ratings: ISourceRatingReader = { mine };
    const service = makeService(
      gateway,
      makeSources(['s1']),
      makeKnowledge({ k1: 'closed' }),
      ratings,
    );
    const entries = (await service.forMessages(['m1'], viewer)).get('m1')!;
    expect(entries[0].myRating).toBe(-1);
    expect(entries[1].myRating).toBeUndefined();
    expect(mine).toHaveBeenCalledWith(['m1'], 'user-1');
  });

  it('answers an empty map for messages without sources, cheaply', async () => {
    const { gateway } = makeGateway(seeded);
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    expect((await service.forMessages(['none'], viewer)).size).toBe(0);
    expect((await service.forMessages([], viewer)).size).toBe(0);
  });
});

describe('ChatSourceService.isCitedTo — the precondition behind opening and rating', () => {
  const row: IChatMessageSourceData = {
    id: 'r1',
    agentId: 'agent-1',
    clientId: 'user-1',
    sessionKey: 'bridle:user-1',
    messageId: 'm1',
    n: 1,
    kind: 'knowledge',
    sourceId: 's1',
    knowledgeId: 'k1',
    knowledgeName: 'Legal',
    name: 'Contract 2025.pdf',
    url: null,
    createdAt: new Date(0),
  };

  it('returns the row for the reader it was cited to, and for the admin', async () => {
    const { gateway } = makeGateway([row]);
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    expect(
      await service.isCitedTo('agent-1', 'm1', 1, {
        clientId: 'user-1',
        isAdmin: false,
      }),
    ).toEqual(row);
    expect(
      await service.isCitedTo('agent-1', 'm1', 1, {
        clientId: 'admin',
        isAdmin: true,
      }),
    ).toEqual(row);
  });

  it('answers null for another reader, another agent, or a number that was never cited', async () => {
    const { gateway } = makeGateway([row]);
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    expect(
      await service.isCitedTo('agent-1', 'm1', 1, {
        clientId: 'user-2',
        isAdmin: false,
      }),
    ).toBeNull();
    expect(
      await service.isCitedTo('agent-2', 'm1', 1, {
        clientId: 'user-1',
        isAdmin: false,
      }),
    ).toBeNull();
    expect(
      await service.isCitedTo('agent-1', 'm1', 2, {
        clientId: 'user-1',
        isAdmin: false,
      }),
    ).toBeNull();
  });
});

describe('ChatSourceService.record — an agent may only link what it may read', () => {
  it('keeps the name but drops the link for a source of a base not bound to the agent', async () => {
    const { gateway, rows } = makeGateway();
    const service = makeService(
      gateway,
      makeSources(['s-other'], { 's-other': 'k-foreign' }),
      makeKnowledge({ 'k-foreign': 'open' }),
    );
    await service.record(
      record([
        {
          kind: 'knowledge',
          id: 's-other',
          name: 'Foreign.pdf',
          knowledgeId: 'k-foreign',
          knowledgeName: 'F',
        },
      ]),
    );
    expect(rows.get('m1:1')).toMatchObject({
      sourceId: null,
      name: 'Foreign.pdf',
    });
    const entries = (
      await service.forMessages(['m1'], { clientId: 'user-1', isAdmin: false })
    ).get('m1')!;
    expect(entries[0].canOpen).toBe(false);
  });
});

describe('ChatSourceService.citedForClient — what a period of statistics reads', () => {
  const FROM = new Date('2026-11-20T22:00:00Z');
  const TO = new Date('2026-11-27T10:30:00Z');

  let n = 0;
  const cited = (
    iso: string,
    over: Partial<IChatMessageSourceData> = {},
  ): IChatMessageSourceData => ({
    id: `row-${(n += 1)}`,
    agentId: 'agent-1',
    clientId: 'user-1',
    sessionKey: 'bridle:user-1',
    messageId: `m${n}`,
    n: 1,
    kind: 'knowledge',
    sourceId: 's1',
    knowledgeId: 'k1',
    knowledgeName: 'Legal',
    name: 'Contract 2025.pdf',
    url: null,
    createdAt: new Date(iso),
    ...over,
  });
  const web = (iso: string, over: Partial<IChatMessageSourceData> = {}) =>
    cited(iso, {
      kind: 'web',
      sourceId: null,
      knowledgeId: null,
      knowledgeName: null,
      name: 'Example',
      url: 'https://example.com/page',
      ...over,
    });

  const serviceOver = (seed: IChatMessageSourceData[]) => {
    const { gateway } = makeGateway(seed);
    const service = makeService(gateway, makeSources([]), makeKnowledge({}));
    return { service, gateway };
  };

  it('says which agent answered with sources and when, once per answer, and nothing of the answer', async () => {
    const { service } = serviceOver([
      cited('2026-11-25T09:00:00Z', { messageId: 'a', n: 1 }),
      cited('2026-11-25T09:00:00Z', { messageId: 'a', n: 2 }),
      cited('2026-11-21T08:00:00Z', { messageId: 'b', agentId: 'agent-2' }),
    ]);

    const { answers } = await service.citedForClient('user-1', FROM, TO);

    expect(answers).toEqual([
      { agentId: 'agent-2', at: new Date('2026-11-21T08:00:00Z') },
      { agentId: 'agent-1', at: new Date('2026-11-25T09:00:00Z') },
    ]);
  });

  it('names a knowledge base by its name and the web as `web`, most cited first', async () => {
    const { service } = serviceOver([
      cited('2026-11-21T08:00:00Z'),
      cited('2026-11-22T08:00:00Z'),
      cited('2026-11-23T08:00:00Z'),
      cited('2026-11-23T09:00:00Z', {
        knowledgeId: 'k2',
        knowledgeName: 'Handbook',
      }),
      // Two pages of two sites: the web is one source.
      web('2026-11-24T08:00:00Z'),
      web('2026-11-24T09:00:00Z', { url: 'https://other.example/x' }),
    ]);

    const { sources } = await service.citedForClient('user-1', FROM, TO);

    expect(sources).toEqual([
      { name: 'Legal', citations: 3 },
      { name: 'web', citations: 2 },
      { name: 'Handbook', citations: 1 },
    ]);
  });

  it('orders equally cited sources by name, so the answer does not change between two calls', async () => {
    const { service } = serviceOver([
      cited('2026-11-21T08:00:00Z', { knowledgeId: 'k2', knowledgeName: 'B' }),
      cited('2026-11-22T08:00:00Z', { knowledgeId: 'k1', knowledgeName: 'A' }),
    ]);

    const { sources } = await service.citedForClient('user-1', FROM, TO);

    expect(sources.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('counts a base that was renamed in the period once, under the name it was last cited with', async () => {
    const { service } = serviceOver([
      cited('2026-11-21T08:00:00Z', { knowledgeName: 'Legal (old)' }),
      cited('2026-11-22T08:00:00Z', { knowledgeName: 'Legal (old)' }),
      cited('2026-11-25T08:00:00Z', { knowledgeName: 'Legal' }),
    ]);

    const { sources } = await service.citedForClient('user-1', FROM, TO);

    expect(sources).toEqual([{ name: 'Legal', citations: 3 }]);
  });

  it('keeps two bases apart that happen to share a name', async () => {
    const { service } = serviceOver([
      cited('2026-11-21T08:00:00Z', {
        knowledgeId: 'k1',
        knowledgeName: 'FAQ',
      }),
      cited('2026-11-22T08:00:00Z', {
        knowledgeId: 'k2',
        knowledgeName: 'FAQ',
      }),
      cited('2026-11-23T08:00:00Z', {
        knowledgeId: 'k2',
        knowledgeName: 'FAQ',
      }),
    ]);

    const { sources } = await service.citedForClient('user-1', FROM, TO);

    expect(sources).toEqual([
      { name: 'FAQ', citations: 2 },
      { name: 'FAQ', citations: 1 },
    ]);
  });

  it('cannot name a base whose name was never recorded: the answer counts, the source is not listed', async () => {
    const { service } = serviceOver([
      cited('2026-11-21T08:00:00Z', { knowledgeId: 'k9', knowledgeName: null }),
    ]);

    const result = await service.citedForClient('user-1', FROM, TO);

    expect(result.answers).toHaveLength(1);
    expect(result.sources).toEqual([]);
  });

  it('reads that client, that range and those agents only', async () => {
    const { service, gateway } = serviceOver([
      cited('2026-11-21T08:00:00Z'),
      cited('2026-11-19T08:00:00Z'),
      cited('2026-11-22T08:00:00Z', { clientId: 'user-2' }),
      cited('2026-11-23T08:00:00Z', { agentId: 'agent-2' }),
    ]);
    const scope = { in: ['agent-1'] };

    const result = await service.citedForClient('user-1', FROM, TO, scope);

    expect(result.answers).toEqual([
      { agentId: 'agent-1', at: new Date('2026-11-21T08:00:00Z') },
    ]);
    expect(result.sources).toEqual([{ name: 'Legal', citations: 1 }]);
    const range = { clientId: 'user-1', from: FROM, to: TO, agentScope: scope };
    const reads = gateway as unknown as Record<string, jest.Mock>;
    expect(reads.findCitedAnswers).toHaveBeenCalledWith(range);
    expect(reads.countCitationsBySource).toHaveBeenCalledWith(range);
  });

  it('answers empty lists when nothing was cited', async () => {
    const { service } = serviceOver([]);

    expect(await service.citedForClient('user-1', FROM, TO)).toEqual({
      answers: [],
      sources: [],
    });
  });
});

describe('ChatSourceService.firstRecordAt', () => {
  const at = (iso: string): IChatMessageSourceData => ({
    id: iso,
    agentId: 'agent-1',
    clientId: 'user-1',
    sessionKey: 'bridle:user-1',
    messageId: iso,
    n: 1,
    kind: 'web',
    sourceId: null,
    knowledgeId: null,
    knowledgeName: null,
    name: 'Example',
    url: 'https://example.com/page',
    createdAt: new Date(iso),
  });

  it('is when the first source was cited, and null before any was', async () => {
    const filled = makeGateway([
      at('2026-06-02T10:00:00Z'),
      at('2026-03-14T08:30:00Z'),
    ]);
    const empty = makeGateway();
    const serviceOf = (gateway: IChatSourceGateway) =>
      makeService(gateway, makeSources([]), makeKnowledge({}));

    expect(await serviceOf(filled.gateway).firstRecordAt()).toEqual(
      new Date('2026-03-14T08:30:00Z'),
    );
    expect(await serviceOf(empty.gateway).firstRecordAt()).toBeNull();
  });
});
