/**
 * How an agent's tool servers stand, in words (CLEAN-245). The ONE derivation
 * of this console: the chat line, the header dot, the rail row and Overview
 * all read it, so they cannot say different things about one agent.
 *
 * Two inputs. `summary` is the word off the public status stream — it names
 * nothing. `detail` is what a manager read from `GET /agents/:id/tool-state`;
 * without it (not a manager, not answered yet) no server is ever named.
 *
 * Twin of `app/slices/agent/utils/toolState.ts`: the same states, this
 * console's English.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
import type {
  AgentStatusTypes,
  IAgentToolServer,
  IAgentToolState,
  ToolSummaryTypes,
} from "#agent/domain";

export interface IToolStateView {
  kind: "connecting" | "limited";
  /** `Connecting tools…` / `Limited tools`. */
  label: string;
  /** One sentence saying what is missing and what is being done about it. */
  detail: string;
}

export interface IToolStateInput {
  /** The agent's own status: a mark only means something on a running agent. */
  status: AgentStatusTypes;
  summary: ToolSummaryTypes | undefined;
  detail?: IAgentToolState | null;
  /** May this viewer manage the agent? Nobody else is told a server's name. */
  manager: boolean;
  now: number;
}

/** `Documents`, `Documents and Jira`, `Documents, Jira and Slack`. */
function names(servers: IAgentToolServer[]): string {
  const list = servers.map((s) => s.name);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** `40 s`, `3 min`: how long a server has been away. */
export function awayFor(since: string, now: number): string | null {
  const from = Date.parse(since);
  if (!Number.isFinite(from)) return null;
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min`;
}

function connectingDetail(retrying: IAgentToolServer[], now: number): string {
  if (!retrying.length) return "Still reaching some of its tool servers.";
  if (retrying.length === 1) {
    const one = retrying[0]!;
    const away = awayFor(one.since, now);
    const count = [
      one.attempts > 0 ? `attempt ${one.attempts}` : null,
      away,
    ].filter(Boolean);
    const tail = count.length ? ` (${count.join(", ")})` : "";
    return `${one.name} is not answering yet — trying again${tail}.`;
  }
  return `${names(retrying)} are not answering yet — trying again.`;
}

function limitedDetail(
  retrying: IAgentToolServer[],
  refused: IAgentToolServer[],
): string {
  const parts: string[] = [];
  if (retrying.length) {
    parts.push(
      `Running without ${names(retrying)} — still trying to reconnect.`,
    );
  }
  if (refused.length) {
    const its = refused.length === 1 ? "its" : "their";
    parts.push(
      `Running without ${names(refused)} — refused, check ${its} credentials.`,
    );
  }
  return parts.join(" ") || "Running without some of its tools.";
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
      label: "Connecting tools…",
      detail: connectingDetail(retrying, input.now),
    };
  }
  return {
    kind: "limited",
    label: "Limited tools",
    detail: limitedDetail(retrying, refused),
  };
}
