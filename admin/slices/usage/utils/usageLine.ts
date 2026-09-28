import { formatUsd } from '#agent/utils/agentFormat';

/**
 * The one-line usage in the agent workspace header (specs/017, R3):
 * `"$15.31 / 30d · claude-haiku-4-5"`, or just the cost part when the top
 * model is not known. Pure, so the exact text is pinned by a test.
 */
export function usageLineText(
  totals: { costUsd: number },
  topModel: string | null,
): string {
  const cost = `${formatUsd(totals.costUsd)} / 30d`;
  return topModel ? `${cost} · ${topModel}` : cost;
}
