import type {
  IAgentUsage,
  IUsageDailyEntry,
  IUsageToday,
  IUsageTotals,
} from '../domain/usage.types';

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Maps the usage API onto domain shapes; reads defensively. */
export class UsageMapper {
  toAgentUsage(raw: unknown): IAgentUsage | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      last30days: Array.isArray(o.last30days)
        ? o.last30days.map((e) => this.toDaily(e))
        : [],
      totals: this.toTotals(o.totals),
      topModel: typeof o.topModel === 'string' ? o.topModel : null,
      today: this.toToday(o.today),
    };
  }

  private toDaily(raw: unknown): IUsageDailyEntry {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      date: str(o.date),
      model: str(o.model),
      inputTokens: num(o.inputTokens),
      outputTokens: num(o.outputTokens),
      callCount: num(o.callCount),
      costUsd: num(o.costUsd),
    };
  }

  private toTotals(raw: unknown): IUsageTotals {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      inputTokens: num(o.inputTokens),
      outputTokens: num(o.outputTokens),
      callCount: num(o.callCount),
      costUsd: num(o.costUsd),
    };
  }

  private toToday(raw: unknown): IUsageToday {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      model: typeof o.model === 'string' ? o.model : null,
      inputTokens: num(o.inputTokens),
      outputTokens: num(o.outputTokens),
      callCount: num(o.callCount),
    };
  }
}
