import { useEventListener } from '@vueuse/core';
import type { Ref } from 'vue';

export interface SortableListOptions {
  listEl: Ref<HTMLElement | null>;
  /** Rows, in visible order. */
  itemSelector?: string;
  /** What a drag may start on. A `disabled` handle never starts one. */
  handleSelector?: string;
  enabled: Ref<boolean>;
  /** Touch must hold this long before a drag starts, so a scroll is a scroll. */
  touchHoldMs?: number;
  onMove: (from: number, to: number) => void;
}

/**
 * Dragging rows with the pointer (CLEAN-205, research R1). Nothing in either
 * console sorts a list, dnd-kit has no Vue build, and the brief's behaviours
 * (a 3 px insertion line, a touch hold, a filtered reorder, keyboard moves
 * announced elsewhere) are the parts a library would not give — so this is
 * ~120 lines of Pointer Events and no dependency. It never moves DOM nodes:
 * it reports `onMove(from, to)` in visible indices and the store reorders.
 *
 * Listeners sit on the list (delegation), so rows can come and go freely.
 */
export function useSortableList(options: SortableListOptions) {
  const {
    listEl,
    itemSelector = '[data-skill-row]',
    handleSelector = '[data-skill-handle]',
    enabled,
    touchHoldMs = 200,
    onMove,
  } = options;

  /** Visible index of the row being dragged, or null. */
  const dragging = ref<number | null>(null);
  /** Insertion slot (0..n) the pointer is over while dragging. */
  const dropSlot = ref<number | null>(null);
  /** Top of the insertion line, relative to the list element. */
  const indicatorTop = ref(0);

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingIndex: number | null = null;
  let startY = 0;
  let pointerId: number | null = null;

  const rows = (): HTMLElement[] =>
    Array.from(listEl.value?.querySelectorAll<HTMLElement>(itemSelector) ?? []);

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    pendingIndex = null;
  }

  function reset() {
    clearHold();
    if (pointerId !== null && listEl.value?.hasPointerCapture(pointerId)) {
      listEl.value.releasePointerCapture(pointerId);
    }
    pointerId = null;
    dragging.value = null;
    dropSlot.value = null;
  }

  function start(index: number, y: number) {
    dragging.value = index;
    if (pointerId !== null) listEl.value?.setPointerCapture(pointerId);
    track(y);
  }

  function track(y: number) {
    const els = rows();
    const list = listEl.value?.getBoundingClientRect();
    if (!list) return;
    let slot = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        slot = i;
        break;
      }
    }
    dropSlot.value = slot;
    indicatorTop.value =
      slot < els.length
        ? els[slot]!.getBoundingClientRect().top - list.top
        : (els[els.length - 1]?.getBoundingClientRect().bottom ?? list.top) - list.top;
  }

  function onPointerDown(e: PointerEvent) {
    if (!enabled.value || e.button !== 0 || !listEl.value) return;
    const handle = (e.target as Element | null)?.closest<HTMLElement>(handleSelector);
    if (!handle || !listEl.value.contains(handle)) return;
    if ((handle as HTMLButtonElement).disabled) return;
    const row = handle.closest<HTMLElement>(itemSelector);
    const index = row ? rows().indexOf(row) : -1;
    if (index < 0) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    if (e.pointerType === 'touch') {
      // A finger that moves before the hold is scrolling, not dragging.
      pendingIndex = index;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (pendingIndex !== null) start(pendingIndex, startY);
        pendingIndex = null;
      }, touchHoldMs);
    } else {
      e.preventDefault();
      start(index, e.clientY);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (pendingIndex !== null) {
      if (Math.abs(e.clientY - startY) > 8) clearHold();
      return;
    }
    if (dragging.value === null) return;
    e.preventDefault();
    track(e.clientY);
  }

  function onPointerUp() {
    if (dragging.value === null) {
      reset();
      return;
    }
    const from = dragging.value;
    let to = dropSlot.value ?? from;
    // A slot past the dragged row counts one less once the row leaves it.
    if (to > from) to -= 1;
    reset();
    if (to !== from) onMove(from, to);
  }

  useEventListener(listEl, 'pointerdown', onPointerDown);
  useEventListener(listEl, 'pointermove', onPointerMove);
  useEventListener(listEl, 'pointerup', onPointerUp);
  useEventListener(listEl, 'pointercancel', reset);
  useEventListener(
    () => (typeof window === 'undefined' ? null : window),
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragging.value !== null) reset();
    },
  );
  watch(enabled, (on) => {
    if (!on) reset();
  });

  return { dragging, dropSlot, indicatorTop, cancel: reset };
}
