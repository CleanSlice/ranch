import { describe, expect, test } from 'bun:test';
import { relativeTime } from './relativeTime';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  test('nothing, or a timestamp that does not parse, gives null', () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(undefined, NOW)).toBeNull();
    expect(relativeTime('not a date', NOW)).toBeNull();
  });

  test('under a minute is "just now"', () => {
    expect(relativeTime(ago(30_000), NOW)).toEqual({ key: 'relative_time.just_now', count: 0 });
    expect(relativeTime(ago(59_999), NOW)).toEqual({ key: 'relative_time.just_now', count: 0 });
  });

  test('minutes, hours and days are whole numbers rounded down', () => {
    expect(relativeTime(ago(5 * MIN), NOW)).toEqual({ key: 'relative_time.minutes', count: 5 });
    expect(relativeTime(ago(59 * MIN + 59_000), NOW)).toEqual({ key: 'relative_time.minutes', count: 59 });
    expect(relativeTime(ago(3 * HOUR + 20 * MIN), NOW)).toEqual({ key: 'relative_time.hours', count: 3 });
    expect(relativeTime(ago(2 * DAY + 5 * HOUR), NOW)).toEqual({ key: 'relative_time.days', count: 2 });
    expect(relativeTime(ago(30 * DAY), NOW)).toEqual({ key: 'relative_time.days', count: 30 });
  });

  test('a timestamp in the future reads as "just now", never as a negative count', () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toEqual({
      key: 'relative_time.just_now',
      count: 0,
    });
  });
});
