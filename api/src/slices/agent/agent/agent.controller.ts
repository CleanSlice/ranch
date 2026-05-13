import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  NotFoundException,
  Logger,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { IAgentGateway } from './domain';
import { AgentStatusTypes } from './domain/agent.types';
import { AgentStatusService } from './domain/agentStatus.service';
import { AgentDeployService } from './domain/agentDeploy.service';
import {
  AgentMcpDto,
  AgentStatusDto,
  CreateAgentDto,
  SetAgentDebugDto,
  UpdateAgentDto,
} from './dtos';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IWorkflowStatus } from '#/workflow/domain/workflow.types';
import { ITemplateGateway } from '#/agent/template/domain';
import { IPodGateway } from '#/agent/pod/domain';
import { IFileGateway } from '#/agent/file/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IMcpServerGateway, IMcpServerData } from '#/mcpServer/domain';
import { KNOWLEDGE_MCP_ID } from '#/mcpServer/domain/mcpServer.seeder';
import { IKnowledgeGateway } from '#/reins/knowledge/domain';
import { IKnowledgeConfigGateway } from '#/reins/config/domain';
import { JwtAuthGuard, Public, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

// Workflow ends as soon as the pod hits phase=Running, but pod=Running does
// not mean the agent inside is ready (channels connected, S3 pulled, HTTP up).
// Keep status at 'deploying' even on Succeeded — AgentStatusService.reconcile
// promotes to 'running' when the readiness probe passes (port 3000 served).
const PHASE_TO_STATUS: Record<IWorkflowStatus['phase'], AgentStatusTypes> = {
  Pending: 'deploying',
  Running: 'deploying',
  Succeeded: 'deploying',
  Failed: 'failed',
  Error: 'failed',
};

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private agentGateway: IAgentGateway,
    private templateGateway: ITemplateGateway,
    private workflowService: WorkflowService,
    private podGateway: IPodGateway,
    private agentStatusService: AgentStatusService,
    private bridleHub: IBridleGateway,
    private fileGateway: IFileGateway,
    private mcpServerGateway: IMcpServerGateway,
    private agentDeployService: AgentDeployService,
    private knowledgeGateway: IKnowledgeGateway,
    private knowledgeConfig: IKnowledgeConfigGateway,
  ) {}

  private deploy(agentId: string): Promise<void> {
    return this.agentDeployService.deploy(agentId);
  }

  private async syncStatus(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.workflowId) return agent;
    // Forward-only: only flip to 'failed' (terminal) here. We never demote
    // 'running' back to 'deploying' on a Pending workflow phase — pod-event
    // reconciler owns the running/deploying transitions and a workflow can
    // briefly look Pending while a pod is already up.
    try {
      const { phase } = await this.workflowService.getWorkflowStatus(
        agent.workflowId,
      );
      const mapped = PHASE_TO_STATUS[phase];
      if (mapped === 'failed' && agent.status !== 'failed') {
        await this.agentGateway.updateStatus(
          agentId,
          'failed',
          agent.workflowId,
        );
        return this.agentGateway.findById(agentId);
      }
    } catch {
      // ignore transient workflow fetch errors
    }
    return agent;
  }

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'List all agents. Public — landing/chat pages render without auth. Mutations and details still require login.',
  })
  findAll() {
    return this.agentGateway.findAll();
  }

  @Get('public')
  @Public()
  @ApiOperation({
    summary:
      'List agents flagged as public. Used by the marketing landing page so private agents stay hidden from unauthenticated visitors.',
  })
  findPublic() {
    return this.agentGateway.findPublic();
  }

  @Get('status')
  @Public()
  @ApiOperation({
    summary: 'Snapshot of all agents joined with live pod status. Public.',
  })
  @ApiOkResponse({ type: AgentStatusDto, isArray: true })
  status() {
    return this.agentStatusService.snapshot();
  }

  @Sse('status/stream')
  @Public()
  @ApiOperation({
    summary:
      'Live SSE stream of agent pod state changes. Public — EventSource cannot send Authorization headers.',
  })
  statusStream(): Observable<MessageEvent> {
    return this.agentStatusService
      .stream$()
      .pipe(map((data) => ({ data }) as MessageEvent));
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'Get agent by ID. Public — chat needs agent metadata (name, status) to render.',
  })
  async findById(@Param('id') id: string) {
    const agent = await this.syncStatus(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  @Get(':id/mcps')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin, UserRoleTypes.Agent)
  @ApiOperation({
    operationId: 'getAgentMcps',
    summary:
      "List of MCP servers this agent should connect to at runtime. Resolves the agent's template and returns its enabled MCP attachments. Called by the runtime on boot to populate its tool registry. Tokens with role=Agent (issued to runtimes) can only read their OWN agent — `sub` must match `agent:<id>`.",
  })
  @ApiOkResponse({ type: AgentMcpDto, isArray: true })
  async getMcps(
    @Param('id') id: string,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ): Promise<AgentMcpDto[]> {
    // Self-scope enforcement for agent-issued tokens. The Agent role is only
    // ever attached to JWTs minted by issueAgentServiceToken; the `sub` is
    // `agent:<their-id>`. If the request comes from such a token, the :id
    // param MUST match — otherwise an agent could enumerate its peers' MCPs
    // (and their auth values).
    const sub = req.user?.sub ?? '';
    if (sub.startsWith('agent:') && sub !== `agent:${id}`) {
      throw new ForbiddenException(
        'Agent tokens can only fetch their own MCP list',
      );
    }

    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) return [];

    const baseServers = await this.mcpServerGateway.findByIds(
      template.mcpServerIds,
    );
    const enabledServers = baseServers.filter((s) => s.enabled);

    const effectiveKnowledgeIds =
      agent.knowledgeIds.length > 0
        ? agent.knowledgeIds
        : template.defaultKnowledgeIds;

    if (await this.shouldInjectKnowledge(effectiveKnowledgeIds, enabledServers)) {
      const knowledgeMcp =
        await this.mcpServerGateway.findById(KNOWLEDGE_MCP_ID);
      if (knowledgeMcp && knowledgeMcp.enabled) {
        enabledServers.push(knowledgeMcp);
      }
    }

    return enabledServers.map((s) => ({
      name: s.name,
      transport: s.transport,
      url: s.url,
      authType: s.authType,
      authValue: s.authValue,
      enabled: true,
    }));
  }

  private async shouldInjectKnowledge(
    effectiveKnowledgeIds: string[],
    alreadyAttached: IMcpServerData[],
  ): Promise<boolean> {
    if (effectiveKnowledgeIds.length === 0) return false;
    if (alreadyAttached.some((m) => m.id === KNOWLEDGE_MCP_ID)) return false;
    const isEnabled = await this.knowledgeConfig.isEnabled();
    if (!isEnabled) return false;
    const existing =
      await this.knowledgeGateway.findExistingByIds(effectiveKnowledgeIds);
    return existing.length > 0;
  }

  @Post()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Create and deploy a new agent. Admin or Owner.' })
  async create(@Body() dto: CreateAgentDto) {
    const agent = await this.agentGateway.create(dto);
    try {
      const copied = await this.fileGateway.seedFromTemplate(
        agent.id,
        agent.templateId,
      );
      if (copied > 0) {
        this.logger.log(
          `Seeded ${copied} files into agent ${agent.id} from template ${agent.templateId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Template seed skipped for agent ${agent.id}: ${(err as Error).message}`,
      );
    }
    await this.agentDeployService.syncSkillsFromTemplate(
      agent.id,
      agent.templateId,
    );
    // Promote BEFORE the first deploy so the workflow boots the pod with
    // RANCH_ADMIN=true on the first try — avoids the race of "create deploys
    // non-admin → promote cancels + redeploys" where the cancel sometimes
    // doesn't replace the running pod fast enough.
    if (dto.isAdmin === true) {
      const previous = await this.agentGateway.findAdmin();
      if (previous && previous.id !== agent.id) {
        await this.agentGateway.setAdmin(previous.id, false);
        try {
          await this.workflowService.cancelAgentWorkflow(previous.workflowId);
        } catch (err) {
          this.logger.warn(
            `Cancel workflow failed for previous admin ${previous.id}: ${(err as Error).message}`,
          );
        }
        await this.deploy(previous.id);
      }
      await this.agentGateway.setAdmin(agent.id, true);
    }
    await this.deploy(agent.id);
    return this.agentGateway.findById(agent.id);
  }

  @Put(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Update agent configuration. Admin or Owner.' })
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentGateway.update(id, dto);
  }

  @Patch(':id/debug')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Toggle prompt-debug emission for an agent. Persists to DB and pushes a control event over the bridle WS so the running agent picks it up live without a restart.',
  })
  async setDebug(
    @Param('id') id: string,
    @Body() dto: SetAgentDebugDto,
  ): Promise<{ id: string; debugEnabled: boolean }> {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    const updated = await this.agentGateway.setDebugEnabled(id, dto.enabled);
    this.bridleHub.setDebug(id, dto.enabled);
    return { id: updated.id, debugEnabled: updated.debugEnabled };
  }

  @Get('admin/current')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary: 'Get the agent currently flagged as Ranch admin (or null).',
  })
  findAdmin() {
    return this.agentGateway.findAdmin();
  }

  @Post(':id/promote-admin')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Mark this agent as the Ranch admin. Clears the flag from any other agent (single-admin invariant) and redeploys with RANCH_ADMIN=true + a service token. Any previous admin is redeployed without the flag.',
  })
  async promoteAdmin(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    const previous = await this.agentGateway.findAdmin();
    await this.agentGateway.setAdmin(id, true);
    if (previous && previous.id !== id) {
      try {
        await this.workflowService.cancelAgentWorkflow(previous.workflowId);
      } catch (err) {
        this.logger.warn(
          `Cancel workflow failed for previous admin ${previous.id}: ${(err as Error).message}`,
        );
      }
      await this.deploy(previous.id);
    }
    try {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    } catch (err) {
      this.logger.warn(
        `Cancel workflow failed for agent ${id}: ${(err as Error).message}`,
      );
    }
    await this.deploy(id);
    return this.agentGateway.findById(id);
  }

  @Delete(':id/promote-admin')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Demote this agent from Ranch admin. Redeploys without RANCH_ADMIN.',
  })
  async demoteAdmin(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.agentGateway.setAdmin(id, false);
    try {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    } catch (err) {
      this.logger.warn(
        `Cancel workflow failed for agent ${id}: ${(err as Error).message}`,
      );
    }
    await this.deploy(id);
    return this.agentGateway.findById(id);
  }

  @Post(':id/restart')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Restart an agent. Admin or Owner.' })
  async restart(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.agentDeployService.restartAgent(id);
    return this.agentGateway.findById(id);
  }

  @Post('restart-by-template/:templateId')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'restartByTemplate',
    summary:
      'Restart every agent that uses this template. Pulls latest template-owned files into each agent and redeploys, preserving runtime state. Concurrency capped at 5 to avoid overwhelming the cluster. Admin or Owner.',
  })
  async restartByTemplate(
    @Param('templateId') templateId: string,
  ): Promise<{ restarted: number; failed: number; total: number }> {
    const agents = await this.agentGateway.findByTemplateId(templateId);
    if (agents.length === 0) return { restarted: 0, failed: 0, total: 0 };

    const CONCURRENCY = 5;
    let index = 0;
    let restarted = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      while (index < agents.length) {
        const a = agents[index++];
        try {
          await this.agentDeployService.restartAgent(a.id);
          restarted += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Restart-by-template ${templateId}: agent ${a.id} failed — ${(err as Error).message}`,
          );
        }
      }
    };

    const workers = Math.min(CONCURRENCY, agents.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));

    this.logger.log(
      `Restart-by-template ${templateId}: ${restarted} restarted, ${failed} failed of ${agents.length} total`,
    );

    return { restarted, failed, total: agents.length };
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Stop and delete an agent. Pass `?wipeS3=true` to also drop every object under `agents/{id}/` — opt-in so accidental deletes don’t nuke files. Admin or Owner.',
  })
  async remove(@Param('id') id: string, @Query('wipeS3') wipeS3?: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    // Delete the DB row first so the UI clears immediately. Argo/k8s can be
    // slow or flaky — we don't want a workflow/pod cleanup hiccup to leave
    // the agent stuck in the list.
    await this.agentGateway.delete(id);

    if (agent.workflowId) {
      try {
        await this.workflowService.cancelAgentWorkflow(agent.workflowId);
      } catch (err) {
        this.logger.warn(
          `Cancel workflow failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.podGateway.delete(id);
    } catch (err) {
      this.logger.warn(
        `Pod cleanup failed for agent ${id}: ${(err as Error).message}`,
      );
    }

    if (wipeS3 === 'true') {
      try {
        const deleted = await this.fileGateway.wipe(id);
        this.logger.log(
          `Wiped ${deleted} S3 object(s) for agent ${id} on delete`,
        );
      } catch (err) {
        this.logger.warn(
          `S3 wipe failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
