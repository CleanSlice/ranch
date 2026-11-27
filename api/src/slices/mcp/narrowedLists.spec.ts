/**
 * A list narrowed by access says so, and the records of the Ranch assistant
 * are the Owner's (CLEAN-268).
 *
 * On 2026-11-27 an Admin whose access is limited to one agent asked the
 * assistant for the incidents of the last month. `list_agent_incidents` and
 * `list_agent_events` came back empty, correctly: the two incidents of that
 * month were on agents this Admin does not reach. The assistant answered
 * "there are no incidents or events", which is a statement about the
 * installation, and it was false. Nothing in the result said that it covered
 * that person's agents only.
 *
 * Part one, for every tool that lists or sums across agents and narrows by
 * the caller's access lists:
 *
 *  - a caller whose lists narrow something gets the rows of the agents they
 *    reach and one field, `scope`, with one sentence that names no agent and
 *    no number;
 *  - the Owner, the assistant acting for itself and a person whose lists
 *    narrow nothing get no such field;
 *  - a call that names one agent gets none either, and an agent out of reach
 *    stays not found.
 *
 * Which tools those are is read off the source: every tool whose method
 * asks `AgentAccessService.reachableIds`, itself or through a helper of its
 * class. A new one fails this spec until it is filed below, as a list that
 * carries the field or as a tool that needs none, with the reason.
 *
 * Part two, for a person who has the assistant and is not the Owner: its
 * usage, its request limits, its evaluations and its scenarios are refused
 * in one sentence with `reason: "owner_only"`, a list over every agent
 * leaves them out and says so in `notIncluded`, and no total holds them.
 * What stays readable is asserted too: its events and incidents.
 *
 * Nothing about the rule is stubbed. The MCP handler, the catalogue with the
 * assistant's policy on it, the setting service, the access lists and
 * `AgentPermissionService` are the real ones, and the tools are the real
 * classes over data held in memory.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request } from 'express';
import { IAgentGateway } from '#/agent/agent/domain';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { AgentEventTool } from '#/agent/event/agentEvent.tool';
import { AgentLimitTool } from '#/agent/limit/agentLimit.tool';
import { ShareLinkService } from '#/agent/shareLink/domain';
import type { IShareLinkData } from '#/agent/shareLink/domain/shareLink.types';
import { ShareLinkTool } from '#/agent/shareLink/shareLink.tool';
import { McpOauthTool } from '#/mcpServer/oauth/mcpOauth.tool';
import { ChatTool } from '#/chat/chat.tool';
import { LlmTool } from '#/llm/llm.tool';
import { PaddockEvaluationTool } from '#/paddock/evaluation/evaluation.tool';
import { PaddockScenarioTool } from '#/paddock/scenario/scenario.tool';
import { RancherTool } from '#/rancher/rancher.tool';
import { IUsageGateway } from '#/usage/domain';
import { UsageTool } from '#/usage/usage.tool';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  accessHarness,
  usersGateway,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { AssistantAccessWiring } from '#/user/assistantAccess/assistantAccess.wiring';
import { AssistantAccessService } from '#/user/assistantAccess/domain/assistantAccess.service';
import type { IAssistantSettingData } from '#/user/assistantAccess/domain/assistantAccess.types';
import {
  AssistantToolPolicyService,
  MY_ASSISTANT_ACCESS_TOOL,
} from '#/user/assistantAccess/domain/assistantToolPolicy.service';
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
import {
  ACCESS_SCOPE_FIELD,
  ACCESS_SCOPE_NOTE,
  ACCESS_SCOPE_TEXT,
  OWNER_ONLY_LEFT_OUT_FIELD,
} from './tooling';

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
// Two agents and the assistant. ADMIN is limited to `alpha`; ADMIN2 has
// lists that narrow nothing. Both have the assistant, as an Admin does by
// default.

const A = 'agent-aaa';
const B = 'agent-bbb';
const RANCH = 'agent-ranch';
const GHOST = 'agent-zzz';
const NAMES: Record<string, string> = {
  [A]: 'alpha',
  [B]: 'bravo',
  [RANCH]: 'Rancher',
};
const IDS = [A, B, RANCH];

const AGENTS = IDS.map(
  (id) =>
    ({
      id,
      name: NAMES[id],
      isAdmin: id === RANCH,
      isPublic: false,
      createdById: null,
      status: 'running',
      templateId: 'tpl-1',
      llmCredentialId: 'llm-1',
      config: {},
    }) as unknown as IAgentData,
);

const { service: access, gateway: lists } = accessHarness(IDS);
lists.seed(ADMIN.id, true, [{ agentId: A, list: 'allowed' }]);

const agents = {
  findAll: () => Promise.resolve(AGENTS),
  findAdmin: () => Promise.resolve(AGENTS[2]),
  findById: (id: string) =>
    Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
  hasCreatedBy: () => Promise.resolve(false),
} as unknown as IAgentGateway;
const permission = new AgentPermissionService(agents, access);

// ── What Ranch keeps about each agent ────────────────────────

interface IScope {
  in?: string[];
  notIn?: string[];
}
const within = (scope: IScope | undefined, agentId: string) =>
  (!scope?.in || scope.in.includes(agentId)) &&
  !scope?.notIn?.includes(agentId);

/** In every record of the assistant that could carry what only the Owner reads. */
const SECRET = 'OWNER-ONLY';
const mark = (agentId: string) => (agentId === RANCH ? SECRET : NAMES[agentId]);

const AT = new Date('2026-11-20T09:00:00.000Z');
const event = (agentId: string) => ({
  id: `event-of-${agentId}`,
  agentId,
  agentRef: agentId,
  agentName: NAMES[agentId],
  status: 'down',
  reason: 'CrashLoopBackOff',
  witness: 'ranch',
  senderName: 'Ranch',
  tool: null,
  ranchStatus: 'failed',
  outcome: 'opened',
  incidentId: `incident-of-${agentId}`,
  occurredAt: AT,
  receivedAt: AT,
});
const incident = (agentId: string, n = 1) => ({
  id: `incident-of-${agentId}-${n}`,
  number: n,
  agentId,
  agentName: NAMES[agentId],
  open: false,
  status: 'down',
  reason: 'CrashLoopBackOff',
  witnesses: ['Ranch'],
  ranchWitnessed: true,
  eventCount: 1,
  openedAt: AT,
  lastFailureAt: AT,
  upSince: AT,
  closedAt: AT,
  resolution: 'recovered',
  notifications: [],
});
/** Rewritten by the replay of the incident; restored before each test. */
let EVENTS = IDS.map(event);
let INCIDENTS = IDS.map((id) => incident(id));

interface IPageFilter {
  agentId?: string;
  agentScope?: IScope;
}
const page = <T extends { agentId: string }>(rows: T[], f: IPageFilter) => ({
  items: rows.filter(
    (row) =>
      (!f.agentId || row.agentId === f.agentId) &&
      within(f.agentScope, row.agentId),
  ),
  nextCursor: null,
});
const events = {
  listEvents: jest.fn((f: IPageFilter) => Promise.resolve(page(EVENTS, f))),
  listIncidents: jest.fn((f: IPageFilter) =>
    Promise.resolve(page(INCIDENTS, f)),
  ),
};

const usageRow = (agentId: string) => ({
  id: `usage-of-${agentId}`,
  agentId,
  agentName: NAMES[agentId],
  llmCredentialId: 'llm-1',
  model: 'm',
  date: new Date('2026-11-17T00:00:00Z'),
  inputTokens: 1000,
  outputTokens: 100,
  callCount: 5,
});
const usage = {
  findRecentAll: jest.fn(() => Promise.resolve(IDS.map(usageRow))),
  findRecentForCredential: jest.fn(() => Promise.resolve(IDS.map(usageRow))),
  findRecentForAgent: jest.fn((agentId: string) =>
    Promise.resolve([usageRow(agentId)]),
  ),
};

const chatRow = (agentId: string) => ({
  id: `chat-of-${agentId}`,
  agentId,
  channel: 'bridle',
  externalUserId: 'admin',
  sessionKey: 'bridle:admin',
  title: `${mark(agentId)} title`,
  preview: '',
  lastRole: 'user',
  lastMessageAt: AT,
  messageCount: 1,
  userMessageCount: 1,
  summary: null,
  summaryAt: null,
  insights: null,
  archived: false,
  createdAt: AT,
});
const chats = {
  findById: () => Promise.resolve(null),
  list: jest.fn((f: IPageFilter) => {
    const { items } = page(IDS.map(chatRow), f);
    return Promise.resolve({ items, total: items.length });
  }),
};
const sync = {
  syncAll: jest.fn(
    (agentId: string | undefined, reach: { has(id: string): boolean }) => {
      const walked = (agentId ? [agentId] : IDS).filter((id) => reach.has(id));
      return Promise.resolve({
        scannedAgents: walked.length,
        scannedFiles: walked.length,
        upserted: 0,
        skipped: 0,
      });
    },
  ),
};

const NO_RECORD = 'no-such-record';
const evaluationOf = (agentId: string) => ({
  id: `eval-of-${agentId}`,
  agentId,
  templateId: 'tpl-1',
  status: 'completed',
  summary: `${mark(agentId)} summary`,
  results: [],
});
const EVALUATIONS = IDS.map(evaluationOf);
const evaluationById = (id: string) => {
  const found = EVALUATIONS.find((e) => e.id === id);
  return found
    ? Promise.resolve(found)
    : Promise.reject(new NotFoundException('Evaluation not found'));
};
/** Every way an evaluation is read or acted on, once it was let through. */
const evaluationReads = {
  getReport: jest.fn((id: string) => evaluationById(id)),
  getLogs: jest.fn((id: string) =>
    evaluationById(id).then((e) => ({ lines: [e.summary] })),
  ),
  getScenario: jest.fn((id: string) => evaluationById(id)),
  getTrace: jest.fn((id: string) => evaluationById(id)),
  abort: jest.fn((id: string) => evaluationById(id)),
  rerun: jest.fn((id: string) =>
    evaluationById(id).catch(() => {
      throw new NotFoundException('Source evaluation not found');
    }),
  ),
  start: jest.fn((input: { agentId: string }) =>
    Promise.resolve(evaluationOf(input.agentId)),
  ),
};
const evaluations = {
  ...evaluationReads,
  getById: jest.fn(evaluationById),
  list: jest.fn((f: { agentId?: string }) =>
    Promise.resolve(
      EVALUATIONS.filter((e) => !f.agentId || e.agentId === f.agentId),
    ),
  ),
};

const scenarioOf = (agentId: string | null) => ({
  id: agentId ? `scenario-of-${agentId}` : 'scenario-of-template',
  agentId,
  templateId: agentId ? null : 'tpl-1',
  name: agentId ? `${mark(agentId)} scenario` : 'template scenario',
  expectedBehavior: agentId ? `${mark(agentId)} expectation` : 'x',
});
const SCENARIOS = [...IDS.map(scenarioOf), scenarioOf(null)];
const scenarioWrites = {
  create: jest.fn((data: object) => Promise.resolve({ id: 'new', ...data })),
  update: jest.fn((id: string) => Promise.resolve({ id })),
  delete: jest.fn(() => Promise.resolve()),
};
const scenarios = {
  ...scenarioWrites,
  findById: jest.fn((id: string) =>
    Promise.resolve(SCENARIOS.find((s) => s.id === id) ?? null),
  ),
  findAll: jest.fn((f: { agentId?: string }) =>
    Promise.resolve(
      SCENARIOS.filter((s) => !f.agentId || s.agentId === f.agentId),
    ),
  ),
  findForAgent: jest.fn((agentId: string) =>
    Promise.resolve(SCENARIOS.filter((s) => s.agentId === agentId)),
  ),
};
const generator = {
  generate: jest.fn(() => Promise.resolve({ name: 'draft' })),
};

const limits = {
  summary: (list: { id: string }[]) =>
    list.map((a) => ({
      agentId: a.id,
      enabled: true,
      atLimit: false,
      needsLimits: false,
    })),
  getLimits: () => ({ perMinute: 5, perHour: 50, perDay: 500 }),
};

// The public links: the real service over rows held in memory, so that a
// link the Owner made can be followed by a visitor after an Admin was
// refused it.
const linkRows = new Map<string, IShareLinkData>();
let linkClock = Date.parse('2026-11-27T09:00:00.000Z');
const linkRow = (
  agentId: string,
  token: string,
  userId: string,
  previous?: IShareLinkData,
): IShareLinkData => {
  const at = new Date((linkClock += 1000)).toISOString();
  const row = {
    id: `link-${agentId}`,
    agentId,
    token,
    revokedAt: null,
    rotatedAt: previous ? at : null,
    rotationCount: previous ? previous.rotationCount + 1 : 0,
    createdBy: previous?.createdBy ?? userId,
    updatedBy: userId,
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  } as IShareLinkData;
  linkRows.set(agentId, row);
  return row;
};
const linkWrites = {
  create: jest.fn((input: { agentId: string; token: string; userId: string }) =>
    Promise.resolve(linkRow(input.agentId, input.token, input.userId)),
  ),
  rotate: jest.fn((agentId: string, token: string, userId: string) =>
    Promise.resolve(linkRow(agentId, token, userId, linkRows.get(agentId))),
  ),
  revoke: jest.fn((agentId: string, userId: string) => {
    const row = {
      ...linkRows.get(agentId)!,
      revokedAt: new Date((linkClock += 1000)).toISOString(),
      updatedBy: userId,
    };
    linkRows.set(agentId, row);
    return Promise.resolve(row);
  }),
};
const linkReads = {
  findByAgent: jest.fn((agentId: string) =>
    Promise.resolve(linkRows.get(agentId) ?? null),
  ),
  findByToken: jest.fn((token: string) =>
    Promise.resolve(
      [...linkRows.values()].find((row) => row.token === token) ?? null,
    ),
  ),
};
const shareLinks = new ShareLinkService(
  { ...linkReads, ...linkWrites } as never,
  agents,
  { findById: () => Promise.resolve(null) } as never,
  { findByIds: () => Promise.resolve([]) } as never,
  { getLimits: () => null } as never,
);

const oauth = {
  start: jest.fn((input: { agentId: string }) =>
    Promise.resolve({ authorizeUrl: `https://provider.test/${input.agentId}` }),
  ),
};

// ── The tools: the real classes, read the way the registry reads them ──

const unused = <T>(name: string): T =>
  new Proxy(
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

const llmModule = {
  get: (token: unknown) => {
    if (token === AgentAccessService) return access;
    if (token === IUsageGateway) return usage;
    if (token === IAgentGateway) return agents;
    throw new Error('an unexpected token was resolved');
  },
} as unknown as ModuleRef;

const instances = new Map<unknown, unknown>([
  [
    AgentEventTool,
    new AgentEventTool(events as never, unused('destinations'), agents, access),
  ],
  [
    AgentLimitTool,
    new AgentLimitTool(limits as never, agents, permission, access),
  ],
  [
    ChatTool,
    new ChatTool(
      chats as never,
      unused('reader'),
      sync as never,
      unused('insight'),
      access,
      permission,
      agents,
    ),
  ],
  [
    LlmTool,
    new LlmTool(
      {
        findById: (id: string) =>
          Promise.resolve(
            id === 'llm-1'
              ? {
                  id,
                  provider: 'claude',
                  model: 'm',
                  label: 'l',
                  status: 'active',
                }
              : null,
          ),
        delete: jest.fn(() => Promise.resolve()),
      } as never,
      unused('health'),
      llmModule,
    ),
  ],
  [
    PaddockEvaluationTool,
    new PaddockEvaluationTool(evaluations as never, access),
  ],
  [
    PaddockScenarioTool,
    new PaddockScenarioTool(scenarios as never, generator as never, access),
  ],
  [
    RancherTool,
    new RancherTool(
      agents,
      unused('agentDeploy'),
      unused('templates'),
      unused('templateFiles'),
      unused('llms'),
      {
        findDependentAgents: () =>
          Promise.resolve(
            AGENTS.map((a) => ({
              id: a.id,
              name: a.name,
              status: a.status,
              templateId: 'tpl-1',
              templateName: 'tpl',
            })),
          ),
      } as never,
      unused('settings'),
      usage as never,
      unused('files'),
      unused('rancher'),
      permission,
      access,
      { pinnedIds: () => Promise.resolve(new Set<string>()) } as never,
    ),
  ],
  [UsageTool, new UsageTool(usage as never, agents, access)],
  [ShareLinkTool, new ShareLinkTool(shareLinks, agents, access)],
  [McpOauthTool, new McpOauthTool(oauth as never, access)],
]);

interface IRegistered {
  type: 'tool';
  metadata: ToolMetadata;
  providerClass: unknown;
  methodName: string;
  audience: ToolAudienceTypes | undefined;
}
const registered: IRegistered[] = [];
for (const providerClass of instances.keys()) {
  const proto = (providerClass as { prototype: Record<string, unknown> })
    .prototype;
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
      providerClass,
      methodName: method,
      audience: toolAudienceOf(providerClass as never, ref),
    });
  }
}
const registry = {
  getTools: () => registered,
  findTool: (name: string) => registered.find((t) => t.metadata.name === name),
} as unknown as McpRegistryService;
const descriptionOf = (name: string) =>
  registered.find((t) => t.metadata.name === name)!.metadata.description;

// ── The application around them ──────────────────────────────

const assistantSettings = new Map<string, IAssistantSettingData>();
const assistant = new AssistantAccessService(
  {
    findAccount: (userId: string) =>
      Promise.resolve(assistantSettings.get(userId) ?? null),
    findRole: () => Promise.resolve(null),
  } as never,
  usersGateway(),
  agents,
  registry,
);
const policy = new AssistantToolPolicyService(assistant);

const people: Record<string, ICallerParty> = {
  limited: { kind: 'person', userId: ADMIN.id, role: UserRoleTypes.Admin },
  open: { kind: 'person', userId: ADMIN2.id, role: UserRoleTypes.Admin },
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
  resolve: (token: unknown) =>
    instances.has(token)
      ? Promise.resolve(instances.get(token))
      : Promise.reject(new Error('no such tool')),
  get: (token: unknown) => {
    if (!provided.has(token)) throw new Error('no such provider');
    return provided.get(token);
  },
} as unknown as ModuleRef;

const catalog = new ToolCatalogService(moduleRef, registry);
provided.set(ToolCatalogService, catalog);
new AssistantAccessWiring(access, catalog, assistant, policy).onModuleInit();

/** The token of the assistant's runtime: the Ranch admin agent, Owner power. */
const ASSISTANT_TOKEN = {
  user: { sub: `agent:${RANCH}`, email: '', roles: [UserRoleTypes.Owner] },
};
/** A person's own console token on the MCP endpoint. */
const consoleOf = (who: { id: string; role: UserRoleTypes }) => ({
  user: { sub: who.id, email: '', roles: [who.role] },
});

type Handler = (request: unknown) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

/** One call of one tool, in a session of whoever holds `bearer`. */
async function call(
  name: string,
  args: object,
  actor?: Actor,
  bearer: object = ASSISTANT_TOKEN,
): Promise<string> {
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
  const result = await handlers.get(CallToolRequestSchema)!({
    params: {
      name,
      arguments: args,
      ...(actor ? { _meta: { 'ranch/actor': actor } } : {}),
    },
  });
  return result.content.map((c) => c.text).join('\n');
}

/** The Admin limited to `alpha`, asking through the assistant. */
const asLimited = (name: string, args: object = {}) =>
  call(name, args, as('limited'));
/** The Admin whose lists narrow nothing. */
const asOpen = (name: string, args: object = {}) =>
  call(name, args, as('open'));
const asOwner = (name: string, args: object = {}) =>
  call(name, args, as('owner'));
const forItself = (name: string, args: object = {}) =>
  call(name, args, TRUSTED);

type Result = Record<string, unknown>;
const parsed = async (said: Promise<string>) =>
  JSON.parse(await said) as Result;
const json = (value: unknown) => JSON.stringify(value, null, 2);
const AGENT_NOT_FOUND = (id: string) =>
  json({ error: `Agent ${id} not found — call list_agents to find the id` });

const switchAssistantOff = (who: { id: string }) =>
  assistantSettings.set(who.id, {
    enabled: false,
    level: 'full',
    custom: null,
    updatedById: OWNER.id,
    updatedAt: new Date('2026-11-27T10:00:00.000Z'),
  });

beforeEach(() => {
  linkRows.clear();
  assistantSettings.clear();
  EVENTS = IDS.map(event);
  INCIDENTS = IDS.map((id) => incident(id));
  jest.clearAllMocks();
});

// ── Which tools narrow by reach: read off the source ─────────

/** Every `*.tool.ts` under `slices/`. */
function toolFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return toolFiles(path);
    return entry.name.endsWith('.tool.ts') ? [path] : [];
  });
}

/**
 * The tools of one file whose method asks `reachableIds`, itself or through
 * a method of its class that does. The code is formatted by prettier, so a
 * member of a class starts at two spaces and ends at a line that is `  }`.
 */
function reachTools(source: string): string[] {
  const members: string[] = [];
  let current: string[] = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    current.push(line);
    if (line === '  }') {
      members.push(current.join('\n'));
      current = [];
    }
  }
  // The last signature of the piece: an empty constructor (`) {}`) does not
  // end one, so it rides in front of the method that follows it.
  const nameOf = (member: string) =>
    [
      ...member.matchAll(
        /^ {2}(?:private |protected |public )?(?:async )?(\w+)\(/gm,
      ),
    ].pop()?.[1] ?? null;
  const asks = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const member of members) {
      const name = nameOf(member);
      if (!name || asks.has(name)) continue;
      const calls =
        member.includes('reachableIds(') ||
        [...asks].some((helper) => member.includes(`this.${helper}(`));
      if (calls) {
        asks.add(name);
        grew = true;
      }
    }
  }
  return members
    .filter((member) => member.includes('  @Tool({'))
    .filter((member) => asks.has(nameOf(member) ?? ''))
    .map((member) => {
      const name = /@Tool\(\{\s*name: (?:'([a-z_]+)'|(\w+))/.exec(member);
      // A name held in a constant is looked up; one this spec does not know
      // stays as written, and fails the filing below until it is known.
      return name?.[1] ?? NAMED_TOOLS[name?.[2] ?? ''] ?? name?.[2] ?? '?';
    });
}

/** The tools whose `@Tool` names them through a constant. */
const NAMED_TOOLS: Record<string, string> = { MY_ASSISTANT_ACCESS_TOOL };

const SLICES = join(__dirname, '..');
const REACH_TOOLS = toolFiles(SLICES)
  .flatMap((file) => reachTools(readFileSync(file, 'utf8')))
  .sort();

/**
 * The lists and sums over every agent the caller reaches. Each carries
 * `scope` when the caller's lists narrow something. `args` is what the tool
 * needs besides an agent, `byAgent` that it also takes one agent's id, and
 * `counts` that its result holds numbers and no rows.
 */
const ACROSS: Record<
  string,
  { args?: object; byAgent?: boolean; counts?: boolean }
> = {
  get_usage_overview: {},
  list_agent_events: { byAgent: true },
  list_agent_incidents: { byAgent: true },
  list_agent_limits: {},
  list_chats: { byAgent: true },
  list_paddock_evaluations: { byAgent: true },
  list_paddock_scenarios: { byAgent: true },
  list_skill_agents: { args: { skillId: 'skill-1' } },
  llm_usage: { args: { id: 'llm-1' } },
  // Counts only: how many agents were walked, never which.
  sync_chats: { byAgent: true, counts: true },
};

/**
 * The tools that ask the reach and carry no `scope`, each with the reason.
 * A tool that names one agent or one record covers nothing but that one.
 */
const NOT_A_LIST: Record<string, string> = {
  agent_usage: 'names one agent',
  delete_llm:
    'a sentence, not rows: it names the agents the caller reaches and counts the rest as "N you cannot see"',
  export_chat: 'names one chat',
  get_chat: 'names one chat',
  get_chat_messages: 'names one chat',
  get_my_assistant_access:
    'the person’s own: the agents they created and still reach',
  get_paddock_evaluation: 'names one evaluation',
  get_paddock_evaluation_logs: 'names one evaluation',
  get_paddock_evaluation_report: 'names one evaluation',
  get_paddock_evaluation_scenario_result: 'names one evaluation',
  get_paddock_evaluation_trace: 'names one evaluation',
  abort_paddock_evaluation: 'names one evaluation',
  rerun_paddock_evaluation: 'names one evaluation',
  run_paddock_evaluation: 'names one agent',
  create_paddock_scenario: 'names one agent or one template',
  generate_paddock_scenarios: 'names one agent or one template',
  list_agent_paddock_scenarios: 'names one agent',
  get_paddock_scenario: 'names one scenario',
  update_paddock_scenario: 'names one scenario',
  delete_paddock_scenario: 'names one scenario',
  list_agents:
    'the reach itself: its rows are the agents this person can use, its description says the list is never every agent of the installation, and its shape (a bare array) is what every reader of it parses',
  summarize_chat: 'names one chat',
  get_share_link: 'names one agent',
  create_share_link: 'names one agent',
  regenerate_share_link: 'names one agent',
  revoke_share_link: 'names one agent',
  start_mcp_oauth: 'names one agent',
};

describe('which tools narrow by the caller’s access lists', () => {
  it('every tool that asks the reach is filed: as a list that says when it was narrowed, or with the reason it needs not', () => {
    expect(REACH_TOOLS).toEqual(
      [...Object.keys(ACROSS), ...Object.keys(NOT_A_LIST)].sort(),
    );
  });

  it('the reading of the source finds what it is there to find', () => {
    // Through a helper of the class, through two of them, and directly.
    expect(REACH_TOOLS).toEqual(
      expect.arrayContaining([
        'list_agent_incidents',
        'get_chat_messages',
        'get_usage_overview',
      ]),
    );
    // A tool of the same class that never asks the reach is not swept in.
    expect(REACH_TOOLS).not.toContain('get_notification_destination');
    expect(REACH_TOOLS).not.toContain('restart_agent');
  });

  it('every such list is called below through the real handler', () => {
    const loaded = registered.map((t) => t.metadata.name);
    expect(loaded).toEqual(expect.arrayContaining(Object.keys(ACROSS)));
  });
});

// ── Part one: the field ──────────────────────────────────────

describe('the sentence', () => {
  it('is one constant under one field name', () => {
    expect(ACCESS_SCOPE_FIELD).toBe('scope');
    expect(ACCESS_SCOPE_TEXT).toBe(
      'Only the agents this person can use are covered. That is an access ' +
        'limit: other agents may have records this result does not show.',
    );
  });

  it('names no agent, no id and no number', () => {
    expect(ACCESS_SCOPE_TEXT).not.toMatch(/\d/);
    for (const word of [...IDS, ...Object.values(NAMES), 'agent-']) {
      expect(ACCESS_SCOPE_TEXT).not.toContain(word);
    }
    expect(ACCESS_SCOPE_TEXT).not.toMatch(/\b(one|two|three|all|every)\b/i);
  });
});

describe.each(Object.keys(ACROSS))('%s', (name) => {
  const { args = {}, byAgent = false, counts = false } = ACROSS[name];

  it('an Admin limited to one agent: that agent’s rows, and the field', async () => {
    const said = await asLimited(name, args);
    const result = JSON.parse(said) as Result;

    expect(result[ACCESS_SCOPE_FIELD]).toBe(ACCESS_SCOPE_TEXT);
    // The agent out of reach is in no row, by id or by name.
    expect(said).not.toContain(B);
    expect(said).not.toContain(NAMES[B]);
    if (!counts) expect(said).toContain(A);
  });

  it('the field is the same sentence whatever was found, and holds nothing of what was left out', async () => {
    const result = await parsed(asLimited(name, args));
    const scope = String(result[ACCESS_SCOPE_FIELD]);

    expect(scope).toBe(ACCESS_SCOPE_TEXT);
    expect(scope).not.toMatch(/\d/);
    expect(scope).not.toContain(NAMES[B]);
  });

  it('an Admin whose lists narrow nothing: no field', async () => {
    const said = await asOpen(name, args);

    expect(JSON.parse(said)).not.toHaveProperty(ACCESS_SCOPE_FIELD);
    if (!counts) expect(said).toContain(B);
  });

  it('the Owner, and the assistant for itself: every agent and no field', async () => {
    for (const said of [
      await asOwner(name, args),
      await forItself(name, args),
    ]) {
      const result = JSON.parse(said) as Result;

      expect(result).not.toHaveProperty(ACCESS_SCOPE_FIELD);
      expect(result).not.toHaveProperty(OWNER_ONLY_LEFT_OUT_FIELD);
      if (!counts) {
        expect(said).toContain(B);
        expect(said).toContain(RANCH);
      }
    }
  });

  it('says in its description what the field means', () => {
    expect(descriptionOf(name)).toContain(ACCESS_SCOPE_NOTE);
  });

  if (byAgent) {
    it('of one named agent: nothing was narrowed, and no field', async () => {
      const result = await parsed(asLimited(name, { ...args, agentId: A }));

      expect(result).not.toHaveProperty('error');
      expect(result).not.toHaveProperty(ACCESS_SCOPE_FIELD);
    });

    it('a named agent out of reach is not found, in the words it always had', async () => {
      const hidden = await asLimited(name, { ...args, agentId: B });
      const unknown = await asLimited(name, { ...args, agentId: GHOST });

      expect(hidden).toBe(AGENT_NOT_FOUND(B));
      expect(unknown).toBe(AGENT_NOT_FOUND(GHOST));
      expect(hidden).not.toContain(ACCESS_SCOPE_FIELD);
    });
  }
});

describe('the incident of 2026-11-27', () => {
  const SINCE = { since: '2026-10-27T00:00:00Z' };

  beforeEach(() => {
    // Two incidents in the month, both on an agent this Admin does not reach.
    INCIDENTS = [incident(B, 1), incident(B, 2)];
    EVENTS = [event(B)];
  });

  it('the limited Admin gets no rows, and is told that the list covers their agents only', async () => {
    expect(await parsed(asLimited('list_agent_incidents', SINCE))).toEqual({
      incidents: [],
      more: false,
      scope: ACCESS_SCOPE_TEXT,
    });
    expect(await parsed(asLimited('list_agent_events', SINCE))).toEqual({
      events: [],
      more: false,
      scope: ACCESS_SCOPE_TEXT,
    });
  });

  it('with their own console token, the same', async () => {
    const result = await parsed(
      call('list_agent_incidents', SINCE, undefined, consoleOf(ADMIN)),
    );
    expect(result).toEqual({
      incidents: [],
      more: false,
      scope: ACCESS_SCOPE_TEXT,
    });
  });

  it('the Owner is shown both incidents, and no field', async () => {
    const result = await parsed(asOwner('list_agent_incidents', SINCE));

    expect(result.incidents).toHaveLength(2);
    expect(result).not.toHaveProperty(ACCESS_SCOPE_FIELD);
  });

  it('an Admin who reaches every agent is shown them too: an empty list of theirs would be a fact', async () => {
    INCIDENTS = [];
    expect(await parsed(asOpen('list_agent_incidents', SINCE))).toEqual({
      incidents: [],
      more: false,
    });
  });
});

describe('what narrows a reach', () => {
  it('a denied agent does, as much as a limit', async () => {
    lists.seed(ADMIN2.id, false, [{ agentId: B, list: 'denied' }]);
    try {
      const result = await parsed(asOpen('list_agent_incidents'));
      expect(result[ACCESS_SCOPE_FIELD]).toBe(ACCESS_SCOPE_TEXT);
    } finally {
      lists.seed(ADMIN2.id, false, []);
    }
  });

  it('the assistant switched off does: its records are out of the list, and the sentence does not say whose', async () => {
    switchAssistantOff(ADMIN2);
    const said = await call(
      'list_agent_incidents',
      {},
      undefined,
      consoleOf(ADMIN2),
    );
    const result = JSON.parse(said) as Result;

    expect(result[ACCESS_SCOPE_FIELD]).toBe(ACCESS_SCOPE_TEXT);
    expect(said).not.toMatch(/Owner|assistant|Rancher/);
    expect(said).not.toContain(RANCH);
  });

  it('list_chats carries both fields for a limited Admin, and they are different limits', async () => {
    const result = await parsed(asLimited('list_chats'));

    expect(result[ACCESS_SCOPE_FIELD]).toBe(ACCESS_SCOPE_TEXT);
    expect(result[OWNER_ONLY_LEFT_OUT_FIELD]).toBe(
      'The conversations of Rancher, the Ranch assistant, are not included: ' +
        'only the Owner can read them. That is an access limit, not an empty list.',
    );
    // The Admin who reaches every agent is told of the one, not the other.
    const open = await parsed(asOpen('list_chats'));
    expect(open).toHaveProperty(OWNER_ONLY_LEFT_OUT_FIELD);
    expect(open).not.toHaveProperty(ACCESS_SCOPE_FIELD);
  });

  it('list_agents says in its description that it is never every agent of the installation', () => {
    const description = descriptionOf('list_agents');

    expect(description).toMatch(/never every agent of the\s+installation/);
    expect(description).not.toContain('do not assume there are others');
  });
});

describe('delete_llm names the agents the caller reaches and counts the rest', () => {
  it('before the confirmation and after the deletion alike', async () => {
    const asked = await asLimited('delete_llm', { id: 'llm-1' });
    expect(asked).toContain('«alpha»');
    expect(asked).toContain('1 more you cannot see');
    expect(asked).not.toContain(NAMES[B]);

    const done = await asLimited('delete_llm', { id: 'llm-1', confirm: true });
    expect(done).toContain(`«alpha» (${A})`);
    expect(done).toContain('1 more you cannot see');
    expect(done).not.toContain(NAMES[B]);
    expect(done).not.toContain(B);
  });

  it('the Owner is told every one of them', async () => {
    const done = await asOwner('delete_llm', { id: 'llm-1', confirm: true });
    for (const id of IDS) expect(done).toContain(`«${NAMES[id]}» (${id})`);
    expect(done).not.toContain('you cannot see');
  });
});

// ── Part two: the records of the assistant ───────────────────

const OWNER_ONLY = (can: string) => ({
  error: `Rancher is the Ranch assistant. Only the Owner can ${can}.`,
  reason: 'owner_only',
});
const RECORDS = OWNER_ONLY('read its records');
const EVALUATIONS_ONLY = OWNER_ONLY(
  'evaluate it or read its evaluations and scenarios',
);
const LEFT_OUT = (what: string) =>
  `The ${what} of Rancher, the Ranch assistant, are not included: only the ` +
  'Owner can read them. That is an access limit, not an empty list.';

const EVAL_OF = (agentId: string) => `eval-of-${agentId}`;
const SCENARIO_OF = (agentId: string) => `scenario-of-${agentId}`;

/** The tools that name an agent, an evaluation or a scenario of the paddock. */
const PADDOCK_BY_AGENT: Record<string, object> = {
  run_paddock_evaluation: {},
  list_paddock_evaluations: {},
  list_paddock_scenarios: {},
  list_agent_paddock_scenarios: {},
  create_paddock_scenario: {
    category: 'conversation',
    difficulty: 'easy',
    name: 'x',
    description: 'x',
    expectedBehavior: 'x',
    messages: [],
    successCriteria: [],
  },
  generate_paddock_scenarios: { description: 'x' },
};
const BY_EVALUATION: Record<string, object> = {
  get_paddock_evaluation: {},
  get_paddock_evaluation_report: {},
  get_paddock_evaluation_logs: {},
  get_paddock_evaluation_scenario_result: { scenarioId: 's' },
  get_paddock_evaluation_trace: { scenarioId: 's' },
  abort_paddock_evaluation: { confirm: true },
  rerun_paddock_evaluation: {},
};
const BY_SCENARIO: Record<string, object> = {
  get_paddock_scenario: {},
  update_paddock_scenario: { name: 'renamed' },
  delete_paddock_scenario: { confirm: true },
};

const nothingOfThePaddockWasTouched = () => {
  for (const spy of [
    ...Object.values(evaluationReads),
    ...Object.values(scenarioWrites),
    generator.generate,
    scenarios.findForAgent,
    scenarios.findAll,
    evaluations.list,
  ]) {
    expect(spy).not.toHaveBeenCalled();
  }
};

describe('the paddock of the assistant is the Owner’s', () => {
  it('walks every tool of the two paddock classes', () => {
    const paddock = registered
      .filter(
        (t) =>
          t.providerClass === PaddockEvaluationTool ||
          t.providerClass === PaddockScenarioTool,
      )
      .map((t) => t.metadata.name)
      .sort();
    // A new paddock tool is filed in one of the three tables, by what it
    // names, and is held to the same answers by being there.
    expect(paddock).toEqual(
      [
        ...Object.keys(PADDOCK_BY_AGENT),
        ...Object.keys(BY_EVALUATION),
        ...Object.keys(BY_SCENARIO),
      ].sort(),
    );
  });

  describe.each(Object.keys(PADDOCK_BY_AGENT))(
    '%s, by its agent id',
    (name) => {
      const args = (agentId: string) => ({
        ...PADDOCK_BY_AGENT[name],
        agentId,
      });

      it.each(['limited', 'open'] as const)(
        'an Admin (%s lists) is told that only the Owner can, and nothing is read or started',
        async (who) => {
          const said = await call(name, args(RANCH), as(who));

          expect(JSON.parse(said)).toEqual(EVALUATIONS_ONLY);
          expect(said).not.toContain(SECRET);
          expect(said).not.toMatch(/not found|list_agents|again|later|retry/i);
          nothingOfThePaddockWasTouched();
        },
      );

      it('with their own console token, the same', async () => {
        const said = await call(name, args(RANCH), undefined, consoleOf(ADMIN));
        expect(JSON.parse(said)).toEqual(EVALUATIONS_ONLY);
      });

      it('an agent out of reach and an id that names nothing are not found, in the words they had', async () => {
        const hidden = await asLimited(name, args(B));
        const unknown = await asLimited(name, args(GHOST));

        expect(hidden).toBe(AGENT_NOT_FOUND(B));
        expect(unknown).toBe(AGENT_NOT_FOUND(GHOST));
        nothingOfThePaddockWasTouched();
      });

      it('an agent they reach is theirs, as before', async () => {
        const said = await asLimited(name, args(A));
        expect(said).not.toMatch(/owner_only|not found/);
      });

      it('the Owner, and the assistant for itself, are answered', async () => {
        for (const said of [
          await asOwner(name, args(RANCH)),
          await forItself(name, args(RANCH)),
        ]) {
          expect(said).not.toMatch(/owner_only|not found/);
        }
      });

      it('an Admin the assistant is switched off for: not found, and nothing about it', async () => {
        switchAssistantOff(ADMIN2);
        const said = await call(
          name,
          args(RANCH),
          undefined,
          consoleOf(ADMIN2),
        );

        expect(said).toBe(AGENT_NOT_FOUND(RANCH));
        expect(said).not.toMatch(/Owner|assistant|owner_only|Rancher/);
      });
    },
  );

  describe.each(Object.keys(BY_EVALUATION))(
    '%s, by the id of one of its evaluations',
    (name) => {
      const args = (id: string) => ({ ...BY_EVALUATION[name], id });

      it.each(['limited', 'open'] as const)(
        'an Admin (%s lists) is told the same, and gets nothing of the evaluation',
        async (who) => {
          const said = await call(name, args(EVAL_OF(RANCH)), as(who));

          expect(JSON.parse(said)).toEqual(EVALUATIONS_ONLY);
          expect(said).not.toContain(SECRET);
          expect(said).not.toContain(EVAL_OF(RANCH));
          nothingOfThePaddockWasTouched();
        },
      );

      it('an evaluation of an agent out of reach is not found, as one that does not exist', async () => {
        const hidden = await asLimited(name, args(EVAL_OF(B)));
        nothingOfThePaddockWasTouched();
        const unknown = await asLimited(name, args(NO_RECORD));

        expect(hidden).toMatch(/not found/i);
        expect(hidden).not.toMatch(/Owner|assistant|owner_only|bravo/);
        expect(hidden.split(EVAL_OF(B)).join('<id>')).toBe(
          unknown.split(NO_RECORD).join('<id>'),
        );
      });

      it('an evaluation of an agent they reach is theirs', async () => {
        const said = await asLimited(name, args(EVAL_OF(A)));
        expect(said).not.toMatch(/owner_only|not found/i);
      });

      it('the Owner reads the assistant’s as any other', async () => {
        const said = await asOwner(name, args(EVAL_OF(RANCH)));
        expect(said).not.toMatch(/owner_only|not found/i);
      });

      it('an Admin the assistant is switched off for: not found', async () => {
        switchAssistantOff(ADMIN2);
        const mine = await call(
          name,
          args(EVAL_OF(RANCH)),
          undefined,
          consoleOf(ADMIN2),
        );
        const unknown = await call(
          name,
          args(NO_RECORD),
          undefined,
          consoleOf(ADMIN2),
        );

        expect(mine).not.toMatch(/Owner|assistant|owner_only|Rancher/);
        expect(mine.split(EVAL_OF(RANCH)).join('<id>')).toBe(
          unknown.split(NO_RECORD).join('<id>'),
        );
      });
    },
  );

  describe.each(Object.keys(BY_SCENARIO))(
    '%s, by the id of one of its scenarios',
    (name) => {
      const args = (id: string) => ({ ...BY_SCENARIO[name], id });
      const NOT_FOUND = (id: string) =>
        json({ error: `Scenario ${id} not found` });

      it.each(['limited', 'open'] as const)(
        'an Admin (%s lists) is told the same, and nothing is read or written',
        async (who) => {
          const said = await call(name, args(SCENARIO_OF(RANCH)), as(who));

          expect(JSON.parse(said)).toEqual(EVALUATIONS_ONLY);
          expect(said).not.toContain(SECRET);
          nothingOfThePaddockWasTouched();
        },
      );

      it('a scenario of an agent out of reach and an id that names nothing are not found', async () => {
        expect(await asLimited(name, args(SCENARIO_OF(B)))).toBe(
          NOT_FOUND(SCENARIO_OF(B)),
        );
        expect(await asLimited(name, args(NO_RECORD))).toBe(
          NOT_FOUND(NO_RECORD),
        );
        nothingOfThePaddockWasTouched();
      });

      it('the Owner is answered, and so is an Admin for a scenario of a template', async () => {
        expect(await asOwner(name, args(SCENARIO_OF(RANCH)))).not.toMatch(
          /owner_only|not found/,
        );
        expect(await asOpen(name, args('scenario-of-template'))).not.toMatch(
          /owner_only|not found/,
        );
      });

      it('an Admin the assistant is switched off for: not found', async () => {
        switchAssistantOff(ADMIN2);
        expect(
          await call(
            name,
            args(SCENARIO_OF(RANCH)),
            undefined,
            consoleOf(ADMIN2),
          ),
        ).toBe(NOT_FOUND(SCENARIO_OF(RANCH)));
      });
    },
  );

  it('the two lists leave the assistant’s out and say so', async () => {
    const evals = await parsed(asOpen('list_paddock_evaluations'));
    expect(
      (evals.evaluations as { agentId: string }[]).map((e) => e.agentId),
    ).toEqual([A, B]);
    expect(evals[OWNER_ONLY_LEFT_OUT_FIELD]).toBe(LEFT_OUT('evaluations'));
    expect(json(evals)).not.toContain(SECRET);

    const listed = await parsed(asOpen('list_paddock_scenarios'));
    expect(
      (listed.scenarios as { agentId: string | null }[]).map((s) => s.agentId),
    ).toEqual([A, B, null]);
    expect(listed[OWNER_ONLY_LEFT_OUT_FIELD]).toBe(LEFT_OUT('scenarios'));
    expect(json(listed)).not.toContain(SECRET);
  });

  it('a list of one named agent left nothing out', async () => {
    for (const name of ['list_paddock_evaluations', 'list_paddock_scenarios']) {
      expect(await parsed(asOpen(name, { agentId: A }))).not.toHaveProperty(
        OWNER_ONLY_LEFT_OUT_FIELD,
      );
    }
  });

  it('an Admin the assistant is switched off for: no row, and its existence is not announced', async () => {
    switchAssistantOff(ADMIN2);
    for (const name of ['list_paddock_evaluations', 'list_paddock_scenarios']) {
      const said = await call(name, {}, undefined, consoleOf(ADMIN2));

      expect(JSON.parse(said)).not.toHaveProperty(OWNER_ONLY_LEFT_OUT_FIELD);
      expect(said).not.toMatch(/Owner|assistant|Rancher/);
      expect(said).not.toContain(SECRET);
    }
  });
});

describe('the usage of the assistant is the Owner’s', () => {
  it('agent_usage: an Admin is told so, and nothing is read', async () => {
    for (const who of ['limited', 'open'] as const) {
      const said = await call('agent_usage', { agentId: RANCH }, as(who));
      expect(JSON.parse(said)).toEqual(RECORDS);
    }
    expect(usage.findRecentForAgent).not.toHaveBeenCalled();
  });

  it('agent_usage: an agent out of reach and an unknown id are not found; a reached one is answered', async () => {
    expect(await asLimited('agent_usage', { agentId: B })).toBe(
      AGENT_NOT_FOUND(B),
    );
    expect(await asLimited('agent_usage', { agentId: GHOST })).toBe(
      AGENT_NOT_FOUND(GHOST),
    );
    expect(await asLimited('agent_usage', { agentId: A })).toContain(
      `usage-of-${A}`,
    );
  });

  it('agent_usage: the Owner and the assistant for itself read it', async () => {
    for (const said of [
      await asOwner('agent_usage', { agentId: RANCH }),
      await forItself('agent_usage', { agentId: RANCH }),
    ]) {
      expect(said).toContain(`usage-of-${RANCH}`);
    }
  });

  it('agent_usage: an Admin the assistant is switched off for is told nothing about it', async () => {
    switchAssistantOff(ADMIN2);
    expect(
      await call(
        'agent_usage',
        { agentId: RANCH },
        undefined,
        consoleOf(ADMIN2),
      ),
    ).toBe(AGENT_NOT_FOUND(RANCH));
  });

  describe.each([
    ['get_usage_overview', {}],
    ['llm_usage', { id: 'llm-1' }],
  ] as const)('%s', (name, args) => {
    interface ITotals {
      totals: { callCount: number };
      byAgent: { agentId: string }[];
      notIncluded?: string;
    }
    const totalsOf = async (said: Promise<string>) =>
      JSON.parse(await said) as ITotals;

    it('an Admin: the assistant is in no row and no total, and the result says so', async () => {
      const mine = await totalsOf(asOpen(name, args));

      expect(mine.byAgent.map((row) => row.agentId).sort()).toEqual([A, B]);
      expect(mine.totals.callCount).toBe(10);
      expect(mine.notIncluded).toBe(LEFT_OUT('usage figures'));
    });

    it('a limited Admin: their agents only, and both fields', async () => {
      const mine = await parsed(asLimited(name, args));

      expect(
        (mine.byAgent as { agentId: string }[]).map((row) => row.agentId),
      ).toEqual([A]);
      expect((mine.totals as { callCount: number }).callCount).toBe(5);
      expect(mine[OWNER_ONLY_LEFT_OUT_FIELD]).toBe(LEFT_OUT('usage figures'));
      expect(mine[ACCESS_SCOPE_FIELD]).toBe(ACCESS_SCOPE_TEXT);
    });

    it('the Owner: every agent, the assistant in the totals, and no field', async () => {
      const whole = await totalsOf(asOwner(name, args));

      expect(whole.byAgent.map((row) => row.agentId).sort()).toEqual(
        [...IDS].sort(),
      );
      expect(whole.totals.callCount).toBe(15);
      expect(whole).not.toHaveProperty('notIncluded');
    });

    it('an Admin the assistant is switched off for: not there, and not mentioned', async () => {
      switchAssistantOff(ADMIN2);
      const said = await call(name, args, undefined, consoleOf(ADMIN2));

      expect(JSON.parse(said)).not.toHaveProperty('notIncluded');
      expect(said).not.toContain(RANCH);
      expect(said).not.toMatch(/Owner|assistant|Rancher/);
    });
  });
});

describe('the request limits of the assistant are the Owner’s', () => {
  interface ILimits {
    total: number;
    agents: { agentId: string }[];
    notIncluded?: string;
  }

  it('list_agent_limits: an Admin gets no line for it, and is told so', async () => {
    const mine = JSON.parse(await asOpen('list_agent_limits')) as ILimits;

    expect(mine.agents.map((row) => row.agentId)).toEqual([A, B]);
    expect(mine.total).toBe(2);
    expect(mine.notIncluded).toBe(LEFT_OUT('request limits'));
  });

  it('list_agent_limits: the Owner gets its line, and no field', async () => {
    const whole = JSON.parse(await asOwner('list_agent_limits')) as ILimits;

    expect(whole.agents.map((row) => row.agentId)).toEqual(IDS);
    expect(whole).not.toHaveProperty('notIncluded');
  });
});

describe('what stays open about the assistant', () => {
  it('its events and incidents: whether it was up is not a conversation and not the Owner’s configuration', async () => {
    const incidents = await asOpen('list_agent_incidents', { agentId: RANCH });
    const eventsOf = await asLimited('list_agent_events', { agentId: RANCH });

    expect(incidents).toContain(`incident-of-${RANCH}`);
    expect(eventsOf).toContain(`event-of-${RANCH}`);
    for (const said of [incidents, eventsOf]) {
      expect(said).not.toMatch(/owner_only|not found/);
    }
  });

  it('its row among the agents that use a skill: no more than list_agents shows', async () => {
    const said = await asOpen('list_skill_agents', { skillId: 'skill-1' });
    expect(said).toContain(RANCH);
  });
});

// ── Part three: what is done TO the assistant is managing it ──
//
// Some tools change something about an agent and are open for every agent
// the caller reaches, because for an ordinary agent that is all it takes:
// its public link, an agent-wide connection to a tool server. For the
// assistant each of them is managing it, and only the Owner manages it.

const MANAGED = OWNER_ONLY('restart, stop or change it');

describe('the public link of the assistant is the Owner’s to read and to change', () => {
  const SHARE_TOOLS: Record<string, object> = {
    get_share_link: {},
    create_share_link: {},
    regenerate_share_link: { confirm: true },
    revoke_share_link: { confirm: true },
  };
  const VISITOR = 'visitor-1';

  it('walks every tool of the class', () => {
    expect(
      registered
        .filter((t) => t.providerClass === ShareLinkTool)
        .map((t) => t.metadata.name)
        .sort(),
    ).toEqual(Object.keys(SHARE_TOOLS).sort());
  });

  describe.each(Object.keys(SHARE_TOOLS))('%s', (name) => {
    const args = (agentId: string) => ({ ...SHARE_TOOLS[name], agentId });

    it.each(['limited', 'open'] as const)(
      'an Admin (%s lists) is told that only the Owner can, and the link is neither read nor touched',
      async (who) => {
        const said = await call(name, args(RANCH), as(who));

        expect(JSON.parse(said)).toEqual(MANAGED);
        expect(said).not.toMatch(/not found|list_agents|again|later|retry/i);
        for (const spy of [
          ...Object.values(linkReads),
          ...Object.values(linkWrites),
        ]) {
          expect(spy).not.toHaveBeenCalled();
        }
      },
    );

    it('with their own console token, the same', async () => {
      const said = await call(name, args(RANCH), undefined, consoleOf(ADMIN));
      expect(JSON.parse(said)).toEqual(MANAGED);
    });

    it('an agent out of reach and an id that names nothing are not found, in the words they had', async () => {
      expect(await asLimited(name, args(B))).toBe(AGENT_NOT_FOUND(B));
      expect(await asLimited(name, args(GHOST))).toBe(AGENT_NOT_FOUND(GHOST));
      for (const spy of Object.values(linkWrites)) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it('an agent they reach is theirs to share, as before', async () => {
      await asLimited('create_share_link', { agentId: A });
      const said = await asLimited(name, args(A));

      expect(said).not.toMatch(/owner_only|not found/);
    });

    it('the Owner, and the assistant for itself, are answered', async () => {
      for (const ask of [asOwner, forItself]) {
        const said = await ask(name, args(RANCH));
        expect(said).not.toMatch(/owner_only|not found/);
      }
    });

    it('an Admin the assistant is switched off for: not found, and nothing about it', async () => {
      switchAssistantOff(ADMIN2);
      const said = await call(name, args(RANCH), undefined, consoleOf(ADMIN2));

      expect(said).toBe(AGENT_NOT_FOUND(RANCH));
    });

    it('says in its description that the assistant is the Owner’s', () => {
      expect(descriptionOf(name)).toContain('managedBy: "owner"');
    });
  });

  it('a link the Owner made keeps working for its visitors, whatever an Admin was refused', async () => {
    const made = (await parsed(
      asOwner('create_share_link', { agentId: RANCH }),
    )) as { active: boolean };
    expect(made.active).toBe(true);
    const token = linkRows.get(RANCH)!.token;

    // The visitor's side asks the token and nobody's account.
    expect(await shareLinks.authorizeChat(token, RANCH, VISITOR)).toBe(
      `share-${VISITOR}`,
    );
    expect(await shareLinks.resolveForVisitor(token)).toMatchObject({
      agentId: RANCH,
      agentName: 'Rancher',
    });

    // An Admin tries all four; the row is as the Owner left it.
    for (const name of Object.keys(SHARE_TOOLS)) {
      const said = await asOpen(name, { ...SHARE_TOOLS[name], agentId: RANCH });
      expect(JSON.parse(said)).toEqual(MANAGED);
      expect(said).not.toContain(token);
    }
    expect(linkRows.get(RANCH)).toMatchObject({ token, revokedAt: null });
    expect(await shareLinks.authorizeChat(token, RANCH, VISITOR)).toBe(
      `share-${VISITOR}`,
    );

    // And stops when the Owner says so.
    await asOwner('revoke_share_link', { agentId: RANCH, confirm: true });
    await expect(
      shareLinks.authorizeChat(token, RANCH, VISITOR),
    ).rejects.toThrow();
  });
});

describe('a tool server is connected for the assistant by the Owner alone', () => {
  const SERVER = { serverId: 'srv-1' };

  it.each(['limited', 'open'] as const)(
    'start_mcp_oauth: an Admin (%s lists) is refused the connection everybody who talks to it would share',
    async (who) => {
      // Named, and not named: through the assistant the calling agent is it.
      for (const args of [{ ...SERVER, agentId: RANCH }, SERVER]) {
        expect(await parsed(call('start_mcp_oauth', args, as(who)))).toEqual(
          MANAGED,
        );
      }
      expect(oauth.start).not.toHaveBeenCalled();
    },
  );

  it('their own account on that server is theirs to connect: it changes nothing about the assistant', async () => {
    const said = await asOpen('start_mcp_oauth', {
      ...SERVER,
      subject: ADMIN2.id,
    });

    expect(said).not.toMatch(/owner_only|not found/);
    expect(oauth.start).toHaveBeenCalledWith({
      serverId: 'srv-1',
      agentId: RANCH,
      subject: ADMIN2.id,
    });
  });

  it('an agent they reach is theirs to connect; one out of reach is not found', async () => {
    expect(
      await asLimited('start_mcp_oauth', { ...SERVER, agentId: A }),
    ).toContain(`https://provider.test/${A}`);
    expect(await asLimited('start_mcp_oauth', { ...SERVER, agentId: B })).toBe(
      AGENT_NOT_FOUND(B),
    );
    expect(
      await asLimited('start_mcp_oauth', {
        ...SERVER,
        agentId: B,
        subject: ADMIN.id,
      }),
    ).toBe(AGENT_NOT_FOUND(B));
  });

  it('the Owner, and the assistant for itself, connect it', async () => {
    for (const ask of [asOwner, forItself]) {
      expect(await ask('start_mcp_oauth', SERVER)).toContain(
        `https://provider.test/${RANCH}`,
      );
    }
  });

  it('an Admin the assistant is switched off for: not found', async () => {
    switchAssistantOff(ADMIN2);
    expect(
      await call(
        'start_mcp_oauth',
        { ...SERVER, agentId: RANCH },
        undefined,
        consoleOf(ADMIN2),
      ),
    ).toBe(AGENT_NOT_FOUND(RANCH));
  });
});

// ── Which writing tools stand outside the manage rule: read off the source ──

/**
 * The writing tools that name an agent, or ask the reach, and do not go
 * through `AgentPermissionService` (`manageable`, `canManage`): the ones
 * the manage rule does not keep away from the assistant. Read the same way
 * as `reachTools`.
 */
function writesOutsideTheManageRule(source: string): string[] {
  const members: string[] = [];
  let current: string[] = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    current.push(line);
    if (line === '  }') {
      members.push(current.join('\n'));
      current = [];
    }
  }
  const nameOf = (member: string) =>
    [
      ...member.matchAll(
        /^ {2}(?:private |protected |public )?(?:async )?(\w+)\(/gm,
      ),
    ].pop()?.[1] ?? null;
  const calling = (patterns: string[]) => {
    const found = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const member of members) {
        const name = nameOf(member);
        if (!name || found.has(name)) continue;
        if (
          patterns.some((pattern) => member.includes(pattern)) ||
          [...found].some((helper) => member.includes(`this.${helper}(`))
        ) {
          found.add(name);
          grew = true;
        }
      }
    }
    return found;
  };
  const managing = calling(['manageable(', 'canManage(']);
  const reaching = calling(['reachableIds(', '.reaches(']);
  return members
    .filter((member) => member.includes('  @Tool({'))
    .filter((member) => /effect: 'write'/.test(member))
    .filter((member) => {
      const method = nameOf(member) ?? '';
      const namesAnAgent = /\b(agentId|peerAgentId)\b/.test(member);
      return !managing.has(method) && (reaching.has(method) || namesAnAgent);
    })
    .map((member) => {
      const name = /@Tool\(\{\s*name: (?:'([a-z_]+)'|(\w+))/.exec(member);
      return name?.[1] ?? NAMED_TOOLS[name?.[2] ?? ''] ?? name?.[2] ?? '?';
    });
}

/**
 * Each of them, with what keeps it from being a way to manage the
 * assistant: either the tool refuses the assistant to anybody but the Owner
 * (and a suite above holds it to that), or what it does is the person's
 * own and changes nothing about the agent.
 */
const OUTSIDE_THE_MANAGE_RULE: Record<string, string> = {
  // Done TO the agent: Owner only for the assistant.
  create_share_link: 'owner only for the assistant: `forChanges`',
  regenerate_share_link: 'owner only for the assistant: `forChanges`',
  revoke_share_link: 'owner only for the assistant: `forChanges`',
  start_mcp_oauth:
    'owner only for the assistant when agent-wide: `forChanges`; a person’s own account (`subject`) is theirs',
  run_paddock_evaluation: 'owner only for the assistant: `forRecords`',
  abort_paddock_evaluation: 'owner only for the assistant: `forRecords`',
  rerun_paddock_evaluation: 'owner only for the assistant: `forRecords`',
  create_paddock_scenario: 'owner only for the assistant: `forRecords`',
  update_paddock_scenario: 'owner only for the assistant: `forRecords`',
  delete_paddock_scenario: 'owner only for the assistant: `forRecords`',
  generate_paddock_scenarios: 'owner only for the assistant: `forRecords`',
  summarize_chat: 'owner only for the assistant: `supervised` (CLEAN-267)',
  sync_chats: 'owner only for the assistant: `supervised` (CLEAN-267)',
  connect_my_peer:
    'owner only for the assistant: `isOwnersAgentForSomebodyElse` (CLEAN-232)',
  connect_my_peer_from_card:
    'owner only for the assistant: `isOwnersAgentForSomebodyElse` (CLEAN-232)',
  import_my_peer_by_address:
    'owner only for the assistant: `isOwnersAgentForSomebodyElse` (CLEAN-232)',
  remove_my_peer:
    'owner only for the assistant: `isOwnersAgentForSomebodyElse` (CLEAN-232)',
  // The person's own, or not about one agent.
  pin_agent: 'the person’s own pin: nothing about the agent changes',
  ask_agent:
    'the calling agent asks a colleague: a question, checked per connection by `PeerAccessService`',
  delete_llm:
    'deletes a credential, not an agent: the reach only decides which agents its sentence names',
};

describe('writing tools that name an agent and stand outside the manage rule', () => {
  const found = toolFiles(SLICES)
    .flatMap((file) => writesOutsideTheManageRule(readFileSync(file, 'utf8')))
    .sort();

  it('each is filed: Owner only for the assistant, or the person’s own', () => {
    // A new one fails here. Before filing it, decide which it is: something
    // done TO the agent refuses the assistant to anybody but the Owner
    // (`manageable`, or `reach.forChanges()` and the kind `change`).
    expect(found).toEqual(Object.keys(OUTSIDE_THE_MANAGE_RULE).sort());
  });

  it('the reading finds a tool of each kind, and leaves the managed ones out', () => {
    expect(found).toEqual(
      expect.arrayContaining(['pin_agent', 'create_share_link']),
    );
    for (const managed of ['restart_agent', 'set_agent_secret']) {
      expect(found).not.toContain(managed);
    }
  });
});
