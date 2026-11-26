/**
 * An agent ability the assistant setting gave a person works, through the
 * assistant, on every agent that person reaches (CLEAN-254).
 *
 * Before this a User could be given "Restart an agent" in the setting and
 * never get the tool: `manage-agent` tools were listed for whoever created
 * an agent, no User can create one, and the setting could only take names
 * away after that check.
 *
 * Nothing about the rule is stubbed here. The MCP handler, the catalogue
 * with the assistant's policy registered on it, the setting service, the
 * access lists and `AgentPermissionService` are the real ones, and the tools
 * are the real classes; only what a tool would do to a pod is a stand-in.
 *
 *  - The ability is the one tool the setting holds, on the agents the person
 *    reaches, and never on the Ranch admin agent.
 *  - It exists through the assistant only: not through another agent, not
 *    with the person's own console token, not on a console route.
 *  - An agent out of reach, an id that names nothing and the Ranch admin
 *    agent get one and the same answer.
 */
import 'reflect-metadata';
import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector, type ModuleRef } from '@nestjs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request } from 'express';
import { AgentAdminTool } from '#/agent/agent/agentAdmin.tool';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import {
  AgentManageGuard,
  ManagesAgent,
} from '#/agent/agent/guards/agentManage.guard';
import { AgentChannelTool } from '#/agent/agentChannel/agentChannel.tool';
import { FileTool } from '#/agent/file/file.tool';
import { AgentLimitTool } from '#/agent/limit/agentLimit.tool';
import { PeerAdminTool } from '#/agent/peer/peerAdmin.tool';
import { SecretTool } from '#/agent/secret/secret.tool';
import { LogTool } from '#/log/log.tool';
import { RancherTool } from '#/rancher/rancher.tool';
import {
  ADMIN,
  OWNER,
  USER,
  USER2,
  accessHarness,
  usersGateway,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { AssistantAccessTool } from '#/user/assistantAccess/assistantAccess.tool';
import { AssistantAccessWiring } from '#/user/assistantAccess/assistantAccess.wiring';
import { AssistantAccessService } from '#/user/assistantAccess/domain/assistantAccess.service';
import type { IAssistantSettingData } from '#/user/assistantAccess/domain/assistantAccess.types';
import { AssistantToolPolicyService } from '#/user/assistantAccess/domain/assistantToolPolicy.service';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  MCP_TOOL_METADATA_KEY,
  toolAudienceOf,
  type ToolAudienceTypes,
  type ToolMetadata,
} from './decorators';
import { ACTING_PARTY_RESOLVER } from './interfaces/acting-party.interface';
import { AGENT_MANAGER_RESOLVER } from './interfaces/agent-manager.interface';
import { ASSISTANT_GRANT_RESOLVER } from './interfaces/assistant-grant.interface';
import { McpToolsHandler } from './services/handlers/mcp-tools.handler';
import type { McpRegistryService } from './services/mcp-registry.service';
import { ToolCatalogService } from './services/tool-catalog.service';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

// ── The ranch ────────────────────────────────────────────────
//
// Three agents and the assistant. USER is limited to `alpha`; USER2 has no
// lists and reaches every agent. Nobody below created anything.

const A = 'agent-aaa';
const B = 'agent-bbb';
const RANCH = 'agent-ranch';
const GHOST = 'agent-zzz';

const agent = (id: string, name: string, isAdmin = false): IAgentData =>
  ({
    id,
    name,
    templateId: 'tpl-1',
    llmCredentialId: 'llm-1',
    status: 'running',
    workflowId: `wf-of-${name}`,
    config: { note: `config-of-${name}` },
    resources: { cpu: '1', memory: '1Gi' },
    isPublic: false,
    isAdmin,
    allowedOrigins: [],
    knowledgeIds: ['kb-1'],
    statusReason: `why-${name}-failed`,
    debugEnabled: false,
    pinned: false,
    createdById: null,
  }) as unknown as IAgentData;

const AGENTS = [
  agent(A, 'alpha'),
  agent(B, 'bravo'),
  agent(RANCH, 'rancher', true),
];

/** A collaborator no call in this spec may reach. */
function never<T>(name: string): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'then') return undefined;
        return () => {
          throw new Error(`${name}.${String(property)} was reached`);
        };
      },
    },
  ) as T;
}

const { service: access, gateway: lists } = accessHarness([A, B, RANCH]);
lists.seed(USER.id, true, [{ agentId: A, list: 'allowed' }]);

const agents = {
  findAll: () => Promise.resolve(AGENTS),
  findAdmin: () => Promise.resolve(AGENTS[2]),
  findById: (id: string) =>
    Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
  hasCreatedBy: () => Promise.resolve(false),
  update: jest.fn((id: string, patch: Record<string, unknown>) => {
    const row = AGENTS.find((a) => a.id === id)!;
    const given = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    return Promise.resolve({ ...row, ...given });
  }),
} as unknown as IAgentGateway & { update: jest.Mock };

const permission = new AgentPermissionService(agents, access);
const agentDeploy = {
  restartAgent: jest.fn(() => Promise.resolve()),
  stopAgent: jest.fn(() => Promise.resolve()),
  deploy: jest.fn(() => Promise.resolve()),
};
/** What an operator is told about a pod; most of it is nobody else's. */
const pods = {
  list: () =>
    Promise.resolve([
      {
        agentId: A,
        phase: 'Running',
        ready: true,
        startedAt: '2026-11-26T09:00:00.000Z',
        restartCount: 2,
        terminating: false,
        lastTerminationReason: 'OOMKilled',
        containerWaitingReason: null,
        message: 'node-7 pressure',
      },
    ]),
  getMetrics: () => Promise.resolve({ node: 'node-7', cpu: '120m' }),
};
const toolState = {
  detail: () => ({ phase: 'limited', servers: [{ name: 'crm-server' }] }),
};
const secretStore = {
  list: jest.fn(() => Promise.resolve({ provider: 'file', secrets: [] })),
};

// ── The tools: the real classes, read the way the registry reads them ──

const assistantSettings = new Map<string, IAssistantSettingData>();
const roleSettings = new Map<string, IAssistantSettingData>();

interface IRegistered {
  type: 'tool';
  metadata: ToolMetadata;
  providerClass: unknown;
  methodName: string;
  audience: ToolAudienceTypes | undefined;
}
const registered: IRegistered[] = [];
const registry = {
  getTools: () => registered,
  findTool: (name: string) => registered.find((t) => t.metadata.name === name),
} as unknown as McpRegistryService;

const assistant = new AssistantAccessService(
  {
    findAccount: (userId: string) =>
      Promise.resolve(assistantSettings.get(userId) ?? null),
    findRole: (role: string) => Promise.resolve(roleSettings.get(role) ?? null),
  } as never,
  usersGateway(),
  agents,
  registry,
);
const policy = new AssistantToolPolicyService(assistant);

const instances = new Map<unknown, object>([
  [
    RancherTool,
    new RancherTool(
      agents,
      agentDeploy as never,
      never('templates'),
      never('templateFiles'),
      never('llms'),
      never('skills'),
      never('settings'),
      never('usage'),
      never('files'),
      never('rancher'),
      permission,
      access,
      { pinnedIds: () => Promise.resolve(new Set<string>()) } as never,
    ),
  ],
  [
    AgentAdminTool,
    new AgentAdminTool(
      agents,
      agentDeploy as never,
      never('agentStatus'),
      pods as never,
      never('workflows'),
      never('files'),
      never('mcpResolver'),
      permission,
      access,
      never('pins'),
      toolState as never,
    ),
  ],
  [
    AgentChannelTool,
    new AgentChannelTool(never('channels'), agents, permission),
  ],
  [
    FileTool,
    new FileTool(
      agents,
      never('files'),
      never('bridle'),
      never('syncGuard'),
      never('archive'),
      never('proposals'),
      never('attachments'),
      permission,
    ),
  ],
  [
    AgentLimitTool,
    new AgentLimitTool(never('limits'), agents, permission, access),
  ],
  [PeerAdminTool, new PeerAdminTool(never('peers'), permission)],
  [SecretTool, new SecretTool(agents, secretStore as never, permission)],
  [LogTool, new LogTool(agents, never('logService'), permission)],
  [AssistantAccessTool, new AssistantAccessTool(assistant, access)],
]);

for (const [toolClass] of instances) {
  const proto = (toolClass as { prototype: Record<string, unknown> }).prototype;
  for (const method of Object.getOwnPropertyNames(proto)) {
    if (method === 'constructor') continue;
    const ref = Object.getOwnPropertyDescriptor(proto, method)
      ?.value as unknown;
    if (typeof ref !== 'function') continue;
    const metadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as
      | ToolMetadata
      | undefined;
    if (!metadata) continue;
    registered.push({
      type: 'tool',
      metadata,
      providerClass: toolClass,
      methodName: method,
      audience: toolAudienceOf(toolClass, ref),
    });
  }
}

const MANAGE_AGENT = registered
  .filter((t) => t.audience === 'manage-agent')
  .map((t) => t.metadata.name)
  .sort();

// ── The application around them ──────────────────────────────

const people: Record<string, ICallerParty> = {
  user: { kind: 'person', userId: USER.id, role: UserRoleTypes.User },
  user2: { kind: 'person', userId: USER2.id, role: UserRoleTypes.User },
  admin: { kind: 'person', userId: ADMIN.id, role: UserRoleTypes.Admin },
  owner: { kind: 'person', userId: OWNER.id, role: UserRoleTypes.Owner },
};

type Actor = Record<string, unknown>;
const as = (who: keyof typeof people): Actor => ({
  kind: 'person',
  token: who,
});
const TRUSTED: Actor = { kind: 'trusted', via: 'internal' };

const actingParties = {
  resolve: (
    bearer: { sub?: string; roles?: string[] } | undefined,
    actor: Actor | undefined,
  ): Promise<ICallerParty> => {
    const sub = bearer?.sub ?? '';
    if (!sub.startsWith('agent:')) {
      return Promise.resolve({
        kind: 'person',
        userId: sub,
        role: (bearer?.roles ?? [])[0] as UserRoleTypes,
      });
    }
    if (actor?.kind === 'trusted') return Promise.resolve({ kind: 'trusted' });
    if (actor?.kind === 'person' && typeof actor.token === 'string') {
      return Promise.resolve(people[actor.token] ?? { kind: 'guest' });
    }
    return Promise.resolve({ kind: 'guest' });
  },
};

const provided = new Map<unknown, unknown>([
  [ACTING_PARTY_RESOLVER, actingParties],
  [AGENT_MANAGER_RESOLVER, permission],
  [ASSISTANT_GRANT_RESOLVER, policy],
]);
const moduleRef = {
  registerRequestByContextId: jest.fn(),
  resolve: (token: unknown) => {
    const instance = instances.get(token);
    if (!instance) return Promise.reject(new Error('no such tool'));
    return Promise.resolve(instance);
  },
  get: (token: unknown) => {
    if (!provided.has(token)) throw new Error('no such provider');
    return provided.get(token);
  },
} as unknown as ModuleRef;

// The one catalogue of the application, with the assistant's policy on it
// and the assistant's switch on the access lists: what `AssistantAccessWiring`
// does at start.
const catalog = new ToolCatalogService(moduleRef, registry);
provided.set(ToolCatalogService, catalog);
new AssistantAccessWiring(access, catalog, assistant, policy).onModuleInit();

/** The token of the assistant's runtime: the Ranch admin agent, Owner power. */
const ASSISTANT_TOKEN = {
  user: { sub: `agent:${RANCH}`, email: '', roles: [UserRoleTypes.Owner] },
};

type Handler = (request: unknown) => Promise<{
  tools: { name: string }[];
  content: { text: string }[];
  isError?: boolean;
}>;

/** One MCP session of whoever holds `bearer`. */
function session(bearer: object = ASSISTANT_TOKEN) {
  const handlers = new Map<unknown, Handler>();
  const mcpServer = {
    server: {
      transport: { sessionId: undefined },
      setRequestHandler: (schema: unknown, handler: Handler) =>
        handlers.set(schema, handler),
    },
  } as unknown as McpServer;
  new McpToolsHandler(moduleRef, registry).registerHandlers(
    mcpServer,
    bearer as unknown as Request,
  );
  const meta = (actor?: Actor) =>
    actor ? { _meta: { 'ranch/actor': actor } } : {};
  return {
    list: async (actor?: Actor) =>
      (
        await handlers.get(ListToolsRequestSchema)!({ params: meta(actor) })
      ).tools
        .map((t) => t.name)
        .sort(),
    call: async (name: string, args: object, actor?: Actor) =>
      (
        await handlers.get(CallToolRequestSchema)!({
          params: { name, arguments: args, ...meta(actor) },
        })
      ).content[0].text,
  };
}

const manageOnly = (names: string[]) =>
  names.filter((name) => MANAGE_AGENT.includes(name));

const notAvailable = (name: string) =>
  `Tool "${name}" is not available to this caller.`;

/** The setting of one account: a custom pick of exactly these abilities. */
const pick = (userId: string, on: string[], enabled = true) =>
  assistantSettings.set(userId, {
    enabled,
    level: 'custom',
    custom: { on, known: registered.map((t) => t.metadata.name) },
    updatedById: OWNER.id,
    updatedAt: new Date('2026-11-26T10:00:00.000Z'),
  });

beforeEach(() => {
  assistantSettings.clear();
  roleSettings.clear();
  agentDeploy.restartAgent.mockClear();
  agentDeploy.stopAgent.mockClear();
  agentDeploy.deploy.mockClear();
  agents.update.mockClear();
  secretStore.list.mockClear();
});

it('loads the tools this spec is about', () => {
  expect(MANAGE_AGENT).toContain('restart_agent');
  expect(MANAGE_AGENT).toContain('delete_agent');
  expect(MANAGE_AGENT.length).toBeGreaterThanOrEqual(36);
});

describe('a User given "Restart an agent", who created nothing (CLEAN-254)', () => {
  beforeEach(() => pick(USER.id, ['restart_agent']));

  it('is listed restart_agent through the assistant, and no other manage-agent tool', async () => {
    const listed = await session().list(as('user'));
    expect(manageOnly(listed)).toEqual(['restart_agent']);
    // What tells them what they have is never taken away.
    expect(listed).toContain('get_my_assistant_access');
  });

  it('restarts an agent they reach', async () => {
    const said = await session().call('restart_agent', { id: A }, as('user'));
    expect(said).toContain('Restart started');
    expect(agentDeploy.restartAgent).toHaveBeenCalledWith(A);
  });

  it('gets one answer for an agent out of reach, an id that names nothing and the Ranch admin agent', async () => {
    const { call } = session();
    const hidden = await call('restart_agent', { id: B }, as('user'));
    const unknown = await call('restart_agent', { id: GHOST }, as('user'));
    const ranch = await call('restart_agent', { id: RANCH }, as('user'));

    expect(unknown).toMatch(/not found/i);
    expect(hidden.split(B).join('<id>')).toBe(
      unknown.split(GHOST).join('<id>'),
    );
    expect(ranch.split(RANCH).join('<id>')).toBe(
      unknown.split(GHOST).join('<id>'),
    );
    expect(hidden).not.toContain('bravo');
    expect(ranch).not.toContain('rancher');
    // Plain not-found: nothing that says the agent exists, or that the
    // ability is missing, withheld or needs another conversation.
    for (const said of [hidden, unknown, ranch]) {
      expect(said).not.toMatch(
        /not included|Owner|created|not available|new chat|new session/i,
      );
    }
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('the Ranch admin agent stays out even for a User who reaches every agent', async () => {
    pick(USER2.id, ['restart_agent']);
    const { call } = session();
    expect(await call('restart_agent', { id: B }, as('user2'))).toContain(
      'Restart started',
    );
    expect(await call('restart_agent', { id: RANCH }, as('user2'))).toMatch(
      /not found/i,
    );
    expect(agentDeploy.restartAgent.mock.calls).toEqual([[B]]);
  });

  it.each(['delete_agent', 'stop_agent', 'list_agent_secrets', 'update_agent'])(
    'is refused %s by name: the setting holds one tool, not the audience',
    async (name) => {
      const { call } = session();
      // `never(...)` stands behind each of them: a call that got past the
      // refusal would fail the spec naming what it reached.
      const said = await call(
        name,
        { id: A, agentId: A, confirm: true },
        as('user'),
      );
      expect(said).toBe(notAvailable(name));
      expect(secretStore.list).not.toHaveBeenCalled();
    },
  );

  it('has no manage-agent tool through another agent, plain or trusted with operator power', async () => {
    for (const roles of [['agent'], [UserRoleTypes.Owner]]) {
      const other = session({
        user: { sub: 'agent:other', email: '', roles },
      });
      expect(manageOnly(await other.list(as('user')))).toEqual([]);
      expect(await other.call('restart_agent', { id: A }, as('user'))).toBe(
        notAvailable('restart_agent'),
      );
    }
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('nor with their own console token on the MCP endpoint', async () => {
    const own = session({
      user: { sub: USER.id, email: '', roles: [UserRoleTypes.User] },
    });
    expect(manageOnly(await own.list())).toEqual([]);
    expect(await own.call('restart_agent', { id: A })).toBe(
      notAvailable('restart_agent'),
    );
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('a guest behind the assistant gets nothing of it', async () => {
    const { list, call } = session();
    expect(manageOnly(await list())).toEqual([]);
    expect(await call('restart_agent', { id: A })).toBe(
      notAvailable('restart_agent'),
    );
  });

  it('one session, two people: what one was given never reaches the other', async () => {
    const { list, call } = session();
    const [forUser, forOther, refused] = await Promise.all([
      list(as('user')),
      list(as('user2')),
      call('restart_agent', { id: A }, as('user2')),
    ]);
    expect(forUser).toContain('restart_agent');
    expect(forOther).not.toContain('restart_agent');
    expect(refused).toBe(notAvailable('restart_agent'));
  });

  it('manages nothing in the console: the restart route answers its 404', async () => {
    class Routes {
      @ManagesAgent('id')
      restart() {}
    }
    const guard = new AgentManageGuard(new Reflector(), permission);
    // The route's handler, as the guard is handed it: read for its marker.
    const handler: unknown = Object.getOwnPropertyDescriptor(
      Routes.prototype,
      'restart',
    )?.value;
    const context = (user: object) =>
      ({
        getHandler: () => handler,
        getClass: () => Routes,
        switchToHttp: () => ({
          getRequest: () => ({ params: { id: A }, user }),
        }),
      }) as unknown as ExecutionContext;

    await expect(
      guard.canActivate(
        context({ sub: USER.id, email: '', roles: [UserRoleTypes.User] }),
      ),
    ).rejects.toThrow(NotFoundException);
    // Nothing a token could carry makes it otherwise.
    const forged = {
      sub: USER.id,
      email: '',
      roles: [UserRoleTypes.User],
      grantedThroughAssistant: true,
    };
    await expect(guard.canActivate(context(forged))).rejects.toThrow(
      NotFoundException,
    );
    expect(AgentPermissionService.callerOfBearer(forged)).toEqual({
      kind: 'person',
      userId: USER.id,
      role: UserRoleTypes.User,
    });
    // The Owner's own token still passes, as before.
    await expect(
      guard.canActivate(
        context({ sub: OWNER.id, email: '', roles: [UserRoleTypes.Owner] }),
      ),
    ).resolves.toBe(true);
  });
});

describe('when the setting does not hold the tool', () => {
  it('switched off: no manage-agent tool, though the pick still names one', async () => {
    pick(USER.id, ['restart_agent'], false);
    const { list, call } = session();
    expect(manageOnly(await list(as('user')))).toEqual([]);
    expect(await call('restart_agent', { id: A }, as('user'))).toBe(
      notAvailable('restart_agent'),
    );
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('with nothing configured a User has no manage-agent tool at all: nothing widens by default', async () => {
    // Basic holds the reading tools by its rule, and for a User they mean
    // what they meant before: agents the User created. This one created
    // none, so none is listed, and none runs.
    const { list, call } = session();
    expect(manageOnly(await list(as('user')))).toEqual([]);

    for (const [name, args] of [
      ['restart_agent', { id: A }],
      ['read_agent_file', { agentId: A, path: 'SOUL.md' }],
      ['list_agent_secrets', { agentId: A }],
      ['get_agent_status', { id: A }],
    ] as const) {
      expect(await call(name, args, as('user'))).toBe(notAvailable(name));
    }
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
    expect(secretStore.list).not.toHaveBeenCalled();
  });

  it('a tool that is not for managing an agent makes nobody a manager of one', async () => {
    // `get_agent` is a reader's tool. Holding it shows the agent as a reader
    // sees it, with or without an agent ability next to it.
    pick(USER.id, ['get_agent', 'restart_agent']);
    const said = await session().call('get_agent', { id: A }, as('user'));
    expect(said).toContain('alpha');
    expect(said).not.toContain('config-of-alpha');
    expect(said).not.toContain('llm-1');
  });
});

/**
 * Only what somebody ticked counts. An agent ability works on the agents a
 * person reaches when it is in a CUSTOM pick, the account's own or the
 * role's. A built-in level, the role's default or one somebody chose, opens
 * no manage-agent tool for a User who created no agent.
 */
describe('a built-in level opens nothing; a custom pick opens what it names', () => {
  const setting = (
    level: IAssistantSettingData['level'],
    on?: string[],
  ): IAssistantSettingData => ({
    enabled: true,
    level,
    custom: on ? { on, known: registered.map((t) => t.metadata.name) } : null,
    updatedById: OWNER.id,
    updatedAt: new Date('2026-11-26T10:00:00.000Z'),
  });

  describe.each(['basic', 'standard', 'full'] as const)('%s', (level) => {
    it.each([
      ['as the Users’ setting', () => roleSettings.set('User', setting(level))],
      [
        'chosen for the one account',
        () => assistantSettings.set(USER.id, setting(level)),
      ],
    ])('%s: no manage-agent tool is listed or runs', async (_how, apply) => {
      apply();
      const { list, call } = session();
      expect(manageOnly(await list(as('user')))).toEqual([]);
      expect(await call('restart_agent', { id: A }, as('user'))).toBe(
        notAvailable('restart_agent'),
      );
      expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
    });
  });

  it('the level still holds them by its rule: that is what the Owner sees, not what a User gets', async () => {
    roleSettings.set('User', setting('standard'));
    const grant = await assistant.grantFor(people.user);
    expect(grant.names?.has('restart_agent')).toBe(true);
    expect(manageOnly(await session().list(as('user')))).toEqual([]);
  });

  it('a custom pick as the Users’ setting gives every User exactly what it names', async () => {
    roleSettings.set('User', setting('custom', ['restart_agent']));
    const { list, call } = session();
    expect(manageOnly(await list(as('user')))).toEqual(['restart_agent']);
    expect(manageOnly(await list(as('user2')))).toEqual(['restart_agent']);
    expect(await call('restart_agent', { id: A }, as('user'))).toContain(
      'Restart started',
    );
  });

  it('a custom pick that equals a level is still a custom pick, and counts', async () => {
    roleSettings.set('User', setting('standard'));
    const standard = [...((await assistant.grantFor(people.user)).names ?? [])];
    roleSettings.clear();

    pick(USER.id, standard);
    const view = await assistant.myAccess(people.user);
    expect(view).toMatchObject({ level: 'custom', matchesLevel: 'standard' });
    expect(manageOnly(await session().list(as('user')))).toEqual(
      manageOnly(standard).sort(),
    );
  });

  it('an account’s own built-in level wins over a custom pick of the role', async () => {
    roleSettings.set('User', setting('custom', ['restart_agent']));
    assistantSettings.set(USER.id, setting('full'));
    const { list } = session();
    expect(manageOnly(await list(as('user')))).toEqual([]);
    expect(manageOnly(await list(as('user2')))).toEqual(['restart_agent']);
  });
});

describe('get_my_assistant_access says what the person can actually ask for', () => {
  const mine = async (who: 'user' | 'admin') =>
    JSON.parse(
      await session().call('get_my_assistant_access', {}, as(who)),
    ) as {
      level: string;
      areas: { key: string; offered: number; available: number }[];
      notIncluded: { title: string }[];
      onlyOnAgentsYouCreated?: { title: string }[];
      agentsYouCreated?: { id: string; name: string }[];
      onlyOnAgentsYouCreatedNote?: string;
      levels: {
        key: string;
        ownAgentsOnly: number;
        areas: { key: string; offered: number }[];
      }[];
    };
  const titleOf = (name: string) =>
    registered.find((t) => t.metadata.name === name)!.metadata.title;
  const offeredIn = (
    areas: { key: string; offered: number }[],
    key = 'agents',
  ) => areas.find((a) => a.key === key)?.offered ?? 0;

  it('a User on a built-in level: agent abilities are named as good for their own agents only, and not counted', async () => {
    roleSettings.set(UserRoleTypes.User, {
      enabled: true,
      level: 'standard',
      custom: null,
      updatedById: OWNER.id,
      updatedAt: null,
    });
    const out = await mine('user');
    const listed = await session().list(as('user'));

    expect(out.level).toBe('standard');
    const ownOnly = (out.onlyOnAgentsYouCreated ?? []).map((a) => a.title);
    expect(ownOnly).toContain(titleOf('restart_agent'));
    expect(ownOnly).toContain(titleOf('read_agent_file'));
    expect(out.onlyOnAgentsYouCreatedNote).toMatch(/created themselves/);
    // This User created none: the list is there, and empty.
    expect(out.agentsYouCreated).toEqual([]);
    // Not presented as left out of the level either.
    expect(out.notIncluded.map((a) => a.title)).not.toContain(
      titleOf('restart_agent'),
    );
    // What is counted as theirs is what the listing holds: of the tools
    // here, `list_agents` and `get_agent` in the agents area.
    expect(listed).toEqual(
      expect.arrayContaining(['list_agents', 'get_agent']),
    );
    expect(manageOnly(listed)).toEqual([]);
    const counted = registered.filter(
      (t) =>
        t.metadata.topic === 'agents' &&
        listed.includes(t.metadata.name) &&
        t.audience !== 'everyone' &&
        t.audience !== 'agent',
    ).length;
    expect(offeredIn(out.areas)).toBe(counted);
    // And the level definitions say the same about every built-in level.
    for (const level of out.levels) {
      expect(level.ownAgentsOnly).toBeGreaterThan(0);
      expect(offeredIn(level.areas)).toBe(counted);
    }
  });

  it('a User with a custom pick: what was ticked is counted, and nothing is held back', async () => {
    pick(USER.id, ['list_agents', 'restart_agent']);
    const out = await mine('user');

    expect(out.level).toBe('custom');
    expect(out.onlyOnAgentsYouCreated).toBeUndefined();
    expect(out.onlyOnAgentsYouCreatedNote).toBeUndefined();
    expect(offeredIn(out.areas)).toBe(2);
    expect(out.notIncluded.map((a) => a.title)).toContain(
      titleOf('delete_agent'),
    );
    expect(await session().list(as('user'))).toEqual(
      expect.arrayContaining(['list_agents', 'restart_agent']),
    );
  });

  it('an Admin manages by role: nothing is held back at any level', async () => {
    const out = await mine('admin');
    expect(out.onlyOnAgentsYouCreated).toBeUndefined();
    for (const level of out.levels) expect(level.ownAgentsOnly).toBe(0);
  });
});

describe('everybody else, as before', () => {
  it('the Owner, the assistant for itself and an Admin have every manage-agent tool', async () => {
    const { list } = session();
    expect(manageOnly(await list(as('owner')))).toEqual(MANAGE_AGENT);
    expect(manageOnly(await list(as('admin')))).toEqual(MANAGE_AGENT);
    // The connection tools are made for a person; the rest are the agent's
    // own on its schedule too.
    const forItself = manageOnly(await list(TRUSTED));
    expect(forItself).toEqual(
      expect.arrayContaining(['restart_agent', 'delete_agent', 'stop_agent']),
    );
    expect(forItself).not.toContain('connect_agent_peer');
  });

  it('an Admin still manages the agents they reach and not the Ranch admin agent', async () => {
    const { call } = session();
    expect(await call('restart_agent', { id: A }, as('admin'))).toContain(
      'Restart started',
    );
    expect(await call('restart_agent', { id: RANCH }, as('admin'))).toMatch(
      /not found/i,
    );
    expect(await call('restart_agent', { id: RANCH }, as('owner'))).toContain(
      'Restart started',
    );
  });

  it('a setting narrows an Admin through the assistant to what it holds', async () => {
    // The catalogue the handler lists from is the one the assistant's
    // policy was registered on.
    pick(ADMIN.id, ['list_agents']);
    const { list, call } = session();
    const listed = await list(as('admin'));
    expect(listed).toContain('list_agents');
    expect(manageOnly(listed)).toEqual([]);
    expect(await call('restart_agent', { id: A }, as('admin'))).toBe(
      notAvailable('restart_agent'),
    );
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('with their own console token an Admin is not narrowed by it', async () => {
    pick(ADMIN.id, ['list_agents']);
    const own = session({
      user: { sub: ADMIN.id, email: '', roles: [UserRoleTypes.Admin] },
    });
    expect(manageOnly(await own.list())).toEqual(MANAGE_AGENT);
  });
});

/**
 * A person who manages an agent only because the setting gave them a tool is
 * not an operator. The tool does to the agent what it is named for. It does
 * not bind the agent to something that person has no route to (a model
 * credential, a knowledge base, a bot, an address outside the Ranch), it
 * does not change who reaches the agent, and it answers with no more than a
 * reader gets.
 */
describe('a tool the setting gave is not an operator’s power', () => {
  /** What only an operator is told about an agent. */
  const OPERATOR_ONLY = [
    'config-of-alpha',
    'llm-1',
    'kb-1',
    'wf-of-alpha',
    'why-alpha-failed',
    'createdById',
  ];
  const withNone = (text: string) =>
    OPERATOR_ONLY.filter((secret) => text.includes(secret));

  describe('update_agent', () => {
    beforeEach(() => pick(USER.id, ['update_agent']));

    it('renames and describes, and answers with the reader’s view of the agent', async () => {
      const said = await session().call(
        'update_agent',
        { id: A, name: 'alpha-two', description: 'Answers orders.' },
        as('user'),
      );
      expect(agents.update).toHaveBeenCalledTimes(1);
      expect(agents.update.mock.calls[0][1]).toMatchObject({
        name: 'alpha-two',
        llmCredentialId: undefined,
        knowledgeIds: undefined,
      });
      expect(said).toContain('alpha-two');
      expect(withNone(said)).toEqual([]);
    });

    it.each([
      ['llmCredentialId', { llmCredentialId: 'llm-of-somebody' }],
      ['llmCredentialId', { llmCredentialId: null }],
      ['knowledgeIds', { knowledgeIds: ['kb-of-somebody'] }],
      ['knowledgeIds', { knowledgeIds: [] }],
    ])(
      'refuses %s by name, and saves nothing of the call',
      async (field, patch) => {
        const said = await session().call(
          'update_agent',
          { id: A, name: 'alpha-two', ...patch },
          as('user'),
        );
        expect(said).toContain(`(${field})`);
        expect(said).toContain('is for an Owner or Admin');
        expect(agents.update).not.toHaveBeenCalled();
      },
    );

    it('an agent out of reach is still not found, whatever the call names', async () => {
      const said = await session().call(
        'update_agent',
        { id: B, llmCredentialId: 'llm-of-somebody' },
        as('user'),
      );
      expect(said).toMatch(/not found/i);
      expect(said).not.toContain('Owner or Admin');
    });

    it('an Admin changes both bindings and gets the row whole', async () => {
      const said = await session().call(
        'update_agent',
        { id: A, llmCredentialId: 'llm-2', knowledgeIds: ['kb-2'] },
        as('admin'),
      );
      expect(agents.update.mock.calls[0][1]).toMatchObject({
        llmCredentialId: 'llm-2',
        knowledgeIds: ['kb-2'],
      });
      expect(said).toContain('config-of-alpha');
      expect(said).toContain('llm-2');
    });
  });

  describe('what a reply holds', () => {
    it.each([
      ['stop_agent', { id: A, confirm: true }],
      ['start_agent', { id: A }],
    ])(
      '%s hands back the reader’s view, to an Admin the row',
      async (name, args) => {
        pick(USER.id, [name]);
        const { call } = session();

        const forUser = await call(name, args, as('user'));
        expect(forUser).toContain('alpha');
        expect(withNone(forUser)).toEqual([]);

        const forAdmin = await call(name, args, as('admin'));
        expect(forAdmin).toContain('config-of-alpha');
        expect(forAdmin).toContain('llm-1');
      },
    );

    it('get_agent_status says whether it is up, and nothing about the inside of the pod', async () => {
      pick(USER.id, ['get_agent_status']);
      const { call } = session();

      const forUser = JSON.parse(
        await call('get_agent_status', { id: A }, as('user')),
      ) as Record<string, unknown>;
      expect(forUser).toEqual({
        id: A,
        name: 'alpha',
        status: 'running',
        pod: {
          phase: 'Running',
          ready: true,
          restartCount: 2,
          containerWaitingReason: null,
        },
      });

      const forAdmin = await call('get_agent_status', { id: A }, as('admin'));
      for (const inside of [
        'why-alpha-failed',
        'OOMKilled',
        'node-7',
        'crm-server',
      ]) {
        expect(forAdmin).toContain(inside);
      }
    });
  });

  // Each of these stays listed for the person: the setting holds it. What
  // it would do is an operator's, so it answers with that and touches
  // nothing. `never(...)` stands behind every one of them.
  const REFUSED: Array<[string, Record<string, unknown>]> = [
    ['get_agent_env', { id: A }],
    ['list_agent_mcps', { id: A }],
    ['get_agent_logs', { agentId: A }],
    ['set_agent_channels', { agentId: A, channels: [] }],
    ['set_agent_visibility', { agent: A, isPublic: true, confirm: true }],
    ['import_external_agent', { agentId: A, url: 'https://other.example' }],
    ['import_agent_from_card', { agentId: A, card: '{}' }],
  ];

  it.each(REFUSED)(
    '%s is refused as an operator’s, with nothing reached',
    async (name, args) => {
      pick(USER.id, [name]);
      const { list, call } = session();
      expect(await list(as('user'))).toContain(name);

      const said = await call(name, args, as('user'));
      expect(said).toContain('is for an Owner or Admin');
      expect(said).not.toContain('was reached');
    },
  );

  it.each(REFUSED)(
    '%s: an agent out of reach is not found first, in the usual words',
    async (name, args) => {
      pick(USER.id, [name]);
      const elsewhere = Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          value === A ? B : value,
        ]),
      );
      const said = await session().call(name, elsewhere, as('user'));
      expect(said).toMatch(/not found/i);
      expect(said).not.toContain('Owner or Admin');
    },
  );

  it.each(REFUSED)(
    '%s still gets to its service for an Admin',
    async (name, args) => {
      const said = await session().call(name, args, as('admin'));
      expect(said).not.toContain('is for an Owner or Admin');
      expect(said).toContain('was reached');
    },
  );
});
