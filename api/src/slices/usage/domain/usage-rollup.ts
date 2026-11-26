import { costUsd } from './model-pricing';
import type {
  ICredentialUsageResponse,
  IUsageDailyEntry,
  IUsageData,
} from './usage.types';

/**
 * The cross-agent roll-up behind `GET llms/:id/usage` and `GET usage/overview`,
 * shared with the `get_usage_overview` tool so the chat and the console
 * report the same dollars from the same rows (CLEAN-109).
 */

export interface IUsageTotals {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

export interface IAgentUsageTotals extends IUsageTotals {
  agentId: string;
  /**
   * The name stored with the agent's most recent row that has one, or null
   * when none of its rows carries a name. What a deleted agent is shown
   * under (CLEAN-261); a live agent is shown under the name it has now.
   */
  agentName: string | null;
}

export interface IUsageRollup {
  last30days: IUsageDailyEntry[];
  totals: IUsageTotals;
  topModel: string | null;
  /** Sorted by cost, most expensive agent first. */
  agentTotals: IAgentUsageTotals[];
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Rolls multi-agent usage rows up to the `${date}|${model}` grain the
 * per-agent endpoint uses, plus per-agent totals.
 */
export function rollUpAcrossAgents(rows: IUsageData[]): IUsageRollup {
  const dailyMap = new Map<string, IUsageDailyEntry>();
  const agentMap = new Map<string, IAgentUsageTotals>();
  // The row each agent's name was taken from, to tell a newer one when it
  // comes. Kept beside the totals so the name never touches a number.
  const namedBy = new Map<string, IUsageData>();

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
        agentName: null,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        callCount: r.callCount,
        costUsd: cost,
      });
    }

    const named = namedBy.get(r.agentId);
    if (r.agentName && (!named || isNewer(r, named))) {
      namedBy.set(r.agentId, r);
    }
  }

  for (const [agentId, named] of namedBy) {
    const agent = agentMap.get(agentId);
    if (agent) agent.agentName = named.agentName;
  }

  const last30days = Array.from(dailyMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  const totals = last30days.reduce<IUsageTotals>(
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

  const agentTotals = Array.from(agentMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd,
  );

  return { last30days, totals, topModel, agentTotals };
}

// A later day wins; within a day, the row written last. The rows of one
// report share a day and a name, so the second half only matters for a
// rename between two reports of the same day.
function isNewer(a: IUsageData, b: IUsageData): boolean {
  const byDay = a.date.getTime() - b.date.getTime();
  if (byDay !== 0) return byDay > 0;
  return a.updatedAt.getTime() > b.updatedAt.getTime();
}

/**
 * Resolve agent names. An agent that exists is shown under the name it has
 * now. A deleted one keeps its usage and is shown under the name stored with
 * its rows (CLEAN-261); the raw id is left for rows that carry no name, so
 * the row is visible either way.
 */
export async function resolveAgentNames(
  agentTotals: IAgentUsageTotals[],
  findAgent: (agentId: string) => Promise<{ name: string } | null>,
): Promise<ICredentialUsageResponse['byAgent']> {
  return Promise.all(
    agentTotals.map(async (entry) => {
      const agent = await findAgent(entry.agentId).catch(() => null);
      return {
        agentId: entry.agentId,
        agentName: agent?.name ?? entry.agentName ?? entry.agentId,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        callCount: entry.callCount,
        costUsd: entry.costUsd,
      };
    }),
  );
}
