import { describe, expect, test } from 'bun:test';
import { AssistantAccessMapper } from './assistantAccess.mapper';

const read = (raw: unknown) => new AssistantAccessMapper().toMine(raw);

describe('AssistantAccessMapper.toMine', () => {
  test('reads a level and its areas', () => {
    expect(
      read({
        enabled: true,
        level: 'basic',
        matchesLevel: null,
        areas: [{ key: 'agents', title: 'Agents', offered: 8, available: 15 }],
      }),
    ).toEqual({
      enabled: true,
      level: 'basic',
      areas: [{ key: 'agents', title: 'Agents', offered: 8, available: 15 }],
    });
  });

  test('an answer it cannot read is no answer, not a guessed level', () => {
    expect(read(null)).toBe(null);
    expect(read({ enabled: true, level: 'platinum', areas: [] })).toBe(null);
    expect(read({ level: 'basic', areas: [] })).toBe(null);
  });

  test('a broken area is dropped by itself', () => {
    const mine = read({
      enabled: true,
      level: 'custom',
      areas: [{ key: 'agents', offered: '3', available: 4 }, null, { title: 'x' }],
    });
    expect(mine?.areas).toEqual([
      { key: 'agents', title: 'agents', offered: 0, available: 4 },
    ]);
  });

  test('off is read as off', () => {
    expect(read({ enabled: false, level: 'basic', areas: [] })?.enabled).toBe(false);
  });
});
