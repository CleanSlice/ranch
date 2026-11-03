import { describe, expect, test } from 'bun:test';
import { byRecentEdit, editedThisWeek, isRecent } from './editTime';

const now = new Date('2026-11-03T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('isRecent', () => {
  test('under a day old is recent', () => {
    expect(isRecent(hoursAgo(3), now)).toBe(true);
    expect(isRecent(hoursAgo(23.9), now)).toBe(true);
  });

  test('a day or older is not', () => {
    expect(isRecent(hoursAgo(24), now)).toBe(false);
    expect(isRecent(hoursAgo(72), now)).toBe(false);
  });

  test('a clock in the future or a bad date is not recent', () => {
    expect(isRecent(hoursAgo(-1), now)).toBe(false);
    expect(isRecent('nope', now)).toBe(false);
  });
});

describe('editedThisWeek', () => {
  test('counts the last seven days and names the newest edit', () => {
    const { count, latest } = editedThisWeek(
      [{ updatedAt: hoursAgo(2) }, { updatedAt: hoursAgo(6 * 24) }, { updatedAt: hoursAgo(9 * 24) }],
      now,
    );
    expect(count).toBe(2);
    expect(latest).toBe(hoursAgo(2));
  });

  test('empty library', () => {
    expect(editedThisWeek([], now)).toEqual({ count: 0, latest: null });
  });
});

describe('byRecentEdit', () => {
  test('newest first, name breaks ties', () => {
    const sorted = byRecentEdit([
      { name: 'b', updatedAt: hoursAgo(5) },
      { name: 'a', updatedAt: hoursAgo(5) },
      { name: 'c', updatedAt: hoursAgo(1) },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });
});
