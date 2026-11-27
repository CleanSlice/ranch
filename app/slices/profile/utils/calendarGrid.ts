// Where each day sits in the activity calendar: 13 weeks as columns, Monday
// at the top, the last column ending at today (CLEAN-258). Pure on purpose: no
// Vue, no Nuxt aliases, so `bun test` runs it.
//
// The layout is the prototype's `activity()`
// (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html).
//
// Days are handled as `YYYY-MM-DD` strings and moved with UTC arithmetic only.
// The API has already put every conversation on a day in the viewer's zone;
// reading such a string into a local-time `Date` here would apply this
// browser's zone a second time and can land on the day before.

export interface ICalendarDay {
  /** `YYYY-MM-DD`, a calendar day in the viewer's zone as the API counted it. */
  date: string;
  conversations: number;
}

export interface ICalendarCell {
  /** 1–13, the oldest week first. */
  column: number;
  /** 1–7, Monday = 1. */
  row: number;
  date: string;
  conversations: number;
  /** Older than the selected period: drawn dimmed. */
  outside: boolean;
  today: boolean;
}

export interface ICalendarMonth {
  /** The column the name stands over, 1–13. */
  column: number;
  /** 0–11; the component turns it into a name in the active language. */
  month: number;
}

export interface ICalendarGrid {
  /** Oldest first: column by column, Monday down to Sunday. */
  cells: ICalendarCell[];
  months: ICalendarMonth[];
}

/** Columns of the calendar, one per week. From the prototype. */
export const CALENDAR_WEEKS = 13;

/**
 * Days the API sends, oldest first and ending today: 13 full weeks. A Sunday
 * shows all of them; any other day leaves the oldest few before the first
 * Monday undrawn.
 */
export const CALENDAR_DAYS = CALENDAR_WEEKS * 7;

/**
 * From the prototype: a month is named over the week whose Monday falls in its
 * first seven days, and the first column is also named while its Monday is no
 * later than the 14th, that is, while the month still has about three weeks
 * on screen to stand over.
 */
const MONTH_STARTS_BY = 7;
const FIRST_COLUMN_NAMED_BY = 14;

const DAY_MS = 86_400_000;
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `YYYY-MM-DD` day as the UTC midnight that carries it, or null. */
function dayToUtc(date: string): number | null {
  const match = DAY_SHAPE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  // `Date.UTC` rolls the 40th of month 13 over into a real day; a string that
  // does not come back as itself was never a date.
  return utcToDay(utc) === date ? utc : null;
}

function utcToDay(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * The grid for a list of days and the selected period in days.
 *
 * Today is the last day of the list, not the clock of this browser: the API
 * decided which day it is in the viewer's zone, and the calendar must agree
 * with the figures beside it. A day the list does not name is an empty day; a
 * list with no usable last day gives an empty grid.
 */
export function calendarGrid(days: readonly ICalendarDay[], period: number): ICalendarGrid {
  const last = days[days.length - 1];
  const today = last ? dayToUtc(last.date) : null;
  if (today === null) return { cells: [], months: [] };

  const counts = new Map<string, number>();
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (day) counts.set(day.date, day.conversations);
  }

  // 0 = Monday … 6 = Sunday.
  const todayRow = (new Date(today).getUTCDay() + 6) % 7;
  // The Monday of the first column: twelve weeks before this week's.
  const firstMonday = today - ((CALENDAR_WEEKS - 1) * 7 + todayRow) * DAY_MS;

  const cells: ICalendarCell[] = [];
  const months: ICalendarMonth[] = [];
  let namedMonth = -1;

  for (let week = 0; week < CALENDAR_WEEKS; week++) {
    const monday = firstMonday + week * 7 * DAY_MS;
    const mondayDate = new Date(monday);
    const month = mondayDate.getUTCMonth();
    const dayOfMonth = mondayDate.getUTCDate();
    if (
      month !== namedMonth &&
      (dayOfMonth <= MONTH_STARTS_BY || (week === 0 && dayOfMonth <= FIRST_COLUMN_NAMED_BY))
    ) {
      months.push({ column: week + 1, month });
      namedMonth = month;
    }

    for (let row = 0; row < 7; row++) {
      const utc = monday + row * DAY_MS;
      // The rest of this week has not happened yet: no cell, not an empty one.
      if (utc > today) break;
      const date = utcToDay(utc);
      const daysAgo = Math.round((today - utc) / DAY_MS);
      cells.push({
        column: week + 1,
        row: row + 1,
        date,
        conversations: counts.get(date) ?? 0,
        outside: daysAgo >= period,
        today: daysAgo === 0,
      });
    }
  }

  return { cells, months };
}
