# Research: Tools That Reconnect, a Start That Explains Itself, and a Chat Queue

Read on 2026-11-25 from `CleanSlice/ranch` `origin/main` (0.3.98) and `CleanSlice/runtime` tag `v0.39.0`.

## R1. Where a failed tool server is lost today

`McpGateway.connect` (runtime `src/slices/setup/mcp/data/mcp.gateway.ts`) logs `connect failed` and returns `[]` when `open()` throws. The server is never put in `statics`, so nothing knows it exists. `McpService.loadAll` calls `connect` once per server at boot, awaited, before the hub socket is opened.

**Decision**: `connect` registers the server before opening it. A server that fails to open is kept with state `retrying` and no client. `McpService` owns one timer per pending server; on success it lists the tools and calls the existing `swapServerTools(registry, name, tools)`, which already splices a server's tools into the live registry in place (it is how an OAuth login lands, CLEAN-79).

**Rationale**: the registry and the swap exist and are exercised; the only missing thing is memory of the failure.

**Alternatives considered**: block boot until every server answers — rejected: one dead third-party server would keep an agent down for ever, and the pod would be killed by its own readiness. Restart the pod when a server is missing — rejected: it turns an outage of the API into a restart storm of every agent.

## R2. Backoff

**Decision**: 5 s, 10 s, 20 s, 40 s, then every 60 s, with ±20 % jitter, for as long as the agent runs. Each attempt has a 10 s connect timeout.

**Rationale**: FR-001 caps the interval at one minute, which is also what SC-001 needs. The first steps are short because the common case (the 20 November one) heals within two minutes. Jitter because every agent of a Ranch loses the same server at the same second. The 10 s timeout is the SDK's connect taking no longer than a slow cold API answer; without it a black-holed address would hold the retry slot for minutes.

**Alternatives considered**: exponential without a cap — rejected, breaks SC-001 after ten minutes of outage. Fixed 60 s — rejected, makes the common case a minute slower for nothing.

## R3. Before a turn

`RuntimeService.visibleToolsFor` already awaits `deps.scopeTools` per turn. 

**Decision**: `McpModule.settle(3000)` runs there first when any server is `retrying`: it triggers an immediate attempt for each (sharing an attempt already in flight) and waits at most 3 s in total.

**Rationale**: FR-002. Three seconds is below the point where a person reads a pause as a hang, and a healthy server answers `initialize` + `tools/list` in well under one.

## R4. Which failed calls are repeated

Today `withSession` reopens and repeats once on a *lost session* only (HTTP 404 / "session not found", CLEAN-232), whatever the tool does. Every other error passes to the model as `MCP x.y failed: …`.

**Decision**:

- Lost session → reopen, repeat once, any effect (unchanged: the server answered that it did not know the session, so the request was not run).
- Broken connection — `ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, `fetch failed`, `socket hang up`, HTTP 502/503/504 — → reopen; repeat once **only when `tool.effect === 'read'`**. For a write, return `{ error: "<server> could not be reached while this ran; whether it took effect is unknown. Check before trying again." }`.
- HTTP 401/403 on open or on a call → the server becomes `refused`; no retry until its configuration changes or the agent restarts.
- Anything else → as today.

`effect` is already on every wrapped tool: `describeTool` sets it from `annotations.readOnlyHint` (`read` only when the hint is `true`), and Ranch's own tools carry it since CLEAN-240.

**Rationale**: FR-003/FR-004/FR-005. A third-party server that declares nothing is treated as writing — the safe side.

**Alternatives considered**: repeat everything once — rejected: a dropped response to `create_agent` would create two. Let the model decide — rejected by Principle VII.

## R5. How the runtime tells Ranch

The runtime emits nothing about itself today; the only precedents are best-effort socket emits (`session_activity`) and channel status written to S3.

**Decision**: a socket event `tool_state` on the existing agent socket, sent on every `register` (connect and reconnect) and whenever the state changes, debounced 500 ms. Payload in [contracts/runtime.md](./contracts/runtime.md).

**Rationale**: the hub socket is already the liveness signal Ranch trusts (`markRunningFromBridle`, the CLEAN-55 unreachable rule). State that rides on it vanishes with it, which is exactly right: a disconnected agent has no tool state. S3 would be stale by design and needs a poll. An HTTP call needs a new credential path.

**Consequence**: nothing can be reported before the socket is up. The earlier steps of a start (pod scheduled, container starting, waiting for the runtime) are already known to Ranch from the pod and are already shown; this feature adds the steps after the runtime connects. No reorder of the boot is needed: the first attempt at each server is quick (it fails in milliseconds or at the 10 s timeout) and the socket opens right after.

## R6. Phases

**Decision**: the runtime derives one of three phases from its servers and its own age:

- `connecting` — at least one enabled server is `retrying` and the runtime has been up for less than the waiting limit (`MCP_START_GRACE_MS`, default 60 000).
- `limited` — at least one enabled server is `retrying` or `refused` and the waiting limit has passed.
- `ready` — every enabled server is `connected` (or there are none).

A server that drops later and is being retried makes a `ready` agent `limited` only after it has been away for 15 s, so an API restart (the opposite of the incident) does not flash a mark on every agent.

**Rationale**: FR-009, FR-010 and the "API restarts while agents keep running" edge case. Sixty seconds is the spec's assumption: the 20 November gap was ninety, and most starts connect in two.

## R7. Where the API keeps it, and who sees what

**Decision**: `AgentToolStateService` (in `agent/agent`) holds the last report per agent in memory, fed by the hub's `tool_state` handler and cleared on the agent's disconnect. It exposes:

- `summaryOf(agentId)` → `'connecting' | 'limited' | null` — no names. Added to the public status frame (`agentStatusFrame.ts`), to `AgentDto.toolState`, and to the hub's `agent_status` event to clients.
- `detailOf(agentId)` → servers with name, state, since, attempts, last error — behind `GET /agents/:id/tool-state` (`@ManagesAgent`) and inside `get_agent_status`.

**Rationale**: the status stream is `@Public` and its frame deliberately carries no reason text; a three-value word is safe there. FR-012 is then enforced by shape, not by a filter at each call site: the only route that returns names requires managing the agent. In memory because the truth is the live agent and it re-sends on every reconnect; a column would only add a stale copy to reconcile.

**Known limit, unchanged**: with more than one API replica the hub's view is partial (`hubIsWholeTruth`). The alert sweep follows the existing rule and stays quiet then, exactly as the unreachable rule does.

**Naming**: `mcp-status` already means "the pod predates a config change" and `unreachable` already means two other things (an agent status; in the `app` store, "this account cannot reach the agent"). The new fact is called **tool state** everywhere.

## R8. The incident

Incidents open today only from an agent status transition (`AgentEventService.onStatusChange`) or an outside report.

**Decision**: a new event status `limited` (the columns are strings). `AgentToolStateService` sweeps every 30 s: an agent `limited` for longer than `TOOLS_LIMITED_ALERT_MS` (default 300 000) gets `AgentEventService.recordLimited(agentId, reason)` — the same `attachFailure` path, witness `ranch`, reason `"2 tool servers not connected: Documents, Ranch"` for the incident record and the operator notification. When the summary returns to `null` it calls the same `noteRunning` the status path uses, so the incident closes after the existing 10-minute quiet period as `recovered`.

**Rationale**: FR-011, SC-002 (5 min + one 30 s sweep is well inside ten). One open incident per agent is already guaranteed by `openKey`, which gives "one incident covers the agent" for free. Five minutes because the waiting limit is one and a transient outage of the API with a slow rollout lasts two or three.

## R9. The chat today, twin by twin

| | `admin` | `app` (and share page) |
|---|---|---|
| Composer locked | when the socket is down, the agent is off the hub, or `agentState` is set (`restarting`/`failed`/`stopped`/`unreachable`) | never |
| Knows the agent is starting | yes — `agentState` from `chat/Tab.vue` via `useAgentLifecycle` | only `agentOnline` from the hub's `agent_status` |
| "Answering" | `hasOpenTurn(c)` | `isPending ‖ hasOpenThinking ‖ streaming` (computed inside `newChatBlock`) |
| Send during an answer | goes out at once | goes out at once |
| Request limit | a line for operators | blocks send, restores the draft (`limitWaiting`) |
| Persistence | outbox only (`outboxKey`) | whole conversation |
| Store shape | one record per conversation, sockets inside | setup store, maps keyed by `conv.key`, socket behind a gateway |
| Strings | English literals | `$t` |

So the two consoles need the *same rule* with *different plumbing*, and `app` needs its "answering" pulled out into one getter first.

**What the runtime does with a mid-answer message today**: an LLM classifies it as a new parallel task, a join into the running one, or ambiguous. With the queue, the consoles stop sending mid-answer, so that path is no longer reached from them. It stays for Telegram and the widget. This is the spec's first assumption and is a deliberate change of behaviour.

## R10. Where the queue lives and how it is sent once

**Decision**: the queue is part of the conversation in each console's bridle store and is persisted to `localStorage` under `queueKey(userId, conversationKey)` built in `bridle/utils/storageKeys.ts` (docs/state.md rule 5; share visitors use the visitor id the conversation key already carries). An entry holds the text, the references of already-uploaded attachments (`remoteId`, name, size, kind — never the file), the time it was queued, and a client message id minted at queue time.

Sending the head uses the existing send path with that id as `clientMessageId`; the hub already drops a duplicate id. Two tabs coordinate through `navigator.locks.request('bridle-queue:<key>', { ifAvailable: true })`, with the `storage` event keeping the other tab's list in step; where Web Locks is missing the duplicate check on the hub is the backstop.

**Rationale**: FR-021, FR-022. Attachments are uploaded when staged, so a reference is enough and survives a reload; a staged file that has not finished uploading keeps the message from being queued, exactly as it keeps it from being sent today.

**Alternatives considered**: a server-side queue in the hub — rejected for this ticket: it is the right home if the queue should follow a person across devices, but it needs storage, expiry and a second copy of the limit rules, and the spec accepts a per-device queue. Leaving it to the runtime's task inbox — rejected: it has no order the person can see or change.

## R11. Ready for the next one

**Decision**: one pure function per console, `canTake(state)`: the socket to Ranch is up, the agent is on the hub, the agent is not in a starting/stopped/failed state, tool state is not `connecting`, no turn is open, no request limit is waiting. `drain` runs on every change of those inputs and sends at most one message, then waits for the turn it opened to close.

A queued message is **held** — kept, not sent, the person asked — when the agent failed or was stopped, or when the entry is more than 24 hours old (FR-023). An entry that cannot be sent when its turn comes (attachment no longer allowed) is marked with the reason and skipped (FR-024).

`limited` is ready: FR-015 and the last edge case of the spec.

## R12. Reordering

Neither console has a sortable library; `admin` has one hand-written composable (`skill/composables/useSortableList.ts`, pointer events).

**Decision**: a small `useQueueOrder` composable in the `bridle` slice of each console — drag by a handle, plus "Move up" / "Move down" in the row menu and `Alt+↑` / `Alt+↓` on a focused row, with an `aria-live` line announcing the new position.

**Rationale**: three rows do not justify a dependency in two consoles; the menu and keys are what FR-027 needs anyway, and the drag is the reference's gesture. Copied, not shared, per the twin rule — and listed in the PR as such.

## R13. Compatibility

| Runtime | API | Result |
|---|---|---|
| old | new | no report → `toolState` null → today's status; queue works (it does not need the report) |
| new | old | hub ignores `tool_state`; reconnect still works; consoles unchanged |
| new | new | everything |

The Mazda fork gets the API and console parts through its usual catch-up merge and the reconnect only when its template image moves off 0.34.1 — a jump across the acting-party releases that has to be checked on its dev cluster first. Not part of this plan.

## R14. What the model is told

**Decision**: a per-turn prompt section `tool-servers`, present only when something is missing:

> Some of your tools are not available right now: Documents (still trying to reconnect). Do not answer from memory what those tools would have told you. Say plainly that this part is unavailable. Tell the person to try again shortly only for the ones marked as still reconnecting.

For a `refused` server the bracket reads "(not reconnecting — needs an administrator)". The names are the agent's own server names, which its tool names already expose to it.

**Rationale**: FR-014, SC-008. Today the tooling section simply lacks the server, so the model improvises "try again in a few minutes" from its soul file.
