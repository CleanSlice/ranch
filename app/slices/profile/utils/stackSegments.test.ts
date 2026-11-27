import { describe, expect, test } from 'bun:test';
import {
  MODEL_LABEL_MIN_PERCENT,
  OUTCOME_LABEL_MIN_PERCENT,
  stackSegments,
} from './stackSegments';

const part = (key: string, value: number) => ({ key, value });

describe('the label thresholds', () => {
  test('14% on the outcome bar, 16% on the model bar', () => {
    expect(OUTCOME_LABEL_MIN_PERCENT).toBe(14);
    expect(MODEL_LABEL_MIN_PERCENT).toBe(16);
  });
});

describe('stackSegments', () => {
  test('each part gets its share and its rounded percent, in the order given', () => {
    expect(
      stackSegments([part('resolved', 6), part('open', 3), part('none', 1)], 14),
    ).toEqual([
      { key: 'resolved', value: 6, share: 0.6, percent: 60, label: true },
      { key: 'open', value: 3, share: 0.3, percent: 30, label: true },
      { key: 'none', value: 1, share: 0.1, percent: 10, label: false },
    ]);
  });

  test('the widths add up to the whole bar', () => {
    const segments = stackSegments(
      [part('a', 1), part('b', 1), part('c', 1), part('d', 4), part('e', 0)],
      14,
    );
    let total = 0;
    for (let i = 0; i < segments.length; i++) total += segments[i]?.share ?? 0;
    expect(Math.round(total * 1e9) / 1e9).toBe(1);
  });

  test('a zero part is left out', () => {
    const segments = stackSegments([part('resolved', 5), part('open', 0), part('none', 5)], 14);
    expect(segments.map((s) => s.key)).toEqual(['resolved', 'none']);
    expect(segments.map((s) => s.share)).toEqual([0.5, 0.5]);
  });

  test('a part under the threshold has no label, one on it has', () => {
    const segments = stackSegments([part('a', 13), part('b', 14), part('c', 73)], 14);
    expect(segments.map((s) => s.label)).toEqual([false, true, true]);
  });

  test('the threshold is the caller’s: the same parts on the model bar', () => {
    const parts = [part('a', 15), part('b', 16), part('c', 69)];
    expect(
      stackSegments(parts, OUTCOME_LABEL_MIN_PERCENT).map((s) => s.label),
    ).toEqual([true, true, true]);
    expect(stackSegments(parts, MODEL_LABEL_MIN_PERCENT).map((s) => s.label)).toEqual([
      false,
      true,
      true,
    ]);
  });

  test('the label goes by the rounded percent, the one that is printed', () => {
    // 13.6% prints as 14%.
    const segments = stackSegments([part('a', 136), part('b', 864)], 14);
    expect(segments[0]?.percent).toBe(14);
    expect(segments[0]?.label).toBe(true);
  });

  test('a half percent rounds up, as the prototype rounds it', () => {
    // 29 of 200 is 14.5%; dividing first gives 14.499999999999998 and 14.
    expect(stackSegments([part('a', 29), part('b', 171)], 14).map((s) => s.percent)).toEqual([
      15, 86,
    ]);
  });

  test('one part fills the bar', () => {
    expect(stackSegments([part('only', 7)], 14)).toEqual([
      { key: 'only', value: 7, share: 1, percent: 100, label: true },
    ]);
    expect(stackSegments([part('none', 0), part('only', 7)], 16)).toEqual([
      { key: 'only', value: 7, share: 1, percent: 100, label: true },
    ]);
  });

  test('nothing to draw: no parts, or all of them zero', () => {
    expect(stackSegments([], 14)).toEqual([]);
    expect(stackSegments([part('a', 0), part('b', 0)], 14)).toEqual([]);
  });

  test('a value that is not a count is left out like a zero', () => {
    expect(
      stackSegments([part('a', Number.NaN), part('b', -2), part('c', 4)], 14).map(
        (s) => s.key,
      ),
    ).toEqual(['c']);
  });
});
