# Contract: runtime

Repository `CleanSlice/runtime`, release 0.40.0.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `MCP_START_GRACE_MS` | `60000` | how long after start a missing server reads as `connecting` rather than `limited` |
| `MCP_CONNECT_TIMEOUT_MS` | `10000` | one attempt to open a server |
| `MCP_RETRY_MAX_MS` | `60000` | ceiling of the pause between attempts |

## Reconnect rules

| Situation | Behaviour |
|---|---|
| server does not open at boot | kept as `retrying`; boot continues; attempts at 5, 10, 20, 40 s then every 60 s, ±20 % |
| server opens later | `tools/list`, tools swapped into the registry under `<name>__*`, state `connected`, report sent |
| a turn starts while a server is `retrying` | one shared attempt per such server, at most 3 s in total, then the turn goes on with what there is |
| call fails: session not known (404) | reopen, repeat once — any tool |
| call fails: connection broken (refused, reset, timeout, 502/503/504) | reopen; repeat once **if the tool's effect is `read`**; otherwise return the "outcome unknown" error and mark the server `retrying` |
| open or call answers 401/403 | state `refused`; no further attempts |
| server disabled or removed from the config | dropped from the list; its timer stopped |

Tools that arrive after boot go through the same per-person listing (`scopeTools`) and the same admin-only pruning as tools present from the start.

What the model receives:

- read, still failing after the repeat → `{ error: "<server> is not reachable right now." }` (unchanged)
- write on a broken connection → `{ error: "<server> could not be reached while this ran; whether it took effect is unknown. Check before trying again." }`
- refused → `{ error: "<server> refused this agent's credentials." }`

## Report: `tool_state` (runtime → hub, agent socket)

Sent after every `register` and on every change of a server's state or of the phase, at most once per 500 ms. Best effort: not sent while the socket is down; the next `register` carries the current state.

```json
{
  "phase": "connecting",
  "since": "2026-11-20T09:09:53.611Z",
  "startedAt": "2026-11-20T09:09:52.368Z",
  "servers": [
    { "id": "mcp-cleanslice", "name": "CleanSlice", "state": "connected", "since": "2026-11-20T09:09:53.597Z", "attempts": 0 },
    { "id": "mcp-documents", "name": "Documents", "state": "retrying", "since": "2026-11-20T09:09:53.611Z", "attempts": 3, "lastError": "HTTP 503" }
  ]
}
```

`lastError` is the error's first line, cut to 300 characters, with any `Authorization`/`Bearer`/query-string value removed before it leaves the pod. HTML bodies are reduced to the status code.

## Prompt section `tool-servers`

Present only when at least one enabled server is not `connected`. Budgeted like `hint`. Text in research R14. Absent → the prompt is byte-for-byte what it is today.

## Tests (bun)

- `retryPolicy.spec.ts` — the pause table; what counts as broken, lost, refused.
- `toolState.spec.ts` — phase from servers and age, including the 15 s rule for a later drop.
- `mcp.gateway.reconnect.spec.ts` — boot failure then success swaps tools in; read repeated once; write not repeated; refusal ends retrying; concurrent turns share one attempt.
- `mcp.service.spec.ts` — `settle` respects its budget; a removed server stops its timer.
- `toolServersPrompt.spec.ts` — retrying vs refused wording; absent when all connected.
