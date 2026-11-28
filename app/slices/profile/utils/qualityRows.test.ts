import { describe, expect, test } from 'bun:test';
import {
  anyWithoutSummary,
  MIN_RATED_TO_MARK,
  MIN_SUMMARISED_TO_RANK,
  qualityRows,
} from './qualityRows';

function row(
  agentId: string,
  conversations: number,
  open: number,
  summarised: number,
  down = 0,
  rated = 0,
) {
  return { agentId, name: `Agent ${agentId}`, conversations, down, rated, open, summarised };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('qualityRows: the share left open', () => {
  test('an agent with summaries has its share, of how many, and a whole percent', () => {
    const [only] = qualityRows([row('a', 40, 1, 3)], true);
    expect(only!.openState).toBe('share');
    expect(only!.openShare).toBe(0.33);
    expect(only!.open).toBe(1);
    expect(only!.summarised).toBe(3);
  });

  test('an agent nobody summarised yet has no share, which is not a share of zero', () => {
    const [only] = qualityRows([row('a', 40, 0, 0)], true);
    expect(only!.openState).toBe('none');
    expect(only!.openShare).toBe(null);
    expect(only!.worstOpen).toBe(false);
  });

  test('with summaries off every row is "off", whatever its counts say', () => {
    const rows = qualityRows([row('a', 40, 2, 4), row('b', 10, 0, 0)], false);
    expect(rows.map((r) => r.openState)).toEqual(['off', 'off']);
    expect(rows.map((r) => r.openShare)).toEqual([null, null]);
    expect(rows.map((r) => r.worstOpen)).toEqual([false, false]);
  });

  test('the highest share of the column is marked', () => {
    const rows = qualityRows([row('a', 40, 1, 10), row('b', 30, 5, 10), row('c', 20, 2, 10)], true);
    const marked = rows.filter((r) => r.worstOpen);
    expect(ids(marked)).toEqual(['b']);
  });

  test('equal highest shares are all marked', () => {
    // 2 of 4 and 50 of 100 print the same percent.
    const rows = qualityRows([row('a', 40, 2, 4), row('b', 30, 50, 100), row('c', 20, 1, 10)], true);
    expect(ids(rows.filter((r) => r.worstOpen))).toEqual(['a', 'b']);
  });

  test('nothing is marked while every share is zero', () => {
    const rows = qualityRows([row('a', 40, 0, 10), row('b', 30, 0, 4)], true);
    expect(rows.map((r) => r.worstOpen)).toEqual([false, false]);
    expect(rows.map((r) => r.openShare)).toEqual([0, 0]);
  });

  test('shares that print the same percent are equal, even when the fractions differ', () => {
    // 1 of 3 and 33 of 100 are both 33%.
    const rows = qualityRows([row('a', 40, 1, 3), row('b', 30, 33, 100)], true);
    expect(rows.map((r) => r.worstOpen)).toEqual([true, true]);
  });
});

describe('qualityRows: a share of too few is shown and not compared', () => {
  test('the minimum is three summarised conversations, and three rated answers', () => {
    expect(MIN_SUMMARISED_TO_RANK).toBe(3);
    expect(MIN_RATED_TO_MARK).toBe(3);
  });

  test('1 of 1 left open is not worse news than 60 of 100', () => {
    const rows = qualityRows([row('one', 500, 1, 1), row('many', 100, 60, 100)], true);
    expect(ids(rows)).toEqual(['many', 'one']);
    expect(rows.map((r) => r.worstOpen)).toEqual([true, false]);
    // The small one still shows its percent, and of how many.
    expect(rows[1]!.openState).toBe('share');
    expect(rows[1]!.openShare).toBe(1);
    expect(rows[1]!.open).toBe(1);
    expect(rows[1]!.summarised).toBe(1);
  });

  test('exactly the minimum is enough; one under it is not', () => {
    const rows = qualityRows([row('two', 10, 2, 2), row('three', 10, 2, 3)], true);
    expect(ids(rows)).toEqual(['three', 'two']);
    expect(rows.map((r) => r.worstOpen)).toEqual([true, false]);
  });

  test('with every row under the minimum nothing is marked, and the order is by conversations', () => {
    const rows = qualityRows(
      [row('small', 5, 1, 1), row('large', 60, 0, 2), row('none', 30, 0, 0), row('mid', 20, 2, 2)],
      true,
    );
    expect(rows.map((r) => r.worstOpen)).toEqual([false, false, false, false]);
    expect(ids(rows)).toEqual(['large', 'none', 'mid', 'small']);
  });

  test('rows under the minimum stand after the ranked ones, whatever their share', () => {
    const rows = qualityRows(
      [row('tiny', 90, 2, 2), row('clean', 10, 0, 8), row('unsummarised', 70, 0, 0), row('open', 5, 1, 5)],
      true,
    );
    expect(ids(rows)).toEqual(['open', 'clean', 'tiny', 'unsummarised']);
    expect(ids(rows.filter((r) => r.worstOpen))).toEqual(['open']);
  });

  test('ties: equal ranked shares are all marked; equal rows under the minimum keep the order received', () => {
    const rows = qualityRows(
      [
        row('under-b', 10, 1, 1),
        row('ranked-b', 10, 3, 6),
        row('under-a', 10, 0, 2),
        row('ranked-a', 10, 2, 4),
      ],
      true,
    );
    expect(ids(rows)).toEqual(['ranked-b', 'ranked-a', 'under-b', 'under-a']);
    expect(rows.map((r) => r.worstOpen)).toEqual([true, true, false, false]);
  });

  test('a zero of the ranked rows is not beaten into a mark by a row under the minimum', () => {
    // The only share above zero is of one conversation: nothing is the highest.
    const rows = qualityRows([row('clean', 40, 0, 10), row('one', 30, 1, 1)], true);
    expect(rows.map((r) => r.worstOpen)).toEqual([false, false]);
    expect(ids(rows)).toEqual(['clean', 'one']);
  });
});

describe('qualityRows: the order', () => {
  test('by the share left open, highest first', () => {
    const rows = qualityRows(
      [row('most', 90, 1, 10), row('worst', 10, 6, 10), row('middle', 50, 3, 10)],
      true,
    );
    expect(ids(rows)).toEqual(['worst', 'middle', 'most']);
  });

  test('equal shares by conversations, most first', () => {
    const rows = qualityRows(
      [row('small', 10, 3, 6), row('large', 80, 5, 10), row('mid', 30, 2, 4)],
      true,
    );
    expect(ids(rows)).toEqual(['large', 'mid', 'small']);
  });

  test('equal shares and equal conversations keep the order they came in', () => {
    const rows = qualityRows(
      [row('first', 10, 2, 4), row('second', 10, 3, 6), row('third', 10, 4, 8)],
      true,
    );
    expect(ids(rows)).toEqual(['first', 'second', 'third']);
  });

  test('an agent without a share stands after the agents that have one, even a share of zero', () => {
    const rows = qualityRows(
      [row('unsummarised', 70, 0, 0), row('clean', 20, 0, 5), row('open', 5, 1, 5)],
      true,
    );
    expect(ids(rows)).toEqual(['open', 'clean', 'unsummarised']);
  });

  test('with summaries off the order is the one received', () => {
    const rows = qualityRows([row('b', 10, 0, 0), row('a', 40, 0, 0), row('c', 20, 0, 0)], false);
    expect(ids(rows)).toEqual(['b', 'a', 'c']);
  });

  test('the list it was given is left as it was', () => {
    const given = [row('a', 10, 0, 10), row('b', 20, 5, 10)];
    qualityRows(given, true);
    expect(given.map((r) => r.agentId)).toEqual(['a', 'b']);
  });
});

describe('qualityRows: the thumbs-down share', () => {
  test('out of the rated answers; an agent nobody rated has none', () => {
    const rows = qualityRows([row('a', 40, 0, 0, 1, 3), row('b', 30, 0, 0, 0, 0)], false);
    expect(rows[0]!.downShare).toBe(0.33);
    expect(rows[1]!.downShare).toBe(null);
  });

  test('the highest is marked, equal highest all, none while every share is zero', () => {
    const marked = qualityRows(
      [row('a', 40, 0, 0, 2, 4), row('b', 30, 0, 0, 50, 100), row('c', 20, 0, 0, 1, 10)],
      false,
    );
    expect(marked.map((r) => r.worstDown)).toEqual([true, true, false]);
    const zero = qualityRows([row('a', 40, 0, 0, 0, 4), row('b', 30, 0, 0, 0, 0)], false);
    expect(zero.map((r) => r.worstDown)).toEqual([false, false]);
  });

  test('1 of 1 thumbs down is not marked above 6 of 10, and keeps its percent', () => {
    const rows = qualityRows([row('one', 40, 0, 0, 1, 1), row('many', 30, 0, 0, 6, 10)], false);
    expect(rows.map((r) => r.worstDown)).toEqual([false, true]);
    expect(rows[0]!.downShare).toBe(1);
    // The mark does not move the rows: the order is the share left open's.
    expect(ids(rows)).toEqual(['one', 'many']);
  });

  test('with every agent under three rated answers nothing is marked', () => {
    const rows = qualityRows([row('a', 40, 0, 0, 1, 1), row('b', 30, 0, 0, 1, 2)], false);
    expect(rows.map((r) => r.worstDown)).toEqual([false, false]);
  });

  test('the two marks are independent of each other and of the order', () => {
    const rows = qualityRows([row('a', 40, 1, 10, 9, 10), row('b', 30, 9, 10, 1, 10)], true);
    expect(ids(rows)).toEqual(['b', 'a']);
    expect(rows.map((r) => r.worstOpen)).toEqual([true, false]);
    expect(rows.map((r) => r.worstDown)).toEqual([false, true]);
  });

  test('an empty list is no rows', () => {
    expect(qualityRows([], true)).toEqual([]);
    expect(qualityRows([], false)).toEqual([]);
  });
});

describe('anyWithoutSummary: whether the dash needs its line under the table', () => {
  test('summaries on and an agent with no summarised conversation: yes', () => {
    expect(anyWithoutSummary(qualityRows([row('a', 40, 1, 5), row('b', 10, 0, 0)], true))).toBe(true);
    expect(anyWithoutSummary(qualityRows([row('a', 40, 0, 0)], true))).toBe(true);
  });

  test('every agent has a share, however small its whole: no', () => {
    expect(anyWithoutSummary(qualityRows([row('a', 40, 1, 5), row('b', 10, 1, 1)], true))).toBe(false);
  });

  test('summaries off: no, that dash has a line of its own', () => {
    expect(anyWithoutSummary(qualityRows([row('a', 40, 0, 0)], false))).toBe(false);
  });

  test('no rows: no', () => {
    expect(anyWithoutSummary([])).toBe(false);
  });
});
