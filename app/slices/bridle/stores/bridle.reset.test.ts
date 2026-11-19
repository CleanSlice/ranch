// An account change empties the bridle store (CLEAN-231, T071). The store
// itself runs here, as in bridle.limit.test.ts: what Nuxt would auto-import
// is put on `globalThis` first, and the store is loaded after.

import { describe, expect, test } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import type {
  IBridleChannelEvents,
  IBridleConversation,
  IBridleSendAck,
} from '../domain/bridle.types';

interface IWire {
  events: IBridleChannelEvents;
  closed: boolean;
}

const wires: Record<string, IWire[]> = {};
/** What the transcript route answers, and a way to hold the answer back. */
let transcript: { messages: unknown[]; nextCursor: string | null; hasMore: boolean } = {
  messages: [],
  nextCursor: null,
  hasMore: false,
};
let gate: Promise<void> | null = null;

const service = {
  openChannel(agentId: string, _auth: unknown, events: IBridleChannelEvents) {
    const wire: IWire = { events, closed: false };
    (wires[agentId] ??= []).push(wire);
    return {
      send() {
        return new Promise<IBridleSendAck>(() => {});
      },
      reconnect() {},
      close() {
        wire.closed = true;
      },
    };
  },
  async transcriptPage() {
    if (gate) await gate;
    return transcript;
  },
};

let user: { id: string; role: string } | null = { id: 'u1', role: 'User' };
const auth = {
  accessToken: 'token',
  get user() {
    return user;
  },
  async ensureFresh() {
    return true;
  },
  hasRole(...required: string[]) {
    return required.some((r) => r === user?.role);
  },
};

/** The browser's storage, as far as the store uses it. */
const stored = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  },
  ref,
  computed,
  markRaw,
  defineStore,
  useNuxtApp: () => ({ $bridleService: service }),
  useAuthStore: () => auth,
});

// An instance of the store module of its own. `bun test slices` runs every
// file in one process, and the module keeps the service it was first given:
// loaded under the plain name it would be the one bridle.limit.test.ts set
// up, talking to that file's channel.
const OWN_INSTANCE = './bridle?account-reset';
const { useBridleStore } = (await import(OWN_INSTANCE)) as typeof import('./bridle');

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let agents = 0;

/** A fresh store, signed in as `id`, with one chat open, connected and used. */
async function open(id = 'u1') {
  user = { id, role: 'User' };
  stored.clear();
  gate = null;
  transcript = { messages: [], nextCursor: null, hasMore: false };
  setActivePinia(createPinia());
  const store = useBridleStore();
  const agentId = `agent-reset-${++agents}`;
  const conv: IBridleConversation = { key: agentId, agentId };
  await store.acquire(conv);
  const wire = wires[agentId][0];
  wire.events.onConnected();
  wire.events.onWelcome({ clientId: id, seq: 4 });
  await settle();
  store.sendMessage(conv, 'a question from the first account');
  wire.events.onMessage({ text: 'an answer for the first account', messageId: 'm-1', ts: Date.now(), seq: 5 });
  return { store, conv, wire, agentId };
}

describe('resetForAccount', () => {
  test('no conversation, hydration mark, history mark or seq survives', async () => {
    const { store, conv, agentId } = await open();
    store.hydrate(conv);
    expect(store.messagesFor(agentId).length).toBe(2);
    expect(store.conversations[agentId] !== undefined).toBe(true);

    store.resetForAccount();

    expect(store.messagesFor(agentId).length).toBe(0);
    expect(Object.keys(store.conversations).length).toBe(0);
    expect(store.thinkingFor(agentId).length).toBe(0);
    expect(store.isPending(agentId)).toBe(false);
    expect(store.errorFor(agentId)).toBe(null);
    expect(store.draftFor(agentId)).toBe('');
    expect(store.stagedFor(agentId).length).toBe(0);
    expect(store.epochFor(agentId)).toBe(0);
    expect(store.hasOlder(agentId)).toBe(false);
    expect(store.limitFor(agentId)).toBe(null);
    expect(store.connectionFor(agentId)).toBe('offline');
    // "New chat" needs the hub's identity for the conversation: gone too.
    expect(store.newChatBlock(agentId) !== null).toBe(true);
  });

  test('the live channel is closed, and the next holder opens a new one', async () => {
    const { store, conv, wire, agentId } = await open();
    expect(wire.closed).toBe(false);

    store.resetForAccount();
    expect(wire.closed).toBe(true);

    user = { id: 'u2', role: 'User' };
    await store.acquire(conv);
    expect(wires[agentId].length).toBe(2);
    expect(wires[agentId][1].closed).toBe(false);
    store.resetForAccount();
  });

  test('the next account is not shown the copy the previous one left in the browser', async () => {
    const { store, conv, agentId } = await open('u1');
    expect(stored.has(`bridle:conversation:u1:${agentId}`)).toBe(true);
    expect(stored.has(`bridle:conversation:${agentId}`)).toBe(false);
    expect(stored.get(`bridle:seq:u1:${agentId}`)).toBe('5');

    store.resetForAccount();
    user = { id: 'u2', role: 'User' };
    store.hydrate(conv);
    expect(store.messagesFor(agentId).length).toBe(0);
    expect(stored.has(`bridle:conversation:u2:${agentId}`)).toBe(false);

    // And the first account finds its own again.
    store.resetForAccount();
    user = { id: 'u1', role: 'User' };
    store.hydrate(conv);
    expect(store.messagesFor(agentId).map((m) => m.text)).toEqual([
      'a question from the first account',
      'an answer for the first account',
    ]);
  });

  test('with nobody signed in a console conversation is neither read nor kept', async () => {
    const { store, conv, agentId } = await open('u1');
    store.resetForAccount();
    user = null;
    store.hydrate(conv);
    expect(store.messagesFor(agentId).length).toBe(0);
    const before = [...stored.keys()].sort();
    store.sendMessage(conv, 'typed by nobody in particular');
    expect([...stored.keys()].sort()).toEqual(before);
    // Read once the account is known: the first hydrate did not use it up.
    store.resetForAccount();
    user = { id: 'u1', role: 'User' };
    store.hydrate(conv);
    expect(store.messagesFor(agentId).length).toBe(2);
  });

  test('a share-link conversation keeps its key and its copy without an account', async () => {
    user = null;
    stored.clear();
    setActivePinia(createPinia());
    const store = useBridleStore();
    const conv: IBridleConversation = {
      key: 'share:agent-shared:v1',
      agentId: 'agent-shared',
      share: { token: 't', visitorId: 'v1' },
    };
    store.sendMessage(conv, 'from a visitor');
    expect(stored.has('bridle:conversation:share:agent-shared:v1')).toBe(true);

    store.resetForAccount();
    store.hydrate(conv);
    expect(store.messagesFor(conv.key).map((m) => m.text)).toEqual(['from a visitor']);
  });

  test('a transcript that was on its way belongs to the previous account and is dropped', async () => {
    user = { id: 'u1', role: 'User' };
    stored.clear();
    setActivePinia(createPinia());
    const store = useBridleStore();
    const agentId = `agent-reset-${++agents}`;
    const conv: IBridleConversation = { key: agentId, agentId };
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transcript = {
      messages: [{ id: 't-1', role: 'agent', text: 'held by the server for the first account', ts: Date.now() }],
      nextCursor: 'older',
      hasMore: true,
    };
    await store.acquire(conv);
    wires[agentId][0].events.onConnected();
    // The hub says which conversation this is; the store asks for it.
    wires[agentId][0].events.onWelcome({ clientId: 'u1', seq: null });

    store.resetForAccount();
    user = { id: 'u2', role: 'User' };
    release();
    await settle();
    await settle();

    expect(store.messagesFor(agentId).length).toBe(0);
    expect(store.hasOlder(agentId)).toBe(false);
    expect(stored.has(`bridle:conversation:u2:${agentId}`)).toBe(false);
    gate = null;
  });
});
