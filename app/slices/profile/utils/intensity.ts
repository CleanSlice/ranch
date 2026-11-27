// How strongly a day is painted in the activity calendar (CLEAN-258). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

/** An index into the five steps of the calendar's one hue: `--s0` … `--s4`. */
export type IntensityLevel = 0 | 1 | 2 | 3 | 4;

export const INTENSITY_LEVELS = 5;

/**
 * 0 → 0, 1 → 1, 2 → 2, 3–4 → 3, 5 and more → 4.
 *
 * The steps come from the prototype
 * (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html,
 * `lvl` in `activity()`) and so do the five colours they index. They are
 * counts, not shares of the person's busiest day: the same colour means the
 * same number of conversations on every profile.
 */
export function intensityLevel(conversations: number): IntensityLevel {
  // Written so that NaN and a negative count fall into "nothing".
  if (!(conversations >= 1)) return 0;
  if (conversations < 2) return 1;
  if (conversations < 3) return 2;
  if (conversations <= 4) return 3;
  return 4;
}
