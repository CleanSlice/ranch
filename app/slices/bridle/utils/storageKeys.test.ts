import { describe, expect, test } from 'bun:test';
import {
  SWEEP_FLAG_KEY,
  conversationKey,
  lastAgentKey,
  queueKey,
  seqKey,
  sweepUnscopedKeys,
  type IKeyStorage,
} from './storageKeys';

/** A `Storage` over a plain map, in insertion order like the real one. */
function storageOf(entries: Record<string, string>): IKeyStorage & { keys(): string[] } {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

describe('account-scoped keys', () => {
  test('a console conversation carries the account id', () => {
    expect(conversationKey('u1', 'agent-a')).toBe('bridle:conversation:u1:agent-a');
    expect(seqKey('u1', 'agent-a')).toBe('bridle:seq:u1:agent-a');
    expect(lastAgentKey('u1')).toBe('agent:lastOpened:u1');
  });

  test('two accounts never share a key for the same agent', () => {
    expect(conversationKey('u1', 'agent-a') === conversationKey('u2', 'agent-a')).toBe(false);
    expect(seqKey('u1', 'agent-a') === seqKey('u2', 'agent-a')).toBe(false);
    expect(lastAgentKey('u1') === lastAgentKey('u2')).toBe(false);
  });

  test('without a known account there is no key at all', () => {
    expect(conversationKey(null, 'agent-a')).toBe(null);
    expect(seqKey(null, 'agent-a')).toBe(null);
    expect(lastAgentKey(null)).toBe(null);
  });

  test('a share-link conversation keeps its key, whoever is signed in', () => {
    expect(conversationKey(null, 'share:agent-a:v1')).toBe('bridle:conversation:share:agent-a:v1');
    expect(conversationKey('u1', 'share:agent-a:v1')).toBe('bridle:conversation:share:agent-a:v1');
    expect(seqKey(null, 'share:agent-a:v1')).toBe('bridle:seq:share:agent-a:v1');
    expect(seqKey('u1', 'share:agent-a:v1')).toBe('bridle:seq:share:agent-a:v1');
  });
});

describe('the queue of a conversation', () => {
  test('belongs to the account, or to the visitor of a share link', () => {
    expect(queueKey('u1', 'agent-a')).toBe('bridle:queue:u1:agent-a');
    expect(queueKey('u1', 'agent-a') === queueKey('u2', 'agent-a')).toBe(false);
    expect(queueKey(null, 'agent-a')).toBe(null);
    expect(queueKey(null, 'share:agent-a:v1')).toBe('bridle:queue:share:agent-a:v1');
    expect(queueKey('u1', 'share:agent-a:v1')).toBe('bridle:queue:share:agent-a:v1');
  });

  test('is never an old key: a browser that has not swept yet leaves it alone', () => {
    const storage = storageOf({ [queueKey('u1', 'agent-a') as string]: '[]' });
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.getItem('bridle:queue:u1:agent-a')).toBe('[]');
  });
});

describe('the one-time removal of old keys', () => {
  const OLD = {
    'bridle:conversation:agent-a': '[]',
    'bridle:seq:agent-a': '7',
    'agent:lastOpened': 'agent-a',
    'bridle:conversation:share:agent-a:v1': '[]',
    'bridle:seq:share:agent-a:v1': '3',
    'bridle:share:visitor': 'v1',
    'agent:view': 'list',
    'agent:sheetOpen': '1',
    'ranch.session': '1',
  };

  test('removes the unscoped console keys and nothing else', () => {
    const storage = storageOf(OLD);
    const removed = sweepUnscopedKeys(storage);
    expect(removed.sort()).toEqual(['agent:lastOpened', 'bridle:conversation:agent-a', 'bridle:seq:agent-a']);
    expect(storage.keys().sort()).toEqual(
      [
        'agent:sheetOpen',
        'agent:view',
        'bridle:conversation:share:agent-a:v1',
        'bridle:seq:share:agent-a:v1',
        'bridle:share:visitor',
        'ranch.session',
        SWEEP_FLAG_KEY,
      ].sort(),
    );
  });

  test('runs once: scoped keys written afterwards are never taken for old ones', () => {
    const storage = storageOf(OLD);
    sweepUnscopedKeys(storage);
    storage.setItem(conversationKey('u1', 'agent-a') as string, '[]');
    storage.setItem(seqKey('u1', 'agent-a') as string, '9');
    storage.setItem(lastAgentKey('u1') as string, 'agent-a');
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.getItem('bridle:conversation:u1:agent-a')).toBe('[]');
    expect(storage.getItem('bridle:seq:u1:agent-a')).toBe('9');
    expect(storage.getItem('agent:lastOpened:u1')).toBe('agent-a');
  });

  test('an empty browser is only marked', () => {
    const storage = storageOf({});
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.keys()).toEqual([SWEEP_FLAG_KEY]);
  });
});
