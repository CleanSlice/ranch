import { describe, expect, test } from 'bun:test';
import {
  CALENDAR_DAYS,
  CALENDAR_WEEKS,
  calendarGrid,
  type ICalendarDay,
} from './calendarGrid';

const DAY_MS = 86_400_000;

/** `2026-11-26` moved by whole days, on the calendar and not on a clock. */
function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** What the API sends: 91 days, oldest first, ending today. */
function daysEnding(today: string, counts: Record<string, number> = {}): ICalendarDay[] {
  const out: ICalendarDay[] = [];
  for (let ago = CALENDAR_DAYS - 1; ago >= 0; ago--) {
    const date = shift(today, -ago);
    out.push({ date, conversations: counts[date] ?? 0 });
  }
  return out;
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// 2026-11-23 is a Monday; the prototype's own "today" is Thursday the 26th.
const MONDAY = '2026-11-23';
const THURSDAY = '2026-11-26';

describe('the size of the calendar', () => {
  test('13 weeks, 91 days', () => {
    expect(CALENDAR_WEEKS).toBe(13);
    expect(CALENDAR_DAYS).toBe(91);
  });
});

describe('calendarGrid: 13 Monday-first columns', () => {
  // `i` days after a Monday: 0 = today is a Monday … 6 = today is a Sunday.
  for (let i = 0; i < 7; i++) {
    const today = shift(MONDAY, i);

    test(`today on weekday ${i + 1}: the last column ends at today`, () => {
      const { cells } = calendarGrid(daysEnding(today), 30);

      // Twelve full weeks and the days of this week up to today.
      expect(cells.length).toBe(12 * 7 + i + 1);

      const first = cells[0];
      const last = cells[cells.length - 1];
      expect(first).toMatchObject({ column: 1, row: 1, date: shift(today, -(84 + i)) });
      expect(last).toMatchObject({ column: 13, row: i + 1, date: today, today: true });

      for (let k = 0; k < cells.length; k++) {
        const cell = cells[k];
        if (!cell) throw new Error('a hole in the cells');
        // One day after another, oldest first, none after today.
        expect(cell.date).toBe(shift(today, k - (cells.length - 1)));
        // Column by column, Monday at the top.
        expect(cell.column).toBe(Math.floor(k / 7) + 1);
        expect(cell.row).toBe((k % 7) + 1);
        expect((weekdayOf(cell.date) + 6) % 7).toBe(cell.row - 1);
      }
    });
  }

  test('a Sunday shows all 91 days, a Monday leaves the six oldest out', () => {
    const sunday = shift(MONDAY, 6);
    expect(calendarGrid(daysEnding(sunday), 90).cells.length).toBe(91);
    expect(calendarGrid(daysEnding(sunday), 90).cells[0]?.date).toBe(shift(sunday, -90));

    const monday = calendarGrid(daysEnding(MONDAY), 90).cells;
    expect(monday.length).toBe(85);
    expect(monday[0]?.date).toBe(shift(MONDAY, -84));
  });
});

describe('calendarGrid: counts', () => {
  test('each cell carries the count of its own day', () => {
    const { cells } = calendarGrid(
      daysEnding(THURSDAY, { '2026-11-26': 4, '2026-11-02': 2, '2026-09-01': 7 }),
      30,
    );
    const count = (date: string) => cells.find((c) => c.date === date)?.conversations;
    expect(count('2026-11-26')).toBe(4);
    expect(count('2026-11-02')).toBe(2);
    expect(count('2026-09-01')).toBe(7);
    expect(count('2026-11-25')).toBe(0);
  });

  test('a day older than the first Monday shown is not drawn', () => {
    const oldest = shift(MONDAY, -90);
    const { cells } = calendarGrid(daysEnding(MONDAY, { [oldest]: 9 }), 90);
    expect(cells.some((c) => c.date === oldest)).toBe(false);
    expect(cells.some((c) => c.conversations === 9)).toBe(false);
  });

  test('a day the list does not name is an empty day', () => {
    const short = daysEnding(THURSDAY, { '2026-11-20': 3 }).slice(-10);
    const { cells } = calendarGrid(short, 30);
    expect(cells.length).toBe(12 * 7 + 4);
    expect(cells.find((c) => c.date === '2026-11-20')?.conversations).toBe(3);
    expect(cells[0]?.conversations).toBe(0);
  });
});

describe('calendarGrid: dimming outside the period', () => {
  const periods = [7, 30, 90];

  for (let p = 0; p < periods.length; p++) {
    const period = periods[p] ?? 0;

    test(`${period} days: the newest ${period} days are inside`, () => {
      const { cells } = calendarGrid(daysEnding(THURSDAY), period);
      const lastIndex = cells.length - 1;
      for (let k = 0; k < cells.length; k++) {
        expect(cells[k]?.outside).toBe(lastIndex - k >= period);
      }
    });
  }

  test('7 and 30 days leave a dimmed past, 90 days dims nothing on a Thursday', () => {
    const outside = (period: number) =>
      calendarGrid(daysEnding(THURSDAY), period).cells.filter((c) => c.outside).length;
    // 88 cells on a Thursday.
    expect(outside(7)).toBe(81);
    expect(outside(30)).toBe(58);
    expect(outside(90)).toBe(0);
  });

  test('the edge by date: the last day inside and the first day outside', () => {
    const { cells } = calendarGrid(daysEnding(THURSDAY), 7);
    const outside = (date: string) => cells.find((c) => c.date === date)?.outside;
    expect(outside('2026-11-26')).toBe(false);
    expect(outside('2026-11-20')).toBe(false);
    expect(outside('2026-11-19')).toBe(true);
  });

  test('90 days on a Sunday dims the one day that is the 91st', () => {
    const sunday = shift(MONDAY, 6);
    const { cells } = calendarGrid(daysEnding(sunday), 90);
    expect(cells.filter((c) => c.outside).map((c) => c.date)).toEqual([shift(sunday, -90)]);
  });
});

describe('calendarGrid: today', () => {
  test('exactly one cell is today, and it is the last one', () => {
    const { cells } = calendarGrid(daysEnding(THURSDAY), 30);
    expect(cells.filter((c) => c.today).map((c) => c.date)).toEqual([THURSDAY]);
    expect(cells[cells.length - 1]?.today).toBe(true);
    expect(cells[cells.length - 1]).toMatchObject({ column: 13, row: 4 });
  });

  test('today is the last day of the list, whatever the clock here says', () => {
    const { cells } = calendarGrid(daysEnding('2031-03-09'), 7);
    expect(cells[cells.length - 1]?.date).toBe('2031-03-09');
  });
});

describe('calendarGrid: month labels', () => {
  const months = (today: string) => calendarGrid(daysEnding(today), 30).months;

  test('a month is named over the column whose Monday is in its first seven days', () => {
    // Mondays: Aug 31, Sep 7 … Nov 23. September starts in column 2.
    expect(months(THURSDAY)).toEqual([
      { column: 2, month: 8 },
      { column: 6, month: 9 },
      { column: 10, month: 10 },
    ]);
  });

  test('the first column is named when its Monday is no later than the 14th', () => {
    // First Monday shown: Sep 14.
    expect(months('2026-12-07')).toEqual([
      { column: 1, month: 8 },
      { column: 4, month: 9 },
      { column: 8, month: 10 },
      { column: 13, month: 11 },
    ]);
  });

  test('the first column stays bare when its Monday is later than the 14th', () => {
    // First Monday shown: Sep 21.
    expect(months('2026-12-14')).toEqual([
      { column: 3, month: 9 },
      { column: 7, month: 10 },
      { column: 12, month: 11 },
    ]);
  });

  test('a month named over the first column is not named again over the second', () => {
    // First Monday shown: Sep 7; the next, Sep 14, would pass the 14-day rule.
    expect(months('2026-11-30')).toEqual([
      { column: 1, month: 8 },
      { column: 5, month: 9 },
      { column: 9, month: 10 },
    ]);
  });

  test('across a new year the month number starts again at 0', () => {
    // Mondays: Oct 12 … Dec 28, Jan 4.
    expect(months('2027-01-06')).toEqual([
      { column: 1, month: 9 },
      { column: 4, month: 10 },
      { column: 9, month: 11 },
      { column: 13, month: 0 },
    ]);
  });

  test('the labels do not depend on the period', () => {
    expect(calendarGrid(daysEnding(THURSDAY), 7).months).toEqual(
      calendarGrid(daysEnding(THURSDAY), 90).months,
    );
  });
});

describe('calendarGrid: nothing to draw', () => {
  test('no days', () => {
    expect(calendarGrid([], 30)).toEqual({ cells: [], months: [] });
  });

  test('a last day that is not a date', () => {
    expect(calendarGrid([{ date: 'today', conversations: 2 }], 30)).toEqual({
      cells: [],
      months: [],
    });
    expect(calendarGrid([{ date: '2026-13-40', conversations: 2 }], 30)).toEqual({
      cells: [],
      months: [],
    });
  });
});
