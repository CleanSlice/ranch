// The hub says "not found" for a console conversation (CLEAN-231): the
// socket was refused at the handshake, on a message, or closed when access
// was taken away. The store itself runs here, as in bridle.reset.test.ts:
// what Nuxt would auto-import is put on `globalThis` first, and the store is
// loaded after.

import { describe, expect, test } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import type {
  IBridleChannelEvents,
  IBridleConversation,
  IBridleSendAck,
} from '../domain/bridle.types';
import { conversationKey, seqKey } from '../utils/storageKeys';

interface IWire {
  events: IBridleChannelEvents;
  closed: boolean;
}

const wires: Record<string, IWire[]> = {};

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
    return { messages: [], nextCursor: null, hasMore: false };
  },
};

const user = { id: 'u1', role: 'User' };
let refreshed = 0;
let ended: string[] = [];
const auth = {
  accessToken: 'token',
  user,
  async ensureFresh() {
    return true;
  },
  async refresh() {
    refreshed += 1;
    return true;
  },
  endSession(code: string) {
    ended.push(code);
  },
  hasRole(...required: string[]) {
    return required.some((r) => r === user.role);
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

// An instance of the store module of its own: `bun test slices` runs every
// file in one process, and the module keeps the service it was first given.
const OWN_INSTANCE = './bridle?agent-unreachable';
const { useBridleStore } = (await import(OWN_INSTANCE)) as typeof import('./bridle');

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let agents = 0;

/** A fresh store with one chat open, connected and used. */
async function open(share?: IBridleConversation['share']) {
  stored.clear();
  refreshed = 0;
  ended = [];
  setActivePinia(createPinia());
  const store = useBridleStore();
  const agentId = `agent-gone-${++agents}`;
  const conv: IBridleConversation = share
    ? { key: `share:${agentId}`, agentId, share }
    : { key: agentId, agentId };
  await store.acquire(conv);
  const wire = wires[agentId][0];
  wire.events.onConnected();
  wire.events.onWelcome({ clientId: 'u1', seq: 4 });
  await settle();
  store.sendMessage(conv, 'a question');
  wire.events.onMessage({ text: 'an answer', messageId: 'm-1', ts: Date.now(), seq: 5 });
  return { store, conv, wire, agentId };
}

describe('AGENT_NOT_FOUND on a console conversation', () => {
  test('the conversation is emptied, on screen and in the browser', async () => {
    const { store, conv, wire, agentId } = await open();
    expect(store.messagesFor(agentId).length).toBe(2);
    expect(stored.has(conversationKey('u1', agentId) as string)).toBe(true);

    wire.events.onRejected('AGENT_NOT_FOUND');
    await settle();

    expect(store.messagesFor(agentId).length).toBe(0);
    expect(store.conversations[agentId] === undefined).toBe(true);
    expect(store.isPending(agentId)).toBe(false);
    expect(store.thinkingFor(agentId).length).toBe(0);
    expect(store.hasOlder(agentId)).toBe(false);
    expect(stored.has(conversationKey('u1', agentId) as string)).toBe(false);
    expect(stored.has(seqKey('u1', agentId) as string)).toBe(false);
    // Nothing is said under a chat that is not there any more.
    expect(store.errorFor(agentId)).toBe(null);
    expect(store.connectionFor(conv.key)).toBe('offline');
  });

  test('the socket is closed and the agent is marked for the page', async () => {
    const { store, wire, agentId } = await open();
    expect(store.isUnreachable(agentId)).toBe(false);

    wire.events.onRejected('AGENT_NOT_FOUND');
    await settle();

    expect(wire.closed).toBe(true);
    expect(store.isUnreachable(agentId)).toBe(true);
    // Not a token to renew and not a session that ended.
    expect(refreshed).toBe(0);
    expect(ended).toEqual([]);

    store.clearUnreachable(agentId);
    expect(store.isUnreachable(agentId)).toBe(false);
  });

  test('an account change takes the mark with it', async () => {
    const { store, wire, agentId } = await open();
    wire.events.onRejected('AGENT_NOT_FOUND');
    await settle();
    store.resetForAccount();
    expect(store.isUnreachable(agentId)).toBe(false);
  });

  test('any other refusal still leaves the conversation and says why', async () => {
    const { store, wire, agentId } = await open();
    wire.events.onRejected('SOMETHING_ELSE');
    await settle();
    expect(store.messagesFor(agentId).length).toBe(2);
    expect(store.isUnreachable(agentId)).toBe(false);
    expect(store.errorFor(agentId)?.key).toBe('chat.error_rejected');
    expect(wire.closed).toBe(false);
  });
});

describe('a share-link conversation', () => {
  const share = { token: 'share-token', visitorId: 'visitor-1' };

  test('keeps its own dead-link handling', async () => {
    const { store, conv, wire, agentId } = await open(share);
    wire.events.onRejected('SHARE_LINK_INVALID');
    await settle();
    expect(store.isShareRevoked(conv.key)).toBe(true);
    expect(store.isUnreachable(agentId)).toBe(false);
    expect(store.messagesFor(conv.key).length).toBe(2);
  });

  test('is never emptied by AGENT_NOT_FOUND: it has no account to refuse', async () => {
    const { store, conv, wire, agentId } = await open(share);
    wire.events.onRejected('AGENT_NOT_FOUND');
    await settle();
    expect(store.isUnreachable(agentId)).toBe(false);
    expect(store.isShareRevoked(conv.key)).toBe(false);
    expect(store.messagesFor(conv.key).length).toBe(2);
    expect(store.errorFor(conv.key)?.key).toBe('chat.error_rejected');
    expect(wire.closed).toBe(false);
  });
});
