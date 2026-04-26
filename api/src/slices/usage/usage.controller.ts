import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IUsageGateway } from './domain';
import { costUsd } from './domain/model-pricing';
import { IAgentUsageResponse, IUsageDailyEntry } from './domain/usage.types';
import { ReportUsageDto } from './dtos';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@ApiTags('usage')
@Controller()
export class UsageController {
  constructor(private gateway: IUsageGateway) {}

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

    const last30days: IUsageDailyEntry[] = rows.map((r) => ({
      date: dayKey(r.date),
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      callCount: r.callCount,
      costUsd: costUsd(r.model, r.inputTokens, r.outputTokens),
    }));

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

    const todayKey = dayKey(new Date());
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
}
