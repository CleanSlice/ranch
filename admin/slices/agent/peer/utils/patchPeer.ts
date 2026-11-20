// The optimistic half of the peer store, as plain functions over a list so
// the rule can be tested without a store around it (docs/state.md, rule 5).

/** `list` with `fields` laid over the row `id`; untouched when it is not there. */
export function applyPatch<T extends { id: string }>(
  list: T[],
  id: string,
  fields: Partial<T>,
): T[] {
  return list.map((row) => (row.id === id ? { ...row, ...fields } : row));
}

/**
 * Undoes `applyPatch` on the list as it is NOW. A field goes back to what it
 * was only while it still holds the optimistic value: an answer of the
 * server that landed in between is fresher than the guess and survives.
 */
export function revertPatch<T extends { id: string }>(
  list: T[],
  before: T,
  fields: Partial<T>,
): T[] {
  return list.map((row) => {
    if (row.id !== before.id) return row;
    const restored = { ...row };
    for (const key of Object.keys(fields) as (keyof T)[]) {
      if (row[key] === fields[key]) restored[key] = before[key];
    }
    return restored;
  });
}
