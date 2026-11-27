// The value axis of the spend chart: where it ends and where its lines stand
// (CLEAN-265). Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export interface IAxisScale {
  /** The value at the top of the chart: the last tick, never under the maximum. */
  top: number;
  /** The distance between two lines. Whole: what is counted is tokens. */
  step: number;
  /** Every line's value, from 0 to `top`. */
  ticks: number[];
}

/**
 * The most steps an axis is cut into. The chart is 170 px high and a value
 * is printed at every line: six leave each of them about 28 px, which a
 * 10 px label reads in; more would be a ladder of numbers.
 */
export const MAX_STEPS = 6;

/** What the step is chosen for. The result is three to five steps. */
const TARGET_STEPS = 5;

/**
 * A scale for the values given: steps of 1, 2 or 5 times a power of ten, the
 * roundest of them that cut the axis into at most `TARGET_STEPS`, and a top
 * that is the first line at or above the maximum.
 *
 * The prototype's own rule (steps of 1 or 2 times the maximum's power of ten)
 * gave a maximum of 12 000 two steps and a chart 40% empty; with 5 in the
 * ladder the same maximum gets three steps and a top of 15 000.
 *
 * With nothing above zero the scale is one step from 0 to 1, so that whoever
 * divides by `top` never divides by zero. What is not a count (a negative, a
 * NaN, an infinity) is not a maximum and is passed over.
 */
export function axisScale(values: readonly number[]): IAxisScale {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value;
  }
  if (max <= 0) return { top: 1, step: 1, ticks: [0, 1] };

  const rough = max / TARGET_STEPS;
  let power = Math.floor(Math.log10(rough));
  // `log10` may land a hair on the wrong side of a whole number.
  if (10 ** (power + 1) <= rough) power += 1;
  else if (10 ** power > rough) power -= 1;
  const unit = 10 ** power;
  const lead = rough / unit;
  const nice = lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
  // Under one only for a maximum under five, where whole steps of one are
  // at most four.
  const step = Math.max(1, nice * unit);

  const steps = Math.ceil(max / step);
  const ticks: number[] = [];
  for (let i = 0; i <= steps; i++) ticks.push(i * step);
  return { top: steps * step, step, ticks };
}
