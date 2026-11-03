/**
 * When a skill was last touched, as the Skills page reads it (CLEAN-205):
 * a green dot for anything under a day old, and the summary's "edited this
 * week". Pure functions over ISO strings and an explicit `now`, so the tests
 * pin the boundaries; the live relative text itself comes from
 * `useRelativeTime`, which already ticks on its own.
 */
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export interface Edited {
  updatedAt: string;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Under `windowMs` old (a day by default): the row shows the green dot. */
export function isRecent(updatedAt: string, now: Date, windowMs = DAY_MS): boolean {
  const age = now.getTime() - ms(updatedAt);
  return age >= 0 && age < windowMs;
}

/** How many were edited in the last seven days, and the newest edit of all. */
export function editedThisWeek(
  skills: readonly Edited[],
  now: Date,
): { count: number; latest: string | null } {
  let count = 0;
  let latest: string | null = null;
  for (const s of skills) {
    if (isRecent(s.updatedAt, now, WEEK_MS)) count++;
    if (latest === null || ms(s.updatedAt) > ms(latest)) latest = s.updatedAt;
  }
  return { count, latest };
}

/** Newest first, ties by name so the order is stable between renders. */
export function byRecentEdit<T extends Edited & { name: string }>(skills: readonly T[]): T[] {
  return [...skills].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt) || (a.name < b.name ? -1 : 1));
}
