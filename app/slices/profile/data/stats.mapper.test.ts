// The statistics mapper (CLEAN-258): the one place an instant is parsed. What
// is tested here is what the page relies on: instants become dates, a
// calendar day stays the string it was, and a date that cannot be read
// removes its line instead of inventing one.

import { describe, expect, test } from 'bun:test';

import type {
  InstallationStatsDto,
  MyStatsDto,
} from '#api/data/repositories/api/types.gen';
import { StatsMapper } from './stats.mapper';

function dto(): MyStatsDto {
  return {
    period: 30,
    timeZone: 'Europe/Kyiv',
    range: {
      from: '2026-10-28T22:00:00.000Z',
      to: '2026-11-27T10:00:00.000Z',
      previousFrom: '2026-09-28T21:00:00.000Z',
    },
    notes: [
      { figure: 'activity', completeSince: '2026-11-10T22:00:00.000Z' },
      { figure: 'ratings', completeSince: 'not a date' },
    ],
    board: {
      conversations: { value: 12, previous: 8 },
      messages: { value: 96, previous: 40 },
      agents: { value: 2, reachable: 5 },
    },
    activity: {
      days: [
        { date: '2026-11-26', conversations: 1 },
        { date: '2026-11-27', conversations: 3 },
      ],
      weekdays: [1, 0, 0, 0, 3, 0, 0],
      activeDays: 2,
    },
    agents: [
      {
        agentId: 'a1',
        name: 'Support Desk',
        messages: 70,
        conversations: 9,
        model: 'claude-sonnet-4-6',
        lastMessageAt: '2026-11-27T09:30:00.000Z',
      },
      {
        agentId: 'a2',
        name: 'Night Watch',
        messages: 26,
        conversations: 3,
        model: null,
        lastMessageAt: null,
      },
    ],
    help: {
      cited: { conversations: 4, sources: [{ name: 'web', citations: 6 }] },
      handovers: { total: 2, answered: 1, topPeer: { name: 'Research', count: 2 } },
      ratings: { up: 3, down: 1 },
    },
    models: { items: [{ model: 'claude-sonnet-4-6', messages: 96 }], fallback: true },
  };
}

describe('StatsMapper.toPersonal', () => {
  const view = new StatsMapper().toPersonal(dto());

  test('instants become dates, once', () => {
    expect(view.range.from.toISOString()).toBe('2026-10-28T22:00:00.000Z');
    expect(view.range.to.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(view.range.previousFrom.toISOString()).toBe('2026-09-28T21:00:00.000Z');
    expect(view.agents[0]!.lastMessageAt!.toISOString()).toBe('2026-11-27T09:30:00.000Z');
  });

  test('a calendar day stays the string the API sent', () => {
    expect(view.activity.days).toEqual([
      { date: '2026-11-26', conversations: 1 },
      { date: '2026-11-27', conversations: 3 },
    ]);
  });

  test('a note whose date cannot be read is left out', () => {
    expect(view.notes.map((note) => note.figure)).toEqual(['activity']);
    expect(view.notes[0]!.completeSince.toISOString()).toBe('2026-11-10T22:00:00.000Z');
  });

  test('a missing model and a missing last message stay missing', () => {
    expect(view.agents[1]!.model).toBe(null);
    expect(view.agents[1]!.lastMessageAt).toBe(null);
  });

  test('counts and names pass through as received', () => {
    expect(view.board).toEqual(dto().board);
    expect(view.activity.weekdays).toEqual([1, 0, 0, 0, 3, 0, 0]);
    expect(view.help).toEqual(dto().help);
    expect(view.models).toEqual(dto().models);
    expect(view.agents[0]!.name).toBe('Support Desk');
    expect(view.period).toBe(30);
    expect(view.timeZone).toBe('Europe/Kyiv');
  });
});

// The installation view (CLEAN-265). The same rules, and two of its own: a
// cost nobody could compute stays "no cost" and never becomes a zero, and
// what the server worded (a reason, a name) passes through untouched.

function installationDto(): InstallationStatsDto {
  return {
    period: 30,
    range: {
      from: '2026-10-29T00:00:00.000Z',
      to: '2026-11-27T10:30:00.000Z',
      previousFrom: '2026-09-29T00:00:00.000Z',
    },
    reach: { limited: true, agents: 2, ownerOnly: [] },
    notes: [
      { figure: 'activity', completeSince: '2026-11-24T08:00:00.000Z' },
      { figure: 'refusals', completeSince: 'not a date' },
    ],
    board: {
      tokens: { input: 48_200_000, output: 3_100_000 },
      calls: { value: 812, previous: 640 },
      cost: { value: 212.4, previous: 187.9, unpriced: ['house-model-1'] },
      people: { value: 17, previous: 12 },
    },
    daily: [
      { date: '2026-11-26', cost: 7.35, byModel: [{ model: 'claude-sonnet-4-6', tokens: 1_650_000 }] },
      { date: '2026-11-27', cost: 0, byModel: [] },
    ],
    models: [
      { model: 'claude-sonnet-4-6', priced: true },
      { model: 'house-model-1', priced: false },
    ],
    agents: [
      {
        agentId: 'a1',
        name: 'Support Bot',
        removed: false,
        model: 'claude-sonnet-4-6',
        tokens: 9_400_000,
        calls: 700,
        cost: 61.2,
        partial: false,
      },
      {
        agentId: 'a2',
        name: 'Night Watch',
        removed: true,
        model: 'house-model-1',
        tokens: 120_000,
        calls: 112,
        cost: null,
        partial: false,
      },
    ],
    projection30d: 212.4,
    health: {
      incidents: [
        {
          number: 12,
          agentName: 'Support Bot',
          open: false,
          reason: 'OOMKilled',
          openedAt: '2026-11-25T08:02:11.000Z',
          closedAt: '2026-11-25T08:40:00.000Z',
        },
        {
          number: 13,
          agentName: 'Night Watch',
          open: true,
          reason: null,
          openedAt: '2026-11-27T09:00:00.000Z',
          closedAt: null,
        },
      ],
      incidentsTotal: 3,
      refusals: [{ agentId: 'a1', name: 'Support Bot', refused: 37 }],
    },
    quality: [{ agentId: 'a1', name: 'Support Bot', conversations: 240, down: 4, rated: 31 }],
    channels: [
      { channel: 'console', conversations: 512 },
      { channel: 'telegram', conversations: 40 },
    ],
  };
}

describe('StatsMapper.toInstallation', () => {
  const view = new StatsMapper().toInstallation(installationDto());

  test('instants become dates, once', () => {
    expect(view.range.from.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(view.range.to.toISOString()).toBe('2026-11-27T10:30:00.000Z');
    expect(view.range.previousFrom.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(view.health.incidents[0]!.openedAt!.toISOString()).toBe('2026-11-25T08:02:11.000Z');
    expect(view.health.incidents[0]!.closedAt!.toISOString()).toBe('2026-11-25T08:40:00.000Z');
  });

  test('a UTC day stays the string the API sent', () => {
    expect(view.daily).toEqual(installationDto().daily);
  });

  test('a note whose date cannot be read is left out', () => {
    expect(view.notes.map((note) => note.figure)).toEqual(['activity']);
    expect(view.notes[0]!.completeSince.toISOString()).toBe('2026-11-24T08:00:00.000Z');
  });

  test('an agent without a price has no cost, not a cost of zero', () => {
    expect(view.agents[0]!.cost).toBe(61.2);
    expect(view.agents[1]!.cost).toBe(null);
    expect(view.agents[1]!.removed).toBe(true);
  });

  test('a cost that did not arrive as a number is no cost either', () => {
    const dto = installationDto();
    (dto.agents[0] as { cost: unknown }).cost = undefined;
    (dto.agents[1] as { cost: unknown }).cost = '0';
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.agents[0]!.cost).toBe(null);
    expect(mapped.agents[1]!.cost).toBe(null);
  });

  // `agents[].partial` and a nullable `projection30d` are read off the
  // answer as it arrives, whatever its type promises: an older API sends
  // neither.
  test('a cost that covers only the priced models of an agent is marked partial', () => {
    const dto = installationDto();
    dto.agents[0]!.partial = true;
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.agents[0]!.partial).toBe(true);
    expect(mapped.agents[0]!.cost).toBe(61.2);
    expect(mapped.agents[1]!.partial).toBe(false);
  });

  test('an answer of an older API, without the mark, is not partial', () => {
    const older = installationDto();
    for (const agent of older.agents) delete (agent as { partial?: unknown }).partial;
    const mapped = new StatsMapper().toInstallation(older);
    expect(mapped.agents[0]!.partial).toBe(false);
    expect(mapped.agents[1]!.partial).toBe(false);
    const dto = installationDto();
    (dto.agents[0] as { partial?: unknown }).partial = 'true';
    expect(new StatsMapper().toInstallation(dto).agents[0]!.partial).toBe(false);
  });

  test('a projection that is missing or null is no projection, not zero', () => {
    for (const absent of [null, undefined, 'soon', Number.NaN]) {
      const dto = installationDto();
      (dto as { projection30d: unknown }).projection30d = absent;
      expect(new StatsMapper().toInstallation(dto).projection30d).toBe(null);
    }
    const none = installationDto();
    delete (none as { projection30d?: unknown }).projection30d;
    expect(new StatsMapper().toInstallation(none).projection30d).toBe(null);
    // A projection of nothing spent is a number and stays one.
    const zero = installationDto();
    zero.projection30d = 0;
    expect(new StatsMapper().toInstallation(zero).projection30d).toBe(0);
  });

  // `reach.ownerOnly` (CLEAN-265): the agents whose conversations are the
  // Owner's alone to read. Read off the answer as it arrives, like `partial`:
  // the cast lets a case put in what the type forbids.
  const withOwnerOnly = (value: unknown) => {
    const dto = installationDto();
    (dto.reach as { ownerOnly?: unknown }).ownerOnly = value;
    return dto;
  };

  test('the agents whose conversations are the Owner’s are named as received', () => {
    const dto = withOwnerOnly(['Ranch', 'Night Watch']);
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.reach).toEqual({ limited: true, agents: 2, ownerOnly: ['Ranch', 'Night Watch'] });
    // A copy: the view shares nothing with the answer.
    (dto.reach as unknown as { ownerOnly: string[] }).ownerOnly.push('another');
    expect(mapped.reach.ownerOnly).toEqual(['Ranch', 'Night Watch']);
  });

  test('anything that is not a list of names is no names', () => {
    // An older API sends no field at all.
    const older = installationDto();
    delete (older.reach as { ownerOnly?: unknown }).ownerOnly;
    expect(new StatsMapper().toInstallation(older).reach.ownerOnly).toEqual([]);
    for (const odd of [null, undefined, 'Ranch', 3, { 0: 'Ranch' }, ['Ranch', 7], [null]]) {
      expect(new StatsMapper().toInstallation(withOwnerOnly(odd)).reach.ownerOnly).toEqual([]);
    }
    expect(new StatsMapper().toInstallation(withOwnerOnly([])).reach.ownerOnly).toEqual([]);
  });

  test('an open incident has no end, and a missing reason stays missing', () => {
    const open = view.health.incidents[1]!;
    expect(open.open).toBe(true);
    expect(open.closedAt).toBe(null);
    expect(open.reason).toBe(null);
    expect(view.health.incidents[0]!.reason).toBe('OOMKilled');
  });

  test('counts, names and the reach pass through as received', () => {
    const dto = installationDto();
    expect(view.period).toBe(30);
    expect(view.reach).toEqual({ limited: true, agents: 2, ownerOnly: [] });
    expect(view.board).toEqual(dto.board);
    expect(view.models).toEqual(dto.models);
    expect(view.projection30d).toBe(212.4);
    expect(view.health.incidentsTotal).toBe(3);
    expect(view.health.refusals).toEqual(dto.health.refusals);
    expect(view.quality).toEqual(dto.quality);
    expect(view.channels).toEqual(dto.channels);
    expect(view.agents[0]!.name).toBe('Support Bot');
  });

  test('the view shares nothing with the answer it was made from', () => {
    const dto = installationDto();
    const mapped = new StatsMapper().toInstallation(dto);
    dto.board.cost.unpriced.push('another');
    dto.daily[0]!.byModel[0]!.tokens = 1;
    expect(mapped.board.cost.unpriced).toEqual(['house-model-1']);
    expect(mapped.daily[0]!.byModel[0]!.tokens).toBe(1_650_000);
  });
});
