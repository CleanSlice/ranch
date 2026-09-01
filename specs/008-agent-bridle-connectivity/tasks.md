# Tasks: Agent must not look "running" when its runtime is not connected to the bridle hub

**Input**: Design documents from `specs/008-agent-bridle-connectivity/` — [plan.md](./plan.md), [research.md](./research.md) (decisions R1–R8), [data-model.md](./data-model.md), [contracts/agent-status-api.md](./contracts/agent-status-api.md), [quickstart.md](./quickstart.md)

**Jira**: CLEAN-55 · **Branch**: `feat/CLEAN-55-agent-bridle-connectivity` · Commits: `feat(agent): … (CLEAN-55)`

**Tests**: included — spec FR-012 explicitly requires unit tests for the reconcile path. Write them first, watch them fail, then implement.

**Organization**: grouped by user story; US1 is the MVP. All paths repo-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1 (status surfacing), US2 (deploy-time warning), US3 (chat hint)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: shared type/gateway/DTO groundwork every story builds on. No user story work before this is done.

- [X] T001 Add `'unreachable'` to `AgentStatusTypes` in `api/src/slices/agent/agent/domain/agent.types.ts` and update the stale `statusReason` comment in `api/src/slices/agent/agent/agent.prisma` (lines 16–18) to say the reason persists for `failed` and `unreachable` (no migration — `status` is a plain String)
- [X] T002 In `api/src/slices/agent/agent/data/agent.gateway.ts` `updateStatus()` (line ~91): persist `statusReason` when status is `'failed' | 'unreachable'` (clear otherwise, invariant preserved); add reason-only method `setStatusReason(id: string, reason: string): Promise<void>`; declare `setStatusReason` on the `IAgentGateway` abstract interface in `api/src/slices/agent/agent/domain/` (same file that declares `updateStatus`)
- [X] T003 Add `'unreachable'` to `LIVE_DB_STATUSES` in `api/src/slices/agent/agent/domain/agentStatus.service.ts` (line ~52; `RESERVED_DB_STATUSES` unchanged) — capacity counts it live, missing-pod drift branch now covers it automatically
- [X] T004 [P] DTOs in `api/src/slices/agent/agent/dtos/`: add `@ApiProperty() bridleConnected: boolean` to `AgentStatusDto` (`agentStatus.dto.ts`); add `'unreachable'` to the `status` enum of `AgentDto` (wherever the enum values are declared for swagger)

**Checkpoint**: `cd api && bunx tsc --noEmit` passes; foundation ready.

---

## Phase 2: User Story 1 — Operator sees "running but offline" at a glance (Priority: P1) 🎯 MVP

**Goal**: sweep demotes `running` → `unreachable` (60 s grace + deploy-grace respected), bridle registration promotes back and clears the reason, `bridleConnected` flows through snapshot + SSE, admin renders the distinct state with the reason.

**Independent Test**: quickstart §3 steps 2–5 + §4 — misconfigured agent shows `unreachable` + reason in the admin list within ~90 s; API restart produces zero false flags.

### Tests for User Story 1 (write first, must fail)

- [X] T005 [US1] Create `api/src/slices/agent/agent/domain/agentStatus.service.spec.ts` — instantiate `AgentStatusService` directly with hand-rolled mocks of `IAgentGateway`, `IPodGateway`, `IBridleGateway`, `DeployTracker` (factory-helper pattern as in `api/src/slices/workflow/data/agent-workflow.manifest.spec.ts`); cases per research R8: (a) running + pod Ready + not connected + grace expired → `updateStatus('unreachable', reason)`; (b) same within 60 s window → no demotion; (c) same within deploy-grace → no demotion; (d) `stopped` + not connected → untouched; (e) `connected` event on `unreachable` agent → `running`, reason cleared, downSince cleared; (f) pod Running+Ready reconcile on `unreachable` agent → stays `unreachable`; (g) `snapshot()` items carry `bridleConnected` from `isAgentConnected`. Run `cd api && bunx jest agentStatus` — all new cases fail

### Implementation for User Story 1

- [X] T006 [US1] In `api/src/slices/agent/agent/domain/agentStatus.service.ts`: add `BRIDLE_GRACE_MS = 60_000` and in-memory `bridleDownSince: Map<string, number>`; in `detectDrift()` — record `downSince` on first observation of `status==='running' ∧ pod Running+Ready ∧ !isAgentConnected(id)`, demote to `unreachable` with the canonical sweep reason (data-model.md, includes `/settings/bridle`) only when window exceeded AND `!isWithinDeployGrace(agent)`; delete map entry whenever `isAgentConnected` is true (existing bridle-truth branch, line ~274) or agent is no longer `running`
- [X] T007 [US1] In `markRunningFromBridle()` (same file, line ~156): promote `unreachable` → `running` (reason auto-cleared by T002 semantics), clear `bridleDownSince` entry; keep the `stopped` exemption and `deployTracker.clear()` behavior intact
- [X] T008 [US1] In `reconcileDbStatus()` (same file, line ~457): guard the Running+Ready promotion — skip agents whose status is `'unreachable'` (only bridle registration promotes out of it)
- [X] T009 [US1] In `snapshot()` (line ~179) and `stream$()` (line ~215): extend `IAgentStatus` (line ~32) with `bridleConnected: boolean` filled from `bridleGateway.isAgentConnected()`; merge `bridleGateway.agentEvents$()` into the updates stream so connect/disconnect emits `{type:'event', payload:{eventType:'modified', status}}` for the affected agent; unsubscribe in `onModuleDestroy`
- [X] T010 [US1] Verify: `cd api && bunx jest agentStatus` green, `bunx tsc --noEmit` clean; regenerate spec: `cd api && bun run generate:swagger`
- [X] T011 [US1] Regenerate admin client: `cd admin && bun run build:api` (requires T010; restart local API first if it serves the spec)
- [X] T012 [P] [US1] Admin domain: add `'unreachable'` to `AgentStatusTypes` in `admin/slices/agent/agent/domain/agent.types.ts` and add `bridleConnected` to the status payload type used by the status store/gateway
- [X] T013 [P] [US1] Admin badge map: add `unreachable` to `AGENT_STATUS_VARIANT` in `admin/slices/agent/agent/utils/agentFormat.ts` (destructive-style, visually distinct from both green `running` and `failed`)
- [X] T014 [US1] Admin store/gateway: `admin/slices/agent/agent/stores/agentStatus.ts` + `admin/slices/agent/agent/data/agentStatus.gateway.ts` (mapper) — track `bridleConnected` per agent from snapshot/events, expose `unreachableCount` computed (depends on T011, T012)
- [X] T015 [US1] Admin components: `components/agent/overview/RuntimeCard.vue` — show `statusReason` for `unreachable` as well as `failed`; `components/agent/workspace/Main.vue` (line ~146) and the agents list `pages/agents/index.vue` (locate exact badge site) — distinct badge + tooltip with `statusReason`; intermediate "waiting for runtime" presentation for `running ∧ !bridleConnected` (within grace); `components/agent/status/Indicator.vue` — include unreachable count in the alert badge (depends on T013, T014; admin is English-only)
- [ ] T016 [US1] Validate story: `cd admin && bun run typecheck`; manual pass of quickstart §3 steps 2–5 and §4 false-positive guards (API restart, stopped agent, healthy deploy)

**Checkpoint**: incident scenario is diagnosable from the agent list alone — MVP shippable.

---

## Phase 3: User Story 2 — Misconfiguration flagged at deploy time (Priority: P2)

**Goal**: deploying with empty `integrations/bridle_url` / `bridle_api_key` DB values immediately writes the diagnostic reason and a warn log; deploy is NOT blocked.

**Independent Test**: quickstart §3 steps 1–3 — reason names the missing key and `/settings/bridle` while the agent is still `deploying`.

### Tests for User Story 2 (write first, must fail)

- [X] T017 [US2] Extend/create `api/src/slices/agent/agent/domain/agentDeploy.service.spec.ts`: (a) empty `bridle_api_key` → `logger.warn` + `agentGateway.setStatusReason(id, reason)` with the canonical deploy-time text (data-model.md), deploy still submits the workflow; (b) both settings set → no warn, no reason write. Run `cd api && bunx jest agentDeploy` — fails

### Implementation for User Story 2

- [X] T018 [US2] Workflow domain service (`api/src/slices/workflow/domain/`): add `checkBridleSettings(): Promise<string | null>` to the service `AgentDeployService` already injects — reads the **DB values** of `integrations/bridle_url` and `bridle_api_key` via the setting gateway (NOT the `DEFAULTS`-resolved value — research R5 gotcha: empty setting silently falls back to a dev endpoint) and returns the deploy-time warning text naming the first missing key, or `null` when both set
- [X] T019 [US2] In `api/src/slices/agent/agent/domain/agentDeploy.service.ts` `deploy()` (line ~118), after `markDeployStarted`: call `checkBridleSettings()`; on warning → `this.logger.warn(...)` + `agentGateway.setStatusReason(agentId, reason)`; deploy flow otherwise unchanged (no block, no throw)
- [ ] T020 [US2] Verify: `cd api && bunx jest agentDeploy agentStatus` green; manual pass of quickstart §3 steps 1–3

**Checkpoint**: misconfigured deploy is visible from second zero; US1 behavior unchanged.

---

## Phase 4: User Story 3 — Chat shows actionable troubleshooting (Priority: P3)

**Goal**: chat with a dead socket on a `running`/`unreachable` agent shows a hint (env preview, `/settings/bridle` link, restart note) instead of the bare "Agent is not connected".

**Independent Test**: quickstart §3 step 6 — open chat of the misconfigured agent, hint visible with working links; healthy agent shows no hint.

### Implementation for User Story 3

- [X] T021 [US3] In `admin/slices/bridle/components/bridle/Provider.vue`: when `!isAgentConnected` and the agent's status is `running` or `unreachable` (take status + `statusReason` from the agent record / `useAgentStatusStore`), replace the bare offline line with a troubleshooting block: the `statusReason` if present, link to `/settings/bridle`, link to the agent's env preview tab (`/agents/:id` env tab backed by `GET /agents/:id/env` — see `admin/slices/agent/agent/components/agent/env/Tab.vue` for the route), and the note that the agent must be restarted after fixing settings; keep the plain offline message for all other cases; English-only
- [ ] T022 [US3] Validate: `cd admin && bun run typecheck`; manual pass of quickstart §3 step 6 (hint on misconfigured agent, no hint on healthy agent, links navigate correctly)

**Checkpoint**: all three stories independently functional.

---

## Phase 5: Polish & Cross-Cutting

- [ ] T023 Full quickstart pass: §3 E2E including recovery (steps 7–8: fix settings → restart → `running`, reason cleared, chat live), §4 false-positive guards, §5 public-endpoint secret check
- [X] T024 Final gates before PR: `cd api && bunx jest && bunx tsc --noEmit`; `cd admin && bun run typecheck`; then commit(s) with `CLEAN-55`, PR into `main`, link PR on the Jira issue

---

## Dependencies & Execution Order

```text
Phase 1 (T001 → T002/T003 → T004)          T001 blocks T002/T003; T004 parallel to T002/T003
  └─▶ US1: T005 → T006 → T007 → T008 → T009 → T010 → T011 → {T012, T013} → T014 → T015 → T016
  └─▶ US2: T017 → T018 → T019 → T020        (independent of US1 code except shared T002 setStatusReason)
  └─▶ US3: T021 → T022                      (UI-only; needs T011 types for 'unreachable', benefits from US1 store work T014)
Phase 5: T023 → T024                        (after all desired stories)
```

- **US1 (P1)**: only Phase 1 required. **US2 (P2)**: only Phase 1 required (T002's `setStatusReason`) — can run fully parallel to US1 (different files). **US3 (P3)**: needs T011/T012 from US1 (regenerated types incl. `unreachable`); best after T014.
- API-side T006–T009 touch the same file (`agentStatus.service.ts`) — sequential, no [P].

### Parallel Opportunities

```text
# Phase 1: T004 alongside T002+T003 (different files)
# After Phase 1, two developers/agents:
#   A: US1 backend chain T005–T010
#   B: US2 chain T017–T020 (agentDeploy + workflow service — disjoint files)
# After T011: T012 ∥ T013 (different admin files), then T014 → T015
```

## Implementation Strategy

**MVP first**: Phase 1 → US1 (T005–T016) → stop, validate via quickstart §3–§4, demo. This alone closes the incident gap (diagnosable in seconds from the list). Then US2 (deploy-time signal), then US3 (chat hint). Each story lands as its own commit group referencing CLEAN-55; PR after whichever increment you choose to ship.

## Notes

- Reason texts are canonical — copy them verbatim from data-model.md "Diagnostic reason texts".
- Do not touch: `stopped` semantics, `deployTracker` stale protection, `RESERVED_DB_STATUSES`, `@Public()` on status endpoints.
- `bridleConnected` never goes to the DB (in-memory hub truth; the empty map after API restart IS the restart grace).
