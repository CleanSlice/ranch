import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IUsageGateway } from './domain';
import { costUsd } from './domain/model-pricing';
import {
  IAgentUsageResponse,
  ICredentialUsageResponse,
  IUsageDailyEntry,
} from './domain/usage.types';
import { ReportUsageDto } from './dtos';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';
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

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  ) {}

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
    await this.gateway.report(agentId, dto);
  }

  @Get('agents/:agentId/usage')
  @ApiOperation({ summary: 'Get 30-day usage for an agent with cost' })
  async findForAgent(
    @Param('agentId') agentId: string,
  ): Promise<IAgentUsageResponse> {
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
    summary: 'Get 30-day usage for a single LLM credential across all agents',
  })
  async findForCredential(
    @Param('id') credentialId: string,
  ): Promise<ICredentialUsageResponse> {
    const rows = await this.gateway.findRecentForCredential(credentialId, 30);

    // Daily roll-up keyed by `${date}|${model}` — preserves the per-model
    // grain that the per-agent endpoint already uses.
    const dailyMap = new Map<string, IUsageDailyEntry>();
    // Per-agent roll-up keyed by agentId.
    const agentMap = new Map<
      string,
      {
        agentId: string;
        inputTokens: number;
        outputTokens: number;
        callCount: number;
        costUsd: number;
      }
    >();

    for (const r of rows) {
      const date = dayKey(r.date);
      const dailyKey = `${date}|${r.model}`;
      const cost = costUsd(r.model, r.inputTokens, r.outputTokens);

      const daily = dailyMap.get(dailyKey);
      if (daily) {
        daily.inputTokens += r.inputTokens;
        daily.outputTokens += r.outputTokens;
        daily.callCount += r.callCount;
        daily.costUsd += cost;
      } else {
        dailyMap.set(dailyKey, {
          date,
          model: r.model,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          callCount: r.callCount,
          costUsd: cost,
        });
      }

      const agent = agentMap.get(r.agentId);
      if (agent) {
        agent.inputTokens += r.inputTokens;
        agent.outputTokens += r.outputTokens;
        agent.callCount += r.callCount;
        agent.costUsd += cost;
      } else {
        agentMap.set(r.agentId, {
          agentId: r.agentId,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          callCount: r.callCount,
          costUsd: cost,
        });
      }
    }

    const last30days = Array.from(dailyMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    const totals = last30days.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.inputTokens,
        outputTokens: acc.outputTokens + e.outputTokens,
        callCount: acc.callCount + e.callCount,
        costUsd: acc.costUsd + e.costUsd,
      }),
      { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
    );

    const perModelTokens = new Map<string, number>();
    for (const e of last30days) {
      perModelTokens.set(
        e.model,
        (perModelTokens.get(e.model) ?? 0) + e.inputTokens + e.outputTokens,
      );
    }
    let topModel: string | null = null;
    let topTokens = -1;
    for (const [m, t] of perModelTokens) {
      if (t > topTokens) {
        topTokens = t;
        topModel = m;
      }
    }

    // Resolve agent names. Failed lookups (deleted agents) fall back to the
    // raw ID so the row is still visible — usage outlives the agent record.
    const byAgent = await Promise.all(
      Array.from(agentMap.values())
        .sort((a, b) => b.costUsd - a.costUsd)
        .map(async (entry) => {
          const agent = await this.agentGateway
            .findById(entry.agentId)
            .catch(() => null);
          return {
            agentId: entry.agentId,
            agentName: agent?.name ?? entry.agentId,
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
            callCount: entry.callCount,
            costUsd: entry.costUsd,
          };
        }),
    );

    return { last30days, totals, topModel, byAgent };
  }
}
