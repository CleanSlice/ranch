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
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { IUsageGateway } from './domain';
import { resolveAgentNames, rollUpAcrossAgents } from './domain/usage-rollup';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** The console's overview window. `GET usage/overview` takes no other. */
const OVERVIEW_DAYS = 30;

/**
 * The console's "Usage" overview from the chat (CLEAN-109): what
 * `GET usage/overview` returns, computed the same way — the same DB rows
 * from `IUsageGateway`, rolled up by `rollUpAcrossAgents` and priced by
 * `costUsd`, with agent names resolved through `IAgentGateway`. Today's
 * not-yet-reported runtime usage is excluded here as it is in the console;
 * `agent_usage` is the per-agent view.
 *
 * Operator agents only: spend across the whole Ranch is not a plain agent's
 * business. The class is hidden from a plain agent's list and refuses the
 * body as well, like every other operator tool.
 */
@Injectable()
export class UsageTool implements IConditionallyListedTool {
  constructor(
    private readonly usage: IUsageGateway,
    private readonly agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_usage_overview',
    topic: ToolTopics.ChatsUsage,
    title: 'Usage across all agents',
    template: 'How much did all agents cost in the last 30 days?',
    description:
      'Token usage and cost across every agent of this Ranch for the last ' +
      "30 days, as the console's Usage overview shows it: `totals` " +
      '(input/output tokens, calls, costUsd), `topModel`, `last30days` ' +
      'rolled up per date and model, and `byAgent` sorted by cost with the ' +
      'most expensive agent first (a deleted agent shows its id as the ' +
      'name). Reported usage only — the current day is included once each ' +
      'agent has posted its daily report. For one agent in detail, or a ' +
      'different window, call agent_usage.',
    parameters: z.object({}),
  })
  async getUsageOverview(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const rows = await this.usage.findRecentAll(OVERVIEW_DAYS);
    const { last30days, totals, topModel, agentTotals } =
      rollUpAcrossAgents(rows);
    const byAgent = await resolveAgentNames(agentTotals, (id) =>
      this.agents.findById(id),
    );
    return ok({ last30days, totals, topModel, byAgent });
  }
}
