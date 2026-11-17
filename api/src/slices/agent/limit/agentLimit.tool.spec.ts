import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { MCP_TOOL_METADATA_KEY, ToolTopics } from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { toolMetadataProblems } from '#/mcp/services/mcp-registry.service';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';
import {
  AgentLimitTool,
  loosenedWindows,
  normalizeOrigins,
} from './agentLimit.tool';
import type {
  AgentLimitService,
  IAgentLimits,
  IAgentLoadSnapshot,
} from './domain';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';

/**
 * A limit is the only thing between a public agent and anyone who wants to
 * run up its bill, so the checks that matter are: only the operator reaches
 * the tools, the chat cannot save what the console would refuse, a limit is
 * never raised or dropped without the person saying yes, and what comes back
 * is counts — nothing about who sent anything.
 */
const limits = (overrides: Partial<IAgentLimits> = {}): IAgentLimits => ({
  perMinute: 10,
  perHour: 100,
  perDay: 1000,
  ...overrides,
});

const snapshot = (
  overrides: Partial<IAgentLoadSnapshot> = {},
): IAgentLoadSnapshot => ({
  limits: limits(),
  isPublic: true,
  needsLimits: false,
  windows: [
    { window: 'minute', used: 10, limit: 10, retryAfterSec: 42 },
    { window: 'hour', used: 37, limit: 100, retryAfterSec: null },
    { window: 'day', used: 412, limit: 1000, retryAfterSec: null },
  ],
  inFlight: 3,
  series: [
    {
      minute: Date.UTC(2026, 10, 16, 10, 0),
      accepted: 10,
      refused: 2,
      refusedByMinute: 2,
      refusedByHour: 0,
      refusedByDay: 0,
      exempt: 1,
    },
  ],
  refused: {
    lastHour: 7,
    lastAt: '2026-11-16T10:00:12.000Z',
    byWindow: { minute: 6, hour: 1, day: 0 },
  },
  exemptLastHour: 4,
  peaks: { minute: 9, hour: 88, day: 640 },
  apiReplicas: 1,
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

const PUBLIC_AGENT = {
  id: 'agent-a',
  name: 'Support Bot',
  isPublic: true,
  allowedOrigins: ['https://shop.example.com'],
};
const PRIVATE_AGENT = {
  id: 'agent-b',
  name: 'Back Office',
  isPublic: false,
  allowedOrigins: [] as string[],
};

interface Harness {
  tool: AgentLimitTool;
  service: {
    getLimits: jest.Mock;
    setLimits: jest.Mock;
    snapshot: jest.Mock;
    summary: jest.Mock;
  };
  agents: { findById: jest.Mock; findAll: jest.Mock; update: jest.Mock };
}

/** `current` is what the agent has before the call; a save replaces it. */
function harness(
  current: IAgentLimits | null = limits(),
  agent: typeof PUBLIC_AGENT = PRIVATE_AGENT,
): Harness {
  let stored = current;
  const service = {
    getLimits: jest.fn(() => stored),
    setLimits: jest.fn((_id: string, next: IAgentLimits | null) => {
      stored = next;
      return Promise.resolve();
    }),
    snapshot: jest.fn().mockResolvedValue(snapshot()),
    summary: jest.fn((list: { id: string; isPublic: boolean }[]) =>
      list.map((a) => ({
        agentId: a.id,
        enabled: a.id === agent.id && stored !== null,
        atLimit: false,
        needsLimits: a.isPublic && !(a.id === agent.id && stored !== null),
      })),
    ),
  };
  const all = [PUBLIC_AGENT, PRIVATE_AGENT];
  const agents = {
    findById: jest.fn((id: string) =>
      Promise.resolve(id === agent.id ? agent : null),
    ),
    findAll: jest.fn().mockResolvedValue(all),
    // The record as the gateway hands it back — with columns no tool result
    // may carry, so a careless spread shows up in the leak test.
    update: jest.fn((id: string, data: Record<string, unknown>) =>
      Promise.resolve({
        ...agent,
        ...data,
        id,
        config: { apiKey: 'sk-sentinel' },
        updatedByUserId: 'user-42',
      }),
    ),
  };
  const tool = new AgentLimitTool(
    service as unknown as AgentLimitService,
    agents as unknown as IAgentGateway,
    permissionOver(agents),
  );
  return { tool, service, agents };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

const jsonOf = (result: { content: { text: string }[] }) =>
  JSON.parse(textOf(result)) as Record<string, unknown>;

/** Every key anywhere in a result, so a nested leak cannot hide. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      into.add(key);
      keysOf(v, into);
    }
  }
  return into;
}

type ToolMethod =
  | 'listAgentLimits'
  | 'getAgentLimits'
  | 'setAgentLimits'
  | 'setAgentVisibility';

const metadataOf = (method: ToolMethod) =>
  Reflect.getMetadata(
    MCP_TOOL_METADATA_KEY,
    AgentLimitTool.prototype[method],
  ) as ToolMetadata;

describe('AgentLimitTool — what the Tools panel needs', () => {
  it('gives every tool a topic, a title and a template the API will boot', () => {
    const names: Record<ToolMethod, string> = {
      listAgentLimits: 'list_agent_limits',
      getAgentLimits: 'get_agent_limits',
      setAgentLimits: 'set_agent_limits',
      setAgentVisibility: 'set_agent_visibility',
    };
    for (const method of Object.keys(names) as ToolMethod[]) {
      const metadata = metadataOf(method);
      expect(metadata.name).toBe(names[method]);
      expect(metadata.topic).toBe(ToolTopics.Agents);
      expect(metadata.title.length).toBeGreaterThan(0);
      expect(metadata.title.length).toBeLessThanOrEqual(60);
      expect(metadata.template.length).toBeLessThanOrEqual(200);
      expect(toolMetadataProblems(metadata)).toEqual([]);
    }
    expect(metadataOf('getAgentLimits').template).toContain('«');
    expect(metadataOf('setAgentLimits').template).toContain('«');
    expect(metadataOf('setAgentVisibility').template).toContain('«');
  });

  it('marks only the writes as needing a confirmation parameter', () => {
    expect(metadataOf('listAgentLimits').destructive).toBeFalsy();
    expect(metadataOf('getAgentLimits').destructive).toBeFalsy();
    for (const method of ['setAgentLimits', 'setAgentVisibility'] as const) {
      expect(metadataOf(method).destructive).toBe(true);
      expect(metadataOf(method).description).toContain('confirm');
    }
  });
});

describe('AgentLimitTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a plain agent even by name, before touching anything', async () => {
    const { tool, service, agents } = harness();
    // The per-agent tools answer a caller who manages nothing exactly as
    // they answer an unknown agent (CLEAN-232): no 403 to confirm it exists.
    const refused = [
      await tool.getAgentLimits({ agent: 'agent-b' }, null, plainAgent()),
      await tool.setAgentLimits(
        { agent: 'agent-b', perMinute: 1, confirm: true },
        null,
        plainAgent(),
      ),
      await tool.setAgentVisibility(
        { agent: 'agent-b', isPublic: true, perMinute: 1, confirm: true },
        null,
        plainAgent(),
      ),
    ];
    for (const result of refused) {
      // A plain agent has no `list_agents`, so the refusal does not name it.
      expect(JSON.stringify(result)).toContain(
        'Agent agent-b not found — there is no such agent among the ones this person manages',
      );
      expect(JSON.stringify(result)).not.toContain('list_agents');
    }
    // The fleet view is `admin` and still refuses outright.
    await expect(tool.listAgentLimits({}, null, plainAgent())).rejects.toThrow(
      ForbiddenException,
    );
    expect(agents.findById).not.toHaveBeenCalled();
    expect(agents.findAll).not.toHaveBeenCalled();
    expect(agents.findAll).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
    expect(service.summary).not.toHaveBeenCalled();
    expect(service.snapshot).not.toHaveBeenCalled();
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('admits an Admin the agent is answering, as the routes do, and refuses a User', async () => {
    // CLEAN-232 made this a decision: the audience is the party the call is
    // made for, and the routes admit Owner and Admin. The agent's own Owner
    // token carries nobody.
    const { tool, service } = harness();
    const ranch = () => request([UserRoleTypes.Owner]);

    const admin = asPerson(ranch(), UserRoleTypes.Admin);
    await expect(tool.isListedForRequest(admin)).resolves.toBe(true);
    await expect(tool.listAgentLimits({}, null, admin)).resolves.toBeDefined();
    expect(service.summary).toHaveBeenCalledTimes(1);

    const user = asPerson(ranch(), UserRoleTypes.User);
    await expect(tool.isListedForRequest(user)).resolves.toBe(false);
    await expect(tool.listAgentLimits({}, null, user)).rejects.toThrow(
      ForbiddenException,
    );

    // An agent token that names nobody is a guest, whatever role it carries.
    for (const nobody of [ranch(), request([UserRoleTypes.Admin])]) {
      await expect(tool.isListedForRequest(nobody)).resolves.toBe(false);
      await expect(tool.listAgentLimits({}, null, nobody)).rejects.toThrow(
        ForbiddenException,
      );
    }
    expect(service.summary).toHaveBeenCalledTimes(1);
  });
});

describe('AgentLimitTool — the summary across agents', () => {
  const LEGACY_AGENT = {
    id: 'agent-c',
    name: 'Old Landing',
    isPublic: true,
    allowedOrigins: [] as string[],
  };

  function listHarness() {
    const h = harness();
    const all = [PUBLIC_AGENT, PRIVATE_AGENT, LEGACY_AGENT];
    h.agents.findAll.mockResolvedValue(all);
    h.service.getLimits.mockImplementation((id: string) =>
      id === 'agent-a' ? limits({ perHour: null }) : null,
    );
    h.service.summary.mockReturnValue([
      { agentId: 'agent-a', enabled: true, atLimit: true, needsLimits: false },
      {
        agentId: 'agent-b',
        enabled: false,
        atLimit: false,
        needsLimits: false,
      },
      { agentId: 'agent-c', enabled: false, atLimit: false, needsLimits: true },
    ]);
    return { ...h, all };
  }

  it('names every agent with its four flags and its limit values', async () => {
    const { tool, service, all } = listHarness();
    const result = jsonOf(await tool.listAgentLimits({}, null, operator()));
    expect(service.summary).toHaveBeenCalledWith(all);
    expect(result.agents).toEqual([
      {
        agentId: 'agent-a',
        agentName: 'Support Bot',
        isPublic: true,
        enabled: true,
        limits: { perMinute: 10, perHour: null, perDay: 1000 },
        atLimit: true,
        needsLimits: false,
      },
      {
        agentId: 'agent-b',
        agentName: 'Back Office',
        isPublic: false,
        enabled: false,
        limits: null,
        atLimit: false,
        needsLimits: false,
      },
      {
        agentId: 'agent-c',
        agentName: 'Old Landing',
        isPublic: true,
        enabled: false,
        limits: null,
        atLimit: false,
        needsLimits: true,
      },
    ]);
  });

  it('answers "who is at the limit" and "who is public without one" by name', async () => {
    const { tool } = listHarness();
    const result = jsonOf(await tool.listAgentLimits({}, null, operator()));
    expect(result.total).toBe(3);
    expect(result.atLimitNow).toEqual(['Support Bot']);
    expect(result.publicWithoutLimits).toEqual(['Old Landing']);
  });

  it('carries nothing but names, flags and limit values', async () => {
    const { tool, agents } = listHarness();
    agents.findAll.mockResolvedValue([
      {
        ...PUBLIC_AGENT,
        config: { apiKey: 'sk-sentinel' },
        llmCredentialId: 'cred-1',
      },
    ]);
    const result = await tool.listAgentLimits({}, null, operator());
    const keys = keysOf(jsonOf(result));
    for (const forbidden of ['config', 'apiKey', 'llmCredentialId', 'sub']) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(textOf(result)).not.toContain('sk-sentinel');
    expect(textOf(result)).not.toContain('agent:agent-ops');
  });
});

describe('AgentLimitTool — reading', () => {
  it('returns the limits, the three windows, work in progress, refusals and peaks', async () => {
    const { tool, service } = harness(limits(), PUBLIC_AGENT);
    const result = jsonOf(
      await tool.getAgentLimits({ agent: 'agent-a' }, null, operator()),
    );
    expect(service.snapshot).toHaveBeenCalledWith(PUBLIC_AGENT);
    expect(result).toEqual({
      agentId: 'agent-a',
      agentName: 'Support Bot',
      enabled: true,
      limits: { perMinute: 10, perHour: 100, perDay: 1000 },
      isPublic: true,
      needsLimits: false,
      windows: [
        { window: 'minute', used: 10, limit: 10, secondsUntilRoom: 42 },
        { window: 'hour', used: 37, limit: 100, secondsUntilRoom: null },
        { window: 'day', used: 412, limit: 1000, secondsUntilRoom: null },
      ],
      inProgress: 3,
      refusedLastHour: 7,
      refusedLastHourByWindow: { minute: 6, hour: 1, day: 0 },
      lastRefusedAt: '2026-11-16T10:00:12.000Z',
      notCountedLastHour: 4,
      lastHour: {
        since: '2026-11-16T10:00Z',
        activeMinutes: [
          { minute: '2026-11-16T10:00Z', accepted: 10, refused: 2, exempt: 1 },
        ],
      },
      peaksLast30Days: { minute: 9, hour: 88, day: 640 },
    });
  });

  it('lists only the minutes of the last hour that saw traffic, oldest first', async () => {
    const { tool, service } = harness();
    const start = Date.UTC(2026, 10, 16, 9, 1);
    const quiet = (i: number) => ({
      minute: start + i * 60_000,
      accepted: 0,
      refused: 0,
      refusedByMinute: 0,
      refusedByHour: 0,
      refusedByDay: 0,
      exempt: 0,
    });
    const series = Array.from({ length: 60 }, (_, i) => quiet(i));
    series[5] = { ...quiet(5), accepted: 3 };
    series[40] = { ...quiet(40), refused: 2, refusedByHour: 2 };
    series[59] = { ...quiet(59), exempt: 1 };
    service.snapshot.mockResolvedValue(
      snapshot({
        series,
        refused: {
          lastHour: 2,
          lastAt: null,
          byWindow: { minute: 0, hour: 2, day: 0 },
        },
      }),
    );
    const result = jsonOf(
      await tool.getAgentLimits({ agent: 'agent-b' }, null, operator()),
    );
    expect(result.lastRefusedAt).toBe(null);
    expect(result.lastHour).toEqual({
      since: '2026-11-16T09:01Z',
      activeMinutes: [
        { minute: '2026-11-16T09:06Z', accepted: 3, refused: 0, exempt: 0 },
        { minute: '2026-11-16T09:41Z', accepted: 0, refused: 2, exempt: 0 },
        { minute: '2026-11-16T10:00Z', accepted: 0, refused: 0, exempt: 1 },
      ],
    });
  });

  it('says what the uncounted traffic is', () => {
    const description = metadataOf('getAgentLimits').description;
    expect(description).toContain('notCountedLastHour');
    expect(description).toContain('activeMinutes');
  });

  it('says limits are off, and that a public agent needs them', async () => {
    const { tool, service } = harness(null, PUBLIC_AGENT);
    service.snapshot.mockResolvedValue(
      snapshot({
        limits: null,
        needsLimits: true,
        windows: [
          { window: 'minute', used: 2, limit: null, retryAfterSec: null },
          { window: 'hour', used: 37, limit: null, retryAfterSec: null },
          { window: 'day', used: 412, limit: null, retryAfterSec: null },
        ],
      }),
    );
    const result = jsonOf(
      await tool.getAgentLimits({ agent: 'agent-a' }, null, operator()),
    );
    expect(result.enabled).toBe(false);
    expect(result.limits).toBe(null);
    expect(result.needsLimits).toBe(true);
    expect(String(result.note)).toContain('set_agent_limits');
  });

  it('says the figures are partial when several API copies are counting', async () => {
    const { tool, service } = harness();
    service.snapshot.mockResolvedValue(snapshot({ apiReplicas: 2 }));
    const result = jsonOf(
      await tool.getAgentLimits({ agent: 'agent-b' }, null, operator()),
    );
    expect(String(result.note)).toContain('2 copies');
  });

  it('carries nothing about who sent anything, whatever the snapshot grows', async () => {
    const { tool, service } = harness();
    service.snapshot.mockResolvedValue({
      ...snapshot(),
      updatedByUserId: 'user-42',
      lastSender: { ip: '203.0.113.9', email: 'visitor@example.com' },
    });
    const result = await tool.getAgentLimits(
      { agent: 'agent-b' },
      null,
      operator(),
    );
    const keys = keysOf(jsonOf(result));
    for (const forbidden of [
      'userId',
      'updatedByUserId',
      'lastSender',
      'sender',
      'ip',
      'email',
      'sub',
      'token',
      'conversationId',
      'series',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(textOf(result)).not.toContain('user-42');
    expect(textOf(result)).not.toContain('203.0.113.9');
    expect(textOf(result)).not.toContain('visitor@example.com');
    expect(textOf(result)).not.toContain('agent:agent-ops');
  });

  it('finds an agent by its name', async () => {
    const { tool, service, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const result = jsonOf(
      await tool.getAgentLimits({ agent: 'support bot' }, null, operator()),
    );
    expect(result.agentId).toBe('agent-a');
    expect(service.snapshot).toHaveBeenCalledWith(PUBLIC_AGENT);
  });

  it('asks for the id when two agents share the name', async () => {
    const { tool, service, agents } = harness();
    agents.findById.mockResolvedValue(null);
    agents.findAll.mockResolvedValue([
      PUBLIC_AGENT,
      { ...PRIVATE_AGENT, name: 'Support Bot' },
    ]);
    const text = textOf(
      await tool.getAgentLimits({ agent: 'Support Bot' }, null, operator()),
    );
    expect(text).toContain('agent-a');
    expect(text).toContain('agent-b');
    expect(service.snapshot).not.toHaveBeenCalled();
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.getAgentLimits({ agent: 'agent-x' }, null, operator()),
    );
    expect(text).toContain('Agent agent-x not found');
    expect(text).toContain('list_agents');
    expect(service.snapshot).not.toHaveBeenCalled();
  });
});

describe('AgentLimitTool — setting, under the rule the route applies', () => {
  it('sets the first limits as the calling subject, with no confirmation', async () => {
    const { tool, service } = harness(null);
    const result = jsonOf(
      await tool.setAgentLimits(
        { agent: 'agent-b', perMinute: 5, perDay: 500 },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).toHaveBeenCalledWith(
      'agent-b',
      { perMinute: 5, perHour: null, perDay: 500 },
      'agent:agent-ops',
    );
    expect(result.enabled).toBe(true);
    expect(result.limits).toEqual({
      perMinute: 5,
      perHour: null,
      perDay: 500,
    });
  });

  it('refuses a value that is not a whole number in range', async () => {
    const { tool, service } = harness(null);
    for (const perMinute of [0, 1.5, 1_000_001]) {
      const result = jsonOf(
        await tool.setAgentLimits(
          { agent: 'agent-b', perMinute, confirm: true },
          null,
          operator(),
        ),
      );
      expect(result.code).toBe('LIMIT_OUT_OF_RANGE');
      expect(String(result.error)).toContain('whole number from 1 to');
    }
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('refuses a longer window that allows less than a shorter one', async () => {
    const { tool, service } = harness(null);
    const result = jsonOf(
      await tool.setAgentLimits(
        { agent: 'agent-b', perMinute: 50, perHour: 20, confirm: true },
        null,
        operator(),
      ),
    );
    expect(result.code).toBe('LIMIT_WINDOWS_CONTRADICT');
    expect(String(result.error)).toContain('could never be reached');
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('will not switch limits off for a public agent, confirmed or not', async () => {
    const { tool, service } = harness(limits(), PUBLIC_AGENT);
    for (const confirm of [undefined, true]) {
      const result = jsonOf(
        await tool.setAgentLimits(
          {
            agent: 'agent-a',
            perMinute: null,
            perHour: null,
            perDay: null,
            confirm,
          },
          null,
          operator(),
        ),
      );
      expect(result.code).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
      expect(String(result.error)).toContain('at least one request limit');
      expect(result.limits).toEqual(limits());
    }
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('does not save for an agent that does not exist', async () => {
    const { tool, service } = harness();
    const result = await tool.setAgentLimits(
      { agent: 'agent-x', perMinute: 5, confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('list_agents');
    expect(service.setLimits).not.toHaveBeenCalled();
  });
});

describe('AgentLimitTool — when the person has to say yes', () => {
  it('tightens without asking', async () => {
    const { tool, service } = harness();
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: 5, perHour: 100, perDay: 1000 },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(service.setLimits).toHaveBeenCalledTimes(1);
  });

  it('adds a limit to a window that had none without asking', async () => {
    const { tool, service } = harness(limits({ perDay: null }));
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: 10, perHour: 100, perDay: 900 },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(service.setLimits).toHaveBeenCalledTimes(1);
  });

  it('asks before raising a limit, naming the change, and saves nothing', async () => {
    const { tool, service } = harness();
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: 10, perHour: 200, perDay: 1000 },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«Back Office»');
    expect(textOf(result)).toContain('from 100 to 200');
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('asks before removing one window, even when another is tightened', async () => {
    const { tool, service } = harness();
    // Leaving a window out is the same as null: the route replaces all three.
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: 5, perHour: 100 },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('remove the limit per day');
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('asks before switching limits off', async () => {
    const { tool, service } = harness();
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: null, perHour: null, perDay: null },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('switch request limits off');
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('does not take confirm: false for a yes', async () => {
    const { tool, service } = harness();
    const result = await tool.setAgentLimits(
      { agent: 'agent-b', perMinute: 20, confirm: false },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(service.setLimits).not.toHaveBeenCalled();
  });

  it('loosens once confirmed', async () => {
    const { tool, service } = harness();
    const result = jsonOf(
      await tool.setAgentLimits(
        {
          agent: 'agent-b',
          perMinute: 10,
          perHour: 200,
          perDay: 1000,
          confirm: true,
        },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).toHaveBeenCalledWith(
      'agent-b',
      { perMinute: 10, perHour: 200, perDay: 1000 },
      'agent:agent-ops',
    );
    expect(result.limits).toEqual({
      perMinute: 10,
      perHour: 200,
      perDay: 1000,
    });
  });

  it('switches limits off for a private agent once confirmed', async () => {
    const { tool, service } = harness();
    const result = jsonOf(
      await tool.setAgentLimits(
        { agent: 'agent-b', confirm: true },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).toHaveBeenCalledWith(
      'agent-b',
      null,
      'agent:agent-ops',
    );
    expect(result.enabled).toBe(false);
    expect(result.limits).toBe(null);
  });
});

describe('AgentLimitTool — visibility, under the rule the route applies', () => {
  it('will not make an agent public without a limit, confirmed or not', async () => {
    const { tool, service, agents } = harness(null);
    for (const confirm of [undefined, true]) {
      const result = jsonOf(
        await tool.setAgentVisibility(
          { agent: 'agent-b', isPublic: true, confirm },
          null,
          operator(),
        ),
      );
      expect(result.code).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
      expect(String(result.error)).toContain('at least one request limit');
      expect(result.isPublic).toBe(false);
    }
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('makes an agent public with its limits in one call, limits first', async () => {
    const { tool, service, agents } = harness(null);
    const result = jsonOf(
      await tool.setAgentVisibility(
        {
          agent: 'back office',
          isPublic: true,
          allowedOrigins: [' https://shop.example.com/ '],
          perMinute: 30,
          confirm: true,
        },
        null,
        operator(),
      ),
    );
    // By name: the id lookup misses, the exact name is found.
    expect(service.setLimits).toHaveBeenCalledWith(
      'agent-b',
      { perMinute: 30, perHour: null, perDay: null },
      'agent:agent-ops',
    );
    expect(agents.update).toHaveBeenCalledWith('agent-b', {
      isPublic: true,
      allowedOrigins: ['https://shop.example.com'],
    });
    expect(service.setLimits.mock.invocationCallOrder[0]).toBeLessThan(
      agents.update.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      ok: true,
      agentId: 'agent-b',
      agentName: 'Back Office',
      isPublic: true,
      allowedOrigins: ['https://shop.example.com'],
      enabled: true,
      limits: { perMinute: 30, perHour: null, perDay: null },
      restartSuggested: true,
      message: expect.stringContaining('restart_agent') as unknown,
    });
    expect(String(result.message)).toContain('Nothing was restarted');
  });

  it('makes a private agent that already has limits public without touching them', async () => {
    const { tool, service, agents } = harness(limits());
    const result = jsonOf(
      await tool.setAgentVisibility(
        { agent: 'agent-b', isPublic: true, confirm: true },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).toHaveBeenCalledWith('agent-b', { isPublic: true });
    expect(result.limits).toEqual(limits());
    // Public with nowhere to embed it from is worth a sentence.
    expect(String(result.message)).toContain('No allowed origin');
  });

  it('makes an agent private and keeps its limits', async () => {
    const { tool, service, agents } = harness(limits(), PUBLIC_AGENT);
    const result = jsonOf(
      await tool.setAgentVisibility(
        { agent: 'agent-a', isPublic: false },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).toHaveBeenCalledWith('agent-a', { isPublic: false });
    expect(result.isPublic).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.limits).toEqual(limits());
    expect(result.allowedOrigins).toEqual(['https://shop.example.com']);
    expect(result.restartSuggested).toBe(true);
  });

  it('suggests no restart when neither the flag nor the origins changed', async () => {
    const { tool, service, agents } = harness(limits(), PUBLIC_AGENT);
    const result = jsonOf(
      await tool.setAgentVisibility(
        {
          agent: 'agent-a',
          isPublic: true,
          allowedOrigins: ['https://shop.example.com/'],
          perMinute: 5,
          perHour: 100,
          perDay: 1000,
        },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).toHaveBeenCalledTimes(1);
    expect(agents.update).toHaveBeenCalledTimes(1);
    expect(result.restartSuggested).toBe(false);
    expect(String(result.message)).not.toContain('restart_agent');
  });

  it('lets a legacy public agent keep going without limits when nothing asks for them', async () => {
    // The route's rule is on becoming public or touching limits; neither here.
    const { tool, agents } = harness(null, PUBLIC_AGENT);
    const result = jsonOf(
      await tool.setAgentVisibility(
        {
          agent: 'agent-a',
          isPublic: true,
          allowedOrigins: ['https://new.example.com'],
        },
        null,
        operator(),
      ),
    );
    expect(agents.update).toHaveBeenCalledWith('agent-a', {
      isPublic: true,
      allowedOrigins: ['https://new.example.com'],
    });
    expect(String(result.message)).toContain('set_agent_limits');
  });

  it('refuses limits the route would refuse, and writes nothing', async () => {
    const { tool, service, agents } = harness(null);
    const result = jsonOf(
      await tool.setAgentVisibility(
        {
          agent: 'agent-b',
          isPublic: true,
          perMinute: 50,
          perHour: 20,
          confirm: true,
        },
        null,
        operator(),
      ),
    );
    expect(result.code).toBe('LIMIT_WINDOWS_CONTRADICT');
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('refuses an origin that is not scheme, host and optional port', async () => {
    const { tool, service, agents } = harness(null);
    for (const bad of [
      'shop.example.com',
      'https://shop.example.com/embed',
      'https://shop.example.com/?a=1',
      'ftp://shop.example.com',
      'https://*.example.com',
      'https://user@shop.example.com',
    ]) {
      const result = jsonOf(
        await tool.setAgentVisibility(
          {
            agent: 'agent-b',
            isPublic: true,
            allowedOrigins: ['https://ok.example.com', bad],
            perMinute: 30,
            confirm: true,
          },
          null,
          operator(),
        ),
      );
      expect(result.code).toBe('ORIGIN_INVALID');
      expect(String(result.error)).toContain(bad);
    }
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('does not save for an agent that does not exist', async () => {
    const { tool, service, agents } = harness();
    const text = textOf(
      await tool.setAgentVisibility(
        { agent: 'agent-x', isPublic: true, perMinute: 5, confirm: true },
        null,
        operator(),
      ),
    );
    expect(text).toContain('Agent agent-x not found');
    expect(text).toContain('list_agents');
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('asks for the id when two agents share the name', async () => {
    const { tool, service, agents } = harness();
    agents.findById.mockResolvedValue(null);
    agents.findAll.mockResolvedValue([
      PUBLIC_AGENT,
      { ...PRIVATE_AGENT, name: 'Support Bot' },
    ]);
    const text = textOf(
      await tool.setAgentVisibility(
        { agent: 'Support Bot', isPublic: false },
        null,
        operator(),
      ),
    );
    expect(text).toContain('agent-a');
    expect(text).toContain('agent-b');
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('returns the visibility and the limits, not the agent record', async () => {
    const { tool } = harness(null);
    const result = await tool.setAgentVisibility(
      { agent: 'agent-b', isPublic: true, perMinute: 30, confirm: true },
      null,
      operator(),
    );
    const keys = keysOf(jsonOf(result));
    for (const forbidden of [
      'config',
      'apiKey',
      'updatedByUserId',
      'userId',
      'sub',
      'token',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(textOf(result)).not.toContain('sk-sentinel');
    expect(textOf(result)).not.toContain('user-42');
    expect(textOf(result)).not.toContain('agent:agent-ops');
  });
});

describe('AgentLimitTool — when a change of visibility needs a yes', () => {
  it('asks before making a private agent public, naming it, and writes nothing', async () => {
    const { tool, service, agents } = harness(null);
    for (const confirm of [undefined, false]) {
      const result = await tool.setAgentVisibility(
        { agent: 'agent-b', isPublic: true, perMinute: 30, confirm },
        null,
        operator(),
      );
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('confirm: true');
      expect(textOf(result)).toContain('«Back Office»');
      expect(textOf(result)).toContain('public');
    }
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('makes a public agent private without asking', async () => {
    const { tool, agents } = harness(limits(), PUBLIC_AGENT);
    const result = await tool.setAgentVisibility(
      { agent: 'agent-a', isPublic: false },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(agents.update).toHaveBeenCalledTimes(1);
  });

  it('tightens the limits of a public agent without asking', async () => {
    const { tool, service } = harness(limits(), PUBLIC_AGENT);
    const result = await tool.setAgentVisibility(
      {
        agent: 'agent-a',
        isPublic: true,
        perMinute: 5,
        perHour: 100,
        perDay: 1000,
      },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(service.setLimits).toHaveBeenCalledTimes(1);
  });

  it('asks before loosening a limit along the way, naming the change', async () => {
    const { tool, service, agents } = harness(limits(), PUBLIC_AGENT);
    const result = await tool.setAgentVisibility(
      {
        agent: 'agent-a',
        isPublic: true,
        perMinute: 10,
        perHour: 200,
        perDay: 1000,
      },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('from 100 to 200');
    expect(service.setLimits).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('asks before removing the limits of an agent it makes private', async () => {
    const { tool, service, agents } = harness(limits(), PUBLIC_AGENT);
    const args = {
      agent: 'agent-a',
      isPublic: false,
      perMinute: null,
      perHour: null,
      perDay: null,
    };
    const asked = await tool.setAgentVisibility(args, null, operator());
    expect(asked.isError).toBe(true);
    expect(textOf(asked)).toContain('switch request limits off');
    expect(agents.update).not.toHaveBeenCalled();

    const done = jsonOf(
      await tool.setAgentVisibility(
        { ...args, confirm: true },
        null,
        operator(),
      ),
    );
    expect(service.setLimits).toHaveBeenCalledWith(
      'agent-a',
      null,
      'agent:agent-ops',
    );
    expect(done.isPublic).toBe(false);
    expect(done.enabled).toBe(false);
  });

  it('names both halves when a call goes public and loosens at once', async () => {
    const { tool } = harness(limits());
    const result = await tool.setAgentVisibility(
      { agent: 'agent-b', isPublic: true, perMinute: 10, perHour: 100 },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('public');
    expect(textOf(result)).toContain('remove the limit per day');
  });
});

describe('normalizeOrigins — what the embed check will compare against', () => {
  it('trims, drops a trailing slash, empty entries and repeats', () => {
    expect(
      normalizeOrigins([
        ' https://shop.example.com/ ',
        '',
        'https://shop.example.com',
        'http://localhost:5173',
      ]),
    ).toEqual({
      origins: ['https://shop.example.com', 'http://localhost:5173'],
    });
  });

  it('stores an origin the way a browser sends it', () => {
    expect(
      normalizeOrigins(['HTTPS://Shop.Example.com:443', 'http://a.test:8080']),
    ).toEqual({ origins: ['https://shop.example.com', 'http://a.test:8080'] });
  });

  it('names the entry it cannot take', () => {
    expect(normalizeOrigins(['https://ok.test', 'nope'])).toEqual({
      invalid: 'nope',
    });
  });
});

describe('loosenedWindows — what counts as letting more through', () => {
  const none = null;

  it('is nothing when limits are set for the first time', () => {
    expect(loosenedWindows(none, limits())).toEqual([]);
  });

  it('is nothing when limits stay off or stay the same', () => {
    expect(loosenedWindows(none, none)).toEqual([]);
    expect(loosenedWindows(limits(), limits())).toEqual([]);
  });

  it('is nothing when a number gets smaller', () => {
    expect(loosenedWindows(limits(), limits({ perHour: 99 }))).toEqual([]);
  });

  it('is nothing when a window without a limit gets one', () => {
    expect(loosenedWindows(limits({ perDay: null }), limits())).toEqual([]);
  });

  it('is a loosening when a number gets larger', () => {
    expect(loosenedWindows(limits(), limits({ perHour: 101 }))).toEqual([
      { field: 'perHour', from: 100, to: 101 },
    ]);
  });

  it('is a loosening when a window loses its limit', () => {
    expect(loosenedWindows(limits(), limits({ perMinute: null }))).toEqual([
      { field: 'perMinute', from: 10, to: null },
    ]);
  });

  it('is a loosening of every window when limits are switched off', () => {
    expect(loosenedWindows(limits({ perHour: null }), none)).toEqual([
      { field: 'perMinute', from: 10, to: null },
      { field: 'perDay', from: 1000, to: null },
    ]);
  });

  it('reports the loosened window even when another one is tightened', () => {
    expect(
      loosenedWindows(limits(), limits({ perMinute: 1, perDay: 2000 })),
    ).toEqual([{ field: 'perDay', from: 1000, to: 2000 }]);
  });
});
