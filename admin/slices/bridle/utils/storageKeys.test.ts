import { describe, expect, test } from 'bun:test';
import {
  SWEEP_FLAG_KEY,
  debugKey,
  outboxKey,
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
  test('debug snapshots and the outbox carry the account id', () => {
    expect(debugKey('u1', 'agent-a')).toBe('bridle:debug:u1:agent-a');
    expect(outboxKey('u1', 'agent-a:admin')).toBe('bridle:outbox:u1:agent-a:admin');
  });

  test('two accounts never share a key for the same agent', () => {
    expect(debugKey('u1', 'agent-a') === debugKey('u2', 'agent-a')).toBe(false);
    expect(outboxKey('u1', 'agent-a:admin') === outboxKey('u2', 'agent-a:admin')).toBe(false);
  });

  test('without a known account there is no key at all', () => {
    expect(debugKey(null, 'agent-a')).toBe(null);
    expect(outboxKey(null, 'agent-a:admin')).toBe(null);
  });
});

describe('the one-time removal of old keys', () => {
  const OLD = {
    'bridle:debug:agent-a': '{}',
    'bridle:outbox:agent-a:admin': '[]',
    'bridle:markdownEnabled': '1',
    'admin.list.agents.view': 'table',
    'ranch.session': '1',
  };

  test('removes the unscoped debug and outbox keys and nothing else', () => {
    const storage = storageOf(OLD);
    const removed = sweepUnscopedKeys(storage);
    expect(removed.sort()).toEqual(['bridle:debug:agent-a', 'bridle:outbox:agent-a:admin']);
    expect(storage.keys().sort()).toEqual(
      ['admin.list.agents.view', 'bridle:markdownEnabled', 'ranch.session', SWEEP_FLAG_KEY].sort(),
    );
  });

  test('runs once: scoped keys written afterwards are never taken for old ones', () => {
    const storage = storageOf(OLD);
    sweepUnscopedKeys(storage);
    storage.setItem(debugKey('u1', 'agent-a') as string, '{}');
    storage.setItem(outboxKey('u1', 'agent-a:admin') as string, '[]');
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.getItem('bridle:debug:u1:agent-a')).toBe('{}');
    expect(storage.getItem('bridle:outbox:u1:agent-a:admin')).toBe('[]');
  });

  test('an empty browser is only marked', () => {
    const storage = storageOf({});
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.keys()).toEqual([SWEEP_FLAG_KEY]);
  });
});
