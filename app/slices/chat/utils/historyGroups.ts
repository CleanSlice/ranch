// The headings of an agent's closed conversations (CLEAN-248): Today, This
// week, Earlier, by the local calendar day of the last activity.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export type HistoryGroupKey = 'today' | 'this_week' | 'earlier';

export interface IHistoryGroup<T> {
  key: HistoryGroupKey;
  items: T[];
}

/**
 * "This week" is the six days before today, not the calendar week: on a
 * Monday, yesterday's conversation must not already be under Earlier.
 */
const WEEK_DAYS_BEFORE_TODAY = 6;

const ORDER: HistoryGroupKey[] = ['today', 'this_week', 'earlier'];

/**
 * Split conversations into the three groups, keeping the order they came in.
 * A group with nothing in it is left out. `now` is a parameter so a test can
 * hold the day still.
 */
export function groupClosed<T extends { lastMessageAt: string }>(
  conversations: T[],
  now: Date = new Date(),
): IHistoryGroup<T>[] {
  // Local midnight: `Date` normalises a day number below 1 into the month
  // before, so the subtraction is safe at the start of a month.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - WEEK_DAYS_BEFORE_TODAY,
  ).getTime();

  const buckets: Record<HistoryGroupKey, T[]> = { today: [], this_week: [], earlier: [] };
  for (const conversation of conversations) {
    const at = Date.parse(conversation.lastMessageAt);
    // A date that cannot be read is treated as old: it must not sit at the
    // top of the list as if it had just happened.
    if (Number.isNaN(at) || at < week) buckets.earlier.push(conversation);
    else if (at < today) buckets.this_week.push(conversation);
    else buckets.today.push(conversation);
  }

  return ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    items: buckets[key],
  }));
}
