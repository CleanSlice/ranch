/**
 * "What would this limit have done": the last hour of traffic against the
 * per-minute number being typed (CLEAN-228, research R8). Pure — it runs on
 * every keystroke and nothing is sent.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
import { formatNumber } from '#common/utils/format';

export interface ILimitPreview {
  /** Highest accepted in any one minute. */
  peak: number;
  /** Minutes that accepted more than the limit; 0 with no limit. */
  over: number;
  /** Requests above the limit in those minutes; 0 with no limit. */
  refused: number;
}

export function limitPreview(
  series: ReadonlyArray<{ accepted: number }>,
  perMinute: number | null,
): ILimitPreview {
  let peak = 0;
  let over = 0;
  let refused = 0;
  const limit =
    typeof perMinute === 'number' && Number.isFinite(perMinute) ? perMinute : null;
  for (let i = 0; i < series.length; i += 1) {
    const accepted = series[i]!.accepted;
    if (accepted > peak) peak = accepted;
    if (limit !== null && accepted > limit) {
      over += 1;
      refused += accepted - limit;
    }
  }
  return { peak, over, refused };
}

/**
 * The top of the chart's scale. The traffic stays readable whatever the limit:
 * a limit far above the peak does not flatten the bars — it is drawn at the
 * top edge and labelled as above the scale instead. The numbers are the
 * prototype's layout constants, not thresholds.
 */
export function chartTop(peak: number, limit: number | null): number {
  const forTraffic = peak * 1.25;
  if (limit === null) return Math.max(forTraffic, 4);
  return Math.max(forTraffic, Math.min(limit, peak * 2.2) * 1.12, 4);
}

/** True when the limit line cannot be drawn at its own height. */
export function isLimitAboveScale(peak: number, limit: number | null): boolean {
  return limit !== null && limit > chartTop(peak, limit);
}

/** The sentence under the chart. */
export function verdictText(input: {
  on: boolean;
  perMinute: number | null;
  peak: number;
  over: number;
  refused: number;
}): string {
  const peak = formatNumber(input.peak);
  if (!input.on || input.perMinute === null) {
    return `No limit. Every request reaches the agent. Peak in this hour was ${peak} per minute.`;
  }
  const limit = formatNumber(input.perMinute);
  if (input.over <= 0) {
    return `Peak in this hour was ${peak} per minute. A limit of ${limit} would not have touched any request.`;
  }
  const noun = input.refused === 1 ? 'request' : 'requests';
  return `At ${limit} per minute, ${formatNumber(input.over)} of the last 60 minutes would have gone over, with ${formatNumber(input.refused)} ${noun} refused.`;
}
