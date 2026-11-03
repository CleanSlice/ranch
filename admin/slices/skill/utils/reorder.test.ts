import { describe, expect, test } from 'bun:test';
import { badgeFor, moveVisible, orderDiff, toOrderItems } from './reorder';

describe('moveVisible', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('with nothing hidden it is a plain move', () => {
    expect(moveVisible(full, full, 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e', 'f']);
    expect(moveVisible(full, full, 5, 0)).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
  });

  test('inside a filtered view the hidden rows keep their places', () => {
    // Visible: b, d, f (slots 1, 3, 5). Move f (visible index 2) to the top.
    expect(moveVisible(full, ['b', 'd', 'f'], 2, 0)).toEqual(['a', 'f', 'c', 'b', 'e', 'd']);
  });

  test('a no-op or out-of-range move returns the same order', () => {
    expect(moveVisible(full, full, 2, 2)).toEqual(full);
    expect(moveVisible(full, ['b', 'd'], 1, 5)).toEqual(full);
  });
});

describe('orderDiff', () => {
  test('badges relative to the saved order and the moved count', () => {
    const saved = ['a', 'b', 'c', 'd'];
    const draft = ['b', 'c', 'a', 'd'];
    const diff = orderDiff(saved, draft);
    expect(diff.byId).toEqual({ b: 1, c: 1, a: -2, d: 0 });
    expect(diff.movedCount).toBe(3);
    expect(badgeFor(diff.byId.a)).toBe('↓2');
    expect(badgeFor(diff.byId.b)).toBe('↑1');
    expect(badgeFor(diff.byId.d)).toBe('');
  });

  test('identical orders move nothing', () => {
    expect(orderDiff(['a', 'b'], ['a', 'b']).movedCount).toBe(0);
  });
});

describe('toOrderItems', () => {
  test('1-based positions', () => {
    expect(toOrderItems(['x', 'y'])).toEqual([
      { id: 'x', sortOrder: 1 },
      { id: 'y', sortOrder: 2 },
    ]);
  });
});
