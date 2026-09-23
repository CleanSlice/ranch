import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  stripSecrets,
} from '#/mcp/tooling';
import { IAgentGateway } from '#/agent/agent/domain';
import { AgentDeployService } from '#/agent/agent/domain/agentDeploy.service';
import { ITemplateGateway } from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import { ILlmGateway } from '#/llm/domain';
import { ISkillGateway } from '#/skill/domain';
import {
  ISettingGateway,
  describeSettingCatalog,
  findSettingDefinition,
  nearestSettingDefinition,
} from '#/setting/domain';
import { IUsageGateway } from '#/usage/domain';
import { IFileGateway } from '#/agent/file/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { RancherService } from './domain/rancher.service';

/**
 * The original Ranch management tools — agents, templates, skills, LLM
 * credentials, files, usage, settings. Operator-only: the Ranch admin agent
 * holds the Owner role, plain agents do not (CLEAN-109 moved the check to
 * the shared `requireOperator`; the tools themselves are unchanged).
 */
@Injectable()
export class RancherTool {
  private readonly logger = new Logger(RancherTool.name);

  constructor(
    private readonly agents: IAgentGateway,
    private readonly agentDeploy: AgentDeployService,
    private readonly templates: ITemplateGateway,
    private readonly templateFiles: ITemplateFileGateway,
    private readonly llms: ILlmGateway,
    private readonly skills: ISkillGateway,
    private readonly settings: ISettingGateway,
    private readonly usage: IUsageGateway,
    private readonly files: IFileGateway,
    private readonly rancher: RancherService,
  ) {}

  // ─── Platform ────────────────────────────────────────────────────────

  @Tool({
    name: 'get_rancher_status',
    topic: ToolTopics.Platform,
    title: 'Rancher setup status',
    template: 'Is the Rancher setup complete?',
    description:
      'The Rancher setup wizard state: is there an LLM credential, the special Rancher template, an admin agent, and S3 configured. Read-only; the console shows the same stepper.',
    parameters: z.object({}),
  })
  async getRancherStatus(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.rancher.getStatus());
  }

  private requireOwner(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): void {
    requireOperator(httpRequest);
  }

  // ─── Agents ──────────────────────────────────────────────────────────

  @Tool({
    name: 'list_agents',
    topic: ToolTopics.Agents,
    title: 'List agents',
    template: 'List all agents and their status',
    description:
      'List every agent on this Ranch with their status, template, and resources.',
    parameters: z.object({}),
  })
  async listAgents(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const items = await this.agents.findAll();
    return ok(items);
  }

  @Tool({
    name: 'get_agent',
    topic: ToolTopics.Agents,
    title: 'Show an agent',
    template: 'Show the agent «name»',
    description:
      'Get a single agent by id, including current status, workflowId and config.',
    parameters: z.object({
      id: z.string().describe('Agent id, e.g. agent-abc123'),
    }),
  })
  async getAgent(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return ok({ error: `Agent ${id} not found` });
    return ok(agent);
  }

  @Tool({
    name: 'restart_agent',
    topic: ToolTopics.Agents,
    title: 'Restart an agent',
    template: 'Restart the agent «name»',
    description:
      'Restart an agent pod. Use after editing its files or LLM credential to apply changes.',
    parameters: z.object({
      id: z.string(),
    }),
  })
  async restartAgent(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return ok({ error: `Agent ${id} not found` });
    // Fire-and-forget the real restart flow (template resync → cancel old
    // workflow → deploy). A bare status write here would leave the agent
    // stuck in 'deploying' with no new pod until drift detection failed it.
    void this.agentDeploy.restartAgent(id).catch((err) => {
      this.logger.warn(
        `restart_agent tool: restart failed for ${id}: ${(err as Error).message}`,
      );
    });
    return ok({
      ok: true,
      agentId: id,
      message: 'Restart started — the agent pod will be replaced shortly.',
    });
  }

  @Tool({
    name: 'create_agent',
    topic: ToolTopics.Agents,
    title: 'Create an agent',
    template:
      'Create an agent «name» from the template «template» using the LLM credential «credential»',
    description:
      'Create and deploy a new agent from a template. Seeds template files, ' +
      'syncs skills and starts the first deploy — the agent will appear as ' +
      '"deploying" and boot shortly. Optionally bind knowledge bases right ' +
      'away via knowledgeIds.',
    parameters: z.object({
      name: z.string().describe('Human-readable agent name'),
      templateId: z.string().describe('Template id — pick from list_templates'),
      llmCredentialId: z
        .string()
        .optional()
        .describe('LLM credential id — pick from list_llms'),
      knowledgeIds: z
        .array(z.string())
        .optional()
        .describe('Knowledge base ids to bind (list_knowledges for the list)'),
      isAdmin: z
        .boolean()
        .optional()
        .describe(
          'Promote to Ranch admin (single-admin invariant: demotes the current one)',
        ),
    }),
  })
  async createAgent(
    {
      name,
      templateId,
      llmCredentialId,
      knowledgeIds,
      isAdmin,
    }: {
      name: string;
      templateId: string;
      llmCredentialId?: string;
      knowledgeIds?: string[];
      isAdmin?: boolean;
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    // Friendly precheck — a bad templateId would otherwise surface as an
    // opaque foreign-key error from the DB layer.
    const template = await this.templates.findById(templateId);
    if (!template) {
      return ok({
        error: `Template ${templateId} not found — pick one from list_templates`,
      });
    }
    const created = await this.agentDeploy.createAgent(
      { name, templateId, llmCredentialId, knowledgeIds },
      { isAdmin },
    );
    return ok({
      ok: true,
      agent: created,
      message:
        'Agent created — first deploy started, it will boot shortly. ' +
        'Knowledge bindings (if any) are baked into this deploy.',
    });
  }

  @Tool({
    name: 'update_agent',
    topic: ToolTopics.Agents,
    title: 'Update an agent',
    template: 'Change the agent «name»: «what to change»',
    description:
      'Update an agent: rename, switch LLM credential, or bind knowledge ' +
      'bases. knowledgeIds REPLACES the full list (fetch current via ' +
      'get_agent first). Binding/credential changes apply on the next ' +
      'restart — offer restart_agent.',
    parameters: z.object({
      id: z.string(),
      name: z.string().optional(),
      llmCredentialId: z
        .string()
        .nullable()
        .optional()
        .describe('LLM credential id; null detaches the credential'),
      knowledgeIds: z
        .array(z.string())
        .optional()
        .describe(
          'FULL desired list of knowledge base ids (replaces, not appends)',
        ),
    }),
  })
  async updateAgent(
    {
      id,
      name,
      llmCredentialId,
      knowledgeIds,
    }: {
      id: string;
      name?: string;
      llmCredentialId?: string | null;
      knowledgeIds?: string[];
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const existing = await this.agents.findById(id);
    if (!existing) return ok({ error: `Agent ${id} not found` });
    const updated = await this.agents.update(id, {
      name,
      llmCredentialId,
      knowledgeIds,
    });
    const needsRestart =
      knowledgeIds !== undefined || llmCredentialId !== undefined;
    return ok({
      ok: true,
      agent: updated,
      ...(needsRestart && {
        notice:
          'Saved. Knowledge/credential changes apply on the next start — ' +
          'a restart is required. Tell the user and offer restart_agent.',
      }),
    });
  }

  @Tool({
    name: 'set_agent_admin',
    topic: ToolTopics.Agents,
    title: 'Make an agent the Ranch admin',
    template: 'Make «name» the Ranch admin agent',
    description:
      'Promote or demote an agent to/from Ranch admin. Single-admin invariant: enabling clears the flag from any other agent.',
    parameters: z.object({
      id: z.string(),
      enabled: z.boolean(),
    }),
  })
  async setAgentAdmin(
    { id, enabled }: { id: string; enabled: boolean },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const updated = await this.agents.setAdmin(id, enabled);
    return ok(updated);
  }

  // ─── Templates ───────────────────────────────────────────────────────

  @Tool({
    name: 'list_templates',
    topic: ToolTopics.Templates,
    title: 'List templates',
    template: 'List all agent templates',
    description:
      'List all agent templates (image + defaults that pods are spawned from).',
    parameters: z.object({}),
  })
  async listTemplates(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.templates.findAll());
  }

  @Tool({
    name: 'get_template',
    topic: ToolTopics.Templates,
    title: 'Show a template',
    template: 'Show the template «name»',
    description:
      'Get a template by id, including image, defaultResources, and attached skill ids.',
    parameters: z.object({ id: z.string() }),
  })
  async getTemplate(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const template = await this.templates.findById(id);
    return ok(template ?? { error: `Template ${id} not found` });
  }

  @Tool({
    name: 'set_template_skills',
    topic: ToolTopics.Templates,
    title: 'Set template skills',
    template: 'Give the template «name» the skills «skill list»',
    description:
      'Replace the full set of skills attached to a template. The list is exhaustive — omitted ids are detached.',
    parameters: z.object({
      id: z.string(),
      skillIds: z.array(z.string()),
    }),
  })
  async setTemplateSkills(
    {
      id,
      skillIds,
    }: {
      id: string;
      skillIds: string[];
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.templates.setSkills(id, skillIds));
  }

  @Tool({
    name: 'update_template',
    topic: ToolTopics.Templates,
    title: 'Update a template',
    template: 'Change the template «name»: «what to change»',
    description:
      'Update template fields in place. Pass only the fields you want to change. ' +
      'Useful for editing defaultConfig, paddockConfig (passThreshold, scenarios, ' +
      'maxIterations, etc.), name, description, image, or defaultResources.',
    parameters: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      defaultConfig: z.record(z.unknown()).optional(),
      defaultResources: z
        .object({ cpu: z.string(), memory: z.string() })
        .optional(),
      paddockConfig: z.record(z.unknown()).optional(),
    }),
  })
  async updateTemplate(
    {
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      description?: string;
      image?: string;
      defaultConfig?: Record<string, unknown>;
      defaultResources?: { cpu: string; memory: string };
      paddockConfig?: Record<string, unknown>;
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const template = await this.templates.findById(id);
    if (!template) return ok({ error: `Template ${id} not found` });
    const updated = await this.templates.update(id, patch);
    return ok(updated);
  }

  @Tool({
    name: 'list_template_files',
    topic: ToolTopics.Templates,
    title: 'List template files',
    template: 'List the files of the template «name»',
    description:
      "List files stored in a template's S3 prefix (templates/{id}/). These are " +
      'seeded into every new agent that uses this template.',
    parameters: z.object({ id: z.string() }),
  })
  async listTemplateFiles(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const template = await this.templates.findById(id);
    if (!template) return ok({ error: `Template ${id} not found` });
    return ok(await this.templateFiles.list(id));
  }

  @Tool({
    name: 'read_template_file',
    topic: ToolTopics.Templates,
    title: 'Read a template file',
    template: 'Show «path» of the template «name»',
    description:
      'Read a single template file by relative path (e.g. ".agent/SOUL.md", ' +
      '".paddock/config.json"). Files larger than 256 KiB are rejected.',
    parameters: z.object({
      id: z.string(),
      path: z
        .string()
        .describe('Relative path inside the template, no leading "/"'),
    }),
  })
  async readTemplateFile(
    { id, path }: { id: string; path: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const template = await this.templates.findById(id);
    if (!template) return ok({ error: `Template ${id} not found` });
    return ok(await this.templateFiles.read(id, path));
  }

  @Tool({
    name: 'write_template_file',
    topic: ToolTopics.Templates,
    title: 'Write a template file',
    template: 'Write «path» in the template «name» with: «content»',
    description:
      'Write or replace a template file. Only `.md` and `.json` are accepted. ' +
      'Use this to add files like ".agent/SOUL.md" or ".paddock/config.json" ' +
      'that every new agent created from this template will inherit.',
    parameters: z.object({
      id: z.string(),
      path: z.string(),
      content: z.string(),
    }),
  })
  async writeTemplateFile(
    {
      id,
      path,
      content,
    }: {
      id: string;
      path: string;
      content: string;
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const template = await this.templates.findById(id);
    if (!template) return ok({ error: `Template ${id} not found` });
    await this.templateFiles.save(id, path, content);
    await this.templates.touch(id);
    return ok({ ok: true, templateId: id, path });
  }

  // ─── LLM credentials ─────────────────────────────────────────────────

  @Tool({
    name: 'list_llms',
    topic: ToolTopics.Llm,
    title: 'List LLM credentials',
    template: 'List the LLM credentials',
    description:
      'List configured LLM credentials (provider, model, status). Keys are never returned.',
    parameters: z.object({}),
  })
  async listLlms(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(stripSecrets(await this.llms.findAll()));
  }

  // ─── Skills ──────────────────────────────────────────────────────────

  @Tool({
    name: 'list_skills',
    topic: ToolTopics.Skills,
    title: 'List skills',
    template: 'List all skills',
    description:
      'List skills available in the Ranch. Skills are bundles of instructions + helper files attached to templates.',
    parameters: z.object({}),
  })
  async listSkills(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.skills.findAll());
  }

  @Tool({
    name: 'update_skill',
    topic: ToolTopics.Skills,
    title: 'Update a skill',
    template: 'Change the skill «name»: «what to change»',
    description:
      'Edit a skill in place. Pass only the fields you want to change. ' +
      'Skills are baked into agent pods at deploy time — after editing, ' +
      'call `redeploy_skill_agents` so running agents pick up the new body.',
    parameters: z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      body: z
        .string()
        .optional()
        .describe('Full SKILL.md markdown body — replaces existing content.'),
    }),
  })
  async updateSkill(
    {
      id,
      ...patch
    }: {
      id: string;
      title?: string;
      description?: string;
      body?: string;
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const skill = await this.skills.findById(id);
    if (!skill) return ok({ error: `Skill ${id} not found` });
    const updated = await this.skills.update(id, patch);
    return ok(updated);
  }

  @Tool({
    name: 'list_skill_agents',
    topic: ToolTopics.Skills,
    title: 'Which agents use a skill',
    template: 'Which agents use the skill «name»?',
    description:
      'List agents currently using this skill (via their template). Use this ' +
      'before `redeploy_skill_agents` to preview what will be restarted.',
    parameters: z.object({
      skillId: z.string(),
    }),
  })
  async listSkillAgents(
    { skillId }: { skillId: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.skills.findDependentAgents(skillId));
  }

  @Tool({
    name: 'redeploy_skill_agents',
    topic: ToolTopics.Skills,
    title: 'Redeploy agents of a skill',
    template: 'Redeploy every agent that uses the skill «name»',
    destructive: true,
    description:
      'Restart every agent whose template includes this skill so it picks up ' +
      "the edited SKILL.md. Each agent's workflow is cancelled and resubmitted " +
      '(template files + skills resynced from DB). Sequential with concurrency 3 ' +
      'to avoid slamming the cluster. Returns aggregate counts and per-agent errors. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      skillId: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async redeploySkillAgents(
    args: { skillId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const { skillId } = args;
    const skill = await this.skills.findById(skillId);
    if (!skill) return ok({ error: `Skill ${skillId} not found` });

    const dependents = await this.skills.findDependentAgents(skillId);
    if (dependents.length === 0) {
      return ok({ skillId, total: 0, restarted: 0, failed: 0, errors: [] });
    }
    const refusal = confirmed(
      args,
      `restart ${dependents.length} agent(s) that use the skill «${skill.title ?? skillId}»`,
    );
    if (refusal) return refusal;

    const CONCURRENCY = 3;
    const errors: { agentId: string; error: string }[] = [];
    let index = 0;
    let restarted = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      while (index < dependents.length) {
        const dep = dependents[index++];
        try {
          await this.agentDeploy.restartAgent(dep.id);
          restarted += 1;
        } catch (err) {
          failed += 1;
          errors.push({ agentId: dep.id, error: (err as Error).message });
          this.logger.warn(
            `redeploy_skill_agents ${skillId}: agent ${dep.id} failed — ${(err as Error).message}`,
          );
        }
      }
    };

    const workers = Math.min(CONCURRENCY, dependents.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));

    return ok({
      skillId,
      total: dependents.length,
      restarted,
      failed,
      errors,
    });
  }

  // ─── Files (per-agent) ───────────────────────────────────────────────
  // `list_agent_files`, `read_agent_file` and `write_agent_file` moved to
  // `agent/file/file.tool.ts` (CLEAN-112): reads use the same slices as the
  // console and writes go through a proposal the person approves first.

  // ─── Usage ───────────────────────────────────────────────────────────

  @Tool({
    name: 'agent_usage',
    topic: ToolTopics.ChatsUsage,
    title: 'Usage of an agent',
    template: 'How much did the agent «name» cost in the last «30» days?',
    description: 'Recent token usage records for an agent (default 30 days).',
    parameters: z.object({
      agentId: z.string(),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('How many days back to fetch (default: 30).'),
    }),
  })
  async agentUsage(
    { agentId, days }: { agentId: string; days?: number },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    return ok(await this.usage.findRecentForAgent(agentId, days ?? 30));
  }

  // ─── Settings ────────────────────────────────────────────────────────

  @Tool({
    name: 'list_settings',
    topic: ToolTopics.Settings,
    title: 'List settings',
    template: 'Show the settings in «group»',
    // The catalogue rides in the description so tools/list already tells the
    // model which keys exist — a setting is a free-form row, and a guessed
    // key would be saved as a row nothing reads (CLEAN-109).
    description:
      'List all platform settings, optionally filtered by group (e.g. integrations, agent_defaults, auth).' +
      '\n\n' +
      describeSettingCatalog(),
    parameters: z.object({
      group: z.string().optional(),
    }),
  })
  async listSettings(
    { group }: { group?: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const rows = group
      ? await this.settings.findByGroup(group)
      : await this.settings.findAll();
    // Password-type settings (bot tokens, S3 secrets, the knowledge api key)
    // are catalogued as secret; the list says whether they are set, never
    // what they hold (FR-004).
    return ok(
      rows.map((row) =>
        findSettingDefinition(row.group, row.name)?.secret
          ? {
              ...row,
              value:
                row.value === null || row.value === undefined || row.value === ''
                  ? '(secret — empty)'
                  : '(secret — set)',
            }
          : row,
      ),
    );
  }

  @Tool({
    name: 'upsert_setting',
    topic: ToolTopics.Settings,
    title: 'Set a setting',
    template: 'Set «group».«name» to «value»',
    description:
      'Create or replace a setting by group/name. Use valueType="string" for plain strings, "json" for everything else. ' +
      'Unknown keys are accepted, as in the console, but nothing reads them — prefer a key from the list below.' +
      '\n\n' +
      describeSettingCatalog(),
    parameters: z.object({
      group: z.string(),
      name: z.string(),
      value: z
        .unknown()
        .describe(
          'Setting value — string for valueType=string, any JSON otherwise.',
        ),
      valueType: z.enum(['string', 'json']).optional().default('string'),
    }),
  })
  async upsertSetting(
    {
      group,
      name,
      value,
      valueType,
    }: {
      group: string;
      name: string;
      value: unknown;
      valueType?: 'string' | 'json';
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const saved = await this.settings.upsert(group, name, {
      value,
      valueType: valueType ?? 'string',
    });
    if (findSettingDefinition(group, name)) return ok(saved);
    // Saved anyway (the console allows any key), but say what it probably
    // should have been, so a typo does not silently become a dead row.
    const near = nearestSettingDefinition(group, name);
    return ok({
      ...saved,
      ...(near && { nearestKey: `${near.group}.${near.name}` }),
      hint: near
        ? `«${group}.${name}» is not a key the platform reads — did you mean «${near.group}.${near.name}» (${near.description})?`
        : `«${group}.${name}» is not a key the platform reads; it is saved but nothing uses it.`,
    });
  }
}
