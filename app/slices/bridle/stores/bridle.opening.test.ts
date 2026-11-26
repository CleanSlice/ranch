// A conversation being opened (CLEAN-260): from the moment its channel is
// asked for until the server's newest page is merged, a chat with nothing to
// show says "loading", not "empty". The store itself runs here, as in
// bridle.unreachable.test.ts: what Nuxt would auto-import is put on
// `globalThis` first, and the store is loaded after.

import { describe, expect, test } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import {
  BridleRoleTypes,
  type IBridleChannelEvents,
  type IBridleConversation,
  type IBridleSendAck,
  type IBridleTranscriptPage,
} from '../domain/bridle.types';
import { conversationKey } from '../utils/storageKeys';

interface IWire {
  events: IBridleChannelEvents;
  closed: boolean;
}

const wires: Record<string, IWire[]> = {};

/** The transcript answers when the test says so. */
let answer: {
  resolve: (page: IBridleTranscriptPage) => void;
  reject: (err: Error) => void;
} | null = null;
let asked = 0;

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
  transcriptPage() {
    asked += 1;
    return new Promise<IBridleTranscriptPage>((resolve, reject) => {
      answer = { resolve, reject };
    });
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
  async refresh() {
    return true;
  },
  endSession() {},
  hasRole(...required: string[]) {
    return required.some((r) => r === user?.role);
  },
};

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

// An instance of the store module of its own: `bun test slices` runs every
// file in one process, and the module keeps the service it was first given.
const OWN_INSTANCE = './bridle?opening';
const { useBridleStore } = (await import(OWN_INSTANCE)) as typeof import('./bridle');

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let agents = 0;

function fresh() {
  stored.clear();
  answer = null;
  asked = 0;
  user = { id: 'u1', role: 'User' };
  setActivePinia(createPinia());
  const store = useBridleStore();
  const agentId = `agent-opening-${++agents}`;
  const conv: IBridleConversation = { key: agentId, agentId };
  return { store, conv, agentId };
}

const page = (texts: string[]): IBridleTranscriptPage => ({
  messages: texts.map((text, i) => ({
    id: `srv-${i}`,
    role: i % 2 === 0 ? BridleRoleTypes.User : BridleRoleTypes.Agent,
    text,
    ts: Date.now() - (texts.length - i) * 1000,
  })),
  nextCursor: null,
  hasMore: false,
});

describe('a conversation being opened', () => {
  test('is "opening" from the first hold until the newest page is merged', async () => {
    const { store, conv, agentId } = fresh();
    expect(store.isOpening(agentId)).toBe(false);

    const held = store.acquire(conv);
    // Before the first await of `acquire`: the first frame already knows.
    expect(store.isOpening(agentId)).toBe(true);
    await held;

    const wire = wires[agentId][0];
    wire.events.onConnected();
    expect(store.isOpening(agentId)).toBe(true);
    wire.events.onWelcome({ clientId: 'u1', seq: 0 });
    await settle();
    expect(asked).toBe(1);
    expect(store.isOpening(agentId)).toBe(true);
    expect(store.messagesFor(agentId).length).toBe(0);

    answer?.resolve(page(['a question', 'an answer']));
    await settle();
    expect(store.messagesFor(agentId).length).toBe(2);
    expect(store.isOpening(agentId)).toBe(false);
  });

  test('an empty conversation stops being "opening" when the server says so', async () => {
    const { store, conv, agentId } = fresh();
    await store.acquire(conv);
    wires[agentId][0].events.onWelcome({ clientId: 'u1', seq: 0 });
    await settle();
    answer?.resolve(page([]));
    await settle();
    expect(store.messagesFor(agentId).length).toBe(0);
    expect(store.isOpening(agentId)).toBe(false);
  });

  test('a load that fails ends the wait: the stored copy, or the starter, stands', async () => {
    const { store, conv, agentId } = fresh();
    await store.acquire(conv);
    wires[agentId][0].events.onWelcome({ clientId: 'u1', seq: 0 });
    await settle();
    answer?.reject(new Error('503'));
    await settle();
    expect(store.isOpening(agentId)).toBe(false);
  });

  test('a socket that drops, or is refused, ends the wait', async () => {
    const first = fresh();
    await first.store.acquire(first.conv);
    wires[first.agentId][0].events.onDisconnected();
    expect(first.store.isOpening(first.agentId)).toBe(false);

    const second = fresh();
    await second.store.acquire(second.conv);
    wires[second.agentId][0].events.onRejected('SOMETHING_ELSE');
    await settle();
    expect(second.store.isOpening(second.agentId)).toBe(false);
  });

  test('an anonymous visitor has no history to wait for', async () => {
    const { store, conv, agentId } = fresh();
    user = null;
    await store.acquire(conv);
    expect(store.isOpening(agentId)).toBe(false);
    wires[agentId][0].events.onWelcome({ clientId: 'anon-1', seq: 0 });
    await settle();
    expect(asked).toBe(0);
    expect(store.isOpening(agentId)).toBe(false);
  });

  test('a conversation already loaded in this page session opens at once', async () => {
    const { store, conv, agentId } = fresh();
    await store.acquire(conv);
    wires[agentId][0].events.onWelcome({ clientId: 'u1', seq: 0 });
    await settle();
    answer?.resolve(page(['a question', 'an answer']));
    await settle();

    // Another chat takes the same conversation (a switch away and back
    // inside the grace delay), then a later one after the socket closed.
    store.release(conv);
    await store.acquire(conv);
    expect(store.isOpening(agentId)).toBe(false);
    expect(store.messagesFor(agentId).length).toBe(2);
  });

  test('the kept copy is on screen while the page is on its way, and stays when it merges', async () => {
    const { store, conv, agentId } = fresh();
    const now = Date.now();
    stored.set(
      conversationKey('u1', agentId) as string,
      JSON.stringify([
        { id: 'wire-1', role: BridleRoleTypes.User, text: 'a question', ts: now - 2000, seq: 1 },
        { id: 'wire-2', role: BridleRoleTypes.Agent, text: 'an answer', ts: now - 1000, seq: 2 },
      ]),
    );
    store.hydrate(conv);
    expect(store.messagesFor(agentId).map((m) => m.text)).toEqual(['a question', 'an answer']);

    await store.acquire(conv);
    wires[agentId][0].events.onWelcome({ clientId: 'u1', seq: 0 });
    await settle();
    // Still the kept copy: nothing is taken away while the answer is awaited.
    expect(store.messagesFor(agentId).length).toBe(2);

    // The server holds the same two, under its own ids.
    answer?.resolve({
      messages: [
        { id: 'srv-1', role: BridleRoleTypes.User, text: 'a question', ts: now - 2000 },
        { id: 'srv-2', role: BridleRoleTypes.Agent, text: 'an answer', ts: now - 1000 },
      ],
      nextCursor: null,
      hasMore: false,
    });
    await settle();
    expect(store.messagesFor(agentId).map((m) => m.text)).toEqual(['a question', 'an answer']);
    expect(store.isOpening(agentId)).toBe(false);
  });

  test('an account change forgets every wait', async () => {
    const { store, conv, agentId } = fresh();
    await store.acquire(conv);
    expect(store.isOpening(agentId)).toBe(true);
    store.resetForAccount();
    expect(store.isOpening(agentId)).toBe(false);
  });
});
