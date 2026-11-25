import { describe, expect, test } from "bun:test";
import {
  QUEUE_MAX,
  QUEUE_STALE_MS,
  block,
  canQueue,
  canTake,
  held,
  move,
  nextToSend,
  parseQueue,
  refresh,
  remove,
  submitOutcome,
  type IQueueState,
  type IQueuedMessage,
} from "./queue";

const NOW = Date.parse("2026-11-25T10:00:00.000Z");

const entry = (
  id: string,
  over: Partial<IQueuedMessage> = {},
): IQueuedMessage => ({
  id,
  text: `message ${id}`,
  attachments: [],
  queuedAt: NOW,
  ...over,
});

const ready: IQueueState = {
  chatConnected: true,
  agentConnected: true,
  agentState: null,
  tools: null,
  answering: false,
};

const ids = (queue: IQueuedMessage[]) => queue.map((e) => e.id);

describe("canQueue", () => {
  test("three wait, a fourth does not", () => {
    expect(QUEUE_MAX).toBe(3);
    expect(canQueue([])).toBe(true);
    expect(canQueue([entry("a"), entry("b")])).toBe(true);
    expect(canQueue([entry("a"), entry("b"), entry("c")])).toBe(false);
  });
});

describe("canTake", () => {
  test("everything up, nothing open: yes", () => {
    expect(canTake(ready)).toBe(true);
  });

  test("each thing that is not ready says no on its own", () => {
    expect(canTake({ ...ready, chatConnected: false })).toBe(false);
    expect(canTake({ ...ready, agentConnected: false })).toBe(false);
    expect(canTake({ ...ready, answering: true })).toBe(false);
    expect(canTake({ ...ready, tools: "connecting" })).toBe(false);
    for (const agentState of [
      "restarting",
      "failed",
      "stopped",
      "unreachable",
      "connecting",
    ] as const) {
      expect(canTake({ ...ready, agentState })).toBe(false);
    }
  });

  test("an agent missing a tool server is ready", () => {
    expect(canTake({ ...ready, tools: "limited" })).toBe(true);
  });
});

describe("submitOutcome", () => {
  test("sent when the agent can take it and nothing waits", () => {
    expect(submitOutcome([], true)).toBe("send");
  });

  test("behind what already waits, even when the agent is ready", () => {
    expect(submitOutcome([entry("a")], true)).toBe("queue");
    expect(submitOutcome([], false)).toBe("queue");
  });

  test("a fourth is refused", () => {
    expect(submitOutcome([entry("a"), entry("b"), entry("c")], false)).toBe(
      "full",
    );
    expect(submitOutcome([entry("a"), entry("b"), entry("c")], true)).toBe(
      "full",
    );
  });
});

describe("nextToSend", () => {
  test("the first one", () => {
    expect(nextToSend([entry("a"), entry("b")])?.id).toBe("a");
    expect(nextToSend([])).toBe(null);
  });

  test("a blocked entry is skipped and the rest drains", () => {
    const queue = [
      entry("a", { blocked: { code: "ATTACHMENT_FAILED" } }),
      entry("b"),
      entry("c"),
    ];
    expect(nextToSend(queue)?.id).toBe("b");
    expect(nextToSend(remove(queue, "b"))?.id).toBe("c");
    expect(
      nextToSend([entry("a", { blocked: { code: "ATTACHMENT_FAILED" } })]),
    ).toBe(null);
  });
});

describe("held", () => {
  test("nothing waits, nothing is held", () => {
    expect(held([], { ...ready, agentState: "failed" }, NOW)).toBe(null);
  });

  test("an agent that failed or was stopped keeps the messages", () => {
    expect(held([entry("a")], { ...ready, agentState: "failed" }, NOW)).toBe(
      "agent_failed",
    );
    expect(held([entry("a")], { ...ready, agentState: "stopped" }, NOW)).toBe(
      "agent_stopped",
    );
  });

  test("an agent on its way up holds nothing: the queue drains by itself", () => {
    for (const agentState of [
      "restarting",
      "connecting",
      "unreachable",
    ] as const) {
      expect(held([entry("a")], { ...ready, agentState }, NOW)).toBe(null);
    }
    expect(held([entry("a")], { ...ready, tools: "connecting" }, NOW)).toBe(
      null,
    );
  });

  test("older than a day is asked about first", () => {
    const old = entry("a", { queuedAt: NOW - QUEUE_STALE_MS - 1 });
    expect(
      held([entry("b", { queuedAt: NOW - QUEUE_STALE_MS + 1 })], ready, NOW),
    ).toBe(null);
    expect(held([old], ready, NOW)).toBe("stale");
    expect(held([entry("b"), old], ready, NOW)).toBe("stale");
  });

  test("the agent comes before the age", () => {
    const old = entry("a", { queuedAt: NOW - QUEUE_STALE_MS * 2 });
    expect(held([old], { ...ready, agentState: "stopped" }, NOW)).toBe(
      "agent_stopped",
    );
  });

  test("a blocked entry alone holds nothing, however old", () => {
    const old = entry("a", {
      queuedAt: NOW - QUEUE_STALE_MS * 2,
      blocked: { code: "ATTACHMENT_FAILED" },
    });
    expect(held([old], ready, NOW)).toBe(null);
  });

  test('"Send now" is the day starting again', () => {
    const old = [
      entry("a", { queuedAt: NOW - QUEUE_STALE_MS * 2 }),
      entry("b", { queuedAt: NOW - 5 }),
    ];
    const resumed = refresh(old, NOW);
    expect(held(resumed, ready, NOW)).toBe(null);
    expect(ids(resumed)).toEqual(["a", "b"]);
    expect(old[0].queuedAt).toBe(NOW - QUEUE_STALE_MS * 2);
  });
});

describe("move", () => {
  const queue = [entry("a"), entry("b"), entry("c")];

  test("up and down", () => {
    expect(ids(move(queue, 2, 0))).toEqual(["c", "a", "b"]);
    expect(ids(move(queue, 0, 1))).toEqual(["b", "a", "c"]);
    expect(ids(queue)).toEqual(["a", "b", "c"]);
  });

  test("at the edges nothing moves", () => {
    expect(move(queue, 0, -1)).toBe(queue);
    expect(move(queue, 2, 3)).toBe(queue);
    expect(move(queue, 1, 1)).toBe(queue);
    expect(move(queue, 5, 0)).toBe(queue);
  });
});

describe("remove", () => {
  test("the entry goes, and its attachments with it", () => {
    const queue = [
      entry("a", {
        attachments: [
          {
            remoteId: "f1",
            name: "a.pdf",
            size: 10,
            kind: "binary",
            mimeType: "application/pdf",
          },
        ],
      }),
      entry("b"),
    ];
    const left = remove(queue, "a");
    expect(ids(left)).toEqual(["b"]);
    expect(JSON.stringify(left)).not.toContain("f1");
  });

  test("an id that is not there changes nothing", () => {
    const queue = [entry("a")];
    expect(remove(queue, "x")).toBe(queue);
  });
});

describe("block", () => {
  test("the entry keeps its place and says why", () => {
    const queue = block([entry("a"), entry("b")], "a", {
      code: "ATTACHMENT_FAILED",
      detail: "a.pdf",
    });
    expect(ids(queue)).toEqual(["a", "b"]);
    expect(queue[0].blocked).toEqual({
      code: "ATTACHMENT_FAILED",
      detail: "a.pdf",
    });
    expect(queue[1].blocked).toBe(undefined);
  });
});

describe("parseQueue", () => {
  test("what was saved comes back", () => {
    const queue = [
      entry("a", {
        attachments: [
          {
            remoteId: "f1",
            name: "a.png",
            size: 3,
            kind: "image",
            mimeType: "image/png",
          },
        ],
      }),
      entry("b", { blocked: { code: "ATTACHMENT_FAILED" } }),
    ];
    expect(parseQueue(JSON.stringify(queue))).toEqual(queue);
  });

  test("nothing, rubbish or another shape is an empty queue", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{oops")).toEqual([]);
    expect(parseQueue('{"id":"a"}')).toEqual([]);
    expect(parseQueue('[{"id":1,"text":"x"},null,"a"]')).toEqual([]);
  });

  test("entries that do not hold are dropped, the rest kept; never more than three", () => {
    const many = ["a", "b", "c", "d"].map((id) => entry(id));
    expect(ids(parseQueue(JSON.stringify([{ id: "x" }, ...many])))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("an attachment without a server id is not an attachment", () => {
    const raw = JSON.stringify([
      {
        ...entry("a"),
        attachments: [
          { name: "a.png" },
          {
            remoteId: "f1",
            name: "b.png",
            size: 1,
            kind: "image",
            mimeType: "image/png",
          },
        ],
      },
    ]);
    expect(parseQueue(raw)[0].attachments.map((a) => a.remoteId)).toEqual([
      "f1",
    ]);
  });
});
