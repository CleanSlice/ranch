// Where this console keeps things in the browser, and for whom (CLEAN-231,
// spec 032 FR-028). Twin of `app/slices/bridle/utils/storageKeys.ts`: the
// same rule, this console's own keys.
//
// Two people may use one browser. The admin console keeps no conversation
// (a reload shows the transcript), but it does keep two things an operator
// produced: the prompt-debug snapshots of an agent and the outbox of messages
// the agent never received. It also keeps which agents want a restart and
// which are being restarted. All of them carry the id of the account they
// belong to, and nothing is read or written while that id is not known. There are no
// share-link conversations in this console, so no key is exempt.
//
// Pure on purpose: no `window`, no store. The caller hands in the id and, for
// the sweep, the storage.

const DEBUG_PREFIX = 'bridle:debug:';
const OUTBOX_PREFIX = 'bridle:outbox:';

// The restart marks (an agent whose settings or files changed and wants a
// restart, a restart that is under way). Maps keyed by agent id, so they
// name agents; one map per account.
const AGENT_PENDING_RESTART = 'agent:pendingRestart';
const AGENT_RESTART_IN_FLIGHT = 'agent:restartInFlight';
const FILE_PENDING_RESTART = 'agentFile:pendingRestart';

/**
 * The same three maps as they were kept before they carried an account: the
 * bare name, with nothing after it. A scoped key always has `:<userId>`
 * behind the name, so these three can never be a key of the new shape.
 */
const OLD_RESTART_KEYS: readonly string[] = [
  AGENT_PENDING_RESTART,
  AGENT_RESTART_IN_FLIGHT,
  FILE_PENDING_RESTART,
];

/**
 * Says how far the removal of old keys has got in this browser. The value is
 * the number of the last step that ran:
 *
 *   absent  nothing was removed yet;
 *   '1'     the debug snapshots and outboxes written before CLEAN-231 are
 *           gone. This is also what makes that step safe: scoped keys under
 *           the two prefixes are written only after it, so while the flag is
 *           absent everything under them is an old key;
 *   '2'     the unscoped restart maps are gone too.
 *
 * A browser that ran the first step before the second existed holds '1' and
 * still gets the second, once. A new old shape is a new step and the next
 * number, never a change to a step some browsers have already run.
 */
export const SWEEP_FLAG_KEY = 'ranch.accountKeys.admin';
/** The step this version of the console brings a browser to. */
export const SWEEP_VERSION = '2';

/** Storage key of an agent's debug snapshots; null when there is nobody to keep them for. */
export function debugKey(userId: string | null, agentId: string): string | null {
  return userId ? `${DEBUG_PREFIX}${userId}:${agentId}` : null;
}

/**
 * Storage key of a conversation's outbox. `conversationKey` is the store's
 * `bridleKey`, `<agentId>:<channel>`.
 */
export function outboxKey(userId: string | null, conversationKey: string): string | null {
  return userId ? `${OUTBOX_PREFIX}${userId}:${conversationKey}` : null;
}

/** Agents of this account whose settings changed and want a restart. */
export function agentPendingRestartKey(userId: string | null): string | null {
  return userId ? `${AGENT_PENDING_RESTART}:${userId}` : null;
}

/** Agents this account is restarting right now, with the moment it began. */
export function agentRestartInFlightKey(userId: string | null): string | null {
  return userId ? `${AGENT_RESTART_IN_FLIGHT}:${userId}` : null;
}

/** Agents of this account whose files changed and want a restart. */
export function filePendingRestartKey(userId: string | null): string | null {
  return userId ? `${FILE_PENDING_RESTART}:${userId}` : null;
}

/** The part of `Storage` the sweep needs; a test hands in a plain object. */
export interface IKeyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Remove what the console kept before keys carried an account: once per
 * browser, on the first boot after the upgrade, before anything is written
 * under the new keys. A debug snapshot is a convenience and an undelivered
 * message was never received by anyone, so nothing the server holds is lost;
 * a restart mark is a reminder, and the agent's own status says the rest.
 * Each step runs once (see `SWEEP_FLAG_KEY`). Returns the keys it removed.
 */
export function sweepUnscopedKeys(storage: IKeyStorage): string[] {
  const done = storage.getItem(SWEEP_FLAG_KEY);
  if (done === SWEEP_VERSION) return [];
  const old: string[] = [];
  // Step 1, only in a browser that never ran it: afterwards a key under
  // these prefixes may be a scoped one.
  if (done === null) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith(DEBUG_PREFIX) || key.startsWith(OUTBOX_PREFIX))) old.push(key);
    }
  }
  // Step 2: exact names, so it is safe whatever else is in the browser.
  for (const key of OLD_RESTART_KEYS) {
    if (storage.getItem(key) !== null) old.push(key);
  }
  for (const key of old) storage.removeItem(key);
  storage.setItem(SWEEP_FLAG_KEY, SWEEP_VERSION);
  return old;
}
