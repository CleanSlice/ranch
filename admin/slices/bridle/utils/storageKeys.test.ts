import { describe, expect, test } from 'bun:test';
import {
  SWEEP_FLAG_KEY,
  SWEEP_VERSION,
  agentPendingRestartKey,
  agentRestartInFlightKey,
  debugKey,
  filePendingRestartKey,
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

  test('the restart marks are one map per account', () => {
    expect(agentPendingRestartKey('u1')).toBe('agent:pendingRestart:u1');
    expect(agentRestartInFlightKey('u1')).toBe('agent:restartInFlight:u1');
    expect(filePendingRestartKey('u1')).toBe('agentFile:pendingRestart:u1');
    expect(agentPendingRestartKey('u1') === agentPendingRestartKey('u2')).toBe(false);
    expect(agentRestartInFlightKey('u1') === agentRestartInFlightKey('u2')).toBe(false);
    expect(filePendingRestartKey('u1') === filePendingRestartKey('u2')).toBe(false);
  });

  test('and have no key while nobody is signed in', () => {
    expect(agentPendingRestartKey(null)).toBe(null);
    expect(agentRestartInFlightKey(null)).toBe(null);
    expect(filePendingRestartKey(null)).toBe(null);
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
    expect(storage.getItem(SWEEP_FLAG_KEY)).toBe(SWEEP_VERSION);
  });
});

describe('the restart marks kept before they carried an account', () => {
  const OLD_RESTART = {
    'agent:pendingRestart': '{"agent-a":true}',
    'agent:restartInFlight': '{"agent-a":1}',
    'agentFile:pendingRestart': '{"agent-a":true}',
  };

  test('a browser that was never swept loses them with the rest', () => {
    const storage = storageOf({ ...OLD_RESTART, 'bridle:debug:agent-a': '{}', 'ranch.session': '1' });
    expect(sweepUnscopedKeys(storage).sort()).toEqual(
      [...Object.keys(OLD_RESTART), 'bridle:debug:agent-a'].sort(),
    );
    expect(storage.keys().sort()).toEqual(['ranch.session', SWEEP_FLAG_KEY].sort());
    expect(storage.getItem(SWEEP_FLAG_KEY)).toBe(SWEEP_VERSION);
  });

  test('a browser that ran the first removal still loses them, once, and keeps its scoped keys', () => {
    const storage = storageOf({
      ...OLD_RESTART,
      [SWEEP_FLAG_KEY]: '1',
      'bridle:debug:u1:agent-a': '{}',
      'bridle:outbox:u1:agent-a:admin': '[]',
    });
    expect(sweepUnscopedKeys(storage).sort()).toEqual(Object.keys(OLD_RESTART).sort());
    expect(storage.getItem('bridle:debug:u1:agent-a')).toBe('{}');
    expect(storage.getItem('bridle:outbox:u1:agent-a:admin')).toBe('[]');
    expect(storage.getItem(SWEEP_FLAG_KEY)).toBe(SWEEP_VERSION);
    expect(sweepUnscopedKeys(storage)).toEqual([]);
  });

  test('the scoped maps written afterwards are never taken for old ones', () => {
    const storage = storageOf({ [SWEEP_FLAG_KEY]: '1' });
    sweepUnscopedKeys(storage);
    storage.setItem(agentPendingRestartKey('u1') as string, '{"agent-a":true}');
    storage.setItem(agentRestartInFlightKey('u1') as string, '{"agent-a":1}');
    storage.setItem(filePendingRestartKey('u1') as string, '{"agent-a":true}');
    expect(sweepUnscopedKeys(storage)).toEqual([]);
    expect(storage.getItem('agent:pendingRestart:u1')).toBe('{"agent-a":true}');
    expect(storage.getItem('agent:restartInFlight:u1')).toBe('{"agent-a":1}');
    expect(storage.getItem('agentFile:pendingRestart:u1')).toBe('{"agent-a":true}');
  });

  test('even a browser whose flag was lost keeps a scoped restart map', () => {
    // No flag: the first step runs again and takes what is under its two
    // prefixes. The restart maps are matched by exact name, so a scoped one
    // is safe whatever the flag says.
    const storage = storageOf({ 'agent:pendingRestart:u1': '{"agent-a":true}', ...OLD_RESTART });
    expect(sweepUnscopedKeys(storage).sort()).toEqual(Object.keys(OLD_RESTART).sort());
    expect(storage.getItem('agent:pendingRestart:u1')).toBe('{"agent-a":true}');
  });
});
