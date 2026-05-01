import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
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
import { Observable, map } from 'rxjs';
import { IAgentGateway } from './domain';
import { AgentStatusTypes } from './domain/agent.types';
import { AgentStatusService } from './domain/agentStatus.service';
import {
  AgentStatusDto,
  CreateAgentDto,
  SetAgentDebugDto,
  UpdateAgentDto,
} from './dtos';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IWorkflowStatus } from '#/workflow/domain/workflow.types';
import { ITemplateGateway } from '#/agent/template/domain';
import { IPodGateway } from '#/agent/pod/domain';
import { IBridleGateway } from '#/bridle/domain';
import { JwtAuthGuard, Public, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';

// Workflow only runs until the agent pod is Running (successCondition), then finishes.
// So Succeeded means "deploy succeeded, pod is live" — map to running, not stopped.
const PHASE_TO_STATUS: Record<IWorkflowStatus['phase'], AgentStatusTypes> = {
  Pending: 'deploying',
  Running: 'deploying',
  Succeeded: 'running',
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
  ) {}

  private async deploy(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;
    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) {
      this.logger.error(
        `Template ${agent.templateId} not found for agent ${agentId}`,
      );
      await this.agentGateway.updateStatus(agentId, 'failed');
      return;
    }
    try {
      const workflowId = await this.workflowService.submitAgentWorkflow(
        agent,
        template.image,
      );
      let status: AgentStatusTypes = 'deploying';
      try {
        const { phase } =
          await this.workflowService.getWorkflowStatus(workflowId);
        status = PHASE_TO_STATUS[phase];
      } catch {
        // keep 'deploying' if status probe fails
      }
      await this.agentGateway.updateStatus(agentId, status, workflowId);
    } catch (err) {
      this.logger.error(
        `Workflow submit failed for agent ${agentId}: ${(err as Error).message}`,
      );
      await this.agentGateway.updateStatus(agentId, 'failed');
    }
  }

  private async syncStatus(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.workflowId) return agent;
    try {
      const { phase } = await this.workflowService.getWorkflowStatus(
        agent.workflowId,
      );
      const next = PHASE_TO_STATUS[phase];
      if (next && next !== agent.status) {
        await this.agentGateway.updateStatus(agentId, next, agent.workflowId);
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

  @Post()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Create and deploy a new agent. Admin or Owner.' })
  async create(@Body() dto: CreateAgentDto) {
    const agent = await this.agentGateway.create(dto);
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

  @Post(':id/restart')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Restart an agent. Admin or Owner.' })
  async restart(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

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

  @Delete(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Stop and delete an agent. Admin or Owner.' })
  async remove(@Param('id') id: string) {
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
  }
}
