import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  ACCESS_SCOPE_NOTE,
  accessScope,
  callerIsOperator,
  ok,
  ownerOnlyLeftOutField,
  requireOperator,
  type ToolResult,
  callerParty,
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
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
@ToolAudience('admin')
@Injectable()
export class UsageTool implements IConditionallyListedTool {
  constructor(
    private readonly usage: IUsageGateway,
    private readonly agents: IAgentGateway,
    private readonly access: AgentAccessService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_usage_overview',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Usage across all agents',
    template: 'How much did all agents cost in the last 30 days?',
    description:
      'Token usage and cost across every agent of this Ranch for the last ' +
      "30 days, as the console's Usage overview shows it: `totals` " +
      '(input/output tokens, calls, costUsd), `topModel`, `last30days` ' +
      'rolled up per date and model, and `byAgent` sorted by cost with the ' +
      'most expensive agent first (a deleted agent is still listed, under ' +
      'the name it had). Reported usage only — the current day is included once each ' +
      'agent has posted its daily report. For one agent in detail, or a ' +
      'different window, call agent_usage. For every agent over 7 or 90 ' +
      'days, with the period before it for comparison, call ' +
      'get_installation_stats. The totals are of the agents ' +
      'in the result, never more: when it carries `notIncluded`, the Ranch ' +
      'assistant’s usage is the Owner’s to read and is in no figure here. ' +
      ACCESS_SCOPE_NOTE,
    parameters: z.object({}),
  })
  async getUsageOverview(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    // Only the agents the caller reaches, totals included (CLEAN-231), and
    // never the assistant's spend for anybody but the Owner (CLEAN-268).
    const reach = await this.access.reachableIds(callerParty(httpRequest));
    const rows = reach
      .forRecords()
      .filter(
        await this.usage.findRecentAll(OVERVIEW_DAYS),
        (row) => row.agentId,
      );
    const { last30days, totals, topModel, agentTotals } =
      rollUpAcrossAgents(rows);
    const byAgent = await resolveAgentNames(agentTotals, (id) =>
      this.agents.findById(id),
    );
    return ok({
      last30days,
      totals,
      topModel,
      byAgent,
      ...ownerOnlyLeftOutField(httpRequest, 'usage figures'),
      ...accessScope(reach),
    });
  }
}
