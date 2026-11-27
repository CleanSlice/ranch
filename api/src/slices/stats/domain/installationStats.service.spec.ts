import type { Request } from 'express';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { IFileGateway } from '#/agent/file/domain';
import type { ILlmGateway } from '#/llm/domain';
import { costUsd, rollUpAcrossAgents } from '#/usage/domain';
import type { IUsageGateway } from '#/usage/domain';
import { UsageController } from '#/usage/usage.controller';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  accessHarness,
  person,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import {
  IFleetAgent,
  IFleetHour,
  IFleetIncident,
  IFleetUsage,
  IFleetWorld,
  installationHarness,
} from './__fixtures__/installationStats';
import { INCIDENTS_SHOWN } from './installationStats.service';

const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5';
// Not in the price list (`model-pricing.ts`).
const HOUSE = 'house-model-1';

// A Friday. A 7-day period is 21 to 27 November in UTC, the one before it 14
// to 20 November. A 30-day period begins on 29 October, the one before it on
// 29 September.
const NOW = new Date('2026-11-27T10:30:00.000Z');

const ATLAS: IFleetAgent = { id: 'a1', name: 'Atlas' };
const BEACON: IFleetAgent = { id: 'a2', name: 'Beacon' };
const CIPHER: IFleetAgent = { id: 'a3', name: 'Cipher' };
const AGENTS = [ATLAS, BEACON, CIPHER];

/**
 * Three callers over the same three agents: the Owner, whom the lists do
 * not apply to; an Admin limited to Atlas and Beacon; and an Admin who is
 * not limited and has Cipher denied.
 */
function callers() {
  const { service: access, gateway: lists } = accessHarness(['a1', 'a2', 'a3']);
  lists.seed(ADMIN.id, true, [
    { agentId: 'a1', list: 'allowed' },
    { agentId: 'a2', list: 'allowed' },
  ]);
  lists.seed(ADMIN2.id, false, [{ agentId: 'a3', list: 'denied' }]);
  return {
    access,
    owner: person(OWNER),
    limited: person(ADMIN),
    excluding: person(ADMIN2),
  };
}

const view = (
  world: Partial<IFleetWorld>,
  period: 7 | 30 | 90 = 7,
  caller: ICallerParty = person(OWNER),
  access: AgentAccessService = callers().access,
) =>
  installationHarness({ agents: AGENTS, ...world }, access).service.forCaller(
    caller,
    { period },
    NOW,
  );

/** An hour in which the person wrote and the agent answered, unless said. */
const hour = (
  sessionId: string,
  agentId: string,
  externalUserId: string,
  iso: string,
  over: Partial<IFleetHour> = {},
): IFleetHour => ({
  sessionId,
  agentId,
  externalUserId,
  hour: iso,
  userMessages: 1,
  agentMessages: 1,
  ...over,
});

const spent = (
  agentId: string,
  day: string,
  model: string,
  input: number,
  output: number,
  calls: number,
  agentName: string | null = null,
): IFleetUsage => ({ agentId, day, model, input, output, calls, agentName });

const incident = (
  number: number,
  agentId: string | null,
  openedAt: string,
  closedAt: string | null = null,
  agentName = `agent-of-#${number}`,
): IFleetIncident => ({
  number,
  agentId,
  agentName,
  reason: `reason-of-#${number}`,
  openedAt,
  closedAt,
});

describe('InstallationStatsService: what was computed', () => {
  it('answers with the period and the three instants of the range, cut on UTC days', async () => {
    const stats = await view({}, 7);

    expect(stats.period).toBe(7);
    expect(stats.range).toEqual({
      from: new Date('2026-11-21T00:00:00.000Z'),
      to: NOW,
      previousFrom: new Date('2026-11-14T00:00:00.000Z'),
    });
  });

  it('cuts 30 and 90 days the same way', async () => {
    expect((await view({}, 30)).range).toEqual({
      from: new Date('2026-10-29T00:00:00.000Z'),
      to: NOW,
      previousFrom: new Date('2026-09-29T00:00:00.000Z'),
    });
    expect((await view({}, 90)).range).toEqual({
      from: new Date('2026-08-30T00:00:00.000Z'),
      to: NOW,
      previousFrom: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  // Two administrators in different zones see the same numbers: nothing of
  // the caller's clock is asked for, and none is taken.
  it('reads the activity for exactly that range', async () => {
    const { service, reads } = installationHarness(
      { agents: AGENTS },
      callers().access,
    );

    await service.forCaller(person(OWNER), { period: 7 }, NOW);

    expect(reads.activity.summaryForAgents.calls[0][0]).toEqual({
      from: new Date('2026-11-21T00:00:00.000Z'),
      to: NOW,
      previousFrom: new Date('2026-11-14T00:00:00.000Z'),
    });
  });

  it('answers an installation with nothing in it: zeros and empty lists, a day for every day', async () => {
    const stats = await view({ agents: [] }, 7);

    expect(stats.reach).toEqual({
      limited: false,
      agents: 0,
      ownerOnly: [],
    });
    expect(stats.board).toEqual({
      tokens: { input: 0, output: 0 },
      calls: { value: 0, previous: 0 },
      cost: { value: 0, previous: 0, unpriced: [] },
      people: { value: 0, previous: 0 },
    });
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.every((d) => d.cost === 0 && !d.byModel.length)).toBe(
      true,
    );
    expect(stats.models).toEqual([]);
    expect(stats.agents).toEqual([]);
    // Nothing to take a pace from: no projection, which is not "$0".
    expect(stats.projection30d).toBeNull();
    expect(stats.health).toEqual({
      incidents: [],
      incidentsTotal: 0,
      refusals: [],
    });
    expect(stats.quality).toEqual([]);
    expect(stats.channels).toEqual([]);
    expect(stats.notes).toEqual([]);
  });
});

describe('InstallationStatsService: who sees what', () => {
  it('says the Owner sees the whole installation, and how many agents that is', async () => {
    const { access, owner } = callers();

    expect((await view({}, 7, owner, access)).reach).toEqual({
      limited: false,
      agents: 3,
      ownerOnly: [],
    });
  });

  it('says a caller limited to a list sees a part, and how many agents they reach', async () => {
    const { access, limited } = callers();

    expect((await view({}, 7, limited, access)).reach).toEqual({
      limited: true,
      agents: 2,
      ownerOnly: [],
    });
  });

  it('says the same of a caller who is not limited and has an agent denied', async () => {
    const { access, excluding } = callers();

    expect((await view({}, 7, excluding, access)).reach).toEqual({
      limited: true,
      agents: 2,
      ownerOnly: [],
    });
  });

  // One world, read three times. Everything Cipher did is in the Owner's
  // view and in neither Admin's: every list and every total.
  const WORLD: Partial<IFleetWorld> = {
    hours: [
      hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
      hour('c2', 'a2', 'u2', '2026-11-25T10:00:00Z'),
      hour('c3', 'a3', 'u3', '2026-11-25T11:00:00Z', { channel: 'telegram' }),
      hour('c4', 'a3', 'u4', '2026-11-26T11:00:00Z', { channel: 'telegram' }),
      // The period before.
      hour('c5', 'a1', 'u1', '2026-11-18T09:00:00Z'),
      hour('c6', 'a3', 'u5', '2026-11-18T09:00:00Z'),
    ],
    ratings: [
      { agentId: 'a1', rating: 1, at: '2026-11-25T09:10:00Z' },
      { agentId: 'a3', rating: -1, at: '2026-11-25T11:10:00Z' },
      { agentId: 'a3', rating: -1, at: '2026-11-26T11:10:00Z' },
    ],
    usage: [
      spent('a1', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
      spent('a2', '2026-11-25', HAIKU, 2_000_000, 200_000, 20),
      spent('a3', '2026-11-26', SONNET, 4_000_000, 400_000, 40),
      spent('a1', '2026-11-18', SONNET, 500_000, 50_000, 5),
      spent('a3', '2026-11-18', SONNET, 8_000_000, 800_000, 80),
    ],
    loadDays: [
      { agentId: 'a2', day: '2026-11-25', refused: 3 },
      { agentId: 'a3', day: '2026-11-25', refused: 9 },
    ],
    incidents: [
      incident(1, 'a1', '2026-11-22T08:00:00Z', '2026-11-22T08:30:00Z'),
      incident(2, 'a3', '2026-11-24T08:00:00Z', null, 'Cipher'),
    ],
  };

  it('shows the Owner every agent, in every block', async () => {
    const { access, owner } = callers();
    const stats = await view(WORLD, 7, owner, access);

    expect(stats.board.tokens).toEqual({ input: 7_000_000, output: 700_000 });
    expect(stats.board.calls).toEqual({ value: 70, previous: 85 });
    expect(stats.board.people).toEqual({ value: 4, previous: 2 });
    expect(stats.agents.map((a) => a.agentId)).toEqual(['a3', 'a1', 'a2']);
    expect(stats.health.incidents.map((i) => i.number)).toEqual([2, 1]);
    expect(stats.health.incidentsTotal).toBe(2);
    expect(stats.health.refusals).toEqual([
      { agentId: 'a3', name: 'Cipher', refused: 9 },
      { agentId: 'a2', name: 'Beacon', refused: 3 },
    ]);
    expect(stats.quality).toEqual([
      { agentId: 'a3', name: 'Cipher', conversations: 2, down: 2, rated: 2 },
      { agentId: 'a1', name: 'Atlas', conversations: 1, down: 0, rated: 1 },
      { agentId: 'a2', name: 'Beacon', conversations: 1, down: 0, rated: 0 },
    ]);
    expect(stats.channels).toEqual([
      { channel: 'console', conversations: 2 },
      { channel: 'telegram', conversations: 2 },
    ]);
  });

  it.each(['limited', 'excluding'] as const)(
    'leaves the unreached agent out of every figure, totals included, for a caller who is %s',
    async (who) => {
      const all = callers();
      const stats = await view(WORLD, 7, all[who], all.access);

      expect(stats.board.tokens).toEqual({
        input: 3_000_000,
        output: 300_000,
      });
      expect(stats.board.calls).toEqual({ value: 30, previous: 5 });
      expect(stats.board.cost.value).toBeCloseTo(
        costUsd(SONNET, 1_000_000, 100_000) + costUsd(HAIKU, 2e6, 2e5),
        10,
      );
      expect(stats.board.cost.previous).toBeCloseTo(
        costUsd(SONNET, 500_000, 50_000),
        10,
      );
      expect(stats.board.people).toEqual({ value: 2, previous: 1 });
      expect(
        stats.daily.reduce(
          (sum, d) => sum + d.byModel.reduce((s, m) => s + m.tokens, 0),
          0,
        ),
      ).toBe(3_300_000);
      expect(stats.agents.map((a) => a.agentId).sort()).toEqual(['a1', 'a2']);
      expect(stats.health.incidents.map((i) => i.number)).toEqual([1]);
      expect(stats.health.incidentsTotal).toBe(1);
      expect(stats.health.refusals).toEqual([
        { agentId: 'a2', name: 'Beacon', refused: 3 },
      ]);
      expect(stats.quality.map((q) => q.agentId).sort()).toEqual(['a1', 'a2']);
      expect(stats.channels).toEqual([
        { channel: 'console', conversations: 2 },
      ]);
      // Not its id and not its name, anywhere.
      const text = JSON.stringify(stats);
      expect(text).not.toContain('a3');
      expect(text).not.toContain('Cipher');
    },
  );

  it('hands every read the caller’s reach, never a wider one', async () => {
    const { access, limited } = callers();
    const { service, reads } = installationHarness(
      { agents: AGENTS, ...WORLD },
      access,
    );

    await service.forCaller(limited, { period: 7 }, NOW);

    const scope = { in: ['a1', 'a2'] };
    expect(reads.activity.summaryForAgents.calls[0][1]).toEqual(scope);
    expect(reads.chats.feedbackByAgent.calls[0][2]).toEqual(scope);
    expect(reads.events.incidentsInRange.calls[0][0].agentScope).toEqual(scope);
    expect(reads.limits.loadDays.calls[0][0].sort()).toEqual(['a1', 'a2']);
  });

  it('reaches no agent: nothing but zeros, and every read is told "no agent", not "every agent"', async () => {
    const { service: access, gateway: lists } = accessHarness(['a1']);
    lists.seed(ADMIN.id, true, []);
    const { service, reads } = installationHarness(
      { agents: AGENTS, ...WORLD },
      access,
    );

    const stats = await service.forCaller(person(ADMIN), { period: 7 }, NOW);

    expect(reads.activity.summaryForAgents.calls[0][1]).toEqual({ in: [] });
    expect(reads.chats.feedbackByAgent.calls[0][2]).toEqual({ in: [] });
    expect(reads.events.incidentsInRange.calls[0][0].agentScope).toEqual({
      in: [],
    });
    expect(reads.limits.loadDays.calls[0][0]).toEqual([]);
    expect(stats.reach).toEqual({
      limited: true,
      agents: 0,
      ownerOnly: [],
    });
    expect(stats.board.tokens).toEqual({ input: 0, output: 0 });
    expect(stats.board.calls).toEqual({ value: 0, previous: 0 });
    expect(stats.board.people).toEqual({ value: 0, previous: 0 });
    expect(stats.agents).toEqual([]);
    expect(stats.health).toEqual({
      incidents: [],
      incidentsTotal: 0,
      refusals: [],
    });
    expect(stats.quality).toEqual([]);
    expect(stats.channels).toEqual([]);
  });
});

/**
 * CLEAN-236, and CLEAN-263 and CLEAN-267 after it: what people said to the
 * Ranch assistant is the Owner's, and whoever takes such an agent out owes
 * the caller the reason. This view carries no text, but its people, its
 * quality rows and its channels are built from those conversations, so they
 * follow the same line. What the assistant cost and how it fared is
 * operations, and stays with the plain reach: the admin usage overview shows
 * the same agents, and the two must give the same numbers (FR-037).
 */
describe('InstallationStatsService: the assistant’s conversations are the Owner’s', () => {
  const RANCH: IFleetAgent = { id: 'ranch', name: 'Ranch', admin: true };
  const FLEET = [ATLAS, BEACON, RANCH];

  const WORLD: Partial<IFleetWorld> = {
    agents: FLEET,
    hours: [
      hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
      hour('c2', 'ranch', 'u2', '2026-11-25T10:00:00Z'),
      hour('c3', 'ranch', 'u3', '2026-11-26T10:00:00Z', {
        channel: 'telegram',
      }),
      // The period before.
      hour('c4', 'a1', 'u1', '2026-11-18T09:00:00Z'),
      hour('c5', 'ranch', 'u4', '2026-11-18T10:00:00Z'),
    ],
    ratings: [
      { agentId: 'a1', rating: 1, at: '2026-11-25T09:10:00Z' },
      { agentId: 'ranch', rating: -1, at: '2026-11-25T10:10:00Z' },
      { agentId: 'ranch', rating: -1, at: '2026-11-26T10:10:00Z' },
    ],
    usage: [
      spent('a1', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
      spent('ranch', '2026-11-25', SONNET, 4_000_000, 400_000, 40),
    ],
    loadDays: [{ agentId: 'ranch', day: '2026-11-25', refused: 7 }],
    incidents: [incident(4, 'ranch', '2026-11-24T08:00:00Z', null, 'Ranch')],
  };

  /**
   * The Owner; an Admin with no list, who reaches the assistant as every
   * operator does; and an Admin limited to Atlas and Beacon.
   */
  function fleetCallers() {
    const { service: access, gateway: lists } = accessHarness([
      'a1',
      'a2',
      'ranch',
    ]);
    lists.seed(ADMIN2.id, true, [
      { agentId: 'a1', list: 'allowed' },
      { agentId: 'a2', list: 'allowed' },
    ]);
    return {
      access,
      owner: person(OWNER),
      admin: person(ADMIN),
      withoutAssistant: person(ADMIN2),
    };
  }

  it('gives an Admin who reaches the assistant no quality row for it, its conversations in no channel and its people in no count', async () => {
    const { access, admin } = fleetCallers();
    const stats = await view(WORLD, 7, admin, access);

    expect(stats.quality).toEqual([
      { agentId: 'a1', name: 'Atlas', conversations: 1, down: 0, rated: 1 },
    ]);
    expect(stats.channels).toEqual([{ channel: 'console', conversations: 1 }]);
    expect(stats.board.people).toEqual({ value: 1, previous: 1 });
  });

  it('names it in `reach.ownerOnly`, and still counts it among the agents reached', async () => {
    const { access, admin } = fleetCallers();

    expect((await view(WORLD, 7, admin, access)).reach).toEqual({
      limited: false,
      agents: 3,
      ownerOnly: ['Ranch'],
    });
  });

  // CLEAN-268: what the assistant spent, and how often its limits refused
  // somebody, are records about everybody's use of it. They are the Owner's
  // like its conversations, and the usage overview leaves them out by the
  // same rule, so the two views still agree. That it was down is not.
  it('keeps its spend and its refusals from that Admin, totals included, and still lists its incidents', async () => {
    const { access, admin } = fleetCallers();
    const stats = await view(WORLD, 7, admin, access);

    expect(stats.board.tokens).toEqual({ input: 1_000_000, output: 100_000 });
    expect(stats.board.calls.value).toBe(10);
    expect(stats.board.cost.value).toBeCloseTo(
      costUsd(SONNET, 1_000_000, 100_000),
      10,
    );
    expect(stats.agents.map((a) => [a.agentId, a.name, a.calls])).toEqual([
      ['a1', 'Atlas', 10],
    ]);
    expect(stats.daily.find((d) => d.date === '2026-11-25')?.byModel).toEqual([
      { model: SONNET, tokens: 1_100_000 },
    ]);
    expect(stats.projection30d).not.toBeNull();
    expect(stats.health.refusals).toEqual([]);
    expect(stats.health.incidents.map((i) => i.number)).toEqual([4]);
    expect(stats.health.incidentsTotal).toBe(1);
  });

  it('gives the Owner its spend and its refusals', async () => {
    const { access, owner } = fleetCallers();
    const stats = await view(WORLD, 7, owner, access);

    expect(stats.board.tokens).toEqual({ input: 5_000_000, output: 500_000 });
    expect(stats.agents.map((a) => [a.agentId, a.calls])).toEqual([
      ['ranch', 40],
      ['a1', 10],
    ]);
    expect(stats.health.refusals).toEqual([
      { agentId: 'ranch', name: 'Ranch', refused: 7 },
    ]);
  });

  it('asks for conversations, ratings and refusals without the assistant, and for incidents with the plain reach', async () => {
    const { access, admin } = fleetCallers();
    const { service, reads } = installationHarness(WORLD, access);

    await service.forCaller(admin, { period: 7 }, NOW);

    const supervised = { notIn: ['ranch'] };
    expect(reads.activity.summaryForAgents.calls[0][1]).toEqual(supervised);
    expect(reads.chats.feedbackByAgent.calls[0][2]).toEqual(supervised);
    expect(
      reads.events.incidentsInRange.calls[0][0].agentScope,
    ).toBeUndefined();
    expect(reads.limits.loadDays.calls[0][0].sort()).toEqual(['a1', 'a2']);
  });

  // The second lock: whatever a read answers, a row of the assistant is in
  // no conversation figure of an Admin.
  it('drops a conversation or a rating of the assistant that a read returned anyway', async () => {
    const { access, admin } = fleetCallers();
    const { service, reads } = installationHarness(WORLD, access);
    const everyAgent = reads.activity.summaryForAgents;
    const everyRating = reads.chats.feedbackByAgent;
    reads.activity.summaryForAgents = Object.assign(
      (periods: Parameters<typeof everyAgent>[0]) => everyAgent(periods),
      { calls: [] },
    );
    reads.chats.feedbackByAgent = Object.assign(
      (from: Date, to: Date) => everyRating(from, to),
      { calls: [] },
    );

    const stats = await service.forCaller(admin, { period: 7 }, NOW);

    expect(stats.quality.map((q) => q.agentId)).toEqual(['a1']);
    expect(stats.channels).toEqual([{ channel: 'console', conversations: 1 }]);
  });

  it('gives the Owner everything, and an empty `reach.ownerOnly`', async () => {
    const { access, owner } = fleetCallers();
    const stats = await view(WORLD, 7, owner, access);

    expect(stats.reach).toEqual({ limited: false, agents: 3, ownerOnly: [] });
    expect(stats.quality).toEqual([
      { agentId: 'ranch', name: 'Ranch', conversations: 2, down: 2, rated: 2 },
      { agentId: 'a1', name: 'Atlas', conversations: 1, down: 0, rated: 1 },
    ]);
    expect(stats.channels).toEqual([
      { channel: 'console', conversations: 2 },
      { channel: 'telegram', conversations: 1 },
    ]);
    expect(stats.board.people).toEqual({ value: 3, previous: 2 });
    expect(stats.board.calls.value).toBe(50);
  });

  // The assistant on its own schedule is the assistant: nothing of its own
  // is kept from it.
  it('gives a trusted party everything too', async () => {
    const { access } = fleetCallers();
    const stats = await view(WORLD, 7, { kind: 'trusted' }, access);

    expect(stats.reach).toEqual({ limited: false, agents: 3, ownerOnly: [] });
    expect(stats.quality.map((q) => q.agentId)).toEqual(['ranch', 'a1']);
    expect(stats.board.people.value).toBe(3);
  });

  // Nothing was left out for a reason there is to give: the assistant is
  // outside this Admin's reach, as any other hidden agent is, and is in no
  // figure at all.
  it('gives an Admin limited to agents that do not include the assistant an empty `reach.ownerOnly`', async () => {
    const { access, withoutAssistant } = fleetCallers();
    const stats = await view(WORLD, 7, withoutAssistant, access);

    expect(stats.reach).toEqual({ limited: true, agents: 2, ownerOnly: [] });
    expect(stats.board.calls.value).toBe(10);
    expect(stats.quality.map((q) => q.agentId)).toEqual(['a1']);
    const text = JSON.stringify(stats);
    expect(text).not.toContain('ranch');
    expect(text).not.toContain('Ranch');
  });

  // As production has it since CLEAN-240: the assistant is not an entry in
  // the lists, and an Admin limited to one agent still has it by its switch.
  it('names it for an Admin limited to a list who has the assistant by its switch', async () => {
    const { service: access, gateway: lists } = accessHarness([
      'a1',
      'a2',
      'ranch',
    ]);
    lists.seed(ADMIN.id, true, [{ agentId: 'a1', list: 'allowed' }]);
    access.attachAssistant({
      assistantId: () => Promise.resolve('ranch'),
      forPerson: () => Promise.resolve({ id: 'ranch', enabled: true }),
    });
    const { service, reads } = installationHarness(WORLD, access);

    const stats = await service.forCaller(person(ADMIN), { period: 7 }, NOW);

    expect(stats.reach).toEqual({
      limited: true,
      agents: 2,
      ownerOnly: ['Ranch'],
    });
    expect(reads.activity.summaryForAgents.calls[0][1]).toEqual({
      in: ['a1'],
    });
    expect(reads.events.incidentsInRange.calls[0][0].agentScope).toEqual({
      in: ['a1', 'ranch'],
    });
    expect(stats.quality.map((q) => q.agentId)).toEqual(['a1']);
    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
  });

  it('names nothing on an installation with no assistant', async () => {
    const { access, admin } = fleetCallers();
    const stats = await view(
      { ...WORLD, agents: [ATLAS, BEACON, { id: 'ranch', name: 'Ranch' }] },
      7,
      admin,
      access,
    );

    expect(stats.reach.ownerOnly).toEqual([]);
    expect(stats.quality.map((q) => q.agentId)).toEqual(['ranch', 'a1']);
  });
});

describe('InstallationStatsService: tokens, calls and cost', () => {
  const USAGE = [
    spent('a1', '2026-11-27', SONNET, 300_000, 40_000, 7),
    spent('a1', '2026-11-25', SONNET, 1_200_000, 150_000, 31),
    spent('a1', '2026-11-25', HAIKU, 900_000, 80_000, 12),
    spent('a2', '2026-11-25', HAIKU, 2_500_000, 310_000, 44),
    spent('a2', '2026-11-21', SONNET, 640_000, 70_000, 9),
    // The period before: 14 to 20 November.
    spent('a1', '2026-11-20', SONNET, 2_000_000, 250_000, 50),
    spent('a2', '2026-11-14', HAIKU, 1_000_000, 100_000, 20),
    // Before that: in nothing.
    spent('a1', '2026-11-13', SONNET, 9_000_000, 900_000, 90),
  ];

  it('equals the roll-up and the prices of the admin overview over the same rows', async () => {
    const { service, reads } = installationHarness(
      { agents: AGENTS, usage: USAGE },
      callers().access,
    );
    const stats = await service.forCaller(person(OWNER), { period: 7 }, NOW);

    const from = new Date('2026-11-21T00:00:00.000Z');
    const rows = await reads.usage.findRange(
      from,
      new Date('2026-11-28T00:00:00.000Z'),
    );
    const expected = rollUpAcrossAgents(rows);
    const before = rollUpAcrossAgents(
      await reads.usage.findRange(new Date('2026-11-14T00:00:00.000Z'), from),
    );

    expect(rows).toHaveLength(5);
    expect(stats.board.tokens).toEqual({
      input: expected.totals.inputTokens,
      output: expected.totals.outputTokens,
    });
    expect(stats.board.calls).toEqual({
      value: expected.totals.callCount,
      previous: before.totals.callCount,
    });
    expect(stats.board.cost.value).toBe(expected.totals.costUsd);
    expect(stats.board.cost.previous).toBe(before.totals.costUsd);
    // And the numbers themselves, so that the comparison is not of two
    // zeros: 5.54 M tokens in, 103 calls.
    expect(stats.board.tokens).toEqual({ input: 5_540_000, output: 650_000 });
    expect(stats.board.calls).toEqual({ value: 103, previous: 70 });
    expect(stats.board.cost.value).toBeCloseTo(
      costUsd(SONNET, 2_140_000, 260_000) + costUsd(HAIKU, 3_400_000, 390_000),
      10,
    );
  });

  // FR-037: the same agents and the same days are the same number here and
  // on the admin console's usage page. The real controller of that page is
  // asked, over the same rows, by the same caller.
  describe('for 30 days, against GET /usage/overview', () => {
    const overviewOf = (usage: IFleetUsage[], caller: typeof OWNER) => {
      const { access } = callers();
      const { service, reads } = installationHarness(
        { agents: AGENTS, usage },
        access,
        () => NOW,
      );
      const controller = new UsageController(
        reads.usage as unknown as IUsageGateway,
        {} as IFileGateway,
        reads.agents as unknown as IAgentGateway,
        {} as ILlmGateway,
        access,
      );
      const request = {
        user: { sub: caller.id, email: '', roles: [caller.role] },
      } as unknown as Request;
      return Promise.all([
        service.forCaller(person(caller), { period: 30 }, NOW),
        controller.findOverview(request),
      ]);
    };

    // Every row inside the 30 days of the period: 29 October to today.
    const MONTH = [
      ...USAGE.filter((u) => u.day >= '2026-10-29'),
      spent('a3', '2026-10-29', SONNET, 5_000_000, 600_000, 70),
      spent('a3', '2026-11-10', HOUSE, 7_000_000, 900_000, 110),
      spent('gone', '2026-11-05', HAIKU, 400_000, 30_000, 6, 'Dodo'),
    ];

    it.each([
      ['the Owner', OWNER],
      ['an Admin limited to two agents', ADMIN],
      ['an Admin with one agent denied', ADMIN2],
    ])('gives %s the totals of the overview', async (_who, caller) => {
      const [stats, overview] = await overviewOf(MONTH, caller);

      expect(overview.totals.callCount).toBeGreaterThan(0);
      expect(stats.board.tokens).toEqual({
        input: overview.totals.inputTokens,
        output: overview.totals.outputTokens,
      });
      expect(stats.board.calls.value).toBe(overview.totals.callCount);
      expect(stats.board.cost.value).toBe(overview.totals.costUsd);
    });

    it('gives each agent the tokens, calls and name the overview gives it', async () => {
      const [stats, overview] = await overviewOf(MONTH, OWNER);

      expect(
        stats.agents
          .map((a) => ({
            agentId: a.agentId,
            name: a.name,
            tokens: a.tokens,
            calls: a.calls,
          }))
          .sort((a, b) => a.agentId.localeCompare(b.agentId)),
      ).toEqual(
        overview.byAgent
          .map((a) => ({
            agentId: a.agentId,
            name: a.agentName,
            tokens: a.inputTokens + a.outputTokens,
            calls: a.callCount,
          }))
          .sort((a, b) => a.agentId.localeCompare(b.agentId)),
      );
      // Cost too, wherever this view states one. An agent whose only model
      // has no price is 0 there and "no price" here.
      for (const agent of stats.agents) {
        const there = overview.byAgent.find((a) => a.agentId === agent.agentId);
        expect([agent.agentId, agent.cost ?? 0]).toEqual([
          agent.agentId,
          there?.costUsd,
        ]);
      }
    });

    // The two windows are not the same days. The overview counts back 30
    // days from today and includes that day: 31 days. A 30-day period here
    // is today and the 29 before it, so that a period is a whole number of
    // days and the one before it is as long. Usage reported for the day the
    // overview has in addition is the last day of the previous period here.
    it('differs by the one day the overview reads in addition: the 31st back', async () => {
      const extra = spent('a1', '2026-10-28', SONNET, 1_000_000, 0, 3);
      const [stats, overview] = await overviewOf([...MONTH, extra], OWNER);
      const [without] = await overviewOf(MONTH, OWNER);

      expect(overview.totals.callCount).toBe(stats.board.calls.value + 3);
      expect(stats.board.calls.value).toBe(without.board.calls.value);
      expect(stats.board.calls.previous).toBe(3);
    });
  });

  it('compares calls and cost with the same number of days immediately before', async () => {
    const stats = await view({ usage: USAGE }, 7);

    expect(stats.board.calls.previous).toBe(70);
    expect(stats.board.cost.previous).toBeCloseTo(
      costUsd(SONNET, 2_000_000, 250_000) + costUsd(HAIKU, 1_000_000, 100_000),
      10,
    );
  });

  it('reads usage once, for both periods, to the end of today', async () => {
    const { service, reads } = installationHarness(
      { agents: AGENTS, usage: USAGE },
      callers().access,
    );

    await service.forCaller(person(OWNER), { period: 7 }, NOW);

    expect(reads.usage.findRange.calls).toEqual([
      [
        new Date('2026-11-14T00:00:00.000Z'),
        new Date('2026-11-28T00:00:00.000Z'),
      ],
    ]);
  });
});

describe('InstallationStatsService: a model without a price', () => {
  const USAGE = [
    spent('a1', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
    spent('a1', '2026-11-25', HOUSE, 3_000_000, 300_000, 30),
    // Beacon ran nothing but the model with no price.
    spent('a2', '2026-11-26', HOUSE, 5_000_000, 500_000, 50),
    spent('a2', '2026-11-18', HOUSE, 5_000_000, 500_000, 50),
  ];

  it('names it in `unpriced` and marks it in the legend', async () => {
    const stats = await view({ usage: USAGE }, 7);

    expect(stats.board.cost.unpriced).toEqual([HOUSE]);
    expect(stats.models).toEqual([
      { model: HOUSE, priced: false },
      { model: SONNET, priced: true },
    ]);
  });

  it('leaves it out of every cost, and never out of the tokens and calls', async () => {
    const stats = await view({ usage: USAGE }, 7);
    const sonnetOnly = costUsd(SONNET, 1_000_000, 100_000);

    expect(stats.board.cost.value).toBe(sonnetOnly);
    expect(stats.board.cost.previous).toBe(0);
    expect(stats.board.tokens).toEqual({ input: 9_000_000, output: 900_000 });
    expect(stats.board.calls.value).toBe(90);
    // Six finished days of the period (21 to 26 November), today left out.
    expect(stats.projection30d).toBeCloseTo((sonnetOnly / 6) * 30, 10);
    const byDate = new Map(stats.daily.map((d) => [d.date, d]));
    expect(byDate.get('2026-11-25')).toEqual({
      date: '2026-11-25',
      cost: sonnetOnly,
      byModel: [
        { model: HOUSE, tokens: 3_300_000 },
        { model: SONNET, tokens: 1_100_000 },
      ],
    });
    // A day of the unpriced model alone: its tokens, and no cost.
    expect(byDate.get('2026-11-26')).toEqual({
      date: '2026-11-26',
      cost: 0,
      byModel: [{ model: HOUSE, tokens: 5_500_000 }],
    });
  });

  it('gives an agent that ran only that model no cost at all, and lists it after the priced ones', async () => {
    const stats = await view({ usage: USAGE }, 7);

    expect(stats.agents).toEqual([
      {
        agentId: 'a1',
        name: 'Atlas',
        removed: false,
        // Most of its tokens went to the model with no price.
        model: HOUSE,
        tokens: 4_400_000,
        calls: 40,
        // The priced part of what it ran, and the mark that says it is
        // only a part.
        cost: costUsd(SONNET, 1_000_000, 100_000),
        partial: true,
      },
      {
        agentId: 'a2',
        name: 'Beacon',
        removed: false,
        model: HOUSE,
        tokens: 5_500_000,
        calls: 50,
        // No cost at all is not a part of one.
        cost: null,
        partial: false,
      },
    ]);
  });

  it('does not mark an agent whose models all have a price', async () => {
    const stats = await view(
      {
        usage: [
          spent('a1', '2026-11-25', SONNET, 1_000_000, 0, 1),
          spent('a1', '2026-11-25', HAIKU, 1_000_000, 0, 1),
        ],
      },
      7,
    );

    expect(stats.agents.map((a) => a.partial)).toEqual([false]);
  });
});

describe('InstallationStatsService: spend by day', () => {
  it('has one entry for every UTC day of the period, oldest first, today last', async () => {
    const stats = await view({}, 7);

    expect(stats.daily.map((d) => d.date)).toEqual([
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ]);
    expect((await view({}, 30)).daily).toHaveLength(30);
    expect((await view({}, 90)).daily).toHaveLength(90);
    expect((await view({}, 90)).daily[0].date).toBe('2026-08-30');
  });

  it('adds the agents of a day together by model, most tokens first, with the day’s cost', async () => {
    const stats = await view(
      {
        usage: [
          spent('a1', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
          spent('a2', '2026-11-25', SONNET, 500_000, 50_000, 5),
          spent('a2', '2026-11-25', HAIKU, 4_000_000, 400_000, 40),
        ],
      },
      7,
    );

    const day = stats.daily.find((d) => d.date === '2026-11-25');
    expect(day?.byModel).toEqual([
      { model: HAIKU, tokens: 4_400_000 },
      { model: SONNET, tokens: 1_650_000 },
    ]);
    expect(day?.cost).toBeCloseTo(
      costUsd(SONNET, 1_500_000, 150_000) + costUsd(HAIKU, 4_000_000, 400_000),
      10,
    );
    // The other six days are there, with nothing.
    expect(stats.daily.filter((d) => d.byModel.length === 0)).toHaveLength(6);
  });

  it('adds up to the board', async () => {
    const stats = await view(
      {
        usage: [
          spent('a1', '2026-11-21', SONNET, 1_000_000, 100_000, 10),
          spent('a2', '2026-11-24', HAIKU, 4_000_000, 400_000, 40),
          spent('a3', '2026-11-27', SONNET, 2_000_000, 200_000, 20),
        ],
      },
      7,
    );

    expect(stats.daily.reduce((sum, d) => sum + d.cost, 0)).toBeCloseTo(
      stats.board.cost.value,
      10,
    );
  });
});

describe('InstallationStatsService: agents by cost', () => {
  it('ranks by cost, most first, with the model that took most of each agent’s tokens', async () => {
    const stats = await view(
      {
        usage: [
          spent('a1', '2026-11-25', HAIKU, 1_000_000, 100_000, 10),
          spent('a2', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
          spent('a2', '2026-11-26', HAIKU, 300_000, 30_000, 3),
          spent('a3', '2026-11-25', SONNET, 5_000_000, 500_000, 50),
        ],
      },
      7,
    );

    expect(
      stats.agents.map((a) => [a.name, a.model, a.tokens, a.calls]),
    ).toEqual([
      ['Cipher', SONNET, 5_500_000, 50],
      ['Beacon', SONNET, 1_430_000, 13],
      ['Atlas', HAIKU, 1_100_000, 10],
    ]);
    expect(stats.agents[1].cost).toBeCloseTo(
      costUsd(SONNET, 1_000_000, 100_000) + costUsd(HAIKU, 300_000, 30_000),
      10,
    );
  });

  it('orders the agents with no price among themselves by tokens', async () => {
    const stats = await view(
      {
        usage: [
          spent('a1', '2026-11-25', HOUSE, 1_000_000, 0, 1),
          spent('a2', '2026-11-25', HOUSE, 9_000_000, 0, 1),
          spent('a3', '2026-11-25', HAIKU, 10, 10, 1),
        ],
      },
      7,
    );

    expect(stats.agents.map((a) => [a.name, a.cost === null])).toEqual([
      ['Cipher', false],
      ['Beacon', true],
      ['Atlas', true],
    ]);
  });

  it('projects 30 days at the pace of the period’s finished days', async () => {
    const usage = [
      spent('a1', '2026-11-22', SONNET, 7_000_000, 0, 10),
      spent('a1', '2026-10-30', SONNET, 2_000_000, 0, 10),
    ];

    // The 7-day view reads back to 14 November and finds nothing before the
    // 22nd: $21 over the five finished days from then, 22 to 26 November,
    // is $126 in 30.
    expect((await view({ usage }, 7)).projection30d).toBeCloseTo(126, 10);
    // The longer views see the report of 30 October, inside both: $27 over
    // the 28 days from then to yesterday, whichever of the two is asked for.
    const sinceFirstReport = (27 / 28) * 30;
    expect((await view({ usage }, 30)).projection30d).toBeCloseTo(
      sinceFirstReport,
      10,
    );
    expect((await view({ usage }, 90)).projection30d).toBeCloseTo(
      sinceFirstReport,
      10,
    );
  });

  it('leaves today out of the projection: its row is still being added to', async () => {
    const usage = [
      // Reported before the 7 days began, so all six finished ones count.
      spent('a1', '2026-11-20', SONNET, 1, 0, 1),
      // $3 a day on each of them.
      ...['21', '22', '23', '24', '25', '26'].map((day) =>
        spent('a1', `2026-11-${day}`, SONNET, 1_000_000, 0, 1),
      ),
      // Half past ten in the morning: a tenth of the day's usage so far.
      spent('a1', '2026-11-27', SONNET, 100_000, 0, 1),
    ];

    // $3 a day is $90 in 30, not the $78.43 that counting today's part as a day
    // would give.
    expect((await view({ usage }, 7)).projection30d).toBeCloseTo(90, 10);
  });

  it('has no projection while the only usage is today’s', async () => {
    const usage = [spent('a1', '2026-11-27', SONNET, 1_000_000, 0, 1)];

    expect((await view({ usage }, 7)).projection30d).toBeNull();
  });

  // From the second review: the page printed "≈ $0.00 in 30 days" above
  // rows that all said "no price". The sum of models with no price is not a
  // pace of nothing, it is no pace.
  it('has no projection when every model of the finished days has no price: null, not 0', async () => {
    const usage = [
      spent('a1', '2026-11-22', HOUSE, 7_000_000, 700_000, 10),
      spent('a2', '2026-11-25', HOUSE, 2_000_000, 200_000, 4),
      // A priced model today only: today is in no pace.
      spent('a1', '2026-11-27', SONNET, 1_000_000, 0, 1),
    ];

    for (const period of [7, 30, 90] as const) {
      expect((await view({ usage }, period)).projection30d).toBeNull();
    }
  });

  it('projects the pace of the priced models when priced and unpriced ones ran', async () => {
    const usage = [
      spent('a1', '2026-11-22', SONNET, 5_000_000, 0, 10),
      spent('a1', '2026-11-22', HOUSE, 9_000_000, 900_000, 10),
      spent('a2', '2026-11-25', HOUSE, 2_000_000, 200_000, 4),
    ];

    // $15 of Sonnet over the five finished days from the 22nd is $90 in 30.
    expect((await view({ usage }, 7)).projection30d).toBeCloseTo(90, 10);
  });

  // A known zero, and not the case above: the model has a price, and what
  // it ran cost nothing.
  it('projects 0 for a priced model that cost exactly nothing', async () => {
    const usage = [spent('a1', '2026-11-22', SONNET, 0, 0, 3)];

    expect((await view({ usage }, 7)).projection30d).toBe(0);
  });

  // The rule is one: a row of a priced model among the days that are
  // summed. A period nobody ran anything in has none, whatever the period
  // before it held, so it has no pace to state either.
  it('has no projection when priced usage is only in the period before and nothing ran in this one: null', async () => {
    const usage = [
      spent('a1', '2026-11-16', SONNET, 7_000_000, 0, 10),
      spent('a1', '2026-11-20', SONNET, 1_000_000, 0, 2),
    ];

    const stats = await view({ usage }, 7);

    expect(stats.board.cost.value).toBe(0);
    expect(stats.board.cost.previous).toBeCloseTo(24, 10);
    expect(stats.projection30d).toBeNull();
  });
});

describe('InstallationStatsService: an agent that no longer exists', () => {
  // `gone` reported usage under the name Dodo and was deleted since: its
  // rows remain (FR-031), and no agent has that id.
  const USAGE = [
    spent('a1', '2026-11-25', SONNET, 1_000_000, 100_000, 10),
    spent('gone', '2026-11-24', SONNET, 2_000_000, 200_000, 20, 'Dodo'),
    spent(
      'gone',
      '2026-11-23',
      SONNET,
      1_000_000,
      100_000,
      10,
      'Dodo, earlier',
    ),
  ];

  it('is listed under the name stored with its usage, marked removed, for a caller with no list', async () => {
    const { access, owner } = callers();
    const stats = await view({ usage: USAGE }, 7, owner, access);

    expect(stats.agents[0]).toMatchObject({
      agentId: 'gone',
      // The name of its latest report.
      name: 'Dodo',
      removed: true,
      model: SONNET,
      tokens: 3_300_000,
      calls: 30,
    });
    expect(stats.agents[0].cost).toBeCloseTo(
      costUsd(SONNET, 3_000_000, 300_000),
      10,
    );
    expect(stats.agents[1]).toMatchObject({ agentId: 'a1', removed: false });
    expect(stats.board.calls.value).toBe(40);
    // It is not one of the agents the caller reaches now.
    expect(stats.reach.agents).toBe(3);
  });

  it('is still there for a caller who is not limited and has another agent denied', async () => {
    const { access, excluding } = callers();
    const stats = await view({ usage: USAGE }, 7, excluding, access);

    expect(stats.agents.map((a) => a.agentId)).toEqual(['gone', 'a1']);
    expect(stats.board.calls.value).toBe(40);
  });

  // An allowed list names the agents a caller may see. A deleted agent is
  // on nobody's list, so its spend is in nothing such a caller is shown.
  it('is absent, and in no total, for a caller limited to a list', async () => {
    const { access, limited } = callers();
    const stats = await view({ usage: USAGE }, 7, limited, access);

    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
    expect(stats.board.calls.value).toBe(10);
    expect(stats.board.tokens.input).toBe(1_000_000);
    expect(JSON.stringify(stats)).not.toContain('Dodo');
  });

  it('is shown by its id when no report ever stored a name', async () => {
    const stats = await view(
      { usage: [spent('gone', '2026-11-24', SONNET, 1, 1, 1)] },
      7,
    );

    expect(stats.agents[0]).toMatchObject({
      agentId: 'gone',
      name: 'gone',
      removed: true,
    });
  });

  it('shows a living agent under the name it has now, whatever its rows say', async () => {
    const stats = await view(
      { usage: [spent('a1', '2026-11-24', SONNET, 1, 1, 1, 'Old Atlas')] },
      7,
    );

    expect(stats.agents[0]).toMatchObject({ name: 'Atlas', removed: false });
  });
});

describe('InstallationStatsService: people in conversations', () => {
  it('counts each person once, however many agents and conversations they wrote in', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c1', 'a1', 'u1', '2026-11-25T10:00:00Z'),
          hour('c2', 'a2', 'u1', '2026-11-26T09:00:00Z'),
          hour('c3', 'a2', 'u2', '2026-11-26T09:00:00Z'),
        ],
      },
      7,
    );

    expect(stats.board.people.value).toBe(2);
  });

  it('counts only people who wrote: an hour of answers alone is nobody', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'u2', '2026-11-25T09:00:00Z', { userMessages: 0 }),
        ],
      },
      7,
    );

    expect(stats.board.people.value).toBe(1);
    expect(stats.quality[0].conversations).toBe(1);
  });

  it('leaves out scheduled jobs and other agents’ questions, in people and in conversations', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'cron', '2026-11-25T09:00:00Z', {
            channel: 'internal',
          }),
          hour('c3', 'a1', 'heartbeat', '2026-11-25T10:00:00Z', {
            channel: 'internal',
          }),
          hour('c4', 'a1', 'peer:connection-1:ctx-9', '2026-11-25T11:00:00Z'),
        ],
      },
      7,
    );

    expect(stats.board.people.value).toBe(1);
    expect(stats.quality).toEqual([
      { agentId: 'a1', name: 'Atlas', conversations: 1, down: 0, rated: 0 },
    ]);
    expect(stats.channels).toEqual([{ channel: 'console', conversations: 1 }]);
  });

  it('compares with the people of the period before, a person who wrote in both counted in both', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'u2', '2026-11-21T00:00:00Z'),
          // The last hour before the period, and the first of the previous.
          hour('c3', 'a1', 'u1', '2026-11-20T23:00:00Z'),
          hour('c4', 'a1', 'u3', '2026-11-14T00:00:00Z'),
          hour('c5', 'a1', 'u4', '2026-11-16T12:00:00Z'),
          // Before both.
          hour('c6', 'a1', 'u5', '2026-11-13T23:00:00Z'),
        ],
      },
      7,
    );

    expect(stats.board.people).toEqual({ value: 2, previous: 3 });
  });
});

describe('InstallationStatsService: channels', () => {
  it('names the console, a share link, the messengers, and anything else as `other`', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'u2', '2026-11-25T09:00:00Z'),
          hour('c3', 'a2', 'admin', '2026-11-25T09:00:00Z'),
          hour('c4', 'a1', 'share-visitor-1', '2026-11-25T09:00:00Z'),
          hour('c5', 'a1', 'share-visitor-2', '2026-11-25T09:00:00Z'),
          hour('c6', 'a2', '77001', '2026-11-25T09:00:00Z', {
            channel: 'telegram',
          }),
          hour('c7', 'a2', 'U0ABC', '2026-11-25T09:00:00Z', {
            channel: 'slack',
          }),
          hour('c8', 'a3', '+15550100', '2026-11-25T09:00:00Z', {
            channel: 'whatsapp',
          }),
          hour('c9', 'a3', 'someone', '2026-11-25T09:00:00Z', {
            channel: 'email',
          }),
          hour('c10', 'a3', 'someone', '2026-11-26T09:00:00Z', {
            channel: 'email',
          }),
        ],
      },
      7,
    );

    expect(stats.channels).toEqual([
      { channel: 'console', conversations: 3 },
      { channel: 'other', conversations: 3 },
      { channel: 'share', conversations: 2 },
      { channel: 'slack', conversations: 1 },
      { channel: 'telegram', conversations: 1 },
    ]);
  });

  it('counts a conversation once, however many hours and days it was written in', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-22T09:00:00Z'),
          hour('c1', 'a1', 'u1', '2026-11-22T10:00:00Z'),
          hour('c1', 'a1', 'u1', '2026-11-26T18:00:00Z'),
        ],
      },
      7,
    );

    expect(stats.channels).toEqual([{ channel: 'console', conversations: 1 }]);
    expect(stats.quality[0].conversations).toBe(1);
  });

  it('adds up to the conversations of the agents', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'share-x', '2026-11-25T09:00:00Z'),
          hour('c3', 'a2', '77001', '2026-11-25T09:00:00Z', {
            channel: 'telegram',
          }),
        ],
      },
      7,
    );

    const sum = (rows: { conversations: number }[]) =>
      rows.reduce((total, row) => total + row.conversations, 0);
    expect(sum(stats.channels)).toBe(3);
    expect(sum(stats.quality)).toBe(3);
  });
});

describe('InstallationStatsService: quality', () => {
  it('gives each agent its conversations and its ratings, the poor ones among all', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a1', 'u2', '2026-11-25T09:00:00Z'),
          hour('c3', 'a1', 'share-x', '2026-11-25T09:00:00Z'),
          hour('c4', 'a2', 'u1', '2026-11-25T09:00:00Z'),
        ],
        ratings: [
          { agentId: 'a1', rating: 1, at: '2026-11-25T09:05:00Z' },
          { agentId: 'a1', rating: -1, at: '2026-11-25T09:06:00Z' },
          { agentId: 'a1', rating: -1, at: '2026-11-26T09:06:00Z' },
          { agentId: 'a2', rating: 1, at: '2026-11-21T00:00:00Z' },
          // Before the period, and not counted.
          { agentId: 'a2', rating: -1, at: '2026-11-20T23:59:59Z' },
        ],
      },
      7,
    );

    expect(stats.quality).toEqual([
      { agentId: 'a1', name: 'Atlas', conversations: 3, down: 2, rated: 3 },
      { agentId: 'a2', name: 'Beacon', conversations: 1, down: 0, rated: 1 },
    ]);
  });

  it('orders by conversations, most first, and lists an agent that was only rated', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a2', 'u1', '2026-11-25T09:00:00Z'),
          hour('c2', 'a2', 'u2', '2026-11-25T09:00:00Z'),
          hour('c3', 'a3', 'u1', '2026-11-25T09:00:00Z'),
        ],
        // A rating given this week on an answer of an older conversation.
        ratings: [{ agentId: 'a1', rating: -1, at: '2026-11-25T09:05:00Z' }],
      },
      7,
    );

    expect(stats.quality).toEqual([
      { agentId: 'a2', name: 'Beacon', conversations: 2, down: 0, rated: 0 },
      { agentId: 'a3', name: 'Cipher', conversations: 1, down: 0, rated: 0 },
      { agentId: 'a1', name: 'Atlas', conversations: 0, down: 1, rated: 1 },
    ]);
  });

  // Summaries of version 2 are not shipped: the share left open has nothing
  // to be read from yet, and the page says "not counted yet" for it.
  it('does not say how many conversations were left open, or summarised', async () => {
    const stats = await view(
      { hours: [hour('c1', 'a1', 'u1', '2026-11-25T09:00:00Z')] },
      7,
    );

    expect(Object.keys(stats.quality[0]).sort()).toEqual([
      'agentId',
      'conversations',
      'down',
      'name',
      'rated',
    ]);
  });
});

describe('InstallationStatsService: health', () => {
  it('lists the incidents opened in the period and the ones still open, newest first', async () => {
    const stats = await view(
      {
        incidents: [
          incident(11, 'a1', '2026-11-22T08:00:00Z', '2026-11-22T08:40:00Z'),
          incident(12, 'a2', '2026-11-26T15:00:00Z'),
          // Open since October.
          incident(7, 'a3', '2026-10-02T03:00:00Z'),
          // Opened and closed before the period.
          incident(9, 'a1', '2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z'),
          // Opened before the period, closed in it: not this period's.
          incident(10, 'a1', '2026-11-20T23:00:00Z', '2026-11-21T02:00:00Z'),
        ],
      },
      7,
    );

    expect(stats.health.incidents).toEqual([
      {
        number: 12,
        agentName: 'agent-of-#12',
        open: true,
        reason: 'reason-of-#12',
        openedAt: new Date('2026-11-26T15:00:00Z'),
        closedAt: null,
      },
      {
        number: 11,
        agentName: 'agent-of-#11',
        open: false,
        reason: 'reason-of-#11',
        openedAt: new Date('2026-11-22T08:00:00Z'),
        closedAt: new Date('2026-11-22T08:40:00Z'),
      },
      {
        number: 7,
        agentName: 'agent-of-#7',
        open: true,
        reason: 'reason-of-#7',
        openedAt: new Date('2026-10-02T03:00:00Z'),
        closedAt: null,
      },
    ]);
    expect(stats.health.incidentsTotal).toBe(3);
  });

  it('asks for the period, the caller’s agents and the cap', async () => {
    const { access, limited } = callers();
    const { service, reads } = installationHarness({ agents: AGENTS }, access);

    await service.forCaller(limited, { period: 30 }, NOW);

    expect(reads.events.incidentsInRange.calls).toEqual([
      [
        {
          from: new Date('2026-10-29T00:00:00.000Z'),
          to: NOW,
          agentScope: { in: ['a1', 'a2'] },
          limit: INCIDENTS_SHOWN,
        },
      ],
    ]);
  });

  it('shows the newest up to the cap and says how many there are', async () => {
    const many = Array.from({ length: INCIDENTS_SHOWN + 7 }, (_, i) =>
      incident(
        i + 1,
        'a1',
        new Date(Date.parse('2026-11-21T00:00:00Z') + i * 60_000).toISOString(),
        '2026-11-27T00:00:00Z',
      ),
    );

    const stats = await view({ incidents: many }, 7);

    expect(stats.health.incidents).toHaveLength(INCIDENTS_SHOWN);
    expect(stats.health.incidents[0].number).toBe(INCIDENTS_SHOWN + 7);
    expect(stats.health.incidentsTotal).toBe(INCIDENTS_SHOWN + 7);
  });

  // As the incident list of the console: an incident of a deleted agent
  // names no agent, so only a caller nothing is hidden from is shown it.
  it('shows an incident of a deleted agent to the Owner and to no limited caller', async () => {
    const all = callers();
    const world = {
      incidents: [incident(5, null, '2026-11-24T08:00:00Z', null, 'Dodo')],
    };

    expect(
      (await view(world, 7, all.owner, all.access)).health.incidents,
    ).toHaveLength(1);
    for (const who of ['limited', 'excluding'] as const) {
      const stats = await view(world, 7, all[who], all.access);
      expect(stats.health).toMatchObject({ incidents: [], incidentsTotal: 0 });
    }
  });

  it('sums the refusals of the period per agent, and lists only agents that refused', async () => {
    const stats = await view(
      {
        loadDays: [
          { agentId: 'a1', day: '2026-11-21', refused: 4, accepted: 100 },
          { agentId: 'a1', day: '2026-11-27', refused: 6, accepted: 80 },
          { agentId: 'a2', day: '2026-11-25', refused: 0, accepted: 900 },
          { agentId: 'a3', day: '2026-11-25', refused: 25 },
          // The day before the period.
          { agentId: 'a2', day: '2026-11-20', refused: 50 },
        ],
      },
      7,
    );

    expect(stats.health.refusals).toEqual([
      { agentId: 'a3', name: 'Cipher', refused: 25 },
      { agentId: 'a1', name: 'Atlas', refused: 10 },
    ]);
  });

  it('reads the refusals of the period’s UTC days, today included', async () => {
    const { service, reads } = installationHarness(
      { agents: AGENTS },
      callers().access,
    );

    await service.forCaller(person(OWNER), { period: 7 }, NOW);

    const [agentIds, from, to] = reads.limits.loadDays.calls[0];
    expect([...agentIds].sort()).toEqual(['a1', 'a2', 'a3']);
    expect(from).toEqual(new Date('2026-11-21T00:00:00.000Z'));
    expect(to).toEqual(new Date('2026-11-28T00:00:00.000Z'));
  });
});

describe('InstallationStatsService: since when a figure is counted', () => {
  it('carries a note for activity and for refusals when either starts inside the two periods', async () => {
    const stats = await view(
      {
        completeSince: {
          activity: '2026-11-18T08:00:00.000Z',
          refusals: '2026-11-15T00:00:00.000Z',
        },
      },
      7,
    );

    expect(stats.notes).toEqual([
      {
        figure: 'activity',
        completeSince: new Date('2026-11-18T08:00:00.000Z'),
      },
      {
        figure: 'refusals',
        completeSince: new Date('2026-11-15T00:00:00.000Z'),
      },
    ]);
  });

  it('carries none for a figure complete since before the previous period began', async () => {
    const stats = await view(
      {
        completeSince: {
          activity: '2026-11-14T00:00:00.000Z',
          refusals: '2026-10-01T00:00:00.000Z',
        },
      },
      7,
    );

    expect(stats.notes).toEqual([]);
  });

  // Spend is read where it is recorded (CLEAN-262): a stale row for it is
  // not a reason to say "counted since".
  it('never carries one for spend', async () => {
    const stats = await view(
      { completeSince: { spend: '2026-11-25T00:00:00.000Z' } },
      7,
    );

    expect(stats.notes).toEqual([]);
  });
});

describe('InstallationStatsService: nobody is named', () => {
  // FR-021. Every identity below is one a person could be found by, and the
  // stores behind the view hold more: a credential on the agent, the
  // witnesses and the Slack channel of an incident.
  it('holds no identity, no name of a person and nothing that was written', async () => {
    const identities = [
      'user-7f3a',
      'admin',
      'share-visitor-91',
      '380501112233',
      'U0SLACKER',
      'peer:connection-1:ctx-9',
    ];
    const stats = await view(
      {
        hours: [
          hour('chat-1', 'a1', identities[0], '2026-11-25T09:00:00Z'),
          hour('chat-2', 'a1', identities[1], '2026-11-25T09:00:00Z'),
          hour('chat-3', 'a2', identities[2], '2026-11-25T09:00:00Z'),
          hour('chat-4', 'a2', identities[3], '2026-11-25T09:00:00Z', {
            channel: 'telegram',
          }),
          hour('chat-5', 'a3', identities[4], '2026-11-25T09:00:00Z', {
            channel: 'slack',
          }),
          hour('chat-6', 'a3', identities[5], '2026-11-25T09:00:00Z'),
        ],
        ratings: [{ agentId: 'a1', rating: -1, at: '2026-11-25T09:05:00Z' }],
        usage: [spent('a1', '2026-11-25', SONNET, 1_000, 100, 1)],
        loadDays: [{ agentId: 'a1', day: '2026-11-25', refused: 2 }],
        incidents: [incident(3, 'a1', '2026-11-25T08:00:00Z')],
      },
      7,
    );

    const text = JSON.stringify(stats);
    for (const identity of identities) expect(text).not.toContain(identity);
    // No conversation is named either: a figure is a count.
    expect(text).not.toContain('chat-');
    // And nothing of what the stores hold beside the figures.
    expect(text).not.toContain('config-of-');
    expect(text).not.toContain('llm-of-');
    expect(text).not.toContain('cluster-watcher');
    expect(text).not.toContain('C-ops-secret');
    expect(stats.board.people.value).toBe(5);
  });

  it('answers exactly the blocks of the contract, and no other', async () => {
    const stats = await view({}, 7);

    expect(Object.keys(stats).sort()).toEqual([
      'agents',
      'board',
      'channels',
      'daily',
      'health',
      'models',
      'notes',
      'period',
      'projection30d',
      'quality',
      'range',
      'reach',
    ]);
    expect(Object.keys(stats.health).sort()).toEqual([
      'incidents',
      'incidentsTotal',
      'refusals',
    ]);
  });
});
