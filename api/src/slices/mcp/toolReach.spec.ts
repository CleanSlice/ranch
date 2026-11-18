/**
 * When the assistant acts for a person, it lists, describes and acts on
 * only the agents that person reaches (CLEAN-231, FR-027).
 *
 * Every tool that lists agents or takes an agent id is run here as a
 * limited Admin: three agents exist, the Admin is allowed two of them.
 *
 *  - A tool that names the hidden agent answers "not found", in the very
 *    words it gives an id that names nothing, and without the agent's name.
 *  - It answers before touching anything: every collaborator a tool would
 *    need to act on the agent is a stand-in that fails the spec when used.
 *  - A tool that lists leaves the hidden agent out.
 *
 * The rule itself is `AgentAccessService`, real here, behind the real
 * `AgentPermissionService`; nothing about reach is stubbed.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { AgentAdminTool } from '#/agent/agent/agentAdmin.tool';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { AgentChannelTool } from '#/agent/agentChannel/agentChannel.tool';
import { AgentEventTool } from '#/agent/event/agentEvent.tool';
import { FileTool } from '#/agent/file/file.tool';
import { AgentLimitTool } from '#/agent/limit/agentLimit.tool';
import { PeerAdminTool } from '#/agent/peer/peerAdmin.tool';
import { SecretTool } from '#/agent/secret/secret.tool';
import { ShareLinkTool } from '#/agent/shareLink/shareLink.tool';
import { ChatTool } from '#/chat/chat.tool';
import { LlmTool } from '#/llm/llm.tool';
import { LogTool } from '#/log/log.tool';
import { McpOauthTool } from '#/mcpServer/oauth/mcpOauth.tool';
import { PaddockEvaluationTool } from '#/paddock/evaluation/evaluation.tool';
import { PaddockScenarioTool } from '#/paddock/scenario/scenario.tool';
import { RancherTool } from '#/rancher/rancher.tool';
import { UsageTool } from '#/usage/usage.tool';
import { IUsageGateway } from '#/usage/domain';
import { IAgentGateway as AgentGatewayToken } from '#/agent/agent/domain';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  ADMIN,
  OWNER,
  accessHarness,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { UserRoleTypes } from '#/user/user/domain';
import { asPerson } from './testing';
import type { ToolResult } from './tooling';

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

// ── The ranch: three agents, the Admin is allowed two ─────────

const A = 'agent-aaa';
const B = 'agent-bbb';
const HIDDEN = 'agent-ccc';
const GHOST = 'agent-zzz';
const HIDDEN_NAME = 'charlie-hidden';

const agent = (id: string, name: string): IAgentData =>
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
    isAdmin: false,
    allowedOrigins: [],
    knowledgeIds: [],
    debugEnabled: false,
    pinned: false,
    createdById: null,
  }) as unknown as IAgentData;

const AGENTS = [
  agent(A, 'alpha'),
  agent(B, 'bravo'),
  agent(HIDDEN, HIDDEN_NAME),
];

const { service: access, gateway: lists } = accessHarness([A, B, HIDDEN]);
lists.seed(ADMIN.id, true, [
  { agentId: A, list: 'allowed' },
  { agentId: B, list: 'allowed' },
]);

/**
 * A collaborator no call in this spec may reach: any method on it fails the
 * test, naming what was touched. A tool that asks the lists first never
 * gets as far as its services for an agent the caller does not reach.
 */
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

/** A collaborator with a few real answers; anything else fails like `never`. */
function only<T>(name: string, methods: Record<string, unknown>): T {
  return new Proxy(methods, {
    get: (target, property) => {
      if (property === 'then') return undefined;
      if (property in target) return target[property as string];
      return () => {
        throw new Error(`${name}.${String(property)} was reached`);
      };
    },
  }) as T;
}

const agents = only<IAgentGateway>('agents', {
  findAll: () => Promise.resolve(AGENTS),
  findById: (id: string) =>
    Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
  hasCreatedBy: () => Promise.resolve(false),
});
const permission = new AgentPermissionService(agents, access);
const pins = only<never>('pins', {
  pinnedIds: () => Promise.resolve(new Set<string>()),
});

// Records that belong to an agent, addressed by their own id.
const CHAT_OF_HIDDEN = 'chat-of-ccc';
const EVAL_OF_HIDDEN = 'eval-of-ccc';
const SCENARIO_OF_HIDDEN = 'scenario-of-ccc';
const NOTHING = 'no-such-record';

const chats = only<never>('chats', {
  findById: (id: string) =>
    Promise.resolve(
      id === CHAT_OF_HIDDEN
        ? { id, agentId: HIDDEN, sessionKey: 'bridle:admin', title: 'x' }
        : null,
    ),
  list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
});
const evaluation = (id: string, agentId: string) => ({ id, agentId });
/**
 * What the evaluation service does with an id: "not found" for one that
 * names nothing, and a failed spec for the hidden agent's evaluation, which
 * a tool must have refused before it got here.
 */
const unknownOnly = (method: string) => (id: string) => {
  if (id === EVAL_OF_HIDDEN) {
    throw new Error(`evaluations.${method} was reached for the hidden agent`);
  }
  return Promise.reject(new NotFoundException('Evaluation not found'));
};
const evaluations = only<never>('evaluations', {
  getReport: unknownOnly('getReport'),
  abort: unknownOnly('abort'),
  getLogs: unknownOnly('getLogs'),
  getScenario: unknownOnly('getScenario'),
  getTrace: unknownOnly('getTrace'),
  getById: (id: string) => {
    if (id === EVAL_OF_HIDDEN) {
      return Promise.resolve(evaluation(id, HIDDEN));
    }
    return Promise.reject(new NotFoundException('Evaluation not found'));
  },
  list: () =>
    Promise.resolve([
      evaluation('eval-a', A),
      evaluation('eval-b', B),
      evaluation(EVAL_OF_HIDDEN, HIDDEN),
    ]),
});
const scenario = (id: string, agentId: string | null) => ({
  id,
  agentId,
  templateId: agentId ? null : 'tpl-1',
  name: id,
});
const scenarios = only<never>('scenarios', {
  findById: (id: string) =>
    Promise.resolve(id === SCENARIO_OF_HIDDEN ? scenario(id, HIDDEN) : null),
  findAll: () =>
    Promise.resolve([
      scenario('scenario-a', A),
      scenario(SCENARIO_OF_HIDDEN, HIDDEN),
      scenario('scenario-of-template', null),
    ]),
});
const events = only<never>('events', {
  listEvents: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listIncidents: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
});
const usageRow = (agentId: string) => ({
  id: `u-${agentId}`,
  agentId,
  llmCredentialId: 'llm-1',
  model: 'm',
  date: new Date('2026-11-17T00:00:00Z'),
  inputTokens: 1000,
  outputTokens: 100,
  callCount: 5,
});
const usage = only<never>('usage', {
  findRecentAll: () => Promise.resolve([A, B, HIDDEN].map(usageRow)),
  findRecentForCredential: () => Promise.resolve([A, B, HIDDEN].map(usageRow)),
});

// ── The tools, each with what it needs to answer and nothing more ──

const rancher = new RancherTool(
  agents,
  never('agentDeploy'),
  never('templates'),
  never('templateFiles'),
  never('llms'),
  only('skills', {
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
  }),
  never('settings'),
  never('usage'),
  never('files'),
  never('rancher'),
  permission,
  access,
  pins,
);
const agentAdmin = new AgentAdminTool(
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
);
const channels = new AgentChannelTool(never('channels'), agents, permission);
const eventTool = new AgentEventTool(
  events,
  never('destinations'),
  agents,
  access,
);
const files = new FileTool(
  agents,
  never('files'),
  never('bridle'),
  never('syncGuard'),
  never('archive'),
  never('proposals'),
  never('attachments'),
  permission,
);
const limits = new AgentLimitTool(
  only('limits', {
    summary: (list: { id: string }[]) =>
      list.map((a) => ({
        agentId: a.id,
        enabled: false,
        atLimit: false,
        needsLimits: false,
      })),
    getLimits: () => null,
  }),
  agents,
  permission,
  access,
);
const peers = new PeerAdminTool(
  never('peers'),
  never('cards'),
  never('delegations'),
  permission,
);
const secrets = new SecretTool(agents, never('secrets'), permission);
const shareLinks = new ShareLinkTool(never('shareLinks'), agents, access);
const chatTool = new ChatTool(
  chats,
  never('reader'),
  never('sync'),
  never('insight'),
  access,
);
const logs = new LogTool(agents, never('logService'), permission);
const oauth = new McpOauthTool(never('oauth'), access);
const paddockEvaluations = new PaddockEvaluationTool(evaluations, access);
const paddockScenarios = new PaddockScenarioTool(
  scenarios,
  never('generator'),
  access,
);
const usageTool = new UsageTool(usage, agents, access);
const llmTool = new LlmTool(
  only('llms', {
    findById: () =>
      Promise.resolve({
        id: 'llm-1',
        provider: 'claude',
        model: 'm',
        label: 'l',
        status: 'active',
      }),
  }),
  never('health'),
  {
    get: (token: unknown) => {
      if (token === AgentAccessService) return access;
      if (token === IUsageGateway) return usage;
      if (token === AgentGatewayToken) return agents;
      throw new Error('an unexpected token was resolved');
    },
  } as unknown as ModuleRef,
);

// ── Who is asking ─────────────────────────────────────────────

/** The Ranch admin agent's request, made for a person. */
const forPerson = (p: { id: string; role: UserRoleTypes }): Request =>
  asPerson(
    {
      user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
    } as unknown as Request,
    p.role,
    p.id,
  );
const asAdmin = () => forPerson(ADMIN);
const asOwner = () => forPerson(OWNER);

type ToolCall = (id: string, req: Request) => Promise<unknown>;

/** What a tool said, whether it answered or threw its refusal. */
async function said(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = (await run()) as ToolResult;
    return result.content.map((c) => c.text).join('\n');
  } catch (e) {
    if (e instanceof HttpException) return `threw: ${e.message}`;
    throw e;
  }
}

// ── Tools that take an agent id ───────────────────────────────

const BY_AGENT_ID: Record<string, ToolCall> = {
  // rancher.tool.ts
  get_agent: (id, req) => rancher.getAgent({ id }, null, req),
  restart_agent: (id, req) => rancher.restartAgent({ id }, null, req),
  update_agent: (id, req) =>
    rancher.updateAgent({ id, name: 'renamed' } as never, null, req),
  agent_usage: (agentId, req) => rancher.agentUsage({ agentId }, null, req),
  // agentAdmin.tool.ts
  stop_agent: (id, req) =>
    agentAdmin.stopAgent({ id, confirm: true } as never, null, req),
  start_agent: (id, req) => agentAdmin.startAgent({ id } as never, null, req),
  delete_agent: (id, req) =>
    agentAdmin.deleteAgent({ id, confirm: true } as never, null, req),
  get_agent_status: (id, req) =>
    agentAdmin.getAgentStatus({ id } as never, null, req),
  get_agent_env: (id, req) =>
    agentAdmin.getAgentEnv({ id } as never, null, req),
  list_agent_mcps: (id, req) =>
    agentAdmin.listAgentMcps({ id } as never, null, req),
  pin_agent: (id, req) => agentAdmin.pinAgent({ id, pinned: true }, null, req),
  // agentChannel.tool.ts
  get_agent_channels: (agentId, req) =>
    channels.getAgentChannels({ agentId }, null, req),
  set_agent_channels: (agentId, req) =>
    channels.setAgentChannels({ agentId, channels: [] }, null, req),
  // agentEvent.tool.ts
  list_agent_events: (agentId, req) =>
    eventTool.listAgentEvents({ agentId }, null, req),
  list_agent_incidents: (agentId, req) =>
    eventTool.listAgentIncidents({ agentId }, null, req),
  // file.tool.ts
  list_agent_files: (agentId, req) =>
    files.listAgentFiles({ agentId }, null, req),
  read_agent_file: (agentId, req) =>
    files.readAgentFile({ agentId, path: 'SOUL.md' }, null, req),
  delete_agent_file: (agentId, req) =>
    files.deleteAgentFile(
      { agentId, path: 'SOUL.md', confirm: true } as never,
      null,
      req,
    ),
  sync_agent_files: (agentId, req) =>
    files.syncAgentFiles({ agentId, confirm: true }, null, req),
  export_agent_files: (agentId, req) =>
    files.exportAgentFiles({ agentId }, null, req),
  // agentLimit.tool.ts
  get_agent_limits: (id, req) =>
    limits.getAgentLimits({ agent: id }, null, req),
  set_agent_limits: (id, req) =>
    limits.setAgentLimits({ agent: id, perMinute: 5 } as never, null, req),
  set_agent_visibility: (id, req) =>
    limits.setAgentVisibility(
      { agent: id, isPublic: true } as never,
      null,
      req,
    ),
  // peerAdmin.tool.ts
  list_agent_peers: (agentId, req) =>
    peers.listAgentPeers({ agentId }, null, req),
  list_peer_candidates: (agentId, req) =>
    peers.listPeerCandidates({ agentId }, null, req),
  list_agent_delegations: (agentId, req) =>
    peers.listAgentDelegations({ agentId }, null, req),
  connect_agent_peer: (agentId, req) =>
    peers.connectAgentPeer({ agentId, peerAgentId: A }, null, req),
  remove_agent_peer: (agentId, req) =>
    peers.removeAgentPeer({ agentId, peerId: 'p', confirm: true }, null, req),
  // secret.tool.ts
  list_agent_secrets: (agentId, req) =>
    secrets.listAgentSecrets({ agentId }, null, req),
  set_agent_secret: (agentId, req) =>
    secrets.setAgentSecret({ agentId, key: 'K', value: 'v' }, null, req),
  delete_agent_secret: (agentId, req) =>
    secrets.deleteAgentSecret({ agentId, key: 'K', confirm: true }, null, req),
  replace_agent_secrets: (agentId, req) =>
    secrets.replaceAgentSecrets(
      { agentId, store: {}, confirm: true },
      null,
      req,
    ),
  // shareLink.tool.ts
  get_share_link: (agentId, req) =>
    shareLinks.getShareLink({ agentId }, null, req),
  create_share_link: (agentId, req) =>
    shareLinks.createShareLink({ agentId }, null, req),
  regenerate_share_link: (agentId, req) =>
    shareLinks.regenerateShareLink({ agentId, confirm: true }, null, req),
  revoke_share_link: (agentId, req) =>
    shareLinks.revokeShareLink({ agentId, confirm: true }, null, req),
  // chat.tool.ts
  list_chats: (agentId, req) => chatTool.listChats({ agentId }, null, req),
  sync_chats: (agentId, req) => chatTool.syncChats({ agentId }, null, req),
  // log.tool.ts
  get_agent_logs: (agentId, req) => logs.getAgentLogs({ agentId }, null, req),
  // mcpOauth.tool.ts
  start_mcp_oauth: (agentId, req) =>
    oauth.startMcpOauth({ serverId: 'srv-1', agentId }, null, req),
  // paddock
  run_paddock_evaluation: (agentId, req) =>
    paddockEvaluations.run({ agentId } as never, null, req),
  list_paddock_evaluations: (agentId, req) =>
    paddockEvaluations.list({ agentId }, null, req),
  list_paddock_scenarios: (agentId, req) =>
    paddockScenarios.list({ agentId }, null, req),
  list_agent_paddock_scenarios: (agentId, req) =>
    paddockScenarios.listForAgent({ agentId }, null, req),
  create_paddock_scenario: (agentId, req) =>
    paddockScenarios.create({ agentId, name: 'x' } as never, null, req),
  generate_paddock_scenarios: (agentId, req) =>
    paddockScenarios.generate({ agentId, description: 'x' }, null, req),
};

describe('tools that take an agent id, as a limited Admin', () => {
  it.each(Object.keys(BY_AGENT_ID))(
    '%s: the hidden agent is not found, as an id that names nothing',
    async (tool) => {
      const hidden = await said(() => BY_AGENT_ID[tool](HIDDEN, asAdmin()));
      const unknown = await said(() => BY_AGENT_ID[tool](GHOST, asAdmin()));
      expect(hidden).toMatch(/not found/i);
      expect(hidden).not.toContain(HIDDEN_NAME);
      // The two answers are one answer.
      expect(hidden.split(HIDDEN).join('<id>')).toBe(
        unknown.split(GHOST).join('<id>'),
      );
    },
  );

  it('covers every tool that is not just a list', () => {
    expect(Object.keys(BY_AGENT_ID).length).toBeGreaterThanOrEqual(45);
  });
});

// ── Tools addressed by a record that belongs to an agent ──────

const BY_RECORD: Record<string, [string, ToolCall]> = {
  get_chat: [CHAT_OF_HIDDEN, (id, req) => chatTool.getChat({ id }, null, req)],
  get_chat_messages: [
    CHAT_OF_HIDDEN,
    (id, req) => chatTool.getChatMessages({ id }, null, req),
  ],
  summarize_chat: [
    CHAT_OF_HIDDEN,
    (id, req) => chatTool.summarizeChat({ id }, null, req),
  ],
  export_chat: [
    CHAT_OF_HIDDEN,
    (id, req) => chatTool.exportChat({ id }, null, req),
  ],
  get_paddock_evaluation: [
    EVAL_OF_HIDDEN,
    (id, req) => paddockEvaluations.get({ id }, null, req),
  ],
  get_paddock_evaluation_report: [
    EVAL_OF_HIDDEN,
    (id, req) => paddockEvaluations.report({ id }, null, req),
  ],
  abort_paddock_evaluation: [
    EVAL_OF_HIDDEN,
    (id, req) => paddockEvaluations.abort({ id, confirm: true }, null, req),
  ],
  get_paddock_evaluation_logs: [
    EVAL_OF_HIDDEN,
    (id, req) => paddockEvaluations.logs({ id } as never, null, req),
  ],
  get_paddock_evaluation_scenario_result: [
    EVAL_OF_HIDDEN,
    (id, req) =>
      paddockEvaluations.scenarioResult(
        { id, scenarioId: 's' } as never,
        null,
        req,
      ),
  ],
  get_paddock_evaluation_trace: [
    EVAL_OF_HIDDEN,
    (id, req) =>
      paddockEvaluations.trace({ id, scenarioId: 's' } as never, null, req),
  ],
  get_paddock_scenario: [
    SCENARIO_OF_HIDDEN,
    (id, req) => paddockScenarios.get({ id }, null, req),
  ],
  update_paddock_scenario: [
    SCENARIO_OF_HIDDEN,
    (id, req) => paddockScenarios.update({ id, name: 'x' } as never, null, req),
  ],
  delete_paddock_scenario: [
    SCENARIO_OF_HIDDEN,
    (id, req) => paddockScenarios.remove({ id, confirm: true }, null, req),
  ],
};

describe('tools addressed by a chat, an evaluation or a scenario of the hidden agent', () => {
  it.each(Object.keys(BY_RECORD))(
    '%s: the record is not found, as one that does not exist',
    async (tool) => {
      const [record, call] = BY_RECORD[tool];
      const hidden = await said(() => call(record, asAdmin()));
      const unknown = await said(() => call(NOTHING, asAdmin()));
      expect(hidden).toMatch(/not found/i);
      expect(hidden).not.toContain(HIDDEN);
      expect(hidden.split(record).join('<id>')).toBe(
        unknown.split(NOTHING).join('<id>'),
      );
    },
  );

  it('rerun_paddock_evaluation: the same, in that tool’s own words', async () => {
    const hidden = await said(() =>
      paddockEvaluations.rerun({ id: EVAL_OF_HIDDEN }, null, asAdmin()),
    );
    expect(hidden).toBe('threw: Source evaluation not found');
  });
});

// ── Tools that list ───────────────────────────────────────────

const LISTS: Record<string, (req: Request) => Promise<unknown>> = {
  list_agents: (req) => rancher.listAgents({}, null, req),
  list_skill_agents: (req) =>
    rancher.listSkillAgents({ skillId: 'skill-1' }, null, req),
  list_agent_limits: (req) => limits.listAgentLimits({}, null, req),
  get_usage_overview: (req) => usageTool.getUsageOverview({}, null, req),
  llm_usage: (req) => llmTool.llmUsage({ id: 'llm-1' }, null, req),
  list_paddock_evaluations: (req) => paddockEvaluations.list({}, null, req),
  list_paddock_scenarios: (req) => paddockScenarios.list({}, null, req),
};

describe('tools that list, as a limited Admin', () => {
  it.each(Object.keys(LISTS))(
    '%s: the hidden agent is left out, the others are there',
    async (tool) => {
      const mine = await said(() => LISTS[tool](asAdmin()));
      expect(mine).toContain(A);
      expect(mine).not.toContain(HIDDEN);
      expect(mine).not.toContain(HIDDEN_NAME);
      // The Owner's answer does carry it: the check has something to find.
      const whole = await said(() => LISTS[tool](asOwner()));
      expect(whole).toContain(HIDDEN);
    },
  );

  it('list_agents: an Admin gets their agents whole, config included', async () => {
    const mine = await said(() => LISTS.list_agents(asAdmin()));
    expect(mine).toContain('config-of-alpha');
    expect(mine).toContain('config-of-bravo');
  });

  it('get_usage_overview: totals are of the reached agents only', async () => {
    const totalsOf = async (req: Request) =>
      (
        JSON.parse(await said(() => LISTS.get_usage_overview(req))) as {
          totals: { callCount: number };
        }
      ).totals.callCount;
    expect(await totalsOf(asOwner())).toBe(15);
    expect(await totalsOf(asAdmin())).toBe(10);
  });

  it('list_paddock_scenarios keeps the scenarios of templates', async () => {
    const mine = await said(() => LISTS.list_paddock_scenarios(asAdmin()));
    expect(mine).toContain('scenario-of-template');
  });

  it('lists paged in the database are asked for the reached agents only', async () => {
    const scope = { in: [A, B] };
    await chatTool.listChats({}, null, asAdmin());
    expect(
      (chats as unknown as { list: jest.Mock }).list,
    ).toHaveBeenLastCalledWith(expect.objectContaining({ agentScope: scope }));

    const spies = events as unknown as {
      listEvents: jest.Mock;
      listIncidents: jest.Mock;
    };
    await eventTool.listAgentEvents({}, null, asAdmin());
    expect(spies.listEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: scope }),
    );
    await eventTool.listAgentIncidents({}, null, asAdmin());
    expect(spies.listIncidents).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: scope }),
    );
    // The Owner's lists are not narrowed.
    await eventTool.listAgentEvents({}, null, asOwner());
    expect(spies.listEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: undefined }),
    );
  });
});

describe('the same tools for an agent the Admin does reach', () => {
  it('get_agent answers', async () => {
    const mine = await said(() => rancher.getAgent({ id: A }, null, asAdmin()));
    expect(mine).toContain('alpha');
    expect(mine).not.toMatch(/not found/i);
  });

  it('a manage tool gets past the lists to its service', async () => {
    // `never('secrets')` is what answers: the lists let the call through.
    await expect(
      secrets.listAgentSecrets({ agentId: A }, null, asAdmin()),
    ).rejects.toThrow('secrets.list was reached');
  });
});
