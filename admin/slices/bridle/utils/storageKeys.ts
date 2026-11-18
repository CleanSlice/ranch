// Where this console keeps things in the browser, and for whom (CLEAN-231,
// spec 032 FR-028). Twin of `app/slices/bridle/utils/storageKeys.ts`: the
// same rule, this console's own keys.
//
// Two people may use one browser. The admin console keeps no conversation
// (a reload shows the transcript), but it does keep two things an operator
// produced: the prompt-debug snapshots of an agent and the outbox of messages
// the agent never received. Both carry the id of the account they belong to,
// and nothing is read or written while that id is not known. There are no
// share-link conversations in this console, so no key is exempt.
//
// Pure on purpose: no `window`, no store. The caller hands in the id and, for
// the sweep, the storage.

const DEBUG_PREFIX = 'bridle:debug:';
const OUTBOX_PREFIX = 'bridle:outbox:';

/**
 * Set once the keys written before CLEAN-231 have been removed from this
 * browser. It is also what makes the removal safe: scoped keys are written
 * only after it, so while it is absent everything under the two prefixes is
 * an old key.
 */
export const SWEEP_FLAG_KEY = 'ranch.accountKeys.admin';

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
 * message was never received by anyone, so nothing the server holds is lost.
 * Returns the keys it removed.
 */
export function sweepUnscopedKeys(storage: IKeyStorage): string[] {
  if (storage.getItem(SWEEP_FLAG_KEY) === '1') return [];
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (key.startsWith(DEBUG_PREFIX) || key.startsWith(OUTBOX_PREFIX))) old.push(key);
  }
  for (const key of old) storage.removeItem(key);
  storage.setItem(SWEEP_FLAG_KEY, '1');
  return old;
}
