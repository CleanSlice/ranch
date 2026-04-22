import { Controller, Get, Param, NotFoundException, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { IAgentGateway } from '#/agent/agent/domain';

const execAsync = promisify(exec);

@ApiTags('logs')
@Controller('agents/:agentId/logs')
export class LogController {
  constructor(private agentGateway: IAgentGateway) {}

  @Get()
  @ApiOperation({ summary: 'Get agent pod logs' })
  async getLogs(
    @Param('agentId') agentId: string,
    @Query('tail') tail?: string,
  ) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const namespace = process.env.AGENTS_NAMESPACE || 'agents';
    const context = process.env.KUBE_CONTEXT;
    const tailLines = this.parseTail(tail);
    const podName = `agent-${agentId}`;

    const args = ['-n', namespace, 'logs', podName, `--tail=${tailLines}`];
    if (context) args.unshift('--context', context);

    try {
      const { stdout } = await execAsync(
        `kubectl ${args.map((a) => JSON.stringify(a)).join(' ')} 2>&1`,
        { timeout: 10_000, maxBuffer: 5 * 1024 * 1024 },
      );
      return { logs: stdout };
    } catch (err) {
      const stderr = (err as { stdout?: string; stderr?: string }).stderr ?? '';
      const stdout = (err as { stdout?: string }).stdout ?? '';
      return { logs: stdout + stderr || `[log fetch failed: ${(err as Error).message}]` };
    }
  }

  private parseTail(raw?: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(n, 5000);
  }
}
