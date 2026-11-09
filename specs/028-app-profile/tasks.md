---

description: "Task list for the app profile page 'Pass' (CLEAN-217)"
---

# Tasks: App profile page "Pass"

**Input**: Design documents from `specs/028-app-profile/` — [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/profile-ui.md](./contracts/profile-ui.md), [quickstart.md](./quickstart.md)

**Ticket**: [CLEAN-217](https://dreamvention.atlassian.net/browse/CLEAN-217) · **Branch**: `feat/CLEAN-217-app-profile` (stacked on `feat/CLEAN-215-app-console-redesign`) · **Worktree**: `C:/Users/maxim/orca/workspaces/ranch/app-ui`

**Tests**: the brief asks for tests on the pure functions and for browser checks of every state; both are included.

**Organization**: by user story. Setup creates the slice; Foundational moves the fleet poll and opens the route; then US1 (pass + account), US2 (capabilities), US3 (fleet stub), US4 (session row).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 pass and account · US2 capabilities · US3 fleet · US4 session row
- Paths are repo-relative. `REF` = `C:/Users/maxim/orca/workspaces/ranch/skills-redesign/Claude outputs/profile` (mock-up PNG + HTML, read-only). `E2E` = `specs/028-app-profile/e2e`. `LIB` = `specs/026-app-console-redesign/e2e/lib.mjs`.

## Jira comments

Checkpoints marked **(Jira)**: what landed, what is next, screenshots attached. Teammate tone. ADF JSON written with node to the scratchpad, sent with `--data-binary`, keys from `.env.project` (never printed).

---

## Phase 1: Setup

- [X] T001 Confirm the stack: Docker containers up, API on :3333 (rebuild and restart from this branch if `dist` is from the CLEAN-216 branch: `cd api && bun run generate && bun run build`, then `WORKFLOW_PROVIDER=mock node dist/main`), app dev on :3000 on this branch (`cd app && npx nuxt dev --port 3000`; remove a stale `app/.nuxt/nuxt.lock` first), seeded Owner login present in `.env.project` (names only).
- [X] T002 Create the slice skeleton: `app/slices/profile/nuxt.config.ts` modelled on `app/slices/agent/nuxt.config.ts` (alias `#profile`, `@nuxtjs/i18n` with `langDir: 'locales'` and `LOCALES`, `imports.dirs` for composables if any), and empty `app/slices/profile/i18n/locales/en.json` (`{ "profile": {} }`). Confirm `registerSlices` picks it up (`npx nuxt prepare` succeeds).
- [X] T003 [P] Create `specs/028-app-profile/e2e/shots/.gitkeep` and add `specs/028-app-profile/e2e/shots/*` + `!…/.gitkeep` to `.gitignore` next to the 026 entry.

---

## Phase 2: Foundational

**Purpose**: the fleet poll is shared, the route is protected, the copy exists. Blocks every story.

- [X] T004 Create `app/slices/agent/composables/useAgentFleet.ts` (research R3): `await useAsyncData('agents', () => agentStore.fetchAll())`; `canManage = computed(() => authStore.hasRole(Owner, Admin))`; `onMounted` starts a 30 s `refresh` interval and, when `canManage`, `fetchCapacity()` now and every 30 s; `onUnmounted` clears both; returns `{ pending, refresh, agents (storeToRefs), capacity (computed from the store), canManage }`. Comment says why it lives in the agent slice and that the key `'agents'` is shared on purpose.
- [X] T005 Switch `app/slices/agent/components/agent/workspace/Provider.vue` to `useAgentFleet()`: remove its own `useAsyncData('agents')`, the two timers and `capacity` computed; keep `canCreate` as an alias of `canManage`; nothing in the template changes. Keep the explanatory comment about polling vs. a status stream (move it into the composable).
- [X] T006 Add `'/profile'` to `PROTECTED_PREFIXES` in `app/slices/user/auth/middleware/auth.global.ts` and to the comment above it.
- [X] T007 Fill `app/slices/profile/i18n/locales/en.json` with every key from contracts/profile-ui.md (the brief's table verbatim for the 19 listed keys; plurals for `agents` and `slots_free` in three English branches; the added keys: `name`, `email`, `id`, `role`, `sign_label` "Personal sign of {name}", `scale_label` "Cluster slots: {used} in use, {free} free, {total} in total", `cap.*`, `cap_roles.*`, `cap_lock.*`). Run `bun run i18n:sync` from the repo root; then align `ru.json` with the mock-up's wording (REF PNG: "Пропуск", "оборот пропуска", "Флот установки", "опрос раз в 30 с", "Что вам доступно", "Этот браузер: вход выполнен", "К агентам", "владелец, администратор", "все роли", "только владелец, в админ-консоли", "нужна роль администратора", "только владелец"; four plural branches). `bun run i18n:check` green (unused-key warnings are expected until the components land).
- [X] T008 Run `cd app && npx nuxt typecheck` and `node specs/026-app-console-redesign/e2e/console.mjs` (workspace unchanged after T005). Commit `refactor(agent): one fleet poll shared by the workspace (CLEAN-217)` (T004–T005) and keep T006–T007 for the story commits.

**Checkpoint**: `/agents` behaves exactly as before; `/profile` (404 for now) redirects to login when signed out.

---

## Phase 3: User Story 1 — See my account as a pass (Priority: P1) 🎯 MVP

**Goal**: `/profile` shows the pass (sign, name, role, registry number, status) and the account card with id copy; the header pill leads there.

**Independent Test**: signed in, the pill opens `/profile` with `aria-current`; values equal `/auth/me`; copy works; signed out → `/login?redirect=/profile`.

- [X] T009 [P] [US1] Write `app/slices/profile/utils/registryNumber.ts` (pure, no Vue / Nuxt aliases; written with the Write tool because of the regex) and `registryNumber.test.ts` (`bun:test`): uuid → `7F3A·9C1E`; id with dashes and mixed case; 5 alphanumerics → `ABCD·E`; ≤ 4 → one group; empty / only punctuation → `''`.
- [X] T010 [P] [US1] Create `app/slices/profile/components/profile/Sign.vue`: props `initials: string`, `size?: number` (default 150), `label?: string`; inline SVG from REF HTML (gradient ring copper → lavender with a unique gradient id per instance via `useId()`, dashed orbit ellipse with the copper dot, initials as SVG `<text>` scaled to size, copper arc); `role="img"` + `aria-label` when `label` is given, else `aria-hidden`. No animation.
- [X] T011 [US1] Create `app/slices/profile/components/profile/Pass.vue`: props `name`, `initials`, `roleLabel`, `registry`, `status`, slot `stub`; markup per contracts (lanyard, clip, slot, 24 px card, foil spot top-right that never overlaps text, brand row with `LandingBrandLogo` + `$t('profile.pass')`, `<ProfileSign>`, `<h1 data-profile-name>`, role line in DotGothic16 copper like `agent-sheet__class`, registry block only when `registry`, status dot + word with the tone map from data-model.md and unknown shown as received, perforation with two notches, then the `stub` slot). Tilt per research R8: listener attached in `onMounted` only if `(hover: hover) and (pointer: fine)` matches and reduced motion does not; `--rx/--ry/--fx/--fy` via rAF; reset on `pointerleave`; removed on unmount. Scoped CSS, colours from `.dark` tokens and the REF HTML values.
- [X] T012 [P] [US1] Create `app/slices/profile/components/profile/Account.vue`: props `name: string | null`, `email`, `id`, `roleLabel`, `version: string | null`; card header `$t('profile.account')` + mono caption `$t('profile.back')`; `<dl>` rows (Name only when present, Email, ID with a ≥ 44 px copy button `data-copy-id` + `aria-label`, Role, Console version only when present); copy with `navigator.clipboard.writeText` in try/catch; `copied` ref true for 2000 ms (timer cleared on unmount); `<span aria-live="polite" data-copied>` shows `$t('profile.copied')`.
- [X] T013 [US1] Create `app/slices/profile/pages/profile.vue`: reads `authStore.user`; `displayName = name?.trim() || email`; `initials = agentInitials(name?.trim() || undefined, email)` from `#agent/utils/agentStatus`; role label through `role.*` for known roles, raw otherwise (same rule as the header); `registryNumber(user.id)`; `ranchVersion` from runtime config (empty → null); layout `grid lg:grid-cols-[400px_minmax(0,1fr)] gap-8`, pass first; renders `<ProfilePass>` and `<ProfileAccount>` (the stub slot and the two other cards arrive with US2–US4). `useHead({ title })` consistent with other pages if they set one.
- [X] T014 [US1] Header pill in `app/slices/common/components/layout/Provider.vue` (research R5): replace the name `<span>` and the role badge `<span>` with one `<NuxtLink to="/profile">` (`min-h-11`, rounded-full, border; copper border + `aria-current="page"` when `navActive('/profile')`; `title` = email); inside: name-or-email (hidden below `sm`), `<ProfileSign :size="24">` with initials shown only below `sm`, and the role badge. Log out button and the language select untouched.
- [X] T015 [US1] Gates: `cd app && bun test slices`, `npx nuxt typecheck` (revert SDK regen noise if any), root `bun run i18n:check`, `bun run locale:check` (add allowlist entries only for genuinely technical tokens).
- [X] T016 [US1] Start `E2E/profile.mjs` importing `LIB`: Owner login; click the header pill → `/profile`; `aria-current="page"` on the pill; name / email / id / role equal `GET /auth/me` (via `apiSession`-style fetch); registry equals the rule; status word present; copy id → `[data-copied]` text appears then clears within 3 s (grant clipboard permission on the context); signed-out context → `/login?redirect=/profile`. Run until green.
- [X] T017 [US1] Commit `feat(profile): pass page for the signed-in user (CLEAN-217)` (slice, i18n, guard) and `feat(common): header pill to the profile (CLEAN-217)`; push with the token HTTPS form.

**Checkpoint**: MVP — the page exists, is reachable and truthful.

---

## Phase 4: User Story 2 — See what my role allows (Priority: P1)

**Goal**: five capabilities with the right state per role.

**Independent Test**: Owner, Admin, User each match the table in spec FR-010.

- [X] T018 [P] [US2] Write `app/slices/profile/utils/capabilities.ts` (pure; role passed as a string, no import from the auth slice) and `capabilities.test.ts`: all 15 cells of the table; `Owner` row five is `elsewhere`; Admin row five `locked` + `owner_only`; User rows 1–3 `locked` + `needs_admin`, row four `yes`, row five `locked` + `owner_only`; unknown role → all five `locked` (research R7); order is fixed.
- [X] T019 [US2] Create `app/slices/profile/components/profile/Capabilities.vue`: prop `role: string`; header `$t('profile.can')`; `<ul>` of `li[data-cap][data-state]` per contracts (green check / lavender `arrow-up-right` / `lock`; muted text when locked; right mono caption: roles for `yes` and `elsewhere`, lock caption for `locked`); icons `aria-hidden`, state readable from the text.
- [X] T020 [US2] Mount `<ProfileCapabilities :role="user.role">` in `app/slices/profile/pages/profile.vue` under the account card; extend `E2E/profile.mjs`: Owner states from the DOM; Admin and User forced by intercepting `**/auth/me` (and the login response if the store reads the role from it) with the role replaced, then asserting the states and that no item is hidden.
- [X] T021 [US2] Gates as T015; commit `feat(profile): what the role allows (CLEAN-217)`; push.
- [X] T022 **(Jira)** Comment: pass, account and capabilities in; fleet stub and session row next. Attach a 1440 screenshot.

---

## Phase 5: User Story 3 — Installation fleet on the pass (Priority: P2)

**Goal**: counters, slot scale and caption on the stub, refreshed every 30 s, absent (not zero) when capacity is unknown.

**Independent Test**: counters equal the API; User sees two counters; capacity failing hides the slots block.

- [X] T023 [P] [US3] Write `app/slices/profile/utils/slotScale.ts` (pure) and `slotScale.test.ts`: `null` → `null`; total 20 / used 14 → marks `{ used: 14, total: 20 }`; total 40 → marks; total 41 → bar with ratio; used > total clamped; used < 0 clamped; total 0 → `null`.
- [X] T024 [US3] Create `app/slices/profile/components/profile/Fleet.vue`: props `agents: number`, `running: number`, `capacity: IClusterCapacityData | null`; header `$t('profile.fleet')` + `$t('profile.poll')`; counters in DotGothic16 with `data-fleet-agents`, `data-fleet-running`, and `data-fleet-free` only when `capacity`; plural labels via `$t(key, n, n)`; scale from `slotScale` (`role="img"`, `aria-label` = `profile.scale_label`; marks: filled lavender for used, dashed outline for the rest; bar variant for > 40); caption `$t('profile.slots_used', { used, total })`. Nothing rendered for the slots block when `capacity` is null.
- [X] T025 [US3] In `app/slices/profile/pages/profile.vue`: call `useAgentFleet()`; `agentsCount = agents.length`, `running = agents.filter(a => a.status === 'running').length`; pass `<ProfileFleet>` into the pass's `stub` slot.
- [X] T026 [US3] Extend `E2E/profile.mjs`: Owner counters equal `GET /agents` and `GET /agents/capacity`; scale `aria-label` carries the three numbers; with `**/agents/capacity` forced to 500 the third counter, scale and caption are absent; as User (role intercepted) no capacity request is made and two counters show; with `**/agents` returning an empty list both counters read 0; a poll is observed (wait for a second `GET /agents` within 35 s, or shorten with `page.clock` if available).
- [X] T027 [US3] Gates as T015; commit `feat(profile): installation fleet on the pass stub (CLEAN-217)`; push.

---

## Phase 6: User Story 4 — Leave from the profile (Priority: P3)

- [X] T028 [US4] Create `app/slices/profile/components/profile/Session.vue`: green dot + `$t('profile.session')`; `<NuxtLink to="/agents">` copper button `$t('profile.to_agents')` and a `<button>` `$t('auth.sign_out')` emitting `logout`; both `min-h-11`. In `pages/profile.vue` handle `logout` exactly like the header (`authStore.logout(); await navigateTo('/')`).
- [X] T029 [US4] Extend `E2E/profile.mjs`: "Go to agents" lands on `/agents…`; "Log out" from the row ends on `/` signed out (run last, or in its own context).
- [X] T030 [US4] Gates as T015; commit `feat(profile): session row (CLEAN-217)`; push.

---

## Phase 7: Polish, PR

- [X] T031 Visual pass against REF PNG at 1440: spacing, radii, colours, the foil spot, the perforation notches; fix deviations in the components' scoped CSS. Check a two-line name and an account without a name (intercepted `auth/me`).
- [X] T032 Extend `E2E/profile.mjs` with the layout and motion checks: no horizontal scroll at 1440, 1024, 768, 390, 360; one column below 1024; every button / link on the page ≥ 44 px tall; no `infinite` animation under the page root; with reduced motion emulated the pass's computed `transform` is `none` after a pointer move; without it the transform changes. Screenshots `profile-1440.png`, `-1024`, `-768`, `-390`, `profile-1440-reduced.png`, `profile-user-1440.png`, `profile-nocapacity-1440.png`.
- [X] T033 Full gates and regression: `cd app && bun test slices && npx nuxt typecheck && bun run build` (then restore regenerated SDK files with `git show HEAD:<p> | sed 's/\r$//; s/$/\r/' > <p>` if the build touched them, and restart the dev server); root `bun run i18n:check`, `bun run locale:check`; `node specs/026-app-console-redesign/e2e/console.mjs`, `gate.mjs`, `a11y.mjs`; `node specs/028-app-profile/e2e/profile.mjs`.
- [X] T034 Open the PR with `gh` as the DREAM account (`gh api user` first): base `feat/CLEAN-215-app-console-redesign` (retarget to `main` when #176 merges), title `feat(app): profile page "Pass" (CLEAN-217)`, body: summary, decisions taken (own slice, shared fleet poll, mobile pill, ru via sync then corrected, unknown role all locked), what could not be confirmed (if anything), the twin-console statement from research R6, gate table, screenshots. No session link.
- [X] T035 **(Jira)** Final comment with screenshots and the PR URL; transition CLEAN-217 to In Testing (51). Mark tasks done in this file, commit `docs(specs): app profile spec, plan and tasks (CLEAN-217)` if not committed earlier, push. Update the project memory note.
- [ ] T036 After the owner's review, green CI and #176 in `main`: retarget, `gh pr merge <n> --merge` as the DREAM account, watch `Release Platform`, report on the ticket.

---

## Dependencies

```
Phase 1 ─▶ Phase 2 ─▶ US1 ─▶ US2 ─▶ US3 ─▶ US4 ─▶ Phase 7
                         (US2, US3, US4 each need only the page from US1)
```

- T004 → T005 → T008. T006, T007 independent of T004/T005.
- US1: T009, T010, T012 parallel; T011 after T010; T013 after T009, T011, T012; T014 after T010; T016 after T013 + T014.
- US2: T018 → T019 → T020. US3: T023 → T024 → T025 → T026. US4: T028 → T029.

## Parallel execution examples

- US1: `T009` (registry util + test), `T010` (Sign.vue) and `T012` (Account.vue) at once.
- Across stories, once T013 exists: `T018` (capabilities util) and `T023` (slot scale util) at once.

## Implementation strategy

1. **MVP = Phases 1–3**: the pass and the account card, reachable from the header, behind sign-in.
2. **+ US2**: the reason a regular user opens the page.
3. **+ US3**: the fleet stub; the page is complete against the mock-up.
4. **+ US4**, then the visual pass, the full state matrix and the PR.

Each story ends green on its gates and with its own commit.
