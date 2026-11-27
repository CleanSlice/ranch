import { describe, expect, test } from 'bun:test';
import { MAX_STEPS, axisScale } from './axisScale';

describe('axisScale', () => {
  test('nothing to draw still has a scale: one step, from 0 to 1', () => {
    expect(axisScale([])).toEqual({ top: 1, step: 1, ticks: [0, 1] });
    expect(axisScale([0])).toEqual({ top: 1, step: 1, ticks: [0, 1] });
    expect(axisScale([0, 0, 0])).toEqual({ top: 1, step: 1, ticks: [0, 1] });
  });

  test('a maximum of 7: steps of 2 up to 8', () => {
    expect(axisScale([3, 7, 1])).toEqual({ top: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
  });

  test('a maximum of 950: steps of 200 up to 1 000', () => {
    expect(axisScale([950])).toEqual({
      top: 1000,
      step: 200,
      ticks: [0, 200, 400, 600, 800, 1000],
    });
  });

  test('a maximum of 12 000: steps of 5 000 up to 15 000', () => {
    expect(axisScale([12_000, 400])).toEqual({
      top: 15_000,
      step: 5000,
      ticks: [0, 5000, 10_000, 15_000],
    });
  });

  test('a maximum of 4 300 000: steps of a million up to five', () => {
    expect(axisScale([4_300_000])).toEqual({
      top: 5_000_000,
      step: 1_000_000,
      ticks: [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000],
    });
  });

  test('a flat series is scaled like any other: its value is the top', () => {
    expect(axisScale([500, 500, 500])).toEqual({
      top: 500,
      step: 100,
      ticks: [0, 100, 200, 300, 400, 500],
    });
  });

  test('tokens are whole: the step is never under one', () => {
    expect(axisScale([1])).toEqual({ top: 1, step: 1, ticks: [0, 1] });
    expect(axisScale([2])).toEqual({ top: 2, step: 1, ticks: [0, 1, 2] });
    expect(axisScale([3])).toEqual({ top: 3, step: 1, ticks: [0, 1, 2, 3] });
  });

  test('an exact power of ten is its own top', () => {
    expect(axisScale([1000]).top).toBe(1000);
    expect(axisScale([1_000_000]).top).toBe(1_000_000);
  });

  test('what is not a count is not a maximum', () => {
    expect(axisScale([Number.NaN, -5, Number.POSITIVE_INFINITY, 40])).toEqual({
      top: 40,
      step: 10,
      ticks: [0, 10, 20, 30, 40],
    });
  });

  test('never more than six steps, the top never under the maximum, whatever the maximum', () => {
    expect(MAX_STEPS).toBe(6);
    const maxima = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 20, 21, 49, 50, 51, 99, 100, 101];
    for (let power = 3; power <= 12; power++) {
      for (const lead of [1, 1.01, 1.2, 1.99, 2, 2.01, 2.5, 4.99, 5, 5.01, 7.3, 9.99]) {
        maxima.push(Math.round(lead * 10 ** power));
      }
    }
    for (let i = 0; i < maxima.length; i++) {
      const max = maxima[i]!;
      const scale = axisScale([max]);
      const steps = scale.ticks.length - 1;
      expect(steps <= MAX_STEPS).toBe(true);
      expect(steps >= 1).toBe(true);
      expect(scale.top >= max).toBe(true);
      // The top is the last tick, and one step less would not hold the maximum.
      expect(scale.ticks[steps]).toBe(scale.top);
      expect(scale.top - scale.step < max).toBe(true);
      expect(Number.isInteger(scale.step)).toBe(true);
    }
  });
});
