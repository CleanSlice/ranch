import type { ISourceUsage, SourceSortTypes } from './source.types';

/**
 * Usage numbers for a page of sources (CLEAN-138): how often each was cited
 * and how those citations stand. Counted from rows every time — three
 * stored counters kept in step by hand is the classic drift bug, and a
 * withdrawn rating is simply a row that is not there (FR-031).
 */

/** One `groupBy` row: ratings of one source with one value. */
export interface IRatingGroup {
  sourceId: string;
  rating: number;
  count: number;
}

export function usageByIdSource(
  citedBy: ReadonlyMap<string, number>,
  ratings: readonly IRatingGroup[],
): Map<string, ISourceUsage> {
  const out = new Map<string, ISourceUsage>();
  const of = (id: string): ISourceUsage => {
    let u = out.get(id);
    if (!u) {
      u = { cited: citedBy.get(id) ?? 0, likes: 0, dislikes: 0 };
      out.set(id, u);
    }
    return u;
  };
  for (const [id] of citedBy) of(id);
  for (const g of ratings) {
    const u = of(g.sourceId);
    if (g.rating === 1) u.likes += g.count;
    else if (g.rating === -1) u.dislikes += g.count;
  }
  return out;
}

/**
 * Order source ids by a usage number. A base has thousands of sources at
 * most, so ranking the ids of one filtered base in memory is cheaper than
 * teaching the database a filtered relation count it cannot express; ties
 * keep the given (creation) order so paging stays stable.
 */
export function rankByUsage(
  idsInCreationOrder: readonly string[],
  usage: ReadonlyMap<string, ISourceUsage>,
  sort: Exclude<SourceSortTypes, 'createdAt'>,
  order: 'asc' | 'desc',
): string[] {
  const value = (id: string) => usage.get(id)?.[sort] ?? 0;
  const ranked = idsInCreationOrder.map((id, i) => ({ id, i, v: value(id) }));
  ranked.sort((a, b) =>
    a.v === b.v ? a.i - b.i : order === 'desc' ? b.v - a.v : a.v - b.v,
  );
  return ranked.map((r) => r.id);
}
