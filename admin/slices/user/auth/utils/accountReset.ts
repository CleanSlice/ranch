// What an account change does to a store that has no `resetForAccount()` of
// its own (CLEAN-231). Admin only: this console has some thirty stores, and
// nearly every one holds what the signed-in operator was allowed to read
// (secrets, files, usage, sessions, keys). A store with sockets, timers or
// records other code holds on to empties itself through its own function;
// every other one is put back to the state it was created with, so a store
// added later is covered without anyone remembering to list it.
//
// Pure on purpose: no Pinia, no Nuxt. The plugin hands in the state.

/** Stores that hold nothing about an account and are left alone. */
export const KEPT_STORES: ReadonlySet<string> = new Set([
  // Who is signed in: the thing being watched.
  'auth',
  // Whether the installation has been set up.
  'init',
  // The sidebar's entries, registered once by the slices' plugins.
  'menu',
  // The confirmation dialog on screen.
  'confirm',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A deep copy of plain data; not ok when something in it is not plain. */
function copy(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value };
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = copy(value[i]);
      if (!item.ok) return { ok: false };
      out.push(item.value);
    }
    return { ok: true, value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const item = copy(value[key]);
      if (!item.ok) return { ok: false };
      out[key] = item.value;
    }
    return { ok: true, value: out };
  }
  // A Map, a Set, a Date, a class instance, a function: not something to
  // copy and put back blindly.
  return { ok: false };
}

/**
 * The state a store was created with, to put back later. Null when it holds
 * something that is not plain data: such a store needs a `resetForAccount()`
 * of its own, and is left as it is until it has one.
 */
export function snapshotState(
  state: Record<string, unknown>,
): Record<string, unknown> | null {
  const result = copy(state);
  return result.ok ? (result.value as Record<string, unknown>) : null;
}

/** Put every field of the snapshot back, as a fresh copy each time. */
export function restoreState(
  state: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): void {
  for (const key of Object.keys(snapshot)) {
    const fresh = copy(snapshot[key]);
    if (fresh.ok) state[key] = fresh.value;
  }
}
