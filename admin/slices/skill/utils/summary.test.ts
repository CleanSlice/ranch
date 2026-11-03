import { describe, expect, test } from 'bun:test';
import { librarySummary, shareOfLibrary, stripSegments } from './summary';

const now = new Date('2026-11-03T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

const skill = (id: string, tokens: number, days: number, templates = 1) => ({
  id,
  name: id,
  tokenEstimate: tokens,
  updatedAt: daysAgo(days),
  templates: Array.from({ length: templates }, (_, i) => ({ id: `t${i}` })),
});

describe('librarySummary', () => {
  test('count, total, edited this week, newest edit, unused slugs', () => {
    const s = librarySummary(
      [skill('alm-api', 2100, 3), skill('skill-creator', 880, 10, 0), skill('runtime-tools', 1100, 1)],
      now,
    );
    expect(s.count).toBe(3);
    expect(s.totalTokens).toBe(4080);
    expect(s.editedThisWeek).toBe(2);
    expect(s.latestEdit).toBe(daysAgo(1));
    expect(s.unused).toEqual(['skill-creator']);
  });

  test('empty library is all zeros', () => {
    expect(librarySummary([], now)).toEqual({
      count: 0,
      totalTokens: 0,
      editedThisWeek: 0,
      latestEdit: null,
      unused: [],
    });
  });
});

describe('stripSegments', () => {
  test('keeps list order and gives a zero-token skill a visible share', () => {
    const segs = stripSegments([skill('b', 0, 1), skill('a', 1700, 1)]);
    expect(segs.map((s) => s.slug)).toEqual(['b', 'a']);
    expect(segs[0]?.grow).toBe(1);
    expect(segs[1]?.grow).toBe(1700);
  });
});

describe('shareOfLibrary', () => {
  test('whole percent', () => {
    expect(shareOfLibrary(1700, 18_900)).toBe(9);
  });

  test('zero on an empty library', () => {
    expect(shareOfLibrary(0, 0)).toBe(0);
  });
});
