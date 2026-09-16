# Contract: Peers v2 console API (CLEAN-95)

Extends the CLEAN-74 contract ([013 contracts/a2a-api.md](../../013-a2a-agent-peers/contracts/a2a-api.md)).
All routes below are console routes: Owner/Admin JWT, `{ success, data }` envelope.
The bare A2A routes (`/a2a/agents/…`) are unchanged by this feature.

## POST /agents/:agentId/peers — extended (one-of body)

Internal (unchanged):

```json
{ "peerAgentId": "agent-3f2504e0-…" }
```

External import (new):

```json
{ "url": "https://other.example/a2a/agents/agent-…", "token": "optional bearer" }
```

Rules:
- Exactly one of `peerAgentId` | `url`. Both or neither → 400 `PEER_BODY`.
- `url` accepts the agent base address or its `…/.well-known/agent-card.json` form;
  the canonical base is stored and echoed in `cardUrl`.
- The card is fetched (with `token` when given) and version-checked **before** any row
  is written. Failure persists nothing.
- Canonical URL already imported for this agent → **200** with the updated row
  (snapshot, address form, credential replaced) — never a duplicate, never 409.
- Internal duplicates keep returning 409 `PEER_EXISTS`; internal self keeps 400
  `PEER_SELF`.

New error codes:

| Code | HTTP | When |
|---|---|---|
| `PEER_BODY` | 400 | body has both or neither of `peerAgentId` / `url` |
| `PEER_URL_INVALID` | 400 | not an absolute http(s) URL, or response is not an A2A card |
| `PEER_URL_UNREACHABLE` | 502 | fetch failed / refused / timed out (fail fast) |
| `PEER_VERSION` | 400 | card's protocol version is not 1.0 |
| `PEER_SELF_URL` | 400 | canonical URL points at this installation's own A2A base — hint: pick the agent in the internal list |

Response `data`: `AgentPeerDto` — now with `origin: "internal" | "external"`. External
rows: no `peerAgentId`, `peerStatus: "external"`, `peerExists: true`. Neither `token`
nor `outboundToken` ever appears in any response (poisoned-stub spec covers both).

## GET /agents/:agentId/peers — unchanged route, extended rows

Rows carry `origin`. Ordering and everything else unchanged.

## GET /agents/:agentId/peers/state — new

```json
{ "success": true, "data": { "armed": false, "servedAt": "2026-09-16T12:00:00.000Z" } }
```

- `armed` — the running pod's last-served peer set matches the current one.
- `servedAt` — when the pod last received the peer list over MCP; `null` if never.
- Auth: Owner/Admin JWT, same as the peers list.

## POST /agents/:agentId/peers/:peerId/refresh — unchanged route

For external rows it re-reads `cardUrl` with the stored `outboundToken`. A 401/403
from the external agent surfaces as `PEER_UNAUTHORIZED` («credential refused») instead
of silently keeping the stale snapshot.

## DELETE /agents/:agentId/peers/:peerId — unchanged route

External rows: also discards the stored `outboundToken`. (Internal rows keep revoking
the inbound pair credential, as today.)

## GET /agents/:agentId/delegations — unchanged route, relaxed field

`peerAgentId` becomes nullable in the row shape; external delegations carry `null`
there and keep `peerId` (connection id) + `peerName`. Everything else unchanged.

## MCP surface (served to the agent, not the console)

`ask_agent` — same tool, description extended with the FR-011 policy paragraph
(research R3) and per-peer lines covering both origins identically. Serving the list
records `peersServedAt` / `peersServedHash` on the agent (research R4). No changes to
the MCP protocol itself.
