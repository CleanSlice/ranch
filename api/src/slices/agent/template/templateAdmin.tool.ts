import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { AgentDeployService } from '#/agent/agent/domain/agentDeploy.service';
import { ITemplateGateway } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * How many agents restart at once in `restart_template_agents`. The same cap
 * as `AgentController.restartByTemplate` — one template can own dozens of
 * agents, and redeploying them all in one burst would swamp the cluster.
 */
const RESTART_CONCURRENCY = 5;

const NOT_FOUND = (id: string) =>
  ok({
    error: `Template ${id} not found — call list_templates to find the id`,
  });

/**
 * The template capabilities the console has and `rancher.tool.ts` lacks
 * (CLEAN-109): create, delete, attach MCP servers, restart every agent of a
 * template. Listing, reading, updating, skills and template files stay in
 * `rancher.tool.ts` — this class only fills the gap.
 *
 * Every call goes through the gateways `TemplateController` and
 * `AgentController` use, and keeps their rules: a template still used by
 * agents cannot be deleted, and a restart-by-template redeploys with the
 * same concurrency cap and reports the same counts.
 *
 * Operator only. A plain agent does not see these tools and cannot call them
 * by name either (`requireOperator` on every method).
 */
@Injectable()
export class TemplateAdminTool implements IConditionallyListedTool {
  private readonly logger = new Logger(TemplateAdminTool.name);

  constructor(
    private templates: ITemplateGateway,
    // AgentModule imports TemplateModule, so the way back is a cycle —
    // forwardRef on both the module import and these two injections.
    @Inject(forwardRef(() => IAgentGateway))
    private agents: IAgentGateway,
    @Inject(forwardRef(() => AgentDeployService))
    private agentDeploy: AgentDeployService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return callerIsOperator(httpRequest);
  }

  @Tool({
    name: 'create_template',
    topic: ToolTopics.Templates,
    title: 'Create a template',
    template:
      'Create a template «name» with image «image» described as «description»',
    description:
      'Create an agent template: the container image and defaults that ' +
      'agents are spawned from. Returns the new template with its id. ' +
      'Attach skills with set_template_skills and MCP servers with ' +
      'set_template_mcps, then create_agent from it.',
    parameters: z.object({
      name: z.string(),
      description: z.string(),
      image: z
        .string()
        .describe('Container image, e.g. ghcr.io/org/agent:latest'),
      defaultConfig: z.record(z.unknown()).optional(),
      defaultResources: z
        .object({ cpu: z.string(), memory: z.string() })
        .optional(),
      paddockConfig: z.record(z.unknown()).optional(),
      defaultKnowledgeIds: z
        .array(z.string())
        .optional()
        .describe('Knowledge base ids new agents get by default'),
    }),
  })
  async createTemplate(
    args: {
      name: string;
      description: string;
      image: string;
      defaultConfig?: Record<string, unknown>;
      defaultResources?: { cpu: string; memory: string };
      paddockConfig?: Record<string, unknown>;
      defaultKnowledgeIds?: string[];
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const template = await this.templates.create(args);
    this.logger.log(`Template created through MCP: ${template.id}`);
    return ok({
      ok: true,
      template,
      message:
        `Template «${template.name}» created. Attach skills with ` +
        'set_template_skills, MCP servers with set_template_mcps, then ' +
        `create_agent with templateId=${template.id}.`,
    });
  }

  @Tool({
    name: 'delete_template',
    topic: ToolTopics.Templates,
    title: 'Delete a template',
    template: 'Delete the template «name»',
    destructive: true,
    description:
      'Delete a template. Refused while agents still use it — delete or ' +
      'move those agents first (list_agents shows which template each one ' +
      'uses). Resolve the id with list_templates. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteTemplate(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const template = await this.templates.findById(args.id);
    if (!template) return NOT_FOUND(args.id);
    const refusal = confirmed(args, `delete the template «${template.name}»`);
    if (refusal) return refusal;
    // Same rule as the console: a template with agents on it stays.
    const agentCount = await this.templates.countAgents(args.id);
    if (agentCount > 0) {
      return err(
        `Cannot delete template «${template.name}» — ${agentCount} agent` +
          `${agentCount === 1 ? '' : 's'} still using it. Delete those ` +
          'agents (delete_agent) or move them to another template first; ' +
          'list_agents shows which ones they are.',
      );
    }
    await this.templates.delete(args.id);
    this.logger.log(`Template deleted through MCP: ${args.id}`);
    return ok({ id: args.id, message: `Template «${template.name}» deleted.` });
  }

  @Tool({
    name: 'set_template_mcps',
    topic: ToolTopics.Templates,
    title: 'Attach MCP servers to a template',
    template: 'Attach the MCP servers «server list» to the template «name»',
    description:
      'Replace the full set of MCP servers attached to a template. The list ' +
      'is exhaustive — omitted ids are detached (get_template shows the ' +
      'current mcpServerIds, list_mcp_servers the available servers). Agents ' +
      'read the set at deploy time, so existing agents of the template see ' +
      'the change only after restart_template_agents.',
    parameters: z.object({
      id: z.string(),
      mcpServerIds: z
        .array(z.string())
        .describe(
          'FULL desired list of MCP server ids (replaces, not appends)',
        ),
    }),
  })
  async setTemplateMcps(
    { id, mcpServerIds }: { id: string; mcpServerIds: string[] },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const template = await this.templates.findById(id);
    if (!template) return NOT_FOUND(id);
    const updated = await this.templates.setMcps(id, mcpServerIds);
    return ok({
      template: updated,
      message:
        `Template «${updated.name}» now has ${mcpServerIds.length} MCP ` +
        `server${mcpServerIds.length === 1 ? '' : 's'}. Agents inherit the ` +
        'set when they deploy, so running agents of this template keep the ' +
        `old one until restart_template_agents with templateId=${id}.`,
    });
  }

  @Tool({
    name: 'restart_template_agents',
    topic: ToolTopics.Templates,
    title: 'Restart every agent of a template',
    template: 'Restart all agents of the template «name»',
    destructive: true,
    description:
      'Restart every agent that uses a template: each one pulls the latest ' +
      'template-owned files and redeploys, keeping its runtime state. At ' +
      'most 5 restart at once. Returns how many restarted, failed and were ' +
      'found in total. Interrupts running conversations on those agents. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      templateId: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async restartTemplateAgents(
    args: { templateId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { templateId } = args;
    const template = await this.templates.findById(templateId);
    if (!template) return NOT_FOUND(templateId);
    const refusal = confirmed(
      args,
      `restart every agent of the template «${template.name}»`,
    );
    if (refusal) return refusal;

    const agents = await this.agents.findByTemplateId(templateId);
    if (agents.length === 0) {
      return ok({
        restarted: 0,
        failed: 0,
        total: 0,
        message: `No agents use template «${template.name}» — nothing to restart.`,
      });
    }

    // Mirrors AgentController.restartByTemplate: a small worker pool over the
    // agent list, one failure never stops the others.
    let index = 0;
    let restarted = 0;
    let failed = 0;
    const worker = async (): Promise<void> => {
      while (index < agents.length) {
        const agent = agents[index++];
        try {
          await this.agentDeploy.restartAgent(agent.id);
          restarted += 1;
        } catch (e) {
          failed += 1;
          this.logger.warn(
            `Restart-by-template ${templateId}: agent ${agent.id} failed — ${(e as Error).message}`,
          );
        }
      }
    };
    const workers = Math.min(RESTART_CONCURRENCY, agents.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));

    this.logger.log(
      `Restart-by-template ${templateId} through MCP: ${restarted} restarted, ${failed} failed of ${agents.length} total`,
    );
    return ok({
      restarted,
      failed,
      total: agents.length,
      message:
        `${restarted} of ${agents.length} agent${agents.length === 1 ? '' : 's'} ` +
        `of template «${template.name}» restarting` +
        (failed > 0
          ? `; ${failed} failed — get_agent_status on each to see why, then restart_agent one by one.`
          : '. They will boot shortly; get_agent_status to follow.'),
    });
  }
}
