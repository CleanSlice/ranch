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
