import { describe, expect, test } from 'bun:test';
import { KEPT_STORES, restoreState, snapshotState } from './accountReset';

describe('putting a store back to the state it was created with', () => {
  test('every field returns to its first value, whatever was read since', () => {
    const state: Record<string, unknown> = {
      items: [],
      byAgent: {},
      loading: false,
      error: null,
      selected: undefined,
      page: { view: 'incidents', size: 50 },
    };
    const snapshot = snapshotState(state);
    expect(snapshot === null).toBe(false);

    state.items = [{ id: 'secret-1', value: 'read for the Owner' }];
    state.byAgent = { 'agent-a': { files: ['notes.md'] } };
    state.loading = true;
    state.error = 'refused';
    state.selected = 'agent-a';
    (state.page as Record<string, unknown>).view = 'events';

    restoreState(state, snapshot as Record<string, unknown>);
    expect(state).toEqual({
      items: [],
      byAgent: {},
      loading: false,
      error: null,
      selected: undefined,
      page: { view: 'incidents', size: 50 },
    });
  });

  test('a second account does not write into the first restore', () => {
    const state: Record<string, unknown> = { byAgent: {} };
    const snapshot = snapshotState(state) as Record<string, unknown>;
    restoreState(state, snapshot);
    (state.byAgent as Record<string, unknown>)['agent-a'] = 'for the Admin';
    restoreState(state, snapshot);
    expect(state.byAgent).toEqual({});
    expect(snapshot.byAgent).toEqual({});
  });

  test('a store holding more than plain data is not snapshotted', () => {
    expect(snapshotState({ seen: new Map() })).toBe(null);
    expect(snapshotState({ ids: new Set() })).toBe(null);
    expect(snapshotState({ nested: { at: new Date(0) } })).toBe(null);
    expect(snapshotState({ run: () => undefined })).toBe(null);
  });

  test('the stores that are about no account are left alone', () => {
    expect([...KEPT_STORES].sort()).toEqual(['auth', 'confirm', 'init', 'menu']);
  });
});
