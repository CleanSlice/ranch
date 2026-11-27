import { describe, expect, test } from 'bun:test';
import { compare } from './delta';

describe('compare', () => {
  test('a rise is a positive rounded percent', () => {
    expect(compare(120, 100)).toEqual({ kind: 'up', percent: 20 });
    expect(compare(3, 1)).toEqual({ kind: 'up', percent: 200 });
    expect(compare(7, 6)).toEqual({ kind: 'up', percent: 17 });
  });

  test('a fall is a positive rounded percent too: the kind says the direction', () => {
    expect(compare(80, 100)).toEqual({ kind: 'down', percent: 20 });
    expect(compare(5, 6)).toEqual({ kind: 'down', percent: 17 });
    expect(compare(0, 10)).toEqual({ kind: 'down', percent: 100 });
  });

  test('equal figures are the same', () => {
    expect(compare(100, 100)).toEqual({ kind: 'same' });
  });

  test('a change that rounds to zero percent is the same', () => {
    expect(compare(1001, 1000)).toEqual({ kind: 'same' });
    expect(compare(999, 1000)).toEqual({ kind: 'same' });
  });

  test('nothing in the previous period is no comparison, not an infinite rise', () => {
    expect(compare(12, 0)).toEqual({ kind: 'none' });
    expect(compare(0, 0)).toEqual({ kind: 'none' });
  });

  test('a previous figure that is not a count is no comparison', () => {
    expect(compare(12, Number.NaN)).toEqual({ kind: 'none' });
    expect(compare(12, -4)).toEqual({ kind: 'none' });
    expect(compare(Number.NaN, 10)).toEqual({ kind: 'none' });
  });
});
