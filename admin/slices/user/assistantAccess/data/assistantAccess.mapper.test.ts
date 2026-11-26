import { describe, expect, test } from 'bun:test';
import { AssistantAccessMapper } from './assistantAccess.mapper';

const mapper = new AssistantAccessMapper();

describe('AssistantAccessMapper.toMine', () => {
  test('reads each area with its abilities: theirs, theirs on own agents, not theirs', () => {
    const mine = mapper.toMine({
      enabled: true,
      level: 'standard',
      matchesLevel: null,
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
    const area = mine?.areas[0];
    expect([area?.key, area?.offered, area?.available]).toEqual(['agents', 2, 5]);
    // Grouped by state; the server's order, by title, kept inside a group.
    expect(mine?.areas[0]?.abilities).toEqual([
      { name: 'list_agents', title: 'List agents', state: 'included' },
      { name: 'pin_agent', title: 'Pin an agent', state: 'included' },
      { name: 'delete_agent', title: 'Delete an agent', state: 'own_agents_only' },
      { name: 'restart_agent', title: 'Restart an agent', state: 'own_agents_only' },
      { name: 'import_agent', title: 'Import an agent', state: 'not_included' },
    ]);
  });

  test('an API that sends counts only gives areas with nothing to open', () => {
    const mine = mapper.toMine({
      enabled: true,
      level: 'basic',
      areas: [{ key: 'agents', title: 'Agents', offered: 9, available: 15 }],
    });
    expect(mine?.areas).toEqual([
      { key: 'agents', title: 'Agents', offered: 9, available: 15, abilities: [] },
    ]);
  });

  test('a state it does not know reads as not included, a broken ability is dropped', () => {
    const mine = mapper.toMine({
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
});

describe('AssistantAccessMapper.toCatalog', () => {
  test('reads which abilities stay with the agent’s creator; unreadable is not marked', () => {
    const catalog = mapper.toCatalog({
      areas: [
        {
          key: 'agents',
          title: 'Agents',
          order: 10,
          abilities: [
            { name: 'get_agent_logs', title: 'Read pod logs', minRole: 'User', ownAgentsOnly: true },
            { name: 'restart_agent', title: 'Restart', minRole: 'User', ownAgentsOnly: false },
            { name: 'list_agents', title: 'List', minRole: 'User' },
          ],
        },
      ],
      alwaysOn: [],
    });
    expect(catalog?.areas[0]?.abilities.map((a) => a.ownAgentsOnly)).toEqual([true, false, false]);
  });
});
