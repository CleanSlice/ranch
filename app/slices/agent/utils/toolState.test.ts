import { describe, expect, test } from "bun:test";
import type { IAgentToolServer, IAgentToolState } from "../domain/agent.types";
import { awayFor, toolStateView } from "./toolState";

const NOW = Date.parse("2026-11-25T10:00:40.000Z");
const SINCE = "2026-11-25T10:00:00.000Z";

const server = (
  name: string,
  state: IAgentToolServer["state"],
  attempts = 3,
): IAgentToolServer => ({
  id: null,
  name,
  state,
  since: SINCE,
  attempts: state === "connected" ? 0 : attempts,
  lastError: state === "connected" ? null : "HTTP 503",
});

const detail = (
  phase: IAgentToolState["phase"],
  ...servers: IAgentToolServer[]
): IAgentToolState => ({ phase, since: SINCE, servers });

const view = (over: Partial<Parameters<typeof toolStateView>[0]>) =>
  toolStateView({
    status: "running",
    summary: "limited",
    manager: true,
    now: NOW,
    ...over,
  });

describe("toolStateView", () => {
  test("nothing to say when the word is not set", () => {
    expect(view({ summary: null })).toBe(null);
    expect(view({ summary: undefined })).toBe(null);
  });

  test("a mark only means something on a running agent", () => {
    for (const status of [
      "stopped",
      "failed",
      "deploying",
      "pending",
      "unreachable",
    ]) {
      expect(view({ status, summary: "limited" })).toBe(null);
    }
  });

  test("connecting: the one server, its attempt and how long", () => {
    expect(
      view({
        summary: "connecting",
        detail: detail(
          "connecting",
          server("Ranch", "connected"),
          server("Documents", "retrying"),
        ),
      }),
    ).toEqual({
      kind: "connecting",
      labelKey: "tool_state.label_connecting",
      lines: [
        {
          key: "tool_state.connecting_one_attempt",
          params: { name: "Documents", attempt: 3 },
          wait: { key: "tool_state.wait_seconds", count: 40 },
        },
      ],
    });
  });

  test("connecting: several servers are named without counts", () => {
    expect(
      view({
        summary: "connecting",
        detail: detail(
          "connecting",
          server("Documents", "retrying"),
          server("Jira", "retrying"),
        ),
      })?.lines,
    ).toEqual([
      {
        key: "tool_state.connecting_many",
        params: { names: "Documents, Jira" },
      },
    ]);
  });

  test("limited: still trying", () => {
    expect(
      view({ detail: detail("limited", server("Documents", "retrying")) }),
    ).toEqual({
      kind: "limited",
      labelKey: "tool_state.label_limited",
      lines: [
        { key: "tool_state.limited_retrying", params: { names: "Documents" } },
      ],
    });
  });

  test("limited: refused points at the credentials", () => {
    expect(
      view({ detail: detail("limited", server("Documents", "refused")) })
        ?.lines,
    ).toEqual([
      { key: "tool_state.limited_refused", params: { names: "Documents" } },
    ]);
  });

  test("limited: some retried, some refused, one sentence each", () => {
    expect(
      view({
        detail: detail(
          "limited",
          server("Documents", "retrying"),
          server("Jira", "refused"),
        ),
      })?.lines.map((l) => l.key),
    ).toEqual(["tool_state.limited_retrying", "tool_state.limited_refused"]);
  });

  test("a non-manager never gets a name, whatever detail is in hand", () => {
    const d = detail(
      "limited",
      server("Documents", "retrying"),
      server("Jira", "refused"),
    );
    for (const summary of ["connecting", "limited"] as const) {
      const v = view({ summary, manager: false, detail: d });
      expect(JSON.stringify(v).includes("Documents")).toBe(false);
      expect(JSON.stringify(v).includes("Jira")).toBe(false);
    }
    expect(view({ manager: false, detail: d })?.lines).toEqual([
      { key: "tool_state.limited_generic", params: {} },
    ]);
    expect(
      view({ summary: "connecting", manager: false, detail: d })?.lines,
    ).toEqual([{ key: "tool_state.connecting_generic", params: {} }]);
  });

  test("a manager whose detail has not arrived names nothing either", () => {
    expect(view({ detail: null })?.lines).toEqual([
      { key: "tool_state.limited_generic", params: {} },
    ]);
  });
});

describe("awayFor", () => {
  test("seconds under a minute, whole minutes after", () => {
    expect(awayFor(SINCE, NOW)).toEqual({
      key: "tool_state.wait_seconds",
      count: 40,
    });
    expect(awayFor(SINCE, NOW + 150_000)).toEqual({
      key: "tool_state.wait_minutes",
      count: 3,
    });
  });

  test("a clock behind the server never counts backwards", () => {
    expect(awayFor(SINCE, NOW - 120_000)).toEqual({
      key: "tool_state.wait_seconds",
      count: 0,
    });
  });

  test("not a date", () => {
    expect(awayFor("soon", NOW)).toBe(null);
  });
});
