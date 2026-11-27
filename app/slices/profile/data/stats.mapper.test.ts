// The statistics mapper (CLEAN-258): the one place an instant is parsed. What
// is tested here is what the page relies on: instants become dates, a
// calendar day stays the string it was, and a date that cannot be read
// removes its line instead of inventing one.

import { describe, expect, test } from 'bun:test';

import type { MyStatsDto } from '#api/data/repositories/api/types.gen';
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
