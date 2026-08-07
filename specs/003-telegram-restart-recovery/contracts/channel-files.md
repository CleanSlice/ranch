# Contract: Agent Channel Files (runtime ⇄ platform)

The real cross-system interface of this feature is a set of S3-synced files under `agents/{id}/data/`. Both codebases must honor this contract; schemas in [data-model.md](../data-model.md).

## Reader/writer matrix

| File | Runtime | Ranch API | Notes |
|------|---------|-----------|-------|
| `data/channels/telegram.json` | R/W (tools, group tracker, boot+reconcile) | R/W (`GET`/`PUT /agents/:id/channels`, env injection read) | Source of truth. Read-modify-write; preserve fields you don't own (`groups`). |
| `data/channels/slack.json` | R/W | R/W | Same semantics. |
| `data/channels/status.json` | **W only** | **R only** | Runtime-owned. Platform must never write it. |
| `data/channels.json` (legacy) | R once (local migration) | **R only, fallback** | Frozen: no new writes, no deletes, read only when per-channel file absent. |

## Invariants

1. **Per-channel file with credentials beats everything** (env vars, legacy file) for that channel type.
2. **Tombstone (`removed: true`) beats env fallback**: a restarted pod whose env still carries a token MUST NOT start the channel. Ranch MUST NOT inject env vars for a tombstoned channel.
3. **No file ⇒ env fallback allowed** (standalone/compose usage keeps working).
4. **Status is advisory, never config**: absence of `status.json` (or of a key in it) means "unknown", not "disconnected". Platform renders unknown distinctly.
5. **Boot ordering (runtime)**: channel set MUST be re-resolved from disk AFTER the S3 pull completes and BEFORE channels start (`reconcileFromDisk()` in `connectChannels()`); a failed pull degrades to pre-pull resolution (env / local state) — never to a crash.
6. **Concurrent writers**: last-write-wins per file is accepted; writers minimize the window by read-modify-write immediately before save.

## Runtime internal API (new/changed)

- `ChannelModule.reconcileFromDisk(): Promise<void>` — re-run `resolveBootConfigs(agentDir)`; register gateways for resolved types not yet registered; replace a registered gateway whose token differs from file config; honor tombstones (deregister/skip). Called before `ChannelService.start()`.
- `ChannelModule.removeChannel(type)` — writes tombstone instead of deleting the file.
- Status writer — invoked from start (`allSettled` results), `addAndStart`, `removeAndStop`, `setTelegram`/`setSlack` rollback paths; captures `connected`, `error` (start rejection message), `updatedAt`.
- `ChannelModule.listInfo()` — unchanged shape; `connected` continues to mean "live in this process".
