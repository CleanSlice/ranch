import { describe, expect, test } from 'bun:test';
import { wholeShare } from './share';

describe('wholeShare', () => {
  test('a part of a whole is a ratio rounded to a whole percent', () => {
    expect(wholeShare(2, 3)).toBe(0.67);
    expect(wholeShare(1, 3)).toBe(0.33);
    expect(wholeShare(1, 2)).toBe(0.5);
    expect(wholeShare(29, 200)).toBe(0.15);
  });

  test('nothing of something is zero, all of it is one', () => {
    expect(wholeShare(0, 7)).toBe(0);
    expect(wholeShare(7, 7)).toBe(1);
  });

  test('there is no share of nothing: not zero, not a division by zero', () => {
    expect(wholeShare(0, 0)).toBe(null);
    expect(wholeShare(3, 0)).toBe(null);
    expect(wholeShare(3, -1)).toBe(null);
  });

  test('a part larger than its whole is all of it: no share is over 100%', () => {
    // An answer that contradicts itself: 3 left open of 2 summarised.
    expect(wholeShare(3, 2)).toBe(1);
    expect(wholeShare(150, 100)).toBe(1);
  });

  test('a part under zero is none of it: no share is under 0%', () => {
    expect(wholeShare(-1, 4)).toBe(0);
  });

  test('what is not a number has no share', () => {
    expect(wholeShare(Number.NaN, 4)).toBe(null);
    expect(wholeShare(1, Number.NaN)).toBe(null);
    expect(wholeShare(1, Number.POSITIVE_INFINITY)).toBe(null);
  });
});
