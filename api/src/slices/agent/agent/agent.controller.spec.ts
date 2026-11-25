import type { Request } from 'express';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AgentController } from './agent.controller';
import { MANAGES_AGENT_METADATA_KEY } from './guards/agentManage.guard';
import { ROLES_METADATA_KEY } from '#/user/auth/guards/roles.decorator';
import { UserRoleTypes } from '#/user/user/domain';
import {
  DOCUMENTS_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import type { IMcpServerData } from '#/mcpServer/domain';
import { permissionOver } from './domain/__fixtures__/agentPermission';
import type { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';

// Neither the access lists nor the pins are what this file is about: the
// lists hide nothing and nobody has pinned anything.
const noPins = () =>
  ({
    pin: jest.fn().mockResolvedValue(true),
    unpin: jest.fn().mockResolvedValue(true),
    pinnedIds: jest.fn().mockResolvedValue(new Set()),
    removeUser: jest.fn(),
  }) as unknown as IAgentPinGateway;

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
  const toolState = {
    summary: jest.fn((): 'connecting' | 'limited' | null => null),
    detail: jest.fn((): unknown => null),
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
    stub,
    permissionOver(agentGateway),
    openAccess(),
    noPins(),
    toolState as never,
  );
  return { controller, mcpResolver, agentGateway, toolState };
}

const asOwner = {
  user: { sub: 'user-1', roles: ['Owner'] },
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
    /** Rows for the list routes (CLEAN-232). */
    agents?: Array<Record<string, unknown>>;
    /** The accounts that still exist, by id. */
    users?: Record<string, { id: string; name: string; email: string }>;
  } = {},
) {
  const order: string[] = [];
  const userGateway = {
    findById: jest.fn((id: string) =>
      Promise.resolve(opts.users?.[id] ?? null),
    ),
  };
  const agentGateway = {
    findAll: jest.fn(() => Promise.resolve(opts.agents ?? [])),
    findPublic: jest.fn(() => Promise.resolve(opts.agents ?? [])),
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
    userGateway as never,
    permissionOver(agentGateway),
    openAccess(),
    noPins(),
    { summary: () => null, detail: () => null } as never,
  );
  return { controller, agentGateway, agentLimits, deploy, order, userGateway };
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

  it('refuses a save that still carries `pinned`, and writes nothing', async () => {
    // The pin left this route (CLEAN-231). The validation pipe drops the old
    // field from the dto, so the raw body is what tells: a console that
    // still sends it must hear so, not believe it saved.
    const { controller, agentGateway, agentLimits } = buildForLimits();
    const stale = {
      ...owner,
      body: { name: 'New name', pinned: true },
    } as unknown as Request;

    const err = await controller
      .update('ag-1', { name: 'New name' }, stale)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toContain(
      'property pinned should not exist',
    );
    expect(agentGateway.update).not.toHaveBeenCalled();
    expect(agentLimits.setLimits).not.toHaveBeenCalled();
    // `pinned: false` is the same stale field.
    await expect(
      controller.update('ag-1', {}, {
        ...owner,
        body: { pinned: false },
      } as unknown as Request),
    ).rejects.toBeInstanceOf(BadRequestException);
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
      { name: 'a', templateId: 't', isPublic: true, createdById: 'user-1' },
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

/**
 * Who created an agent (CLEAN-232): written once on POST /agents from the
 * console token, shown by name to an Owner or Admin, and never sent as a
 * bare id. Making an agent the Ranch admin agent is the Owner's decision.
 */
describe('AgentController — who created an agent', () => {
  const as = (sub: string, role: string) =>
    ({ user: { sub, roles: [role] } }) as unknown as Request;
  const owner = as('user-o', 'Owner');
  const admin = as('user-a', 'Admin');
  const user = as('user-u', 'User');

  const USERS = {
    'user-a': { id: 'user-a', name: 'Ada Admin', email: 'ada@example.test' },
  };
  const AGENTS = [
    { id: 'ag-1', name: 'By Ada', createdById: 'user-a' },
    { id: 'ag-2', name: 'By a removed account', createdById: 'user-gone' },
    { id: 'ag-3', name: 'Older than the field', createdById: null },
  ];

  it('records the console person behind POST /agents', async () => {
    const { controller, deploy } = buildForLimits();

    await controller.create({ name: 'a', templateId: 't' } as never, admin);

    expect(deploy.createAgent).toHaveBeenCalledWith(
      { name: 'a', templateId: 't', createdById: 'user-a' },
      { isAdmin: undefined },
    );
  });

  it('never records an `agent:` subject as a creator', async () => {
    const { controller, deploy } = buildForLimits();

    // The role guard refuses an agent's token on this route; the handler
    // does not rely on that.
    await controller.create(
      { name: 'a', templateId: 't' } as never,
      as('agent:ranch', 'Owner'),
    );

    expect(deploy.createAgent).toHaveBeenCalledWith(
      { name: 'a', templateId: 't', createdById: null },
      { isAdmin: undefined },
    );
  });

  it('cannot be set or changed by a later update', async () => {
    const { controller, agentGateway } = buildForLimits();

    await controller.update(
      'ag-1',
      { name: 'Renamed', createdById: 'user-u' } as never,
      owner,
    );

    // The update DTO has no such field (the validation pipe strips it); what
    // the gateway is handed is typed without it, and the gateway writes only
    // the fields it knows.
    const [, data] = agentGateway.update.mock.calls[0];
    expect(Object.keys(data as object)).toEqual(
      expect.arrayContaining(['name']),
    );
  });

  it('refuses an Admin who creates the Ranch admin agent, before anything is created', async () => {
    const { controller, deploy } = buildForLimits();

    await expect(
      controller.create(
        { name: 'a', templateId: 't', isAdmin: true } as never,
        admin,
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('Only the Owner') as string,
    });
    expect(deploy.createAgent).not.toHaveBeenCalled();
  });

  it('lets the Owner create the Ranch admin agent', async () => {
    const { controller, deploy } = buildForLimits();

    await controller.create(
      { name: 'a', templateId: 't', isAdmin: true } as never,
      owner,
    );

    expect(deploy.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a', createdById: 'user-o' }),
      { isAdmin: true },
    );
  });

  it.each([
    ['an Owner', owner],
    ['an Admin', admin],
  ])('shows %s who created each agent', async (_who, reader) => {
    const { controller } = buildForLimits({ agents: AGENTS, users: USERS });

    const listed = await controller.findAll(reader);

    expect(listed.map((a) => [a.id, a.createdBy])).toEqual([
      ['ag-1', { id: 'user-a', name: 'Ada Admin', email: 'ada@example.test' }],
      // The account is gone: the id stays, the name and email do not.
      ['ag-2', { id: 'user-gone', name: null, email: null }],
      // Nobody is recorded.
      ['ag-3', null],
    ]);
  });

  it('tells a User nothing about creators, resolved or bare', async () => {
    const { controller, userGateway } = buildForLimits({
      agents: AGENTS,
      users: USERS,
    });

    const listed = await controller.findAll(user);

    expect(listed.map((a) => a.createdBy)).toEqual([null, null, null]);
    expect(userGateway.findById).not.toHaveBeenCalled();
    for (const agent of listed) expect(agent).not.toHaveProperty('createdById');
  });

  it('never sends the bare id, to anyone', async () => {
    const { controller } = buildForLimits({ agents: AGENTS, users: USERS });

    for (const reader of [owner, admin, user]) {
      for (const agent of await controller.findAll(reader)) {
        expect(agent).not.toHaveProperty('createdById');
      }
    }
    // The anonymous landing page gets no creator at all.
    for (const agent of await controller.findPublic()) {
      expect(agent).not.toHaveProperty('createdById');
      expect(agent.createdBy).toBeNull();
    }
  });

  it('looks each creator up once, however many agents they created', async () => {
    const { controller, userGateway } = buildForLimits({
      agents: [
        ...AGENTS,
        { id: 'ag-4', name: 'Also Ada', createdById: 'user-a' },
      ],
      users: USERS,
    });

    await controller.findAll(owner);

    expect(userGateway.findById.mock.calls.map(([id]) => id).sort()).toEqual([
      'user-a',
      'user-gone',
    ]);
  });
});

describe('AgentController.getAgentToolState (CLEAN-245)', () => {
  const detail = {
    phase: 'limited',
    since: '2026-11-20T09:10:52.000Z',
    servers: [
      {
        id: 'mcp-documents',
        name: 'Documents',
        state: 'retrying',
        since: '2026-11-20T09:09:53.000Z',
        attempts: 7,
        lastError: 'HTTP 503',
      },
    ],
  };

  it('returns what the runtime reported', async () => {
    const { controller, toolState } = build();
    toolState.detail.mockReturnValue(detail);

    await expect(controller.getAgentToolState('ag-1')).resolves.toEqual(detail);
    expect(toolState.detail).toHaveBeenCalledWith('ag-1');
  });

  it('null while nothing was reported', async () => {
    const { controller } = build();
    await expect(controller.getAgentToolState('ag-1')).resolves.toBeNull();
  });

  it('404 for an agent that does not exist', async () => {
    const { controller, toolState } = build({ agent: null });

    await expect(controller.getAgentToolState('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(toolState.detail).not.toHaveBeenCalled();
  });

  it('is behind the manage rule: a User, or an Admin the agent is hidden from, gets the guard’s 404', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AgentController.prototype,
      'getAgentToolState',
    )!.value as object;
    expect(Reflect.getMetadata(MANAGES_AGENT_METADATA_KEY, handler)).toBe('id');
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
      UserRoleTypes.Owner,
      UserRoleTypes.Admin,
    ]);
  });
});
