// The request limit in the bridle store (CLEAN-224, T035). The store itself
// runs here, against a channel the test holds both ends of: what Nuxt would
// auto-import is put on `globalThis` first, and the store is loaded after.

import { describe, expect, test } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import {
  BridleDeliveryStates,
  type IBridleChannelEvents,
  type IBridleConversation,
  type IBridleSendAck,
} from '../domain/bridle.types';

interface ISent {
  text: string;
  attachmentIds: string[] | undefined;
  id: string;
  answer: (ack: IBridleSendAck) => void;
}

/** One agent's socket, as the test sees it. */
interface IWire {
  events: IBridleChannelEvents;
  sent: ISent[];
}

const wires: Record<string, IWire> = {};
let role: 'Owner' | 'Admin' | 'User' | null = 'User';
let uploads = 0;

const service = {
  openChannel(agentId: string, _auth: unknown, events: IBridleChannelEvents) {
    const wire: IWire = { events, sent: [] };
    wires[agentId] = wire;
    return {
      send(text: string, attachmentIds: string[] | undefined, id: string) {
        return new Promise<IBridleSendAck>((resolve) => {
          wire.sent.push({ text, attachmentIds, id, answer: resolve });
        });
      },
      reconnect() {},
      close() {},
    };
  },
  async uploadAttachment(_agentId: string, file: File) {
    uploads++;
    return { id: `remote-${uploads}`, kind: 'text', mimeType: file.type };
  },
  async transcriptPage() {
    return { messages: [], nextCursor: null, hasMore: false };
  },
};

const auth = {
  accessToken: 'token',
  get user() {
    return role ? { id: 'u1', role } : null;
  },
  async ensureFresh() {
    return true;
  },
  hasRole(...required: string[]) {
    return required.some((r) => r === role);
  },
};

Object.assign(globalThis, {
  ref,
  computed,
  markRaw,
  defineStore,
  useNuxtApp: () => ({ $bridleService: service }),
  useAuthStore: () => auth,
});

const { useBridleStore } = await import('./bridle');

type IStore = ReturnType<typeof useBridleStore>;

/** Let promise callbacks (the ack's `then`, an upload) run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let agents = 0;

/** A fresh store on a fresh agent, with the chat open and connected. */
async function open(as: 'Owner' | 'Admin' | 'User' | null = 'User') {
  role = as;
  setActivePinia(createPinia());
  const store = useBridleStore();
  const agentId = `agent-${++agents}`;
  const conv: IBridleConversation = { key: agentId, agentId };
  await store.acquire(conv);
  const wire = wires[agentId];
  wire.events.onConnected();
  wire.events.onWelcome({ clientId: 'anon-1', seq: null });
  return { store, conv, wire, agentId };
}

function refuse(sent: ISent, retryAfterMs = 60_000, window: 'minute' | 'hour' | 'day' = 'minute') {
  sent.answer({ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs, window });
  return settle();
}

/** Ends the limit so its timer does not outlive the test. */
function lift(wire: IWire) {
  wire.events.onAgentLimit({ limited: false });
}

function deliveryOf(store: IStore, key: string, index: number) {
  return store.messagesFor(key)[index]?.delivery;
}

describe('a send the limit refuses', () => {
  test('leaves the conversation, returns its text and opens no typing state', async () => {
    const { store, conv, wire, agentId } = await open();
    store.sendMessage(conv, 'What are your opening hours?');
    expect(store.messagesFor(conv.key).length).toBe(1);
    expect(store.isPending(conv.key)).toBe(true);

    const before = performance.now();
    await refuse(wire.sent[0], 42_000, 'minute');

    expect(store.messagesFor(conv.key).length).toBe(0);
    expect(store.draftFor(conv.key)).toBe('What are your opening hours?');
    expect(store.isPending(conv.key)).toBe(false);
    expect(store.errorFor(conv.key)).toBe(null);

    const limit = store.limitFor(agentId);
    expect(limit?.window).toBe('minute');
    expect((limit?.until ?? 0) >= before + 42_000).toBe(true);
    expect((limit?.until ?? 0) <= performance.now() + 42_000).toBe(true);
    expect(store.isLimited(conv)).toBe(true);
    lift(wire);
  });

  test('gets its attachments back in the composer', async () => {
    const { store, conv, wire } = await open();
    store.stageFiles(conv, [new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
    await settle();
    expect(store.stagedFor(conv.key).length).toBe(1);

    store.sendMessage(conv, 'see the file');
    // Out of the composer while the message is on its way…
    expect(store.stagedFor(conv.key).length).toBe(0);
    expect(wire.sent[0].attachmentIds?.length).toBe(1);

    await refuse(wire.sent[0]);

    // …and back, still uploaded, when the limit refused it.
    const back = store.stagedFor(conv.key);
    expect(back.length).toBe(1);
    expect(back[0].name).toBe('notes.txt');
    expect(back[0].remoteId).toBe(wire.sent[0].attachmentIds?.[0]);
    expect(store.canSend(conv.key, '')).toBe(true);
    expect(store.draftFor(conv.key)).toBe('see the file');
    expect(store.messagesFor(conv.key).length).toBe(0);
    lift(wire);
  });

  test('keeps an answer that was already awaited', async () => {
    const { store, conv, wire } = await open();
    store.sendMessage(conv, 'first');
    wire.sent[0].answer({ status: 'accepted', messageId: wire.sent[0].id, ts: 1 });
    await settle();
    wire.events.onTyping();
    expect(store.isPending(conv.key)).toBe(true);

    store.sendMessage(conv, 'second');
    await refuse(wire.sent[1]);

    // The first message's turn is still in progress: its line stays.
    expect(store.isPending(conv.key)).toBe(true);
    expect(store.messagesFor(conv.key).length).toBe(1);
    expect(store.draftFor(conv.key)).toBe('second');
    lift(wire);
  });

  test('two sends refused in a row leave nothing waiting', async () => {
    const { store, conv, wire } = await open();
    store.sendMessage(conv, 'one');
    store.sendMessage(conv, 'two');
    await refuse(wire.sent[0]);
    await refuse(wire.sent[1]);

    expect(store.messagesFor(conv.key).length).toBe(0);
    expect(store.isPending(conv.key)).toBe(false);
    lift(wire);
  });

  test('a second refusal replaces the wait', async () => {
    const { store, conv, wire, agentId } = await open();
    store.sendMessage(conv, 'hello');
    await refuse(wire.sent[0], 20, 'minute');
    const first = store.limitFor(agentId)?.until ?? 0;
    // The composer takes the text back and consumes the hand-over.
    store.clearDraft(conv.key);

    // The short wait runs out, the person sends again, someone else was faster.
    await wait(40);
    expect(store.isLimited(conv)).toBe(false);
    store.sendMessage(conv, 'hello');
    await refuse(wire.sent[1], 3_600_000, 'hour');

    const second = store.limitFor(agentId);
    expect(second?.window).toBe('hour');
    expect((second?.until ?? 0) > first + 3_000_000).toBe(true);
    expect(store.draftFor(conv.key)).toBe('hello');
    lift(wire);
  });

  test('a refused resend stays the undelivered message it was', async () => {
    const { store, conv, wire } = await open();
    store.sendMessage(conv, 'are you there?');
    wire.sent[0].answer({ status: 'rejected', code: 'AGENT_OFFLINE' });
    await settle();
    expect(deliveryOf(store, conv.key, 0)).toBe(BridleDeliveryStates.Failed);

    store.resend(conv, wire.sent[0].id);
    await refuse(wire.sent[1]);

    const message = store.messagesFor(conv.key)[0];
    expect(message.delivery).toBe(BridleDeliveryStates.Failed);
    expect(message.failureCode).toBe('AGENT_OFFLINE');
    expect(store.draftFor(conv.key)).toBe('');
    expect(store.isPending(conv.key)).toBe(false);
    expect(store.isLimited(conv)).toBe(true);
    lift(wire);
  });
});

describe('agent_limit', () => {
  test('sets the limit without a send', async () => {
    const { store, conv, wire, agentId } = await open();
    expect(store.limitFor(agentId)).toBe(null);

    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

    expect(store.limitFor(agentId)?.window).toBe('hour');
    expect(store.isLimited(conv)).toBe(true);
    expect(wire.sent.length).toBe(0);
    lift(wire);
  });

  test('limited: false clears it', async () => {
    const { store, conv, wire, agentId } = await open();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'day' });
    wire.events.onAgentLimit({ limited: false });

    expect(store.limitFor(agentId)).toBe(null);
    expect(store.isLimited(conv)).toBe(false);
  });

  test('is not a reason to stop an Owner or an Admin', async () => {
    for (const operator of ['Owner', 'Admin'] as const) {
      const { store, conv, wire, agentId } = await open(operator);
      wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

      expect(store.limitFor(agentId)).toBe(null);
      expect(store.isLimited(conv)).toBe(false);
      store.sendMessage(conv, 'checking in');
      expect(wire.sent.length).toBe(1);
    }
  });

  test('stops a share visitor even in a browser where an Owner is signed in', async () => {
    const { store, wire, agentId } = await open('Owner');
    const visitor: IBridleConversation = {
      key: `share:${agentId}`,
      agentId,
      share: { token: 't', visitorId: 'v' } as IBridleConversation['share'],
    };
    await store.acquire(visitor);
    const shareWire = wires[agentId];
    shareWire.events.onConnected();
    shareWire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

    expect(store.isLimited(visitor)).toBe(true);
    lift(shareWire);
    lift(wire);
  });
});

describe('while the limit is full', () => {
  test('a send does not reach the socket and the text comes back', async () => {
    const { store, conv, wire } = await open();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

    store.sendMessage(conv, 'one more thing');

    expect(wire.sent.length).toBe(0);
    expect(store.messagesFor(conv.key).length).toBe(0);
    expect(store.isPending(conv.key)).toBe(false);
    expect(store.draftFor(conv.key)).toBe('one more thing');
    lift(wire);
  });

  test('staged files stay staged', async () => {
    const { store, conv, wire } = await open();
    store.stageFiles(conv, [new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
    await settle();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

    store.sendMessage(conv, '');

    expect(wire.sent.length).toBe(0);
    expect(store.stagedFor(conv.key).length).toBe(1);
    lift(wire);
  });

  test('a resend does not reach the socket either', async () => {
    const { store, conv, wire } = await open();
    store.sendMessage(conv, 'are you there?');
    wire.sent[0].answer({ status: 'rejected', code: 'AGENT_OFFLINE' });
    await settle();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });

    store.resend(conv, wire.sent[0].id);

    expect(wire.sent.length).toBe(1);
    expect(deliveryOf(store, conv.key, 0)).toBe(BridleDeliveryStates.Failed);
    lift(wire);
  });

  test('the limit goes by itself when its wait is over, and sending works', async () => {
    const { store, conv, wire, agentId } = await open();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 20, window: 'hour' });
    expect(store.isLimited(conv)).toBe(true);

    await wait(60);

    expect(store.limitFor(agentId)).toBe(null);
    store.sendMessage(conv, 'now?');
    expect(wire.sent.length).toBe(1);
  });
});

describe('after the socket comes back', () => {
  test('an hour limit the hub repeats stays, with the new wait', async () => {
    const { store, wire, agentId } = await open();
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 1_800_000, window: 'hour' });
    const first = store.limitFor(agentId)?.until ?? 0;

    wire.events.onWelcome({ clientId: 'anon-1', seq: null });
    wire.events.onAgentLimit({ limited: true, retryAfterMs: 900_000, window: 'hour' });

    const again = store.limitFor(agentId);
    expect(again?.window).toBe('hour');
    expect((again?.until ?? 0) < first).toBe(true);
    lift(wire);
  });

  test('a minute limit is left to run out: the hub never announces one', async () => {
    const { store, conv, wire, agentId } = await open();
    store.sendMessage(conv, 'hello');
    await refuse(wire.sent[0], 60_000, 'minute');

    wire.events.onWelcome({ clientId: 'anon-1', seq: null });

    expect(store.limitFor(agentId)?.window).toBe('minute');
    lift(wire);
  });
});
