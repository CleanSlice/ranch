import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { IWorkflowGateway } from '#/workflow/domain/IWorkflowGateway';

@ApiTags('logs')
@Controller('agents/:agentId/logs')
export class LogController {
  constructor(
    private agentGateway: IAgentGateway,
    private workflowGateway: IWorkflowGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get agent logs' })
  async getLogs(@Param('agentId') agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (!agent.workflowId) return { logs: '' };

    const logs = await this.workflowGateway.getLogs(agent.workflowId);
    return { logs };
  }
}
