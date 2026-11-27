// The segments of a stacked bar: how wide each is and which are wide enough
// to print their percent inside (CLEAN-258). Pure on purpose: no Vue, no Nuxt
// aliases, so `bun test` runs it.

export interface IStackPart<K extends string = string> {
  key: K;
  value: number;
}

export interface IStackSegment<K extends string = string> {
  key: K;
  value: number;
  /** 0–1 of the bar: the segment's width. */
  share: number;
  /** The share as a whole percent: what the label and the tooltip print. */
  percent: number;
  /** Whether the percent fits inside the segment. */
  label: boolean;
}

/**
 * The narrowest segment that still gets its percent printed inside, in whole
 * percent. Both numbers come from the prototype
 * (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html,
 * `outcome()` prints a percent from 14 up, `models()` from 16 up) and are kept
 * as they were tuned there, by eye, at the cards' widths.
 */
export const OUTCOME_LABEL_MIN_PERCENT = 14;
export const MODEL_LABEL_MIN_PERCENT = 16;

/**
 * The parts above zero, in the order given, each with its share of their sum.
 *
 * A zero part is left out rather than drawn at no width: it would still take a
 * gap and a tab stop. Nothing above zero gives `[]`, and the caller shows its
 * empty line instead of a bar. Rounded percents are not forced to add up to
 * 100: each is the honest rounding of its own part, as in the prototype.
 */
export function stackSegments<K extends string>(
  parts: readonly IStackPart<K>[],
  labelMinPercent: number,
): IStackSegment<K>[] {
  const drawn = parts.filter((part) => Number.isFinite(part.value) && part.value > 0);
  const total = drawn.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) return [];

  return drawn.map((part) => {
    // Multiplied before dividing, as the prototype's `pct()` does, so that
    // 29 of 200 is 14.5 and not 14.499999999999998.
    const percent = Math.round((100 * part.value) / total);
    return {
      key: part.key,
      value: part.value,
      share: part.value / total,
      percent,
      label: percent >= labelMinPercent,
    };
  });
}
