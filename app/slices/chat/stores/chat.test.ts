// The chat store's history index (CLEAN-248): conversations kept once by id,
// one index per agent, and the guards that keep a late answer out. The store
// itself runs here, as in bridle.reset.test.ts: what Nuxt would auto-import is
// put on `globalThis` first, and the store is loaded after.

import { describe, expect, test as bunTest } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import type {
  IChatListQuery,
  IChatListResult,
  IChatSession,
} from '../domain/chat.types';

function session(id: string, agentId: string, archived: boolean): IChatSession {
  return {
    id,
    agentId,
    channel: 'bridle',
    externalUserId: 'u1',
    sessionKey: `bridle:u1:${id}`,
    title: `Conversation ${id}`,
    preview: `last words of ${id}`,
    lastRole: 'assistant',
    lastMessageAt: '2026-11-20T10:00:00.000Z',
    messageCount: 4,
    userMessageCount: 2,
    summary: null,
    insights: null,
    archived,
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  };
}

/** Closed conversations per agent, as the server holds them. */
let closed: Record<string, IChatSession[]> = {};
let running: Record<string, IChatSession[]> = {};
let calls: IChatListQuery[] = [];
let synced: (string | undefined)[] = [];
/** When set, list answers wait for it. */
let gate: Promise<void> | null = null;
let failing = false;

const service = {
  async listMine(query: IChatListQuery): Promise<IChatListResult> {
    calls.push(query);
    // The answer is decided when the request is made, as on a server.
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    const source = (query.archived ? closed : running)[query.agentId ?? ''] ?? [];
    const matching = query.search
      ? source.filter((s) => (s.title ?? '').includes(query.search!))
      : source;
    const answer = {
      items: matching.slice((page - 1) * perPage, page * perPage),
      total: matching.length,
      page,
      perPage,
    };
    const fail = failing;
    if (gate) await gate;
    if (fail) throw new Error('offline');
    return answer;
  },
  async getMine(id: string): Promise<IChatSession | null> {
    for (const list of [...Object.values(closed), ...Object.values(running)]) {
      const found = list.find((s) => s.id === id);
      if (found) return found;
    }
    return null;
  },
  async syncMine(agentId?: string) {
    synced.push(agentId);
    return { scannedAgents: 1, scannedFiles: 1, upserted: 0, skipped: 0 };
  },
};

Object.assign(globalThis, {
  ref,
  computed,
  markRaw,
  defineStore,
  useNuxtApp: () => ({ $chatService: service }),
});

const { useChatStore, HISTORY_PAGE_SIZE } = await import('./chat');

function many(agentId: string, count: number): IChatSession[] {
  return Array.from({ length: count }, (_, i) => session(`${agentId}-c${i + 1}`, agentId, true));
}

/** A gate and the function that opens it. */
function hold(): () => void {
  let open!: () => void;
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    gate = null;
    open();
  };
}

/** Every test starts with an empty server and a store of its own. */
const test = (name: string, body: () => Promise<void>) =>
  bunTest(name, async () => {
    setActivePinia(createPinia());
    closed = {};
    running = {};
    calls = [];
    synced = [];
    gate = null;
    failing = false;
    await body();
  });

describe('loadHistory', () => {
  test('asks for the running and the closed list of one agent, and keeps each conversation once', async () => {
    running = { a1: [session('live', 'a1', false)] };
    closed = { a1: many('a1', 3), a2: many('a2', 5) };
    const store = useChatStore();

    await store.loadHistory('a1');

    expect(calls).toEqual([
      { agentId: 'a1', archived: false, page: 1, perPage: HISTORY_PAGE_SIZE },
      { agentId: 'a1', archived: true, search: undefined, page: 1, perPage: HISTORY_PAGE_SIZE },
    ]);
    expect(store.currentFor('a1').map((s) => s.id)).toEqual(['live']);
    expect(store.closedFor('a1').map((s) => s.id)).toEqual(['a1-c1', 'a1-c2', 'a1-c3']);
    expect(store.closedCountFor('a1')).toBe(3);
    expect(store.byId['a1-c2']!.title).toBe('Conversation a1-c2');
    // Another agent's history is not touched, and not known yet.
    expect(store.closedCountFor('a2')).toBe(null);
    expect(store.closedFor('a2')).toEqual([]);
    expect(store.historyStateFor('a1')).toEqual({
      status: 'idle',
      hasMore: false,
      moreFailed: false,
      search: '',
    });
  });

  test('a search narrows the closed list and leaves the counter alone', async () => {
    closed = { a1: many('a1', 12) };
    const store = useChatStore();
    await store.loadHistory('a1');
    expect(store.closedCountFor('a1')).toBe(12);

    await store.loadHistory('a1', 'c12');

    expect(store.closedFor('a1').map((s) => s.id)).toEqual(['a1-c12']);
    expect(store.historyStateFor('a1').search).toBe('c12');
    expect(store.closedCountFor('a1')).toBe(12);
  });

  test('a first load that is a search does not invent a counter', async () => {
    closed = { a1: many('a1', 12) };
    const store = useChatStore();
    await store.loadHistory('a1', 'c12');
    expect(store.closedCountFor('a1')).toBe(null);
  });

  test('an answer for an older search does not land under a newer one', async () => {
    closed = { a1: many('a1', 12) };
    const store = useChatStore();
    const open = hold();
    const slow = store.loadHistory('a1', 'c1'); // matches c1, c10, c11, c12
    // Only the first request is held: the second is answered at once.
    gate = null;
    await store.loadHistory('a1', 'c12');
    open();
    await slow;

    expect(store.historyStateFor('a1').search).toBe('c12');
    expect(store.closedFor('a1').map((s) => s.id)).toEqual(['a1-c12']);
  });

  test('a failure is a state, not an exception, and keeps what was listed', async () => {
    closed = { a1: many('a1', 2) };
    const store = useChatStore();
    await store.loadHistory('a1');
    failing = true;

    await store.loadHistory('a1');

    expect(store.historyStateFor('a1').status).toBe('error');
    expect(store.closedFor('a1').length).toBe(2);
    expect(store.closedCountFor('a1')).toBe(2);
  });
});

describe('loadMoreHistory', () => {
  test('appends pages until every conversation is listed, then stops', async () => {
    closed = { a1: many('a1', HISTORY_PAGE_SIZE * 2 + 5) };
    const store = useChatStore();
    await store.loadHistory('a1');
    expect(store.closedFor('a1').length).toBe(HISTORY_PAGE_SIZE);
    expect(store.historyStateFor('a1').hasMore).toBe(true);

    await store.loadMoreHistory('a1');
    await store.loadMoreHistory('a1');

    expect(store.closedFor('a1').length).toBe(HISTORY_PAGE_SIZE * 2 + 5);
    expect(store.historyStateFor('a1').hasMore).toBe(false);
    const before = calls.length;
    await store.loadMoreHistory('a1');
    expect(calls.length).toBe(before);
  });

  test('carries the search, and one request at a time', async () => {
    closed = { a1: many('a1', HISTORY_PAGE_SIZE + 10) };
    const store = useChatStore();
    await store.loadHistory('a1', 'Conversation');
    const open = hold();
    const first = store.loadMoreHistory('a1');
    const second = store.loadMoreHistory('a1');
    open();
    await Promise.all([first, second]);

    const more = calls.filter((c) => c.page === 2);
    expect(more).toEqual([
      { agentId: 'a1', archived: true, search: 'Conversation', page: 2, perPage: HISTORY_PAGE_SIZE },
    ]);
    expect(store.closedFor('a1').length).toBe(HISTORY_PAGE_SIZE + 10);
  });

  test('a failed page keeps the list and says so', async () => {
    closed = { a1: many('a1', HISTORY_PAGE_SIZE + 1) };
    const store = useChatStore();
    await store.loadHistory('a1');
    failing = true;

    await store.loadMoreHistory('a1');

    expect(store.closedFor('a1').length).toBe(HISTORY_PAGE_SIZE);
    expect(store.historyStateFor('a1')).toEqual({
      status: 'idle',
      hasMore: true,
      moreFailed: true,
      search: '',
    });
  });
});

describe('refreshHistory and syncHistory', () => {
  test('a refresh keeps the search it was shown with', async () => {
    closed = { a1: many('a1', 12) };
    const store = useChatStore();
    await store.loadHistory('a1', 'c12');
    calls = [];

    await store.refreshHistory('a1');

    expect(calls[1]!.search).toBe('c12');
  });

  test('a conversation closed since the last load shows up, and the counter follows', async () => {
    closed = { a1: many('a1', 2) };
    running = { a1: [session('live', 'a1', false)] };
    const store = useChatStore();
    await store.loadHistory('a1');

    closed = { a1: [{ ...session('live', 'a1', true) }, ...many('a1', 2)] };
    running = { a1: [] };
    await store.refreshHistory('a1');

    expect(store.currentFor('a1')).toEqual([]);
    expect(store.closedFor('a1')[0]!.id).toBe('live');
    // The same record, now closed: one conversation, one place.
    expect(store.byId.live!.archived).toBe(true);
    expect(store.closedCountFor('a1')).toBe(3);
  });

  test('sync asks the server to reconcile this agent, then reloads', async () => {
    closed = { a1: many('a1', 1) };
    const store = useChatStore();
    await store.syncHistory('a1');
    expect(synced).toEqual(['a1']);
    expect(store.closedCountFor('a1')).toBe(1);
  });
});

describe('getMine', () => {
  test('stores the conversation it returns', async () => {
    closed = { a1: many('a1', 1) };
    const store = useChatStore();
    const found = await store.getMine('a1-c1');
    expect(found?.id).toBe('a1-c1');
    expect(store.byId['a1-c1']!.agentId).toBe('a1');
    expect(await store.getMine('nope')).toBe(null);
  });
});

describe('resetForAccount', () => {
  test('empties everything, and drops an answer that was on its way', async () => {
    closed = { a1: many('a1', 3) };
    const store = useChatStore();
    await store.loadHistory('a1');
    const open = hold();
    const late = store.loadHistory('a1');

    store.resetForAccount();
    open();
    await late;

    expect(store.byId).toEqual({});
    expect(store.closedFor('a1')).toEqual([]);
    expect(store.closedCountFor('a1')).toBe(null);
  });
});
