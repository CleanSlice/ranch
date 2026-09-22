import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from '#/agent/agent/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { LogService, MAX_TAIL_LINES } from './domain';

/** What the chat gets when it does not say how many lines it wants. */
const DEFAULT_TOOL_TAIL = 100;

/**
 * Pod logs from the chat (CLEAN-109), mirroring `GET agents/:id/logs`. The
 * read is `LogService`, the same one the console's log pane polls, so the
 * markers for "no pod" and "container starting" are the console's — with one
 * difference: a missing pod becomes a sentence naming the next move, because
 * a model that reads `[no pod yet for stopped agent]` and stops has failed
 * the person.
 *
 * Operator-only: logs can carry anything the agent printed, including
 * secrets a template author echoed by mistake, so a plain agent must not
 * be able to read another agent's (or its own) pod output through here.
 */
@Injectable()
export class LogTool implements IConditionallyListedTool {
  constructor(
    private readonly agentGateway: IAgentGateway,
    private readonly logService: LogService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_agent_logs',
    topic: ToolTopics.Agents,
    title: 'Read pod logs',
    template: 'Show the last «100» log lines of the agent «name»',
    description:
      "The tail of an agent's pod log, every line prefixed with its RFC3339 " +
      'timestamp, newest last. Returns { agentId, lines, logs }. Takes the ' +
      'agent id — resolve a name with list_agents first. When the agent has ' +
      'no running pod the result says so and points at start_agent; a ' +
      '[container …] line means the pod is still booting, read again in a ' +
      'few seconds.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
      lines: z
        .number()
        .int()
        .min(1)
        .max(MAX_TAIL_LINES)
        .optional()
        .describe(
          `How many lines from the end to return, default ${DEFAULT_TOOL_TAIL}, ` +
            `at most ${MAX_TAIL_LINES}`,
        ),
    }),
  })
  async getAgentLogs(
    args: { agentId: string; lines?: number },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<ToolResult> {
    requireOperator(httpRequest);

    const agent = await this.agentGateway.findById(args.agentId);
    if (!agent) {
      return ok({
        error: `Agent «${args.agentId}» not found — call list_agents to find the id`,
      });
    }

    const lines = this.logService.parseTail(args.lines ?? DEFAULT_TOOL_TAIL);
    const read = await this.logService.readPodLogs(
      args.agentId,
      agent.status,
      lines,
    );
    if (read.state === 'no_pod') {
      return ok({
        error: `Agent «${agent.name}» has no running pod — start it first (start_agent).`,
      });
    }

    return ok({
      agentId: args.agentId,
      lines,
      logs: read.state === 'logs' ? tailOf(read.logs, lines) : read.logs,
    });
  }
}

/** Kubernetes honours `tailLines`, but a cheap trim keeps the promise ours. */
function tailOf(logs: string, lines: number): string {
  const trimmed = logs.endsWith('\n') ? logs.slice(0, -1) : logs;
  const all = trimmed.split('\n');
  if (all.length <= lines) return logs;
  return all.slice(-lines).join('\n') + (logs.endsWith('\n') ? '\n' : '');
}
