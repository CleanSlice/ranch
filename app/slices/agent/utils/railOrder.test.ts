import { describe, expect, test } from 'bun:test';
import { railOrder } from './railOrder';

const agent = (id: string, isAdmin = false, pinned = false) => ({
  id,
  isAdmin,
  pinned,
});
const ids = (list: Array<{ id: string }>) => list.map((a) => a.id);

describe('railOrder', () => {
  test('puts pinned agents ahead of the unpinned ones (CLEAN-216)', () => {
    const list = [agent('a'), agent('b'), agent('fav', false, true), agent('c')];

    expect(ids(railOrder(list))).toEqual(['fav', 'a', 'b', 'c']);
  });

  test('keeps the Ranch admin agent ahead of the pinned ones', () => {
    const list = [agent('fav', false, true), agent('a'), agent('rancher', true)];

    expect(ids(railOrder(list))).toEqual(['rancher', 'fav', 'a']);
  });

  test('keeps the incoming order inside the pinned block and the rest', () => {
    const list = [
      agent('b'),
      agent('fav-2', false, true),
      agent('a'),
      agent('fav-1', false, true),
    ];

    expect(ids(railOrder(list))).toEqual(['fav-2', 'fav-1', 'b', 'a']);
  });

  test('changes nothing when every agent is pinned', () => {
    const list = [
      agent('c', false, true),
      agent('a', false, true),
      agent('b', false, true),
    ];

    expect(ids(railOrder(list))).toEqual(['c', 'a', 'b']);
  });

  test('treats a missing pinned flag as unpinned', () => {
    const list = [{ id: 'a', isAdmin: false }, { id: 'fav', isAdmin: false, pinned: true }];

    expect(ids(railOrder(list))).toEqual(['fav', 'a']);
  });

  test('puts the Ranch admin agent first, wherever the list had it', () => {
    const list = [agent('newest'), agent('middle'), agent('rancher', true)];

    expect(ids(railOrder(list))).toEqual(['rancher', 'newest', 'middle']);
  });

  test('keeps the other agents in the order they came in', () => {
    const list = [
      agent('c'),
      agent('rancher', true),
      agent('a'),
      agent('b'),
    ];

    expect(ids(railOrder(list))).toEqual(['rancher', 'c', 'a', 'b']);
  });

  test('changes nothing when no agent is the admin agent', () => {
    const list = [agent('c'), agent('a'), agent('b')];

    expect(ids(railOrder(list))).toEqual(['c', 'a', 'b']);
  });

  test('puts several admin agents first, in the order they came in', () => {
    const list = [
      agent('a'),
      agent('admin-2', true),
      agent('b'),
      agent('admin-1', true),
    ];

    expect(ids(railOrder(list))).toEqual(['admin-2', 'admin-1', 'a', 'b']);
  });

  test('returns a new list and leaves the one it was given alone', () => {
    const list = [agent('a'), agent('rancher', true)];

    const ordered = railOrder(list);

    expect(ids(list)).toEqual(['a', 'rancher']);
    expect(ordered === list).toBe(false);
  });

  test('an empty list stays empty', () => {
    expect(railOrder([])).toEqual([]);
  });
});
