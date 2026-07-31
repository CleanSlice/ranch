# Tasks: Stabilize Agent Startup Status & Logs

**Input**: Design documents from `/specs/001-stabilize-agent-startup/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/agent-api.md](./contracts/agent-api.md), [quickstart.md](./quickstart.md)

**Tests**: Not explicitly requested in the spec — no dedicated test-first tasks. Each story ends with a quickstart validation task; the api Jest suite and `tsc` checks run in Polish.

**Organization**: Tasks are grouped by user story. US1 and US2 share files (`agentDeploy.service.ts`, overlay components) and run sequentially; US3 and US4 are independent and can run in parallel with anything after Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4, mapping to spec.md user stories

## Phase 1: Setup

**Purpose**: Green baseline before touching lifecycle code

- [x] T001 Verify toolchain and baseline: `bun install` at repo root; `cd api && bun run test` passes; api starts and serves swagger (`bun run dev` → `scripts/wait-for-swagger.mjs` succeeds); note current behaviour of `GET /agents/:id` during a deploy for later comparison

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, types, and DTO/SDK surface that every story (except US3) builds on

**⚠️ CRITICAL**: Complete before starting US1/US2/US4 (US3 does not depend on this phase)

- [x] T002 Add nullable columns `firstDeployedAt DateTime?`, `lastDeployStartedAt DateTime?`, `lastLaunchContext String?`, `statusReason String?` to the Agent model in api/src/slices/agent/agent/agent.prisma per [data-model.md](./data-model.md)
- [x] T003 Regenerate composed schema and create the additive migration: `cd api && bun run generate && bun run migrate` (migration must apply cleanly to an existing dev DB; verify no destructive statements in api/prisma/migrations/)
- [x] T004 [P] Add `LaunchContext = 'initial' | 'restart'` type and extend agent domain types in api/src/slices/agent/agent/domain/agent.types.ts
- [x] T005 Extend `AgentGateway.updateStatus()` in api/src/slices/agent/agent/data/agent.gateway.ts to atomically accept `statusReason` (null = clear) and add write helpers for `firstDeployedAt`/`lastDeployStartedAt`/`lastLaunchContext`; keep it the single status writer
- [x] T006 Expose `launchContext`, `statusReason`, `firstDeployedAt` on agent responses (swagger-annotated DTO for `GET /agents`, `GET /agents/:id`, and the agent embedded in `AgentStatusDto`) in api/src/slices/agent/agent/dtos/ and api/src/slices/agent/agent/agent.controller.ts per [contracts/agent-api.md](./contracts/agent-api.md) §1
- [x] T007 Regenerate the admin SDK: `cd admin && bun run build:api`; verify the three new fields appear typed in admin/slices/setup/api/data/repositories/api/types.gen.ts
- [x] T008 Map the new fields into the admin domain: extend `IAgentData` in admin/slices/agent/agent/domain/agent.types.ts and fill them in admin/slices/agent/agent/data/agent.mapper.ts (unknown `launchContext` strings coerce to null)

**Checkpoint**: API serves the new fields end-to-end; UI has them typed and mapped

---

## Phase 3: User Story 1 — Status never lies during start/restart (Priority: P1) 🎯 MVP

**Goal**: Stop → start and restart never show a transient `failed`; `running` appears ≤ 10 s after readiness; genuine failures still surface within 60 s, now with a reason

**Independent Test**: quickstart S1 (stop→start & restart status sequences, page-reload check), S4 (genuine failure + reason), S5 (5-minute timeout)

### Implementation for User Story 1

- [x] T009 [US1] In `deploy()` (api/src/slices/agent/agent/domain/agentDeploy.service.ts): write `lastDeployStartedAt = now` together with the `deploying` status write; clear `statusReason`; set `statusReason` on the template-missing and submit-throw `failed` paths (per [data-model.md](./data-model.md) definitive-failure table)
- [x] T010 [US1] In api/src/slices/agent/agent/domain/agentStatus.service.ts: (a) drift no-pod branch skips agents with `now − lastDeployStartedAt ≤ 5 min`; (b) on expiry marks `failed` with `statusReason` "startup did not produce a running agent within 5 minutes"; (c) pod-event reconciler failure writes set `statusReason` from waiting reason / termination message; (d) transitions to `running` clear `statusReason`
- [x] T011 [US1] In `restartAgent()` (api/src/slices/agent/agent/domain/agentDeploy.service.ts): clear `workflowId` (null) BEFORE `cancelAgentWorkflow`, so no reader can resolve the doomed workflow (contracts §2 restart guarantee)
- [x] T012 [US1] In `syncStatus` (api/src/slices/agent/agent/agent.controller.ts): with T011 in place the referenced workflow can only ever be the CURRENT one (restart detaches the old id before cancelling; stop clears it), so its `Failed`/`Error` phase is a definitive signal — write `failed` immediately WITH a `statusReason`, no time-based guard (narrowed from the original blanket grace-window formulation per analysis finding I1, which would have delayed real workflow-level failures and violated SC-006); additionally skip the write while the runtime is live on the bridle hub (bridle-truth wins — found in live testing: a lying/stale workflow record ping-ponged a healthy agent between `failed` and `running`), and MockWorkflowGateway.getStatus now throws for unknown workflows instead of fabricating phase `Failed` (in-memory store resets on every dev API restart); keep existing `stopped` early-return
- [x] T013 [US1] Fix `restart_agent` in api/src/slices/rancher/rancher.tool.ts to invoke the real `restartAgent()` flow instead of a bare `deploying` status write
- [x] T014 [US1] In admin/slices/agent/agent/composables/useAgentLifecycle.ts: skip poll ticks while a lifecycle mutation request is in flight (restart/start/stop awaiting HTTP response), so a stale pre-restart status can't overwrite the optimistic `deploying`
- [x] T015 [US1] Surface `statusReason` in the admin failed states: failed chat overlay detail in useAgentLifecycle.ts `chatOverlay` + admin/slices/agent/agent/components/agent/chat/Tab.vue, and as tooltip/subtext on the status badge via admin/slices/agent/agent/utils/agentFormat.ts and components that render it
- [ ] T016 [US1] Validate per specs/001-stabilize-agent-startup/quickstart.md S1, S4, S5 against the local k3d + Argo environment; record observed status sequences in the PR description

**Checkpoint**: SC-001/SC-002/SC-006 verifiable; badge never flashes `failed` during a healthy launch

---

## Phase 4: User Story 2 — First start, restart, and update are distinguishable (Priority: P2)

**Goal**: Server-provided `launchContext` drives visibly different first-start vs restart messaging; survives page reload

**Independent Test**: quickstart S3 (fresh agent shows first-start wording and `launchContext: "initial"`; subsequent restart shows restart wording and `"restart"`)

### Implementation for User Story 2

- [x] T017 [US2] In `deploy()` (api/src/slices/agent/agent/domain/agentDeploy.service.ts): compute `lastLaunchContext` = `'initial'` iff `firstDeployedAt` is null at call time else `'restart'`, persist it with the `deploying` write; set `firstDeployedAt = now` once, immediately after the first successful workflow submit (depends on T009 — same file)
- [x] T018 [US2] Drive the chat overlay copy from `launchContext` in admin/slices/agent/agent/composables/useAgentLifecycle.ts (`chatOverlay`): first start → "Setting up the agent…"-style title/detail; restart → existing "Restarting…" wording; never show "Cancelling old workflow…" for `initial` (depends on T014/T015 — same file)
- [x] T019 [US2] Pass launch context into the logs panel and switch its placeholder copy in admin/slices/agent/agent/components/agent/chat/Tab.vue and admin/slices/agent/agent/components/agent/logs/Panel.vue (first start vs "Agent is restarting — logs will resume…")
- [ ] T020 [US2] Validate per specs/001-stabilize-agent-startup/quickstart.md S3 including the reload check (FR-005) and SC-003 (distinguishable from status display alone)

**Checkpoint**: US1 + US2 shippable together; first launch no longer looks like an update

---

## Phase 5: User Story 3 — Log panel stays friendly while the agent comes up (Priority: P2)

**Goal**: The friendly `[container …]` marker actually fires; raw multi-line k8s error dumps never reach the UI

**Independent Test**: quickstart S2 (restart with log panel open; `curl` logs endpoint during ContainerCreating returns `[container containercreating]`)

**Note**: Independent of Phase 2 — can start any time after Setup, in parallel with US1/US2

### Implementation for User Story 3

- [x] T021 [P] [US3] In api/src/slices/log/log.controller.ts: normalize `ApiException.body` (JSON.parse when string, try/catch) in `extractWaitingReason` and `extractKubeError`; also match the waiting-reason regex against `e.message` as fallback; ensure `[log fetch failed: …]` payload is a single parsed line (contracts §3)
- [x] T022 [P] [US3] Apply the same string-body normalization to `extractKubeError` in api/src/slices/agent/agent/data/pod.gateway.ts (server-log noise reduction, same error shape)
- [ ] T023 [US3] Validate per specs/001-stabilize-agent-startup/quickstart.md S2: no raw `HTTP-Code: 400` text in the panel across a restart, spinner state shown, logs auto-resume (SC-004, FR-007)

**Checkpoint**: SC-004 verifiable independently of all other stories

---

## Phase 6: User Story 4 — A successful start shows no misleading errors (Priority: P3)

**Goal**: CleanSlice MCP connects (tools > 0) so the startup log has no connect-failure line; warn-level lines are not styled as errors

**Independent Test**: quickstart S6 (seeder heal + live `/mcp` probe) and the log assertions of S3 (N > 0 tools, no ERROR-styled lines on a clean start)

**Note**: Independent of US1–US3; T024–T025 touch disjoint files

### Implementation for User Story 4

- [x] T024 [P] [US4] In api/src/slices/mcpServer/domain/mcpServer.seeder.ts: change the default CleanSlice URL to `https://mcp.cleanslice.org/mcp` (env `CLEANSLICE_MCP_URL` still wins) and make the seeder idempotently converge an EXISTING built-in row's `url` to the configured value on every bootstrap (contracts §5)
- [x] T025 [P] [US4] In admin/slices/agent/agent/utils/agentLogs.ts: classify severity by the runtime's explicit level token when present, falling back to substring heuristics only without one — first verify the real pod-log line format, then adjust `ERROR_TOKEN_RE`/classifier so `"error":"Not Found"` inside a JSON body no longer styles a warn line as ERROR (FR-008)
- [ ] T026 [US4] Validate per specs/001-stabilize-agent-startup/quickstart.md S6 (row healed, probe returns 200, re-boot idempotent) and re-run S3's log assertions after a fresh agent deploy (SC-005, FR-012)

**Checkpoint**: A clean first launch shows zero error-level entries end-to-end

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T027 Run the full regression sweep per specs/001-stabilize-agent-startup/quickstart.md S7: rancher-tool restart, stop-while-deploying, rapid stop/start cycles, 20× S1 + S2 cycles for SC-001/SC-004 sign-off
- [x] T028 [P] Verify suites green: `cd api && bun run test`; type-check pure-TS admin changes with `tsc` (repo has no vue-tsc); `cd admin && bun run build` compiles
- [ ] T029 [P] Opportunistic cleanup (optional): replace the outdated raw-axios stop/start workaround in admin/slices/agent/agent/data/agent.gateway.ts with the now-existing generated SDK calls (`agentControllerStop`/`agentControllerStart`), noted in research.md cross-cutting notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup — blocks US1, US2, US4-validation; internal order T002 → T003 → T005 → T006 → T007 → T008, with T004 parallel after T002
- **US1 (Phase 3)**: after Phase 2
- **US2 (Phase 4)**: after US1 (T017 extends T009's code in agentDeploy.service.ts; T018 extends T014/T015's code in useAgentLifecycle.ts)
- **US3 (Phase 5)**: after Setup only — fully parallel with Phases 2–4
- **US4 (Phase 6)**: T024/T025 after Setup; T026 needs a deployable stack (and re-uses S3's assertions, so best after US2)
- **Polish (Phase 7)**: after all selected stories

### User Story Dependencies

- **US1 (P1)**: Foundational only — the MVP
- **US2 (P2)**: builds on US1's edits (same files); independently *testable* via S3 once merged
- **US3 (P2)**: no dependencies on other stories
- **US4 (P3)**: no code dependencies on other stories; final validation piggybacks on S3

### Parallel Opportunities

```bash
# After Setup, three tracks can run concurrently (different files):
Track A (api lifecycle):  T002→T003→…→T008 then T009–T016 then T017–T020
Track B (log handling):   T021, T022 in parallel, then T023
Track C (MCP + classifier): T024, T025 in parallel

# Within Phase 2: T004 alongside T003
# Within US3: T021 ∥ T022
# Within US4: T024 ∥ T025
# Polish: T028 ∥ T029
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 → Phase 2 → Phase 3 (T009–T016)
2. **STOP and VALIDATE**: quickstart S1/S4/S5 — the false-`failed` symptom is gone; real failures keep a reason
3. Ship (release goes out on the next `v*` tag)

### Incremental Delivery

1. + US3 (can even land before US1 — zero coupling): the raw 400 dump disappears
2. + US2: first start vs restart become distinguishable
3. + US4: clean first-launch log, MCP tools actually register
4. Polish: regression sweep + suites + optional gateway cleanup

Each story leaves all previous behaviour intact; no story changes the status vocabulary or breaks the SDK contract.

---

## Notes

- Code-review follow-ups (self-review of the working diff, implemented):
  - Stale-workflow race closed in the remaining admin paths (create-with-isAdmin, promote-admin, demote-admin): extracted `AgentDeployService.detachAndCancelWorkflow()` — detaches `workflowId` before cancelling — and reused it in `restartAgent` + all controller call sites (agent delete excluded: the row is gone before the cancel).
  - `statusReason` for workflow-submit failures is now the generic `workflow submit failed` (raw submit errors can leak internal detail on the public agent endpoints; the full message stays in the server log).
  - Backfill migration `20260730130000_backfill_first_deployed_at` sets `firstDeployedAt = updatedAt` for pre-existing non-`pending` agents, so legacy agents don't show the first-start copy on their next deploy.
- Prod-incident follow-up (2026-07-31, Jira Manager agent unreachable while its pod was Running+ready): the bridle hub's agent registry was keyed by agentId alone, so the OLD pod's socket disconnecting late (blackholed TCP detected via ping timeout AFTER the new pod registered) wiped the NEW registration — healthy runtime showed "Agent reconnecting…" forever, messages stopped routing. Fixed: registry stores the owning socketId (`registerAgent(agentId, socketId, send)`), `unregisterAgent` is a no-op for non-owner sockets, and every inbound agent WS event re-registers a live socket whose registration was wiped (api/src/slices/bridle/data/bridle.gateway.ts + handlers/bridleAgentWs.handler.ts). Mirrors the pair-keying the browser-client registry already had.
- Live-testing follow-ups (found during dev validation, implemented alongside US1):
  - Bridle-truth resurrect paths (drift sweep + `markRunningFromBridle`) now exempt `stopped` — the old runtime's WS lingers after stop (indefinitely on local dev) and the resurrect undid the operator's stop, then decayed to `failed` once the WS dropped. UI: the "Agent stopped" overlay now wins over the live-chat bypass (admin/.../useAgentLifecycle.ts).
  - Duplicate `GET /agents/:id` on page open removed: BridleProvider accepts `initial-debug-enabled` from the host instead of fetching the agent itself (admin/slices/bridle/components/bridle/Provider.vue + chat/Tab.vue).
- Total: **29 tasks** (Setup 1, Foundational 7, US1 8, US2 4, US3 3, US4 3, Polish 3)
- US1+US2 intentionally share files — do not parallelize those two stories across people
- Full lifecycle validation requires k3d + Argo (`infrastructure.workflow_provider = argo`); the mock provider hides the pod-less window
- Commit after each task or logical group; stop at any checkpoint to validate independently
