# Tasks: Agent Files — Visible Copy Model & Safe Sync

**Input**: Design documents from `/specs/008-agent-files-sync-safety/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sync-api.md, quickstart.md

**Tests**: unit tests for the guard logic are REQUIRED (quickstart.md "Unit tests" section); no other test tasks.

**Organization**: phases map 1:1 to Jira subtasks — US1=CLEAN-52 (P1), US2=CLEAN-53 (P2), US3=CLEAN-54 (P3). Parent CLEAN-50.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 per spec.md

## Phase 1: Setup

**Purpose**: schema groundwork every story reads from

- [X] T001 Add `lastPullAt DateTime?` and `lastSyncAt DateTime?` to the Agent model in api/src/slices/agent/agent/agent.prisma and create migration `agent-sync-markers` (`cd api && bun run prisma migrate dev --name agent-sync-markers` or repo's migrate script)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: markers must be persisted before any guard/UI can use them

**⚠️ CRITICAL**: blocks US1 and US2 (US3 is independent but sequenced last by priority)

- [X] T002 Add marker update methods (`setLastPullAt`, `setLastSyncAt`) to api/src/slices/agent/agent/data/agent.gateway.ts (near `updateStatus`, agent.gateway.ts:91-111)
- [X] T003 [P] Persist `lastPullAt` on agent socket connect: hook the `connected` event path in api/src/slices/agent/agent/domain/agentStatus.service.ts (consumer of `agentEvents$` from bridle.gateway.ts:75)
- [X] T004 [P] Persist `lastSyncAt` on `sync_done`: call the marker method from `handleSyncResponse` in api/src/slices/bridle/data/bridle.gateway.ts:317-332 (after `pendingSyncs.delete`, before resolve)

**Checkpoint**: restart a dev agent → `lastPullAt` set; trigger sync → `lastSyncAt` set (verify in DB)

> Implementation deviations: (T003) `lastPullAt` is set only on a genuine boot (status transition to running in `markRunningFromBridle` / drift resurrect with pod `startedAt`), NOT on every socket connect — a WS reconnect involves no pull, and advancing the baseline without a pull could hide conflicts. (T004) `lastSyncAt` is persisted in `file.controller.sync` after a successful (agentOnline) sync rather than inside `bridle.gateway.handleSyncResponse` — same moment semantically, avoids a new AgentGateway dependency/forwardRef inside the bridle slice.

---

## Phase 3: User Story 1 - Sync warns before destroying newer shared edits (Priority: P1) 🎯 MVP — CLEAN-52

**Goal**: no silent overwrite/removal of S3 files newer than the pod's last pull/push; warn-and-confirm flow; zero friction when nothing is at risk

**Independent Test**: quickstart E2E scenarios 1-2 + legacy check (edit file → Sync → dialog lists it → cancel keeps edit / confirm proceeds; no dialog when clean or after restart)

### Tests for User Story 1 (required by quickstart)

- [X] T005 [US1] Write failing jest specs for the guard in api/src/slices/agent/file/domain/syncGuard.service.spec.ts: baseline = max(lastSyncAt, lastPullAt − PULL_MARGIN); null-marker cases (skip check); at-risk filtering by S3 `updatedAt > baseline`; empty-list pass-through

### Implementation for User Story 1

- [X] T006 [US1] Implement guard domain service in api/src/slices/agent/file/domain/syncGuard.service.ts (PULL_MARGIN=60s const; inputs: agent markers + file list from existing file.gateway `list()`; output: `{baseline, atRisk[]}`); make T005 pass
- [X] T007 [US1] Extend sync endpoint in api/src/slices/agent/file/file.controller.ts:102-112: optional body DTO `{confirm?: boolean}`; when baseline exists, atRisk non-empty and !confirm → HTTP 409 `{requiresConfirmation, atRisk[{path,updatedAt}], baseline}` with NO sync side effects; else current flow (contracts/sync-api.md)
- [X] T008 [US1] Regenerate OpenAPI after DTO changes: `cd api && bun run generate:swagger` (build first if needed), then `cd admin && bun run build:api`
- [X] T009 [US1] Pass `confirm` through admin gateway in admin/slices/agent/file/data/agentFile.gateway.ts:76-80 and type the 409 payload
- [X] T010 [US1] Wire confirm flow in admin/slices/agent/file/components/agentFile/Provider.vue:63-90: catch 409 → `useConfirmStore().ask()` (admin/slices/common/stores/confirm.ts) listing atRisk paths + timestamps → confirm resends `{confirm:true}`, cancel does nothing; English copy
- [ ] T011 [US1] Validate quickstart E2E scenarios 1-2 + legacy agent check on dev installation; comment results on CLEAN-52

**Checkpoint**: US1 fully functional — MVP shippable

---

## Phase 4: User Story 2 - The two-copy model is visible in the Files tab (Priority: P2) — CLEAN-53

**Goal**: operator can tell which copy they see, that a running pod may hold newer content, and how fresh each file is

**Independent Test**: quickstart E2E scenario 3 (banner for Running agent with markers + Sync CTA; no banner when stopped; per-file last-modified visible)

### Implementation for User Story 2

- [X] T012 [US2] Expose `lastPullAt`/`lastSyncAt` in the agent response DTO (api/src/slices/agent/agent — controller/DTO layer next to agent.gateway.ts), then regenerate OpenAPI (same commands as T008)
- [X] T013 [US2] Add Running-state banner to admin/slices/agent/file/components/agentFile/Provider.vue: shared-copy explanation, `lastPullAt`/`lastSyncAt` when present, Sync CTA; hidden for non-running agents; English copy (contracts/sync-api.md "UI contract")
- [X] T014 [US2] Display per-file `updatedAt` (already returned by list endpoint) in the file list/details UI in admin/slices/agent/file/components/agentFile/Provider.vue
- [ ] T015 [US2] Validate quickstart E2E scenario 3; comment results on CLEAN-53

**Checkpoint**: US1 + US2 independently functional

---

## Phase 5: User Story 3 - Admin agent honesty + restart surfacing (Priority: P3) — CLEAN-54

**Goal**: rancher never narrates actions it cannot perform; file writes always surface the restart requirement

**Independent Test**: quickstart E2E scenario 4 (ask to create agent/bind knowledge base → honest limitation + manual path; file write reply mentions restart; deployed rancher runs the new SOUL.md)

### Implementation for User Story 3

- [X] T016 [P] [US3] Add honesty constraints to rancher/.agent/SOUL.md: no claiming create-agent / knowledge-binding ability (real tools arrive with CLEAN-51); state limitation + manual path; always surface restart after file writes
- [X] T017 [P] [US3] Append explicit "Restart required — offer restart_agent" to the `write_agent_file` tool RESULT text in api/src/slices/rancher/rancher.tool.ts:476-502
- [X] T018 [US3] Implement SOUL.md propagation for deployed rancher agents: inspect seed flow in api/src/slices/rancher/rancher.service.ts (`seedTemplateFiles`), deliver update via reseed/write + rancher restart; document the chosen path in specs/008-agent-files-sync-safety/research.md (R6 follow-up)
- [ ] T019 [US3] Validate quickstart E2E scenario 4; comment results on CLEAN-54

**Checkpoint**: all three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 Run full verification: `cd api && bun run test` green; `tsc --noEmit` on touched api TS (repo has no typecheck script — see quickstart); admin build passes (`cd admin && bun run build`)
- [ ] T021 Full quickstart.md pass end-to-end; open PR into `main` titled with CLEAN-50, link PR on CLEAN-50, move subtasks per board flow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: no dependencies — start immediately
- **Phase 2 (T002-T004)**: needs T001; T003 and T004 parallel after T002
- **US1 (T005-T011)**: needs Phase 2 (guard reads markers). Internal: T005 → T006 → T007 → T008 → T009 → T010 → T011
- **US2 (T012-T015)**: needs Phase 2 only (markers in DB). T012 → T013 → T014 → T015; can run in parallel with US1 by a second developer (different endpoints; both touch Provider.vue — coordinate T010/T013)
- **US3 (T016-T019)**: independent of all other phases (different slice). T016 ∥ T017 → T018 → T019
- **Phase 6**: after all desired stories

### Parallel Opportunities

- T003 ∥ T004 (different files, both after T002)
- T016 ∥ T017 (SOUL.md vs rancher.tool.ts)
- US3 entirely parallel to US1/US2 (no shared files)
- US2's T012 parallel to US1's T005-T007 (different api files); Provider.vue tasks (T010, T013, T014) must be sequential

### Parallel Example: after Phase 2

```bash
# Developer A (MVP): T005 → T006 → T007 → T008 → T009 → T010 → T011
# Developer B: T012 (api DTO), then waits for A's T010 before touching Provider.vue (T013-T014)
# Developer C: T016 ∥ T017 → T018 → T019
```

---

## Implementation Strategy

**MVP first (US1 / CLEAN-52)**: T001 → T002 → T003+T004 → T005-T011 → validate → this alone stops the data loss and is shippable.

**Incremental delivery**: each story ends with a quickstart validation task and a Jira comment on its subtask; PR can ship after US1 if needed (US2/US3 as follow-up commits on the same branch per current plan — single PR into main for CLEAN-50).

**Solo execution order**: strictly T001 → T021 by number.

---

## Notes

- Commit after each task or logical group with `CLEAN-50` in the subject (Conventional Commits)
- Jira: move CLEAN-53/CLEAN-54 to In Progress when their phase starts; comment checkpoints (T011, T015, T019)
- Admin UI copy is English-only; no i18n sync needed
- Runtime repo is intentionally untouched — if any task seems to need it, re-read research.md R2/R3 first
