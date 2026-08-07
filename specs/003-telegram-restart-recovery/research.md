# Root-Cause Investigation: Telegram Channel Dead After Agent Restart

**Date**: 2026-08-07
**Symptom**: After an agent restart, `channel_list` / admin UI show the Telegram channel as `source: file, connected: false`; polling never starts. Bridle recovers; env-injected Telegram recovers; only file-sourced (chat-configured) Telegram dies.

## Verdict on the original hypothesis

> "runtime не вызывает channel_telegram_set при старте, если конфиг уже существует в файле"

Close, but not exact. The runtime **does** have a boot path that starts file-configured channels (`ChannelModule.resolveBootConfigs`). The defect is **ordering**: it reads the file from local disk **before** the S3 pull restores that file, so on a fresh container filesystem the config is invisible at the only moment it matters.

## Bug 1 (primary, `runtime` repo): boot-order race between channel resolution and S3 pull

Boot sequence:

1. `runtime/src/index.ts:198` — `channels: await ChannelModule.resolveBootConfigs(".agent")` runs **while constructing** `AgentRuntime`, i.e. before `runtime.start()`. It reads `.agent/data/channels/telegram.json` from **local disk** (`runtime/src/slices/setup/channel/channel.module.ts:68-102`): file wins, `process.env.TELEGRAM_BOT_TOKEN` is the fallback, Bridle is env-only.
2. `runtime.start()` → `restoreState()` → `s3sync.pull()` (`runtime/src/slices/runtime/runtime/runtime.module.ts:268`) — **this** is what brings `data/channels/telegram.json` back from S3.
3. `connectChannels()` → `this.channel.start()` (`runtime.module.ts:308`) — starts only the channels resolved in step 1.

A restarted container (both in-place `restartPolicy: Always` restarts and fresh pod deploys — there is no volume for `.agent/`) starts with an empty local filesystem. At step 1 `telegram.json` does not exist locally yet and no `TELEGRAM_BOT_TOKEN` env is set (chat-configured bots never get env vars) → no Telegram config → polling never starts. By the time anyone runs `channel_list`, step 2 has pulled the file to disk, so `listInfo()` (`channel.module.ts:243-267`) reports `source: file` with `connected: liveNames.has("telegram")` → `false`. Exactly the observed state.

Why the siblings survive:

- **Bridle**: env-only (`BRIDLE_URL`, `channel.module.ts:97-99`), injected on every pod submit → always resolved at step 1.
- **Admin-panel-configured Telegram**: Ranch injects `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_NAME` / `TELEGRAM_BOT_ADMIN_IDS` into the pod env at submit time (`ranch/api/src/slices/workflow/data/agent-workflow.manifest.ts:182-184`) → env fallback saves it.

## Bug 2 (secondary, `ranch` repo): channel file path drift between platform and runtime

- Ranch API reads/writes the **legacy flat file** `data/channels.json` (`ranch/api/src/slices/agent/agentChannel/data/agentChannel.gateway.ts:10`), and the deploy pipeline sources Telegram env injection from it (`ranch/api/src/slices/workflow/data/argo-workflow.gateway.ts:201,230`).
- The runtime moved to per-channel files `data/channels/telegram.json` and **migrates + deletes** the legacy file on boot (`runtime/src/slices/setup/channel/data/channelFiles.ts:68-105`).

Consequences (verified 2026-08-07 during clarify):

- A bot configured via `channel_telegram_set` (chat) is invisible to `GET /agents/:id/channels` → the admin panel Channels tab (`admin/slices/agent/agentChannel/data/agentChannel.gateway.ts:17` → `getAgentChannels`) shows **nothing** even though the bot exists → deploy-time env injection has no token → no env fallback for Bug 1 to fall back on. Panel-configured bots ARE visible (panel writes and reads the same legacy file).
- **Stale mixed-history hazard**: if a bot was configured via the panel and later replaced via chat, the legacy file keeps the old token forever — the admin tab displays it and the next deploy injects it as env. Because of Bug 1 (boot resolution before S3 pull), the restarted channel actually **starts with the stale token**.
- The "migration deletes the legacy file from S3" risk is theoretical in the k8s flow: `migrateLegacyChannelFiles` runs inside `resolveBootConfigs` on a fresh container filesystem **before** the S3 pull, so it never sees the legacy file (effectively inert), and the S3 sync never propagates that unlink anyway — it only deletes keys present in its in-memory manifest, i.e. ones it wrote/pulled this process lifetime (`runtime/src/slices/bot/sync/data/s3-sync.gateway.ts:190-203`). Net effect: the legacy `data/channels.json` in S3 **never dies and silently goes stale**.
- The comment in `agentChannel.gateway.ts` ("Keep this string in sync") documents an intent that has already drifted.

## Decisions from clarify session 2026-08-07

- **Single source of truth (FR-004)**: the runtime's per-channel files (`data/channels/telegram.json`). Ranch's `AgentChannelGateway` and the env-injection read in `argo-workflow.gateway.ts` move to that path with a **read-only fallback** to legacy `data/channels.json` for agents configured before the change — no destructive data migration. Stale legacy config must never override a newer per-channel one.
- **Status surfacing (FR-003/FR-005)**: live connected/disconnected + failure reason must be visible in BOTH the `channel_list` chat tool and the admin panel Channels tab. Requires propagating live status from the runtime to the platform (mechanism — bridle event, status file in S3, or polling — is a plan-level choice; note `connected` today is derived from live channel names only and failure reasons stop at logs, `channel.service.ts:26-30`).

## Phase 0 design decisions (/speckit-plan, 2026-08-07)

### D1. Boot-order fix: reconcile-after-pull (runtime)

- **Decision**: Keep `AgentRuntime`'s constructor contract (accepts pre-resolved `channels` configs — used by `multi.ts`, paddock mock runs). Add `ChannelModule.reconcileFromDisk()`; `RuntimeModule.connectChannels()` awaits it **first**, i.e. after `restoreState()`'s S3 pull and before `service.start()`. Reconcile re-runs `resolveBootConfigs(agentDir)` and diffs against registered gateways: registers missing channel types, replaces a gateway whose token differs from the file (file wins), applies env mirroring. `ChannelService.start()`'s per-channel `allSettled` isolation stays (bad token ≠ dead agent, FR-005).
- **Rationale**: Minimal surface change; the pre-pull resolution in `index.ts:198` keeps working for env/standalone cases, and the post-pull reconcile closes exactly the gap (file exists only in S3 at construction time). No changes to mock/test wiring.
- **Alternatives considered**: (a) Move `resolveBootConfigs` inside `runtime.start()` — breaks the constructor API for `multi.ts`/paddock and reorders init broadly; (b) heartbeat self-check — leaves a dead-channel window and treats the symptom.

### D2. Removal tombstone (FR-006)

- **Decision**: `removeChannel` writes a tombstone `{ "removed": true }` to `data/channels/<type>.json` instead of deleting the file. `resolveBootConfigs` / reconcile: file with `removed: true` (or a file present without credentials) means "explicitly off — do NOT fall back to env". No file at all keeps today's env fallback (standalone usage). Ranch treats a tombstone as "channel absent" and injects no env for it.
- **Rationale**: After a removal, the pod's env still carries `TELEGRAM_BOT_TOKEN` until the next redeploy; with a deleted file, a restart would resurrect the channel from env, violating FR-006. The tombstone also preserves the intentional "group registry dies with the channel" semantic.
- **Alternatives considered**: deleting env keys at runtime (helps only the current process); relying on next redeploy (leaves a resurrection window).

### D3. Status surfacing: status file in agent state (FR-003/FR-005)

- **Decision**: Runtime writes `data/channels/status.json` — `{ [type]: { connected, error?, updatedAt } }` — on every channel start success/failure, stop, replace, and removal (capture the per-channel `allSettled` rejection reason that today stops at logs, `channel.service.ts:26-30`). The file rides the existing S3 watcher push (default debounce 30s). Ranch `GET /agents/:id/channels` merges it into the response; the admin Channels tab renders a connected/disconnected badge + reason; `channel_list` keeps its live in-process view.
- **Rationale**: Zero new transport — reuses the S3 sync and the platform's existing per-agent file gateway; works for agents without bridle; 30s debounce satisfies SC-002 (≤1 min).
- **Alternatives considered**: bridle hub event (new hub+API schema, misses bridle-less agents); API→pod HTTP polling (cross-namespace networking, auth, reconciler coupling).

### D4. Platform converges on per-channel files (FR-004)

- **Decision**: Ranch `AgentChannelGateway` reads `data/channels/telegram.json` (per-channel layout), falling back **read-only** to legacy `data/channels.json` when the per-channel file is absent. `PUT /agents/:id/channels` writes per-channel files with read-modify-write that preserves `groups` (mirror of the runtime's `updateTelegramFile`); channels omitted from the exhaustive PUT list get tombstones. The legacy file is never written again and never deleted (harmless; fallback only). Env injection (`argo-workflow.gateway.ts`) keeps sourcing from `channelGateway.getForAgent` and thus converges automatically; tombstoned channels inject nothing. Env injection itself stays — it is the resilience path when the S3 pull fails at boot.
- **Rationale**: Runtime already owns the per-channel layout and mutates it via tools; moving the two platform read/write sites is the smallest convergence. Read-only fallback covers pre-existing agents with no destructive migration (clarify decision).
- **Alternatives considered**: dual-write in runtime (two files forever, new drift risk); new runtime→platform API contract (largest change, deferred).

### D5. Copy & docs that must change with D4 (explicitly requested)

- Admin Channels tab description (`admin/slices/agent/agentChannel/components/agentChannel/Provider.vue:197-202`) still says "Stored as `data/channels.json` in S3 … Restart the agent to apply changes". Must become: per-channel `data/channels/<type>.json`, live status shown, restart applies panel-side edits (env re-injection), agent-side edits apply immediately.
- `api/src/slices/agent/agentChannel/agentChannel.controller.ts:25,37` `@ApiOperation` summaries and `api/.../domain/agentChannel.types.ts` comments still document the legacy path — update alongside `CHANNELS_PATH`.
- Panel↔runtime concurrent writes stay last-write-wins on the same file (already the documented semantic).

### D6. Testing & verification

- Runtime (`bun test`): tombstone resolution, reconcile-after-pull (file lands → channel registered), status file writes on success/failure/remove.
- Ranch API (Jest, `api`): gateway new-path read, legacy fallback, status merge, PUT tombstone semantics, env injection excludes tombstones.
- SDK regen after API DTO change: `admin`/`app` `bun run build:api` (hey-api openapi-ts; API swagger must be up — `scripts/wait-for-swagger.mjs`).

## Notes

- `restartPolicy: Always` + the startup probe on port 3000 (`agent-workflow.manifest.ts:218,258`) means every self-restart hits this path — the runtime restarts itself by clean exit after channel edits, which is why the bug is so visible.
- Status accuracy requirement (FR-003): `connected` is currently derived from live channel names only; a failure reason is logged but not surfaced (`channel.service.ts:26-30`).
