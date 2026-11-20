# Data model: Identity boundaries in chat and consoles

One migration, `api/prisma/migrations/<ts>_identity_boundaries`. Models live
in their slices (`schema.prisma` is generated from them).

## AgentPeer (`api/src/slices/agent/peer/peer.prisma`), changed

| Field | Type | Meaning |
|---|---|---|
| `createdById` | `String?` | The person who made the connection. Null: made before this feature ("predates the record"), or the account is gone. No relation, as `Session.userId` and `Agent.createdById`. |
| `openToVisitors` | `Boolean @default(false)` | Ranch colleagues only. When true the colleague serves every caller of the asking agent (FR-014). |
| `openedById` | `String?` | Who set the mark. |
| `openedAt` | `DateTime?` | When. |
| `ownerUserId` | `String?` | Outside colleagues only. Set: the one person the connection serves (FR-020). Null: shared, serves every caller. |
| `needsReview` | `Boolean @default(false)` | Set by the migration on connections that existed before it (FR-029). Cleared the first time the visitors setting of the row is saved. |

Rules:

- `openToVisitors` is false on a row with `origin = 'external'`; `ownerUserId`
  is null on a row with `origin = 'internal'`. Enforced in `PeerService`, and
  by a check constraint in the migration.
- Uniqueness of an outside colleague, today a partial unique index on
  `(agentId, cardUrl)`, becomes two: shared rows unique on `(agentId,
  cardUrl) WHERE "ownerUserId" IS NULL`, personal rows unique on `(agentId,
  cardUrl, ownerUserId)`. Two people may each have their own connection to
  the same address; a manager's shared one is separate from both.
- `@@unique([agentId, peerAgentId])` stays: one Ranch connection per pair,
  serving whoever reaches the colleague.

Backfill in the migration:

```sql
UPDATE "AgentPeer" SET "openToVisitors" = true, "needsReview" = true
 WHERE "origin" = 'internal';
UPDATE "AgentPeer" SET "needsReview" = true WHERE "origin" = 'external';
```

Derived, never stored: what a row is to a viewer (`full`, `masked`, `hidden`)
and whether it serves a caller. See [contracts/colleagues.md](./contracts/colleagues.md) §1.

## AgentDelegation (`api/src/slices/agent/peer/delegation.prisma`), changed

| Field | Type | Meaning |
|---|---|---|
| `forUserId` | `String?` | The person the chain was started for. Null for a chain started for nobody. Kept for the audit trail; reach is asked live, never from this column. |

`clientId` and `turnId` keep their meaning and are now the turn that asked
(research R5), not the newest turn of the agent.

A history row is shown to a viewer with the visibility of its connection
today. A row whose connection is gone (`peerId` null) is shown by reach on
`peerAgentId` for a Ranch colleague, and to the Owner only for an outside one.

## Session (`api/src/slices/user/session/session.prisma`), changed

| Field | Type | Meaning |
|---|---|---|
| `surface` | `String?` | `'admin'` or `'app'`: the console the sign-in was made in. Null only on rows that existed before the migration, which are not renewable (FR-040). |

No backfill: a null surface is the mark of an ended sign-in. `pruneForUser`
and everything that ends all of an account's sessions keep working on
`userId` alone (FR-039).

## Not stored

- **Hand-over token**: signed, short-lived, never persisted
  ([contracts/handover.md](./contracts/handover.md)).
- **Chat identity**: derived at the handshake from the live console session.
  No conversation, session file or chat index row is renamed (research R7).
  New conversations of a colleague are named `peer:<connection id>:<context>`.

## Types that change shape

- `ICallerParty` (`api/src/slices/user/auth/domain/auth.types.ts`) gains
  `{ kind: 'peer'; chain: string[]; connectionId: string; forUserId?: string }`.
- `IAgentPeerView` gains `visibility`, `createdBy` (`{ id, name } | null`),
  `createdAt` (exists), `openToVisitors`, `ownerUserId`, `needsReview`,
  `canRemove`, `canSetVisitors`. A masked view carries `id`, `visibility`,
  `openToVisitors`, `skills` and nothing else of the colleague.
- The hub's message to a runtime gains `admin?: true` and
  `handover?: { token }`.
