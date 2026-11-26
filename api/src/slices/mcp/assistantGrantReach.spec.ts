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
    statusReason: null,
    workflowId: null,
    config: { note: `config-of-${name}` },
    resources: { cpu: '1', memory: '1Gi' },
    isPublic: false,
    isAdmin,
    allowedOrigins: [],
    knowledgeIds: [],
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
} as unknown as IAgentGateway;

const permission = new AgentPermissionService(agents, access);
const agentDeploy = { restartAgent: jest.fn(() => Promise.resolve()) };
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
      never('agentDeploy'),
      never('agentStatus'),
      never('pods'),
      never('workflows'),
      never('files'),
      never('mcpResolver'),
      permission,
      access,
      never('pins'),
      never('toolState'),
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
  [AssistantAccessTool, new AssistantAccessTool(assistant)],
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

  it('Basic, what a User has with nothing configured: the reading tools, and nothing that changes an agent', async () => {
    const { list, call } = session();
    const listed = manageOnly(await list(as('user')));

    // Basic is "see and ask": every tool that only reads. Pinned by name,
    // because each of these now answers a User about the agents they reach.
    expect(listed).toEqual([
      'export_agent_files',
      'get_agent_channels',
      'get_agent_env',
      'get_agent_limits',
      'get_agent_logs',
      'get_agent_status',
      'list_agent_delegations',
      'list_agent_files',
      'list_agent_mcps',
      'list_agent_peers',
      'list_agent_secrets',
      'list_peer_candidates',
      'preview_agent_card',
      'read_agent_file',
    ]);
    const effects = new Map(
      registered.map((t) => [t.metadata.name, t.metadata.effect]),
    );
    expect(listed.every((name) => effects.get(name) === 'read')).toBe(true);

    expect(await call('restart_agent', { id: A }, as('user'))).toBe(
      notAvailable('restart_agent'),
    );
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();

    // On the agent they reach a reading tool gets to its service; on the
    // one they do not, it is the not-found of an unknown id.
    await call('list_agent_secrets', { agentId: A }, as('user'));
    expect(secretStore.list).toHaveBeenCalledTimes(1);
    expect(
      await call('list_agent_secrets', { agentId: B }, as('user')),
    ).toMatch(/not found/i);
    expect(secretStore.list).toHaveBeenCalledTimes(1);
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

describe('what the setting says a person has is what they can call', () => {
  it.each(['basic', 'standard', 'full'] as const)(
    'a User on %s is listed every agent ability the level holds, and no other',
    async (level) => {
      roleSettings.set(UserRoleTypes.User, {
        enabled: true,
        level,
        custom: null,
        updatedById: OWNER.id,
        updatedAt: new Date('2026-11-26T10:00:00.000Z'),
      });
      const grant = await assistant.grantFor(people.user);
      const held = manageOnly([...(grant.names ?? [])]).sort();

      expect(manageOnly(await session().list(as('user')))).toEqual(held);
      if (level !== 'basic') expect(held).toContain('restart_agent');
    },
  );
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
