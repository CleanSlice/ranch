import { describe, expect, test } from 'bun:test';
import { closeTab, hasUnsaved, openTab } from './tabs';

describe('openTab', () => {
  test('appends a new path once', () => {
    expect(openTab(['a.md'], 'b.md')).toEqual(['a.md', 'b.md']);
    expect(openTab(['a.md', 'b.md'], 'b.md')).toEqual(['a.md', 'b.md']);
  });
});

describe('closeTab', () => {
  test('activates the right neighbour, then the left one, then nothing', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ tabs: ['a', 'c'], active: 'c' });
    expect(closeTab(['a', 'b', 'c'], 'c', 'c')).toEqual({ tabs: ['a', 'b'], active: 'b' });
    expect(closeTab(['a'], 'a', 'a')).toEqual({ tabs: [], active: null });
  });

  test('keeps an unrelated active tab and ignores unknown paths', () => {
    expect(closeTab(['a', 'b'], 'a', 'b')).toEqual({ tabs: ['b'], active: 'b' });
    expect(closeTab(['a', 'b'], 'zzz', 'a')).toEqual({ tabs: ['a', 'b'], active: 'a' });
  });
});

describe('hasUnsaved', () => {
  test('answers for the whole agent or one path', () => {
    expect(hasUnsaved([])).toBe(false);
    expect(hasUnsaved(['x.md'])).toBe(true);
    expect(hasUnsaved(['x.md'], 'y.md')).toBe(false);
    expect(hasUnsaved(['x.md'], 'x.md')).toBe(true);
  });
});
