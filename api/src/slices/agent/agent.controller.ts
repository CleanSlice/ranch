import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IAgentGateway } from './domain';
import { CreateAgentDto, UpdateAgentDto } from './dtos';
import { WorkflowService } from '#/workflow/domain/workflow.service';

@ApiTags('agents')
@Controller('agents')
export class AgentController {
  constructor(
    private agentGateway: IAgentGateway,
    private workflowService: WorkflowService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all agents' })
  findAll() {
    return this.agentGateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agent by ID' })
  async findById(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  @Post()
  @ApiOperation({ summary: 'Create and deploy a new agent' })
  async create(@Body() dto: CreateAgentDto) {
    const agent = await this.agentGateway.create(dto);

    const workflowId = await this.workflowService.submitAgentWorkflow(agent);
    await this.agentGateway.updateStatus(agent.id, 'deploying', workflowId);

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

    await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    const workflowId = await this.workflowService.submitAgentWorkflow(agent);
    await this.agentGateway.updateStatus(id, 'deploying', workflowId);

    return this.agentGateway.findById(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop and delete an agent' })
  async remove(@Param('id') id: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    if (agent.workflowId) {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    }
    await this.agentGateway.delete(id);
  }
}
