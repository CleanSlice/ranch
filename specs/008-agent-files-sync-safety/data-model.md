# Data Model: Agent Files — Visible Copy Model & Safe Sync

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Agent (existing Prisma model — additions)

File: `api/src/slices/agent/agent/agent.prisma`

| Field | Type | Set when | Semantics |
|-------|------|----------|-----------|
| `lastPullAt` | `DateTime?` | Agent's bridle socket authenticates (`connected` event path: `bridle.gateway.ts` → `agentStatus.service.ts`) | Upper bound of the moment the pod pulled its working copy from S3 (pull happens at boot, moments before connect) |
| `lastSyncAt` | `DateTime?` | `sync_done` received (`bridle.gateway.ts:handleSyncResponse`) | Moment the last successful Sync push completed |

Both nullable: agents deployed before this feature have neither until their next boot/sync.

**Migration**: `prisma migrate dev --name agent-sync-markers` (additive, no backfill).

## Derived values (not stored)

| Value | Definition |
|-------|-----------|
| `baseline` | `max(lastSyncAt, lastPullAt - PULL_MARGIN)`; `PULL_MARGIN ≈ 60s` covers the boot-pull→connect window. If both markers are null → no baseline → conflict check is skipped (warn-free Sync, matches pre-feature behavior). |
| `atRisk[]` | S3 objects under the agent's prefix with `LastModified > baseline`. Fields per entry: `path`, `updatedAt` (S3 LastModified). |

## DTO changes

| DTO | Change |
|-----|--------|
| Agent response DTO (agent GET, feeds admin workspace) | + `lastPullAt`, `lastSyncAt` (nullable ISO strings) |
| Sync request body | + optional `confirm?: boolean` |
| Sync 409 response (new) | `{ requiresConfirmation: true, atRisk: [{path, updatedAt}], baseline }` |
| Sync 200 response | unchanged: `{ agentOnline, pushed }` |

## State transitions

```
pod boots ──pull from S3──▶ socket connects ──▶ lastPullAt = now()
operator triggers Sync:
  baseline exists AND atRisk non-empty AND !confirm ──▶ 409, no side effects
  else ──▶ 'sync' → pod → 'sync_done' ──▶ lastSyncAt = now()
```

## Entities NOT changed

- S3 file objects: no metadata additions; `LastModified` used as-is (already exposed as `updatedAt` in `file.gateway.ts`).
- Runtime manifest: untouched (delta semantics preserved per FR-005).
- `rancher/.agent/SOUL.md`: content-only edit (honesty constraints), no schema.
