import { describe, expect, test } from 'bun:test';
import { chartTop, isLimitAboveScale, limitPreview, verdictText } from './limitPreview';

const series = (...accepted: number[]) => accepted.map((n) => ({ accepted: n }));

describe('limitPreview', () => {
  test('the peak is the busiest minute', () => {
    expect(limitPreview(series(0, 3, 7, 2), null)).toEqual({ peak: 7, over: 0, refused: 0 });
  });

  test('no limit: nothing is over, nothing refused', () => {
    expect(limitPreview(series(50, 60), null)).toEqual({ peak: 60, over: 0, refused: 0 });
  });

  test('minutes above the limit and the requests above it in them', () => {
    expect(limitPreview(series(1, 5, 8, 12, 5), 5)).toEqual({ peak: 12, over: 2, refused: 10 });
  });

  test('a minute exactly at the limit is not over', () => {
    expect(limitPreview(series(5, 5), 5)).toEqual({ peak: 5, over: 0, refused: 0 });
  });

  test('an empty hour', () => {
    expect(limitPreview([], 10)).toEqual({ peak: 0, over: 0, refused: 0 });
  });

  test('text that is not a number is no limit', () => {
    expect(limitPreview(series(9), Number.NaN)).toEqual({ peak: 9, over: 0, refused: 0 });
  });
});

describe('chartTop', () => {
  test('never below 4, so an idle hour still has a scale', () => {
    expect(chartTop(0, null)).toBe(4);
    expect(chartTop(0, 60)).toBe(4);
    expect(chartTop(2, null)).toBe(4);
  });

  test('with no limit the traffic gets a quarter of headroom', () => {
    expect(chartTop(8, null)).toBe(10);
  });

  test('a limit near the traffic is inside the scale', () => {
    // max(10 × 1.25, min(12, 22) × 1.12) = 13.44
    expect(chartTop(10, 12)).toBe(12 * 1.12);
    expect(isLimitAboveScale(10, 12)).toBe(false);
  });

  test('a limit far above the traffic does not flatten the bars', () => {
    // max(12.5, min(600, 22) × 1.12) = 24.64
    expect(chartTop(10, 600)).toBe(22 * 1.12);
    expect(isLimitAboveScale(10, 600)).toBe(true);
  });

  test('a limit below the traffic leaves the scale to the traffic', () => {
    expect(chartTop(40, 5)).toBe(50);
    expect(isLimitAboveScale(40, 5)).toBe(false);
    expect(isLimitAboveScale(40, null)).toBe(false);
  });
});

describe('verdictText', () => {
  test('no limit', () => {
    expect(verdictText({ on: false, perMinute: null, peak: 7, over: 0, refused: 0 })).toBe(
      'No limit. Every request reaches the agent. Peak in this hour was 7 per minute.',
    );
    // Switched on with the per-minute field still empty.
    expect(verdictText({ on: true, perMinute: null, peak: 7, over: 0, refused: 0 })).toBe(
      'No limit. Every request reaches the agent. Peak in this hour was 7 per minute.',
    );
  });

  test('a limit that would not have touched anything', () => {
    expect(verdictText({ on: true, perMinute: 60, peak: 7, over: 0, refused: 0 })).toBe(
      'Peak in this hour was 7 per minute. A limit of 60 would not have touched any request.',
    );
  });

  test('a limit that would have refused one request', () => {
    expect(verdictText({ on: true, perMinute: 6, peak: 7, over: 1, refused: 1 })).toBe(
      'At 6 per minute, 1 of the last 60 minutes would have gone over, with 1 request refused.',
    );
  });

  test('a limit that would have refused several', () => {
    expect(verdictText({ on: true, perMinute: 5, peak: 1200, over: 12, refused: 3400 })).toBe(
      'At 5 per minute, 12 of the last 60 minutes would have gone over, with 3,400 requests refused.',
    );
  });
});
