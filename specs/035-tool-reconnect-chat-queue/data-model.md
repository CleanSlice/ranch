# Data Model: Tools That Reconnect, a Start That Explains Itself, and a Chat Queue

No database table is added or altered. Three shapes are new; one string column takes a new value.

## Tool server connection (runtime memory → report → API memory)

| Field | Type | Notes |
|---|---|---|
| `id` | string? | Ranch's id of the server (`mcp-documents`), when the config carried one |
| `name` | string | the server's name as configured; unique per agent |
| `state` | `connected` \| `retrying` \| `refused` | a disabled server is not listed |
| `since` | ISO time | when it entered this state |
| `attempts` | number | attempts since it last was connected; 0 when `connected` |
| `lastError` | string? | cut to 300 characters; absent when `connected` |

Transitions:

```text
            open ok                      open ok
(boot) ───────────────▶ connected ◀──────────────── retrying
   │                        │  connection broken        ▲
   │ open fails             └──────────────────────────┘
   ├──────────────▶ retrying ── 401/403 ──▶ refused   (ends: no retry)
   └── 401/403 ───▶ refused
```

## Tool state (one per connected agent)

| Field | Type | Notes |
|---|---|---|
| `phase` | `connecting` \| `limited` \| `ready` | derived, see research R6 |
| `since` | ISO time | when this phase began |
| `startedAt` | ISO time | when the runtime started — the waiting limit counts from here |
| `servers` | Tool server connection[] | every enabled server |

Held by the API in memory, keyed by agent id, replaced by each report, removed when the agent's socket goes.

Derived by the API, one function each:

- **summary** — `connecting` | `limited` | `null` (`ready` and "no report" are both `null`). Safe for anyone.
- **detail** — the whole record, `lastError` redacted. For people who manage the agent.
- **reason** — `"Documents not connected"` / `"2 tool servers not connected: Documents, Ranch"`. For the incident and the operator notification.

## Queued message (browser, per person and conversation)

| Field | Type | Notes |
|---|---|---|
| `id` | string | client message id, minted when queued; sent as `clientMessageId` |
| `text` | string | may be empty when there are attachments |
| `attachments` | `{ remoteId, name, size, kind, mimeType }[]` | uploaded files only |
| `queuedAt` | epoch ms | for the 24-hour rule |
| `blocked` | `{ code, detail? }`? | set when its turn came and it could not be sent |

The queue is an ordered array of at most three. Stored as JSON under `queueKey(userId, conversationKey)`; removed when empty; swept with the other bridle keys when the account changes.

Derived, one function (`utils/queue.ts`) per console:

- `canQueue(queue)` — fewer than three.
- `canTake(conversationState)` — research R11.
- `held(queue, conversationState, now)` — why the queue is not draining on its own: `agent_failed`, `agent_stopped`, `stale`, or nothing.
- `nextToSend(queue)` — the first entry that is not `blocked`.

## Agent event / incident

`AgentEventStatusTypes` gains `'limited'`. `AgentEvent.status` and `AgentIncident.status` are `String` columns — no migration. `EXTERNAL_EVENT_STATUSES` is unchanged: an outside sender cannot report `limited`.

## Existing shapes that grow one optional field

| Shape | Field | Values |
|---|---|---|
| status stream frame (`agentStatusFrame.ts`) | `tools` | `'connecting'` \| `'limited'` \| `null` |
| `AgentDto` | `toolState` | same |
| hub → client `agent_status` | `tools` | same; absent from an API that predates this |
| `get_agent_status` result | `tools` | `{ phase, since, servers[] }` \| `null` |
