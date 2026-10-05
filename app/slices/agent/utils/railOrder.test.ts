import { describe, expect, test } from 'bun:test';
import { railOrder } from './railOrder';

const agent = (id: string, isAdmin = false) => ({ id, isAdmin });
const ids = (list: Array<{ id: string }>) => list.map((a) => a.id);

describe('railOrder', () => {
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
