# Tasks: Upgrade operator consoles off Nuxt 3 EOL

**Input**: Design documents from `/specs/002-nuxt4-migration/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/console-platform.md](./contracts/console-platform.md), [contracts/slice-layers.md](./contracts/slice-layers.md), [quickstart.md](./quickstart.md)

**Tests**: Not requested in the spec — no TDD tasks. Each story ends with a [quickstart.md](./quickstart.md) validation task.

**Organization**: FR-002 sequences **US5 (P2) before all P1 stories**. Stage B (Nuxt 4 package bump) is a second foundational gate after US5. Then US1 → US2 → US3 (P1) → US4 (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to spec.md user stories

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Green baseline on current Nuxt 3.21 before any compatibility flag

- [x] T001 From repo root run `bun install`; generate `api/swagger-spec.json` (`cd api && bun run generate:swagger` or `bun run build`); record current `nuxt` versions in `app/package.json` and `admin/package.json` (expect `^3.16` / lock 3.21.2)
- [x] T002 Confirm baseline production builds: `cd app && bun run build` and `cd admin && bun run build` both exit 0; if they fail, fix only environment/swagger issues — do not start the upgrade yet
- [x] T003 [P] Audit `useAsyncData(` in `app/slices/` and `admin/slices/` for shared keys with conflicting `deep`/`transform`/`pick` options (D8); note findings in the PR, no code changes unless a conflict is found

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared rules that every later phase must obey. No Nuxt major bump here.

**⚠️ CRITICAL**: No user-story work until T001–T002 are green. Stage B (Phase 4) MUST NOT start until US5 (Phase 3) is green.

- [x] T004 Confirm D1 in both hosts: do **not** create `app/app/` or per-slice `app/` trees; pages stay in slice `pages/`; `app/registerSlices.ts` and `admin/registerSlices.ts` stay the composer (`extends: [...registerSlices()]` in `app/nuxt.config.ts` and `admin/nuxt.config.ts`)

**Checkpoint**: Baseline builds green; layout/composer frozen

---

## Phase 3: User Story 5 — Upgrade proven in compatibility mode before the platform bump (Priority: P2) 🎯 gate

**Goal**: Both consoles run Nuxt 3.21 with `future.compatibilityVersion: 4`, still build, slices still load, primary journeys still work. Nuxt package major stays 3.

**Independent Test**: [quickstart.md](./quickstart.md) S1 — Nuxt major still 3; both builds green; 11/28 layers present; smoke journeys pass; checkpoint recorded on CLEAN-32 before any `nuxt@^4`

### Implementation for User Story 5

- [x] T005 [P] [US5] Set `future: { compatibilityVersion: 4 }` in `app/nuxt.config.ts`
- [x] T006 [P] [US5] Set `future: { compatibilityVersion: 4 }` in `admin/nuxt.config.ts`
- [x] T007 [US5] If `app.vue`, slice `pages/`, or layer resolution breaks after T005/T006, apply D1 revert in both `app/nuxt.config.ts` and `admin/nuxt.config.ts`: `srcDir: '.'` and `dir: { app: 'app' }`
- [x] T008 [P] [US5] Consolidate locale files under `app/slices/**`: where `locales/en.json` and `i18n/locales/en.json` both exist, keep the wired `locales/` content, copy it to `i18n/locales/en.json`, delete the stale duplicate; slices without `i18n/locales/` get a copy from `locales/`
- [x] T009 [P] [US5] Same consolidation under `admin/slices/**`; fix slices that declare `langDir: 'locales'` but only have `i18n/locales/` on disk (`admin/slices/agent/templateInstall`, `admin/slices/agent/file`, `admin/slices/agent/agentChannel`, `admin/slices/agent/templateFile`, `admin/slices/rancher`, `admin/slices/mcpServer`)
- [x] T010 [US5] Run `cd app && bun run build` and `cd admin && bun run build`; fix only breakages caused by `compatibilityVersion: 4` (aliases, `app.vue` resolution, data-fetching). Do not bump packages
- [x] T011 [US5] Smoke both consoles per quickstart S1 steps 3–4 (sign-in, nav, one agent workflow, settings, i18n strings load). Compare resolved layer list to [slice-layers.md](./contracts/slice-layers.md) (11 app / 28 admin)
- [x] T012 [US5] Record Stage A checkpoint on [CLEAN-32](https://dreamvention.atlassian.net/browse/CLEAN-32) (comment: compatibilityVersion 4 green, nuxt major still 3). **STOP** if this is not green — do not start Phase 4

**Checkpoint**: SC-007 satisfied. `app/package.json` and `admin/package.json` still have `nuxt` major 3

---

## Phase 4: Foundational Stage B — Nuxt 4 + coupled module bump

**Purpose**: The shared package/config bump that US1–US4 all require. Blocked by T012.

**⚠️ CRITICAL**: Do not start this phase until US5 checkpoint is recorded. After this phase, both hosts are on Nuxt 4; stories then make that state *correct*.

- [x] T013 In `app/package.json` and `admin/package.json` bump `nuxt` to `^4` (`cd app && bun add nuxt@^4`; `cd admin && bun add nuxt@^4`)
- [x] T014 [P] Bump `@nuxtjs/i18n` to `^10` in `app/package.json` and `admin/package.json`
- [x] T015 [P] Bump `@pinia/nuxt` to `^0.11` in `app/package.json` and `admin/package.json`; keep `pinia` `^3` as a direct dependency in both
- [x] T016 [P] Bump `shadcn-nuxt` in `app/package.json` and `admin/package.json` only if Nuxt 4 peers require a newer 2.x
- [x] T017 [P] Bump `@nuxt/image` in `app/package.json` and `admin/package.json` only if Nuxt 4 peers require it
- [x] T018 From repo root run `bun install` so `bun.lock` records the new tree (workspace root `package.json` unchanged aside from the lockfile)
- [x] T019 [P] In `app/slices/setup/i18n/nuxt.config.ts` remove `restructureDir: false` and `bundle.optimizeTranslationDirective`; leave `strategy: 'no_prefix'`, `defaultLocale: 'en'`, `detectBrowserLanguage` as today
- [x] T020 [P] Same option removal in `admin/slices/setup/i18n/nuxt.config.ts` (admin has no `detectBrowserLanguage`)
- [x] T021 [P] Move `app/slices/setup/i18n/configs/i18n.config.ts` to `app/slices/setup/i18n/i18n/i18n.config.ts` and point `vueI18n` at the new path in `app/slices/setup/i18n/nuxt.config.ts`
- [x] T022 [P] Move `admin/slices/setup/i18n/configs/i18n.config.ts` to `admin/slices/setup/i18n/i18n/i18n.config.ts` and update `admin/slices/setup/i18n/nuxt.config.ts`
- [x] T023 Update every feature-slice `nuxt.config.ts` under `app/slices/` and `admin/slices/` that sets `i18n.langDir: 'locales'` so locale files resolve at `<slice>/i18n/locales/en.json` after v10 (D4)
- [x] T024 Bump `compatibilityDate` in `app/nuxt.config.ts` and `admin/nuxt.config.ts` to a current Nuxt 4 date
- [x] T025 Run `cd app && bun run build` and `cd admin && bun run build`; fix compile/config errors from the bump (keep `ssr: false`; do not flatten slices)

**Checkpoint**: Both hosts declare `nuxt` major 4 (SC-006). Builds may still need story-level fixes — that is US1–US4

---

## Phase 5: User Story 1 — Both consoles stay usable (Priority: P1) 🎯 MVP

**Goal**: After Nuxt 4, sign-in, navigation, agent workflows, settings, and existing deep links still work on `app/` and `admin/`

**Independent Test**: [quickstart.md](./quickstart.md) S1 (post-bump smoke) and S7 (routes / `no_prefix`)

### Implementation for User Story 1

- [x] T026 [US1] Fix runtime breakages in `app/slices/` (pages, `plugins/`, `middleware/`, stores, `app/app.vue`) until sign-in, main nav, a representative agent/chat flow, and settings complete without new blocking errors
- [x] T027 [US1] Fix runtime breakages in `admin/slices/` (including nested `agent/*`, `user/*`, `setup/init`) until the same class of journeys work on port 3001
- [x] T028 [US1] Confirm `API_URL` / `runtimeConfig.public.apiUrl` still reaches the API via `app/slices/setup/api/plugins/api.ts` and `admin/slices/setup/api/plugins/apiBaseUrl.ts` with existing `.env` (FR-010)
- [x] T029 [US1] Confirm existing URLs still open the same screens (`strategy: 'no_prefix'` in setup i18n configs; `definePageMeta` in `app/slices/user/auth` and `admin/slices/user/auth`) — no new host `app/pages/` or `admin/pages/` tree
- [x] T030 [US1] Validate per specs/002-nuxt4-migration/quickstart.md S1 (post-bump) and S7

**Checkpoint**: SC-004 verifiable on both consoles

---

## Phase 6: User Story 2 — Builds and type-checking stay green (Priority: P1)

**Goal**: Production builds stay green; `nuxt typecheck` exists and passes; CI runs it after swagger generate

**Independent Test**: [quickstart.md](./quickstart.md) S3 and S4

### Implementation for User Story 2

- [x] T031 [P] [US2] Add `"typecheck": "nuxt typecheck"` to `app/package.json`; add `vue-tsc` as a devDependency if `nuxt typecheck` does not already pull it
- [x] T032 [P] [US2] Same `typecheck` script (and `vue-tsc` if needed) in `admin/package.json`
- [x] T033 [US2] Add a `typecheck` task to `turbo.json` (outputs none; depends on generated swagger the same way `build` does)
- [x] T034 [US2] In `.github/workflows/ci.yaml`, after Prisma generate, generate `api/swagger-spec.json` then run typecheck for `app` and `admin` (or `bunx turbo typecheck`). Failure is a merge blocker
- [x] T035 [US2] Make `cd app && bun run typecheck` and `cd admin && bun run typecheck` exit 0 — fix errors in `app/` and `admin/` (including `.nuxt` types and generated SDK under `slices/setup/api/data/repositories/api`)
- [x] T036 [US2] Re-run `cd app && bun run build` and `cd admin && bun run build`; confirm Docker runtime entry: if Nitro still emits `.output/server/index.mjs`, leave `app/Dockerfile` and `admin/Dockerfile` as-is; otherwise update **both** Dockerfiles to the new path (D10, FR-011)
- [x] T037 [US2] Validate per specs/002-nuxt4-migration/quickstart.md S3 and S4

**Checkpoint**: SC-002 and SC-003 verifiable; CI would catch a typecheck regression

---

## Phase 7: User Story 3 — Feature slices stay intact (Priority: P1)

**Goal**: All 11 app layers and 28 admin layers still compose the product; screens still originate from the same slice directories; `#` aliases still resolve

**Independent Test**: [quickstart.md](./quickstart.md) S2

### Implementation for User Story 3

- [x] T038 [US3] Compare `registerSlices()` output (or resolved `extends` in `.nuxt`) for `app/registerSlices.ts` and `admin/registerSlices.ts` against the inventory in specs/002-nuxt4-migration/contracts/slice-layers.md — 11/11 and 28/28, zero dropped
- [x] T039 [P] [US3] Repair any broken `#` aliases / `index.d.ts` `#app` augmentations in `app/slices/**/nuxt.config.ts` and `app/slices/**/index.d.ts` (`#theme`, `#api`, `#common`, `#agent`, `#auth`, …)
- [x] T040 [P] [US3] Same alias/`#app` repair under `admin/slices/**` (including `#llm`, `#paddock`, nested `agent/*` and `user/*`)
- [x] T041 [US3] Confirm no host-level `app/pages/` or `admin/pages/` (or Nuxt 4 `app/app/pages/`) was added that shadows slice routes; `registerSlices.ts` is unchanged in discovery semantics (setup + common first)
- [x] T042 [US3] Validate per specs/002-nuxt4-migration/quickstart.md S2 (nested admin slice screen + `app/slices/user/auth` screen still come from those directories)

**Checkpoint**: SC-001 verifiable

---

## Phase 8: User Story 4 — Localization, images, shared state, and UI kit keep working (Priority: P2)

**Goal**: i18n v10, Pinia, shadcn, and `@nuxt/image` work on Nuxt 4 without rewriting slices

**Independent Test**: [quickstart.md](./quickstart.md) S5

### Implementation for User Story 4

- [x] T043 [US4] Verify locale messages resolve from `<slice>/i18n/locales/en.json` across setup + feature slices; delete leftover unused `locales/` copies under `app/slices/` and `admin/slices/` only after confirming the `i18n/locales/` file is the one loaded
- [x] T044 [US4] If Pinia stores stop auto-importing, set `pinia.storesDirs` in `app/slices/setup/pinia/nuxt.config.ts` and `admin/slices/setup/pinia/nuxt.config.ts` to the existing `<slice>/stores` paths — do not move store files (D5)
- [x] T045 [US4] Verify theme/UI kit: `app/slices/setup/theme/nuxt.config.ts` and `admin/slices/setup/theme/nuxt.config.ts` (`shadcn.componentDir`, Tailwind v4 Vite plugin) still render buttons/forms/dialogs/tables used today
- [x] T046 [US4] Keep `@nuxt/image` registered in `app/nuxt.config.ts` and `admin/nuxt.config.ts`; do not migrate plain `<img>` to `<NuxtImg>` (D7)
- [x] T047 [US4] Validate per specs/002-nuxt4-migration/quickstart.md S5 (package majors, no `restructureDir: false`, strings/stores/UI kit)

**Checkpoint**: FR-007/FR-008 and SC-005 verifiable

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end proof and ticket hygiene

- [x] T048 Run the full [quickstart.md](./quickstart.md) S1–S7 on the Nuxt 4 tree (compat checkpoint already recorded in T012)
- [x] T049 [P] Build `app/Dockerfile` and `admin/Dockerfile` (or the repo's usual `build-images` path) and confirm the SPA serves from the Nitro entry (S6)
- [x] T050 [P] Comment on [CLEAN-32](https://dreamvention.atlassian.net/browse/CLEAN-32) that tasks.md is the implementation checklist; leave status **В работе** until `/speckit-implement` finishes
- [x] T051 Apply D8 follow-ups from T003: if any `useAsyncData` nested-mutation bugs remain in `app/slices/` or `admin/slices/`, fix locally — do not set global `experimental.defaults.useAsyncData.deep: true` unless the audit proved it is required

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — layout/composer freeze
- **US5 (Phase 3)**: Depends on Phase 2 — **blocks Stage B and all P1 stories** (FR-002)
- **Stage B (Phase 4)**: Depends on T012 (US5 checkpoint)
- **US1 / US2 / US3 (Phases 5–7)**: Depend on Phase 4; P1 stories can proceed in parallel after T025 if staffed
- **US4 (Phase 8)**: Depends on Phase 4; i18n file moves in T019–T023 already happened — US4 is verify/cleanup. Can overlap US1–US3 after T025
- **Polish (Phase 9)**: Depends on US1–US4 desired complete

### User Story Dependencies

- **US5 (P2, sequenced first)**: After Phase 2. No dependency on US1–US4. **Hard gate** before Nuxt 4.
- **US1 (P1)**: After Phase 4. Independent of US2–US4 except shared lockfile already bumped.
- **US2 (P1)**: After Phase 4. Touches `package.json` scripts / `turbo.json` / `ci.yaml` / Dockerfiles — coordinate with US1 if both edit Dockerfiles (only US2 should).
- **US3 (P1)**: After Phase 4. Touches slice `nuxt.config.ts` aliases — coordinate with US4 if the same slice config is open.
- **US4 (P2)**: After Phase 4 (and T019–T023). Independent verification of modules.

### Within Each User Story

- Config/package changes before builds
- Builds before smoke
- Story validation task last
- Do not start Phase 4 if T012 is not done

### Parallel Opportunities

- T005 ∥ T006 (compat flag per host)
- T008 ∥ T009 (locale consolidation per host)
- T014 ∥ T015 ∥ T016 ∥ T017 (module bumps — still one `bun install` after)
- T019 ∥ T020 and T021 ∥ T022 (i18n setup layers)
- T031 ∥ T032 (typecheck scripts)
- T039 ∥ T040 (alias repair per host)
- After T025: US1, US2, US3 can run in parallel if files do not overlap

---

## Parallel Example: User Story 5 (Stage A)

```bash
# Hosts in parallel:
Task: "Set future.compatibilityVersion: 4 in app/nuxt.config.ts"
Task: "Set future.compatibilityVersion: 4 in admin/nuxt.config.ts"

# Locale consolidation in parallel:
Task: "Consolidate app/slices/** locale files onto i18n/locales/"
Task: "Consolidate admin/slices/** locale files onto i18n/locales/"
```

## Parallel Example: After Stage B bump (T025)

```bash
# Different owners, different files:
Task: "US1 runtime fixes in app/slices and admin/slices"
Task: "US2 typecheck scripts in app/package.json, admin/package.json, turbo.json, ci.yaml"
Task: "US3 alias repair in slice nuxt.config.ts / index.d.ts"
```

---

## Implementation Strategy

### MVP (consoles on Nuxt 4, usable)

1. Phase 1 Setup + Phase 2 Foundational
2. Phase 3 US5 — **stop and record CLEAN-32 checkpoint**
3. Phase 4 Stage B bump
4. Phase 5 US1 — smoke both consoles
5. **STOP and VALIDATE** US1 independently
6. Then US2 (typecheck/CI) and US3 (slices) before calling P1 done

### Incremental Delivery

1. Setup + Foundational → baseline frozen
2. US5 → still on Nuxt 3, v4 defaults proven (demo/checkpoint)
3. Stage B → packages on Nuxt 4
4. US1 → operators can use both consoles (MVP)
5. US2 → merge-gated typecheck
6. US3 → slice graph certified
7. US4 → modules certified
8. Polish → Docker + full quickstart

### Parallel Team Strategy

1. Together: Phases 1–4 (lockfile and i18n setup are shared)
2. Then:
   - A: US1 journeys
   - B: US2 typecheck/CI/Docker
   - C: US3 aliases/inventory
3. One owner for US4 after T023 so locale cleanup does not race US3 slice configs

---

## Notes

- [P] = different files, no dependency on incomplete tasks
- Tests were not requested — validation is quickstart.md, not a new test runner
- Commit after each phase or logical group (US5 checkpoint is a natural commit)
- **Never bump `nuxt` to 4 before T012**
- Avoid: moving slices into `app/app/`, renaming `slices/` → `layers/`, API changes, adopting `<NuxtImg>`, global `deep: true` without T003 evidence
