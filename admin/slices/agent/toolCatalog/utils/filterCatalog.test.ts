import { describe, expect, test } from 'bun:test';
import { filterCatalog } from './filterCatalog';
import type { IAgentToolCatalog } from '../domain/toolCatalog.types';

const tool = (name: string, title: string, description: string) => ({
  name,
  title,
  description,
  template: `Do «${name}»`,
  destructive: false,
  inPod: true as boolean | null,
});

const catalog: IAgentToolCatalog = {
  agentId: 'a',
  podStartedAt: null,
  listedAt: null,
  groups: [
    {
      key: 'agents',
      title: 'Agents',
      kind: 'builtin',
      afterRestart: false,
      tools: [
        tool('list_agents', 'List agents', 'Every agent with status'),
        tool('restart_agent', 'Restart an agent', 'Replace the pod'),
      ],
    },
    {
      key: 'mcp_servers',
      title: 'MCP servers',
      kind: 'builtin',
      afterRestart: false,
      tools: [tool('register_mcp_server', 'Register an MCP server', 'Add a server')],
    },
    {
      key: 'mcp:srv-1',
      title: 'GitHub',
      kind: 'external',
      description: 'GitHub MCP server',
      afterRestart: false,
      tools: [],
    },
  ],
};

describe('filterCatalog', () => {
  test('returns everything for an empty query and nothing for no catalogue', () => {
    expect(filterCatalog(catalog, '')).toBe(catalog.groups);
    expect(filterCatalog(catalog, '   ')).toBe(catalog.groups);
    expect(filterCatalog(undefined, 'x')).toEqual([]);
  });

  test('matches on title, name and description, case-insensitively, keeping only matching tools', () => {
    const byName = filterCatalog(catalog, 'RESTART_agent');
    expect(byName.map((g) => g.key)).toEqual(['agents']);
    expect(byName[0].tools.map((t) => t.name)).toEqual(['restart_agent']);

    const byDescription = filterCatalog(catalog, 'pod');
    expect(byDescription[0].tools.map((t) => t.name)).toEqual(['restart_agent']);
  });

  test('matches across topics and external servers', () => {
    const r = filterCatalog(catalog, 'mcp');
    expect(r.map((g) => g.key)).toEqual(['mcp_servers', 'mcp:srv-1']);
  });

  test('requires every word to match', () => {
    expect(filterCatalog(catalog, 'register server').map((g) => g.key)).toEqual(['mcp_servers']);
    expect(filterCatalog(catalog, 'register nothing')).toEqual([]);
  });

  test('does not mutate the source groups', () => {
    filterCatalog(catalog, 'restart');
    expect(catalog.groups[0].tools.length).toBe(2);
  });
});
