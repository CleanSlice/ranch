import type { Usage } from '@prisma/client';
import type { PrismaService } from '#/setup/prisma/prisma.service';
import { UsageGateway } from './usage.gateway';
import { UsageMapper } from './usage.mapper';

/**
 * The name an agent had is written with what it spent (CLEAN-261), so the
 * rows can be read by name after the agent is deleted. The fake below has no
 * `agent` table at all: a gateway that went looking for the name itself would
 * fail every case here, which is the point — the name is handed in.
 */
type UpsertArgs = {
  where: { agentId_model_date: { agentId: string; model: string; date: Date } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function harness(records: Usage[] = []) {
  const usage = {
    upsert: jest.fn((args: UpsertArgs) => args),
    findFirst: jest.fn().mockResolvedValue(records[0] ?? null),
    findMany: jest.fn().mockResolvedValue(records),
  };
  const llmCredential = { findMany: jest.fn().mockResolvedValue([]) };
  const $transaction = jest.fn((ops: unknown[]) => Promise.resolve(ops));
  const gateway = new UsageGateway(
    { usage, llmCredential, $transaction } as unknown as PrismaService,
    new UsageMapper(),
  );
  const upserts = () => usage.upsert.mock.calls.map(([args]) => args);
  return { gateway, usage, upserts };
}

function record(p: Partial<Usage> = {}): Usage {
  return {
    id: 'usage-1',
    agentId: 'a1',
    agentName: 'Support Bot',
    llmCredentialId: null,
    model: 'claude-haiku-4-5',
    date: new Date('2026-08-01T00:00:00.000Z'),
    inputTokens: 10,
    outputTokens: 20,
    callCount: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

const twoModels = {
  date: '2026-08-02T13:45:00.000Z',
  byModel: {
    'claude-haiku-4-5': { inputTokens: 1000, outputTokens: 500, callCount: 3 },
    'claude-sonnet-4-6': { inputTokens: 300, outputTokens: 30, callCount: 1 },
  },
};

describe('UsageGateway.report', () => {
  it('stores the name with each row, when the row is new and when it is not', async () => {
    const { gateway, upserts } = harness();

    await gateway.report('a1', twoModels, 'Support Bot');

    expect(upserts()).toHaveLength(2);
    for (const args of upserts()) {
      expect(args.create.agentName).toBe('Support Bot');
      // In `update` as well: that is how a rename reaches a row that is
      // already there.
      expect(args.update.agentName).toBe('Support Bot');
      expect(args.create.agentId).toBe('a1');
    }
    expect(upserts().map((a) => a.where.agentId_model_date.model)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
    ]);
  });

  it('writes the numbers it wrote before the name came with them', async () => {
    const { gateway, upserts } = harness();

    await gateway.report('a1', twoModels, 'Support Bot');

    const [haiku] = upserts();
    expect(haiku.where.agentId_model_date.date).toEqual(
      new Date('2026-08-02T00:00:00.000Z'),
    );
    expect(haiku.create).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      callCount: 3,
      llmCredentialId: null,
    });
    expect(haiku.update).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      callCount: 3,
      llmCredentialId: null,
    });
  });

  it('stores null on a new row when no name is known, and leaves a stored name alone', async () => {
    const { gateway, upserts } = harness();

    await expect(
      gateway.report('a1', twoModels, null),
    ).resolves.toBeUndefined();

    for (const args of upserts()) {
      expect(args.create.agentName).toBeNull();
      // The last report of an agent that is being deleted arrives after its
      // record is gone. It must not wipe the name the earlier ones stored.
      expect('agentName' in args.update).toBe(false);
    }
  });
});

describe('UsageGateway.firstRecordAt', () => {
  it('answers the earliest date there is', async () => {
    const first = record({ date: new Date('2026-03-04T00:00:00.000Z') });
    const { gateway, usage } = harness([first]);

    await expect(gateway.firstRecordAt()).resolves.toEqual(first.date);
    expect(usage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { date: 'asc' } }),
    );
  });

  it('answers null when nothing was ever reported', async () => {
    const { gateway } = harness([]);

    await expect(gateway.firstRecordAt()).resolves.toBeNull();
  });
});

describe('UsageGateway.findRange', () => {
  it('reads from the start of the range up to, not including, its end, in the order findRecentAll uses', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-09-01T00:00:00.000Z');
    const { gateway, usage } = harness([record()]);

    const rows = await gateway.findRange(from, to);

    expect(usage.findMany).toHaveBeenCalledWith({
      where: { date: { gte: from, lt: to } },
      orderBy: [{ date: 'desc' }, { model: 'asc' }],
    });
    expect(rows).toHaveLength(1);

    usage.findMany.mockClear();
    await gateway.findRecentAll(30);
    const [recent] = usage.findMany.mock.calls[0] as [{ orderBy: unknown }];
    expect(recent.orderBy).toEqual([{ date: 'desc' }, { model: 'asc' }]);
  });

  it('hands the stored name back with the row', async () => {
    const { gateway } = harness([
      record({ agentName: 'Support Bot' }),
      record({ id: 'usage-2', agentName: null }),
    ]);

    const rows = await gateway.findRange(new Date(0), new Date());

    expect(rows.map((r) => r.agentName)).toEqual(['Support Bot', null]);
  });
});
