import { IAgentLoadMinute, WINDOW_MS } from './agentLimit.types';

/**
 * Requests per agent per UTC day (CLEAN-261): the arithmetic that turns the
 * per-minute counts into the day rows a period longer than the minutes'
 * retention is read from.
 */

/** What a flush adds to one day row. */
export interface IAgentLoadDayDelta {
  /** Start of the day, epoch ms (UTC). */
  day: number;
  accepted: number;
  refused: number;
  exempt: number;
}

/**
 * Start of the UTC day an instant falls in, epoch ms. Epoch time has no leap
 * seconds and starts at a UTC midnight, so this is plain division and never
 * the zone of the machine.
 */
export function utcDayOf(ms: number): number {
  return Math.floor(ms / WINDOW_MS.day) * WINDOW_MS.day;
}

/**
 * The same counts by UTC day, oldest first. A day row is only ever given
 * what its minute rows are given, which is what keeps the two equal.
 */
export function dayDeltas(minutes: IAgentLoadMinute[]): IAgentLoadDayDelta[] {
  const byDay = new Map<number, IAgentLoadDayDelta>();
  for (const m of minutes) {
    const day = utcDayOf(m.minute);
    let delta = byDay.get(day);
    if (!delta) {
      delta = { day, accepted: 0, refused: 0, exempt: 0 };
      byDay.set(day, delta);
    }
    delta.accepted += m.accepted;
    delta.refused += m.refused;
    delta.exempt += m.exempt;
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

/**
 * The earliest UTC day that still has every one of its minutes when minutes
 * are kept for `keptMs`. The day the boundary cuts through is left out: its
 * first hours may be gone, and a sum of what is left would pass for the day.
 */
export function oldestWholeDay(now: number, keptMs: number): number {
  return Math.ceil((now - keptMs) / WINDOW_MS.day) * WINDOW_MS.day;
}
