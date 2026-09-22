import { NotFoundException } from '@nestjs/common';
import { ToolCatalogService, agentPrincipal } from './toolCatalog.service';
import type { IListedTool } from '#/mcp/services/tool-catalog.service';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * The catalogue must say exactly what the pod would see, and be honest about
 * whether the running pod already has each tool (data-model.md §3).
 */
const listed = (
  name: string,
  topic: string,
  extra: Partial<IListedTool['metadata']> = {},
): IListedTool => ({
  name,
  description: `desc of ${name}`,
  inputSchema: {},
  metadata: {
    name,
    description: `desc of ${name}`,
    topic: topic as never,
    title: `Title ${name}`,
    template: `Do «${name}»`,
    ...extra,
  },
});

const POD_START = '2026-09-22T10:00:00.000Z';

interface Options {
  agent?: { id: string; isAdmin: boolean } | null;
  tools?: IListedTool[];
  snapshot?: { toolNames: string[]; listedAt: Date } | null;
  pod?: boolean;
  servers?: Array<{
    id: string;
    name: string;
    description: string | null;
    updatedAt: Date;
    url?: string;
    authValue?: string | null;
  }>;
}

function harness(opts: Options = {}) {
  const agent = opts.agent === undefined ? { id: 'agent-1', isAdmin: true } : opts.agent;
  const agents = { findById: jest.fn(async () => agent) };
  const pods = {
    list: jest.fn(async () =>
      opts.pod === false ? [] : [{ agentId: 'agent-1', startedAt: POD_START }],
    ),
  };
  const resolver = {
    resolveForAgent: jest.fn(async () =>
      (opts.servers ?? []).map((s) => ({
        url: 'http://secret.internal',
        authValue: 'bearer-secret',
        ...s,
      })),
    ),
  };
  const listing = {
    listFor: jest.fn(async () => opts.tools ?? [listed('list_agents', 'agents')]),
  };
  const listings = {
    record: jest.fn(),
    findByAgent: jest.fn(async () =>
      opts.snapshot === undefined
        ? { agentId: 'agent-1', toolNames: ['list_agents'], listedAt: new Date(POD_START) }
        : opts.snapshot
          ? { agentId: 'agent-1', ...opts.snapshot }
          : null,
    ),
  };
  const service = new ToolCatalogService(
    agents as never,
    pods as never,
    resolver as never,
    listing as never,
    listings as never,
  );
  return { service, listing, agents };
}

describe('agentPrincipal', () => {
  it('mints the shape issueAgentServiceToken signs', () => {
    expect(agentPrincipal({ id: 'x', isAdmin: true })).toEqual({
      sub: 'agent:x',
      email: 'agent-x@ranch.local',
      roles: [UserRoleTypes.Owner],
    });
    expect(agentPrincipal({ id: 'y', isAdmin: false }).roles).toEqual([UserRoleTypes.Agent]);
  });
});

describe('ToolCatalogService.forAgent', () => {
  it('404s an unknown agent', async () => {
    const { service } = harness({ agent: null });
    await expect(service.forAgent('nope')).rejects.toThrow(NotFoundException);
  });

  it('lists with the principal the pod would carry', async () => {
    const { service, listing } = harness({ agent: { id: 'agent-1', isAdmin: false } });
    await service.forAgent('agent-1');
    const req = (listing.listFor as jest.Mock).mock.calls[0][0] as {
      user: { sub: string; roles: string[] };
    };
    expect(req.user.sub).toBe('agent:agent-1');
    expect(req.user.roles).toEqual([UserRoleTypes.Agent]);
  });

  it('groups by topic in panel order, drops empty topics, sorts tools by title', async () => {
    const { service } = harness({
      tools: [
        listed('zeta', 'settings'),
        listed('list_agents', 'agents'),
        listed('alpha', 'settings'),
      ],
    });
    const { groups } = await service.forAgent('agent-1');
    expect(groups.map((g) => g.key)).toEqual(['agents', 'settings']);
    expect(groups[1].tools.map((t) => t.name)).toEqual(['alpha', 'zeta']);
    expect(groups[0]).toMatchObject({ title: 'Agents', kind: 'builtin' });
    expect(groups[0].tools[0]).toMatchObject({
      name: 'list_agents',
      title: 'Title list_agents',
      description: 'desc of list_agents',
      template: 'Do «list_agents»',
      destructive: false,
    });
  });

  it('inPod: null without a pod, false for a pod that never listed, per name otherwise', async () => {
    const tools = [listed('old', 'agents'), listed('new', 'agents')];

    const noPod = await harness({ tools, pod: false }).service.forAgent('agent-1');
    expect(noPod.podStartedAt).toBeNull();
    expect(noPod.groups[0].tools.map((t) => t.inPod)).toEqual([null, null]);
    expect(noPod.groups[0].afterRestart).toBe(false);

    const neverListed = await harness({ tools, snapshot: null }).service.forAgent('agent-1');
    expect(neverListed.listedAt).toBeNull();
    expect(neverListed.groups[0].tools.map((t) => t.inPod)).toEqual([false, false]);
    expect(neverListed.groups[0].afterRestart).toBe(true);

    const partial = await harness({
      tools,
      snapshot: { toolNames: ['old'], listedAt: new Date(POD_START) },
    }).service.forAgent('agent-1');
    const byName = Object.fromEntries(partial.groups[0].tools.map((t) => [t.name, t.inPod]));
    expect(byName).toEqual({ old: true, new: false });
    expect(partial.groups[0].afterRestart).toBe(true);
    expect(partial.listedAt).toBe(POD_START);
  });

  it('appends external servers as opaque groups without url or auth, with drift', async () => {
    const { service } = harness({
      servers: [
        { id: 'mcp-ranch', name: 'Ranch', description: 'built-in', updatedAt: new Date('2026-09-23T00:00:00Z') },
        { id: 'srv-1', name: 'GitHub', description: 'GitHub MCP', updatedAt: new Date('2026-09-21T00:00:00Z') },
        { id: 'srv-2', name: 'Jira', description: null, updatedAt: new Date('2026-09-23T00:00:00Z') },
      ],
    });
    const { groups } = await service.forAgent('agent-1');
    const external = groups.filter((g) => g.kind === 'external');
    expect(external.map((g) => g.key)).toEqual(['mcp:srv-1', 'mcp:srv-2']);
    expect(external[0]).toMatchObject({ title: 'GitHub', description: 'GitHub MCP', afterRestart: false, tools: [] });
    expect(external[1].afterRestart).toBe(true);
    expect(external[1].description).toBeUndefined();
    expect(JSON.stringify(groups)).not.toContain('secret');
  });

  it('marks destructive tools', async () => {
    const { service } = harness({
      tools: [listed('delete_agent', 'agents', { destructive: true })],
    });
    const { groups } = await service.forAgent('agent-1');
    expect(groups[0].tools[0].destructive).toBe(true);
  });
});
