import { describe, expect, test } from 'bun:test';

import { limitTimeView } from './limitTime';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** A wall-clock moment in the machine's own timezone, so the day boundary
 *  below is the reader's midnight wherever the tests run. */
const at = (h: number, m: number, s = 0) =>
  new Date(2026, 10, 16, h, m, s).getTime();

const NOON = at(12, 0);

describe('limitTimeView', () => {
  test('under a minute it counts seconds', () => {
    expect(limitTimeView(42 * SECOND, NOON)).toEqual({
      kind: 'countdown',
      text: '0:42',
    });
  });

  test('under an hour it counts minutes and seconds', () => {
    expect(limitTimeView(12 * MINUTE + 5 * SECOND, NOON)).toEqual({
      kind: 'countdown',
      text: '12:05',
    });
    expect(limitTimeView(59 * MINUTE + 59 * SECOND, NOON)).toEqual({
      kind: 'countdown',
      text: '59:59',
    });
  });

  test('a started second counts as a whole one', () => {
    expect(limitTimeView(41 * SECOND + 1, NOON)).toEqual({
      kind: 'countdown',
      text: '0:42',
    });
    expect(limitTimeView(59 * SECOND + 500, NOON)).toEqual({
      kind: 'countdown',
      text: '1:00',
    });
  });

  test('it never reads 0:00 while there is still something to wait for', () => {
    expect(limitTimeView(1, NOON)).toEqual({ kind: 'countdown', text: '0:01' });
    expect(limitTimeView(999, NOON)).toEqual({ kind: 'countdown', text: '0:01' });
  });

  test('at zero, and past it, the wait is over', () => {
    expect(limitTimeView(0, NOON)).toEqual({ kind: 'ready' });
    expect(limitTimeView(-5 * SECOND, NOON)).toEqual({ kind: 'ready' });
  });

  test('a wait that is not a number is over too', () => {
    expect(limitTimeView(Number.NaN, NOON)).toEqual({ kind: 'ready' });
  });

  test('an hour or more is a time of day, not a running clock', () => {
    expect(limitTimeView(HOUR, NOON)).toEqual({ kind: 'clock', at: at(13, 0) });
    expect(limitTimeView(2 * HOUR + 30 * MINUTE, NOON)).toEqual({
      kind: 'clock',
      at: at(14, 30),
    });
  });

  test('a second short of an hour that rounds up to it is a time of day', () => {
    expect(limitTimeView(HOUR - 1, NOON)).toEqual({ kind: 'clock', at: at(13, 0) });
  });

  test('the time of day is rounded up to the minute, never to before the end', () => {
    // Ends at 14:30:20 — "after 14:30" would invite a send twenty seconds early.
    expect(limitTimeView(2 * HOUR + 30 * MINUTE + 20 * SECOND, NOON)).toEqual({
      kind: 'clock',
      at: at(14, 31),
    });
  });

  test('an end on the next local day says tomorrow', () => {
    const evening = at(22, 45);
    const view = limitTimeView(10 * HOUR + 30 * MINUTE, evening);
    expect(view).toEqual({
      kind: 'tomorrow',
      at: new Date(2026, 10, 17, 9, 15).getTime(),
    });
  });

  test('an end exactly at midnight is already tomorrow', () => {
    expect(limitTimeView(HOUR, at(23, 0))).toEqual({
      kind: 'tomorrow',
      at: new Date(2026, 10, 17, 0, 0).getTime(),
    });
  });

  test('a short wait across midnight is still a countdown', () => {
    expect(limitTimeView(5 * MINUTE, at(23, 58))).toEqual({
      kind: 'countdown',
      text: '5:00',
    });
  });
});
