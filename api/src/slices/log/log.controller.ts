import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { LogService } from './domain';

/**
 * Agent-pod logs for the console. The Kubernetes read lives in `LogService`
 * so `LogTool` (the chat's `get_agent_logs`) serves the very same lines and
 * the very same "no pod" / "container starting" markers.
 */
@ApiTags('logs')
@Controller('agents/:agentId/logs')
export class LogController {
  constructor(
    private agentGateway: IAgentGateway,
    private logService: LogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get agent pod logs' })
  async getLogs(
    @Param('agentId') agentId: string,
    @Query('tail') tail?: string,
  ): Promise<{ logs: string }> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const read = await this.logService.readPodLogs(
      agentId,
      agent.status,
      this.logService.parseTail(tail),
    );
    return { logs: read.logs };
  }
}
