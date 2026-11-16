import type { Request } from 'express';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import {
  DOCUMENTS_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import type { IMcpServerData } from '#/mcpServer/domain';

/**
 * getMcps only. Which servers an agent gets is AgentMcpResolver's answer now
 * and is covered by its own spec — CLEAN-87, after two copies of that logic
 * drifted apart and left every agent without query_attachment. What is left
 * here is the controller's own job: the wire shape it hands the runtime, and
 * the self-scope rule that stops one agent reading another's auth values.
 */
function mcp(id: string, name: string): IMcpServerData {
  return {
    id,
    name,
    description: null,
    url: 'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: '${RANCH_API_TOKEN}',
    oauthClientId: null,
    enabled: true,
    builtIn: true,
    templateIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as IMcpServerData;
}

function build(opts: { resolved?: IMcpServerData[]; agent?: unknown } = {}) {
  const agentGateway = {
    findById: jest.fn(() =>
      Promise.resolve(
        opts.agent === null
          ? null
          : { id: 'ag-1', templateId: 'tpl-1', knowledgeIds: [] },
      ),
    ),
  };
  const mcpResolver = {
    resolveForAgent: jest.fn(() => Promise.resolve(opts.resolved ?? [])),
  };
  const stub = {} as never;
  const controller = new AgentController(
    agentGateway as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    mcpResolver as never,
    stub,
  );
  return { controller, mcpResolver, agentGateway };
}

const asOwner = {
  user: { sub: 'user-1', roles: ['owner'] },
} as unknown as Request;

const asAgent = (id: string) =>
  ({ user: { sub: `agent:${id}`, roles: ['agent'] } }) as unknown as Request;

describe('AgentController.getMcps', () => {
  it('hands the runtime what the resolver decided, in wire shape', async () => {
    const { controller } = build({
      resolved: [
        mcp(RANCH_MCP_ID, 'Ranch'),
        mcp(DOCUMENTS_MCP_ID, 'Documents'),
      ],
    });

    const out = await controller.getMcps('ag-1', asOwner);

    expect(out.map((m) => m.name)).toEqual(['Ranch', 'Documents']);
    expect(out[0]).toEqual({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      transport: 'streamableHttp',
      url: 'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      enabled: true,
    });
  });

  it('asks the resolver about this agent, not some other', async () => {
    const { controller, mcpResolver } = build();

    await controller.getMcps('ag-1', asOwner);

    expect(mcpResolver.resolveForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl-1' }),
    );
  });

  it('lets an agent token read its own list', async () => {
    const { controller } = build({
      resolved: [mcp(DOCUMENTS_MCP_ID, 'Documents')],
    });

    const out = await controller.getMcps('ag-1', asAgent('ag-1'));

    expect(out.map((m) => m.name)).toEqual(['Documents']);
  });

  it('refuses an agent token pointed at a peer', async () => {
    // Otherwise an agent could enumerate its neighbours' MCPs — and their
    // auth values travel in this response.
    const { controller } = build();

    await expect(controller.getMcps('ag-2', asAgent('ag-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s on an unknown agent', async () => {
    const { controller } = build({ agent: null });

    await expect(controller.getMcps('nope', asOwner)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns an empty list rather than failing when nothing resolves', async () => {
    const { controller } = build({ resolved: [] });

    expect(await controller.getMcps('ag-1', asOwner)).toEqual([]);
  });
});

/**
 * Visibility and limits in one save (CLEAN-224). The rule itself is pinned in
 * agent/limit/domain/agentLimit.rules.spec.ts; here: that the routes apply
 * it, in the right order, and never hand `limits` to the agent table.
 */
function buildForLimits(
  opts: {
    agent?: { isPublic: boolean } | null;
    limits?: Record<string, number | null> | null;
  } = {},
) {
  const order: string[] = [];
  const agentGateway = {
    findById: jest.fn(() =>
      Promise.resolve(
        opts.agent === null
          ? null
          : { id: 'ag-1', isPublic: false, ...opts.agent },
      ),
    ),
    update: jest.fn((id: string, data: Record<string, unknown>) => {
      order.push('agent');
      return Promise.resolve({ id, ...data });
    }),
  };
  const agentLimits = {
    getLimits: jest.fn(() => opts.limits ?? null),
    setLimits: jest.fn(() => {
      order.push('limits');
      return Promise.resolve();
    }),
  };
  const deploy = {
    createAgent: jest.fn((data: Record<string, unknown>) => {
      order.push('agent');
      return Promise.resolve({ id: 'ag-new', ...data });
    }),
  };
  const stub = {} as never;
  const controller = new AgentController(
    agentGateway as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    deploy as never,
    stub,
    agentLimits as never,
  );
  return { controller, agentGateway, agentLimits, deploy, order };
}

const codeOf = async (run: Promise<unknown>): Promise<unknown> => {
  try {
    await run;
    return null;
  } catch (err) {
    const body = (err as { getResponse?: () => unknown }).getResponse?.();
    return (body as { code?: string } | undefined)?.code ?? 'OTHER';
  }
};

describe('AgentController — visibility and request limits', () => {
  const owner = {
    user: { sub: 'user-1', roles: ['Owner'] },
  } as unknown as Request;
  const LIMITS = { perMinute: 3, perHour: null, perDay: null };

  it('refuses to make an agent public with no limit, and changes nothing', async () => {
    const { controller, agentGateway, agentLimits } = buildForLimits();

    expect(
      await codeOf(controller.update('ag-1', { isPublic: true }, owner)),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
    expect(agentGateway.update).not.toHaveBeenCalled();
    expect(agentLimits.setLimits).not.toHaveBeenCalled();
  });

  it('makes it public in one save when the limit comes with it, limits first', async () => {
    const { controller, agentGateway, agentLimits, order } = buildForLimits();

    await controller.update(
      'ag-1',
      {
        isPublic: true,
        allowedOrigins: ['https://x.test'],
        limits: { perMinute: 3 },
      },
      owner,
    );

    expect(order).toEqual(['limits', 'agent']);
    expect(agentLimits.setLimits).toHaveBeenCalledWith(
      'ag-1',
      LIMITS,
      'user-1',
    );
    // Limits are not an agent column: they never reach the agent table.
    expect(agentGateway.update).toHaveBeenCalledWith('ag-1', {
      isPublic: true,
      allowedOrigins: ['https://x.test'],
    });
  });

  it('refuses to switch limits off on a public agent', async () => {
    const { controller, agentGateway } = buildForLimits({
      agent: { isPublic: true },
      limits: LIMITS,
    });

    expect(
      await codeOf(controller.update('ag-1', { limits: null }, owner)),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
    expect(agentGateway.update).not.toHaveBeenCalled();
  });

  it('keeps limits when a public agent becomes private', async () => {
    const { controller, agentLimits, agentGateway } = buildForLimits({
      agent: { isPublic: true },
      limits: LIMITS,
    });

    await controller.update('ag-1', { isPublic: false }, owner);

    expect(agentLimits.setLimits).not.toHaveBeenCalled();
    expect(agentGateway.update).toHaveBeenCalledWith('ag-1', {
      isPublic: false,
    });
  });

  it('lets an agent that was public before limits existed be renamed', async () => {
    const { controller, agentGateway } = buildForLimits({
      agent: { isPublic: true },
      limits: null,
    });

    await controller.update('ag-1', { name: 'New name' }, owner);

    expect(agentGateway.update).toHaveBeenCalledWith('ag-1', {
      name: 'New name',
    });
    // The rule was not even consulted: the save touched neither field.
    expect(agentGateway.findById).not.toHaveBeenCalled();
  });

  it('answers with the code for a value out of range or windows that contradict', async () => {
    const { controller } = buildForLimits();
    expect(
      await codeOf(
        controller.update('ag-1', { limits: { perMinute: 0 } }, owner),
      ),
    ).toBe('LIMIT_OUT_OF_RANGE');
    expect(
      await codeOf(
        controller.update(
          'ag-1',
          { limits: { perMinute: 9, perHour: 2 } },
          owner,
        ),
      ),
    ).toBe('LIMIT_WINDOWS_CONTRADICT');
  });

  it('answers 404 for an agent that does not exist', async () => {
    const { controller } = buildForLimits({ agent: null });
    await expect(
      controller.update(
        'nope',
        { isPublic: true, limits: { perMinute: 1 } },
        owner,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to create a public agent with no limit, before anything is created', async () => {
    const { controller, deploy } = buildForLimits();

    expect(
      await codeOf(
        controller.create(
          { name: 'a', templateId: 't', isPublic: true } as never,
          owner,
        ),
      ),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
    expect(deploy.createAgent).not.toHaveBeenCalled();
  });

  it('creates a public agent with its limits, and keeps them out of the agent row', async () => {
    const { controller, deploy, agentLimits } = buildForLimits();

    await controller.create(
      {
        name: 'a',
        templateId: 't',
        isPublic: true,
        limits: { perMinute: 3 },
      } as never,
      owner,
    );

    expect(deploy.createAgent).toHaveBeenCalledWith(
      { name: 'a', templateId: 't', isPublic: true },
      { isAdmin: undefined },
    );
    expect(agentLimits.setLimits).toHaveBeenCalledWith(
      'ag-new',
      LIMITS,
      'user-1',
    );
  });

  it('creates a private agent without touching limits', async () => {
    const { controller, agentLimits } = buildForLimits();
    await controller.create({ name: 'a', templateId: 't' } as never, owner);
    expect(agentLimits.setLimits).not.toHaveBeenCalled();
  });
});
