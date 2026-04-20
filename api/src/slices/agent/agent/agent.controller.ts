import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IAgentGateway } from './domain';
import { AgentStatusTypes } from './domain/agent.types';
import { CreateAgentDto, UpdateAgentDto } from './dtos';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IWorkflowStatus } from '#/workflow/domain/workflow.types';
import { ITemplateGateway } from '#/agent/template/domain';

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
@Controller('agents')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private agentGateway: IAgentGateway,
    private templateGateway: ITemplateGateway,
    private workflowService: WorkflowService,
  ) {}

  private async deploy(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;
    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) {
      this.logger.error(`Template ${agent.templateId} not found for agent ${agentId}`);
      await this.agentGateway.updateStatus(agentId, 'failed');
      return;
    }
    try {
      const workflowId = await this.workflowService.submitAgentWorkflow(agent, template.image);
      let status: AgentStatusTypes = 'deploying';
      try {
        const { phase } = await this.workflowService.getWorkflowStatus(workflowId);
        status = PHASE_TO_STATUS[phase];
      } catch {
        // keep 'deploying' if status probe fails
      }
      await this.agentGateway.updateStatus(agentId, status, workflowId);
    } catch (err) {
      this.logger.error(`Workflow submit failed for agent ${agentId}: ${(err as Error).message}`);
      await this.agentGateway.updateStatus(agentId, 'failed');
    }
  }

  private async syncStatus(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.workflowId) return agent;
    try {
      const { phase } = await this.workflowService.getWorkflowStatus(agent.workflowId);
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
  @ApiOperation({ summary: 'List all agents' })
  findAll() {
    return this.agentGateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agent by ID' })
  async findById(@Param('id') id: string) {
    const agent = await this.syncStatus(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  @Post()
  @ApiOperation({ summary: 'Create and deploy a new agent' })
  async create(@Body() dto: CreateAgentDto) {
    const agent = await this.agentGateway.create(dto);
    await this.deploy(agent.id);
    return this.agentGateway.findById(agent.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update agent configuration' })
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentGateway.update(id, dto);
  }

  @Post(':id/restart')
  @ApiOperation({ summary: 'Restart an agent' })
  async restart(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    try {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    } catch (err) {
      this.logger.warn(`Cancel workflow failed for agent ${id}: ${(err as Error).message}`);
    }
    await this.deploy(id);
    return this.agentGateway.findById(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop and delete an agent' })
  async remove(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    if (agent.workflowId) {
      try {
        await this.workflowService.cancelAgentWorkflow(agent.workflowId);
      } catch (err) {
        this.logger.warn(`Cancel workflow failed for agent ${id}: ${(err as Error).message}`);
      }
    }
    await this.agentGateway.delete(id);
  }
}
