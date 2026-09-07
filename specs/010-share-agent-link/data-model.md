# Data model: Share an agent by public link (CLEAN-66)

Decisions behind this shape: [research.md](./research.md) R1–R3.

## AgentShareLink (new table)

`api/src/slices/agent/shareLink/shareLink.prisma`, composed by `prisma-import` (relation to `Agent` needs the reverse field `shareLink AgentShareLink?` in `agent.prisma`).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `agentId` | `String @unique` | FK → `Agent.id`, `onDelete: Cascade`. **Unique ⇒ at most one link row per agent.** |
| `token` | `String @unique` | `sl_` + 32 random bytes base64url (≈256 bits). Plaintext (R1). Never logged. |
| `revokedAt` | `DateTime?` | `null` ⇒ active. Set by Revoke; cleared by Regenerate / Share-after-revoke. |
| `rotatedAt` | `DateTime?` | Last time the token was replaced (Regenerate or re-Share). |
| `rotationCount` | `Int @default(0)` | Audit counter; incremented on every new token after the first. |
| `createdBy` | `String` | JWT `sub` of the console user who first shared the agent (FK-by-convention to `User`, like `apiKey.createdBy`). |
| `updatedBy` | `String` | JWT `sub` of the last Share / Revoke / Regenerate actor. |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

Indexes: the two `@unique` columns are the only lookups (`agentId` for the owner panel, `token` for visitors and chat requests).

Migration: `api/prisma/migrations/<ts>_agent_share_link/migration.sql` — additive (new table + FK), safe on an existing database.

### State machine (per agent)

```
(no row) ──Share──▶ active ──Revoke──▶ revoked ──Share / Regenerate──▶ active (new token)
                      │                                                    ▲
                      └──────────────Regenerate (new token)────────────────┘
```

| Action | Precondition | Effect |
|---|---|---|
| Share (`POST`) | no row | insert `{ token: mint(), createdBy, updatedBy }` |
| Share (`POST`) | active | no change, return current link (idempotent) |
| Share (`POST`) | revoked | `token = mint()`, `revokedAt = null`, `rotatedAt = now`, `rotationCount++` |
| Regenerate | active or revoked | same as Share-after-revoke (single `UPDATE`, atomic) |
| Revoke | active | `revokedAt = now`, `updatedBy` |
| Revoke | revoked / no row | no-op, 200 with current state |

Validation: `token` is only ever produced by the service (never client-supplied). `agentId` must reference an existing agent (404 otherwise).

## Visitor identity (no table)

| Item | Where | Rule |
|---|---|---|
| `visitorId` | browser `localStorage['bridle:share:visitor']` | 22 base64url chars minted on first visit to any share link; reused for every link in that browser. |
| server validation | `BridleController.resolveClientId` | must match `/^[A-Za-z0-9_-]{1,64}$/` (existing `sanitizeAnonId` rule); otherwise 403. |
| `clientId` | derived on the server | `share-<visitorId>`. Prefix guarantees no collision with JWT `sub`, `admin`, `anon-…`, `http-…`, `sync-…`. |

## Visitor conversation (existing structures, new values)

- Agent runtime session file: `agents/<agentId>/data/sessions/bridle:share-<visitorId>.jsonl` (written by the runtime from `clientId`, unchanged code).
- `ChatSession` index row (existing model, `api/src/slices/chat/chat.prisma`): `channel = 'bridle'`, `externalUserId = 'share-<visitorId>'`, `sessionKey = 'bridle:share-<visitorId>'`. No schema change; FR-012 "distinguishable" = prefix.
- Console-side cache (existing bridle store, `app/slices/bridle/stores/bridle.ts`): conversation descriptor `{ key, agentId, share? }` where the share page uses `key = share:<agentId>:<visitorId>` and `localStorage['bridle:conversation:<key>']`; the console keeps `key = agentId`, so existing stored conversations keep their keys.

## Attachment ownership (existing S3 objects, one new metadata field)

| Item | Where | Rule |
|---|---|---|
| `owner` | S3 user metadata on the attachment object (alongside `name`, `mime`) | the uploader's `clientId` (`share-<visitor>`, JWT `sub`, or `admin`). Absent on objects uploaded before this change. |
| download check | `BridleController.downloadAttachment` | share visitor ⇒ `owner` must equal `share-<visitor>` (404 otherwise, same as "not found"); JWT caller ⇒ unchanged, no owner check. |

## Owner-side view model (app, `app/slices/share/domain/share.types.ts`)

```ts
interface IShareLinkState {
  active: boolean;
  token: string | null;      // present only when active
  url: string | null;        // `${location.origin}/share?token=${token}`, built client-side
  createdAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
}
interface IShareResolved {   // visitor side
  agentId: string;
  agentName: string;
  agentStatus: string;       // AgentStatusTypes; 'running' ⇒ chat is live
}
```
