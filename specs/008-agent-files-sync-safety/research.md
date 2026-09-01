# Phase 0 Research: Agent Files — Visible Copy Model & Safe Sync

**Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

## R1. Verified Sync mechanics (runtime repo)

**Finding**: Sync pushes a *delta*, not all files. The runtime keeps an in-memory manifest `{mtimeMs, size}` per file, populated at boot-time pull; `pushIfChanged()` skips files whose local mtime+size are unchanged (`runtime/src/slices/bot/sync/data/s3-sync.gateway.ts:210-216`). An orphan sweep deletes S3 objects present in the manifest but missing locally, with a refuse-all-gone safeguard (`s3-sync.gateway.ts:275-295`). No S3 freshness check exists anywhere. Trigger: WebSocket `sync` event via bridle hub; pod replies `sync_done` with pushed count.

**Implication**: files edited only in S3 survive Sync untouched; files changed on *both* sides are silently overwritten; pod-side deletions remove fresh S3 edits.

## R2. Conflict-detection basis (Q2 decision: platform-recorded markers)

**Decision**: Two new Prisma fields on `Agent`: `lastPullAt` (set when the agent's bridle socket authenticates — the boot pull happens moments before connect) and `lastSyncAt` (set when `sync_done` is received in `bridle.gateway.ts:handleSyncResponse`, `bridle.gateway.ts:317-332`). Baseline for comparison: `max(lastSyncAt, lastPullAt - margin)`; S3 objects with `LastModified > baseline` are *at risk*. Margin (~60s) applies only to `lastPullAt` to cover the pull→connect window; no margin on `lastSyncAt` (sync's own S3 writes complete before `sync_done`, margin would flag every just-pushed file).

**Rationale**: no runtime-repo changes, no pod clock in the comparison (S3 `LastModified` = AWS clock, markers = API clock; NTP-level skew is acceptable for a warning). Changes stay in one repo/release.

**Alternatives considered**: pod-reported delta (exact, but needs runtime release + clock skew); content hashes (skew-immune, but requires storing a manifest snapshot server-side and runtime changes). Both rejected for v1 per Q2.

**Accepted limitation (spec adjusted)**: the API cannot know which files the pod actually changed, so the warning lists *at-risk* files ("S3 copy newer than what the pod holds — may be overwritten/removed if the pod also changed/deleted it"), including false positives for files edited only in S3. The P1 guarantee holds: nothing S3-newer is ever overwritten silently. Spec US1 scenario 4 updated accordingly.

## R3. Where to hook the guard (API)

**Decision**: keep a single endpoint. `POST /agents/:agentId/files/sync` (file.controller.ts:102-112) gains optional body `{ confirm?: boolean }`:
- compute at-risk list (S3 `ListObjectsV2` LastModified vs baseline — file.gateway.ts already exposes `updatedAt`);
- non-empty list + no `confirm` → **409** `{ requiresConfirmation: true, atRisk: [{path, updatedAt}], baseline }`, sync not executed;
- empty list or `confirm: true` → proceed as today, persist `lastSyncAt` on `sync_done`.

**Rationale**: check is computed at the moment of sync (freshest list); no second round-trip on the happy path (FR-004); UI flow maps 1:1 to `useConfirmStore().ask()`.

**Alternatives**: separate GET dry-run endpoint (extra round-trip, list can go stale between check and sync); rejected.

## R4. Surfacing markers for the Files tab hint (P2)

**Decision**: expose `lastPullAt` / `lastSyncAt` in the agent DTO (agent GET already feeds the workspace UI). Files tab hint for `status === 'running'` is static copy + the markers; per-file `updatedAt` is already returned by the list endpoint — display it.

## R5. Admin UI building blocks

- Confirmation modal: `useConfirmStore().ask()` (`admin/slices/common/stores/confirm.ts:15-44`), already used in `agentFile/Provider.vue:98-105` (discard) and `:195-201` (delete). Reuse for the 409 flow; file list goes into `description`.
- Sync trigger: `Provider.vue:63-90` → `agentFile.gateway.ts:76-80` → generated `FilesService.fileControllerSync`. 409 handling lands here.
- Admin is English-only (repo i18n policy) — no i18n work.

## R6. Rancher admin-agent constraints (Q1 decision: instructions only)

**Finding**: the admin agent's system prompt is `rancher/.agent/SOUL.md` (seeded by `rancher.service.ts` seed flow); toolset registered via `@Tool` decorators in `api/src/slices/rancher/rancher.tool.ts` (22 tools, no `create_agent`, no knowledge binding). `write_agent_file` tool description already says restart is required (`rancher.tool.ts:479`), but the *result* text does not remind the model to surface it.

**Decision** (refined during implementation, 2026-08-31):
1. Discovery: rancher's `http` tool + the documented endpoint table mean it CAN create agents (`POST /agents`) and bind knowledge (`PUT /agents/{id}` body `{knowledgeIds}` — UpdateAgentDto inherits it via PartialType). The gap was missing *recipes* and missing MCP shortcuts, which produced narration without calls. SOUL.md therefore got: exact http recipes ("Creating Agents & Binding Knowledge"), a hard "never narrate without the call" rule, and an "Agent Files: Two Copies" section. Declining would have contradicted SOUL.md hard rule #2 ("http is always available"). MCP shortcuts still arrive with CLEAN-51.
2. `write_agent_file` tool *result*: explicit "Restart required — offer restart_agent" notice (FR-009).

**Propagation (resolved)**: `syncTemplateIfChanged()` runs at API boot and reseeds template files when the local source hash changes (rancher.service.ts:157-200); `restartAgent` resyncs template files into the agent's S3 prefix (agentDeploy.service.ts:39). Chain: deploy API → restart rancher agent → new SOUL.md live. No extra mechanism needed.

## R7. Persistence & tooling

- ORM: Prisma; Agent model at `api/src/slices/agent/agent/agent.prisma:8-44` (has `createdAt`, `updatedAt`, `firstDeployedAt`, `lastDeployStartedAt`, …). Schema change via `prisma migrate dev`.
- Status updates: `agent.gateway.ts:91-111` (`updateStatus`), driven by `agentStatus.service.ts` subscribing to bridle `agentEvents$` (`bridle.gateway.ts:75` emits `connected`) — `lastPullAt` hooks into the same path.
- Tests: api uses jest (`test: jest --passWithNoTests`); admin has no tests (manual validation via quickstart).
- OpenAPI: regenerate `api` swagger (`generate:swagger`) then `admin bun run build:api` (openapi-ts) after DTO changes.
