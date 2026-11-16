import { dayKey } from '#common/utils/format';
import type { IUsageDailyEntry } from '#usage/domain/usage.types';

/** One day of usage, every model together. */
export interface IUsageDay {
  /** `YYYY-MM-DD`. */
  date: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  costUsd: number;
}

/**
 * The last `count` days ending at `today`, oldest first, for the Usage block's
 * bars (CLEAN-228, research R10). The 30-day response has one row per date and
 * model, newest first; here a day is one entry, summed across models, and a
 * day with no row is there with zeros — a gap in the bars would read as "no
 * data", which is not the same as "nothing spent".
 *
 * Rows carry their day as `YYYY-MM-DD` (or an ISO instant starting with it);
 * `today` is the viewer's own day.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
export function usageDays(
  rows: ReadonlyArray<IUsageDailyEntry>,
  today: Date,
  count = 7,
): IUsageDay[] {
  const days: IUsageDay[] = [];
  const byDate = new Map<string, IUsageDay>();
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = dayKey(
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - back),
    );
    const day: IUsageDay = {
      date,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
      costUsd: 0,
    };
    days.push(day);
    byDate.set(date, day);
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const day = byDate.get(String(row.date ?? '').slice(0, 10));
    if (!day) continue;
    day.inputTokens += row.inputTokens;
    day.outputTokens += row.outputTokens;
    day.calls += row.callCount;
    day.costUsd += row.costUsd;
  }
  return days;
}
