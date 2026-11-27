import { NotFoundException } from '@nestjs/common';
import { AgentDeployService } from '#/agent/agent/domain/agentDeploy.service';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import type { ITemplateGateway } from '#/agent/template/domain';
import type { ITemplateData } from '#/agent/template/domain/template.types';
import type { ITemplateFileGateway } from '#/agent/templateFile/domain';
import {
  CLEANSLICE_MCP_ID,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import { AgentMcpResolver } from '#/mcpServer/domain/agentMcpResolver.service';
import type { IMcpServerGateway } from '#/mcpServer/domain';
import type { IMcpServerData } from '#/mcpServer/domain/mcpServer.types';
import type { ILlmGateway } from '#/llm/domain';
import { RANCHER_TEMPLATE_ID } from '#/rancher/domain/rancher.types';
import type { ISettingGateway } from '#/setting/domain';
import type { ISkillGateway } from '#/skill/domain';
import { UserRoleTypes } from '#/user/user/domain';
import { ArgoWorkflowGateway } from '#/workflow/data/argo-workflow.gateway';
import type { ISubmitWorkflowData } from '#/workflow/domain/IWorkflowGateway';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { AssistantBuildService } from '../assistantBuild.service';

/**
 * A Ranch held in memory, for the specs of "what the assistant is built
 * from" (CLEAN-271): the assistant with one of each kind of ingredient, an
 * ordinary agent with its own of each, and one of each that nothing uses.
 *
 * The stores are real stores: a write that gets through changes them. So
 * `assembled()` can prove a refusal the only way that counts, by putting the
 * assistant's pod together again and comparing it byte for byte.
 */

export const RANCH = 'agent-ranch';
export const ALPHA = 'agent-alpha';

/** What the assistant is built from. */
export const OF_RANCH = {
  template: RANCHER_TEMPLATE_ID,
  skill: 'skill-ranch',
  mcpServer: 'mcp-owner-tools',
  llmCredential: 'llm-ranch',
  knowledge: 'kb-ranch',
  /** The template's default base: an ingredient through the template. */
  defaultKnowledge: 'kb-ranch-default',
  source: 'source-ranch',
} as const;

/** What the ordinary agent is built from. */
export const OF_ALPHA = {
  template: 'tpl-alpha',
  skill: 'skill-alpha',
  mcpServer: 'mcp-alpha-tools',
  llmCredential: 'llm-alpha',
  knowledge: 'kb-alpha',
  source: 'source-alpha',
} as const;

/** What an Admin made and nothing uses yet. */
export const SPARE = {
  template: 'tpl-spare',
  skill: 'skill-spare',
  mcpServer: 'mcp-spare',
  knowledge: 'kb-spare',
} as const;

const AT = new Date('2026-11-20T09:00:00.000Z');

interface ISkillRow {
  id: string;
  name: string;
  title: string;
  description: string | null;
  body: string;
  files: { path: string; content: string }[];
  source: string | null;
  group: string | null;
}
interface ILlmRow {
  id: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  label: string | null;
  apiKey: string;
  status: string;
}
interface IKnowledgeRow {
  id: string;
  name: string;
  description: string | null;
  readerAccess: string;
  sourceCount: number;
  indexRuns: number;
}
interface ISourceRow {
  id: string;
  knowledgeId: string;
  type: string;
  name: string;
  content: string;
  reindexed: number;
}

export interface IRanchWorldOptions {
  /**
   * The settings gateway to deploy through, for a spec about settings: the
   * real `SettingGateway` over a store of its own. Default: a plain map.
   */
  settings?: ISettingGateway;
  /** The infra config to deploy through; default: a fixed Argo address. */
  infraConfig?: { getArgoUrl(): Promise<string> };
}

export function ranchWorld(options: IRanchWorldOptions = {}) {
  const agent = (
    id: string,
    name: string,
    of: { template: string; llmCredential: string; knowledge: string },
    isAdmin: boolean,
  ): IAgentData =>
    ({
      id,
      name,
      isAdmin,
      isPublic: false,
      createdById: null,
      status: 'running',
      statusReason: null,
      workflowId: null,
      firstDeployedAt: AT,
      templateId: of.template,
      llmCredentialId: of.llmCredential,
      knowledgeIds: [of.knowledge],
      config: {},
      resources: { cpu: '500m', memory: '512Mi' },
      debugEnabled: false,
      allowedOrigins: [],
    }) as unknown as IAgentData;

  const template = (
    id: string,
    name: string,
    of: { skill: string; mcpServer: string },
    extra: Partial<ITemplateData> = {},
  ): ITemplateData => ({
    id,
    name,
    description: `${name} template`,
    image: 'ghcr.io/cleanslice/runtime:1.0.0',
    defaultConfig: {},
    defaultResources: { cpu: '500m', memory: '512Mi' },
    paddockConfig: {},
    defaultKnowledgeIds: [],
    sourceUrl: null,
    sourceType: null,
    manifestJson: null,
    version: '1.0.0',
    skillIds: [of.skill],
    mcpServerIds: [of.mcpServer],
    toolAllowlist: null,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });

  const server = (
    id: string,
    name: string,
    extra: Partial<IMcpServerData> = {},
  ): IMcpServerData => ({
    id,
    name,
    description: null,
    url: `https://${id}.example/mcp`,
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: `key-of-${id}`,
    oauthClientId: null,
    enabled: true,
    builtIn: false,
    templateIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
  const builtIn = (id: string, name: string): IMcpServerData =>
    server(id, name, {
      url: 'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
      authValue: '${RANCH_API_TOKEN}',
      builtIn: true,
    });

  const state = {
    agents: new Map<string, IAgentData>(),
    templates: new Map<string, ITemplateData>(),
    templateFiles: new Map<string, Map<string, string>>(),
    skills: new Map<string, ISkillRow>(),
    servers: new Map<string, IMcpServerData>(),
    llms: new Map<string, ILlmRow>(),
    knowledges: new Map<string, IKnowledgeRow>(),
    sources: new Map<string, ISourceRow>(),
    settings: new Map<
      string,
      { group: string; name: string; value: unknown }
    >(),
  };

  function reset(): void {
    state.agents = new Map([
      [RANCH, agent(RANCH, 'Rancher', OF_RANCH, true)],
      [ALPHA, agent(ALPHA, 'alpha', OF_ALPHA, false)],
    ]);
    state.templates = new Map([
      [
        OF_RANCH.template,
        template(
          OF_RANCH.template,
          'Rancher',
          {
            skill: OF_RANCH.skill,
            mcpServer: OF_RANCH.mcpServer,
          },
          {
            mcpServerIds: [RANCH_MCP_ID, OF_RANCH.mcpServer],
            defaultKnowledgeIds: [OF_RANCH.defaultKnowledge],
          },
        ),
      ],
      [OF_ALPHA.template, template(OF_ALPHA.template, 'Support', OF_ALPHA)],
      [
        SPARE.template,
        template(
          SPARE.template,
          'Spare',
          { skill: '', mcpServer: '' },
          { skillIds: [], mcpServerIds: [] },
        ),
      ],
    ]);
    state.templateFiles = new Map([
      [
        OF_RANCH.template,
        new Map([
          ['SOUL.md', 'You are Rancher. You act for the Owner.'],
          ['HEARTBEAT.md', 'Every hour: check the fleet.'],
        ]),
      ],
      [OF_ALPHA.template, new Map([['SOUL.md', 'You are a support agent.']])],
    ]);
    const skill = (id: string, name: string): ISkillRow => ({
      id,
      name,
      title: `${name} skill`,
      description: null,
      body: `# ${name}\nHow to do ${name}.`,
      files: [{ path: 'references/notes.md', content: `notes of ${name}` }],
      source: null,
      group: null,
    });
    state.skills = new Map([
      [OF_RANCH.skill, skill(OF_RANCH.skill, 'ranch-ops')],
      [OF_ALPHA.skill, skill(OF_ALPHA.skill, 'support-replies')],
      [SPARE.skill, skill(SPARE.skill, 'spare-skill')],
    ]);
    state.servers = new Map(
      [
        builtIn(RANCH_MCP_ID, 'Ranch'),
        builtIn(DOCUMENTS_MCP_ID, 'Documents'),
        builtIn(KNOWLEDGE_MCP_ID, 'Knowledge'),
        server(CLEANSLICE_MCP_ID, 'CleanSlice', {
          authType: 'none',
          authValue: null,
          builtIn: true,
        }),
        server(OF_RANCH.mcpServer, 'Owner tools'),
        server(OF_ALPHA.mcpServer, 'Alpha tools'),
        server(SPARE.mcpServer, 'Spare server'),
      ].map((row) => [row.id, row]),
    );
    const llm = (id: string, label: string): ILlmRow => ({
      id,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      fallbackModel: null,
      label,
      apiKey: `sk-of-${id}`,
      status: 'active',
    });
    state.llms = new Map([
      [OF_RANCH.llmCredential, llm(OF_RANCH.llmCredential, 'Owner key')],
      [OF_ALPHA.llmCredential, llm(OF_ALPHA.llmCredential, 'Team key')],
    ]);
    const knowledge = (id: string, name: string): IKnowledgeRow => ({
      id,
      name,
      description: null,
      readerAccess: 'closed',
      sourceCount: 1,
      indexRuns: 0,
    });
    state.knowledges = new Map([
      [OF_RANCH.knowledge, knowledge(OF_RANCH.knowledge, 'Owner handbook')],
      [
        OF_RANCH.defaultKnowledge,
        knowledge(OF_RANCH.defaultKnowledge, 'Rancher defaults'),
      ],
      [OF_ALPHA.knowledge, knowledge(OF_ALPHA.knowledge, 'Support articles')],
      [SPARE.knowledge, knowledge(SPARE.knowledge, 'Spare base')],
    ]);
    const source = (id: string, knowledgeId: string): ISourceRow => ({
      id,
      knowledgeId,
      type: 'text',
      name: `doc of ${knowledgeId}`,
      content: `what ${knowledgeId} says`,
      reindexed: 0,
    });
    state.sources = new Map([
      [OF_RANCH.source, source(OF_RANCH.source, OF_RANCH.knowledge)],
      [OF_ALPHA.source, source(OF_ALPHA.source, OF_ALPHA.knowledge)],
    ]);
    state.settings = new Map([
      [
        'integrations/bridle_url',
        { group: 'integrations', name: 'bridle_url', value: 'wss://hub/ws' },
      ],
      [
        'integrations/bridle_api_key',
        { group: 'integrations', name: 'bridle_api_key', value: 'hub-key' },
      ],
      [
        'integrations/s3_bucket',
        { group: 'integrations', name: 's3_bucket', value: 'ranch-bucket' },
      ],
      [
        'rancher/seeded_hash',
        { group: 'rancher', name: 'seeded_hash', value: 'hash-1' },
      ],
    ]);
  }
  reset();

  const missing = (what: string, id: string) =>
    new NotFoundException(`${what} ${id} not found`);

  // ── gateways ────────────────────────────────────────────────

  const agents = {
    findAll: () => Promise.resolve([...state.agents.values()]),
    findAdmin: () =>
      Promise.resolve(
        [...state.agents.values()].find((a) => a.isAdmin) ?? null,
      ),
    findById: (id: string) => Promise.resolve(state.agents.get(id) ?? null),
    findByTemplateId: (templateId: string) =>
      Promise.resolve(
        [...state.agents.values()].filter((a) => a.templateId === templateId),
      ),
    hasCreatedBy: () => Promise.resolve(false),
    update: (id: string, data: Partial<IAgentData>) => {
      const row = state.agents.get(id);
      if (!row) throw missing('Agent', id);
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) next[key] = value;
      }
      state.agents.set(id, next as unknown as IAgentData);
      return Promise.resolve(next as unknown as IAgentData);
    },
    updateStatus: () => Promise.resolve(),
    setStatusReason: () => Promise.resolve(),
    markDeployStarted: () => Promise.resolve(),
    setFirstDeployedAt: () => Promise.resolve(),
    setWorkflowId: () => Promise.resolve(),
  } as unknown as IAgentGateway;

  const patchTemplate = (id: string, data: Partial<ITemplateData>) => {
    const row = state.templates.get(id);
    if (!row) throw missing('Template', id);
    const next = { ...row } as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) next[key] = value;
    }
    state.templates.set(id, next as unknown as ITemplateData);
    return Promise.resolve(next as unknown as ITemplateData);
  };
  const templates = {
    findAll: () => Promise.resolve([...state.templates.values()]),
    findById: (id: string) => Promise.resolve(state.templates.get(id) ?? null),
    create: (data: Partial<ITemplateData>) => {
      const id = `tpl-new-${state.templates.size}`;
      state.templates.set(
        id,
        template(id, data.name ?? id, { skill: '', mcpServer: '' }, {
          ...data,
          skillIds: [],
          mcpServerIds: [],
        } as Partial<ITemplateData>),
      );
      return Promise.resolve(state.templates.get(id)!);
    },
    createWithId: (data: Partial<ITemplateData> & { id: string }) => {
      state.templates.set(
        data.id,
        template(data.id, data.name ?? data.id, { skill: '', mcpServer: '' }, {
          ...data,
          skillIds: [],
          mcpServerIds: [],
        } as Partial<ITemplateData>),
      );
      return Promise.resolve(state.templates.get(data.id)!);
    },
    update: patchTemplate,
    setSkills: (id: string, skillIds: string[]) =>
      patchTemplate(id, { skillIds }),
    setMcps: (id: string, mcpServerIds: string[]) =>
      patchTemplate(id, { mcpServerIds }),
    setToolAllowlist: (id: string, toolAllowlist: string[] | null) => {
      const row = state.templates.get(id);
      if (!row) throw missing('Template', id);
      state.templates.set(id, { ...row, toolAllowlist });
      return Promise.resolve(state.templates.get(id)!);
    },
    touch: (id: string) => Promise.resolve(state.templates.get(id)!),
    countAgents: (id: string) =>
      Promise.resolve(
        [...state.agents.values()].filter((a) => a.templateId === id).length,
      ),
    delete: (id: string) => {
      state.templates.delete(id);
      state.templateFiles.delete(id);
      return Promise.resolve();
    },
  } as unknown as ITemplateGateway;

  const filesOf = (templateId: string) => {
    if (!state.templateFiles.has(templateId)) {
      state.templateFiles.set(templateId, new Map());
    }
    return state.templateFiles.get(templateId)!;
  };
  const templateFiles = {
    list: (templateId: string) =>
      Promise.resolve(
        [...filesOf(templateId).entries()].map(([path, content]) => ({
          path,
          size: content.length,
          updatedAt: AT,
        })),
      ),
    read: (templateId: string, path: string) => {
      const content = filesOf(templateId).get(path);
      if (content === undefined) throw missing('File', path);
      return Promise.resolve({
        path,
        content,
        size: content.length,
        updatedAt: AT,
      });
    },
    save: (templateId: string, path: string, content: string) => {
      filesOf(templateId).set(path, content);
      return Promise.resolve();
    },
    uploadMany: (
      templateId: string,
      files: { path: string; buffer: Buffer }[],
    ) => {
      for (const file of files) {
        filesOf(templateId).set(file.path, file.buffer.toString('utf8'));
      }
      return Promise.resolve();
    },
    wipe: (templateId: string) => {
      state.templateFiles.set(templateId, new Map());
      return Promise.resolve();
    },
  } as unknown as ITemplateFileGateway;

  const skills = {
    findAll: () => Promise.resolve([...state.skills.values()]),
    findById: (id: string) => Promise.resolve(state.skills.get(id) ?? null),
    findByName: (name: string) =>
      Promise.resolve(
        [...state.skills.values()].find((s) => s.name === name) ?? null,
      ),
    findByIds: (ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => state.skills.get(id))
          .filter((s): s is ISkillRow => s !== undefined),
      ),
    create: (data: Partial<ISkillRow> & { name: string }) => {
      // The unique index on Skill.name.
      if ([...state.skills.values()].some((s) => s.name === data.name)) {
        return Promise.reject(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['name'] },
          }),
        );
      }
      const id = `skill-new-${state.skills.size}`;
      const row: ISkillRow = {
        id,
        title: data.name,
        description: null,
        body: '',
        files: [],
        source: null,
        group: null,
        ...data,
      };
      state.skills.set(id, row);
      return Promise.resolve(row);
    },
    update: (id: string, data: Partial<ISkillRow>) => {
      const row = state.skills.get(id);
      if (!row) throw missing('Skill', id);
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) next[key] = value;
      }
      state.skills.set(id, next as unknown as ISkillRow);
      return Promise.resolve(next);
    },
    delete: (id: string) => {
      state.skills.delete(id);
      // The relation goes with the row, as the join table's cascade does.
      for (const [templateId, row] of state.templates) {
        state.templates.set(templateId, {
          ...row,
          skillIds: row.skillIds.filter((skillId) => skillId !== id),
        });
      }
      return Promise.resolve();
    },
    findDependentAgents: (id: string) =>
      Promise.resolve(
        [...state.agents.values()]
          .filter((a) =>
            state.templates.get(a.templateId)?.skillIds.includes(id),
          )
          .map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            templateId: a.templateId,
            templateName: state.templates.get(a.templateId)?.name ?? '',
          })),
      ),
  } as unknown as ISkillGateway;

  const servers = {
    findAll: () => Promise.resolve([...state.servers.values()]),
    findById: (id: string) => Promise.resolve(state.servers.get(id) ?? null),
    findByIds: (ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => state.servers.get(id))
          .filter((s): s is IMcpServerData => s !== undefined),
      ),
    create: (data: Partial<IMcpServerData> & { name: string; url: string }) => {
      const id = data.id ?? `mcp-new-${state.servers.size}`;
      state.servers.set(id, server(id, data.name, { ...data, id }));
      return Promise.resolve(state.servers.get(id)!);
    },
    update: (id: string, data: Partial<IMcpServerData>) => {
      const row = state.servers.get(id);
      if (!row) throw missing('MCP server', id);
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) next[key] = value;
      }
      state.servers.set(id, next as unknown as IMcpServerData);
      return Promise.resolve(next as unknown as IMcpServerData);
    },
    delete: (id: string) => {
      state.servers.delete(id);
      for (const [templateId, row] of state.templates) {
        state.templates.set(templateId, {
          ...row,
          mcpServerIds: row.mcpServerIds.filter((serverId) => serverId !== id),
        });
      }
      return Promise.resolve();
    },
  } as unknown as IMcpServerGateway;

  const llms = {
    findAll: () => Promise.resolve([...state.llms.values()]),
    findById: (id: string) => Promise.resolve(state.llms.get(id) ?? null),
    create: (data: Partial<ILlmRow>) => {
      const id = `llm-new-${state.llms.size}`;
      const row = {
        id,
        provider: 'claude',
        model: 'm',
        fallbackModel: null,
        label: null,
        apiKey: '',
        status: 'active',
        ...data,
      };
      state.llms.set(id, row);
      return Promise.resolve(row);
    },
    update: (id: string, data: Partial<ILlmRow>) => {
      const row = state.llms.get(id);
      if (!row) throw missing('LLM credential', id);
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) next[key] = value;
      }
      state.llms.set(id, next as unknown as ILlmRow);
      return Promise.resolve(next);
    },
    delete: (id: string) => {
      state.llms.delete(id);
      // onDelete: SetNull on Agent.llmCredentialId.
      for (const [agentId, row] of state.agents) {
        if (row.llmCredentialId === id) {
          state.agents.set(agentId, { ...row, llmCredentialId: null });
        }
      }
      return Promise.resolve();
    },
  } as unknown as ILlmGateway;

  /** `KnowledgeService`, as much of it as the tools and routes call. */
  const knowledgeService = {
    get: (id: string) => {
      const row = state.knowledges.get(id);
      if (!row) return Promise.reject(missing('Knowledge', id));
      return Promise.resolve(row);
    },
    getWithDerivedStatus: (id: string) => knowledgeService.get(id),
    listPage: () =>
      Promise.resolve({
        items: [...state.knowledges.values()],
        total: state.knowledges.size,
        page: 1,
        perPage: 50,
      }),
    create: (data: { name: string; description?: string }) => {
      const id = `kb-new-${state.knowledges.size}`;
      const row: IKnowledgeRow = {
        id,
        name: data.name,
        description: data.description ?? null,
        readerAccess: 'closed',
        sourceCount: 0,
        indexRuns: 0,
      };
      state.knowledges.set(id, row);
      return Promise.resolve(row);
    },
    update: async (id: string, data: Partial<IKnowledgeRow>) => {
      const row = await knowledgeService.get(id);
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) next[key] = value;
      }
      state.knowledges.set(id, next as unknown as IKnowledgeRow);
      return next as unknown as IKnowledgeRow;
    },
    delete: async (id: string) => {
      await knowledgeService.get(id);
      state.knowledges.delete(id);
      for (const [sourceId, row] of state.sources) {
        if (row.knowledgeId === id) state.sources.delete(sourceId);
      }
    },
    startIndex: async (id: string) => {
      const row = await knowledgeService.get(id);
      state.knowledges.set(id, { ...row, indexRuns: row.indexRuns + 1 });
    },
  };

  const sourceGateway = {
    findById: (id: string) => Promise.resolve(state.sources.get(id) ?? null),
  };
  const addSource = (
    knowledgeId: string,
    type: string,
    name: string,
    content: string,
  ) => {
    const id = `source-new-${state.sources.size}`;
    const row = { id, knowledgeId, type, name, content, reindexed: 0 };
    state.sources.set(id, row);
    return Promise.resolve(row);
  };
  const inBase = (knowledgeId: string, sourceId: string) => {
    const row = state.sources.get(sourceId);
    if (!row || row.knowledgeId !== knowledgeId) {
      throw missing('Source', sourceId);
    }
    return row;
  };
  /** `SourceService`, as much of it as the tools and routes call. */
  const sourceService = {
    listImports: () => [],
    addUrl: (knowledgeId: string, data: { name: string; url: string }) =>
      addSource(knowledgeId, 'url', data.name, data.url),
    addText: (knowledgeId: string, data: { name: string; content: string }) =>
      addSource(knowledgeId, 'text', data.name, data.content),
    addFile: (knowledgeId: string, data: { name: string; buffer: Buffer }) =>
      addSource(knowledgeId, 'file', data.name, data.buffer.toString('utf8')),
    addFiles: async (
      knowledgeId: string,
      files: { name: string; buffer: Buffer }[],
    ) => {
      for (const file of files) {
        await addSource(knowledgeId, 'file', file.name, '');
      }
      return { added: files.length, skipped: [] };
    },
    addFromSitemap: async (knowledgeId: string, sitemapUrl: string) => {
      await addSource(knowledgeId, 'url', sitemapUrl, sitemapUrl);
      return { added: 1, skipped: 0, total: 1 };
    },
    addFromArchive: async (knowledgeId: string, path: string) => {
      await addSource(knowledgeId, 'file', path, '');
      return { jobId: 'job-1' };
    },
    reindexSource: (knowledgeId: string, sourceId: string) => {
      const row = inBase(knowledgeId, sourceId);
      state.sources.set(sourceId, { ...row, reindexed: row.reindexed + 1 });
      return Promise.resolve();
    },
    reextractSource: (knowledgeId: string, sourceId: string) => {
      const row = inBase(knowledgeId, sourceId);
      state.sources.set(sourceId, { ...row, reindexed: row.reindexed + 1 });
      return Promise.resolve();
    },
    delete: (sourceId: string) => {
      if (!state.sources.delete(sourceId)) throw missing('Source', sourceId);
      return Promise.resolve();
    },
    deleteIn: (knowledgeId: string, sourceId: string) => {
      inBase(knowledgeId, sourceId);
      state.sources.delete(sourceId);
      return Promise.resolve();
    },
  };

  const settings = (options.settings ?? {
    findAll: () => Promise.resolve([...state.settings.values()]),
    findByGroup: (group: string) =>
      Promise.resolve(
        [...state.settings.values()].filter((row) => row.group === group),
      ),
    findByKey: (group: string, name: string) =>
      Promise.resolve(state.settings.get(`${group}/${name}`) ?? null),
    upsert: (group: string, name: string, data: { value: unknown }) => {
      const row = { group, name, value: data.value };
      state.settings.set(`${group}/${name}`, row);
      return Promise.resolve(row);
    },
    delete: (group: string, name: string) => {
      state.settings.delete(`${group}/${name}`);
      return Promise.resolve();
    },
  }) as unknown as ISettingGateway;
  const infraConfig = options.infraConfig ?? {
    getArgoUrl: () => Promise.resolve('http://argo'),
  };

  const build = new AssistantBuildService(agents, templates);

  // ── the deploy path ─────────────────────────────────────────
  //
  // `AgentDeployService.restartAgent` as it runs in production, over these
  // stores: the template's files copied into the workspace, the template's
  // skills written beside them, and the manifest `ArgoWorkflowGateway`
  // resolves (image, model credential, tool servers, settings). The only
  // things replaced are the two that leave the process: S3, which is a map
  // here, and the POST to Argo, which is captured instead of sent.

  const knowledgeRecords = {
    findExistingByIds: (ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => state.knowledges.get(id))
          .filter((row): row is IKnowledgeRow => row !== undefined),
      ),
  };
  const mcpResolver = new AgentMcpResolver(
    templates,
    servers,
    knowledgeRecords as never,
    { isEnabled: () => Promise.resolve(true) } as never,
  );

  class CapturingWorkflowGateway extends ArgoWorkflowGateway {
    submitted: { image: string; submittedTo: string; env: unknown }[] = [];

    async submit(data: ISubmitWorkflowData): Promise<string> {
      this.submitted.push({
        image: data.image,
        // Where the manifest, which holds the agent's token, is posted.
        submittedTo: await infraConfig.getArgoUrl(),
        env: await this.previewEnv(data),
      });
      return 'workflow-1';
    }

    cancel(): Promise<void> {
      return Promise.resolve();
    }
  }

  const workflowGateway = () =>
    new CapturingWorkflowGateway(
      infraConfig as never,
      settings,
      llms,
      mcpResolver,
      { getForAgent: () => Promise.resolve([]) } as never,
      {
        findAll: () =>
          Promise.resolve([
            { id: 'user-owner', role: UserRoleTypes.Owner, createdAt: AT },
          ]),
      } as never,
    );
  /** The service behind `GET /agents/:id/env` and `get_agent_env`. */
  const workflows = new WorkflowService(workflowGateway(), settings);

  /**
   * Everything the assistant's next pod would be made of, as one string:
   * its workspace after the restart's resync, the skills written into it,
   * the image and every env var of the manifest, and what its knowledge
   * bases hold. Two calls return the same bytes unless something the
   * assistant is built from changed in between.
   */
  async function assembled(agentId: string = RANCH): Promise<string> {
    const workspace = new Map<string, string>();
    const files = {
      resyncFromTemplate: async (_agentId: string, templateId: string) => {
        const source = state.templateFiles.get(templateId) ?? new Map();
        for (const [path, content] of source) workspace.set(path, content);
        // The API's own S3 client reads the bucket when it copies, the way
        // `FileGateway.getIntegration` does: through the settings gateway.
        const bucket = await settings.findByKey('integrations', 's3_bucket');
        workspace.set(
          '(copied by the API from bucket)',
          typeof bucket?.value === 'string' ? bucket.value : '',
        );
        return source.size;
      },
      syncSkills: (
        _agentId: string,
        bundles: { name: string; body: string; files: unknown }[],
      ) => {
        for (const bundle of bundles) {
          workspace.set(
            `skills/${bundle.name}/SKILL.md`,
            `${bundle.body}\n${JSON.stringify(bundle.files)}`,
          );
        }
        return Promise.resolve(bundles.length);
      },
    };
    const gateway = workflowGateway();
    const deploy = new AgentDeployService(
      agents,
      templates,
      new WorkflowService(gateway, settings),
      {
        issueAgentServiceToken: () => Promise.resolve('TOKEN'),
      } as never,
      files as never,
      skills,
      { delete: () => Promise.resolve() } as never,
      { mark: () => undefined } as never,
    );
    await deploy.restartAgent(agentId);

    const row = state.agents.get(agentId);
    const ownTemplate = row ? state.templates.get(row.templateId) : undefined;
    const knowledgeIds = row?.knowledgeIds.length
      ? row.knowledgeIds
      : (ownTemplate?.defaultKnowledgeIds ?? []);
    return JSON.stringify(
      {
        submitted: gateway.submitted,
        workspace: [...workspace.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        toolAllowlist: ownTemplate?.toolAllowlist ?? null,
        knowledge: knowledgeIds.map((id) => ({
          base: state.knowledges.get(id) ?? null,
          sources: [...state.sources.values()]
            .filter((source) => source.knowledgeId === id)
            .sort((a, b) => a.id.localeCompare(b.id)),
        })),
        templateDefaults: (ownTemplate?.defaultKnowledgeIds ?? []).map(
          (id) => state.knowledges.get(id) ?? null,
        ),
      },
      null,
      2,
    );
  }

  return {
    state,
    reset,
    agents,
    templates,
    templateFiles,
    skills,
    servers,
    llms,
    knowledgeService,
    sourceService,
    sourceGateway,
    settings,
    build,
    mcpResolver,
    workflows,
    assembled,
  };
}

export type RanchWorld = ReturnType<typeof ranchWorld>;
