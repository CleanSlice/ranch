/**
 * Tab bookkeeping for the Files editor (CLEAN-112, US5). Pure so `bun test`
 * runs it; the store applies the results.
 */

/** Add `path` to the open tabs if it is not there yet. */
export function openTab(tabs: readonly string[], path: string): string[] {
  return tabs.includes(path) ? tabs.slice() : [...tabs, path];
}

/**
 * Remove `path` and say which tab becomes active: the neighbour to the
 * right, else the one to the left, else none. An unrelated active tab stays.
 */
export function closeTab(
  tabs: readonly string[],
  path: string,
  active: string | null,
): { tabs: string[]; active: string | null } {
  const idx = tabs.indexOf(path);
  if (idx < 0) return { tabs: tabs.slice(), active };
  const next: string[] = [];
  for (let i = 0; i < tabs.length; i++) {
    if (i !== idx) next.push(tabs[i] as string);
  }
  if (active !== path) return { tabs: next, active };
  const pick = next.length === 0 ? null : (next[Math.min(idx, next.length - 1)] as string);
  return { tabs: next, active: pick };
}

/** Whether leaving or closing must ask first: any draft differs from what was loaded. */
export function hasUnsaved(dirtyPaths: readonly string[], scope?: string): boolean {
  if (scope === undefined) return dirtyPaths.length > 0;
  return dirtyPaths.includes(scope);
}
