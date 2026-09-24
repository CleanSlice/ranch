# Data Model: Advanced Agent File Management (CLEAN-112)

Phase 1 output. Domain types live in `api/src/slices/agent/file/domain/`; DTOs in `api/src/slices/agent/file/dtos/`; the admin/app SDK is generated from the swagger spec (never hand-written).

## 1. Workspace file node (extended)

`IFileNode` (existing) gains classification. Returned by `GET /agents/:id/files` and by `list_agent_files`.

| Field | Type | Notes |
|---|---|---|
| `path` | string | relative to the agent prefix, `/`-separated |
| `size` | number | bytes |
| `updatedAt` | Date | S3 `LastModified` |
| `kind` | `'text' \| 'binary'` | **new**; extension allowlist, sniff fallback (research R2) |
| `editable` | boolean | **new**; `kind === 'text' && size ≤ MAX_EDIT_BYTES` |

Rules: `kind` is computed by the API only. The sniff (first 8 KB, no NUL, valid UTF-8) runs only for unknown/missing extensions and its result is not cached (objects are small and listing is per visit).

## 2. File slice (existing, one rule added)

`IFileChunk`: `path, content, size, totalSize, offset, nextOffset, hasMore, updatedAt`.

Added rule: `content` never ends in a partial UTF-8 sequence; the API trims up to 3 trailing bytes and reports `nextOffset` accordingly. `size` is the byte length actually returned.

## 3. Open link

Not persisted. A signed token (JWT) with claims:

| Claim | Meaning |
|---|---|
| `sub` | `open-link` |
| `agentId`, `path` | the one object the token opens |
| `kind` | `text` → inline `text/plain; charset=utf-8`; `binary` → attachment with stored content type |
| `exp` | now + `OPEN_LINK_TTL_SEC` (900) |

Returned as `{ url, expiresAt }`. The raw endpoint validates the token and nothing else (no session).

## 4. Import stage

An uploaded or fetched archive, stored once, outside every agent prefix.

| Field | Where | Notes |
|---|---|---|
| `importId` | S3 key `imports/<agentId>/<importId>.zip` | UUID |
| `agentId` | S3 metadata | target agent |
| `source` | S3 metadata | `upload \| attachment \| url` |
| `size`, `entries` | S3 metadata | after validation |
| `createdAt` | S3 metadata | sweep after `IMPORT_STAGE_TTL_MIN` (60) |

Lifecycle: `staged` → (previewed any number of times) → `applied` (object deleted) or `expired` (sweep). A stage is validated **once** at staging; validation failure means no stage is written and the error names the entry.

## 5. Import plan (computed, not stored)

```
ImportPlan {
  importId: string
  mode: 'merge' | 'replace'
  includeSessions: boolean
  wrapperStripped: string | null      // top-level folder removed, if any
  counts: { add, change, unchanged, remove, skip: number }
  totalBytes: number                   // of entries that will be written
  entries: ImportPlanEntry[]           // capped at IMPORT_PLAN_LIST_ROWS (500)
  more: number                         // entries not listed
  warnings: string[]                   // e.g. "3 files use multipart ETags — treated as changed"
}
ImportPlanEntry { path: string; action: 'add'|'change'|'unchanged'|'remove'|'skip'; size: number; reason?: string }
```

Classification rules (research R4): `skip` for `sessions/` unless included; `remove` only in `replace` mode for existing keys absent from the archive (minus skipped prefixes); `change` when MD5(entry) ≠ ETag or ETag is multipart.

## 6. Import result (returned, also embedded in a set proposal after apply)

```
ImportResult {
  importId, mode
  written: number; removed: number; skipped: number
  failed: { path: string; reason: string }[]
  restartRequired: boolean             // agent currently running
}
```

## 7. File change proposal (persisted)

Prisma model `FileChangeProposal` in `api/src/slices/agent/file/file.prisma`.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `agentId` | string | **target** workspace |
| `chatAgentId` | string | the agent whose chat raised it (Rancher); card is shown in this chat |
| `channel` | string | bridle channel of the turn (`admin` default) |
| `clientId` | string? | active turn's client at proposal time |
| `turnId` | string? | |
| `kind` | `single \| set` | |
| `op` | `write \| create \| import` | |
| `path` | string? | `single` only |
| `baseEtag` | string? | S3 ETag at proposal time; `null` = file did not exist |
| `contentKey` | string? | S3 key `proposals/<id>/content` (`single`) |
| `importId` | string? | `set` only |
| `mode`, `includeSessions` | | `set` only |
| `proposedBytes` | number | |
| `diffStatus` | `ok \| too_large \| binary \| none` | `none` for `set` |
| `additions`, `deletions`, `changedLines` | number? | null when `diffStatus ≠ ok` |
| `inlineDiff` | text? | unified hunks, only within `DIFF_INLINE_*` caps |
| `summary` | json | `set`: `ImportPlan.counts` + first `PROPOSAL_LIST_ROWS` entries + `more` |
| `status` | `pending \| applied \| skipped \| stale \| refused` | |
| `actedBy` | string? | user id (console) or `agent:<id>` (tool confirm) |
| `actedVia` | `card \| tool \| editor`? | |
| `actedAt` | datetime? | |
| `result` | json? | `ImportResult` for `set`; `{ etag }` for `single` |
| `createdAt` | datetime | |

Indexes: `(chatAgentId, channel, createdAt)` for transcript merge; `(agentId, path, status)` for staleness of siblings.

### State transitions

```
pending ──apply (ETag matches)──────────▶ applied
pending ──apply (ETag differs / createOnly target exists)──▶ stale
pending ──skip──────────────────────────▶ skipped
pending ──apply, actor lacks file access / agent gone──▶ refused
pending ──another proposal for same path applied──▶ stale   (single only)
```

Terminal states never change. `apply` on a non-pending proposal is a 409 that returns the current row. Apply is idempotent under concurrency: a row-level conditional update (`status = pending`) guards the write.

## 8. Proposal event payloads (transport, not stored)

`proposal` (hub → the active client) carries the DTO of the row minus `contentKey`/`importId`, plus `agentName` and `targetAgentName` for display.

`proposal_update` (hub → all clients of `chatAgentId`) carries `{ proposalId, status, actedAt, actedBy, actedVia, result? }`.

## 9. Limits (configuration, one module)

`api/src/slices/agent/file/domain/file.limits.ts`, env-overridable (`RANCH_FILES_<NAME>`), returned by `GET /agents/:id/files/limits`:

| Name | Default | Used by |
|---|---|---|
| `MAX_EDIT_BYTES` | 1 MiB | editable flag, save guard |
| `MAX_VIEW_BYTES` | 25 MB | viewer streaming cap |
| `RANGE_BYTES` / `MAX_RANGE_BYTES` | 256 KB / 512 KB | slices |
| `OPEN_LINK_TTL_SEC` | 900 | open link |
| `IMPORT_MAX_ARCHIVE_BYTES` | 100 MB | staging |
| `IMPORT_MAX_ENTRIES` | 2000 | staging |
| `IMPORT_MAX_FILE_BYTES` | 25 MB | staging |
| `IMPORT_MAX_UNCOMPRESSED_BYTES` | 500 MB | staging (zip bomb) |
| `IMPORT_PLAN_LIST_ROWS` | 500 | plan entries listed |
| `IMPORT_STAGE_TTL_MIN` | 60 | sweep |
| `DIFF_COMPARE_MAX_BYTES` | 1 MiB | any diff |
| `DIFF_INLINE_MAX_LINES` | 200 | inline card diff |
| `DIFF_INLINE_MAX_BYTES` | 100 KB | inline card diff |
| `PROPOSAL_LIST_ROWS` | 50 | set card rows |

## 10. Admin store shape (client, `docs/state.md`)

`agentFile` store (existing, extended): `filesByAgent[agentId]: IFileNode[]`, `limits`, `openTabs[agentId]: string[]`, `activePath[agentId]`, `drafts[agentId][path]: { content, baseUpdatedAt }`, `loaded[agentId][path]: { content, totalSize, nextOffset, hasMore }`, `selection[agentId]: Set<string>`. Fetches upsert; components render by `agentId` + `path`.

`fileProposal` store (new, used by both bridle and the Files tab): `byId[proposalId]`, `byChat[chatAgentId+channel]: proposalId[]`, `upsert()` from `proposal` / transcript, `patch()` from `proposal_update` with optimistic Apply/Skip and rollback.

App console: only the proposal store's read side (`upsert`, `patch`) and the card component.
