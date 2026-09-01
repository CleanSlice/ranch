# Contract: Agent Files Sync API

**Slice**: `api/src/slices/agent/file` | consumed by `admin` via generated `FilesService` (openapi-ts).
After DTO changes: regenerate `api` swagger (`bun run generate:swagger`) and `admin` client (`bun run build:api`).

## POST /agents/:agentId/files/sync (changed)

Request body (new, optional — absent body ≡ `{}`):

```json
{ "confirm": false }
```

Responses:

| Code | Body | When |
|------|------|------|
| 200 | `{ "agentOnline": true, "pushed": 3 }` | No at-risk files, or `confirm: true`. Side effect: pod pushes delta; `lastSyncAt` persisted on `sync_done`. |
| 200 | `{ "agentOnline": false }` | Agent socket not connected (unchanged behavior; no conflict check needed). |
| 409 | `{ "requiresConfirmation": true, "atRisk": [{ "path": "SOUL.md", "updatedAt": "2026-08-31T12:00:00Z" }], "baseline": "2026-08-31T09:15:00Z" }` | `baseline` exists, at-risk list non-empty, `confirm` not set. **No sync performed, no side effects.** |

Rules:
- At-risk = S3 objects with `LastModified > baseline` (see [data-model.md](../data-model.md)).
- No baseline (both markers null) → skip check, behave as today.
- `confirm: true` bypasses the check entirely (list is NOT recomputed — operator accepted the risk shown).

## GET /agents/:agentId (changed)

Agent DTO gains nullable fields:

```json
{ "lastPullAt": "2026-08-31T09:15:00Z", "lastSyncAt": null }
```

## Unchanged endpoints (relied upon)

- `GET /agents/:agentId/files` — list; each node already carries `updatedAt` (S3 LastModified). UI starts displaying it.
- `PUT /agents/:agentId/files/content`, rancher `write_agent_file` — still write straight to S3; their writes are what makes S3 objects "newer than baseline".

## UI contract (admin Files tab)

- Agent `status === 'running'` → hint banner: shared copy is displayed; the running agent may hold newer content; Sync brings it in. Shows `lastPullAt`/`lastSyncAt` when present. English only.
- Sync click → `fileControllerSync({})`; on 409 → `useConfirmStore().ask()` listing `atRisk` paths + timestamps; confirm → `fileControllerSync({ confirm: true })`; cancel → no call.
- Stopped agent → no banner, no conflict flow (server returns no 409 anyway — markers reset relevance at next boot).

## Rancher contract (P3)

- `rancher/.agent/SOUL.md`: honesty constraints — never claim create-agent / knowledge-binding ability; state limitation + manual path (until CLEAN-51 lands).
- `write_agent_file` tool result text: append "Restart required for the change to take effect — offer restart_agent." (description already says it; result must too).
