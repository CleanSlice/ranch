// A part of a whole, as the statistics print it (CLEAN-270). Pure on purpose:
// no Vue, no Nuxt aliases, so `bun test` runs it.

/**
 * The part as a ratio of the whole, rounded to a whole percent the way the
 * prototype's `pct()` rounds: 2 of 3 is 0.67, which the format module prints
 * as "67%". Rounded here and not where it is printed, so that two shares that
 * read the same also compare as equal.
 *
 * Null when there is no whole: no share to show, which is not a share of
 * zero. The caller draws a dash for it.
 *
 * The part is held inside its whole: an answer that contradicts itself (3
 * left open of 2 summarised) is all of it, never "150%", and a part under
 * zero is none of it.
 */
export function wholeShare(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  const within = Math.min(Math.max(part, 0), whole);
  // Multiplied before dividing, as in `stackSegments`: 29 of 200 is 14.5.
  return Math.round((100 * within) / whole) / 100;
}
