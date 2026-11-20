import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  agentNotFound,
  callerIsOperator,
  callerIsOwner,
  callerParty,
  callerPerson,
  CONFIRM_SENTENCE,
  confirmed,
  manageCaller,
  ok,
  requireOperator,
  requireOwner,
  requirePersonOrOperator,
  stripSecrets,
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import { toReaderView } from '#/agent/agent/domain/agentReaderView';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { IAgentGateway } from '#/agent/agent/domain';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { AgentDeployService } from '#/agent/agent/domain/agentDeploy.service';
import { ITemplateGateway } from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import { ILlmGateway } from '#/llm/domain';
import { ISkillGateway, SKILL_GROUPS, type SkillGroup } from '#/skill/domain';
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
import { rancherStatusFor } from './domain/rancherStatusView';
import { SHARE_DESCRIPTION_MAX } from '#/agent/shareLink/domain';

/**
 * The agent's config with its description set, or removed when there is none.
 * The description is one key of a bag the pod also reads, so everything else
 * in it is carried over untouched.
 */
function withDescription(
  config: Record<string, unknown> | null | undefined,
  description: string | null,
): Record<string, unknown> {
  const { description: _previous, ...rest } = config ?? {};
  const text = description?.trim();
  return text ? { ...rest, description: text } : rest;
}

/**
 * The original Ranch management tools — agents, templates, skills, LLM
 * credentials, files, usage, settings. Audience `admin`: every console
 * route these mirror admits Owner and Admin, or states no role at all. The
 * check is the shared `requireOperator`, which since CLEAN-232 asks who the
 * call is made for, not only what the agent's token carries. The class has
 * no listing hook of its own; the audience hides it from everyone else.
 *
 * Three tools differ from the class (CLEAN-232). `restart_agent` and
 * `update_agent` act on one agent and are `manage-agent`: each call asks
 * `AgentPermissionService` about the agent it names and answers "not found"
 * for one the caller may not manage. `set_agent_admin` is `owner`, like the
 * console route. `create_agent` stays `admin` and records who created the
 * agent.
 *
 * `list_agents` and `get_agent` are `reader` (CLEAN-231): any signed-in
 * person, as well as an operator. They show a caller the agents their
 * access lists reach, each as that caller may read it, which is what lets a
 * User turn a name into an id for the tools they do have.
 */
@ToolAudience('admin')
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
    private readonly permission: AgentPermissionService,
    private readonly access: AgentAccessService,
    private readonly pins: IAgentPinGateway,
  ) {}

  /**
   * Agents as this caller reads them through `list_agents` and `get_agent`
   * (CLEAN-231), the way `GET /agents` answers the same person: whole for a
   * caller who may manage the agent, its reader view otherwise (no config,
   * no credential or knowledge binding, no deploy history), `pinned` as the
   * person's own pin, and the bare creator id for operators only.
   */
  private async asReadBy(agents: IAgentData[], httpRequest: Request) {
    const caller = manageCaller(httpRequest);
    const person = callerPerson(httpRequest);
    const pinned =
      person && agents.length > 0
        ? await this.pins.pinnedIds(person.userId)
        : new Set<string>();
    const operator = callerIsOperator(httpRequest);
    return Promise.all(
      agents.map(async (agent) => {
        const view = (await this.permission.canManage(caller, agent))
          ? agent
          : toReaderView(agent);
        const { createdById, ...rest } = view;
        return {
          ...rest,
          pinned: pinned.has(agent.id),
          ...(operator ? { createdById } : {}),
        };
      }),
    );
  }

  // ─── Platform ────────────────────────────────────────────────────────

  @Tool({
    name: 'get_rancher_status',
    topic: ToolTopics.Platform,
    title: 'Rancher setup status',
    template: 'Is the Rancher setup complete?',
    description:
      'The Rancher setup wizard state: is there an LLM credential, the special Rancher template, an admin agent (`hasAdmin`), and S3 configured. `admin` is the Ranch admin agent as the person asking may read it: absent for somebody who has no access to it, without its configuration for an Admin. Read-only; the console shows the same stepper.',
    parameters: z.object({}),
  })
  async getRancherStatus(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    requireOperator(httpRequest);
    const status = await this.rancher.getStatus();
    // The same rule as GET /rancher/status (CLEAN-231): the agent is named
    // by its flag, so the lists and the manage rule are asked here.
    let reaches = false;
    let manages = false;
    if (status.admin) {
      reaches = await this.access.reaches(
        callerParty(httpRequest),
        status.admin.id,
      );
      manages =
        reaches &&
        (await this.permission.canManage(
          manageCaller(httpRequest),
          status.admin,
        ));
    }
    return ok(rancherStatusFor(status, { reaches, manages }));
  }

  // ─── Agents ──────────────────────────────────────────────────────────

  @ToolAudience('reader')
  @Tool({
    name: 'list_agents',
    topic: ToolTopics.Agents,
    title: 'List agents',
    template: 'List all agents and their status',
    description:
      'List the agents the person asking can use, with their id, name, ' +
      'status, template and resources, and whether that person pinned ' +
      'them. Use it to turn a name into the id the other tools take. An ' +
      'agent the person may manage comes with its configuration; any ' +
      'other comes without it. Agents the person has no access to are not ' +
      'listed at all: do not assume there are others.',
    parameters: z.object({}),
  })
  async listAgents(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    requirePersonOrOperator(httpRequest);
    const reach = await this.access.reachableIds(callerParty(httpRequest));
    const items = reach.filter(await this.agents.findAll(), (a) => a.id);
    return ok(await this.asReadBy(items, httpRequest));
  }

  @ToolAudience('reader')
  @Tool({
    name: 'get_agent',
    topic: ToolTopics.Agents,
    title: 'Show an agent',
    template: 'Show the agent «name»',
    description:
      'Get a single agent by id, among the ones the person asking can use: ' +
      'current status, template and resources, and for a person who may ' +
      'manage it also its workflowId and config.',
    parameters: z.object({
      id: z.string().describe('Agent id, e.g. agent-abc123'),
    }),
  })
  async getAgent(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    requirePersonOrOperator(httpRequest);
    const agent = await this.agents.findById(id);
    // One answer for an agent that does not exist and one this person's
    // access lists hide.
    if (
      !agent ||
      !(await this.access.reaches(callerParty(httpRequest), agent.id))
    ) {
      return agentNotFound(httpRequest, id);
    }
    return ok((await this.asReadBy([agent], httpRequest))[0]);
  }

  @ToolAudience('manage-agent')
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
    const agent = await this.permission.manageable(
      manageCaller(httpRequest),
      id,
    );
    if (!agent) return agentNotFound(httpRequest, id);
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
    requireOperator(httpRequest);
    // Which agent is the Ranch admin agent is the Owner's decision, here as
    // on set_agent_admin and on the console route (CLEAN-232).
    if (isAdmin === true && !callerIsOwner(httpRequest)) {
      return ok({
        error:
          'Only the Owner can make an agent the Ranch admin agent. Create ' +
          'it without isAdmin; the Owner can promote it afterwards.',
      });
    }
    // Friendly precheck — a bad templateId would otherwise surface as an
    // opaque foreign-key error from the DB layer.
    const template = await this.templates.findById(templateId);
    if (!template) {
      return ok({
        error: `Template ${templateId} not found — pick one from list_templates`,
      });
    }
    // The creator is the person this call is made for, as the acting token
    // proved them; a trusted party (the agent on its own schedule) leaves
    // none. Written once, here: update_agent cannot change it.
    const created = await this.agentDeploy.createAgent(
      {
        name,
        templateId,
        llmCredentialId,
        knowledgeIds,
        createdById: callerPerson(httpRequest)?.userId ?? null,
      },
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

  @ToolAudience('manage-agent')
  @Tool({
    name: 'update_agent',
    topic: ToolTopics.Agents,
    title: 'Update an agent',
    template: 'Change the agent «name»: «what to change»',
    description:
      'Update an agent: rename, describe, switch LLM credential, or bind ' +
      'knowledge bases. knowledgeIds REPLACES the full list (fetch current via ' +
      'get_agent first). Binding/credential changes apply on the next ' +
      'restart — offer restart_agent.',
    parameters: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z
        .string()
        .max(SHARE_DESCRIPTION_MAX)
        .nullable()
        .optional()
        .describe(
          'What the agent is for, in a sentence or two. Shown on its A2A ' +
            'card and to people who open its share link. null or empty ' +
            "falls back to the template's description",
        ),
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
      description,
      llmCredentialId,
      knowledgeIds,
    }: {
      id: string;
      name?: string;
      description?: string | null;
      llmCredentialId?: string | null;
      knowledgeIds?: string[];
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    const existing = await this.permission.manageable(
      manageCaller(httpRequest),
      id,
    );
    if (!existing) return agentNotFound(httpRequest, id);
    const updated = await this.agents.update(id, {
      name,
      llmCredentialId,
      knowledgeIds,
      ...(description !== undefined && {
        config: withDescription(existing.config, description),
      }),
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

  @ToolAudience('owner')
  @Tool({
    name: 'set_agent_admin',
    topic: ToolTopics.Agents,
    title: 'Make an agent the Ranch admin',
    template: 'Make «name» the Ranch admin agent',
    description:
      'Promote or demote an agent to/from Ranch admin. Owner only: the Ranch admin agent holds Owner power. Single-admin invariant: enabling clears the flag from any other agent.',
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
    requireOwner(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
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
      group: z
        .enum(SKILL_GROUPS)
        .nullable()
        .optional()
        .describe(
          'Library group on the admin Skills page (api, routing, spec-lookup, answer-format, runtime); null clears it.',
        ),
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
      group?: SkillGroup | null;
    },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    requireOperator(httpRequest);
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
    requireOperator(httpRequest);
    // Only the agents the caller reaches (CLEAN-231): the list names them.
    const reach = await this.access.reachableIds(callerParty(httpRequest));
    return ok(
      reach.filter(await this.skills.findDependentAgents(skillId), (a) => a.id),
    );
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
      'An agent the person may not manage is left running and only counted (`skipped`). ' +
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
    requireOperator(httpRequest);
    const { skillId } = args;
    const skill = await this.skills.findById(skillId);
    if (!skill) return ok({ error: `Skill ${skillId} not found` });

    const using = await this.skills.findDependentAgents(skillId);
    // Restarting an agent is managing it (CLEAN-232): an Admin redeploying a
    // skill must not restart the Ranch admin agent along with it. What was
    // left out is counted, never named.
    const caller = manageCaller(httpRequest);
    const manageable = await Promise.all(
      using.map((dep) => this.permission.manageable(caller, dep.id)),
    );
    const dependents = using.filter((_, i) => manageable[i] !== null);
    const skipped = using.length - dependents.length;
    if (dependents.length === 0) {
      return ok({
        skillId,
        total: 0,
        restarted: 0,
        failed: 0,
        skipped,
        errors: [],
      });
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
      skipped,
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
    requireOperator(httpRequest);
    if (
      !(await this.agents.findById(agentId)) ||
      !(await this.access.reaches(callerParty(httpRequest), agentId))
    ) {
      return agentNotFound(httpRequest, agentId);
    }
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
    requireOperator(httpRequest);
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
                row.value === null ||
                row.value === undefined ||
                row.value === ''
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
    requireOperator(httpRequest);
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
