# Tasks: Knowledge base isolation

**Input**: Design documents from `specs/007-knowledge-workspaces-research/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tracker**: [CLEAN-48](https://dreamvention.atlassian.net/browse/CLEAN-48)

**Tests**: included — research R10 plans them explicitly. The isolation guarantee
"gets an executable test or it is not delivered". `api` runs Jest; `admin` has no
runner, its acceptance is quickstart.md.

**Organization**: tasks are grouped by user story (US1–US6 from spec.md).
Within P2, stories run US3 → US4 → US5 as spec'd; cross-phase edits to the same
file are safe because phases are sequential.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on an incomplete task
- **[Story]**: US1–US6, user-story phases only

---

## Phase 1: Setup (verification before anything is built)

**Purpose**: close the three "verify on dev" items from research.md — each has a
fallback, but one of them (emptyDir) is load-bearing for the whole design's cost.

- [X] T001 [P] Verify on the dev cluster that `emptyDir` suffices for `/app/data/rag_storage` and `/app/data/inputs` on a per-base LightRAG instance (nothing in the ingest path must require them to survive a restart); record the result in `specs/007-knowledge-workspaces-research/research.md` (fallback: small per-base PVC — forces a re-costing of R1) — verified live against local docker LightRAG: both dirs 0 bytes after ingest, query answers after restart
- [X] T002 [P] Verify cross-namespace reachability from `agents` to `lightrag-postgres.platform` (no NetworkPolicy exists in `k8s/`, expected to pass); record in `specs/007-knowledge-workspaces-research/research.md`
- [X] T003 [P] Resolve the current digest of `ghcr.io/hkuds/lightrag` and record it as the pinned image constant for the manifest builder in `specs/007-knowledge-workspaces-research/contracts/retrieval-instance.md` (pinning is part of the contract — `:latest` broke this integration twice)

**Checkpoint**: design cost confirmed; no task below changes shape.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the `instance` sub-slice, per-base client addressing, and the schema
fields every story reads. No user story can be tested before this completes.

**⚠️ CRITICAL**: mirrors `api/src/slices/workflow/` exactly — abstract gateway,
Argo implementation, mock, router, manifest builder with unit spec.

- [X] T004 [P] Add `instanceState`, `instanceError`, `instanceEndpoint`, `migrationState` to the Knowledge model in `api/src/slices/reins/knowledge/knowledge.prisma` (per data-model.md; `workspace` kept, becomes load-bearing)
- [X] T005 [P] Add `indexState`, `indexError`, `indexedAt` to the Source model in `api/src/slices/reins/source/source.prisma` (per data-model.md; `lightragDocId` kept as the resume marker)
- [X] T006 Generate the Prisma migration for T004+T005 (`cd api && bunx prisma migrate dev`) and verify existing rows get sane defaults (`instanceState: absent`, `migrationState: notStarted`, `indexState` backfilled from `lightragDocId`)
- [X] T007 Create the instance domain: `IInstanceGateway` (`provision`/`status`/`list`/`terminate`, provision idempotent), `IProvisionInstanceData`, `IInstanceStatus` in `api/src/slices/reins/instance/domain/instance.gateway.ts` + `instance.types.ts` (per contracts/retrieval-instance.md)
- [X] T008 Write the manifest-builder unit spec FIRST in `api/src/slices/reins/instance/data/instance.manifest.spec.ts`, mirroring `agent-workflow.manifest.spec.ts`: asserts pod name `lightrag-kb-<id>`, labels `ranch/knowledge-id` + `ranch/component: retrieval`, pinned digest (never `:latest`), `WORKSPACE` env, slot requests 100m/512Mi, limits 2/4Gi, `emptyDir` volumes, namespace `agents`, service account `workflow`, Service selector
- [X] T009 Implement the manifest builder in `api/src/slices/reins/instance/data/instance.manifest.ts` — fully-baked JSON (no workflow parameters), pod + Service, env identical to `k8s/platform/lightrag/deployment.yaml` plus `WORKSPACE=workspaceOf(knowledgeId)`, `EMBEDDING_DIM=1536` unchanged; T008 passes
- [X] T010 Implement `api/src/slices/reins/instance/data/argoInstance.gateway.ts` — submit through the existing Argo path (as `argo-workflow.gateway.ts` does), status from the pod watch by label, terminate removes pod and Service
- [X] T011 [P] Implement `api/src/slices/reins/instance/data/mockInstance.gateway.ts` — returns the single docker-compose endpoint for every base, with the stated caveat that local dev does not reproduce isolation
- [X] T012 Implement `api/src/slices/reins/instance/data/routerInstance.gateway.ts` (picks Argo vs mock as `router-workflow.gateway.ts` does) and wire the instance module into the `reins` slice
- [X] T013 Make client addressing per-base: `LightragConfigResolver` takes a knowledge id and returns that base's endpoint plus the shared api key; remove the ignored `input.workspace` parameter from the ingest methods in `api/src/slices/reins/lightrag/data/lightragHttp.client.ts` (contracts/retrieval-instance.md — "the instance is the workspace")
- [X] T014 Wire provisioning into the base lifecycle in `api/src/slices/reins/knowledge/`: on create — check `getClusterCapacity()` and refuse with `409` and a stated reason when there is no room (FR-008), then `provision`; on delete — `terminate` and remove the area's content; `instanceState` transitions recorded on Knowledge
- [X] T015 Startup reconciliation in the instance service: `list()` against the bases in the database, provision what is missing, **report** orphans (never auto-delete — an orphan is evidence of a failed deletion)

**Checkpoint**: every base gets its own running instance; the shared pool still
serves all reads; nothing user-visible has changed (plan phase 1).

---

## Phase 3: User Story 1 — An answer that comes from the base I chose (Priority: P1) 🎯 MVP

**Goal**: querying a base draws only on that base; graph and entity list are
base-scoped; an agent bound to one base can neither read nor enumerate another;
existing content moves off the shared pool by a resumable re-index that costs the
operator nothing.

**Independent Test**: two bases with disjoint facts; query each for the other's
fact — each answers only from its own content and says so plainly when it has no
coverage (quickstart scenarios 1–3).

### Tests for User Story 1 (write first, must fail before implementation)

- [X] T016 [P] [US1] Isolation integration test (SC-001) in `api/src/slices/reins/knowledge/knowledge.isolation.spec.ts`: two bases with disjoint facts, each queried for the other's — asserts `answer: null, reason: "no_relevant_content"` on the miss, references resolve inside the asked base on the hit
- [X] T017 [P] [US1] Adversarial set (SC-002, ≥10 attempts) in `api/src/slices/reins/knowledge/knowledge.tool.spec.ts`: agent bound to K1 only — direct ask for K2's fact, "what bases exist", "list every entity", explicit `knowledge_id: K2` — no attempt returns K2's content or description; naming K2 is refused

### Implementation for User Story 1

- [X] T018 [US1] Route queries to the base's own instance in `api/src/slices/reins/knowledge/` service/data: `POST /knowledges/:id/query` answers from that instance only; when nothing relevant, return `{ answer: null, reason: "no_relevant_content" }` instead of a generated answer (FR-003); response gains `knowledgeId` and `complete` (false while `migrationState != done`) per contracts/knowledge-api.md §2
- [X] T019 [US1] Scope the graph: replace `GET /knowledges/graph` and `GET /knowledges/graph/labels` with `GET /knowledges/:id/graph` and `GET /knowledges/:id/graph/labels` (+`?search=&limit=`, default 50 max 200, filtered in ranch-api) in `api/src/slices/reins/knowledge/knowledge.controller.ts`; gateway signatures gain the base id; `404` unknown base, `503` with reason when the instance is not ready — never an empty list (contracts §1)
- [X] T020 [US1] Attribution: carry the source id in `file_source` at ingest in `api/src/slices/reins/source/data/source.gateway.ts`; resolve references to `sourceId`/`sourceName` in the query response (unresolvable keeps `sourceId: null`, is not dropped) per research R4
- [X] T021 [US1] Per-source state driver: poll `/documents/track_status/{trackId}` (already called in `resolveDocIdsByTrackId`) and record `Source.indexState` transitions `queued → processing → indexed | failed` with `indexError`/`indexedAt`, in `api/src/slices/reins/source/`; include a unit spec for the state mapping (research R6, R10)
- [X] T022 [US1] Tool isolation in `api/src/slices/reins/knowledge/knowledge.tool.ts`: description built from `effectiveKnowledgeIds` only, never a full base list; fan-out issues one retrieval per bound base against that base's instance; result blocks tagged `knowledgeId`/`knowledgeName` (FR-006); an unreachable base is named, not silently narrowed; `knowledge_id` validated against the bound set — unbound is refused (contracts §5); T017 passes
- [X] T023 [US1] Migration sub-slice in `api/src/slices/reins/migration/` (domain + data): per base — provision instance, wait ready, re-ingest each source via the existing `ingestByType` (`source.gateway.ts:202`), rewrite `Source.lightragDocId` with the new track id, drive `migrationState`; resumable from per-source state after interruption (FR-034); sources whose origin disappeared are reported failed, never dropped; installation-level "shared pool decommissioned" flag in the `reins/config` gateway
- [X] T024 [US1] Regenerate the contract (`cd api && bun run generate:swagger`, `cd admin && bun run build:api`, `cd app && bun run build:api`) and update the `admin` graph store/pages to the scoped endpoints in `admin/slices/reins/`; the query surface shows the incomplete-answers notice when `complete: false` (FR-036); T016 passes

**Checkpoint**: SC-001/SC-002 tests pass; quickstart scenarios 1–3 runnable
against a cluster; rollback remains "point the client back at the shared
deployment" until Polish removes it.

---

## Phase 4: User Story 2 — Finding a base, and seeing what an agent reads (Priority: P1)

**Goal**: the list is searchable and paged; an agent's screen shows and edits its
bases; binding pickers show context instead of a checkbox column.

**Independent Test**: with 40 bases present, find a named one and change an
agent's bindings — neither task requires scrolling an unfiltered list
(quickstart, SC-003/SC-004).

### Implementation for User Story 2

- [X] T025 [US2] Extend `GET /knowledges` with search + paging parameters and picker context per item — source count, total size, `indexStatus`, `instanceState` — in `api/src/slices/reins/knowledge/knowledge.controller.ts` + `dtos/` (FR-009, FR-011)
- [X] T026 [US2] Regenerate the contract after T025 (`cd api && bun run generate:swagger`, then `bun run build:api` in `admin` and `app`)
- [X] T027 [US2] Admin list with search and paging in `admin/slices/reins/components/knowledge/list/` — no screen requires scanning every base; with only a few bases, zero extra steps versus today (FR-016)
- [X] T028 [P] [US2] Agent-side knowledge view in `admin/slices/agent/agent/components/agent/item/Form.vue`: shows which bases the agent reads and edits them in place (FR-010); template-inherited bases are marked as inherited and from where (FR-012); a binding to a deleted base is visible, not silently dropped (FR-013)
- [X] T029 [US2] Binding picker with context in `admin/slices/agent/agent/components/`: each entry shows what the base holds, its size and state, and the picker stays usable as base count grows (FR-011); duplicate names disambiguated (spec edge case)

**Checkpoint**: SC-003 (find in <15s at 40 bases) and SC-004 (no extra steps at
few bases) verifiable.

---

## Phase 5: User Story 3 — A module you can use without a briefing (Priority: P2)

**Goal**: the default journey touches no optional setting; dead settings are gone
from the contract; every visible control says what it changes.

**Independent Test**: hand the module to someone who has never seen it — they
reach an answer unaided and can state what each visible control does
(SC-005/SC-008).

### Implementation for User Story 3

- [X] T030 [US3] Remove `entityTypes` and `relationshipTypes` from `api/src/slices/reins/knowledge/knowledge.prisma` and generate the Prisma migration (FR-020 — never sent anywhere in the product's history; existing bases unaffected)
- [X] T031 [US3] Remove both fields from the DTOs, mapper and domain types in `api/src/slices/reins/knowledge/`, then regenerate the contract into both consoles (`generate:swagger` + `build:api` ×2) — this is the planned contract change from the spec's assumptions, not incidental cleanup
- [X] T032 [US3] Rework the base form in `admin/slices/reins/components/knowledge/item/Form.vue`: retrieval-tuning controls behind an explicit disclosure with usable defaults (FR-018), each visible control describes what it changes and what it trades (FR-021), exactly one primary action (FR-019)
- [X] T033 [P] [US3] Every empty state in the module names the next action — no bases, no sources, nothing indexed — across `admin/slices/reins/components/knowledge/` (FR-022, FR-029's "no entities yet" copy included)
- [X] T034 [US3] Opening a base shows what it holds, whether it can answer yet, and which sources are behind it without further navigation, in `admin/slices/reins/pages/knowledges/[id].vue` header area (FR-023)
- [X] T035 [P] [US3] Demote diagnosis surfaces below the everyday path (FR-024) and make setup steps that need outside action say why and what is unavailable (FR-025) in `admin/slices/reins/`

**Checkpoint**: default journey — create, add source, index, ask — touches zero
optional settings (SC-006); zero settings that change nothing remain (SC-007).

---

## Phase 6: User Story 4 — The active tab is visible (Priority: P2)

**Goal**: the current section is always marked; a sectionless URL shows a default.

**Independent Test**: visit every section by click and by direct URL — exactly
one entry marked current in all cases; `/knowledges/:id` never renders an empty
body (quickstart scenario 6, SC-010).

### Implementation for User Story 4

- [X] T036 [P] [US4] Fix the active tab in `admin/slices/reins/pages/knowledges/[id].vue` via `NuxtLink`'s `custom` slot binding classes from `isActive`, so exactly one class set is ever applied (research R8 — the current two-utility conflict is decided by stylesheet order; do not copy `setting/components/setting/nav/Menu.vue`, it survives by accident)
- [X] T037 [P] [US4] Add the missing default section `admin/slices/reins/pages/knowledges/[id]/index.vue` rendering the sources section (FR-027)

**Checkpoint**: SC-010 — every route under a base shows a distinguishable current
state by click and by direct navigation.

---

## Phase 7: User Story 5 — The entity picker opens instantly (Priority: P2)

**Goal**: the picker is responsive at any base size, filters as the operator
types, and offers only the current base's entities.

**Independent Test**: a base with entities well beyond a screenful — the picker
opens without a perceptible pause and filters on typing (quickstart scenario 5,
SC-009).

### Implementation for User Story 5

- [X] T038 [US5] Replace the `SelectItem`-per-label render in `admin/slices/reins/components/knowledge/graph/Provider.vue` with `reka-ui`'s combobox + virtualizer (already a dependency), fed by `GET /knowledges/:id/graph/labels?search=&limit=` from T019 — filtering server-side, nothing installation-wide (research R7)
- [X] T039 [US5] Distinguish the picker's empty states in `admin/slices/reins/components/knowledge/graph/Provider.vue`: "nothing has been indexed yet" versus "no entity matches what you typed" (FR-029)

**Checkpoint**: SC-009 — usable within 1 second at any base size; no entity from
another base ever offered.

---

## Phase 8: User Story 6 — Indexing status that tells the truth (Priority: P3)

**Goal**: per-source state through ingestion, a base ready only when its content
is retrievable, one failure never masking a batch.

**Independent Test**: index a batch containing one unprocessable source — the
failing source is identifiable by name with its reason, the rest complete, and
the base does not claim readiness it lacks (quickstart scenario 7, SC-011).

### Tests for User Story 6 (write first, must fail before implementation)

- [X] T040 [P] [US6] Unit spec for the base-readiness rollup in `api/src/slices/reins/knowledge/knowledge.status.spec.ts`: `ready` only when ≥1 source and all `indexed`; any `processing` → `indexing`; any `failed` with none processing → `partial`; no sources → `empty` (data-model.md state rules)

### Implementation for User Story 6

- [X] T041 [US6] Derive `indexStatus` from source states in the knowledge service/mapper in `api/src/slices/reins/knowledge/` instead of setting it independently (FR-031); T040 passes
- [X] T042 [US6] Remove the misleading `indexed` boolean (`lightragDocId !== null` in `api/src/slices/reins/source/data/source.mapper.ts:29`) and expose `indexState`/`indexError`/`indexedAt` in the source DTOs (contracts §4 — keeping both a truthful state and a misleading boolean is how the misleading one survives)
- [X] T043 [US6] Add `POST /knowledges/:knowledgeId/sources/:sourceId/reindex` in `api/src/slices/reins/source/` — retries a single failed source without touching the rest of the batch (FR-032)
- [X] T044 [US6] Regenerate the contract and update the `admin` sources table in `admin/slices/reins/components/` to show per-source state, its own failure reason, and a retry action (SC-011 — identifiable from the interface alone, no logs)

**Checkpoint**: quickstart scenario 7 passes end to end.

---

## Phase 9: Polish & cross-cutting

- [ ] T045 Decommission the shared pool — gated on every base reaching `migrationState: done`: delete the old default-namespace content, remove `k8s/platform/lightrag/`, flip the `reins/config` decommission flag (research R3 step 4; until this task, the shared deployment is the rollback — do not run it early)
- [ ] T046 [P] Full Jest run green: `cd api && bun run test` — manifest builder, state mapping, readiness rollup, isolation integration, adversarial set all passing
- [ ] T047 [P] Walk all nine scenarios in `specs/007-knowledge-workspaces-research/quickstart.md` including the ceiling (scenario 8, FR-008) and the nothing-got-heavier check (scenario 9, SC-004/SC-006/SC-007); record outcomes in the file

---

## Dependencies & execution order

### Phase dependencies

- **Setup (Ph1)**: none — start immediately; T001 gates the design's cost, so do not start Phase 2 volume work before it lands
- **Foundational (Ph2)**: after Setup — **blocks all stories**
- **US1 (Ph3)**: after Foundational; T023 (migration) is what makes T018/T019's scoped reads safe for existing installs
- **US2 (Ph4)**: after Foundational only — does not need US1; ordered after it because both are P1 and isolation is the product's hard requirement
- **US3 (Ph5)**: after US1 (dead-settings removal shares regeneration flow) and US2 (list must have structure before it can be simplified — spec's own ordering)
- **US4 (Ph6) / US5 (Ph7)**: US4 is independent after Ph2; US5 needs T019 (the scoped labels endpoint)
- **US6 (Ph8)**: needs T021 (state driver) from US1
- **Polish (Ph9)**: T045 strictly after every base is migrated; T046/T047 after all desired stories

### Within US1

T016+T017 (tests, parallel) → T018 → T019 → T020 → T021 → T022 → T023 → T024.
T023 must exist before scoped reads go live for an installation with pre-existing
content; the sequence T018–T023 is one reversible unit until T045.

### Parallel opportunities

- Ph1: T001, T002, T003 all parallel
- Ph2: T004 ∥ T005; T008 ∥ T011 (spec and mock, different files)
- Ph3: T016 ∥ T017 (different spec files)
- Ph4: T028 ∥ T027 (different slices)
- Ph5: T033 ∥ T035
- Ph6: T036 ∥ T037
- Ph8: T040 alongside any Ph8 planning; Ph9: T046 ∥ T047
- After Ph2, US2 (Ph4) and US4 (Ph6) can proceed in parallel with US1 if staffed

### Parallel example: Phase 1

```bash
Task: "Verify emptyDir sufficiency on dev per research.md item 1"
Task: "Verify agents → lightrag-postgres.platform reachability"
Task: "Resolve pinned digest for ghcr.io/hkuds/lightrag"
```

---

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** Isolation is the product owner's
hard requirement and the one thing that cannot be verified by looking at a
screen. Stop after T024, run quickstart scenarios 1–3 against a cluster, and
validate before touching navigation or clarity.

Incremental delivery after MVP: US2 (find + agent view) → US3 (clarity) →
US4/US5 (defects, small) → US6 (honest status) → Polish. Each checkpoint is
independently testable; commits reference CLEAN-48; the shared deployment stays
up as the rollback until T045.
