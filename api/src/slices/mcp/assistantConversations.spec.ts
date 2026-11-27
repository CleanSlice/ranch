/**
 * The conversations of the Ranch assistant are the Owner's alone to read,
 * and a person who has the assistant is told so (CLEAN-267).
 *
 * On 2026-11-27 an Admin asked the assistant for "Rancher's conversations".
 * `list_chats` with the assistant's own id said "not found, call
 * list_agents", so the model went looking another way: it searched by the
 * participant id `admin`, found the chat another agent had with that
 * participant, and presented its messages as the chat with Rancher. Then it
 * corrected itself and said the assistant had no conversations at all. Both
 * were wrong. Nothing was read that should not have been; the refusal named
 * the wrong reason and the model filled the gap.
 *
 * So, for a person who reaches the assistant and is not the Owner:
 *
 *  - every chat tool asked about the assistant, by its agent id or by the
 *    id of one of its chats, answers one sentence with `reason:
 *    "owner_only"`, and nothing of a conversation;
 *  - a list or a sync over every agent says the assistant's conversations
 *    were left out, so "there are none" cannot be concluded;
 *  - every row names its agent, so a chat is not taken for another agent's.
 *
 * Everything else is as it was: an agent out of reach and an id that names
 * nothing are not found, in the words they had; the Owner reads everything;
 * and a person the assistant is switched off for is told nothing about it.
 *
 * Nothing about the rule is stubbed. The MCP handler, the catalogue with the
 * assistant's policy on it, the setting service, the access lists and
 * `AgentPermissionService` are the real ones, and `ChatTool` is the real
 * class over an index and transcripts held in memory.
 */
import 'reflect-metadata';
import type { ModuleRef } from '@nestjs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request } from 'express';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { ChatTool } from '#/chat/chat.tool';
import type { IChatSessionData, IChatTopicData } from '#/chat/domain';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  USER,
  accessHarness,
  usersGateway,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
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
import { ACCESS_SCOPE_NOTE, ACCESS_SCOPE_TEXT } from './tooling';

// ── The ranch ────────────────────────────────────────────────
//
// Two agents and the assistant. ADMIN is limited to `alpha` and has the
// assistant; ADMIN2 reaches both agents and has the assistant switched off.

const A = 'agent-aaa';
const B = 'agent-bbb';
const RANCH = 'agent-ranch';
const GHOST = 'agent-zzz';

const agent = (id: string, name: string, isAdmin = false): IAgentData =>
  ({ id, name, isAdmin, createdById: null }) as unknown as IAgentData;
const AGENTS = [
  agent(A, 'alpha'),
  agent(B, 'bravo'),
  agent(RANCH, 'Rancher', true),
];

const { service: access, gateway: lists } = accessHarness([A, B, RANCH]);
lists.seed(ADMIN.id, true, [{ agentId: A, list: 'allowed' }]);

const agents = {
  findAll: () => Promise.resolve(AGENTS),
  findAdmin: () => Promise.resolve(AGENTS[2]),
  findById: jest.fn((id: string) =>
    Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
  ),
  hasCreatedBy: () => Promise.resolve(false),
} as unknown as IAgentGateway & { findById: jest.Mock };
const permission = new AgentPermissionService(agents, access);

// ── The conversations ────────────────────────────────────────
//
// The Owner talked to all three, under the same participant id: the row an
// Admin's search for `admin` finds is `alpha`'s, and the one it must never
// be taken for is the assistant's.

const CHAT_OF_A = 'chat-aaa';
const CHAT_OF_B = 'chat-bbb';
const CHAT_OF_RANCH = 'chat-rrr';
const NO_CHAT = 'chat-zzz';
/** In every field of the assistant's chat that could carry what was said. */
const SECRET = 'OWNER-ONLY';

// The topics their summaries gave them (CLEAN-270). One subject the Owner
// raised with the assistant alone: its name is what was said there, too.
const TOPIC_SHARED = 'topic-billing';
const TOPIC_OF_B = 'topic-bravo';
const TOPIC_OF_RANCH = 'topic-owner';

const chat = (
  id: string,
  agentId: string,
  said: string,
  topicIds: string[],
): IChatSessionData =>
  ({
    id,
    agentId,
    channel: 'bridle',
    externalUserId: 'admin',
    sessionKey: 'bridle:admin',
    title: `${said} title`,
    preview: `${said} preview`,
    lastRole: 'user',
    lastMessageAt: new Date('2026-11-27T09:00:00.000Z'),
    messageCount: 15,
    userMessageCount: 7,
    summary: `${said} summary`,
    summaryAt: null,
    insights: null,
    outcome: null,
    question: null,
    topicIds,
    insightVersion: 2,
    archived: false,
    createdAt: new Date('2026-11-20T09:00:00.000Z'),
    updatedAt: new Date('2026-11-27T09:00:00.000Z'),
  }) as unknown as IChatSessionData;

const CHATS = [
  chat(CHAT_OF_A, A, 'alpha', [TOPIC_SHARED]),
  chat(CHAT_OF_B, B, 'bravo', [TOPIC_OF_B]),
  chat(CHAT_OF_RANCH, RANCH, SECRET, [TOPIC_SHARED, TOPIC_OF_RANCH]),
];

const topic = (id: string, key: string, label: string): IChatTopicData => ({
  id,
  key,
  labels: { en: label },
  mergedIntoId: null,
  createdAt: new Date('2026-11-20T09:00:00.000Z'),
});
const TOPICS = [
  topic(TOPIC_SHARED, 'billing', 'Billing'),
  topic(TOPIC_OF_B, 'bravo-things', 'bravo things'),
  topic(TOPIC_OF_RANCH, 'owner-plans', `${SECRET} plans`),
];

interface IScope {
  in?: string[];
  notIn?: string[];
}
const chats = {
  findById: jest.fn((id: string) =>
    Promise.resolve(CHATS.find((c) => c.id === id) ?? null),
  ),
  /** The index, filtered the way the Prisma gateway filters it. */
  list: jest.fn(
    (filter: { agentId?: string; search?: string; agentScope?: IScope }) => {
      const items = CHATS.filter(
        (c) =>
          (!filter.agentId || c.agentId === filter.agentId) &&
          (!filter.agentScope?.in ||
            filter.agentScope.in.includes(c.agentId)) &&
          !filter.agentScope?.notIn?.includes(c.agentId) &&
          (!filter.search ||
            [c.title, c.preview, c.externalUserId].some((field) =>
              String(field).includes(filter.search!),
            )),
      );
      return Promise.resolve({ items, total: items.length });
    },
  ),
};
const reader = {
  read: jest.fn((agentId: string) =>
    Promise.resolve([
      {
        id: 'evt-1',
        role: 'user',
        text: `${agentId === RANCH ? SECRET : agentId} turn`,
        ts: 1_700_000_000_000,
      },
    ]),
  ),
};
const sync = {
  /** Walks the agents the caller reads, as the service does. */
  syncAll: jest.fn(
    (agentId: string | undefined, reach: { has(id: string): boolean }) => {
      const walked = (agentId ? [agentId] : AGENTS.map((a) => a.id)).filter(
        (id) => reach.has(id),
      );
      return Promise.resolve({
        scannedAgents: walked.length,
        scannedFiles: walked.length,
        upserted: 0,
        skipped: walked.length,
      });
    },
  ),
};
const insight = {
  summarize: jest.fn((id: string) =>
    Promise.resolve(CHATS.find((c) => c.id === id)!),
  ),
  isEnabled: () => Promise.resolve(true),
};
const topics = {
  findByIds: jest.fn((ids: readonly string[]) =>
    Promise.resolve(
      new Map(TOPICS.filter((t) => ids.includes(t.id)).map((t) => [t.id, t])),
    ),
  ),
  findByKey: jest.fn((key: string) =>
    Promise.resolve(TOPICS.find((t) => t.key === key) ?? null),
  ),
  /** Counted over the conversations of the scope, as the gateway counts. */
  listWithCounts: jest.fn((scope?: IScope) =>
    Promise.resolve(
      TOPICS.map((t) => ({
        topic: t,
        conversations: CHATS.filter(
          (c) =>
            c.topicIds.includes(t.id) &&
            (!scope?.in || scope.in.includes(c.agentId)) &&
            !scope?.notIn?.includes(c.agentId),
        ).length,
        merged: [],
      })),
    ),
  ),
  merge: jest.fn(() => Promise.resolve()),
};

// ── The tools: the real class, read the way the registry reads it ──

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

const chatTool = new ChatTool(
  chats as never,
  reader as never,
  sync as never,
  insight as never,
  access,
  permission,
  agents,
  topics as never,
);
const proto = ChatTool.prototype as unknown as Record<string, unknown>;
for (const method of Object.getOwnPropertyNames(proto)) {
  if (method === 'constructor') continue;
  const ref = Object.getOwnPropertyDescriptor(proto, method)?.value as unknown;
  if (typeof ref !== 'function') continue;
  const metadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as
    | ToolMetadata
    | undefined;
  if (!metadata) continue;
  registered.push({
    type: 'tool',
    metadata,
    providerClass: ChatTool,
    methodName: method,
    audience: toolAudienceOf(ChatTool, ref),
  });
}
const CHAT_TOOLS = registered.map((t) => t.metadata.name).sort();

/** The parameters a tool declares: what tells how it names a conversation. */
const takes = (name: string, parameter: string) => {
  const shape = (
    registered.find((t) => t.metadata.name === name)!.metadata
      .parameters as unknown as { shape: Record<string, unknown> }
  ).shape;
  return Object.prototype.hasOwnProperty.call(shape, parameter);
};
const BY_AGENT = CHAT_TOOLS.filter((name) => takes(name, 'agentId'));
const BY_CHAT = CHAT_TOOLS.filter((name) => takes(name, 'id'));
/**
 * The two that name no conversation (CLEAN-270): they read the topics the
 * summaries coined, and count the conversations under each. What they
 * answer about the assistant's is walked in a describe of its own, below.
 */
const BY_TOPIC = ['list_chat_topics', 'merge_chat_topics'];

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
  user: { kind: 'person', userId: USER.id, role: UserRoleTypes.User },
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
  resolve: (token: unknown) =>
    token === ChatTool
      ? Promise.resolve(chatTool)
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

/** An Admin who has the assistant, asking through it. */
const asAdmin = (name: string, args: object) =>
  session().call(name, args, as('admin'));
/** The Owner, asking through it. */
const asOwner = (name: string, args: object) =>
  session().call(name, args, as('owner'));
/** An Admin the assistant is switched off for: their own token is the only way in. */
const withoutAssistant = (name: string, args: object) =>
  session(consoleOf(ADMIN2)).call(name, args);

/** The whole answer: one sentence, a reason for the model, nothing to try. */
const OWNER_ONLY = {
  error:
    'Rancher is the Ranch assistant. Only the Owner can read its conversations.',
  reason: 'owner_only',
};
const LEFT_OUT =
  'The conversations of Rancher, the Ranch assistant, are not included: ' +
  'only the Owner can read them. That is an access limit, not an empty list.';
const json = (value: unknown) => JSON.stringify(value, null, 2);
const AGENT_NOT_FOUND = (id: string) =>
  json({ error: `Agent ${id} not found — call list_agents to find the id` });
const CHAT_NOT_FOUND = (id: string) =>
  json({ error: `Chat ${id} not found — call list_chats to find the id` });

interface IRow {
  id: string;
  agentId: string;
  agentName: string | null;
}
interface IListed {
  items: IRow[];
  total: number;
  notIncluded?: string;
}

beforeEach(() => {
  assistantSettings.clear();
  assistantSettings.set(ADMIN2.id, {
    enabled: false,
    level: 'full',
    custom: null,
    updatedById: OWNER.id,
    updatedAt: new Date('2026-11-27T10:00:00.000Z'),
  });
  for (const mock of [
    agents.findById,
    chats.findById,
    chats.list,
    reader.read,
    sync.syncAll,
    insight.summarize,
    topics.findByIds,
    topics.findByKey,
    topics.listWithCounts,
    topics.merge,
  ]) {
    mock.mockClear();
  }
});

it('loads every chat tool, and each of them names a conversation by an agent or by a chat', () => {
  expect(CHAT_TOOLS).toEqual(
    [
      'export_chat',
      'get_chat',
      'get_chat_messages',
      'list_chat_topics',
      'list_chats',
      'merge_chat_topics',
      'summarize_chat',
      'sync_chats',
    ].sort(),
  );
  // A new chat tool takes one of the two, and is walked below by having it.
  // One that takes neither reads conversations some other way: say here
  // what it answers for the assistant's, before it ships.
  //
  // The topic tools take neither. A topic is a subject somebody raised, and
  // its count is a count of conversations, so for anybody but the Owner the
  // assistant's conversations are in no count, a subject raised only there
  // is a topic that does not exist, and the list says they were left out.
  for (const name of CHAT_TOOLS) {
    expect([name, takes(name, 'agentId') || takes(name, 'id')]).toEqual([
      name,
      !BY_TOPIC.includes(name),
    ]);
  }
  expect(registered.every((t) => t.audience === 'admin')).toBe(true);
});

describe('an Admin who has the assistant asks for its conversations', () => {
  describe.each(BY_AGENT)('%s, by the assistant’s agent id', (name) => {
    it('is told that only the Owner can read them, and nothing is read', async () => {
      const said = await asAdmin(name, { agentId: RANCH });

      expect(JSON.parse(said)).toEqual(OWNER_ONLY);
      expect(said).not.toMatch(
        /not found|list_agents|list_chats|again|later|retry|another/i,
      );
      expect(said).not.toContain(SECRET);
      expect(chats.list).not.toHaveBeenCalled();
      expect(sync.syncAll).not.toHaveBeenCalled();
    });

    it('with their own console token, the same', async () => {
      const said = await session(consoleOf(ADMIN)).call(name, {
        agentId: RANCH,
      });
      expect(JSON.parse(said)).toEqual(OWNER_ONLY);
    });

    it('an agent out of reach and an id that names nothing are not found, in the words they had', async () => {
      const hidden = await asAdmin(name, { agentId: B });
      const unknown = await asAdmin(name, { agentId: GHOST });

      expect(hidden).toBe(AGENT_NOT_FOUND(B));
      expect(unknown).toBe(AGENT_NOT_FOUND(GHOST));
      for (const said of [hidden, unknown]) {
        expect(said).not.toMatch(/Owner|assistant|owner_only|bravo/);
      }
      expect(chats.list).not.toHaveBeenCalled();
      expect(sync.syncAll).not.toHaveBeenCalled();
    });

    it('the Owner is answered', async () => {
      const said = await asOwner(name, { agentId: RANCH });
      expect(said).not.toMatch(/owner_only|not found/);
      expect(JSON.parse(said)).not.toHaveProperty('error');
    });
  });

  describe.each(BY_CHAT)('%s, by the id of one of its chats', (name) => {
    it('is told the same, and gets nothing of the conversation', async () => {
      const said = await asAdmin(name, { id: CHAT_OF_RANCH });

      expect(JSON.parse(said)).toEqual(OWNER_ONLY);
      expect(said).not.toContain(SECRET);
      expect(said).not.toContain(CHAT_OF_RANCH);
      expect(reader.read).not.toHaveBeenCalled();
      expect(insight.summarize).not.toHaveBeenCalled();
    });

    it('with their own console token, the same', async () => {
      const said = await session(consoleOf(ADMIN)).call(name, {
        id: CHAT_OF_RANCH,
      });
      expect(JSON.parse(said)).toEqual(OWNER_ONLY);
    });

    it('a chat of an agent out of reach and an id that names nothing are not found, in the words they had', async () => {
      const hidden = await asAdmin(name, { id: CHAT_OF_B });
      const unknown = await asAdmin(name, { id: NO_CHAT });

      expect(hidden).toBe(CHAT_NOT_FOUND(CHAT_OF_B));
      expect(unknown).toBe(CHAT_NOT_FOUND(NO_CHAT));
      for (const said of [hidden, unknown]) {
        expect(said).not.toMatch(/Owner|assistant|owner_only|bravo/);
      }
      expect(reader.read).not.toHaveBeenCalled();
      expect(insight.summarize).not.toHaveBeenCalled();
    });

    it('a chat of an agent they reach is theirs to read, and says whose it is', async () => {
      const shown = JSON.parse(await asAdmin(name, { id: CHAT_OF_A })) as {
        agentId: string;
        agentName: string;
      };
      expect(shown).toMatchObject({ agentId: A, agentName: 'alpha' });
    });

    it('the Owner reads the assistant’s as any other', async () => {
      const said = await asOwner(name, { id: CHAT_OF_RANCH });

      expect(said).not.toMatch(/owner_only|not found/);
      expect(JSON.parse(said)).toMatchObject({
        agentId: RANCH,
        agentName: 'Rancher',
      });
    });
  });

  it('the Owner and the assistant for itself read what was said to it', async () => {
    for (const actor of [as('owner'), TRUSTED]) {
      const { call } = session();
      expect(await call('get_chat', { id: CHAT_OF_RANCH }, actor)).toContain(
        `${SECRET} title`,
      );
      expect(
        await call('get_chat_messages', { id: CHAT_OF_RANCH }, actor),
      ).toContain(`${SECRET} turn`);
      expect(
        (
          JSON.parse(
            await call('list_chats', { agentId: RANCH }, actor),
          ) as IListed
        ).items.map((row) => row.id),
      ).toEqual([CHAT_OF_RANCH]);
    }
  });

  it('a User has none of these tools, whatever they name', async () => {
    const { list, call } = session();
    expect(await list(as('user'))).toEqual([]);
    for (const name of CHAT_TOOLS) {
      expect(
        await call(name, { agentId: RANCH, id: CHAT_OF_RANCH }, as('user')),
      ).toBe(`Tool "${name}" is not available to this caller.`);
    }
  });
});

describe('a person the assistant is switched off for is told nothing about it', () => {
  it.each(BY_AGENT)('%s: its agent id is not found', async (name) => {
    const said = await withoutAssistant(name, { agentId: RANCH });
    expect(said).toBe(AGENT_NOT_FOUND(RANCH));
    expect(said).not.toMatch(/Owner|assistant|owner_only|Rancher/);
  });

  it.each(BY_CHAT)('%s: a chat of it is not found', async (name) => {
    const said = await withoutAssistant(name, { id: CHAT_OF_RANCH });
    expect(said).toBe(CHAT_NOT_FOUND(CHAT_OF_RANCH));
    expect(said).not.toMatch(/Owner|assistant|owner_only|Rancher/);
  });
});

describe('a list over every agent says what it left out', () => {
  const listed = async (said: Promise<string>) =>
    JSON.parse(await said) as IListed;

  it('an Admin: no row of the assistant, and a field that says its conversations are the Owner’s', async () => {
    const result = await listed(asAdmin('list_chats', {}));

    expect(result.items.map((row) => row.id)).toEqual([CHAT_OF_A]);
    expect(result.total).toBe(1);
    expect(result.notIncluded).toBe(LEFT_OUT);
    expect(json(result)).not.toContain(SECRET);
  });

  it('the search that found another agent’s chat: the row says whose it is, and the list says what is missing', async () => {
    // What the assistant did on 2026-11-27, after "not found".
    const result = await listed(asAdmin('list_chats', { search: 'admin' }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: CHAT_OF_A,
      agentId: A,
      agentName: 'alpha',
    });
    expect(result.notIncluded).toBe(LEFT_OUT);
  });

  it('an empty page still says so: nothing matched is not "there are none"', async () => {
    const result = await listed(asAdmin('list_chats', { search: 'no such' }));

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.notIncluded).toBe(LEFT_OUT);
  });

  it('a list of one named agent left nothing out', async () => {
    const result = await listed(asAdmin('list_chats', { agentId: A }));

    expect(result.items.map((row) => row.id)).toEqual([CHAT_OF_A]);
    expect(result).not.toHaveProperty('notIncluded');
  });

  it('the Owner, and the assistant for itself: the rows are there and the field is not', async () => {
    for (const actor of [as('owner'), TRUSTED]) {
      const result = await listed(session().call('list_chats', {}, actor));

      expect(result.items.map((row) => row.id).sort()).toEqual(
        [CHAT_OF_A, CHAT_OF_B, CHAT_OF_RANCH].sort(),
      );
      expect(result).not.toHaveProperty('notIncluded');
    }
  });

  it('an Admin the assistant is switched off for: no row and no field, its existence is not announced', async () => {
    const said = await withoutAssistant('list_chats', {});
    const result = JSON.parse(said) as IListed;

    expect(result.items.map((row) => row.id).sort()).toEqual(
      [CHAT_OF_A, CHAT_OF_B].sort(),
    );
    expect(result).not.toHaveProperty('notIncluded');
    expect(said).not.toMatch(/Owner|assistant|Rancher/);
    expect(said).not.toContain(SECRET);
  });

  describe('sync_chats', () => {
    type Synced = { scannedAgents: number; notIncluded?: string };
    const synced = async (said: Promise<string>) =>
      JSON.parse(await said) as Synced;

    it('an Admin: the counts are of the agents they read, and the result says the assistant was left out', async () => {
      const result = await synced(asAdmin('sync_chats', {}));

      expect(result.scannedAgents).toBe(1);
      expect(result.notIncluded).toBe(LEFT_OUT);
      const reach = sync.syncAll.mock.calls[0][1] as {
        has(id: string): boolean;
      };
      expect([reach.has(A), reach.has(B), reach.has(RANCH)]).toEqual([
        true,
        false,
        false,
      ]);
    });

    it('of one named agent: nothing was left out', async () => {
      const result = await synced(asAdmin('sync_chats', { agentId: A }));

      expect(result.scannedAgents).toBe(1);
      expect(result).not.toHaveProperty('notIncluded');
    });

    it('the Owner: every agent, and no field', async () => {
      const result = await synced(asOwner('sync_chats', {}));

      expect(result.scannedAgents).toBe(3);
      expect(result).not.toHaveProperty('notIncluded');
    });

    it('an Admin the assistant is switched off for: no field', async () => {
      const result = await synced(withoutAssistant('sync_chats', {}));

      expect(result.scannedAgents).toBe(2);
      expect(result).not.toHaveProperty('notIncluded');
    });
  });
});

/**
 * CLEAN-270. The summaries sort conversations under topics, and two tools
 * read them: a list with a count of conversations per topic, and a merge.
 * Neither names an agent or a chat, so neither can be asked "about the
 * assistant"; what they must not do is count its conversations, or name a
 * subject that was raised only with it.
 */
describe('the topics of the summaries', () => {
  interface ITopics {
    topics: { key: string; conversations: number; labels: { en: string } }[];
    total: number;
    notIncluded?: string;
    scope?: string;
  }
  const listed = async (said: Promise<string>) =>
    JSON.parse(await said) as ITopics;
  const counts = (result: ITopics) =>
    Object.fromEntries(result.topics.map((t) => [t.key, t.conversations]));
  const TOPIC_NOT_FOUND = (key: string) =>
    json({
      error: `Topic ${key} not found — call list_chat_topics to find the key`,
    });

  it('an Admin: counted over the conversations they read, no subject of the assistant’s alone, and a field that says what was left out', async () => {
    const said = asAdmin('list_chat_topics', {});
    const result = await listed(said);

    // `billing` is carried by alpha's chat and by the assistant's: one.
    expect(counts(result)).toEqual({ billing: 1 });
    expect(result.total).toBe(1);
    expect(result.notIncluded).toBe(LEFT_OUT);
    expect(await said).not.toContain(SECRET);
    expect(await said).not.toContain('bravo');
    expect(topics.listWithCounts).toHaveBeenCalledWith({ in: [A] });
  });

  // CLEAN-268, as for `list_chats`: this Admin is limited to `alpha`, so the
  // counts are of one agent's conversations, and a list that does not say so
  // is read as what the whole installation talks about.
  it('an Admin limited to one agent: the list says it covers their agents only, beside what it left out', async () => {
    const result = await listed(asAdmin('list_chat_topics', {}));

    expect(result.scope).toBe(ACCESS_SCOPE_TEXT);
    expect(result.notIncluded).toBe(LEFT_OUT);
    // The sentence is the one constant: no topic, no agent and no count.
    expect(result.scope).not.toMatch(/\d|billing|bravo|alpha/i);
  });

  it('a list with no topic in it still says so: none among theirs is not "people talk about nothing"', async () => {
    topics.listWithCounts.mockResolvedValueOnce(
      TOPICS.map((t) => ({ topic: t, conversations: 0, merged: [] })),
    );
    const result = await listed(asAdmin('list_chat_topics', {}));

    expect(result.topics).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.scope).toBe(ACCESS_SCOPE_TEXT);
    expect(result.notIncluded).toBe(LEFT_OUT);
  });

  it('an Admin whose lists narrow nothing: told of the assistant’s conversations, and of no other limit', async () => {
    // ADMIN2 with the assistant, as an Admin has it by default.
    assistantSettings.delete(ADMIN2.id);
    const result = await listed(
      session(consoleOf(ADMIN2)).call('list_chat_topics', {}),
    );

    expect(counts(result)).toEqual({ billing: 1, 'bravo-things': 1 });
    expect(result.notIncluded).toBe(LEFT_OUT);
    expect(result).not.toHaveProperty('scope');
  });

  it('the Owner, and the assistant for itself: every topic, every conversation, and no field', async () => {
    for (const actor of [as('owner'), TRUSTED]) {
      const result = await listed(
        session().call('list_chat_topics', {}, actor),
      );

      expect(counts(result)).toEqual({
        billing: 2,
        'bravo-things': 1,
        'owner-plans': 1,
      });
      expect(result).not.toHaveProperty('notIncluded');
      expect(result).not.toHaveProperty('scope');
    }
  });

  it('an Admin the assistant is switched off for: their agents’ topics, and its existence is not announced', async () => {
    const said = await withoutAssistant('list_chat_topics', {});
    const result = JSON.parse(said) as ITopics;

    expect(counts(result)).toEqual({ billing: 1, 'bravo-things': 1 });
    expect(result).not.toHaveProperty('notIncluded');
    // The assistant is out of this person's reach, which narrows it: the
    // list says that it is a part, and not whose the rest is.
    expect(result.scope).toBe(ACCESS_SCOPE_TEXT);
    expect(said).not.toMatch(/Owner|assistant|Rancher/);
    expect(said).not.toContain(SECRET);
  });

  it('list_chat_topics says in its description what each of the two fields means', () => {
    const description = registered.find(
      (t) => t.metadata.name === 'list_chat_topics',
    )!.metadata.description;

    expect(description).toContain('notIncluded');
    expect(description).toContain(ACCESS_SCOPE_NOTE);
  });

  it('a merge names two topics and lists nothing: its answers carry no such field', async () => {
    const refused = await asAdmin('merge_chat_topics', {
      from: 'bravo-things',
      into: 'billing',
      confirm: true,
    });
    const asked = await asAdmin('merge_chat_topics', {
      from: 'billing',
      into: 'billing',
    });

    for (const said of [refused, asked]) {
      expect(said).not.toContain(ACCESS_SCOPE_TEXT);
      expect(said).not.toContain('"scope"');
    }
  });

  it('an Admin cannot merge a subject raised only with the assistant: it is a topic that does not exist', async () => {
    const hidden = await asAdmin('merge_chat_topics', {
      from: 'owner-plans',
      into: 'billing',
      confirm: true,
    });
    const unknown = await asAdmin('merge_chat_topics', {
      from: 'no-such',
      into: 'billing',
      confirm: true,
    });

    expect(hidden).toBe(TOPIC_NOT_FOUND('owner-plans'));
    expect(unknown).toBe(TOPIC_NOT_FOUND('no-such'));
    expect(hidden).not.toMatch(/Owner|assistant|owner_only/);
    expect(hidden).not.toContain(SECRET);
    // Nor as the topic that stays, nor one of an agent out of reach.
    expect(
      await asAdmin('merge_chat_topics', {
        from: 'billing',
        into: 'owner-plans',
        confirm: true,
      }),
    ).toBe(TOPIC_NOT_FOUND('owner-plans'));
    expect(
      await asAdmin('merge_chat_topics', {
        from: 'bravo-things',
        into: 'billing',
        confirm: true,
      }),
    ).toBe(TOPIC_NOT_FOUND('bravo-things'));
    expect(topics.merge).not.toHaveBeenCalled();
  });

  it('the Owner merges it, once confirmed', async () => {
    const asked = await asOwner('merge_chat_topics', {
      from: 'owner-plans',
      into: 'billing',
    });
    expect(asked).toContain('confirm: true');
    expect(topics.merge).not.toHaveBeenCalled();

    await asOwner('merge_chat_topics', {
      from: 'owner-plans',
      into: 'billing',
      confirm: true,
    });
    expect(topics.merge).toHaveBeenCalledWith(TOPIC_OF_RANCH, TOPIC_SHARED);
  });

  it('a chat row names its topics, and an Admin’s rows carry none of the assistant’s', async () => {
    const said = await asAdmin('list_chats', {});
    const rows = (JSON.parse(said) as { items: { topics: string[] }[] }).items;

    expect(rows.map((row) => row.topics)).toEqual([['Billing']]);
    // Asked for the topics of the rows it shows, and no other.
    expect(topics.findByIds).toHaveBeenCalledWith([TOPIC_SHARED]);
  });
});

describe('a chat row names its agent', () => {
  it('every row carries the name beside the id', async () => {
    const result = JSON.parse(await asOwner('list_chats', {})) as IListed;

    expect(
      Object.fromEntries(result.items.map((row) => [row.id, row.agentName])),
    ).toEqual({
      [CHAT_OF_A]: 'alpha',
      [CHAT_OF_B]: 'bravo',
      [CHAT_OF_RANCH]: 'Rancher',
    });
  });

  it('never the name of an agent the caller does not reach: it is not even read', async () => {
    const said = await asAdmin('list_chats', {});

    expect(said).not.toContain('bravo');
    expect(agents.findById.mock.calls.map(([id]) => id as string)).toEqual([A]);
  });

  it('the names of a page are read once per agent, not once per row', async () => {
    chats.list.mockResolvedValueOnce({
      items: [CHATS[0], { ...CHATS[0], id: 'chat-2' }, CHATS[0]],
      total: 3,
    });
    const result = JSON.parse(await asAdmin('list_chats', {})) as IListed;

    expect(result.items.map((row) => row.agentName)).toEqual([
      'alpha',
      'alpha',
      'alpha',
    ]);
    expect(agents.findById).toHaveBeenCalledTimes(1);
  });

  it('an agent that no longer exists has no name, and the row is still listed', async () => {
    chats.list.mockResolvedValueOnce({
      items: [{ ...CHATS[0], agentId: GHOST }],
      total: 1,
    });
    const result = JSON.parse(await asOwner('list_chats', {})) as IListed;

    expect(result.items[0]).toMatchObject({ agentId: GHOST, agentName: null });
  });

  it('list_chats says in its description what a search matches and where a row says whose it is', () => {
    const description = registered.find(
      (t) => t.metadata.name === 'list_chats',
    )!.metadata.description;

    expect(description).toMatch(/match across every agent/);
    expect(description).toContain('agentName');
    expect(description).toContain('notIncluded');
  });
});
