# Contract: close the current conversation

`POST /api/agent/{agentId}/transcript/archive?channel={clientId}`
(`operationId: archiveBridleTranscript`) — existing route, behaviour completed.

## Request

| Part | Value |
|------|-------|
| `agentId` (path) | the agent |
| `channel` (query) | the conversation's client id, as the hub announced it in `welcome.clientId`. Defaults to `admin`, as today. |
| Console caller | `Authorization: Bearer <token>` |
| Share visitor | `X-Share-Token` + `X-Share-Visitor`, and no bearer |
| Body | none |

## Access (unchanged)

| Channel | Caller | Result |
|---------|--------|--------|
| `share-<visitorId>` | that visitor's own header pair | allowed |
| `share-<visitorId>` | a console bearer | allowed |
| `share-<visitorId>` | anyone else, including another visitor | `403 { code: SHARE_LINK_INVALID }` |
| any other | as today (research D12) | allowed |

A dead share link answers `403` like every other chat route; the share page's
existing interceptor turns that into the invalid-link state (FR-014).

## Order of operations

Each step either completes or ends the request with the listed answer. Nothing
before step 6 changes anything.

| # | Step | On failure |
|---|------|------------|
| 1 | Access check | `403` |
| 2 | Agent is connected to the hub | `409 { code: AGENT_OFFLINE }` |
| 3 | No turn is open on this conversation (research D4) | `409 { code: TURN_IN_PROGRESS }` |
| 4 | Agent pushes its files to storage and acks within 5 s (D5) | `503 { code: SYNC_FAILED }` |
| 5 | Read the live session file | not found or empty → skip to step 9; any other error → `5xx` |
| 6 | Write the closed copy `bridle:<clientId>.<iso-ts>.archived.jsonl` | `5xx`; nothing was changed |
| 7 | Delete the live file | remove the copy from step 6, then `5xx` |
| 8 | Move the chat index row to the closed key, `archived: true` (D7) | logged; the request continues — reconciliation repairs the index, and failing here would leave a reset half done |
| 9 | `hub.resetConversation(agentId, clientId)` — agent forgets, replay buffer dropped, `conversation_reset` routed to every socket on the conversation | does not throw. If the agent left the hub between step 2 and here, `session_clear` is not delivered: logged as a warning. A pod that restarted comes back clean from storage; one that only lost its socket may re-upload its local file — the one window this route cannot close from the API side |

## Response

`200`

```json
{ "archivedPath": "data/sessions/bridle:share-ab12.2026-10-02T09-14-03-512Z.archived.jsonl" }
```

`{}` when there was nothing to close (step 5). The path is kept for
compatibility with the route's existing answer; the consoles do not use it.

The body gets a response DTO so the generated SDKs type it; refusals are
declared with `@ApiConflictResponse` / `@ApiServiceUnavailableResponse`.

## Refusal codes

| Status | `code` | Meaning for the person |
|--------|--------|------------------------|
| 403 | `SHARE_LINK_INVALID`, `SHARE_VISITOR_INVALID` | the link no longer works |
| 409 | `AGENT_OFFLINE` | the agent cannot be reached right now |
| 409 | `TURN_IN_PROGRESS` | the agent is still answering |
| 503 | `SYNC_FAILED` | the conversation could not be saved; nothing was changed |

## Guarantees

- **Idempotent in effect**: a second call right after a successful one finds
  no live file, creates no second closed conversation, and resets again
  (FR-013).
- **No partial clean slate**: the conversation is reset on the hub only after
  the old one is safely closed, or when there was nothing to close.
- **Scoped**: only `bridle:<clientId>` of `agentId` is touched (FR-006).
- **Memory and attachments**: untouched (FR-016).

## The sibling route

`DELETE /api/agent/{agentId}/transcript` keeps deleting. Its one change: it
calls `hub.resetConversation` instead of `hub.clearAgentSession`, so a reset
from the admin console reaches every open screen (FR-019).

## Specs owed

`bridle.controller.spec.ts`, beside the existing share-channel cases:

- agent not connected → 409, storage untouched;
- turn open → 409, storage untouched;
- push times out → 503, storage untouched;
- happy path: push before read; copy before delete; index moved;
  `resetConversation` called once;
- nothing to close → `{}`, no copy, `resetConversation` still called;
- delete fails → copy removed, error surfaced, no reset;
- index move throws → request still succeeds and resets.
