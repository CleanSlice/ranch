import { UsageController } from './usage.controller';
import { IUsageGateway } from './domain';
import { costUsd } from './domain/model-pricing';
import { IUsageData } from './domain/usage.types';
import { IFileGateway } from '#/agent/file/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ILlmGateway } from '#/llm/domain';
import { UserRoleTypes } from '#/user/user/domain';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  accessHarness,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';

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
    agentName: null,
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
  access: AgentAccessService = openAccess(),
) {
  const findRecentAll = jest.fn(async () => rows);
  const report = jest.fn(async () => undefined);
  const gateway = { findRecentAll, report } as unknown as IUsageGateway;
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
    access,
  );
  return { controller, findRecentAll, findById, report, agentGateway };
}

describe('UsageController.report', () => {
  const dto = {
    date: '2026-08-02',
    byModel: {
      [HAIKU]: { inputTokens: 1000, outputTokens: 500, callCount: 3 },
      [SONNET]: { inputTokens: 300, outputTokens: 30, callCount: 1 },
    },
  };

  it("hands the agent's current name down with the report, read once for all its rows", async () => {
    const { controller, report, findById } = makeController([], {
      a1: 'Support Bot',
    });

    await controller.report('a1', dto);

    // One lookup for the whole report, however many models it carries.
    expect(findById).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledWith('a1');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('a1', dto, 'Support Bot');
  });

  it('picks a rename up with the next report', async () => {
    const names: Record<string, string> = { a1: 'Support Bot' };
    const { controller, report } = makeController([], names);

    await controller.report('a1', dto);
    names.a1 = 'Help Desk';
    await controller.report('a1', dto);

    expect(report).toHaveBeenNthCalledWith(1, 'a1', dto, 'Support Bot');
    expect(report).toHaveBeenNthCalledWith(2, 'a1', dto, 'Help Desk');
  });

  it('reports with a null name, and does not throw, for an agent that does not exist', async () => {
    const { controller, report, agentGateway } = makeController([]);
    // What the real gateway answers for an unknown id.
    (agentGateway as unknown as Record<string, jest.Mock>).findById = jest.fn(
      async () => null,
    );

    await expect(controller.report('agent-gone', dto)).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith('agent-gone', dto, null);
  });

  it('still takes the report when the name lookup itself fails', async () => {
    // The fake's findById throws for an unknown id. Usage is telemetry: a
    // name that could not be read must not cost the day's numbers.
    const { controller, report } = makeController([]);

    await expect(controller.report('agent-gone', dto)).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith('agent-gone', dto, null);
  });
});

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

  it('lists a deleted agent under the name its rows carry, not under its id', async () => {
    // a2 was renamed between two reports and then deleted: its spend stays
    // in the overview under the last name it had (CLEAN-261).
    const rows = [
      row({
        agentId: 'a2',
        agentName: 'Research Bot',
        model: SONNET,
        date: DAY_2,
        inputTokens: 100000,
        outputTokens: 10000,
        callCount: 4,
      }),
      row({
        agentId: 'a2',
        agentName: 'Researcher',
        model: SONNET,
        date: DAY_1,
        inputTokens: 500,
        outputTokens: 50,
        callCount: 1,
      }),
      row({
        agentId: 'a1',
        agentName: 'Stored name of a1',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 1000,
        outputTokens: 100,
        callCount: 1,
      }),
    ];
    const { controller } = makeController(rows, { a1: 'Alive' });

    const res = await controller.findOverview();

    expect(res.byAgent.map((a) => a.agentId)).toEqual(['a2', 'a1']);
    expect(res.byAgent[0].agentName).toBe('Research Bot');
    expect(res.byAgent[0].costUsd).toBeCloseTo(
      costUsd(SONNET, 100000, 10000) + costUsd(SONNET, 500, 50),
      10,
    );
    // An agent that still exists shows the name it has now.
    expect(res.byAgent[1].agentName).toBe('Alive');
    // No new field in the response: the same six as before.
    expect(Object.keys(res.byAgent[0]).sort()).toEqual([
      'agentId',
      'agentName',
      'callCount',
      'costUsd',
      'inputTokens',
      'outputTokens',
    ]);
  });

  it('sorts byAgent by cost desc and falls back to the raw id for a deleted agent whose rows carry no name', async () => {
    // a2 spends more than a1; a2 is deleted and its rows were written
    // before the name was stored with them.
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

  it('leaves an agent the caller does not reach out of byAgent and out of the totals', async () => {
    // Same model and day for both agents, so a row that slipped through
    // would be merged into the daily entry and show only in the sums.
    const rows = [
      row({
        agentId: 'a1',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 1000,
        outputTokens: 100,
        callCount: 2,
      }),
      row({
        agentId: 'a2',
        model: HAIKU,
        date: DAY_1,
        inputTokens: 90000,
        outputTokens: 9000,
        callCount: 7,
      }),
    ];
    const { service, gateway } = accessHarness(['a1', 'a2']);
    gateway.seed('user-1', false, [{ agentId: 'a2', list: 'denied' }]);
    const { controller } = makeController(
      rows,
      { a1: 'One', a2: 'Two' },
      service,
    );
    const admin = {
      user: { sub: 'user-1', email: '', roles: [UserRoleTypes.Admin] },
    } as never;

    const res = await controller.findOverview(admin);

    expect(res.byAgent.map((a) => a.agentId)).toEqual(['a1']);
    expect(res.last30days).toHaveLength(1);
    expect(res.totals.inputTokens).toBe(1000);
    expect(res.totals.outputTokens).toBe(100);
    expect(res.totals.callCount).toBe(2);
    expect(res.totals.costUsd).toBeCloseTo(costUsd(HAIKU, 1000, 100), 10);

    // The Owner has no lists: the same rows, whole.
    const owner = {
      user: { sub: 'user-o', email: '', roles: [UserRoleTypes.Owner] },
    } as never;
    const whole = await controller.findOverview(owner);
    expect(whole.byAgent.map((a) => a.agentId).sort()).toEqual(['a1', 'a2']);
    expect(whole.totals.callCount).toBe(9);
  });
});
