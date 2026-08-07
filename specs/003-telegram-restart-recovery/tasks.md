# Tasks: Telegram Channel Auto-Recovery After Agent Restart

**Input**: Design documents from `/specs/003-telegram-restart-recovery/`

**Prerequisites**: plan.md, spec.md, research.md (decisions D1–D6), data-model.md, contracts/, quickstart.md

**Tests**: Included — research.md D6 explicitly defines the required test coverage; both repos colocate `*.spec.ts` tests.

**Organization**: Cross-repo. `RT:` = runtime repo (`/Users/maksymtmk/my-knowledge/runtime`), `RANCH:` = this repo. Paths are repo-relative after the prefix.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = bot survives restart (P1), US2 = truthful status (P2), US3 = one config every surface (P3)

## Phase 1: Setup

**Purpose**: Branches and green baselines in both repos

- [x] T001 Create branch `fix/telegram-restart-recovery` in the runtime repo (`git -C /Users/maksymtmk/my-knowledge/runtime checkout -b fix/telegram-restart-recovery`); ranch branch already exists
- [x] T002 [P] Baseline: `cd /Users/maksymtmk/my-knowledge/runtime && bun test` passes before changes
- [x] T003 [P] Baseline: `cd /Users/maksymtmk/my-knowledge/ranch/api && bun run test` passes before changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: File-schema groundwork both US1 (tombstone) and US2 (status) build on — see [data-model.md](data-model.md)

- [x] T004 [P] RT: Add `removed?: boolean` to `ITelegramFile` in `src/slices/setup/channel/data/repositories/telegram/telegramFile.ts` and to `ISlackFile` in `src/slices/setup/channel/data/repositories/slack/slackFile.ts`; setting credentials clears `removed` (invariant from data-model.md)
- [x] T005 [P] RT: Add channel status file support in `src/slices/setup/channel/data/channelFiles.ts` — `IChannelStatusEntry {connected, error?, updatedAt}`, `loadChannelStatus(agentDir)`, `updateChannelStatus(agentDir, type, entry)` (read-modify-write, path `data/channels/status.json`), plus unit tests in `src/slices/setup/channel/data/channelFiles.spec.ts`

**Checkpoint**: Schema helpers exist and are tested — user stories can begin

---

## Phase 3: User Story 1 - Bot survives agent restart (Priority: P1) 🎯 MVP

**Goal**: Chat-configured Telegram bot resumes polling automatically after any restart (fixes the boot-order race, research.md Bug 1 + D1/D2); explicit removals stay removed (FR-006)

**Independent Test**: quickstart.md scenarios 1 & 4 — configure bot via `channel_telegram_set`, delete the pod, bot answers within 2 min of ready; remove channel, restart, channel stays off

### Tests for User Story 1

- [x] T006 [P] [US1] RT: Write failing tests in new `src/slices/setup/channel/channel.module.spec.ts`: (a) `resolveBootConfigs` — file with credentials wins over env; tombstone/credential-less file suppresses env fallback; no file keeps env fallback; (b) `reconcileFromDisk` — config file appearing after construction registers the channel; token change replaces the gateway; tombstone deregisters; mock-only setups untouched

### Implementation for User Story 1

- [x] T007 [US1] RT: Tombstone handling in `resolveBootConfigs` in `src/slices/setup/channel/channel.module.ts` — a per-channel file that exists but has `removed: true` or no credentials yields NO config for that type and blocks the env fallback (contract invariant 2/3)
- [x] T008 [US1] RT: Implement `ChannelModule.reconcileFromDisk()` in `src/slices/setup/channel/channel.module.ts` per D1 — re-run `resolveBootConfigs(agentDir)`, diff against `service.listNames()`: register missing gateways (via `service.add`, NOT `addAndStart` — start happens once in `service.start()`), replace gateway on token mismatch (file wins), honor tombstones via `service.removeAndStop`, re-apply `applyTelegramToEnv`
- [x] T009 [US1] RT: Change `removeChannel` in `src/slices/setup/channel/channel.module.ts` to write the tombstone (`{removed: true}`, dropping credentials and `groups`) instead of `deleteTelegramFile`/`deleteSlackFile`; keep `service.removeAndStop`; ensure `setTelegram`/`setSlack` clear `removed` when saving credentials
- [x] T010 [US1] RT: Wire the ordering fix in `src/slices/runtime/runtime/runtime.module.ts` — `connectChannels()` awaits `this.channel.reconcileFromDisk()` before `this.channel.start()` (i.e. after `restoreState()`'s S3 pull); a reconcile failure logs and degrades, never crashes boot (contract invariant 5)
- [ ] T011 [US1] RT: Run `bun test`; then execute quickstart.md E2E scenarios 1 (restart recovery) and 4 (removal sticks) against a deployed agent

**Checkpoint**: The reported bug is fixed — chat-configured bots survive restarts even before any ranch changes ship

---

## Phase 4: User Story 2 - Channel status tells the truth (Priority: P2)

**Goal**: Live connected/disconnected + failure reason visible in both `channel_list` (chat) and the admin Channels tab (D3, FR-003/FR-005)

**Independent Test**: quickstart.md scenario 2 — healthy restart shows connected; revoked-token restart shows disconnected + reason in tab and `GET /agents/:id/channels` within 1 min of ready, agent keeps running

### Tests for User Story 2

- [x] T012 [P] [US2] RT: Extend `src/slices/setup/channel/domain/channel.service.spec.ts` — `start()` returns per-channel outcomes (`{name, ok, error?}`) instead of swallowing rejections into logs only
- [x] T013 [P] [US2] RANCH: Write failing Jest tests in `api/src/slices/agent/agentChannel/data/agentChannel.gateway.spec.ts` — GET merges `data/channels/status.json` by type (`connected`, `statusReason`, `statusUpdatedAt`); missing status file/key ⇒ `connected: null` (unknown, per contract invariant 4)

### Implementation for User Story 2

- [x] T014 [US2] RT: Return per-channel start results from `ChannelService.start()` in `src/slices/setup/channel/domain/channel.service.ts` (keep `allSettled` isolation and logging)
- [x] T015 [US2] RT: Write status entries from `src/slices/setup/channel/channel.module.ts` using T005 helpers — on `start()` results, `addAndStart` success, `setTelegram`/`setSlack` success and rollback, `removeChannel` (drop/mark entry), capturing rejection message as `error`
- [x] T016 [US2] RANCH: Extend `AgentChannelDto` with `connected: boolean | null`, `statusReason: string | null`, `statusUpdatedAt: number | null` in `api/src/slices/agent/agentChannel/dtos/` and map them in `api/src/slices/agent/agentChannel/data/agentChannel.mapper.ts` (shape: [contracts/agent-channels-api.md](contracts/agent-channels-api.md))
- [x] T017 [US2] RANCH: Merge status into `getForAgent` in `api/src/slices/agent/agentChannel/data/agentChannel.gateway.ts` — read `data/channels/status.json` via `IFileGateway`, tolerate absence (T013 green)
- [x] T018 [US2] RANCH: Regenerate SDK clients — `cd admin && bun run build:api` and `cd app && bun run build:api` (API swagger must be running); commit `slices/setup/api/data/repositories/api/*.gen.ts` in both
- [x] T019 [US2] RANCH: Render status badge in `admin/slices/agent/agentChannel/components/agentChannel/Provider.vue` + `admin/slices/agent/agentChannel/domain/agentChannel.types.ts` + `data/agentChannel.mapper.ts` — connected (green) / disconnected with reason (destructive) / unknown (muted)
- [ ] T020 [US2] RANCH+RT: Run both suites (`bun test`, `api bun run test`); execute quickstart.md E2E scenario 2 (healthy + revoked token)

**Checkpoint**: Silent channel death is now visible everywhere an operator looks

---

## Phase 5: User Story 3 - One configuration, every surface (Priority: P3)

**Goal**: Platform converges on per-channel files with read-only legacy fallback (D4, FR-004) — chat-configured bots appear in the admin tab and survive platform redeploys; stale mixed-history configs never resurface; user-flagged UI copy fixed (D5)

**Independent Test**: quickstart.md scenarios 3 & 5 — chat-configured bot listed in tab and survives panel redeploy; legacy-only agent still listed via fallback; mixed history serves the newer token

### Tests for User Story 3

- [x] T021 [P] [US3] RANCH: Extend `api/src/slices/agent/agentChannel/data/agentChannel.gateway.spec.ts` with failing tests — GET reads `data/channels/telegram.json` first, falls back to legacy `data/channels.json` only when per-channel file absent, omits tombstoned; PUT writes per-channel files preserving `groups`, tombstones omitted types, clears `removed` on set, never writes legacy

### Implementation for User Story 3

- [x] T022 [US3] RANCH: Converge `api/src/slices/agent/agentChannel/data/agentChannel.gateway.ts` + `data/agentChannel.mapper.ts` + `domain/agentChannel.types.ts` on per-channel paths per [contracts/channel-files.md](contracts/channel-files.md) — replace `CHANNELS_PATH` with per-channel paths + frozen legacy fallback constant; RMW preserving runtime-owned fields; add `removed` to file types; update stale comments ("single source of truth" path references)
- [x] T023 [US3] RANCH: Verify env injection excludes tombstoned/fallback-correct configs — `api/src/slices/workflow/data/argo-workflow.gateway.ts` consumes `channelGateway.getForAgent` (tombstoned channels already omitted by T022); add a Jest case in `api/src/slices/workflow/` covering "tombstoned telegram ⇒ no TELEGRAM_* env entries" via `buildAgentEnv`
- [x] T024 [P] [US3] RANCH: Update `@ApiOperation` summaries in `api/src/slices/agent/agentChannel/agentChannel.controller.ts:25,37` — per-channel storage path, fallback note, accurate restart semantics (panel edits need restart for env re-injection; chat edits apply live)
- [x] T025 [P] [US3] RANCH: Fix the user-flagged Channels card copy in `admin/slices/agent/agentChannel/components/agentChannel/Provider.vue:197-202` — stored as per-channel `data/channels/<type>.json` in S3; agent-side (chat) changes apply immediately; panel-side changes take effect after agent restart
- [ ] T026 [US3] RANCH: Re-run SDK regen (`admin`/`app` `bun run build:api`) picking up controller doc changes; run `api` Jest + `npx tsc --noEmit -p api/tsconfig.json`; execute quickstart.md E2E scenarios 3 & 5

**Checkpoint**: All three stories independently verified; both config surfaces converged

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T027 [P] Sweep both repos for stale `data/channels.json` references (`grep -rn "data/channels.json" api admin app` in ranch, `src docs` in runtime) — update comments/docs that contradict the new contract (excluding the intentional frozen-fallback constant)
- [ ] T028 Run the full [quickstart.md](quickstart.md) validation (all 5 scenarios) on a staging agent; record results in the PR descriptions
- [ ] T029 Ship per rollout order — runtime image release first, then ranch `v*` tag release (memory: a version colliding with an existing tag silently skips the release); confirm an existing broken agent heals on its next restart (SC-003)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → user stories.
- **US1 (Phase 3)**: needs T004 (tombstone field). Purely runtime — independently shippable (the core bugfix).
- **US2 (Phase 4)**: needs T005 (status helpers); T014–T015 (runtime) are independent of US1's T007–T010 but share `channel.module.ts` — coordinate or do sequentially. Ranch side (T016–T019) independent of US1.
- **US3 (Phase 5)**: ranch-only; shares `agentChannel.gateway.ts`/`mapper`/`Provider.vue` with US2 — run after US2's ranch tasks (or merge carefully). Does NOT depend on US1 to be testable via fallback path, but full scenario 3 needs US1 shipped in the runtime image.
- **Phase 6**: after all desired stories.

### Parallel Opportunities

- T002 ∥ T003 (different repos); T004 ∥ T005 (different files).
- Within US1: T006 first (TDD), then T007→T008→T009 (same file, sequential), T010 parallel-safe after T008.
- US1 (runtime `channel.module.ts`) ∥ US2-ranch (T013, T016–T019) — different repos.
- T024 ∥ T025 (different files, both after T022 conceptually but textually independent).
- Two-person split: dev A = runtime (US1 → US2-runtime), dev B = ranch (US2-ranch → US3).

## Status (2026-08-07, /speckit-implement)

All code + unit-test tasks are done and green: runtime `bun test` 85 pass, ranch api Jest 132 pass, `tsc --noEmit` clean in both, SDK clients regenerated offline (swagger built from dist). Runtime work sits uncommitted on `fix/telegram-restart-recovery` in the runtime repo; ranch work on this repo's branch.

Left unchecked because they need a deployed agent / releases (cannot run from this workstation — prod k8s is CI-only):

- T011 / T020 / T026 — their `bun test`/Jest portions are done; the quickstart E2E scenarios (1–5) remain to be run against a staging agent.
- T028 — full quickstart validation on staging.
- T029 — rollout: runtime image release first, then ranch `v*` tag.

## Implementation Strategy

**MVP = Phase 1 + 2 + US1** (T001–T011): fixes the reported outage with zero platform changes — ship the runtime image alone and chat-configured bots survive restarts. Then US2 (visibility), then US3 (convergence + the user-flagged copy). Each checkpoint is independently deployable; commit after each task or logical group.
