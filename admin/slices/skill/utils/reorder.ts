/**
 * Reordering the library (CLEAN-205), as pure list arithmetic so a test can
 * pin the two cases the brief names: a move inside a filtered view, and the
 * "↑2 / ↓1" badges against the saved order.
 */

/**
 * Move the `from`-th visible row to the `to`-th visible slot. Hidden rows
 * keep their indices in the full order; the visible rows take the new
 * relative order in the slots they occupied. Out-of-range or no-op moves
 * return the input untouched.
 */
export function moveVisible(
  fullOrder: readonly string[],
  visibleIds: readonly string[],
  from: number,
  to: number,
): string[] {
  if (from === to || from < 0 || to < 0 || from >= visibleIds.length || to >= visibleIds.length) {
    return [...fullOrder];
  }
  const visible = new Set(visibleIds);
  const slots: number[] = [];
  fullOrder.forEach((id, index) => {
    if (visible.has(id)) slots.push(index);
  });
  const ordered = fullOrder.filter((id) => visible.has(id));
  const [moved] = ordered.splice(from, 1);
  if (moved === undefined) return [...fullOrder];
  ordered.splice(to, 0, moved);
  const next = [...fullOrder];
  slots.forEach((slot, i) => {
    next[slot] = ordered[i]!;
  });
  return next;
}

export interface OrderDiff {
  /** savedIndex − draftIndex: positive moved up (↑n), negative moved down (↓n). */
  byId: Record<string, number>;
  /** How many skills sit somewhere other than where they were saved. */
  movedCount: number;
}

export function orderDiff(saved: readonly string[], draft: readonly string[]): OrderDiff {
  const savedIndex = new Map(saved.map((id, i) => [id, i]));
  const byId: Record<string, number> = {};
  let movedCount = 0;
  draft.forEach((id, i) => {
    const was = savedIndex.get(id);
    const delta = was === undefined ? 0 : was - i;
    byId[id] = delta;
    if (delta !== 0) movedCount++;
  });
  return { byId, movedCount };
}

/** `↑2`, `↓1`, or empty for an unmoved row. */
export function badgeFor(delta: number | undefined): string {
  if (!delta) return '';
  return delta > 0 ? `↑${delta}` : `↓${-delta}`;
}

/** The PATCH body: 1-based positions in list order. */
export function toOrderItems(order: readonly string[]): { id: string; sortOrder: number }[] {
  return order.map((id, index) => ({ id, sortOrder: index + 1 }));
}
