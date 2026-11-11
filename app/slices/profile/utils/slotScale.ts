// How the cluster slot scale on the pass stub is drawn (CLEAN-217). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export interface ISlotCapacity {
  usedAgentSlots: number;
  totalAgentSlots: number;
}

export type SlotScale =
  | { kind: 'marks'; used: number; total: number }
  | { kind: 'bar'; used: number; total: number; ratio: number };

/**
 * One mark per slot while that stays readable, one bar above it. The pass is
 * 400 px wide with 30 px of padding each side and a 5 px gap between marks:
 * past 40 slots a mark is under 4 px wide and the scale turns into noise, so
 * it becomes a single bar filled by share.
 */
export const MAX_SLOT_MARKS = 40;

/**
 * `null` when there is nothing truthful to draw: capacity unknown (not an
 * operator, or the cluster could not be read) or a cluster with no slots.
 * The caller then leaves the whole block out rather than drawing zeros.
 */
export function slotScale(capacity: ISlotCapacity | null | undefined): SlotScale | null {
  if (!capacity) return null;
  const total = Math.floor(capacity.totalAgentSlots);
  if (!Number.isFinite(total) || total <= 0) return null;
  const rawUsed = Math.floor(capacity.usedAgentSlots);
  const used = Math.min(total, Math.max(0, Number.isFinite(rawUsed) ? rawUsed : 0));
  if (total <= MAX_SLOT_MARKS) return { kind: 'marks', used, total };
  return { kind: 'bar', used, total, ratio: used / total };
}
