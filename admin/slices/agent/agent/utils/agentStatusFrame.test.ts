import { describe, expect, test } from 'bun:test';
import { collectionIsStale, rowIsStale } from './agentStatusFrame';

const row = (id: string, updatedAt: string) => ({ id, updatedAt });
const T1 = '2026-11-17T10:00:00.000Z';
const T2 = '2026-11-17T10:00:05.000Z';

describe('rowIsStale: does a status frame ask for the row to be read again', () => {
  test('an agent the store has never held', () => {
    expect(rowIsStale(undefined, row('a', T1))).toBe(true);
  });

  test('a frame of a later change', () => {
    expect(rowIsStale(row('a', T1), row('a', T2))).toBe(true);
  });

  test('not a frame of the record the store holds', () => {
    expect(rowIsStale(row('a', T1), row('a', T1))).toBe(false);
  });

  test('not a frame older than the record', () => {
    expect(rowIsStale(row('a', T2), row('a', T1))).toBe(false);
  });

  test('not a frame with no date to compare', () => {
    expect(rowIsStale(row('a', T1), row('a', ''))).toBe(false);
  });

  test('a record with no date, once a frame has one', () => {
    expect(rowIsStale(row('a', ''), row('a', T1))).toBe(true);
  });
});

describe('collectionIsStale: does a snapshot ask for the list to be read again', () => {
  test('not when it names the same agents at the same dates', () => {
    const known = [row('a', T1), row('b', T2)];
    expect(collectionIsStale(known, [row('b', T2), row('a', T1)])).toBe(false);
  });

  test('when it names an agent the store does not hold', () => {
    expect(collectionIsStale([row('a', T1)], [row('a', T1), row('b', T1)])).toBe(true);
  });

  test('when one of its agents changed', () => {
    expect(collectionIsStale([row('a', T1)], [row('a', T2)])).toBe(true);
  });

  test('when the store holds an agent it does not name', () => {
    expect(collectionIsStale([row('a', T1), row('b', T1)], [row('a', T1)])).toBe(true);
  });

  test('not when both are empty', () => {
    expect(collectionIsStale([], [])).toBe(false);
  });
});
