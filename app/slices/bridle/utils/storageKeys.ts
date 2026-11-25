// Where this console keeps things in the browser, and for whom (CLEAN-231,
// spec 032 FR-028). Twin of `admin/slices/bridle/utils/storageKeys.ts`: the
// same rule, this console's own keys.
//
// Two people may use one browser. A key that holds a conversation or names an
// agent therefore carries the id of the account it belongs to, and nothing is
// read or written for a console conversation while that id is not known.
// A share-link conversation has no account: its key starts with `share:` and
// stays as it was.
//
// Pure on purpose: no `window`, no store. The caller hands in the id and, for
// the sweep, the storage.

const CONVERSATION_PREFIX = 'bridle:conversation:';
const SEQ_PREFIX = 'bridle:seq:';
// The messages waiting for the agent (CLEAN-245). Scoped from its first day,
// so the sweep below has nothing of it to remove and leaves it alone.
const QUEUE_PREFIX = 'bridle:queue:';
const LAST_AGENT_KEY = 'agent:lastOpened';

/** What a share-link conversation's key starts with (`share:<agent>:<visitor>`). */
export const SHARE_KEY_PREFIX = 'share:';

/**
 * Set once the keys written before CLEAN-231 have been removed from this
 * browser. It is also what makes the removal safe: scoped keys are written
 * only after it, so while it is absent everything under the console prefixes
 * that is not a share key is an old one.
 */
export const SWEEP_FLAG_KEY = 'ranch.accountKeys.app';

export function isShareKey(key: string): boolean {
  return key.startsWith(SHARE_KEY_PREFIX);
}

function scoped(prefix: string, userId: string | null, key: string): string | null {
  if (isShareKey(key)) return prefix + key;
  if (!userId) return null;
  return `${prefix}${userId}:${key}`;
}

/** Storage key of a conversation's copy; null when there is nobody to keep it for. */
export function conversationKey(userId: string | null, key: string): string | null {
  return scoped(CONVERSATION_PREFIX, userId, key);
}

/** Storage key of a conversation's highest hub `seq`; null like the above. */
export function seqKey(userId: string | null, key: string): string | null {
  return scoped(SEQ_PREFIX, userId, key);
}

/**
 * Storage key of the messages a conversation still has to send. A share-link
 * conversation's key already names its visitor, so there the visitor is the
 * owner; null like the above.
 */
export function queueKey(userId: string | null, key: string): string | null {
  return scoped(QUEUE_PREFIX, userId, key);
}

/** Storage key of the agent this account opened last. */
export function lastAgentKey(userId: string | null): string | null {
  return userId ? `${LAST_AGENT_KEY}:${userId}` : null;
}

/** The part of `Storage` the sweep needs; a test hands in a plain object. */
export interface IKeyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isUnscopedConsoleKey(key: string): boolean {
  if (key === LAST_AGENT_KEY) return true;
  for (const prefix of [CONVERSATION_PREFIX, SEQ_PREFIX]) {
    if (key.startsWith(prefix)) return !isShareKey(key.slice(prefix.length));
  }
  return false;
}

/**
 * Remove what the console kept before keys carried an account: once per
 * browser, on the first boot after the upgrade, before anything is written
 * under the new keys. Nothing is lost: the server holds the conversation.
 * Returns the keys it removed.
 */
export function sweepUnscopedKeys(storage: IKeyStorage): string[] {
  if (storage.getItem(SWEEP_FLAG_KEY) === '1') return [];
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isUnscopedConsoleKey(key)) old.push(key);
  }
  for (const key of old) storage.removeItem(key);
  storage.setItem(SWEEP_FLAG_KEY, '1');
  return old;
}
