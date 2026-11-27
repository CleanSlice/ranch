import { describe, expect, test } from 'bun:test';
import { spanOf } from './span';

const at = (iso: string) => new Date(iso);
const FROM = at('2026-11-25T08:00:00.000Z');

describe('spanOf', () => {
  test('under a minute has no number', () => {
    expect(spanOf(FROM, at('2026-11-25T08:00:00.000Z'))).toEqual({
      key: 'stats.span.under_minute',
      params: {},
    });
    expect(spanOf(FROM, at('2026-11-25T08:00:59.999Z'))).toEqual({
      key: 'stats.span.under_minute',
      params: {},
    });
  });

  test('minutes, whole, rounded down', () => {
    expect(spanOf(FROM, at('2026-11-25T08:01:00.000Z'))).toEqual({
      key: 'stats.span.minutes',
      params: { minutes: 1 },
    });
    expect(spanOf(FROM, at('2026-11-25T08:59:59.000Z'))).toEqual({
      key: 'stats.span.minutes',
      params: { minutes: 59 },
    });
  });

  test('hours, with the minutes left over when there are any', () => {
    expect(spanOf(FROM, at('2026-11-25T10:00:30.000Z'))).toEqual({
      key: 'stats.span.hours',
      params: { hours: 2 },
    });
    expect(spanOf(FROM, at('2026-11-25T10:05:00.000Z'))).toEqual({
      key: 'stats.span.hours_minutes',
      params: { hours: 2, minutes: 5 },
    });
    expect(spanOf(FROM, at('2026-11-26T07:59:00.000Z'))).toEqual({
      key: 'stats.span.hours_minutes',
      params: { hours: 23, minutes: 59 },
    });
  });

  test('days, with the hours left over; minutes no longer matter', () => {
    expect(spanOf(FROM, at('2026-11-26T08:40:00.000Z'))).toEqual({
      key: 'stats.span.days',
      params: { days: 1 },
    });
    expect(spanOf(FROM, at('2026-11-28T13:59:00.000Z'))).toEqual({
      key: 'stats.span.days_hours',
      params: { days: 3, hours: 5 },
    });
  });

  test('no span without both ends, or when the end is before the start', () => {
    expect(spanOf(FROM, null)).toBe(null);
    expect(spanOf(null, FROM)).toBe(null);
    expect(spanOf(FROM, new Date(Number.NaN))).toBe(null);
    expect(spanOf(FROM, at('2026-11-25T07:59:59.000Z'))).toBe(null);
  });
});
