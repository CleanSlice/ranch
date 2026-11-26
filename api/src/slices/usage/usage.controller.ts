import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  Logger,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentScoped, accessCallerOf } from '#/user/agentAccess/guards';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IUsageGateway } from './domain';
import { costUsd } from './domain/model-pricing';
import {
  dayKey,
  resolveAgentNames,
  rollUpAcrossAgents,
} from './domain/usage-rollup';
import {
  IAgentUsageResponse,
  ICredentialUsageResponse,
  IOverviewUsageResponse,
  IUsageDailyEntry,
} from './domain/usage.types';
import { ReportUsageDto } from './dtos';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';
import { Public } from '#/user/auth/guards';
import { IFileGateway } from '#/agent/file/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ILlmGateway } from '#/llm/domain';

interface IRuntimeUsageSnapshot {
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCallCount: number;
  reportedAt: string | null;
}

@ApiTags('usage')
@Controller()
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  constructor(
    private gateway: IUsageGateway,
    private fileGateway: IFileGateway,
    private agentGateway: IAgentGateway,
    private llmGateway: ILlmGateway,
    private access: AgentAccessService,
  ) {}

  // Posted by the runtime with the bridle key, never a user token.
  @Public()
  @Post('agents/:agentId/usage')
  @HttpCode(204)
  @UseGuards(BridleApiKeyGuard)
  @ApiHeader({ name: 'x-bridle-api-key', required: true })
  @ApiOperation({
    summary: 'Agent reports its usage (mirrors runtime usage.json)',
  })
  async report(
    @Param('agentId') agentId: string,
    @Body() dto: ReportUsageDto,
  ): Promise<void> {
    // The agent's name travels with what it spent, so the spend can still
    // be shown by name once the agent is deleted (CLEAN-261). Read once for
    // the whole report. Usage is telemetry: an agent that is not there, or a
    // lookup that fails, reports without a name rather than not at all.
    const agent = await this.agentGateway.findById(agentId).catch((err) => {
      this.logger.warn(
        `Could not read the name of agent ${agentId} for its usage report: ${(err as Error).message}`,
      );
      return null;
    });
    await this.gateway.report(agentId, dto, agent?.name ?? null);
  }

  @Get('agents/:agentId/usage')
  @AgentScoped('agentId')
  @ApiOperation({
    summary:
      'Get 30-day usage for an agent with cost. 404 when there is no such agent among the ones the caller reaches.',
  })
  async findForAgent(
    @Param('agentId') agentId: string,
  ): Promise<IAgentUsageResponse> {
    // An agent that does not exist used to answer an empty report, which
    // told it apart from one the caller's lists hide (CLEAN-231).
    if (!(await this.agentGateway.findById(agentId))) {
      throw new NotFoundException('Agent not found');
    }
    const rows = await this.gateway.findRecentForAgent(agentId, 30);
    const todayKey = dayKey(new Date());

    // Live snapshot for today: the runtime writes data/usage.json on every
    // LLM call but only POSTs to the API on graceful shutdown / 23:50 UTC.
    // Crashed agents never report — without this read the today/totals look
    // empty even after thousands of tokens went through. Source of truth
    // for the *current* day is the file; DB carries everything else.
    const todaySnapshot = await this.readTodaySnapshot(agentId, todayKey);
    const todayModelLabel = todaySnapshot
      ? await this.resolveTodayModel(agentId)
      : null;

    const last30days: IUsageDailyEntry[] = [];
    for (const r of rows) {
      const date = dayKey(r.date);
      // If we have a fresher snapshot for today, drop any DB rows for today
      // to avoid double-counting (the runtime may have already POSTed once
      // today before we hit this endpoint).
      if (todaySnapshot && date === todayKey) continue;
      last30days.push({
        date,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        callCount: r.callCount,
        costUsd: costUsd(r.model, r.inputTokens, r.outputTokens),
      });
    }

    if (todaySnapshot && todaySnapshot.totalCallCount > 0) {
      const model = todayModelLabel ?? 'unknown';
      last30days.push({
        date: todayKey,
        model,
        inputTokens: todaySnapshot.totalInputTokens,
        outputTokens: todaySnapshot.totalOutputTokens,
        callCount: todaySnapshot.totalCallCount,
        costUsd: costUsd(
          model,
          todaySnapshot.totalInputTokens,
          todaySnapshot.totalOutputTokens,
        ),
      });
    }

    last30days.sort((a, b) => b.date.localeCompare(a.date));

    const totals = last30days.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.inputTokens,
        outputTokens: acc.outputTokens + e.outputTokens,
        callCount: acc.callCount + e.callCount,
        costUsd: acc.costUsd + e.costUsd,
      }),
      { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
    );

    const perModel = new Map<string, number>();
    for (const e of last30days) {
      perModel.set(
        e.model,
        (perModel.get(e.model) ?? 0) + e.inputTokens + e.outputTokens,
      );
    }
    let topModel: string | null = null;
    let topTokens = -1;
    for (const [m, t] of perModel) {
      if (t > topTokens) {
        topTokens = t;
        topModel = m;
      }
    }

    const todayRows = last30days.filter((e) => e.date === todayKey);
    const todayTotals = todayRows.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.inputTokens,
        outputTokens: acc.outputTokens + e.outputTokens,
        callCount: acc.callCount + e.callCount,
      }),
      { inputTokens: 0, outputTokens: 0, callCount: 0 },
    );
    const todayModel =
      todayRows.length > 0
        ? todayRows.reduce((a, b) =>
            a.inputTokens + a.outputTokens >= b.inputTokens + b.outputTokens
              ? a
              : b,
          ).model
        : null;

    return {
      last30days,
      totals,
      topModel,
      today: { model: todayModel, ...todayTotals },
    };
  }

  private async readTodaySnapshot(
    agentId: string,
    todayKey: string,
  ): Promise<IRuntimeUsageSnapshot | null> {
    try {
      const file = await this.fileGateway.read(agentId, 'data/usage.json');
      const parsed = JSON.parse(file.content) as Partial<IRuntimeUsageSnapshot>;
      if (parsed.date !== todayKey) return null;
      return {
        date: parsed.date,
        totalInputTokens: parsed.totalInputTokens ?? 0,
        totalOutputTokens: parsed.totalOutputTokens ?? 0,
        totalCallCount: parsed.totalCallCount ?? 0,
        reportedAt: parsed.reportedAt ?? null,
      };
    } catch (err) {
      // 404 = file doesn't exist (agent never produced usage). Anything else
      // (S3 down, parse error) we log and treat as "no snapshot available"
      // so the endpoint still returns DB data.
      const status = (err as { status?: number; statusCode?: number }).status;
      if (status !== 404) {
        this.logger.warn(
          `Failed to read usage.json for agent ${agentId}: ${(err as Error).message}`,
        );
      }
      return null;
    }
  }

  private async resolveTodayModel(agentId: string): Promise<string | null> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.llmCredentialId) return null;
    const credential = await this.llmGateway.findById(agent.llmCredentialId);
    return credential?.model ?? null;
  }

  @Get('llms/:id/usage')
  @ApiOperation({
    summary:
      'Get 30-day usage for a single LLM credential across the agents the caller reaches; totals are of those agents only',
  })
  async findForCredential(
    @Param('id') credentialId: string,
    @Req() req?: Request,
  ): Promise<ICredentialUsageResponse> {
    // Rows of agents the caller does not reach are dropped before anything
    // is summed, so no total carries them either (CLEAN-231).
    const reach = await this.access.reachableIds(accessCallerOf(req));
    const rows = reach.filter(
      await this.gateway.findRecentForCredential(credentialId, 30),
      (row) => row.agentId,
    );
    const { last30days, totals, topModel, agentTotals } =
      rollUpAcrossAgents(rows);
    const byAgent = await resolveAgentNames(agentTotals, (id) =>
      this.agentGateway.findById(id),
    );
    return { last30days, totals, topModel, byAgent };
  }

  @Get('usage/overview')
  @ApiOperation({
    summary:
      'Get 30-day usage across the agents the caller reaches, with cost; totals are of those agents only',
  })
  async findOverview(@Req() req?: Request): Promise<IOverviewUsageResponse> {
    // DB rows only — today's not-yet-reported runtime usage is excluded
    // until agents POST their daily report. The per-agent endpoint keeps
    // the live usage.json merge; doing that here would cost one S3 read
    // per agent per page view.
    const reach = await this.access.reachableIds(accessCallerOf(req));
    const rows = reach.filter(
      await this.gateway.findRecentAll(30),
      (row) => row.agentId,
    );
    const { last30days, totals, topModel, agentTotals } =
      rollUpAcrossAgents(rows);
    const byAgent = await resolveAgentNames(agentTotals, (id) =>
      this.agentGateway.findById(id),
    );
    return { last30days, totals, topModel, byAgent };
  }
}
