import { formatUsd } from '#agent/utils/agentFormat';

/**
 * The one-line usage in the agent workspace header (specs/017, R3):
 * `"$15.31 / 30d · claude-haiku-5-5"`, or just the cost part when the agent
 * has no LLM credential to name a model. Pure, so the exact text is pinned by
 * a test.
 *
 * The model here is the agent's *current* one — what it is configured to run.
 * It used to be the 30-day top model, which on an agent switched to a new
 * model went on naming the old one until a month of spend rolled over
 * (CLEAN-149). The top model is still shown, inside the popover, next to the
 * 30-day figures it belongs to.
 */
export function usageLineText(
  totals: { costUsd: number },
  currentModel: string | null,
): string {
  const cost = `${formatUsd(totals.costUsd)} / 30d`;
  return currentModel ? `${cost} · ${currentModel}` : cost;
}
