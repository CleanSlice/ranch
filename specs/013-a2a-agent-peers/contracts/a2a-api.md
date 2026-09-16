# Contracts: A2A endpoints, peers REST, `ask_agent` tool, delegation step

**Ticket**: [CLEAN-74](https://dreamvention.atlassian.net/browse/CLEAN-74) · Model: [data-model.md](../data-model.md) · Decisions: [research.md](../research.md) §3

All REST responses are wrapped by the global interceptor as `{ success: true, data }`; the A2A JSON-RPC endpoint and the card are **exempt** (raw bodies, the protocol owns the envelope). Errors on REST are Nest-standard `{ statusCode, message, code? }`.

## 1. Agent card

`GET /a2a/agents/:agentId/.well-known/agent-card.json`

Auth (`A2aCardGuard`): `Authorization: Bearer <console JWT with Owner|Admin>` **or** `Bearer ap_…` whose `AgentPeer.peerAgentId === :agentId`. Anything else → `401 { code: 'A2A_UNAUTHORIZED' }`. Unknown agent → `404`.

Response `200 application/json` — an A2A 1.0 `AgentCard`, no envelope:

```json
{
  "name": "Support Bot",
  "description": "Answers customer questions about orders and returns.",
  "version": "1",
  "supportedInterfaces": [
    { "url": "https://api.ranch.example/a2a/agents/6f1c…", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }
  ],
  "capabilities": { "streaming": false, "pushNotifications": false, "extensions": [] },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    { "id": "skill:2b…", "name": "Order lookup", "description": "Finds an order by number or email.", "tags": ["skill"] },
    { "id": "knowledge:9a…", "name": "Returns policy", "description": "Answers questions about «Returns policy»: 2026 policy PDF and FAQ.", "tags": ["knowledge"] }
  ],
  "securitySchemes": { "peerBearer": { "httpAuthSecurityScheme": { "scheme": "bearer" } } },
  "securityRequirements": [ { "schemes": { "peerBearer": { "list": [] } } } ],
  "provider": { "organization": "Ranch", "url": "https://api.ranch.example" }
}
```

Field derivation: data-model §3. The card never lists peers.

## 2. A2A JSON-RPC endpoint

`POST /a2a/agents/:agentId` · `Content-Type: application/json` · request header `A2A-Version: 1.0` (absent → treated as 0.3 by the spec; this server answers `-32009 VersionNotSupported` for anything but `1.0`).

Auth (`A2aPeerGuard`): `Bearer ap_…` whose row has `peerAgentId === :agentId`. The row's `agentId` is the **caller** for the rest of the request. Console JWTs are **not** accepted here. Failure → `401 { code: 'A2A_UNAUTHORIZED' }` (HTTP, before JSON-RPC parsing).

### 2.1 `SendMessage`

Request:

```json
{
  "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "m-…", "role": "ROLE_USER",
      "parts": [ { "text": "What is the return window for shoes?" } ],
      "contextId": "ctx-…",
      "metadata": { "ranch": { "chain": ["<callerAgentId>"], "reason": "Peer holds the returns policy base" } }
    },
    "configuration": { "acceptedOutputModes": ["text/plain"], "returnImmediately": false }
  }
}
```

Rules, in order:

| Check | Outcome |
|---|---|
| `returnImmediately: true`, or any part without `text` | `-32004 UnsupportedOperation` / `-32005 ContentTypeNotSupported` |
| `metadata.ranch.chain` contains `:agentId` | task `TASK_STATE_REJECTED`, status message `"would loop: <name> is already in the chain"`, `metadata.ranch.rejection = 'loop'` |
| `metadata.ranch.chain.length >= 3` | task `TASK_STATE_REJECTED`, `"too deep: chain limit is 3 hops"`, `rejection = 'depth'` |
| `!hub.isAgentConnected(:agentId)` | task `TASK_STATE_FAILED`, `"peer not running"`, `metadata.ranch.failure = 'not_running'` |
| runtime does not answer within the sync limit (120 s) | task `TASK_STATE_FAILED`, `"timed out after 120s"`, `failure = 'timeout'` |
| reply received | task `TASK_STATE_COMPLETED`, one artifact |

The message text (all `text` parts joined by blank lines) is sent to the runtime through `BridleSyncService.sendAndAwait` with `clientId = peer:<callerAgentId>:<contextId>`, `capabilities: []`, and the `chain` **extended with `:agentId`** stored on the task metadata so the peer's own `ask_agent` (if any) forwards it. `contextId` absent → minted (`ctx-<uuid>`).

Response (blocking, final task):

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "task": {
      "id": "…delegation/task id…", "contextId": "ctx-…",
      "status": { "state": "TASK_STATE_COMPLETED", "timestamp": "2026-09-10T12:00:03.120Z" },
      "artifacts": [
        { "artifactId": "reply", "name": "reply", "parts": [ { "text": "Shoes can be returned within 30 days …" } ] }
      ],
      "history": [],
      "metadata": { "ranch": { "chain": ["<callerAgentId>", "<thisAgentId>"], "durationMs": 3120 } }
    }
  }
}
```

Rejected/failed tasks put the cause in `status.message`: `{ "messageId": "…", "role": "ROLE_AGENT", "parts": [ { "text": "would loop: …" } ] }` and have no artifacts.

### 2.2 `GetTask`

`params: { "id": "<taskId>" }` → the same task object while it is in the in-memory store (10 min), else `-32001 TaskNotFound`.

### 2.3 Everything else

`SendStreamingMessage`, `SubscribeToTask`, `CancelTask`, `ListTasks`, push-config methods, `GetExtendedAgentCard` → `-32004 UnsupportedOperation` (`CancelTask` on a known task: `-32002`). Unknown method → `-32601`. Malformed body → `-32700` / `-32600`.

## 3. Peers REST (admin console)

All under `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Owner, Admin)`. Response DTOs never include `token`.

| Method | Path | operationId | Body / query | Returns |
|---|---|---|---|---|
| `GET` | `/agents/:agentId/peers` | `listAgentPeers` | — | `AgentPeerDto[]` |
| `GET` | `/agents/:agentId/peers/candidates` | `listAgentPeerCandidates` | — | `AgentPeerCandidateDto[]` — every other agent of the installation with `connected: boolean` |
| `GET` | `/agents/:agentId/card` | `getAgentCard` | — | `AgentCardDto` — this agent's own card (same JSON as §1, wrapped) — the "Agent card" view and the picker preview (`/agents/:peerId/card`) |
| `POST` | `/agents/:agentId/peers` | `connectAgentPeer` | `{ peerAgentId }` | `201 AgentPeerDto` — reads the peer's card **over HTTP at its card URL using the freshly minted credential** (proves the credential and URL work), stores the snapshot |
| `POST` | `/agents/:agentId/peers/:peerId/refresh` | `refreshAgentPeer` | — | `AgentPeerDto` with a new snapshot and `cardReadAt` |
| `DELETE` | `/agents/:agentId/peers/:peerId` | `removeAgentPeer` | — | `204` — deletes the row (revokes the credential) |
| `GET` | `/agents/:agentId/delegations` | `listAgentDelegations` | `?limit=20` | `AgentDelegationDto[]` newest first |

`AgentPeerDto`: `{ id, agentId, peerAgentId, peerName, peerStatus, peerExists, card: AgentCardDto, cardUrl, cardReadAt, createdAt }` — `peerStatus` is the live agent status string so the list can show "not running".

`AgentPeerCandidateDto`: `{ id, name, status, connected }`.

`AgentDelegationDto`: `{ id, peerAgentId, peerName, task, reason, status, errorCode, excerpt, startedAt, finishedAt, durationMs }`.

Errors: `400 { code: 'PEER_SELF' }`, `409 { code: 'PEER_EXISTS' }`, `404 { code: 'PEER_NOT_FOUND' }` (peer agent or connection), `502 { code: 'PEER_CARD_UNREACHABLE', message }` when the card fetch at connect/refresh fails (nothing is stored on connect failure; on refresh failure the old snapshot is kept).

## 4. MCP tool `ask_agent` (served to the agent runtime)

Listed for a caller only when it has ≥ 1 peer (`isListedForRequest`). Calls from a non-agent principal or for a peer not connected to the caller return `isError`.

Static description (used when the caller has no peers — which, given the listing filter, only happens if a pod cached the tool before its last peer was removed):

> Ask one of your connected peer agents to do a task you cannot do yourself. You currently have no peers connected; do not call this tool.

Dynamic description (per request, from card snapshots):

> Ask one of your connected peer agents to do a task you cannot do yourself, and use their reply in your answer, saying it came from them. Call this when the user asks about something that a peer's skills below cover and your own tools do not. Do not call it for things you can do yourself. Send the peer a self-contained task in plain text — it does not see this conversation. If several independent questions go to different peers, call this tool for each in the same turn. Give a one-line `reason` naming the skill that made you choose this peer; it is shown to the user.
>
> Your peers:
> - "Support Bot" (peer: `6f1c…`) — Answers customer questions about orders and returns. Skills: Order lookup (Finds an order by number or email); Returns policy (Answers questions about «Returns policy»: 2026 policy PDF and FAQ)
> - …

Input schema (zod):

```ts
z.object({
  peer: z.string().describe('Peer id from the list above, or the peer\'s exact name'),
  task: z.string().min(1).describe('Self-contained task text for the peer'),
  reason: z.string().min(1).describe('One line: why this peer — name the matching skill'),
  context_id: z.string().optional().describe('Continue an earlier exchange with the same peer in this turn: pass the context_id from its previous result'),
})
```

Result text (success):

```
Reply from «Support Bot» (context_id: ctx-…, 3.1s):

Shoes can be returned within 30 days …
```

Result text (`isError: true`), one of:

```
Could not reach «Support Bot»: peer not running. Tell the user you could not get this from Support Bot; do not guess on its behalf.
Could not reach «Support Bot»: timed out after 120s. …
«Support Bot» refused the task: would loop: … / too deep: …
No peer matches "…". Your peers are: …
```

Side effects, in order: create `AgentDelegation` (`waiting`) → push delegation step (`active`) if an active turn is known → HTTP `SendMessage` to the snapshot URL with `Bearer <row.token>`, `A2A-Version: 1.0`, `metadata.ranch.chain = [...inboundChain, callerId]` (inbound chain = the chain the caller itself was called with, if this turn is itself a delegation; else `[]`) → finalise the row → push the step (`done`).

## 5. Delegation thinking step (WebSocket `thinking` event)

Pushed by the API with `hub.sendToClient(clientId, agentId, event)`:

```json
{
  "type": "thinking", "clientId": "admin", "turnId": "<runtime turnId>", "ts": 1757505600000,
  "step": {
    "id": "delegation:5e2a…", "label": "Asking «Support Bot»", "state": "active",
    "kind": "delegation",
    "delegation": {
      "delegationId": "5e2a…", "peerAgentId": "6f1c…", "peerName": "Support Bot",
      "matchedSkills": [ { "id": "knowledge:9a…", "name": "Returns policy" } ],
      "reason": "Support Bot holds the returns policy base",
      "task": "What is the return window for shoes?",
      "status": "waiting", "startedAt": 1757505600000
    },
    "detail": "**Peer:** Support Bot — Returns policy\n**Why:** Support Bot holds the returns policy base\n**Task:** What is the return window for shoes?\n**Status:** waiting…"
  }
}
```

Final push: same `id`, `state: "done"`, `label` `Answered by «Support Bot»` / `Could not reach «Support Bot»` / `«Support Bot» refused the task`, `delegation.status` final, `durationMs`, `excerpt`, and `detail` rewritten with status, time and excerpt/cause. No `done: true` is ever sent by the API — the turn's terminal event stays the runtime's.

Admin rendering (`admin/slices/bridle/components/bridle/DelegationStep.vue`): peer name as the label with a peer icon; a row of matched-skill badges; "why" line; the task in a quiet quote; status pill with live elapsed time (`now - startedAt` while `waiting`, `durationMs` after); excerpt or cause. Generic renderers show `label` + markdown `detail`.

## 6. Configuration

| Key | Where | Default | Used for |
|---|---|---|---|
| `api_public_url` | infra setting (`infrastructure` group) → env `API_PUBLIC_URL` → fallback integration `ranch_api_url` | local: `http://localhost:3333` (via `ranch_api_url` default `http://host.k3d.internal:3333` in-cluster) | absolute `supportedInterfaces[0].url`, `cardUrl` |
| `A2A_SYNC_TIMEOUT_MS` | env | `120000` (same as the bridle sync route) | delegation wait |
| `A2A_MAX_CHAIN` | env | `3` | depth rule |
