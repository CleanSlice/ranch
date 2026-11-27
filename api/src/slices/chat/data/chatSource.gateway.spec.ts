import { ChatSourceGateway } from './chatSource.gateway';

type Row = Record<string, unknown>;
type AgentScope = { in?: string[]; notIn?: string[] };

interface IRangeWhere {
  clientId: string;
  createdAt: { gte: Date; lte: Date };
  agentId?: AgentScope;
}

interface IGroupByArgs {
  by: string[];
  where: IRangeWhere;
  _count?: { _all: true };
  _min?: { createdAt: true };
  _max?: { createdAt: true };
}

/**
 * `ChatMessageSource` as the period reads ask it (CLEAN-258). The conditions
 * are applied as Postgres applies them, one this fake does not know fails
 * the test instead of matching every row, and rows are grouped as GROUP BY
 * groups them: two NULLs in a grouped column are one group.
 */
function makeStub(rows: Row[]) {
  const matches = (r: Row, where: IRangeWhere) => {
    const unknown = Object.keys(where).filter(
      (k) => !['clientId', 'createdAt', 'agentId'].includes(k),
    );
    if (unknown.length) {
      throw new Error(`the fake cannot answer: ${unknown.join(', ')}`);
    }
    const at = (r.createdAt as Date).getTime();
    const agentId = r.agentId as string;
    const scope = where.agentId;
    return (
      r.clientId === where.clientId &&
      at >= where.createdAt.gte.getTime() &&
      at <= where.createdAt.lte.getTime() &&
      (scope?.in === undefined || scope.in.includes(agentId)) &&
      (scope?.notIn === undefined || !scope.notIn.includes(agentId))
    );
  };

  const chatMessageSource = {
    groupBy: jest.fn(async (args: IGroupByArgs) => {
      const groups = new Map<string, Row[]>();
      for (const r of rows.filter((row) => matches(row, args.where))) {
        const key = JSON.stringify(args.by.map((column) => r[column]));
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((members) => {
        const times = members.map((m) => (m.createdAt as Date).getTime());
        return {
          ...Object.fromEntries(args.by.map((c) => [c, members[0][c]])),
          ...(args._count ? { _count: { _all: members.length } } : {}),
          ...(args._min
            ? { _min: { createdAt: new Date(Math.min(...times)) } }
            : {}),
          ...(args._max
            ? { _max: { createdAt: new Date(Math.max(...times)) } }
            : {}),
        };
      });
    }),
    aggregate: jest.fn(async (_args: { _min: { createdAt: true } }) => ({
      _min: {
        createdAt: rows.length
          ? new Date(
              Math.min(...rows.map((r) => (r.createdAt as Date).getTime())),
            )
          : null,
      },
    })),
  };

  const gateway = new ChatSourceGateway({
    chatMessageSource,
  } as unknown as ConstructorParameters<typeof ChatSourceGateway>[0]);
  return { gateway, chatMessageSource };
}

let seq = 0;
const cited = (iso: string, over: Row = {}): Row => ({
  id: `row-${(seq += 1)}`,
  agentId: 'agent-1',
  clientId: 'user-1',
  messageId: 'm1',
  n: 1,
  kind: 'knowledge',
  knowledgeId: 'k1',
  knowledgeName: 'Legal',
  name: 'Contract.pdf',
  createdAt: new Date(iso),
  ...over,
});

const RANGE = {
  clientId: 'user-1',
  from: new Date('2026-11-20T22:00:00Z'),
  to: new Date('2026-11-27T10:30:00Z'),
};

describe('ChatSourceGateway.findCitedAnswers', () => {
  it('returns one entry per answer that cited something, with its agent and when, oldest first', async () => {
    const { gateway } = makeStub([
      // One answer, three sources: one entry, at its first row.
      cited('2026-11-25T09:00:02Z', { messageId: 'm2', n: 2 }),
      cited('2026-11-25T09:00:01Z', { messageId: 'm2', n: 1 }),
      cited('2026-11-25T09:00:03Z', { messageId: 'm2', n: 3, kind: 'web' }),
      cited('2026-11-21T08:00:00Z', { messageId: 'm1', agentId: 'agent-2' }),
    ]);

    expect(await gateway.findCitedAnswers(RANGE)).toEqual([
      {
        agentId: 'agent-2',
        messageId: 'm1',
        at: new Date('2026-11-21T08:00:00Z'),
      },
      {
        agentId: 'agent-1',
        messageId: 'm2',
        at: new Date('2026-11-25T09:00:01Z'),
      },
    ]);
  });

  it('keeps to that client, the range with both ends, and the agents of the scope', async () => {
    const { gateway } = makeStub([
      cited('2026-11-20T22:00:00Z', { messageId: 'first' }),
      cited('2026-11-27T10:30:00Z', { messageId: 'last' }),
      cited('2026-11-20T21:59:59Z', { messageId: 'early' }),
      cited('2026-11-27T10:30:01Z', { messageId: 'late' }),
      cited('2026-11-25T09:00:00Z', { messageId: 'other', clientId: 'user-2' }),
      cited('2026-11-25T09:00:00Z', { messageId: 'b', agentId: 'agent-2' }),
    ]);

    const ids = async (agentScope?: AgentScope) =>
      (await gateway.findCitedAnswers({ ...RANGE, agentScope })).map(
        (a) => a.messageId,
      );

    expect(await ids()).toEqual(['first', 'b', 'last']);
    expect(await ids({ in: ['agent-2'] })).toEqual(['b']);
    expect(await ids({ notIn: ['agent-2'] })).toEqual(['first', 'last']);
    expect(await ids({ in: [] })).toEqual([]);
  });

  // [clientId, createdAt] is the index: an equality and a range.
  it('asks by client and time alone when there is no list of agents', async () => {
    const { gateway, chatMessageSource } = makeStub([]);

    await gateway.findCitedAnswers(RANGE);

    expect(chatMessageSource.groupBy).toHaveBeenCalledWith({
      by: ['agentId', 'messageId'],
      where: {
        clientId: 'user-1',
        createdAt: { gte: RANGE.from, lte: RANGE.to },
      },
      _min: { createdAt: true },
    });
  });
});

describe('ChatSourceGateway.countCitationsBySource', () => {
  it('counts citations per knowledge base and for the web, with when each was last cited', async () => {
    const { gateway } = makeStub([
      cited('2026-11-21T08:00:00Z'),
      cited('2026-11-25T09:00:00Z', { messageId: 'm2' }),
      cited('2026-11-22T09:00:00Z', {
        messageId: 'm3',
        knowledgeId: 'k2',
        knowledgeName: 'Handbook',
      }),
      cited('2026-11-23T09:00:00Z', {
        messageId: 'm4',
        kind: 'web',
        knowledgeId: null,
        knowledgeName: null,
      }),
      cited('2026-11-24T09:00:00Z', {
        messageId: 'm5',
        kind: 'web',
        knowledgeId: null,
        knowledgeName: null,
      }),
    ]);

    const groups = await gateway.countCitationsBySource(RANGE);

    expect(
      groups.sort((a, b) => a.lastCitedAt.getTime() - b.lastCitedAt.getTime()),
    ).toEqual([
      {
        kind: 'knowledge',
        knowledgeId: 'k2',
        knowledgeName: 'Handbook',
        citations: 1,
        lastCitedAt: new Date('2026-11-22T09:00:00Z'),
      },
      {
        kind: 'web',
        knowledgeId: null,
        knowledgeName: null,
        citations: 2,
        lastCitedAt: new Date('2026-11-24T09:00:00Z'),
      },
      {
        kind: 'knowledge',
        knowledgeId: 'k1',
        knowledgeName: 'Legal',
        citations: 2,
        lastCitedAt: new Date('2026-11-25T09:00:00Z'),
      },
    ]);
  });

  it('keeps to that client, the range and the agents of the scope', async () => {
    const { gateway } = makeStub([
      cited('2026-11-21T08:00:00Z'),
      cited('2026-11-19T08:00:00Z', { messageId: 'early' }),
      cited('2026-11-25T09:00:00Z', { messageId: 'x', clientId: 'user-2' }),
      cited('2026-11-25T09:00:00Z', { messageId: 'b', agentId: 'agent-2' }),
    ]);

    const total = async (agentScope?: AgentScope) =>
      (await gateway.countCitationsBySource({ ...RANGE, agentScope })).reduce(
        (sum, g) => sum + g.citations,
        0,
      );

    expect(await total()).toBe(2);
    expect(await total({ in: ['agent-2'] })).toBe(1);
    expect(await total({ notIn: ['agent-2'] })).toBe(1);
    expect(await total({ in: [] })).toBe(0);
  });
});

describe('ChatSourceGateway.firstCreatedAt', () => {
  it('is the time of the earliest citation there is', async () => {
    const { gateway } = makeStub([
      cited('2026-06-02T10:00:00Z'),
      cited('2026-03-14T08:30:00Z', { messageId: 'm0' }),
    ]);

    expect(await gateway.firstCreatedAt()).toEqual(
      new Date('2026-03-14T08:30:00Z'),
    );
  });

  it('is null while nothing was ever cited', async () => {
    const { gateway } = makeStub([]);

    expect(await gateway.firstCreatedAt()).toBeNull();
  });
});
