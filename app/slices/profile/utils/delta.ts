// A figure against the same figure of the period before (CLEAN-258). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

/**
 * What to say under a scoreboard figure. It is a kind and not a sentence: the
 * component picks the i18n key and formats the percent, so the wording stays
 * in `en.json`.
 *
 * `percent` is whole and positive; the direction is in the kind.
 */
export type Delta =
  | { kind: 'none' }
  | { kind: 'same' }
  | { kind: 'up'; percent: number }
  | { kind: 'down'; percent: number };

/**
 * The rule is the prototype's `delta()`
 * (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html):
 * nothing before means no comparison, because a rise from zero has no percent;
 * a change that rounds to 0% reads as "the same", because "▲ 0%" says nothing.
 */
export function compare(current: number, previous: number): Delta {
  if (!(previous > 0) || !Number.isFinite(current)) return { kind: 'none' };
  const percent = Math.round((100 * (current - previous)) / previous);
  if (percent === 0) return { kind: 'same' };
  return percent > 0 ? { kind: 'up', percent } : { kind: 'down', percent: -percent };
}
