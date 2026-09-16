# Data Model: A2A v2

Extends the CLEAN-74 model ([013 data-model](../013-a2a-agent-peers/data-model.md)).
Everything here is additive; existing rows read as `origin='internal'`.

## AgentPeer (changed)

| Field | Type | Change | Notes |
|---|---|---|---|
| `id` | String @id | — | |
| `agentId` | String FK → Agent | — | the caller |
| `peerAgentId` | String? FK → Agent | **now nullable** | `null` ⇔ external row |
| `origin` | String | **new** | `'internal'` \| `'external'`; default `'internal'` for the migration |
| `token` | String? @unique | **now nullable** | inbound `ap_` pair credential; minted for internal rows only |
| `outboundToken` | String? | **new** | bearer we present to an external agent; write-only — never in any DTO (poisoned-stub test extends to it) |
| `cardUrl` | String | — | canonical base address for both origins |
| `cardSnapshot` | Json | — | |
| `cardReadAt` | DateTime | — | |
| `createdAt` / `updatedAt` | DateTime | — | |

**Invariants**
- `origin='internal'` ⇒ `peerAgentId` set, `token` set, `outboundToken` null.
- `origin='external'` ⇒ `peerAgentId` null, `token` null, `outboundToken` optional.
- Uniqueness: internal `(agentId, peerAgentId)` (existing); external `(agentId, cardUrl)`
  after canonicalization — re-import updates in place, never inserts a second row.
- Self rows refused both ways: `peerAgentId === agentId` (existing `PEER_SELF`) and
  canonical `cardUrl` pointing at this installation's own A2A base (`PEER_SELF_URL`).

## Agent (changed)

| Field | Type | Change | Notes |
|---|---|---|---|
| `peersServedAt` | DateTime? | **new** | last time the running pod received this agent's peer list over MCP |
| `peersServedHash` | String? | **new** | hash of sorted peer row ids served at that moment |

`armed` is **derived, not stored**: `peersServedHash === hash(current peer row ids)`.

## Migration

One additive Prisma migration: relax `AgentPeer.peerAgentId`/`AgentPeer.token` and
`AgentDelegation.peerAgentId` to nullable, add `origin` (default `'internal'`),
`outboundToken`, `peersServedAt`, `peersServedHash`, and the partial unique index on
`(agentId, cardUrl)` where `origin = 'external'`.

## DTO shapes (console)

**AgentPeerDto** (extended): gains `origin: 'internal' | 'external'`. For external rows
`peerAgentId` is absent, `peerExists` is always `true` (existence is the card fetch),
`peerStatus` reports `'external'` — the console shows the origin badge instead of a
live pod status it cannot know. Never contains `token` or `outboundToken`.

**ConnectPeerDto** (one-of):
- `{ peerAgentId: 'agent-<uuid>' }` — unchanged internal path, or
- `{ url: string, token?: string }` — external import; `url` accepts base or
  `…/.well-known/agent-card.json` form.
Exactly one of `peerAgentId` / `url` must be present.

**PeersStateDto** (new): `{ armed: boolean, servedAt: string | null }`.

## State transitions

- **Import (new URL)** → row created (`external`), card snapshot stored after a
  successful fetch — fetch failure persists nothing.
- **Import (known URL)** → same row updated: snapshot, address form, credential;
  `updatedAt` bumps; peer membership unchanged ⇒ `armed` stays true.
- **Connect / remove (either origin)** → membership changes ⇒ stored hash no longer
  matches ⇒ `armed=false` (**pending restart**) until the pod's next `tools/list`.
- **Restart now** → existing restart flow; on boot the pod calls `tools/list`, the
  serve hook stores the fresh hash ⇒ `armed=true`.

## Delegation record

`AgentDelegation` keeps its shape with one relaxation: the denormalized `peerAgentId`
becomes **nullable** — an external peer has no agent id in this installation. The
record's link to the connection (`peerId`, already nullable on removal) stays the
stable key: the feed's per-peer filter switches from matching `peerAgentId` to
matching the connection id, which works for both origins. The console renders the
peer-name link to `/agents/…` only when `peerAgentId` is present.
