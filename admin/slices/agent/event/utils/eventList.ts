/**
 * The store's merge and refresh logic, kept free of Vue and Pinia so it can
 * be tested alone (`eventList.test.ts`). `stores/agentEvent.ts` is a thin
 * reactive shell over these.
 */

/** One list on screen: order as ids, never a second copy of the records. */
export interface IEventView {
  ids: string[];
  /** Where "Load more" continues from; `null` = nothing older. */
  nextCursor: string | null;
  loaded: boolean;
}

export const emptyView = (): IEventView => ({ ids: [], nextCursor: null, loaded: false });

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Merge the newest page into a view. The page is newest first, so its ids
 * lead; rows already on screen below them stay — a refresh must not throw
 * away what "Load more" brought in — and no id appears twice. The cursor
 * belongs to the oldest row loaded, so only the first load sets it.
 */
export function refreshView(
  view: IEventView,
  pageIds: readonly string[],
  nextCursor: string | null,
): IEventView {
  if (!view.loaded) return { ids: unique(pageIds), nextCursor, loaded: true };
  // A page that shares no row with what is on screen, and has more behind
  // it: more arrived since the last refresh than one page holds, so rows are
  // missing between this page and the old list. Start again from this page —
  // it is whole, and "Load more" continues right below it — rather than show
  // a list with a hole in it that nobody can see.
  if (view.ids.length > 0 && pageIds.length > 0 && nextCursor !== null) {
    const known = new Set(view.ids);
    if (!pageIds.some((id) => known.has(id))) {
      return { ids: unique(pageIds), nextCursor, loaded: true };
    }
  }
  return { ids: unique([...pageIds, ...view.ids]), nextCursor: view.nextCursor, loaded: true };
}

/** Append an older page under what is already there, in the order received. */
export function appendView(
  view: IEventView,
  pageIds: readonly string[],
  nextCursor: string | null,
): IEventView {
  return { ids: unique([...view.ids, ...pageIds]), nextCursor, loaded: true };
}

/** Upsert by id into a record map; returns a new map so a `ref` notices. */
export function upsertById<T extends { id: string }>(
  records: Readonly<Record<string, T>>,
  items: readonly T[],
): Record<string, T> {
  if (!items.length) return records as Record<string, T>;
  const next = { ...records };
  for (let i = 0; i < items.length; i += 1) next[items[i]!.id] = items[i]!;
  return next;
}

export interface IWatcherOptions {
  intervalMs: number;
  /** Called on every beat with the keys that have at least one watcher. */
  tick: (keys: string[]) => void;
  /** A hidden tab skips the beat rather than fetching for nobody. */
  isVisible?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Subscriber-counted refresh, as `agentStatus` counts consumers of its stream:
 * any number of components may watch any number of keys, ONE timer runs while
 * anybody is watching, and the last `unwatch` stops it.
 */
export function createWatchers(options: IWatcherOptions) {
  const counts = new Map<string, number>();
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let timer: unknown = null;

  function beat() {
    if (options.isVisible && !options.isVisible()) return;
    options.tick([...counts.keys()]);
  }

  function watch(key: string) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (timer === null) timer = setTimer(beat, options.intervalMs);
  }

  function unwatch(key: string) {
    const left = (counts.get(key) ?? 0) - 1;
    if (left > 0) counts.set(key, left);
    else counts.delete(key);
    if (counts.size === 0 && timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return { watch, unwatch, running: () => timer !== null, keys: () => [...counts.keys()] };
}
