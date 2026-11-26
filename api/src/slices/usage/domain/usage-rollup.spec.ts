import { costUsd, hasPrice } from './model-pricing';
import { resolveAgentNames, rollUpAcrossAgents } from './usage-rollup';
import type { IUsageData } from './usage.types';

/**
 * What an agent spent stays spent after the agent is deleted (CLEAN-261), and
 * it stays readable: the row carries the name the agent had. These specs pin
 * the order the name is taken in — the live agent, then the row, then the id —
 * and that carrying the name through the roll-up moves no number.
 */
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';
const UNPRICED = 'some-model-nobody-priced';

const DAY_1 = new Date('2026-08-01T00:00:00.000Z');
const DAY_2 = new Date('2026-08-02T00:00:00.000Z');
const DAY_3 = new Date('2026-08-03T00:00:00.000Z');

function row(
  p: Partial<IUsageData> & { agentId: string; model: string; date: Date },
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

/** A lookup that knows only the agents given, as `IAgentGateway.findById`. */
const agentsNamed =
  (names: Record<string, string>) =>
  (id: string): Promise<{ name: string } | null> =>
    Promise.resolve(names[id] ? { name: names[id] } : null);

describe('rollUpAcrossAgents', () => {
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
      date: DAY_1,
      inputTokens: 300,
      outputTokens: 30,
      callCount: 1,
    }),
  ];

  it('gives the same numbers whether or not the rows carry a name', () => {
    const named = rows.map((r) => ({
      ...r,
      agentName: `Name of ${r.agentId}`,
    }));

    const bare = rollUpAcrossAgents(rows);
    const withNames = rollUpAcrossAgents(named);

    expect(withNames.last30days).toEqual(bare.last30days);
    expect(withNames.totals).toEqual(bare.totals);
    expect(withNames.topModel).toBe(bare.topModel);
    const numbers = (r: typeof bare) =>
      r.agentTotals.map((a) => ({
        agentId: a.agentId,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        callCount: a.callCount,
        costUsd: a.costUsd,
      }));
    expect(numbers(withNames)).toEqual(numbers(bare));

    // And the numbers are the ones the rows add up to.
    expect(bare.totals.inputTokens).toBe(3300);
    expect(bare.totals.outputTokens).toBe(630);
    expect(bare.totals.callCount).toBe(6);
    expect(bare.totals.costUsd).toBeCloseTo(
      costUsd(HAIKU, 1000, 500) +
        costUsd(HAIKU, 2000, 100) +
        costUsd(SONNET, 300, 30),
      10,
    );
    const a1 = bare.agentTotals.find((a) => a.agentId === 'a1');
    expect(a1?.inputTokens).toBe(1300);
    expect(a1?.outputTokens).toBe(530);
    expect(a1?.callCount).toBe(4);
  });

  it('carries the name of the most recent row, whatever order the rows come in', () => {
    const renamed = [
      row({ agentId: 'a1', model: HAIKU, date: DAY_1, agentName: 'Old name' }),
      row({ agentId: 'a1', model: HAIKU, date: DAY_3, agentName: 'New name' }),
      row({ agentId: 'a1', model: HAIKU, date: DAY_2, agentName: 'Middle' }),
    ];

    expect(rollUpAcrossAgents(renamed).agentTotals[0].agentName).toBe(
      'New name',
    );
    expect(
      rollUpAcrossAgents([...renamed].reverse()).agentTotals[0].agentName,
    ).toBe('New name');
  });

  it('keeps an older name when the newest row has none', () => {
    // A report that could not read the agent stores no name; the name an
    // earlier report stored is still the best one there is.
    const res = rollUpAcrossAgents([
      row({ agentId: 'a1', model: HAIKU, date: DAY_2, agentName: null }),
      row({ agentId: 'a1', model: HAIKU, date: DAY_1, agentName: 'Support' }),
    ]);

    expect(res.agentTotals[0].agentName).toBe('Support');
  });

  it('carries null when no row of the agent has a name', () => {
    const res = rollUpAcrossAgents([
      row({ agentId: 'a1', model: HAIKU, date: DAY_1 }),
    ]);

    expect(res.agentTotals[0].agentName).toBeNull();
  });
});

describe('resolveAgentNames', () => {
  const totals = (agentId: string, agentName: string | null) => ({
    agentId,
    agentName,
    inputTokens: 10,
    outputTokens: 20,
    callCount: 1,
    costUsd: 0.5,
  });

  it('takes the name from the row when the agent no longer exists', async () => {
    const res = await resolveAgentNames(
      [totals('agent-gone', 'Support Bot')],
      agentsNamed({}),
    );

    expect(res[0].agentName).toBe('Support Bot');
    expect(res[0].agentId).toBe('agent-gone');
  });

  it('never shows a bare id when a name was stored, also when the lookup throws', async () => {
    const res = await resolveAgentNames(
      [totals('agent-gone', 'Support Bot')],
      () => Promise.reject(new Error('agent not found')),
    );

    expect(res[0].agentName).toBe('Support Bot');
  });

  it('prefers the live name, so a rename shows before the next report', async () => {
    const res = await resolveAgentNames(
      [totals('a1', 'Old name')],
      agentsNamed({ a1: 'New name' }),
    );

    expect(res[0].agentName).toBe('New name');
  });

  it('falls back to the id only when there is neither an agent nor a stored name', async () => {
    const res = await resolveAgentNames(
      [totals('agent-gone', null)],
      agentsNamed({}),
    );

    expect(res[0].agentName).toBe('agent-gone');
  });

  it('answers the response shape and nothing more', async () => {
    const res = await resolveAgentNames(
      [totals('a1', 'Stored')],
      agentsNamed({ a1: 'Live' }),
    );

    expect(res).toEqual([
      {
        agentId: 'a1',
        agentName: 'Live',
        inputTokens: 10,
        outputTokens: 20,
        callCount: 1,
        costUsd: 0.5,
      },
    ]);
  });
});

describe('model pricing', () => {
  it('hasPrice is true for a model in the price list', () => {
    expect(hasPrice(HAIKU)).toBe(true);
    expect(hasPrice(SONNET)).toBe(true);
  });

  it('hasPrice is false for a model outside it', () => {
    expect(hasPrice(UNPRICED)).toBe(false);
    expect(hasPrice('')).toBe(false);
    // A name every object answers to is still not a priced model.
    expect(hasPrice('constructor')).toBe(false);
    expect(hasPrice('toString')).toBe(false);
  });

  it('costUsd is unchanged: priced per million for a known model, 0 for an unknown one', () => {
    // Haiku: $1 per million in, $5 per million out.
    expect(costUsd(HAIKU, 1_000_000, 1_000_000)).toBeCloseTo(6, 10);
    expect(costUsd(HAIKU, 1000, 500)).toBeCloseTo(0.0035, 10);
    // Sonnet: $3 in, $15 out.
    expect(costUsd(SONNET, 2_000_000, 1_000_000)).toBeCloseTo(21, 10);
    expect(costUsd(UNPRICED, 1_000_000, 1_000_000)).toBe(0);
  });
});
