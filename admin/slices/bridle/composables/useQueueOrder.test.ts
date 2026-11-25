import { describe, expect, test } from "bun:test";
import { ref } from "vue";
import { dropIndex, keyTarget, slotAt, useQueueOrder } from "./useQueueOrder";

/** Three rows of 40 px under a list that starts at y = 100. */
const TOP = 100;
const ROW = 40;

interface IFakeRow {
  handle: object;
  focused: boolean;
}

function listOf(count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const row = {
      focused: false,
      handle: {} as { closest(selector: string): unknown },
      getBoundingClientRect: () => ({ top: TOP + i * ROW, height: ROW }),
      focus() {
        row.focused = true;
      },
    };
    // The handle answers for itself and for the row it sits in.
    row.handle.closest = (selector: string) =>
      selector === "[data-queue-handle]" ? row.handle : row;
    return row;
  });
  let captured: number | null = null;
  const el = {
    querySelectorAll: () => rows,
    getBoundingClientRect: () => ({ top: TOP, height: count * ROW }),
    contains: (node: unknown) => rows.some((r) => r.handle === node),
    setPointerCapture: (id: number) => void (captured = id),
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => void (captured = null),
  };
  return { el, rows: rows as unknown as IFakeRow[] };
}

function order(count = 3) {
  const { el, rows } = listOf(count);
  const moves: Array<[number, number]> = [];
  const api = useQueueOrder({
    listEl: ref(el as unknown as HTMLElement),
    onMove: (from, to) => void moves.push([from, to]),
  });
  const down = (row: number, y: number, pointerType = "mouse") =>
    api.onPointerDown({
      button: 0,
      pointerId: 1,
      pointerType,
      clientY: y,
      target: rows[row]!.handle,
      preventDefault() {},
    } as unknown as PointerEvent);
  const moveTo = (y: number) =>
    api.onPointerMove({
      clientY: y,
      preventDefault() {},
    } as unknown as PointerEvent);
  const key = (
    index: number,
    init: { key: string; altKey?: boolean; inside?: boolean },
  ) => {
    let prevented = false;
    const row = rows[index]!;
    api.onRowKeydown(
      {
        key: init.key,
        altKey: init.altKey ?? false,
        target: init.inside ? {} : row,
        currentTarget: row,
        preventDefault: () => void (prevented = true),
      } as unknown as KeyboardEvent,
      index,
    );
    return prevented;
  };
  return { api, rows, moves, down, moveTo, key };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("slotAt", () => {
  const boxes = [0, 1, 2].map((i) => ({ top: TOP + i * ROW, height: ROW }));

  test("before the first row whose middle is below the pointer", () => {
    expect(slotAt(TOP - 50, boxes)).toBe(0);
    expect(slotAt(TOP + 19, boxes)).toBe(0);
    expect(slotAt(TOP + 21, boxes)).toBe(1);
    expect(slotAt(TOP + ROW + 21, boxes)).toBe(2);
  });

  test("past the last middle is the end", () => {
    expect(slotAt(TOP + 2 * ROW + 21, boxes)).toBe(3);
    expect(slotAt(0, [])).toBe(0);
  });
});

describe("dropIndex", () => {
  test("a slot past the dragged row counts one less", () => {
    expect(dropIndex(0, 3)).toBe(2);
    expect(dropIndex(0, 1)).toBe(0);
    expect(dropIndex(2, 0)).toBe(0);
    expect(dropIndex(1, 1)).toBe(1);
  });
});

describe("keyTarget", () => {
  test("Alt+↑ and Alt+↓ move by one", () => {
    expect(keyTarget({ altKey: true, key: "ArrowUp" }, 1, 3)).toBe(0);
    expect(keyTarget({ altKey: true, key: "ArrowDown" }, 1, 3)).toBe(2);
  });

  test("nowhere to go at the edges", () => {
    expect(keyTarget({ altKey: true, key: "ArrowUp" }, 0, 3)).toBe(null);
    expect(keyTarget({ altKey: true, key: "ArrowDown" }, 2, 3)).toBe(null);
  });

  test("without Alt, or another key, nothing", () => {
    expect(keyTarget({ altKey: false, key: "ArrowUp" }, 1, 3)).toBe(null);
    expect(keyTarget({ altKey: true, key: "Enter" }, 1, 3)).toBe(null);
  });
});

describe("dragging by the handle", () => {
  test("the first row dropped below the last", () => {
    const { api, moves, down, moveTo } = order();
    down(0, TOP + 10);
    expect(api.dragging.value).toBe(0);
    moveTo(TOP + 2 * ROW + 30);
    expect(api.dropSlot.value).toBe(3);
    expect(api.indicatorTop.value).toBe(3 * ROW);
    api.onPointerUp();
    expect(moves).toEqual([[0, 2]]);
    expect(api.dragging.value).toBe(null);
    expect(api.dropSlot.value).toBe(null);
  });

  test("the last row dropped on top", () => {
    const { api, moves, down, moveTo } = order();
    down(2, TOP + 2 * ROW + 10);
    moveTo(TOP + 5);
    expect(api.indicatorTop.value).toBe(0);
    api.onPointerUp();
    expect(moves).toEqual([[2, 0]]);
  });

  test("dropped where it was: nothing moves", () => {
    const { api, moves, down, moveTo } = order();
    down(1, TOP + ROW + 10);
    moveTo(TOP + ROW + 30);
    api.onPointerUp();
    expect(moves).toEqual([]);
  });

  test("a drag that is cancelled moves nothing", () => {
    const { api, moves, down, moveTo } = order();
    down(0, TOP + 10);
    moveTo(TOP + 2 * ROW + 30);
    api.cancel();
    api.onPointerUp();
    expect(moves).toEqual([]);
  });

  test("a finger that moves before the hold is scrolling", async () => {
    const { api, moves, down, moveTo } = order();
    down(0, TOP + 10, "touch");
    expect(api.dragging.value).toBe(null);
    moveTo(TOP + 60);
    await tick();
    api.onPointerUp();
    expect(moves).toEqual([]);
  });

  test("another button, or a press outside a handle, starts nothing", () => {
    const { api, rows } = order();
    api.onPointerDown({
      button: 2,
      target: rows[0]!.handle,
    } as unknown as PointerEvent);
    api.onPointerDown({
      button: 0,
      target: { closest: () => null },
    } as unknown as PointerEvent);
    expect(api.dragging.value).toBe(null);
  });
});

describe("moving the focused row with the keyboard", () => {
  test("Alt+↓ moves it, says where it is now and keeps the focus on it", async () => {
    const { api, rows, moves, key } = order();
    expect(key(0, { key: "ArrowDown", altKey: true })).toBe(true);
    expect(moves).toEqual([[0, 1]]);
    expect(api.moved.value).toEqual({ position: 2, total: 3 });
    await tick();
    expect(rows[1]!.focused).toBe(true);
  });

  test("Alt+↑ on the first row does nothing and is not swallowed", () => {
    const { api, moves, key } = order();
    expect(key(0, { key: "ArrowUp", altKey: true })).toBe(false);
    expect(moves).toEqual([]);
    expect(api.moved.value).toBe(null);
  });

  test("a key pressed in a control inside the row is not a move", () => {
    const { moves, key } = order();
    expect(key(1, { key: "ArrowUp", altKey: true, inside: true })).toBe(false);
    expect(moves).toEqual([]);
  });

  test("the row menu moves through the same door", () => {
    const { api, moves } = order();
    api.moveTo(2, 1);
    api.moveTo(0, -1);
    expect(moves).toEqual([[2, 1]]);
    expect(api.moved.value).toEqual({ position: 2, total: 3 });
  });
});
