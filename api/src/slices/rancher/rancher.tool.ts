import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { ILlmGateway } from '#/llm/domain';
import { ISkillGateway } from '#/skill/domain';
import { ISettingGateway } from '#/setting/domain';
import { IUsageGateway } from '#/usage/domain';
import { IFileGateway } from '#/agent/file/domain';

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const ok = (value: unknown) => ({
  content: [{ type: 'text' as const, text: asText(value) }],
});

@Injectable()
export class RancherTool {
  private readonly logger = new Logger(RancherTool.name);

  constructor(
    private readonly agents: IAgentGateway,
    private readonly templates: ITemplateGateway,
    private readonly llms: ILlmGateway,
    private readonly skills: ISkillGateway,
    private readonly settings: ISettingGateway,
    private readonly usage: IUsageGateway,
    private readonly files: IFileGateway,
  ) {}

  // ─── Agents ──────────────────────────────────────────────────────────

  @Tool({
    name: 'list_agents',
    description: 'List every agent on this Ranch with their status, template, and resources.',
    parameters: z.object({}),
  })
  async listAgents() {
    const items = await this.agents.findAll();
    return ok(items);
  }

  @Tool({
    name: 'get_agent',
    description: 'Get a single agent by id, including current status, workflowId and config.',
    parameters: z.object({
      id: z.string().describe('Agent id, e.g. agent-abc123'),
    }),
  })
  async getAgent({ id }: { id: string }) {
    const agent = await this.agents.findById(id);
    if (!agent) return ok({ error: `Agent ${id} not found` });
    return ok(agent);
  }

  @Tool({
    name: 'restart_agent',
    description: 'Restart an agent pod. Use after editing its files or LLM credential to apply changes.',
    parameters: z.object({
      id: z.string(),
    }),
  })
  async restartAgent({ id }: { id: string }) {
    const agent = await this.agents.findById(id);
    if (!agent) return ok({ error: `Agent ${id} not found` });
    await this.agents.updateStatus(id, 'deploying');
    return ok({ ok: true, agentId: id, message: 'Restart queued — workflow controller will reconcile.' });
  }

  @Tool({
    name: 'set_agent_admin',
    description: 'Promote or demote an agent to/from Ranch admin. Single-admin invariant: enabling clears the flag from any other agent.',
    parameters: z.object({
      id: z.string(),
      enabled: z.boolean(),
    }),
  })
  async setAgentAdmin({ id, enabled }: { id: string; enabled: boolean }) {
    const updated = await this.agents.setAdmin(id, enabled);
    return ok(updated);
  }

  // ─── Templates ───────────────────────────────────────────────────────

  @Tool({
    name: 'list_templates',
    description: 'List all agent templates (image + defaults that pods are spawned from).',
    parameters: z.object({}),
  })
  async listTemplates() {
    return ok(await this.templates.findAll());
  }

  @Tool({
    name: 'get_template',
    description: 'Get a template by id, including image, defaultResources, and attached skill ids.',
    parameters: z.object({ id: z.string() }),
  })
  async getTemplate({ id }: { id: string }) {
    const template = await this.templates.findById(id);
    return ok(template ?? { error: `Template ${id} not found` });
  }

  @Tool({
    name: 'set_template_skills',
    description: 'Replace the full set of skills attached to a template. The list is exhaustive — omitted ids are detached.',
    parameters: z.object({
      id: z.string(),
      skillIds: z.array(z.string()),
    }),
  })
  async setTemplateSkills({ id, skillIds }: { id: string; skillIds: string[] }) {
    return ok(await this.templates.setSkills(id, skillIds));
  }

  // ─── LLM credentials ─────────────────────────────────────────────────

  @Tool({
    name: 'list_llms',
    description: 'List configured LLM credentials (provider, model, status).',
    parameters: z.object({}),
  })
  async listLlms() {
    return ok(await this.llms.findAll());
  }

  // ─── Skills ──────────────────────────────────────────────────────────

  @Tool({
    name: 'list_skills',
    description: 'List skills available in the Ranch. Skills are bundles of instructions + helper files attached to templates.',
    parameters: z.object({}),
  })
  async listSkills() {
    return ok(await this.skills.findAll());
  }

  // ─── Files (per-agent) ───────────────────────────────────────────────

  @Tool({
    name: 'list_agent_files',
    description: "List files in an agent's S3 prefix (the files mounted into its pod's `.agent/` dir).",
    parameters: z.object({ agentId: z.string() }),
  })
  async listAgentFiles({ agentId }: { agentId: string }) {
    return ok(await this.files.list(agentId));
  }

  @Tool({
    name: 'read_agent_file',
    description: "Read a single agent file by relative path (e.g. SOUL.md, MEMORY.md, agent.config.json).",
    parameters: z.object({
      agentId: z.string(),
      path: z.string(),
    }),
  })
  async readAgentFile({ agentId, path }: { agentId: string; path: string }) {
    return ok(await this.files.read(agentId, path));
  }

  @Tool({
    name: 'write_agent_file',
    description: 'Write or replace an agent file. Only `.md` and `.json` are supported. Restart the agent for changes to take effect.',
    parameters: z.object({
      agentId: z.string(),
      path: z.string(),
      content: z.string(),
    }),
  })
  async writeAgentFile({ agentId, path, content }: { agentId: string; path: string; content: string }) {
    await this.files.save(agentId, path, content);
    return ok({ ok: true, agentId, path });
  }

  // ─── Usage ───────────────────────────────────────────────────────────

  @Tool({
    name: 'agent_usage',
    description: 'Recent token usage records for an agent (default 30 days).',
    parameters: z.object({
      agentId: z.string(),
      days: z.number().int().positive().optional().describe('How many days back to fetch (default: 30).'),
    }),
  })
  async agentUsage({ agentId, days }: { agentId: string; days?: number }) {
    return ok(await this.usage.findRecentForAgent(agentId, days ?? 30));
  }

  // ─── Settings ────────────────────────────────────────────────────────

  @Tool({
    name: 'list_settings',
    description: 'List all platform settings, optionally filtered by group (e.g. integrations, agent_defaults, auth).',
    parameters: z.object({
      group: z.string().optional(),
    }),
  })
  async listSettings({ group }: { group?: string }) {
    if (group) return ok(await this.settings.findByGroup(group));
    return ok(await this.settings.findAll());
  }

  @Tool({
    name: 'upsert_setting',
    description: 'Create or replace a setting by group/name. Use valueType="string" for plain strings, "json" for everything else.',
    parameters: z.object({
      group: z.string(),
      name: z.string(),
      value: z.unknown().describe('Setting value — string for valueType=string, any JSON otherwise.'),
      valueType: z.enum(['string', 'json']).optional().default('string'),
    }),
  })
  async upsertSetting({
    group,
    name,
    value,
    valueType,
  }: {
    group: string;
    name: string;
    value: unknown;
    valueType?: 'string' | 'json';
  }) {
    return ok(
      await this.settings.upsert(group, name, {
        value,
        valueType: valueType ?? 'string',
      }),
    );
  }
}
