import { IAgentLoadMinute } from './agentLimit.types';
import { dayDeltas, oldestWholeDay, utcDayOf } from './loadDay';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const D0 = Date.UTC(2027, 0, 15);

const minute = (
  at: number,
  counts: Partial<IAgentLoadMinute> = {},
): IAgentLoadMinute => ({
  minute: at,
  accepted: 0,
  refused: 0,
  refusedByMinute: 0,
  refusedByHour: 0,
  refusedByDay: 0,
  exempt: 0,
  ...counts,
});

describe('utcDayOf', () => {
  it('gives the start of the UTC day an instant falls in', () => {
    expect(utcDayOf(D0)).toBe(D0);
    expect(utcDayOf(D0 + 1)).toBe(D0);
    expect(utcDayOf(D0 + DAY - 1)).toBe(D0);
    expect(utcDayOf(D0 + DAY)).toBe(D0 + DAY);
  });

  it('does not depend on the zone the process runs in', () => {
    // 23:30 in New York on the 14th is already the 15th in UTC.
    expect(utcDayOf(Date.parse('2027-01-14T23:30:00-05:00'))).toBe(D0);
  });
});

describe('dayDeltas', () => {
  it('adds the minutes of one day into one row', () => {
    expect(
      dayDeltas([
        minute(D0 + 8 * 60 * MIN, { accepted: 3, exempt: 1 }),
        minute(D0 + 9 * 60 * MIN, {
          accepted: 2,
          refused: 4,
          refusedByMinute: 1,
          refusedByHour: 3,
        }),
      ]),
    ).toEqual([{ day: D0, accepted: 5, refused: 4, exempt: 1 }]);
  });

  it('puts 23:59 and 00:00 into two days, oldest first whatever the order', () => {
    expect(
      dayDeltas([
        minute(D0 + DAY, { accepted: 7 }),
        minute(D0 + DAY - MIN, { accepted: 1, refused: 2 }),
      ]),
    ).toEqual([
      { day: D0, accepted: 1, refused: 2, exempt: 0 },
      { day: D0 + DAY, accepted: 7, refused: 0, exempt: 0 },
    ]);
  });

  it('gives nothing for no minutes', () => {
    expect(dayDeltas([])).toEqual([]);
  });
});

describe('oldestWholeDay', () => {
  it('skips the day the retention boundary cuts through', () => {
    // At 08:00, thirty days back is 08:00 of a day whose first eight hours
    // may already be pruned; the first day with every minute is the next one.
    expect(oldestWholeDay(D0 + 8 * 60 * MIN, 30 * DAY)).toBe(D0 - 29 * DAY);
  });

  it('keeps a day the boundary only touches at its start', () => {
    expect(oldestWholeDay(D0, 30 * DAY)).toBe(D0 - 30 * DAY);
  });
});
