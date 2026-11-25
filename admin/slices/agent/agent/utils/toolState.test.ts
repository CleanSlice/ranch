import { describe, expect, test } from "bun:test";
import type { IAgentToolServer, IAgentToolState } from "#agent/domain";
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
    ] as const) {
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
      label: "Connecting tools…",
      detail:
        "Documents is not answering yet — trying again (attempt 3, 40 s).",
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
      })?.detail,
    ).toBe("Documents and Jira are not answering yet — trying again.");
  });

  test("limited: still trying", () => {
    expect(
      view({ detail: detail("limited", server("Documents", "retrying")) }),
    ).toEqual({
      kind: "limited",
      label: "Limited tools",
      detail: "Running without Documents — still trying to reconnect.",
    });
  });

  test("limited: refused points at the credentials", () => {
    expect(
      view({ detail: detail("limited", server("Documents", "refused")) })
        ?.detail,
    ).toBe("Running without Documents — refused, check its credentials.");
  });

  test("limited: both kinds, each with its own sentence", () => {
    expect(
      view({
        detail: detail(
          "limited",
          server("Documents", "retrying"),
          server("Jira", "refused"),
          server("Slack", "refused"),
        ),
      })?.detail,
    ).toBe(
      "Running without Documents — still trying to reconnect. Running without Jira and Slack — refused, check their credentials.",
    );
  });

  test("before the detail answers the line names nothing", () => {
    expect(view({ summary: "connecting", detail: null })?.detail).toBe(
      "Still reaching some of its tool servers.",
    );
    expect(view({ detail: undefined })?.detail).toBe(
      "Running without some of its tools.",
    );
  });

  test("a non-manager never gets a name, even when a detail is at hand", () => {
    const full = detail(
      "limited",
      server("Documents", "retrying"),
      server("Jira", "refused"),
    );
    for (const summary of ["connecting", "limited"] as const) {
      const shown = view({ summary, manager: false, detail: full });
      expect(shown?.detail).not.toContain("Documents");
      expect(shown?.detail).not.toContain("Jira");
    }
  });
});

describe("awayFor", () => {
  test("seconds, then whole minutes", () => {
    expect(awayFor(SINCE, NOW)).toBe("40 s");
    expect(awayFor(SINCE, NOW + 150_000)).toBe("3 min");
  });

  test("a time that is not one says nothing", () => {
    expect(awayFor("", NOW)).toBe(null);
  });
});
