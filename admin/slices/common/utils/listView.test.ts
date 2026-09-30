import { describe, expect, test } from 'bun:test';
import { listViewStorageKey, readListView } from './listView';

describe('readListView', () => {
  test('a known view is kept', () => {
    expect(readListView('table', 'cards')).toBe('table');
    expect(readListView('cards', 'table')).toBe('cards');
  });

  test('anything else falls back', () => {
    expect(readListView(null, 'cards')).toBe('cards');
    expect(readListView('', 'cards')).toBe('cards');
    expect(readListView('"cards"', 'table')).toBe('table');
    expect(readListView('grid', 'cards')).toBe('cards');
  });

  test('a list can offer one view only', () => {
    expect(readListView('cards', 'table', ['table'])).toBe('table');
  });
});

describe('listViewStorageKey', () => {
  test('is namespaced per list', () => {
    expect(listViewStorageKey('templates')).toBe('admin.list.templates.view');
  });
});
