import type { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentLoadMinute } from '../domain';
import { AgentLimitGateway } from './agentLimit.gateway';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const D0 = Date.UTC(2027, 0, 15);

const minute = (
  at: number,
  counts: Partial<IAgentLoadMinute> = {},
): IAgentLoadMinute => ({
  minute: at,
  accepted: 0,
  refused: 0,
  refusedByMinute: 0,
  refusedByHour: 0,
  refusedByDay: 0,
  exempt: 0,
  ...counts,
});

/**
 * The queries the day rows are written and read with (CLEAN-261). What the
 * rows then hold is covered over an in-memory database in
 * agentLimit.service.spec.ts; here it is the shape of each call.
 */
function harness() {
  const agentLoadMinute = {
    // The real client returns a query that runs inside $transaction; a tag is
    // enough to see which queries the transaction was given.
    upsert: jest.fn((args: unknown) => ({ table: 'minute', args })),
    groupBy: jest.fn().mockResolvedValue([]),
  };
  const agentLoadDay = {
    upsert: jest.fn((args: unknown) => ({ table: 'day', args })),
    createMany: jest.fn((args: { data: unknown[] }) =>
      Promise.resolve({ count: args.data.length }),
    ),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const $transaction = jest.fn().mockResolvedValue([]);
  const gateway = new AgentLimitGateway({
    agentLoadMinute,
    agentLoadDay,
    $transaction,
  } as unknown as PrismaService);
  return { gateway, agentLoadMinute, agentLoadDay, $transaction };
}

describe('AgentLimitGateway', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('addMinutes', () => {
    it('writes the minutes and their days in one transaction', async () => {
      const { gateway, agentLoadMinute, agentLoadDay, $transaction } =
        harness();
      await gateway.addMinutes('a', [
        minute(D0 + 10 * MIN, { accepted: 2, exempt: 1 }),
        minute(D0 + 11 * MIN, { accepted: 3, refused: 4, refusedByHour: 4 }),
      ]);

      expect($transaction).toHaveBeenCalledTimes(1);
      expect($transaction).toHaveBeenCalledWith([
        expect.objectContaining({ table: 'minute' }),
        expect.objectContaining({ table: 'minute' }),
        expect.objectContaining({ table: 'day' }),
      ]);
      expect(agentLoadMinute.upsert).toHaveBeenCalledTimes(2);
      expect(agentLoadDay.upsert).toHaveBeenCalledTimes(1);
      expect(agentLoadDay.upsert).toHaveBeenCalledWith({
        where: { agentId_day: { agentId: 'a', day: new Date(D0) } },
        create: {
          agentId: 'a',
          day: new Date(D0),
          accepted: 5,
          refused: 4,
          exempt: 1,
        },
        update: {
          accepted: { increment: 5 },
          refused: { increment: 4 },
          exempt: { increment: 1 },
        },
      });
    });

    it('writes one day row per UTC day of the batch', async () => {
      const { gateway, agentLoadDay } = harness();
      await gateway.addMinutes('a', [
        minute(D0 + DAY - MIN, { accepted: 1 }),
        minute(D0 + DAY, { accepted: 1 }),
      ]);
      expect(
        agentLoadDay.upsert.mock.calls.map(([args]) =>
          (args as { create: { day: Date } }).create.day.toISOString(),
        ),
      ).toEqual(['2027-01-15T00:00:00.000Z', '2027-01-16T00:00:00.000Z']);
    });

    it('opens no transaction for an empty batch', async () => {
      const { gateway, $transaction } = harness();
      await gateway.addMinutes('a', []);
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('rebuildMissingDays', () => {
    it('sums each day from the given one to today and never overwrites a row', async () => {
      const { gateway, agentLoadMinute, agentLoadDay } = harness();
      jest.useFakeTimers({ now: D0 + 8 * 60 * MIN });
      agentLoadMinute.groupBy
        // Two days back: two agents had traffic.
        .mockResolvedValueOnce([
          { agentId: 'a', _sum: { accepted: 5, refused: 1, exempt: 0 } },
          { agentId: 'b', _sum: { accepted: 2, refused: 0, exempt: 3 } },
        ])
        // Yesterday: nobody.
        .mockResolvedValueOnce([])
        // Today so far.
        .mockResolvedValueOnce([
          { agentId: 'a', _sum: { accepted: 1, refused: 0, exempt: 0 } },
        ]);

      const written = await gateway.rebuildMissingDays(new Date(D0 - 2 * DAY));

      expect(agentLoadMinute.groupBy.mock.calls.map(([args]) => args)).toEqual(
        [D0 - 2 * DAY, D0 - DAY, D0].map((day) => ({
          by: ['agentId'],
          where: {
            minute: { gte: new Date(day), lt: new Date(day + DAY) },
          },
          _sum: { accepted: true, refused: true, exempt: true },
        })),
      );
      expect(agentLoadDay.createMany.mock.calls.map(([args]) => args)).toEqual([
        {
          data: [
            {
              agentId: 'a',
              day: new Date(D0 - 2 * DAY),
              accepted: 5,
              refused: 1,
              exempt: 0,
            },
            {
              agentId: 'b',
              day: new Date(D0 - 2 * DAY),
              accepted: 2,
              refused: 0,
              exempt: 3,
            },
          ],
          skipDuplicates: true,
        },
        {
          data: [
            {
              agentId: 'a',
              day: new Date(D0),
              accepted: 1,
              refused: 0,
              exempt: 0,
            },
          ],
          skipDuplicates: true,
        },
      ]);
      expect(written).toBe(3);
    });

    it('reports only the rows the table took', async () => {
      const { gateway, agentLoadMinute, agentLoadDay } = harness();
      jest.useFakeTimers({ now: D0 });
      agentLoadMinute.groupBy.mockResolvedValueOnce([
        { agentId: 'a', _sum: { accepted: 5, refused: 1, exempt: 0 } },
      ]);
      // The row was already there: the database skipped it.
      agentLoadDay.createMany.mockResolvedValueOnce({ count: 0 });
      expect(await gateway.rebuildMissingDays(new Date(D0))).toBe(0);
    });

    it('reads an instant inside a day as that day', async () => {
      const { gateway, agentLoadMinute } = harness();
      jest.useFakeTimers({ now: D0 + 8 * 60 * MIN });
      await gateway.rebuildMissingDays(new Date(D0 - DAY + 5 * 60 * MIN));
      expect(agentLoadMinute.groupBy).toHaveBeenCalledTimes(2);
      expect(agentLoadMinute.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { minute: { gte: new Date(D0 - DAY), lt: new Date(D0) } },
        }),
      );
    });
  });

  describe('pruneDaysBefore', () => {
    it('deletes the days that start before the date, for every agent', async () => {
      const { gateway, agentLoadDay } = harness();
      await gateway.pruneDaysBefore(new Date(D0 - 400 * DAY));
      expect(agentLoadDay.deleteMany).toHaveBeenCalledWith({
        where: { day: { lt: new Date(D0 - 400 * DAY) } },
      });
    });
  });

  describe('findDays', () => {
    it('reads the days of these agents from `from` up to, not including, `to`', async () => {
      const { gateway, agentLoadDay } = harness();
      agentLoadDay.findMany.mockResolvedValueOnce([
        {
          agentId: 'a',
          day: new Date(D0 - DAY),
          accepted: 9,
          refused: 2,
          exempt: 1,
        },
      ]);

      const days = await gateway.findDays(
        ['a', 'b'],
        new Date(D0 - 7 * DAY),
        new Date(D0),
      );

      expect(agentLoadDay.findMany).toHaveBeenCalledWith({
        where: {
          agentId: { in: ['a', 'b'] },
          day: { gte: new Date(D0 - 7 * DAY), lt: new Date(D0) },
        },
        orderBy: [{ day: 'asc' }, { agentId: 'asc' }],
      });
      expect(days).toEqual([
        {
          agentId: 'a',
          day: new Date(D0 - DAY),
          accepted: 9,
          refused: 2,
          exempt: 1,
        },
      ]);
    });

    it('asks nothing for no agents', async () => {
      const { gateway, agentLoadDay } = harness();
      expect(await gateway.findDays([], new Date(0), new Date(D0))).toEqual([]);
      expect(agentLoadDay.findMany).not.toHaveBeenCalled();
    });
  });

  describe('firstDayAt', () => {
    it('is the earliest day on record', async () => {
      const { gateway, agentLoadDay } = harness();
      agentLoadDay.findFirst.mockResolvedValueOnce({
        day: new Date(D0 - 12 * DAY),
      });
      expect(await gateway.firstDayAt()).toEqual(new Date(D0 - 12 * DAY));
      expect(agentLoadDay.findFirst).toHaveBeenCalledWith({
        orderBy: { day: 'asc' },
        select: { day: true },
      });
    });

    it('is null while there are no days', async () => {
      const { gateway } = harness();
      expect(await gateway.firstDayAt()).toBeNull();
    });
  });
});
