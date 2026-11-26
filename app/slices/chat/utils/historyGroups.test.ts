import { describe, expect, test } from 'bun:test';
import { groupClosed } from './historyGroups';

// Built from local parts on purpose: the groups are local calendar days, so
// the test must not depend on the machine's time zone.
const at = (day: number, hour = 12, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();
const NOW = new Date(2026, 10, 26, 15, 30); // Thursday 26 November, 15:30 local

const row = (id: string, lastMessageAt: string) => ({ id, lastMessageAt });
const shape = (groups: ReturnType<typeof groupClosed<{ id: string; lastMessageAt: string }>>) =>
  groups.map((g) => [g.key, g.items.map((i) => i.id)]);

describe('groupClosed', () => {
  test('today, the six days before it, and everything older', () => {
    const groups = groupClosed(
      [
        row('today', at(26, 9)),
        row('yesterday', at(25)),
        row('six-days', at(20)),
        row('seven-days', at(19)),
        row('last-month', new Date(2026, 9, 2).toISOString()),
      ],
      NOW,
    );
    expect(shape(groups)).toEqual([
      ['today', ['today']],
      ['this_week', ['yesterday', 'six-days']],
      ['earlier', ['seven-days', 'last-month']],
    ]);
  });

  test('the day starts at local midnight, not 24 hours ago', () => {
    const groups = groupClosed(
      [row('just-after-midnight', at(26, 0, 10)), row('late-last-night', at(25, 23, 50))],
      NOW,
    );
    expect(shape(groups)).toEqual([
      ['today', ['just-after-midnight']],
      ['this_week', ['late-last-night']],
    ]);
  });

  test('the first day of the week group counts from its midnight', () => {
    const groups = groupClosed(
      [row('edge-in', at(20, 0, 0)), row('edge-out', at(19, 23, 59))],
      NOW,
    );
    expect(shape(groups)).toEqual([
      ['this_week', ['edge-in']],
      ['earlier', ['edge-out']],
    ]);
  });

  test('a group with nothing in it is not returned', () => {
    expect(shape(groupClosed([row('old', at(1))], NOW))).toEqual([['earlier', ['old']]]);
    expect(groupClosed([], NOW)).toEqual([]);
  });

  test('the order inside a group is the order given', () => {
    const groups = groupClosed([row('b', at(24)), row('a', at(25)), row('c', at(23))], NOW);
    expect(shape(groups)).toEqual([['this_week', ['b', 'a', 'c']]]);
  });

  test('a date that cannot be read goes to the oldest group', () => {
    expect(shape(groupClosed([row('broken', 'not a date')], NOW))).toEqual([
      ['earlier', ['broken']],
    ]);
  });

  test('a clock that runs ahead of ours still lands in today', () => {
    expect(shape(groupClosed([row('ahead', at(27, 1))], NOW))).toEqual([['today', ['ahead']]]);
  });
});
