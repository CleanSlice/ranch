import { compareInstants, compareText } from '#common/utils/format';
import type { ITemplateData } from '../domain/template.types';
import { memoryMi } from './templateFormat';

/**
 * The list toolbar's state, kept pure so the search + size + sort logic is
 * tested without a component around it (CLEAN-130).
 */

export type SizeBucket = 'all' | 's' | 'm' | 'l';
export type TemplateSort = 'recent' | 'name';

export const SIZE_BUCKETS: { key: SizeBucket; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 's', label: '≤ 512 MiB' },
  { key: 'm', label: '1 GiB' },
  { key: 'l', label: '2 GiB+' },
];

export interface ITemplateListQuery {
  query: string;
  size: SizeBucket;
  sort: TemplateSort;
}

/** `s` ≤ 512 MiB, `m` between, `l` ≥ 2 GiB. Unreadable memory only matches `all`. */
export function inSizeBucket(memory: string, bucket: SizeBucket): boolean {
  if (bucket === 'all') return true;
  const mi = memoryMi(memory);
  if (!mi) return false;
  if (bucket === 's') return mi <= 512;
  if (bucket === 'm') return mi > 512 && mi < 2048;
  return mi >= 2048;
}

export function selectTemplates(
  list: readonly ITemplateData[],
  { query, size, sort }: ITemplateListQuery,
): ITemplateData[] {
  const q = query.trim().toLowerCase();
  const out = list.filter(
    (t) =>
      inSizeBucket(t.defaultResources.memory, size) &&
      (!q || `${t.name} ${t.description}`.toLowerCase().includes(q)),
  );
  return out.sort((a, b) =>
    sort === 'name'
      ? compareText(a.name, b.name)
      : compareInstants(b.createdAt, a.createdAt),
  );
}

/** How far a draft set of ids has moved from the saved one. */
export function draftDiff(
  saved: readonly string[],
  draft: readonly string[],
): { added: number; removed: number } {
  const savedSet = new Set(saved);
  const draftSet = new Set(draft);
  let added = 0;
  let removed = 0;
  for (const id of draftSet) if (!savedSet.has(id)) added++;
  for (const id of savedSet) if (!draftSet.has(id)) removed++;
  return { added, removed };
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const { added, removed } = draftDiff(a, b);
  return added === 0 && removed === 0;
}
