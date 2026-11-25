// The chat queue in the store (CLEAN-245, T035): what is written while the
// agent cannot take it waits, goes out one per turn, survives a reload, is
// sent by one tab only and never follows a person to another account. The
// store itself runs here against a socket that is a plain object: what it
// imports from the network and from other slices is replaced first, and the
// store is loaded after. Twin of app's `bridle.queue.test.ts`.

import { describe, expect, mock, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";

interface IEmitted {
  payload: { text: string; clientMessageId: string };
  answer: (ack: unknown) => void;
}

class FakeSocket {
  connected = false;
  emitted: IEmitted[] = [];
  private handlers: Record<string, ((data?: unknown) => void)[]> = {};
  on(event: string, handler: (data?: unknown) => void) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }
  fire(event: string, data?: unknown) {
    if (event === "connect") this.connected = true;
    for (const handler of this.handlers[event] ?? []) handler(data);
  }
  timeout() {
    return {
      emit: (
        _event: string,
        payload: IEmitted["payload"],
        ack: (err: Error | null, ack?: unknown) => void,
      ) => {
        this.emitted.push({ payload, answer: (a) => ack(null, a) });
      },
    };
  }
  emit() {}
  connect() {}
  disconnect() {
    this.connected = false;
  }
  removeAllListeners() {}
}

const sockets: FakeSocket[] = [];
let user: { id: string; roles: string[] } | null = {
  id: "u1",
  roles: ["OWNER"],
};
const auth = {
  accessToken: "token",
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
};

mock.module("socket.io-client", () => ({
  io: () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  },
}));
mock.module("#auth/stores/auth", () => ({ useAuthStore: () => auth }));
mock.module("#auth/utils/authedFetch", () => ({
  authedFetch: async () => new Response("{}", { status: 200 }),
  authedXhrHeaders: () => ({}),
  ensureFreshToken: async () => true,
}));
mock.module("#agentFile/stores/fileProposal", () => ({
  useFileProposalStore: () => ({
    upsert() {},
    upsertMany() {},
    applyUpdate() {},
  }),
}));

/** The browser's storage, as far as the store uses it. */
const stored = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
    addEventListener() {},
  },
});

/** Whether this tab gets the queue's lock; the other tab holds it when not. */
let lockFree = true;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      async request(
        _name: string,
        _options: unknown,
        task: (lock: object | null) => Promise<void>,
      ) {
        await task(lockFree ? {} : null);
      },
    },
  },
});

const { useBridleStore } = await import("./bridle");

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let agents = 0;

/** A store signed in as `id` with one chat connected; the agent is not on the hub yet. */
async function open(
  id = "u1",
  agentId = `agent-queue-${++agents}`,
  keep = false,
) {
  user = { id, roles: ["OWNER"] };
  if (!keep) stored.clear();
  lockFree = true;
  setActivePinia(createPinia());
  const store = useBridleStore();
  await store.connect("http://api.test", agentId);
  const socket = sockets[sockets.length - 1] as FakeSocket;
  socket.fire("connect");
  socket.fire("welcome", { clientId: id, seq: 0 });
  const key = store.conversation(agentId).key;
  return { store, key, socket, agentId };
}

const texts = (store: ReturnType<typeof useBridleStore>, key: string) =>
  store.getQueue(key).map((e) => e.text);
const sent = (socket: FakeSocket) => socket.emitted.map((e) => e.payload.text);
const storedQueues = () =>
  [...stored.entries()].filter(([, value]) => value.includes('"queuedAt"'));

describe("submit", () => {
  test("a message the agent cannot take yet is queued, not sent, and kept in storage", async () => {
    const { store, key, socket } = await open();

    expect(await store.submit(key, " first ", "restarting")).toBe("queued");

    expect(texts(store, key)).toEqual(["first"]);
    expect(socket.emitted.length).toBe(0);
    expect(store.conversations[key]?.messages.length).toBe(0);
    expect(storedQueues().length).toBe(1);
  });

  test("a fourth message is refused and the three stay as they were", async () => {
    const { store, key } = await open();
    for (const text of ["one", "two", "three"])
      await store.submit(key, text, "restarting");

    expect(await store.submit(key, "four", "restarting")).toBe("full");
    expect(texts(store, key)).toEqual(["one", "two", "three"]);
  });

  test("with the agent ready and nothing waiting the message is sent", async () => {
    const { store, key, socket } = await open();
    socket.fire("agent_status", { connected: true, tools: null });

    expect(await store.submit(key, "now", null)).toBe("sent");
    expect(store.getQueue(key).length).toBe(0);
    expect(sent(socket)).toEqual(["now"]);
  });

  test("limited tools count as ready", async () => {
    const { store, key, socket } = await open();
    socket.fire("agent_status", { connected: true, tools: "limited" });

    expect(await store.submit(key, "now", null)).toBe("sent");
  });

  test("tools still connecting do not", async () => {
    const { store, key, socket } = await open();
    socket.fire("agent_status", { connected: true, tools: "connecting" });

    expect(await store.submit(key, "later", null)).toBe("queued");
  });
});

describe("drain", () => {
  test("one message per turn, in order, under the id it was queued with", async () => {
    const { store, key, socket } = await open();
    await store.submit(key, "one", "restarting");
    await store.submit(key, "two", "restarting");
    const [first, second] = store.getQueue(key).map((e) => e.id);

    // Not ready: nothing leaves.
    await store.drain(key, "restarting");
    expect(socket.emitted.length).toBe(0);

    socket.fire("agent_status", { connected: true, tools: null });
    const draining = store.drain(key, null);
    await settle();
    expect(sent(socket)).toEqual(["one"]);
    expect(socket.emitted[0]?.payload.clientMessageId).toBe(first);
    expect(texts(store, key)).toEqual(["two"]);
    socket.emitted[0]?.answer({
      status: "accepted",
      messageId: first,
      ts: Date.now(),
    });
    await draining;

    // The turn is open: the second one waits for it to close.
    await store.drain(key, null);
    expect(socket.emitted.length).toBe(1);

    socket.fire("message", {
      text: "answer",
      messageId: "m-1",
      ts: Date.now(),
    });
    const next = store.drain(key, null);
    await settle();
    expect(sent(socket)).toEqual(["one", "two"]);
    expect(socket.emitted[1]?.payload.clientMessageId).toBe(second);
    expect(store.getQueue(key).length).toBe(0);
    expect(storedQueues().length).toBe(0);
    socket.emitted[1]?.answer({
      status: "accepted",
      messageId: second,
      ts: Date.now(),
    });
    await next;
  });

  test("a message whose file the hub can no longer read comes back marked, and the next one goes", async () => {
    const { store, key, socket } = await open();
    await store.submit(key, "with a file", "restarting");
    await store.submit(key, "plain", "restarting");
    socket.fire("agent_status", { connected: true, tools: null });

    const draining = store.drain(key, null);
    await settle();
    socket.emitted[0]?.answer({
      status: "rejected",
      code: "ATTACHMENT_FAILED",
    });
    await settle();
    expect(sent(socket)).toEqual(["with a file", "plain"]);
    socket.emitted[1]?.answer({
      status: "accepted",
      messageId: "x",
      ts: Date.now(),
    });
    await draining;

    const queue = store.getQueue(key);
    expect(queue.map((e) => e.text)).toEqual(["with a file"]);
    expect(queue[0]?.blocked).toEqual({ code: "ATTACHMENT_FAILED" });
    // Its bubble is gone: it was not sent.
    expect(store.conversations[key]?.messages.map((m) => m.text)).toEqual([
      "plain",
    ]);
  });

  test("a failed agent holds the queue", async () => {
    const { store, key, socket } = await open();
    await store.submit(key, "kept", "restarting");
    socket.fire("agent_status", { connected: true, tools: null });

    await store.drain(key, "failed");

    expect(socket.emitted.length).toBe(0);
    expect(texts(store, key)).toEqual(["kept"]);
  });

  test("with the lock taken by another tab nothing is sent from this one", async () => {
    const { store, key, socket } = await open();
    await store.submit(key, "once", "restarting");
    socket.fire("agent_status", { connected: true, tools: null });
    lockFree = false;

    await store.drain(key, null);

    expect(socket.emitted.length).toBe(0);
    expect(texts(store, key)).toEqual(["once"]);
  });

  test("what the other tab already sent is read from storage, not sent again", async () => {
    const { store, key, socket } = await open();
    await store.submit(key, "once", "restarting");
    socket.fire("agent_status", { connected: true, tools: null });
    // The other tab took the row out and sent it.
    for (const [storageKey] of storedQueues()) stored.set(storageKey, "[]");

    await store.drain(key, null);

    expect(socket.emitted.length).toBe(0);
    expect(store.getQueue(key).length).toBe(0);
  });
});

describe("the list", () => {
  test("move, remove, edit and clear keep storage in step", async () => {
    const { store, key } = await open();
    for (const text of ["one", "two", "three"])
      await store.submit(key, text, "restarting");

    store.moveQueued(key, 2, 0);
    expect(texts(store, key)).toEqual(["three", "one", "two"]);

    store.removeQueued(key, store.getQueue(key)[1]?.id ?? "");
    expect(texts(store, key)).toEqual(["three", "two"]);

    expect(store.editQueued(key, store.getQueue(key)[0]?.id ?? "")).toBe(
      "three",
    );
    expect(texts(store, key)).toEqual(["two"]);
    expect(JSON.parse(storedQueues()[0]?.[1] ?? "[]").length).toBe(1);

    store.clearQueue(key);
    expect(store.getQueue(key).length).toBe(0);
    expect(storedQueues().length).toBe(0);
  });
});

describe("reload and account change", () => {
  test("the queue is there again after a reload, in order", async () => {
    const first = await open();
    await first.store.submit(first.key, "one", "restarting");
    await first.store.submit(first.key, "two", "restarting");

    const again = await open("u1", first.agentId, true);

    expect(texts(again.store, again.key)).toEqual(["one", "two"]);
  });

  test("an account change empties it here; the next account never sees it, the owner finds it again", async () => {
    const first = await open("u1");
    await first.store.submit(first.key, "mine", "restarting");

    first.store.resetForAccount();
    expect(first.store.getQueue(first.key).length).toBe(0);

    const other = await open("u2", first.agentId, true);
    expect(other.store.getQueue(other.key).length).toBe(0);

    const owner = await open("u1", first.agentId, true);
    expect(texts(owner.store, owner.key)).toEqual(["mine"]);
  });
});
