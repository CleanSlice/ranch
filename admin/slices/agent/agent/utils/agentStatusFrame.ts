/**
 * The status stream says which agent, its status and when its row last
 * changed, never the row (CLEAN-232). These two decide when the agent store
 * must read a row again through the authenticated route (docs/state.md:
 * fetches upsert, pushes patch the same record).
 */
export interface IRowStamp {
  id: string;
  updatedAt: string;
}

/**
 * The store's record is stale when it has none, or the frame is of a later
 * change. A frame older than the record (it was read before a write the
 * store already holds) asks for nothing.
 */
export function rowIsStale(
  known: IRowStamp | undefined,
  frame: IRowStamp,
): boolean {
  if (!known) return true;
  const have = Date.parse(known.updatedAt);
  const seen = Date.parse(frame.updatedAt);
  if (Number.isNaN(seen)) return false;
  if (Number.isNaN(have)) return true;
  return seen > have;
}

/**
 * A snapshot names every agent there is. The collection is stale when one of
 * them is stale, or when the store holds an agent the snapshot does not name
 * (deleted while the stream was down).
 */
export function collectionIsStale(
  known: IRowStamp[],
  frames: IRowStamp[],
): boolean {
  const byId = new Map(known.map((a) => [a.id, a]));
  if (frames.some((f) => rowIsStale(byId.get(f.id), f))) return true;
  const named = new Set(frames.map((f) => f.id));
  return known.some((a) => !named.has(a.id));
}
