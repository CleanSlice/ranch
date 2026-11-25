// The chat queue in the store (CLEAN-245, T035): what is written while the
// agent cannot take it waits, goes out one per turn, survives a reload, is
// sent by one tab only and never follows a person to another account. The
// store itself runs here, as in bridle.reset.test.ts: what Nuxt would
// auto-import is put on `globalThis` first, and the store is loaded after.

import { describe, expect, test } from "bun:test";
import { computed, markRaw, ref } from "vue";
import { createPinia, defineStore, setActivePinia } from "pinia";

import type {
  IBridleChannelEvents,
  IBridleConversation,
  IBridleSendAck,
} from "../domain/bridle.types";

interface ISent {
  text: string;
  clientMessageId: string;
  answer: (ack: IBridleSendAck) => void;
}

interface IWire {
  events: IBridleChannelEvents;
  sent: ISent[];
}

const wires: Record<string, IWire[]> = {};

const service = {
  openChannel(agentId: string, _auth: unknown, events: IBridleChannelEvents) {
    const wire: IWire = { events, sent: [] };
    (wires[agentId] ??= []).push(wire);
    return {
      send(
        text: string,
        _attachmentIds: string[] | undefined,
        clientMessageId: string,
      ) {
        return new Promise<IBridleSendAck>((answer) => {
          wire.sent.push({ text, clientMessageId, answer });
        });
      },
      reconnect() {},
      close() {},
    };
  },
  async transcriptPage() {
    return { messages: [], nextCursor: null, hasMore: false };
  },
};

let user: { id: string; role: string } | null = { id: "u1", role: "User" };
const auth = {
  accessToken: "token",
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

/** Whether this tab gets the queue's lock; the other tab holds it when not. */
let lockFree = true;
const lockNames: string[] = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      async request(
        name: string,
        _options: unknown,
        task: (lock: object | null) => Promise<void>,
      ) {
        lockNames.push(name);
        await task(lockFree ? {} : null);
      },
    },
  },
});

// An instance of the store module of its own: see bridle.reset.test.ts.
const OWN_INSTANCE = "./bridle?queue";
const { useBridleStore } = (await import(
  OWN_INSTANCE
)) as typeof import("./bridle");

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let agents = 0;

/** A store signed in as `id` with one chat open and connected; the agent is not on the hub yet. */
async function open(
  id = "u1",
  agentId = `agent-queue-${++agents}`,
  keep = false,
) {
  user = { id, role: "User" };
  if (!keep) stored.clear();
  lockFree = true;
  setActivePinia(createPinia());
  const store = useBridleStore();
  const conv: IBridleConversation = { key: agentId, agentId };
  await store.acquire(conv);
  const wire = wires[agentId][wires[agentId].length - 1];
  wire.events.onConnected();
  wire.events.onWelcome({ clientId: id, seq: 0 });
  store.hydrate(conv);
  await settle();
  return { store, conv, wire, agentId };
}

const texts = (store: ReturnType<typeof useBridleStore>, key: string) =>
  store.queueFor(key).map((e) => e.text);
const storedQueues = () =>
  [...stored.entries()].filter(([, value]) => value.includes('"queuedAt"'));

describe("submit", () => {
  test("a message the agent cannot take yet is queued, not sent, and kept in storage", async () => {
    const { store, conv, wire, agentId } = await open();

    expect(store.submit(conv, " first ", "starting")).toBe("queued");

    expect(texts(store, agentId)).toEqual(["first"]);
    expect(wire.sent.length).toBe(0);
    expect(store.messagesFor(agentId).length).toBe(0);
    expect(storedQueues().length).toBe(1);
  });

  test("a fourth message is refused and the three stay as they were", async () => {
    const { store, conv, agentId } = await open();
    for (const text of ["one", "two", "three"])
      store.submit(conv, text, "starting");

    expect(store.submit(conv, "four", "starting")).toBe("full");
    expect(texts(store, agentId)).toEqual(["one", "two", "three"]);
  });

  test("with the agent ready and nothing waiting the message is sent", async () => {
    const { store, conv, wire, agentId } = await open();
    wire.events.onAgentStatus(true, null);

    expect(store.submit(conv, "now", null)).toBe("sent");
    expect(store.queueFor(agentId).length).toBe(0);
    expect(wire.sent.map((s) => s.text)).toEqual(["now"]);
  });

  test("limited tools count as ready", async () => {
    const { store, conv, wire } = await open();
    wire.events.onAgentStatus(true, "limited");

    expect(store.submit(conv, "now", null)).toBe("sent");
  });

  test("nothing to send is ignored", async () => {
    const { store, conv, agentId } = await open();

    expect(store.submit(conv, "   ", "starting")).toBe("ignored");
    expect(store.queueFor(agentId).length).toBe(0);
  });
});

describe("drain", () => {
  test("one message per turn, in order, under the id it was queued with", async () => {
    const { store, conv, wire, agentId } = await open();
    store.submit(conv, "one", "starting");
    store.submit(conv, "two", "starting");
    const [first, second] = store.queueFor(agentId).map((e) => e.id);

    // Not ready: nothing leaves.
    await store.drain(conv, "starting");
    expect(wire.sent.length).toBe(0);

    wire.events.onAgentStatus(true, null);
    const draining = store.drain(conv, null);
    await settle();
    expect(wire.sent.map((s) => s.text)).toEqual(["one"]);
    expect(wire.sent[0].clientMessageId).toBe(first);
    expect(texts(store, agentId)).toEqual(["two"]);
    wire.sent[0].answer({
      status: "accepted",
      messageId: first,
      ts: Date.now(),
    });
    await draining;

    // The turn is open: the second one waits for it to close.
    await store.drain(conv, null);
    expect(wire.sent.length).toBe(1);

    wire.events.onMessage({
      text: "answer",
      messageId: "m-1",
      ts: Date.now(),
      seq: 2,
    });
    const next = store.drain(conv, null);
    await settle();
    expect(wire.sent.map((s) => s.text)).toEqual(["one", "two"]);
    expect(wire.sent[1].clientMessageId).toBe(second);
    expect(store.queueFor(agentId).length).toBe(0);
    expect(storedQueues().length).toBe(0);
    wire.sent[1].answer({
      status: "accepted",
      messageId: second,
      ts: Date.now(),
    });
    await next;
  });

  test("a message whose file the hub can no longer read comes back marked, and the next one goes", async () => {
    const { store, conv, wire, agentId } = await open();
    store.submit(conv, "with a file", "starting");
    store.submit(conv, "plain", "starting");
    wire.events.onAgentStatus(true, null);

    const draining = store.drain(conv, null);
    await settle();
    wire.sent[0].answer({ status: "rejected", code: "ATTACHMENT_FAILED" });
    await settle();
    expect(wire.sent.map((s) => s.text)).toEqual(["with a file", "plain"]);
    wire.sent[1].answer({ status: "accepted", messageId: "x", ts: Date.now() });
    await draining;

    const queue = store.queueFor(agentId);
    expect(queue.map((e) => e.text)).toEqual(["with a file"]);
    expect(queue[0].blocked).toEqual({ code: "ATTACHMENT_FAILED" });
    // Its bubble is gone: it was not sent.
    expect(store.messagesFor(agentId).map((m) => m.text)).toEqual(["plain"]);
  });

  test("a failed agent holds the queue", async () => {
    const { store, conv, wire, agentId } = await open();
    store.submit(conv, "kept", "starting");
    wire.events.onAgentStatus(true, null);

    await store.drain(conv, "failed");

    expect(wire.sent.length).toBe(0);
    expect(texts(store, agentId)).toEqual(["kept"]);
  });

  test("with the lock taken by another tab nothing is sent from this one", async () => {
    const { store, conv, wire, agentId } = await open();
    store.submit(conv, "once", "starting");
    wire.events.onAgentStatus(true, null);
    lockFree = false;

    await store.drain(conv, null);

    expect(wire.sent.length).toBe(0);
    expect(texts(store, agentId)).toEqual(["once"]);
    // The lock is this account's and this conversation's.
    expect(lockNames[lockNames.length - 1].includes(agentId)).toBe(true);
    expect(lockNames[lockNames.length - 1].includes("u1")).toBe(true);
  });

  test("what the other tab already sent is read from storage, not sent again", async () => {
    const { store, conv, wire, agentId } = await open();
    store.submit(conv, "once", "starting");
    wire.events.onAgentStatus(true, null);
    // The other tab took the row out and sent it.
    for (const [key] of storedQueues()) stored.delete(key);

    await store.drain(conv, null);

    expect(wire.sent.length).toBe(0);
    expect(store.queueFor(agentId).length).toBe(0);
  });
});

describe("the list", () => {
  test("move, remove, edit and clear keep storage in step", async () => {
    const { store, conv, agentId } = await open();
    for (const text of ["one", "two", "three"])
      store.submit(conv, text, "starting");

    store.moveQueued(conv, 2, 0);
    expect(texts(store, agentId)).toEqual(["three", "one", "two"]);

    store.removeQueued(conv, store.queueFor(agentId)[1].id);
    expect(texts(store, agentId)).toEqual(["three", "two"]);

    expect(store.editQueued(conv, store.queueFor(agentId)[0].id)).toBe("three");
    expect(texts(store, agentId)).toEqual(["two"]);
    expect(JSON.parse(storedQueues()[0][1]).length).toBe(1);

    store.clearQueue(conv);
    expect(store.queueFor(agentId).length).toBe(0);
    expect(storedQueues().length).toBe(0);
  });
});

describe("reload and account change", () => {
  test("the queue is there again after a reload, in order", async () => {
    const first = await open();
    first.store.submit(first.conv, "one", "starting");
    first.store.submit(first.conv, "two", "starting");

    const again = await open("u1", first.agentId, true);

    expect(texts(again.store, first.agentId)).toEqual(["one", "two"]);
  });

  test("an account change empties it here; the next account never sees it, the owner finds it again", async () => {
    const first = await open("u1");
    first.store.submit(first.conv, "mine", "starting");

    first.store.resetForAccount();
    expect(first.store.queueFor(first.agentId).length).toBe(0);

    const other = await open("u2", first.agentId, true);
    expect(other.store.queueFor(first.agentId).length).toBe(0);

    const owner = await open("u1", first.agentId, true);
    expect(texts(owner.store, first.agentId)).toEqual(["mine"]);
  });
});
