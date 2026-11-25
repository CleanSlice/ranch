import { nextTick, ref, type Ref } from "vue";

/**
 * Reordering the queued messages (CLEAN-245, research R12): drag a row by its
 * handle, or move the focused row with Alt+↑ / Alt+↓. Modelled on
 * `admin/slices/skill/composables/useSortableList.ts` — Pointer Events, no dependency, no
 * DOM node moved here: it reports `onMove(from, to)` and the store reorders.
 * The component binds the handlers to the list and words the announcement
 * from `moved`. Twin of `admin/slices/bridle/composables/useQueueOrder.ts`.
 */

export interface IRowBox {
  top: number;
  height: number;
}

/** The insertion slot (0..n) a pointer at `y` is over: before the first row whose middle is below it. */
export function slotAt(y: number, boxes: IRowBox[]): number {
  for (let i = 0; i < boxes.length; i++) {
    if (y < boxes[i]!.top + boxes[i]!.height / 2) return i;
  }
  return boxes.length;
}

/** Where a row dragged from `from` lands for a slot: one past itself counts one less once it has left. */
export function dropIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** Where Alt+↑ / Alt+↓ takes the row at `index`, or null when the key is not one of them or there is nowhere to go. */
export function keyTarget(
  e: { altKey: boolean; key: string },
  index: number,
  total: number,
): number | null {
  if (!e.altKey) return null;
  const to =
    e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
  return to === null || to < 0 || to >= total ? null : to;
}

export interface IQueueOrderOptions {
  listEl: Ref<HTMLElement | null>;
  /** Rows, in visible order. */
  itemSelector?: string;
  /** What a drag may start on. */
  handleSelector?: string;
  /** Touch must hold this long before a drag starts, so a scroll is a scroll. */
  touchHoldMs?: number;
  onMove: (from: number, to: number) => void;
}

/** The last move made from the keyboard or the menu, for the `aria-live` line. */
export interface IQueueMoved {
  position: number;
  total: number;
}

export function useQueueOrder(options: IQueueOrderOptions) {
  const {
    listEl,
    itemSelector = "[data-queue-row]",
    handleSelector = "[data-queue-handle]",
    touchHoldMs = 200,
    onMove,
  } = options;

  /** Visible index of the row being dragged, or null. */
  const dragging = ref<number | null>(null);
  /** Insertion slot (0..n) the pointer is over while dragging. */
  const dropSlot = ref<number | null>(null);
  /** Top of the insertion line, relative to the list element. */
  const indicatorTop = ref(0);
  const moved = ref<IQueueMoved | null>(null);

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

  function cancel() {
    clearHold();
    if (pointerId !== null && listEl.value?.hasPointerCapture(pointerId)) {
      listEl.value.releasePointerCapture(pointerId);
    }
    pointerId = null;
    dragging.value = null;
    dropSlot.value = null;
  }

  function track(y: number) {
    const list = listEl.value?.getBoundingClientRect();
    if (!list) return;
    const boxes = rows().map((el) => el.getBoundingClientRect());
    const slot = slotAt(y, boxes);
    dropSlot.value = slot;
    const last = boxes[boxes.length - 1];
    indicatorTop.value =
      slot < boxes.length
        ? boxes[slot]!.top - list.top
        : (last ? last.top + last.height : list.top) - list.top;
  }

  function start(index: number, y: number) {
    dragging.value = index;
    if (pointerId !== null) listEl.value?.setPointerCapture(pointerId);
    track(y);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !listEl.value) return;
    const handle = (e.target as Element | null)?.closest<HTMLElement>(
      handleSelector,
    );
    if (!handle || !listEl.value.contains(handle)) return;
    const row = handle.closest<HTMLElement>(itemSelector);
    const index = row ? rows().indexOf(row) : -1;
    if (index < 0) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    if (e.pointerType === "touch") {
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
    const from = dragging.value;
    const to = from === null ? null : dropIndex(from, dropSlot.value ?? from);
    cancel();
    if (from !== null && to !== null && to !== from) onMove(from, to);
  }

  /** A move that is said aloud: the keyboard's and the row menu's. Focus follows the row. */
  function moveTo(index: number, to: number) {
    const total = rows().length;
    if (to < 0 || to >= total || to === index) return;
    onMove(index, to);
    moved.value = { position: to + 1, total };
    void nextTick(() => rows()[to]?.focus());
  }

  function onRowKeydown(e: KeyboardEvent, index: number) {
    if (e.key === "Escape" && dragging.value !== null) return cancel();
    // Only the row itself: Alt+↑ in a control inside it is not a move.
    if (e.target !== e.currentTarget) return;
    const to = keyTarget(e, index, rows().length);
    if (to === null) return;
    e.preventDefault();
    moveTo(index, to);
  }

  return {
    dragging,
    dropSlot,
    indicatorTop,
    moved,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onRowKeydown,
    moveTo,
    cancel,
  };
}
