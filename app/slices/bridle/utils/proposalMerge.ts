// Placing file change proposals (CLEAN-112) among transcript messages. Pure
// on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
// TWIN FILE: `admin/slices/bridle/utils/proposalMerge.ts` — change them together.

export interface IProposalStamp {
  id: string;
  createdAt: string;
}

/** Message id of a proposal bubble; stable across live and replayed paths. */
export function proposalMessageId(proposalId: string): string {
  return 'proposal:' + proposalId;
}

export function isProposalMessageId(id: string): boolean {
  return id.indexOf('proposal:') === 0;
}

export function proposalTs(p: IProposalStamp): number {
  const t = Date.parse(p.createdAt);
  return Number.isFinite(t) ? t : 0;
}

interface IPlaced<T> {
  ts: number;
  message: T;
}

/**
 * Insert one bubble per proposal into `messages` (already in display order)
 * by `createdAt`: before the first message stamped after it. Bubbles already
 * present (same id) stay where they are, so a live card and its persisted
 * twin never show twice.
 */
export function mergeProposals<T extends { id: string; ts: number }>(
  messages: readonly T[],
  proposals: readonly IProposalStamp[],
  make: (p: IProposalStamp) => T,
): T[] {
  const present = new Set<string>();
  for (const m of messages) present.add(m.id);

  const fresh: IPlaced<T>[] = [];
  for (const p of proposals) {
    if (present.has(proposalMessageId(p.id))) continue;
    fresh.push({ ts: proposalTs(p), message: make(p) });
  }
  if (fresh.length === 0) return messages.slice();
  fresh.sort((a, b) => a.ts - b.ts);

  const out: T[] = [];
  let next = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as T;
    while (next < fresh.length && (fresh[next] as IPlaced<T>).ts < m.ts) {
      out.push((fresh[next] as IPlaced<T>).message);
      next += 1;
    }
    out.push(m);
  }
  for (; next < fresh.length; next += 1) {
    out.push((fresh[next] as IPlaced<T>).message);
  }
  return out;
}
