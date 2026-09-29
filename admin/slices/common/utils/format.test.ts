import { describe, expect, test } from 'bun:test';

import {
  compareInstants,
  compareText,
  formatClock,
  formatClockSeconds,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatMoney,
  formatNumber,
  formatStamp,
  formatStampDate,
} from './format';

// Dates are built with the local-time constructor and `now` is passed in, so
// the expectations hold in any time zone and on any day. The reference instant
// is the one in specs/018-english-admin-locale/contracts/admin-format.md.
const AT = new Date(2026, 7, 21, 0, 46, 12);
const NOW_SAME_DAY = new Date(2026, 7, 21, 18, 5, 0);
const NOW_SAME_YEAR = new Date(2026, 10, 2, 9, 0, 0);
const NOW_NEXT_YEAR = new Date(2027, 1, 3, 9, 0, 0);

describe('one format per kind of value', () => {
  test('date', () => {
    expect(formatDate(AT)).toBe('Aug 21, 2026');
  });

  test('date and time', () => {
    expect(formatDateTime(AT)).toBe('Aug 21, 2026, 00:46');
  });

  test('time of day', () => {
    expect(formatClock(AT)).toBe('00:46');
  });

  test('time of day, to the second', () => {
    expect(formatClockSeconds(AT)).toBe('00:46:12');
  });

  test('day divider', () => {
    expect(formatLongDate(AT)).toBe('August 21, 2026');
  });

  test('message time: today, earlier this year, an earlier year', () => {
    expect(formatStamp(AT, NOW_SAME_DAY)).toBe('00:46');
    expect(formatStamp(AT, NOW_SAME_YEAR)).toBe('Aug 21, 00:46');
    expect(formatStamp(AT, NOW_NEXT_YEAR)).toBe('Aug 21, 2026, 00:46');
  });

  test('modified: today, earlier this year, an earlier year', () => {
    expect(formatStampDate(AT, NOW_SAME_DAY)).toBe('00:46');
    expect(formatStampDate(AT, NOW_SAME_YEAR)).toBe('Aug 21');
    expect(formatStampDate(AT, NOW_NEXT_YEAR)).toBe('Aug 21, 2026');
  });

  test('count', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
  });

  test('amount', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
  });

  test('amount below a cent keeps the decimals it is given room for', () => {
    expect(formatMoney(0.0012, 4)).toBe('$0.0012');
    expect(formatMoney(12.3456, 4)).toBe('$12.3456');
    expect(formatMoney(1.5, 4)).toBe('$1.50');
    expect(formatMoney(0.0012)).toBe('$0.00');
  });
});

describe('the clock is 24-hour', () => {
  test('midnight is 00, never 24 and never 12 AM', () => {
    const midnight = new Date(2026, 7, 21, 0, 0, 0);
    expect(formatClock(midnight)).toBe('00:00');
    expect(formatClockSeconds(midnight)).toBe('00:00:00');
    expect(formatDateTime(midnight)).toBe('Aug 21, 2026, 00:00');
  });

  test('the afternoon carries no AM or PM', () => {
    const afternoon = new Date(2026, 7, 21, 15, 7, 9);
    expect(formatClock(afternoon)).toBe('15:07');
    expect(formatClockSeconds(afternoon)).toBe('15:07:09');
    expect(formatDateTime(afternoon)).toBe('Aug 21, 2026, 15:07');
    expect(formatStamp(afternoon, NOW_SAME_YEAR)).toBe('Aug 21, 15:07');
  });
});

describe('what a value can arrive as', () => {
  test('an ISO string, epoch milliseconds and a Date give the same text', () => {
    expect(formatDateTime(AT.toISOString())).toBe('Aug 21, 2026, 00:46');
    expect(formatDateTime(AT.getTime())).toBe('Aug 21, 2026, 00:46');
    expect(formatDateTime(AT)).toBe('Aug 21, 2026, 00:46');
  });

  test('nothing to format is an empty string, never "Invalid Date" or "NaN"', () => {
    const dates = [
      formatDate,
      formatDateTime,
      formatClock,
      formatClockSeconds,
      formatLongDate,
      formatStamp,
      formatStampDate,
    ];
    for (const format of dates) {
      expect(format(null)).toBe('');
      expect(format(undefined)).toBe('');
      expect(format('')).toBe('');
      expect(format('not a date')).toBe('');
      expect(format(Number.NaN)).toBe('');
      expect(format(new Date('nope'))).toBe('');
    }
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(undefined)).toBe('');
    expect(formatMoney(Number.NaN)).toBe('');
  });
});

describe('order', () => {
  test('names sort the same for every operator, case aside', () => {
    expect(['c', 'B', 'a'].sort(compareText)).toEqual(['a', 'B', 'c']);
    expect(['Zeta', 'alpha', 'Beta'].sort(compareText)).toEqual(['alpha', 'Beta', 'Zeta']);
  });

  test('instants sort by time, not by their text', () => {
    const earlier = '2026-08-21T09:00:00+03:00'; // 06:00Z
    const later = '2026-08-21T07:00:00Z';
    // As text `earlier` sorts after `later`; as instants it comes first.
    expect([later, earlier].sort(compareInstants)).toEqual([earlier, later]);
    expect(compareInstants(earlier, earlier)).toBe(0);
  });

  test('an unreadable instant sorts first and does not break the sort', () => {
    const sorted = ['2026-08-21T07:00:00Z', 'nope', '2026-01-01T00:00:00Z'].sort(
      compareInstants,
    );
    expect(sorted).toEqual(['nope', '2026-01-01T00:00:00Z', '2026-08-21T07:00:00Z']);
  });
});
