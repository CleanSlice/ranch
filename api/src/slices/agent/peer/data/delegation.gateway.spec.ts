import { DelegationGateway } from './delegation.gateway';
import { DelegationMapper } from './delegation.mapper';
import { DelegationErrorCodes, DelegationStatuses } from '../domain';

// In-memory Prisma stub in the shape of peer.gateway.spec's.
function makePrismaStub() {
  const rows: Record<string, Record<string, any>> = {};
  let seq = 0;

  const agentDelegation = {
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const id = `del-${(seq += 1)}`;
      rows[id] = {
        id,
        peerId: null,
        turnId: null,
        clientId: null,
        matchedSkills: [],
        status: 'waiting',
        errorCode: null,
        excerpt: null,
        startedAt: new Date(1_000_000 + seq * 1000),
        finishedAt: null,
        durationMs: null,
        ...data,
      };
      return rows[id];
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, any>;
      }) => {
        const row = rows[where.id];
        if (!row) {
          throw Object.assign(new Error('Record to update not found'), {
            code: 'P2025',
          });
        }
        Object.assign(row, data);
        return row;
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, any>;
        orderBy?: Record<string, any>;
        take?: number;
      }) => {
        let matches = Object.values(rows).filter(
          (r) => r.agentId === where.agentId,
        );
        if (orderBy?.startedAt === 'desc') {
          matches = matches.sort(
            (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
          );
        }
        return typeof take === 'number' ? matches.slice(0, take) : matches;
      },
    ),
  };

  return { agentDelegation, rows };
}

function makeGateway() {
  const prisma = makePrismaStub();
  const gateway = new DelegationGateway(
    prisma as never,
    new DelegationMapper(),
  );
  const start = (agentId = 'a', peerName = 'Support Bot') =>
    gateway.create({
      agentId,
      peerId: 'peer-1',
      peerAgentId: 'b',
      peerName,
      contextId: 'ctx-1',
      turnId: 'turn-1',
      clientId: 'admin',
      task: 'What is the return window for shoes?',
      reason: 'Support Bot holds the returns policy base',
      matchedSkills: [{ id: 'knowledge:9a', name: 'Returns policy' }],
    });
  return { gateway, prisma, start };
}

describe('DelegationGateway', () => {
  it('opens a delegation in the waiting state with nothing decided yet', async () => {
    const { start } = makeGateway();

    const row = await start();

    expect(row).toMatchObject({
      status: DelegationStatuses.Waiting,
      errorCode: null,
      excerpt: null,
      finishedAt: null,
      durationMs: null,
      peerName: 'Support Bot',
      matchedSkills: [{ id: 'knowledge:9a', name: 'Returns policy' }],
    });
  });

  it('records an answer with its duration', async () => {
    const { gateway, start } = makeGateway();
    const row = await start();

    const finished = await gateway.finish(row.id, {
      status: DelegationStatuses.Answered,
      excerpt: 'Shoes can be returned within 30 days',
      finishedAt: new Date('2026-09-14T10:00:03.120Z'),
      durationMs: 3120,
    });

    expect(finished).toMatchObject({
      status: 'answered',
      errorCode: null,
      excerpt: 'Shoes can be returned within 30 days',
      finishedAt: '2026-09-14T10:00:03.120Z',
      durationMs: 3120,
    });
  });

  it('records a failure with the cause that produced it', async () => {
    const { gateway, start } = makeGateway();
    const row = await start();

    const finished = await gateway.finish(row.id, {
      status: DelegationStatuses.Failed,
      errorCode: DelegationErrorCodes.NotRunning,
      excerpt: 'peer not running',
      finishedAt: new Date('2026-09-14T10:00:00.200Z'),
      durationMs: 200,
    });

    expect(finished).toMatchObject({
      status: 'failed',
      errorCode: 'PEER_NOT_RUNNING',
      excerpt: 'peer not running',
    });
  });

  it('lists an agent delegations newest first', async () => {
    const { gateway, start } = makeGateway();
    await start('a', 'first');
    await start('a', 'second');
    await start('a', 'third');

    const recent = await gateway.listRecent('a', 10);

    expect(recent.map((d) => d.peerName)).toEqual(['third', 'second', 'first']);
  });

  it('honours the limit it is given', async () => {
    const { gateway, start } = makeGateway();
    await start('a', 'first');
    await start('a', 'second');
    await start('a', 'third');

    await expect(gateway.listRecent('a', 2)).resolves.toHaveLength(2);
  });

  it('keeps one agent delegations out of another list', async () => {
    const { gateway, start } = makeGateway();
    await start('a');
    await start('other');

    await expect(gateway.listRecent('a', 10)).resolves.toHaveLength(1);
  });

  it('reads a hand-edited skills column as no skills rather than breaking', async () => {
    const { gateway, prisma, start } = makeGateway();
    const row = await start();
    prisma.rows[row.id].matchedSkills = 'not an array';

    const [listed] = await gateway.listRecent('a', 10);

    expect(listed.matchedSkills).toEqual([]);
  });
});

// ── Hand-overs made while answering one person (CLEAN-258) ────

type Row = Record<string, unknown>;
type AgentScope = { in?: string[]; notIn?: string[] };

interface ICountWhere {
  clientId: string;
  startedAt: { gte: Date; lte: Date };
  agentId?: AgentScope;
}

/**
 * `AgentDelegation` as the period read asks it. Conditions are applied as
 * Postgres applies them: `clientId` can be NULL and a NULL equals nothing,
 * so a hand-over made for nobody is nobody's. A condition the fake does not
 * know fails the test, and rows are grouped as GROUP BY groups them (two
 * NULLs in a grouped column are one group).
 */
function makeCountStub(rows: Row[]) {
  const matches = (r: Row, where: ICountWhere) => {
    const unknown = Object.keys(where).filter(
      (k) => !['clientId', 'startedAt', 'agentId'].includes(k),
    );
    if (unknown.length) {
      throw new Error(`the fake cannot answer: ${unknown.join(', ')}`);
    }
    const at = (r.startedAt as Date).getTime();
    const agentId = r.agentId as string;
    const scope = where.agentId;
    return (
      r.clientId !== null &&
      r.clientId === where.clientId &&
      at >= where.startedAt.gte.getTime() &&
      at <= where.startedAt.lte.getTime() &&
      (scope?.in === undefined || scope.in.includes(agentId)) &&
      (scope?.notIn === undefined || !scope.notIn.includes(agentId))
    );
  };

  const agentDelegation = {
    groupBy: jest.fn(
      async (args: {
        by: string[];
        where: ICountWhere;
        _count: { _all: true };
        _max: { startedAt: true };
      }) => {
        const groups = new Map<string, Row[]>();
        for (const r of rows.filter((row) => matches(row, args.where))) {
          const key = JSON.stringify(args.by.map((column) => r[column]));
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        return [...groups.values()].map((members) => ({
          ...Object.fromEntries(args.by.map((c) => [c, members[0][c]])),
          _count: { _all: members.length },
          _max: {
            startedAt: new Date(
              Math.max(...members.map((m) => (m.startedAt as Date).getTime())),
            ),
          },
        }));
      },
    ),
    aggregate: jest.fn(async (_args: { _min: { startedAt: true } }) => ({
      _min: {
        startedAt: rows.length
          ? new Date(
              Math.min(...rows.map((r) => (r.startedAt as Date).getTime())),
            )
          : null,
      },
    })),
  };

  const gateway = new DelegationGateway(
    { agentDelegation } as never,
    new DelegationMapper(),
  );
  return { gateway, agentDelegation };
}

describe('DelegationGateway.countForClient', () => {
  const FROM = new Date('2026-11-20T22:00:00Z');
  const TO = new Date('2026-11-27T10:30:00Z');

  const handover = (iso: string, over: Row = {}): Row => ({
    agentId: 'agent-1',
    clientId: 'user-1',
    peerAgentId: 'agent-b',
    peerName: 'Billing',
    status: DelegationStatuses.Answered,
    startedAt: new Date(iso),
    ...over,
  });

  it('counts every hand-over and, apart, the ones that were answered', async () => {
    const { gateway } = makeCountStub([
      handover('2026-11-21T08:00:00Z'),
      handover('2026-11-22T08:00:00Z'),
      handover('2026-11-23T08:00:00Z', { status: DelegationStatuses.Failed }),
      handover('2026-11-24T08:00:00Z', { status: DelegationStatuses.Rejected }),
      // Still in flight: asked, not answered.
      handover('2026-11-27T10:29:00Z', { status: DelegationStatuses.Waiting }),
    ]);

    const counts = await gateway.countForClient('user-1', FROM, TO);

    expect(counts.total).toBe(5);
    expect(counts.answered).toBe(2);
  });

  it('lists the peers that were asked, most asked first and equal ones by name', async () => {
    const { gateway } = makeCountStub([
      handover('2026-11-21T08:00:00Z'),
      handover('2026-11-22T08:00:00Z', { status: DelegationStatuses.Failed }),
      handover('2026-11-23T08:00:00Z', {
        peerAgentId: 'agent-c',
        peerName: 'Research',
      }),
      // An agent outside this Ranch has no id here; its name is its key.
      handover('2026-11-24T08:00:00Z', {
        peerAgentId: null,
        peerName: 'Acme Legal',
      }),
    ]);

    const { peers } = await gateway.countForClient('user-1', FROM, TO);

    expect(peers).toEqual([
      { peerAgentId: 'agent-b', name: 'Billing', count: 2 },
      { peerAgentId: null, name: 'Acme Legal', count: 1 },
      { peerAgentId: 'agent-c', name: 'Research', count: 1 },
    ]);
  });

  it('counts a peer that was renamed in the period once, under its latest name', async () => {
    const { gateway } = makeCountStub([
      handover('2026-11-21T08:00:00Z', { peerName: 'Billing (old)' }),
      handover('2026-11-22T08:00:00Z', { peerName: 'Billing (old)' }),
      handover('2026-11-25T08:00:00Z', { peerName: 'Billing' }),
    ]);

    const { peers } = await gateway.countForClient('user-1', FROM, TO);

    expect(peers).toEqual([
      { peerAgentId: 'agent-b', name: 'Billing', count: 3 },
    ]);
  });

  it('keeps to that client and to the range, both ends included', async () => {
    const { gateway } = makeCountStub([
      handover('2026-11-20T22:00:00Z'),
      handover('2026-11-27T10:30:00Z'),
      handover('2026-11-20T21:59:59Z'),
      handover('2026-11-27T10:30:01Z'),
      handover('2026-11-25T08:00:00Z', { clientId: 'user-2' }),
      // Made in a turn that had no chat client: nobody's.
      handover('2026-11-25T08:00:00Z', { clientId: null }),
    ]);

    expect((await gateway.countForClient('user-1', FROM, TO)).total).toBe(2);
  });

  it('keeps to hand-overs made by agents inside the scope', async () => {
    const { gateway } = makeCountStub([
      handover('2026-11-21T08:00:00Z', { agentId: 'agent-1' }),
      handover('2026-11-22T08:00:00Z', { agentId: 'agent-2' }),
      handover('2026-11-23T08:00:00Z', { agentId: 'agent-2' }),
    ]);

    const total = async (scope: AgentScope) =>
      (await gateway.countForClient('user-1', FROM, TO, scope)).total;

    expect(await total({ in: ['agent-1'] })).toBe(1);
    expect(await total({ notIn: ['agent-1'] })).toBe(2);
    expect(await total({ in: [] })).toBe(0);
  });

  it('answers zeros and no peer when nothing was handed over', async () => {
    const { gateway } = makeCountStub([]);

    expect(await gateway.countForClient('user-1', FROM, TO)).toEqual({
      total: 0,
      answered: 0,
      peers: [],
    });
  });

  // [clientId, startedAt] is the index: an equality and a range.
  it('asks by client and time alone when there is no list of agents', async () => {
    const { gateway, agentDelegation } = makeCountStub([]);

    await gateway.countForClient('user-1', FROM, TO);

    expect(agentDelegation.groupBy).toHaveBeenCalledWith({
      by: ['peerAgentId', 'peerName', 'status'],
      where: { clientId: 'user-1', startedAt: { gte: FROM, lte: TO } },
      _count: { _all: true },
      _max: { startedAt: true },
    });
  });
});

describe('DelegationGateway.firstRecordAt', () => {
  it('is when the first hand-over started, and null before any did', async () => {
    const filled = makeCountStub([
      { startedAt: new Date('2026-09-14T10:00:00Z') },
      { startedAt: new Date('2026-09-02T07:00:00Z') },
    ]);
    const empty = makeCountStub([]);

    expect(await filled.gateway.firstRecordAt()).toEqual(
      new Date('2026-09-02T07:00:00Z'),
    );
    expect(await empty.gateway.firstRecordAt()).toBeNull();
  });
});
