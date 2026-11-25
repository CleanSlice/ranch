/**
 * How an agent's tool servers stand, as i18n keys (CLEAN-245). The ONE
 * derivation of this console for someone who may manage the agent: the chat
 * line, the sheet and the rail row all read it, so they cannot say different
 * things about one agent.
 *
 * Two inputs. `summary` is the word every viewer is given — it names nothing.
 * `detail` is what a manager read from `GET /agents/:id/tool-state`; without
 * it (not a manager, not answered yet) no server is ever named. Someone who
 * only talks to the agent gets the chat's own wording
 * (`#bridle/utils/toolNotice`), which has no names to give.
 *
 * Twin of `admin/slices/agent/agent/utils/toolState.ts`: the same states;
 * here the copy travels as keys (docs/i18n.md). A server's name is the
 * operator's own word and is shown as received.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
import type {
  IAgentToolServer,
  IAgentToolState,
  ToolSummaryTypes,
} from "../domain/agent.types";

export interface IToolStateLine {
  key: string;
  params: Record<string, string | number>;
  /** How long the server has been away; the caller renders it into `{wait}`. */
  wait?: { key: string; count: number };
}

export interface IToolStateView {
  kind: "connecting" | "limited";
  labelKey: string;
  /** One sentence each; two only when some servers are retried and others refused. */
  lines: IToolStateLine[];
}

export interface IToolStateInput {
  /** The agent's own status: a mark only means something on a running agent. */
  status: string;
  summary: ToolSummaryTypes | undefined;
  detail?: IAgentToolState | null;
  /** May this viewer manage the agent? Nobody else is told a server's name. */
  manager: boolean;
  now: number;
}

/** The names as the operator wrote them, in the order the agent lists them. */
function names(servers: IAgentToolServer[]): string {
  return servers.map((s) => s.name).join(", ");
}

/** `40 s`, `3 min`: how long a server has been away. */
export function awayFor(
  since: string,
  now: number,
): { key: string; count: number } | null {
  const from = Date.parse(since);
  if (!Number.isFinite(from)) return null;
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 60) return { key: "tool_state.wait_seconds", count: seconds };
  return { key: "tool_state.wait_minutes", count: Math.floor(seconds / 60) };
}

function connectingLines(
  retrying: IAgentToolServer[],
  now: number,
): IToolStateLine[] {
  if (!retrying.length)
    return [{ key: "tool_state.connecting_generic", params: {} }];
  if (retrying.length > 1) {
    return [
      { key: "tool_state.connecting_many", params: { names: names(retrying) } },
    ];
  }
  const one = retrying[0]!;
  const wait = awayFor(one.since, now);
  if (one.attempts > 0 && wait) {
    return [
      {
        key: "tool_state.connecting_one_attempt",
        params: { name: one.name, attempt: one.attempts },
        wait,
      },
    ];
  }
  return [{ key: "tool_state.connecting_one", params: { name: one.name } }];
}

function limitedLines(
  retrying: IAgentToolServer[],
  refused: IAgentToolServer[],
): IToolStateLine[] {
  const lines: IToolStateLine[] = [];
  if (retrying.length) {
    lines.push({
      key: "tool_state.limited_retrying",
      params: { names: names(retrying) },
    });
  }
  if (refused.length) {
    lines.push({
      key: "tool_state.limited_refused",
      params: { names: names(refused) },
    });
  }
  return lines.length
    ? lines
    : [{ key: "tool_state.limited_generic", params: {} }];
}

/** `null`: nothing to say — the agent is not running, or all its servers answer. */
export function toolStateView(input: IToolStateInput): IToolStateView | null {
  if (input.status !== "running" || !input.summary) return null;
  const servers = input.manager ? (input.detail?.servers ?? []) : [];
  const retrying = servers.filter((s) => s.state === "retrying");
  const refused = servers.filter((s) => s.state === "refused");
  if (input.summary === "connecting") {
    return {
      kind: "connecting",
      labelKey: "tool_state.label_connecting",
      lines: connectingLines(retrying, input.now),
    };
  }
  return {
    kind: "limited",
    labelKey: "tool_state.label_limited",
    lines: limitedLines(retrying, refused),
  };
}
