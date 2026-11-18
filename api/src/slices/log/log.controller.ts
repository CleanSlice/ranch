import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { ManagesAgent } from '#/agent/agent/guards';
import { LogService, type IPodLogSummary } from './domain';

/**
 * Agent-pod logs for the console. The Kubernetes read lives in `LogService`
 * so `LogTool` (the chat's `get_agent_logs`) serves the very same lines and
 * the very same "no pod" / "container starting" markers.
 *
 * Admin by the default of the role guard, and only for an agent the caller
 * may manage (CLEAN-232).
 */
@ApiTags('logs')
@Controller('agents/:agentId/logs')
@ManagesAgent('agentId')
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

  /**
   * The collapsed Logs bar's view of the same window: the newest line, how
   * many lines are behind it and how many of those are warnings or errors
   * (CLEAN-233). Same `tail` meaning as the full read — the counts describe
   * the window asked for, not the pod's whole history.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get a summary of the agent pod logs' })
  async getSummary(
    @Param('agentId') agentId: string,
    @Query('tail') tail?: string,
  ): Promise<IPodLogSummary> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    return this.logService.readPodLogSummary(
      agentId,
      agent.status,
      this.logService.parseTail(tail),
    );
  }
}
