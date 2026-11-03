import { describe, expect, test } from 'bun:test';
import { activityOf } from './activity';

describe('activityOf', () => {
  test('a hand-made skill never edited: Created only', () => {
    expect(
      activityOf({
        createdAt: '2026-10-08T09:12:00.000Z',
        updatedAt: '2026-10-08T09:12:00.400Z',
        source: null,
      }),
    ).toEqual([{ kind: 'created', at: '2026-10-08T09:12:00.000Z' }]);
  });

  test('an imported skill edited later: Last edited above Imported', () => {
    expect(
      activityOf({
        createdAt: '2026-10-08T09:12:00.000Z',
        updatedAt: '2026-10-30T14:12:00.000Z',
        source: 'https://github.com/x/y/blob/HEAD/skills/z/SKILL.md',
      }),
    ).toEqual([
      { kind: 'edited', at: '2026-10-30T14:12:00.000Z' },
      { kind: 'imported', at: '2026-10-08T09:12:00.000Z' },
    ]);
  });
});
