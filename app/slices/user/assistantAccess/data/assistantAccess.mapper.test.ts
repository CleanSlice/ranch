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
      areas: [
        { key: 'agents', title: 'Agents', offered: 8, available: 15, abilities: [] },
      ],
    });
  });

  test('reads an area’s abilities: theirs, theirs on own agents, not theirs', () => {
    const mine = read({
      enabled: true,
      level: 'standard',
      areas: [
        {
          key: 'agents',
          title: 'Agents',
          offered: 2,
          available: 5,
          abilities: [
            { name: 'delete_agent', title: 'Delete an agent', state: 'own_agents_only' },
            { name: 'import_agent', title: 'Import an agent', state: 'not_included' },
            { name: 'list_agents', title: 'List agents', state: 'included' },
            { name: 'pin_agent', title: 'Pin an agent', state: 'included' },
            { name: 'restart_agent', title: 'Restart an agent', state: 'own_agents_only' },
          ],
        },
      ],
    });
    // Grouped by state; the server's order, by title, kept inside a group.
    expect(mine?.areas[0]?.abilities).toEqual([
      { name: 'list_agents', title: 'List agents', state: 'included' },
      { name: 'pin_agent', title: 'Pin an agent', state: 'included' },
      { name: 'delete_agent', title: 'Delete an agent', state: 'own_agents_only' },
      { name: 'restart_agent', title: 'Restart an agent', state: 'own_agents_only' },
      { name: 'import_agent', title: 'Import an agent', state: 'not_included' },
    ]);
  });

  test('a state it does not know reads as not included, a broken ability is dropped', () => {
    const mine = read({
      enabled: true,
      level: 'custom',
      areas: [
        {
          key: 'agents',
          abilities: [
            { name: 'a', title: 'A', state: 'sometimes' },
            { name: 'b', state: 'included' },
            { title: 'no name', state: 'included' },
            null,
          ],
        },
      ],
    });
    expect(mine?.areas[0]?.abilities).toEqual([
      { name: 'b', title: 'b', state: 'included' },
      { name: 'a', title: 'A', state: 'not_included' },
    ]);
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
      { key: 'agents', title: 'agents', offered: 0, available: 4, abilities: [] },
    ]);
  });

  test('off is read as off', () => {
    expect(read({ enabled: false, level: 'basic', areas: [] })?.enabled).toBe(false);
  });
});
