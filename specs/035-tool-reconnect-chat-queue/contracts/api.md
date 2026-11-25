# Contract: API

## Setting

| Variable | Default | Meaning |
|---|---|---|
| `TOOLS_LIMITED_ALERT_MS` | `300000` | how long an agent may stay `limited` before an incident opens |

## Hub

**Agent socket, new handler `tool_state`** — payload as in [runtime.md](./runtime.md). Validated (phase and state are from the known sets, at most 20 servers, strings cut to length); an invalid report is dropped with one log line and changes nothing. Stored through `AgentToolStateService.accept(agentId, report)`. Cleared in `unregisterAgent`.

**Client socket, `agent_status` grows one field**

```json
{ "type": "agent_status", "agentId": "agent-…", "connected": true, "tools": "limited" }
```

`tools` is `"connecting"`, `"limited"` or `null`. Sent on handshake as today and re-broadcast when the summary changes. It never carries a server name.

## Status stream (`GET /agents/status/stream`, public)

Each frame's `agent` part is unchanged; the frame gains `tools: 'connecting' | 'limited' | null`. A change of summary emits a frame for that agent.

## Routes

| Route | Who | Returns |
|---|---|---|
| `GET /agents/:id` and lists | as today | `AgentDto` + `toolState: 'connecting' \| 'limited' \| null` |
| `GET /agents/:id/tool-state` | `@ManagesAgent` (Owner, Admin who reaches the agent) | `AgentToolStateDto \| null` |

```json
{
  "phase": "limited",
  "since": "2026-11-20T09:10:52.368Z",
  "servers": [
    { "id": "mcp-documents", "name": "Documents", "state": "retrying", "since": "…", "attempts": 14, "lastError": "HTTP 503" }
  ]
}
```

A User, a share visitor, and an Admin who does not reach the agent get 404 from this route, as from every route that names an agent they cannot manage.

## Incident

- Opens when an agent has been `limited` for longer than `TOOLS_LIMITED_ALERT_MS`: event `status: 'limited'`, `witness: 'ranch'`, `reason` from the detail (names, no error text).
- Joins the agent's open incident if there is one — one incident per agent.
- `noteRunning` when the summary returns to `null`; the existing sweep closes it as `recovered` after the quiet period.
- Not opened while the agent is `stopped`, `pending` or `deploying`, nor when more than one API replica is alive (the hub's view is partial — the same rule as unreachable).
- Notification text: "«name» is running without some of its tools: Documents not connected for 5 min." Sent to the operator destination only.

## Agent tool

`get_agent_status` (`agentAdmin.tool.ts`, `manage-agent`, `effect: 'read'`) adds `tools` to its result — the same object as the route, or `null`. Its description gains one sentence: what `connecting`, `limited` and `refused` mean and that a `refused` server needs its credentials fixed, not a wait.

No new tool: the capability the console gains is "see tool state", and this is its tool.

## Tests (jest)

- `toolState.spec.ts` — summary, reason, redaction; a report with unknown values is refused.
- `agentToolState.service.spec.ts` — accept/clear; alert after the threshold, once; quiet with two replicas; closes on recovery.
- `agentStatusFrame` / stream — a summary change emits a frame; no names in any frame.
- `agent.controller` — `tool-state` is 404 for a User and for an Admin outside reach; listed in `userRoutes.spec.ts` / `routeRoles.spec.ts`.
- `agentAdmin.tool.spec.ts` — the block is returned to a manager; `toolReach.spec.ts` already covers the tool.
- bridle — `agent_status` carries `tools`; an old runtime (no report) yields `null`.
