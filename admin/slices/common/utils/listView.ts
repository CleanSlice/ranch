/**
 * The cards-or-table choice a list remembers in the browser (CLEAN-132).
 * Pure so the fallback is pinned by a test: a stored value that is not one
 * of the list's views (an old key, a hand-edited entry) must not leave the
 * page in a view it cannot draw.
 */
export type ListView = 'cards' | 'table';

export const LIST_VIEWS: readonly ListView[] = ['cards', 'table'];

export function readListView(
  raw: string | null | undefined,
  fallback: ListView,
  views: readonly ListView[] = LIST_VIEWS,
): ListView {
  return raw && (views as readonly string[]).includes(raw) ? (raw as ListView) : fallback;
}

/** One key per list, so two pages never share a choice by accident. */
export const listViewStorageKey = (list: string): string => `admin.list.${list}.view`;
