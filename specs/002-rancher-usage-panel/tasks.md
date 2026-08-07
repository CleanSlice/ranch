# Tasks: Rancher & Agent Usage Panel Redesign

**Input**: Design documents from `/specs/002-rancher-usage-panel/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: API Jest tests ARE included — the API contract explicitly lists test obligations (contracts/api-usage-overview.md) and research R10 defines the testing strategy. Admin has no test harness; UI is validated via quickstart.md scenarios.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1 in the spec; US1 (Rancher page layout) is phased first per spec order and is independently testable thanks to the Foundational panel shell. US2 layers views + pagination onto that shell. US3 (agent pages) reuses the finished panel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)

## Path Conventions

Monorepo web app: backend `api/src/slices/usage/`, frontend `admin/slices/` (Nuxt layers). Paths per plan.md Project Structure.

---

## Phase 1: Setup

**Purpose**: Baseline the working environment — no project scaffolding is needed (existing monorepo).

- [X] T001 Verify baseline: `bun install`, start `bun run dev:api` and `bun run dev:admin`, open `http://localhost:3001/rancher` and an agent page; confirm current tiles/usage block render and note the admin agent id (needed to smoke-test the panel later). Seed `Usage` rows across ≥2 agents, ≥2 models, ≥8 days via `cd api && bun run studio` if the local DB is empty (quickstart.md Prerequisites)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared `<UsagePanel>` shell that ALL three stories mount. Uses only the existing per-agent endpoint — no API work needed yet.

**⚠️ CRITICAL**: No user story phase can start before this completes.

- [X] T002 Create panel shell `admin/slices/usage/components/usage/Panel.vue`: props `agentId: string | null`, `title?` (default `Usage · 30d`), `collapsible?` (default false) per contracts/ui-usage-panel.md; fetches via `useUsageStore().fetchForAgent(agentId)`; renders full parity fields (today model / input+output tokens / calls; 30d cost / top model / input / output / calls) with `Intl.NumberFormat` counts and USD (4 fraction digits); skeleton while loading; "No usage reported yet." when `totals.callCount === 0`; card built from `#theme/components/ui/card`
- [X] T003 Verify the Nuxt layer resolves `<UsagePanel>` (layers auto-scan `components/`); if not, add a `components` entry to `admin/slices/usage/nuxt.config.ts`; smoke-test by temporarily mounting `<UsagePanel>` on any page with the admin agent id from T001

**Checkpoint**: `<UsagePanel :agent-id="…" />` renders real per-agent data anywhere in the admin.

---

## Phase 3: User Story 1 — Focused Rancher page: chat centered, usage on the right (Priority: P1) 🎯 MVP

**Goal**: Rancher page shows no count tiles; chat is the central surface with the usage panel to its right; setup wizard untouched.

**Independent Test**: Open `/rancher` with setup complete — tiles absent, chat centered, panel right (agent-scoped data is enough; views/pagination come with US2). With a fresh DB, the wizard renders exactly as before. Quickstart scenarios 1, 4, 5, 6.

### Implementation for User Story 1

> All three tasks edit `admin/slices/rancher/components/rancher/Provider.vue` — sequential, no [P].

- [X] T004 [US1] Remove the count tiles from `admin/slices/rancher/components/rancher/Provider.vue`: delete the `stats` computed, the tiles' `NuxtLink` grid, the `rancher-dashboard` `useAsyncData` block, and the now-unused store/icon imports (keep `llmStore` — used by `onDeploy`; keep `agentStore` — used by status/usage fetches)
- [X] T005 [US1] Restructure the post-setup layout in `admin/slices/rancher/components/rancher/Provider.vue`: chat (`BridleProvider`) becomes the central primary column (preserve current sticky/height treatment); mount `<UsagePanel :agent-id="admin?.id ?? null" title="Rancher usage · 30d" />` in a right-hand column (~`w-96`); panel stacks below the chat under `lg`; delete the old inline usage tile markup and the `usageStats` computed; the incomplete-setup wizard branch stays byte-for-byte unchanged (FR-009)
- [X] T006 [US1] Rewire refresh in `admin/slices/rancher/components/rancher/Provider.vue`: `onRefreshAll` drops `refreshDashboard`, keeps status refresh, and re-triggers the panel's data (existing `rancher-admin-usage` asyncData is superseded by the panel's own fetch — remove it or delegate to a panel `refresh()`), satisfying FR-010

**Checkpoint**: US1 acceptance scenarios 1–3 pass; exactly one metrics block on the page (SC-005).

---

## Phase 4: User Story 2 — Usage panel with switchable views and pagination (Priority: P1)

**Goal**: Panel toggles Total (all-agents cost) / Calls / Agent views and paginates the 30-day daily breakdown.

**Independent Test**: On `/rancher`, switch the three views (distinct correct numbers per view), page through >7 daily rows, controls absent at ≤7 rows, empty view shows explicit empty state. Quickstart scenarios 2, 3, plus `curl /usage/overview` API check.

### API — new overview endpoint

- [X] T007 [P] [US2] Add `IOverviewUsageResponse` (last30days, totals, topModel, byAgent — shape mirrors `ICredentialUsageResponse` per data-model.md) to `api/src/slices/usage/domain/usage.types.ts`
- [X] T008 [US2] Add abstract `findRecentAll(days: number): Promise<IUsageData[]>` to `api/src/slices/usage/domain/usage.gateway.ts` and implement in `api/src/slices/usage/data/usage.gateway.ts` (Prisma `usage.findMany({ where: { date: { gte: since } }, orderBy: [{ date: 'desc' }, { model: 'asc' }] })` — same `since` computation as the sibling finders)
- [X] T009 [US2] Implement `GET /usage/overview` in `api/src/slices/usage/usage.controller.ts`: roll up rows per `${date}|${model}`, compute totals + topModel, build `byAgent` sorted by `costUsd` desc with deleted-agent name fallback — extract the roll-up shared with `findForCredential` into a private helper instead of copy-pasting; DB-only, no S3 today-merge (research R2); empty table returns zeroed shape with 200 (contracts/api-usage-overview.md)
- [X] T010 [P] [US2] Jest tests in `api/src/slices/usage/usage.controller.spec.ts` (new file) covering the four contract obligations: (1) multi-agent/multi-model aggregation grain + totals ≡ Σ entries invariant, (2) topModel selection and null-on-empty, (3) byAgent cost-desc sort + deleted-agent ID fallback, (4) empty table → zeroed 200 shape; run `cd api && bun run test`

### Admin — SDK + usage slice plumbing

- [X] T011 [US2] Regenerate the admin SDK: with the API running, `cd admin && bun run build:api`; verify `usageControllerFindOverview` exists in `admin/slices/setup/api/data/repositories/api/sdk.gen.ts` (never hand-edit `*.gen.ts`)
- [X] T012 [P] [US2] Add admin domain types `IOverviewUsage` + `IOverviewAgentUsage` to `admin/slices/usage/domain/usage.types.ts`, export from `admin/slices/usage/domain/index.ts`, extend `IUsageGateway` (`admin/slices/usage/domain/usage.gateway.ts`) and `UsageService` (`admin/slices/usage/domain/usage.service.ts`) with `findOverview()`
- [X] T013 [US2] Implement `findOverview()` in `admin/slices/usage/data/usage.gateway.ts` (call `UsageApi.usageControllerFindOverview`, `unwrapEnvelope`) and add defensive `toOverviewUsage(raw: unknown)` to `admin/slices/usage/data/usage.mapper.ts` following the existing `toAgentUsage` pattern (depends on T011, T012)
- [X] T014 [US2] Extend `admin/slices/usage/stores/usage.ts`: `overview` state, `fetchOverview()` / `getOverview()`, re-export the new domain types

### Panel — views + pagination

- [X] T015 [US2] Add the view switcher to `admin/slices/usage/components/usage/Panel.vue`: segmented control from `#theme/components/ui/tabs` with `Total` / `Calls` / `Agent`; Total = all-agents 30d cost emphasized + totals + top model + `byAgent` breakdown; Calls = call volume emphasized (total + per-day); Agent = the T002 parity fields; `agentId === null` disables the Agent tab with a hint (data-model.md view rules); switching views resets pagination to page 1
- [X] T016 [US2] Add client-side pagination to `admin/slices/usage/components/usage/Panel.vue`: daily rows table (date, model, tokens in/out, calls, cost) over the active view's `last30days`, page size 7, Prev/Next `#theme` buttons + "N–M of T" indicator, controls not rendered when T ≤ 7 (FR-004)
- [X] T017 [US2] Finalize per-view empty/error states and expose `refresh()` from `admin/slices/usage/components/usage/Panel.vue` (refetch active view's sources); wire the Rancher page refresh button to it in `admin/slices/rancher/components/rancher/Provider.vue` (FR-008, FR-010)

**Checkpoint**: US2 acceptance scenarios 1–6 pass on the Rancher page; API tests green.

---

## Phase 5: User Story 3 — The same usage panel on every agent page (Priority: P2)

**Goal**: Every agent page carries the panel with full parity; chat stays central, logs stay reachable.

**Independent Test**: Open any non-Rancher agent — chat tab shows logs (top) + usage panel (bottom) on the right, both independently collapsible; Overview tab renders the same panel; agent with no usage shows the empty state. Quickstart scenarios 7–10.

### Implementation for User Story 3

- [X] T018 [US3] Restructure the side area in `admin/slices/agent/agent/components/agent/chat/Tab.vue`: right side becomes a vertical stack — `AgentLogsPanel` on top (existing collapse behavior preserved) and `<UsagePanel :agent-id="agent.id" collapsible />` below; each collapses independently to a compact button (mirror the existing collapsed-"Logs"-button pattern); collapsing one gives the other the freed height; chat sizing/centrality untouched (FR-007, contracts/ui-usage-panel.md host layout)
- [X] T019 [P] [US3] Replace the bespoke `<dl>` body of `admin/slices/agent/agent/components/agent/overview/UsageCard.vue` with `<UsagePanel :agent-id="agentId" />` (non-collapsible, full-width) so Overview and Chat surfaces share one implementation (SC-003)

**Checkpoint**: All three stories functional; panel behavior identical across Rancher page, agent chat tab, and agent Overview tab.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Dead-code sweep: remove now-unused imports/helpers in `admin/slices/rancher/components/rancher/Provider.vue` (icons, stores after T004–T006) and any unused formatting helpers left in `admin/slices/agent/agent/components/agent/overview/UsageCard.vue` after T019
- [X] T021 [P] Gates: `cd api && bun run lint && bun run test`; type-check pure-TS admin additions (usage slice domain/data/stores) via `tsc` per repo convention (no vue-tsc)
- [ ] T022 Run all 10 quickstart.md validation scenarios end-to-end and verify success criteria SC-001–SC-006; fix anything that fails before declaring the feature done
  > Automated part DONE (2026-08-03): API unit tests (4 new, 122 total green), full admin production build, `nuxt prepare` component registration, tsc typecheck of changed TS, SDK regen verified. REMAINING: the 10 in-browser scenarios need a manual pass against a running stack (`bun run dev:api` + `bun run dev:admin` + seeded Usage rows) — not runnable in the headless implementation session.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup — **blocks all stories** (every story mounts `<UsagePanel>`)
- **US1 (Phase 3)**: after Phase 2 only — does NOT need the overview endpoint (panel shell shows agent-scoped data)
- **US2 (Phase 4)**: after Phase 2; edits the panel created in T002. T017 touches the Rancher Provider, so finishing US1 first avoids same-file churn (recommended order, not a hard block)
- **US3 (Phase 5)**: after Phase 2; best after US2 so agent pages get the finished panel, but mounting the shell alone is already testable
- **Polish (Phase 6)**: after all desired stories

### Task-level dependencies

- T002 → T003 (component must exist to verify resolution)
- T004 → T005 → T006 (same file, sequential)
- T007 → T009; T008 → T009; T009 → T010 (tests target the implemented endpoint; may be *written* in parallel with T009 — different file); T009 → T011 (swagger must expose the op) → T013; T012 → T013 → T014 → T015 → T016 → T017
- T018 and T019 are independent of each other ([P])

### Parallel Opportunities

- **T007 ∥ T008** (different files) once Phase 2 is done; **T010** can be authored while T009 is in progress
- **T012 ∥ T011** (admin domain types don't depend on the generated SDK)
- **T018 ∥ T019** (different files) — two people can finish US3 in one pass
- **US1 (T004–T006) ∥ US2 API half (T007–T010)** — disjoint file sets, different workspaces

## Parallel Example: User Story 2

```bash
# After Phase 2, kick off the API half while US1 is still in review:
Task: "Add IOverviewUsageResponse to api/src/slices/usage/domain/usage.types.ts"          # T007
Task: "Add findRecentAll to domain + data usage gateways"                                  # T008
# Then:
Task: "Implement GET /usage/overview in api/src/slices/usage/usage.controller.ts"          # T009
Task: "Write Jest tests in api/src/slices/usage/usage.controller.spec.ts"                  # T010 (parallel file)
# Admin half:
Task: "Regenerate SDK (bun run build:api)"                                                 # T011
Task: "Admin domain types + gateway/service signatures in admin/slices/usage/domain/"      # T012 (parallel with T011)
```

## Implementation Strategy

### MVP First (US1)

1. Phase 1 → Phase 2 (panel shell) → Phase 3 (Rancher page).
2. **STOP and VALIDATE**: quickstart scenarios 1, 4, 5, 6 — decluttered Rancher page with a live cost panel is already a shippable increment.

### Incremental Delivery

1. + US2 → the panel becomes interactive (views + pagination) and the platform-wide cost number appears (SC-001) → validate scenarios 2–3 + API checks → ship.
2. + US3 → every agent page gets the panel (SC-003, SC-006) → validate scenarios 7–10 → ship.
3. Polish → gates + full quickstart sweep.

### Notes

- Same-file tasks are intentionally sequential (rancher Provider.vue: T004–T006; Panel.vue: T015–T017) — do not parallelize them.
- Commit after each task or logical group; deploys happen only on `v*` tag runs (repo release convention).
- `*.gen.ts` files are regenerated, never edited (T011).
