import { AgentEventGateway } from './agentEvent.gateway';
import { AgentEventMapper } from './agentEvent.mapper';

type Row = Record<string, unknown>;

/**
 * The incidents of a period, as the installation's statistics read them
 * (CLEAN-265). The table is a list here and each condition is applied the
 * way Postgres applies it. Two things matter for that:
 *
 *  - `agentId` is NULL once the agent is deleted, and NULL is neither in a
 *    list nor outside one: such an incident matches no agent condition at
 *    all, `notIn` included;
 *  - a condition this fake does not know fails the test. It never matches
 *    everything.
 */

type AgentScope = { in?: string[]; notIn?: string[] };
type Dates = { gte?: Date; lte?: Date };

interface IWhere {
  agentId?: AgentScope;
  openedAt?: Dates;
  openKey?: { not: null };
  OR?: IWhere[];
}

const onlyKnown = (where: Row, known: string[]) => {
  const unknown = Object.keys(where).filter((k) => !known.includes(k));
  if (unknown.length) {
    throw new Error(`the fake cannot answer: ${unknown.join(', ')}`);
  }
};

function matches(row: Row, where: IWhere): boolean {
  onlyKnown(where as Row, ['agentId', 'openedAt', 'openKey', 'OR']);
  if (where.agentId) {
    onlyKnown(where.agentId, ['in', 'notIn']);
    const agentId = row.agentId as string | null;
    // NULL IN (…) and NULL NOT IN (…) are both not true.
    if (agentId === null) return false;
    if (where.agentId.in && !where.agentId.in.includes(agentId)) return false;
    if (where.agentId.notIn?.includes(agentId)) return false;
  }
  if (where.openedAt) {
    onlyKnown(where.openedAt, ['gte', 'lte']);
    const at = (row.openedAt as Date).getTime();
    if (where.openedAt.gte && at < where.openedAt.gte.getTime()) return false;
    if (where.openedAt.lte && at > where.openedAt.lte.getTime()) return false;
  }
  if (where.openKey) {
    if (where.openKey.not !== null) throw new Error('openKey: only not null');
    if (row.openKey === null) return false;
  }
  if (where.OR && !where.OR.some((either) => matches(row, either))) {
    return false;
  }
  return true;
}

function makeStub(rows: Row[]) {
  const findMany = jest.fn(
    async ({
      where,
      orderBy,
      take,
    }: {
      where: IWhere;
      orderBy: Record<string, 'desc'>[];
      take: number;
    }) => {
      if (JSON.stringify(orderBy) !== '[{"openedAt":"desc"},{"id":"desc"}]') {
        throw new Error(`ordered by ${JSON.stringify(orderBy)}`);
      }
      return rows
        .filter((row) => matches(row, where))
        .sort(
          (a, b) =>
            (b.openedAt as Date).getTime() - (a.openedAt as Date).getTime() ||
            (b.id as string).localeCompare(a.id as string),
        )
        .slice(0, take);
    },
  );
  const count = jest.fn(
    async ({ where }: { where: IWhere }) =>
      rows.filter((row) => matches(row, where)).length,
  );
  const prisma = { agentIncident: { findMany, count } };
  const gateway = new AgentEventGateway(
    prisma as unknown as ConstructorParameters<typeof AgentEventGateway>[0],
    new AgentEventMapper(),
  );
  return { gateway, findMany, count };
}

let serial = 0;

/** An incident row. Open unless `closedAt` is given. */
const incident = (
  id: string,
  agentId: string | null,
  openedAt: string,
  closedAt: string | null = null,
): Row => ({
  id,
  number: (serial += 1),
  agentId,
  agentName: `name-of-${id}`,
  // The agent's id while open, NULL once closed, whatever became of the
  // agent: that is what "open" is read from.
  openKey: closedAt === null ? `open-${id}` : null,
  status: 'failed',
  reason: `reason-of-${id}`,
  transport: null,
  slackChannel: null,
  slackTs: null,
  slackReaction: null,
  notificationSeq: 1,
  lastJoinedNotifiedAt: null,
  rootStale: false,
  ranchWitnessed: true,
  eventCount: 1,
  witnesses: ['Ranch'],
  openedAt: new Date(openedAt),
  lastFailureAt: new Date(openedAt),
  upSince: null,
  closedAt: closedAt === null ? null : new Date(closedAt),
  resolution: closedAt === null ? null : 'recovered',
});

const FROM = new Date('2026-11-21T00:00:00.000Z');
const TO = new Date('2026-11-27T10:30:00.000Z');

const idsOf = (range: { items: { id: string }[] }) =>
  range.items.map((i) => i.id);

describe('AgentEventGateway.findIncidentsInRange', () => {
  it('returns the incidents opened in the range, both ends included, newest first', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-21T00:00:00Z', '2026-11-21T01:00:00Z'),
      incident('i2', 'a2', '2026-11-25T09:00:00Z', '2026-11-25T09:30:00Z'),
      incident('i3', 'a1', '2026-11-27T10:30:00Z'),
      // A moment before the range, closed since: not this period's.
      incident('i0', 'a1', '2026-11-20T23:59:59Z', '2026-11-22T08:00:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      limit: 50,
    });

    expect(idsOf(range)).toEqual(['i3', 'i2', 'i1']);
    expect(range.total).toBe(3);
  });

  it('keeps an incident that opened before the range and is still open', async () => {
    const { gateway } = makeStub([
      incident('old-open', 'a1', '2026-09-01T08:00:00Z'),
      incident(
        'old-shut',
        'a1',
        '2026-09-02T08:00:00Z',
        '2026-09-02T09:00:00Z',
      ),
      incident('recent', 'a2', '2026-11-25T09:00:00Z', '2026-11-25T09:30:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      limit: 50,
    });

    expect(idsOf(range)).toEqual(['recent', 'old-open']);
    expect(range.items.map((i) => i.open)).toEqual([false, true]);
  });

  // The range ends at the moment the view is computed. An incident opened
  // after it belongs to the next view, open or not.
  it('leaves out an incident opened after the range, open or closed', async () => {
    const { gateway } = makeStub([
      incident('later-open', 'a1', '2026-11-27T10:30:01Z'),
      incident('later', 'a1', '2026-11-27T11:00:00Z', '2026-11-27T11:10:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      limit: 50,
    });

    expect(range).toEqual({ items: [], total: 0 });
  });

  it('caps the list and still says how many there are', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-22T09:00:00Z', '2026-11-22T09:30:00Z'),
      incident('i2', 'a1', '2026-11-23T09:00:00Z', '2026-11-23T09:30:00Z'),
      incident('i3', 'a1', '2026-11-24T09:00:00Z', '2026-11-24T09:30:00Z'),
      incident('i4', 'a1', '2026-11-25T09:00:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      limit: 2,
    });

    expect(idsOf(range)).toEqual(['i4', 'i3']);
    expect(range.total).toBe(4);
  });

  it('keeps a limited caller to the incidents of their agents, total included', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-22T09:00:00Z'),
      incident('i2', 'a2', '2026-11-23T09:00:00Z'),
      incident('i3', 'a3', '2026-11-24T09:00:00Z'),
      // Still open before the range, with an agent outside the list: the
      // "still open" half must not let it past the agents.
      incident('i4', 'a3', '2026-09-01T09:00:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      agentScope: { in: ['a1', 'a2'] },
      limit: 50,
    });

    expect(idsOf(range)).toEqual(['i2', 'i1']);
    expect(range.total).toBe(2);
  });

  it('leaves out the denied agents of a caller who is not limited', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-22T09:00:00Z'),
      incident('i3', 'a3', '2026-11-24T09:00:00Z'),
    ]);

    const range = await gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      agentScope: { notIn: ['a3'] },
      limit: 50,
    });

    expect(idsOf(range)).toEqual(['i1']);
    expect(range.total).toBe(1);
  });

  // The incident list of the console does the same (`IAgentIdScope`): an
  // incident whose agent was deleted names no agent, so no list can say the
  // caller reaches it. Only a caller nothing is hidden from sees it.
  it('shows an incident of a deleted agent to a caller with no lists, and to nobody else', async () => {
    const rows = [
      incident('gone', null, '2026-11-24T09:00:00Z', '2026-11-24T10:00:00Z'),
      incident('i1', 'a1', '2026-11-22T09:00:00Z'),
    ];

    const whole = await makeStub(rows).gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      limit: 50,
    });
    expect(idsOf(whole)).toEqual(['gone', 'i1']);

    const limited = await makeStub(rows).gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      agentScope: { in: ['a1'] },
      limit: 50,
    });
    expect(idsOf(limited)).toEqual(['i1']);

    const excluding = await makeStub(rows).gateway.findIncidentsInRange({
      from: FROM,
      to: TO,
      agentScope: { notIn: ['a9'] },
      limit: 50,
    });
    expect(idsOf(excluding)).toEqual(['i1']);
    expect(excluding.total).toBe(1);
  });

  it('answers nothing for a caller who reaches no agent', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-22T09:00:00Z'),
    ]);

    expect(
      await gateway.findIncidentsInRange({
        from: FROM,
        to: TO,
        agentScope: { in: [] },
        limit: 50,
      }),
    ).toEqual({ items: [], total: 0 });
  });

  it('counts with the condition it lists with, and names no agent when there is no list', async () => {
    const { gateway, findMany, count } = makeStub([]);

    await gateway.findIncidentsInRange({ from: FROM, to: TO, limit: 50 });

    const where = {
      openedAt: { lte: TO },
      OR: [{ openedAt: { gte: FROM } }, { openKey: { not: null } }],
    };
    expect(findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('answers the incident as the slice knows it: state, cause and times', async () => {
    const { gateway } = makeStub([
      incident('i1', 'a1', '2026-11-22T09:00:00Z', '2026-11-22T09:30:00Z'),
    ]);

    const [only] = (
      await gateway.findIncidentsInRange({ from: FROM, to: TO, limit: 50 })
    ).items;

    expect(only).toMatchObject({
      id: 'i1',
      agentId: 'a1',
      agentName: 'name-of-i1',
      open: false,
      reason: 'reason-of-i1',
      openedAt: new Date('2026-11-22T09:00:00Z'),
      closedAt: new Date('2026-11-22T09:30:00Z'),
    });
  });
});
