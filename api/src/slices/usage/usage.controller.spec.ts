import { UsageController } from './usage.controller';
import { IUsageGateway } from './domain';
import { costUsd } from './domain/model-pricing';
import { IUsageData } from './domain/usage.types';
import { IFileGateway } from '#/agent/file/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ILlmGateway } from '#/llm/domain';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

const DAY_1 = new Date('2026-08-01T00:00:00.000Z');
const DAY_2 = new Date('2026-08-02T00:00:00.000Z');

function row(
  p: Partial<IUsageData> & {
    agentId: string;
    model: string;
    date: Date;
  },
): IUsageData {
  return {
    id: `${p.agentId}|${p.model}|${p.date.toISOString()}`,
    llmCredentialId: null,
    inputTokens: 0,
    outputTokens: 0,
    callCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

function makeController(
  rows: IUsageData[],
  agentNames: Record<string, string> = {},
) {
  const findRecentAll = jest.fn(async () => rows);
  const gateway = { findRecentAll } as unknown as IUsageGateway;
  const fileGateway = {
    read: jest.fn(async () => {
      throw Object.assign(new Error('no file'), { status: 404 });
    }),
  } as unknown as IFileGateway;
  const findById = jest.fn(async (id: string) => {
    const name = agentNames[id];
    if (!name) throw new Error('agent not found');
    return { id, name };
  });
  const agentGateway = { findById } as unknown as IAgentGateway;
  const llmGateway = {} as ILlmGateway;
  const controller = new UsageController(
    gateway,
    fileGateway,
    agentGateway,
    llmGateway,
  );
  return { controller, findRecentAll, findById };
}

describe('UsageController.findOverview', () => {
  it('aggregates multi-agent rows to date|model grain with totals matching the entries', async () => {
    // Two agents on the same model+day must merge into ONE daily entry;
    // a second model and a second day stay separate.
    const rows = [
      row({
        agentId: 'a1',
        model: HAIKU,
        date: DAY_2,
        inputTokens: 1000,
        outputTokens: 500,
        callCount: 3,
      }),
      row({
        agentId: 'a2',
        model: HAIKU,
        date: DAY_2,
        inputTokens: 2000,
        outputTokens: 100,
        callCount: 2,
      }),
      row({
        agentId: 'a1',
        model: SONNET,
        date: DAY_2,
        inputTokens: 300,
        outputTokens: 30,
        callCount: 1,
      }),
      row({
        agentId: 'a2',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 50,
        outputTokens: 5,
        callCount: 1,
      }),
    ];
    const { controller } = makeController(rows, { a1: 'One', a2: 'Two' });

    const res = await controller.findOverview();

    expect(res.last30days).toHaveLength(3);
    // Newest first.
    expect(res.last30days.map((e) => e.date)).toEqual([
      '2026-08-02',
      '2026-08-02',
      '2026-08-01',
    ]);

    const merged = res.last30days.find(
      (e) => e.date === '2026-08-02' && e.model === HAIKU,
    );
    expect(merged).toMatchObject({
      inputTokens: 3000,
      outputTokens: 600,
      callCount: 5,
    });
    expect(merged?.costUsd).toBeCloseTo(
      costUsd(HAIKU, 1000, 500) + costUsd(HAIKU, 2000, 100),
      10,
    );

    // Invariant: totals equal the sum of the returned entries.
    const sum = res.last30days.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.inputTokens,
        outputTokens: acc.outputTokens + e.outputTokens,
        callCount: acc.callCount + e.callCount,
        costUsd: acc.costUsd + e.costUsd,
      }),
      { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
    );
    expect(res.totals.inputTokens).toBe(sum.inputTokens);
    expect(res.totals.outputTokens).toBe(sum.outputTokens);
    expect(res.totals.callCount).toBe(sum.callCount);
    expect(res.totals.costUsd).toBeCloseTo(sum.costUsd, 10);
  });

  it('picks the model with the most tokens as topModel', async () => {
    const rows = [
      row({
        agentId: 'a1',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 100,
        outputTokens: 10,
        callCount: 1,
      }),
      row({
        agentId: 'a1',
        model: SONNET,
        date: DAY_1,
        inputTokens: 5000,
        outputTokens: 500,
        callCount: 1,
      }),
    ];
    const { controller } = makeController(rows, { a1: 'One' });

    const res = await controller.findOverview();

    expect(res.topModel).toBe(SONNET);
  });

  it('sorts byAgent by cost desc and falls back to the raw id for deleted agents', async () => {
    // a2 spends more than a1; a2 is deleted (no name resolvable).
    const rows = [
      row({
        agentId: 'a1',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 1000,
        outputTokens: 100,
        callCount: 1,
      }),
      row({
        agentId: 'a2',
        model: SONNET,
        date: DAY_1,
        inputTokens: 100000,
        outputTokens: 10000,
        callCount: 4,
      }),
    ];
    const { controller } = makeController(rows, { a1: 'Alive' });

    const res = await controller.findOverview();

    expect(res.byAgent.map((a) => a.agentId)).toEqual(['a2', 'a1']);
    expect(res.byAgent[0].agentName).toBe('a2');
    expect(res.byAgent[0].costUsd).toBeCloseTo(
      costUsd(SONNET, 100000, 10000),
      10,
    );
    expect(res.byAgent[1].agentName).toBe('Alive');
  });

  it('returns a zeroed shape (not an error) when no usage exists', async () => {
    const { controller, findById } = makeController([]);

    const res = await controller.findOverview();

    expect(res).toEqual({
      last30days: [],
      totals: { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
      topModel: null,
      byAgent: [],
    });
    expect(findById).not.toHaveBeenCalled();
  });
});
