import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { MCP_TOOL_METADATA_KEY, ToolTopics } from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { toolMetadataProblems } from '#/mcp/services/mcp-registry.service';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentLimitTool, loosenedWindows } from './agentLimit.tool';
import type {
  AgentLimitService,
  IAgentLimits,
  IAgentLoadSnapshot,
} from './domain';

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

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const PUBLIC_AGENT = { id: 'agent-a', name: 'Support Bot', isPublic: true };
const PRIVATE_AGENT = { id: 'agent-b', name: 'Back Office', isPublic: false };

interface Harness {
  tool: AgentLimitTool;
  service: { getLimits: jest.Mock; setLimits: jest.Mock; snapshot: jest.Mock };
  agents: { findById: jest.Mock; findAll: jest.Mock };
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
  };
  const all = [PUBLIC_AGENT, PRIVATE_AGENT];
  const agents = {
    findById: jest.fn((id: string) =>
      Promise.resolve(id === agent.id ? agent : null),
    ),
    findAll: jest.fn().mockResolvedValue(all),
  };
  const tool = new AgentLimitTool(
    service as unknown as AgentLimitService,
    agents as unknown as IAgentGateway,
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

const metadataOf = (method: 'getAgentLimits' | 'setAgentLimits') =>
  Reflect.getMetadata(
    MCP_TOOL_METADATA_KEY,
    AgentLimitTool.prototype[method],
  ) as ToolMetadata;

describe('AgentLimitTool — what the Tools panel needs', () => {
  it('gives both tools a topic, a title and a template the API will boot', () => {
    const get = metadataOf('getAgentLimits');
    const set = metadataOf('setAgentLimits');
    expect(get.name).toBe('get_agent_limits');
    expect(set.name).toBe('set_agent_limits');
    for (const metadata of [get, set]) {
      expect(metadata.topic).toBe(ToolTopics.Agents);
      expect(metadata.title.length).toBeGreaterThan(0);
      expect(metadata.template).toContain('«');
      expect(toolMetadataProblems(metadata)).toEqual([]);
    }
  });

  it('marks only the write as needing a confirmation parameter', () => {
    expect(metadataOf('getAgentLimits').destructive).toBeFalsy();
    expect(metadataOf('setAgentLimits').destructive).toBe(true);
    expect(metadataOf('setAgentLimits').description).toContain('confirm');
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
    await expect(
      tool.getAgentLimits({ agent: 'agent-b' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.setAgentLimits(
        { agent: 'agent-b', perMinute: 1, confirm: true },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agents.findById).not.toHaveBeenCalled();
    expect(service.snapshot).not.toHaveBeenCalled();
    expect(service.setLimits).not.toHaveBeenCalled();
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
      peaksLast30Days: { minute: 9, hour: 88, day: 640 },
    });
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
