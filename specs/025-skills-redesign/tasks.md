# Tasks: Skills library redesign (CLEAN-205)

**Input**: Design documents from `specs/025-skills-redesign/` — plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/{skills-api,skills-ui,agent-tools}.md, quickstart.md

**Tests**: requested by the brief (unit: slugify, relative time, filtered reorder, order diff; e2e: drag+save, keyboard, Discard, rollback, drawer at 1024, sheet + Reorder at 390, slug validation + taken name) and by `docs/agent-tools.md` (a spec per tool). Unit tests sit beside the code; e2e scripts live under `specs/025-skills-redesign/e2e/`.

**Organization**: by user story from spec.md. US1 (library) is the MVP; US2 (shared order), US3 (form), US4 (responsive hosts), US5 (inline delete) each land on top of it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an unfinished task
- **[Story]**: US1…US5 from spec.md
- Paths are repo-relative. `api/` is NestJS + Prisma, `admin/` is Nuxt 4; everything stays inside the two `skill` slices except one tool in `api/src/slices/rancher/rancher.tool.ts`.

## Ground rules (from CLAUDE.md, memory and the plan)

- Fresh worktree: `cd api && bun run generate` before any API build; `cd admin && npx nuxt prepare` before `bun test`.
- API tests: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>` — never `bun run test` while a dev API runs.
- Admin typecheck: `cd admin && npx nuxt typecheck`. It regenerates both SDKs; restore `app/slices/setup/api/**` with `git show HEAD:<path> > <path>` when `app` needed nothing.
- No Prettier/ESLint over admin files; API files get `npx eslint --quiet <files>`.
- No `toLocale*` / `Intl.*` in components (`bun run locale:check`); use `#common/utils/format` and `useRelativeTime`.
- One record per skill in `useSkillStore`; components render by id; `useAsyncData` only for `pending` / `error` / `refresh`.
- Commit messages carry `(CLEAN-205)`; the PR states the twin-console check in words.

---

## Phase 1: Setup

**Purpose**: a worktree that builds, plus the e2e harness the later phases drive.

- [X] T001 Prepare the worktree: `cd api && bun run generate && bun run build` and `cd admin && npx nuxt prepare` both succeed on the untouched branch (`api/`, `admin/`); note the baseline `bun test slices` count in `admin/`
- [X] T002 [P] Create `specs/025-skills-redesign/e2e/lib.mjs` by copying `specs/015-chat-message-reliability/e2e/lib.mjs` and trimming it to `launch`, `newPage`, `login`, `ADMIN`, `sleep`, plus a `viewport(page, w, h)` helper and a `check(name, ok, detail)` collector that exits non-zero on any FAIL (header comment: Playwright stays outside the repo, `PLAYWRIGHT_DIR`)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the three new columns, the richer skill entity on both sides, and a store that is the single record per skill. Nothing in Phases 3–7 compiles without this.

### API schema and entity

- [X] T003 Add `group String?`, `sortOrder Int @default(0)`, `tokenEstimate Int @default(0)` and `@@index([sortOrder])` to `api/src/slices/skill/skill.prisma`
- [X] T004 Write `api/prisma/migrations/20261103120000_skill_library_order/migration.sql`: the three `ADD COLUMN`s, `CREATE INDEX "Skill_sortOrder_idx"`, backfill `sortOrder` with `ROW_NUMBER() OVER (ORDER BY "createdAt", name)`, backfill `tokenEstimate = CEIL(LENGTH(body) / 4.0)`; header comment explains why (data-model.md §Migration); then `cd api && bun run generate`
- [X] T005 [P] Create `api/src/slices/skill/domain/skill.groups.ts` exporting `SKILL_GROUPS = ['api','routing','spec-lookup','answer-format','runtime'] as const` and `type SkillGroup`
- [X] T006 [P] Create `api/src/slices/skill/domain/tokens.ts` with `estimateTokens(body: string): number` = `Math.ceil(body.length / 4)` and `api/src/slices/skill/domain/tokens.spec.ts` with fixtures empty → 0, 7 chars → 2, 4000 chars → 1000 (R3)
- [X] T007 Extend `api/src/slices/skill/domain/skill.types.ts`: `ISkillData` gains `group: SkillGroup | null`, `sortOrder`, `tokenEstimate`, `filesCount`, `templates: { id; name }[]`; `ICreateSkillData` / `IUpdateSkillData` gain `group?: SkillGroup | null`; export from `domain/index.ts`
- [X] T008 Update `api/src/slices/skill/data/skill.mapper.ts`: `toEntity` maps the new columns, `filesCount = files.length`, `templates` from the included relation (default `[]`); `toCreate` passes `group ?? null` and `tokenEstimate = estimateTokens(body)`
- [X] T009 Update `api/src/slices/skill/data/skill.gateway.ts`: `findAll` orders by `[{ sortOrder: 'asc' }, { name: 'asc' }]` and `findAll` / `findById` / `findByName` / `findByIds` include `templates: { select: { id: true, name: true } }`; `create` runs in `$transaction` and sets `sortOrder = (max ?? 0) + 1`; `update` recomputes `tokenEstimate` when `body` is present and passes `group` through
- [X] T010 Update DTOs: `api/src/slices/skill/dtos/skill.dto.ts` adds `group` (`enum: SKILL_GROUPS`, nullable), `sortOrder`, `tokenEstimate`, `filesCount`, `templates` (nested `SkillTemplateRefDto { id, name }`); `createSkill.dto.ts` adds `@ApiPropertyOptional({ enum: SKILL_GROUPS, nullable: true }) @IsOptional() @IsIn([...SKILL_GROUPS]) group?: SkillGroup | null` (`UpdateSkillDto` inherits)
- [X] T011 Regenerate: `cd api && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api`; confirm `SkillDto.group` is a union and `templates` is typed in `admin/slices/setup/api/data/repositories/api/types.gen.ts`; `npx eslint --quiet api/src/slices/skill`

### Admin entity, config, store

- [X] T012 [P] Create `admin/slices/skill/domain/skill.groups.ts`: `SKILL_GROUP_META` keyed by the generated `SkillDto['group']` union (`satisfies Record<SkillGroup, { label; chip; mark; strip }>`) with the five labels and Tailwind class pairs (light + `dark:`) from research R2, plus `UNGROUPED_META` (label `Ungrouped`, neutral classes) and `groupMeta(group | null)`; export `SKILL_GROUP_KEYS` in display order
- [X] T013 Extend `admin/slices/skill/domain/skill.types.ts`: `ISkillData` gains `group`, `sortOrder`, `tokenEstimate`, `filesCount`, `templates: { id; name }[]`; `ISkillInput` gains `group?: SkillGroup | null`; add `ISkillOrder { version: string; items: { id; sortOrder }[] }` and `ISkillOrderConflict { code: 'ORDER_CHANGED' }`
- [X] T014 Update `admin/slices/skill/data/skill.mapper.ts`: `toEntity` reads the new fields defensively (`group` only if in `SKILL_GROUP_KEYS`, numbers default 0, `templates` as `{ id, name }[]`); `toCreateDto` / `toUpdateDto` pass `group`
- [X] T015 Refactor `admin/slices/skill/stores/skill.ts` to one record per skill (docs/state.md): add `byId(id)`, `byName(slug)`, `upsert(skill)`, `patch(id, partial)` returning a rollback that restores a field only if it still holds the optimistic value (copy the agent store's pattern from `admin/slices/agent/agent/stores/agent.ts`); `fetchById` / `create` / `update` / imports upsert; `remove` filters; keep `items`, `loading`, `error`
- [X] T016 Update `admin/slices/skill/components/skill/edit/Provider.vue` and `admin/slices/skill/components/skill/import/*/Provider.vue` to render from `skillStore.byId(id)` where they read the entity a fetch returned (keep `useAsyncData` for `pending`); run `cd admin && npx nuxt typecheck` and restore `app/slices/setup/api/**` if it changed

**Checkpoint**: API returns the new fields (`curl /skills` shows `group`, `sortOrder`, `tokenEstimate`, `filesCount`, `templates`), migration applied on the local DB, admin typecheck green, existing pages still work.

---

## Phase 3: User Story 1 — See the library at a glance and find a skill (Priority: P1) 🎯 MVP

**Goal**: the new `/skills` page on desktop: summary, size strip, search / group chips / sort in the URL, rows with the full meta line, a sticky panel column with path copy, metrics, description, template chips and Activity.

**Independent Test**: spec US1 scenarios 1–9 and quickstart §1 at 1440 px; a copied URL restores the view.

### Pure utilities with tests (bun test)

- [X] T017 [P] [US1] Create `admin/slices/skill/utils/formatTokens.ts` (`880`, `1.7k`, `18.9k`; one decimal below 10k, none above) and `formatTokens.test.ts`
- [X] T018 [P] [US1] Create `admin/slices/skill/utils/editTime.ts` with `isRecent(updatedAt, now, windowMs = 86_400_000)` and `editedThisWeek(skills, now)` → `{ count, latest }`; `editTime.test.ts` with a fixed `now`
- [X] T019 [P] [US1] Create `admin/slices/skill/utils/summary.ts` with `librarySummary(skills, now)` → `{ count, totalTokens, editedThisWeek, latestEdit, unused: slug[] }` and `stripSegments(skillsInOrder)` → `{ slug, tokens, flexGrow }` (min width is CSS, `flex: <tokens> 1 8px`); `summary.test.ts`
- [X] T020 [P] [US1] Create `admin/slices/skill/utils/activity.ts` with `activityOf(skill)` → `{ kind: 'created' | 'imported' | 'edited'; at }[]` (R6: `imported` when `source`, `edited` only if `updatedAt − createdAt > 1000 ms`) and `activity.test.ts`
- [X] T021 [P] [US1] Create `admin/slices/skill/utils/filterSkills.ts` with `matchesQuery(skill, q)` (case-insensitive over name, title, description), `filterSkills(skills, { q, group })` (`group: 'all' | 'none' | SkillGroup`) and `groupCounts(skills)` (counts per group, `none` only when > 0); `filterSkills.test.ts`

### Composables

- [X] T022 [P] [US1] Create `admin/slices/skill/composables/useSkillListQuery.ts` after `admin/slices/agent/agent/composables/useAgentTab.ts`: `q`, `group`, `sort` (`'custom' | 'recent'`) as computeds over `route.query`, `setQ` / `setGroup` / `setSort` via `router.replace` omitting defaults; `selectedSlug` with `select(slug)` via `router.push` and `clearSelection()` that calls `router.back()` when the last push was ours, else `replace` (contracts/skills-ui.md §URL state)
- [X] T023 [P] [US1] Create `admin/slices/skill/composables/useSkillLayout.ts`: `useMediaQuery('(min-width: 1280px)')` and `'(min-width: 768px)'` → `layout: 'desktop' | 'tablet' | 'phone'` (SSR-safe default `desktop`)

### Components (desktop column only; drawer / sheet come in US4)

- [X] T024 [P] [US1] Create `admin/slices/skill/components/skill/list/Summary.vue`: four figures from `librarySummary` with `data-skill-summary` + `data-count` / `data-tokens` / `data-edited-week` / `data-unused`; `≈` prefix on tokens; "last … ago" via `useRelativeTime(latestEdit)`; unused slugs in monospace; `grid-cols-2 md:grid-cols-4`
- [X] T025 [P] [US1] Create `admin/slices/skill/components/skill/list/SizeStrip.vue`: `role="group" aria-label="Skills by size, in list order"`, one `button` per skill (`data-skill-segment`, `aria-label="<slug>, <tokens> tokens"`, `title` the same), `style="flex: <tokens> 1 8px"`, group `strip` colour, `opacity-40` on non-selected when a selection exists, emits `select(slug)`; legend of `SKILL_GROUP_KEYS` labels + "Width shows size in tokens"
- [X] T026 [P] [US1] Create `admin/slices/skill/components/skill/list/Controls.vue`: `ListToolbar` with `ListSearch` (150 ms debounce via `useDebounceFn`, `aria-label="Search skills"`), group chips as `button`s with `aria-pressed` and counts (`All <n>` first, `Ungrouped` only when present) in a `flex gap-1.5 overflow-x-auto` row, and `ListSegments` for `Custom order | Recently edited` (a `<select>` below `md` lands in US4)
- [X] T027 [P] [US1] Create `admin/slices/skill/components/skill/list/Row.vue`: `li[data-skill-row=slug]` with `aria-current` when selected; handle `button` (`data-skill-handle`, `aria-label` per contract, `disabled` + `title="Reordering is off while sorted by edit time"` when `sort === 'recent'`), group `mark` bar, title `button` (bold) + slug `code`, description `line-clamp-2`, meta line: group `chip`, `# <tokens> tokens`, templates text (`<name>` | `<n> templates` with `title` listing them | `Not in any template` in `text-amber-700`), `<time :datetime :title="formatDateTime(updatedAt)">Edited <relative></time>` with a green dot when `isRecent`, Edit `NuxtLink` to `/skills/:id/edit`; `overflow-wrap: anywhere` on the slug; emits `select`
- [X] T028 [P] [US1] Create `admin/slices/skill/components/skill/list/States.vue`: `data-skill-state="loading"` (summary skeleton + 6 row skeletons from the theme `Skeleton`), `error` (message + Retry button), `empty` (text + New skill / Import from GitHub links), `no-match` (`No skills match` + `Clear search and filters` button); props `state`, emits `retry`, `clear`
- [X] T029 [P] [US1] Create `admin/slices/skill/components/skill/panel/Activity.vue`: list of `activityOf(skill)` entries, label per kind (`Created`, `Imported from GitHub`, `Last edited`), `<time>` with relative text and absolute `title`
- [X] T030 [US1] Create `admin/slices/skill/components/skill/panel/Panel.vue` (`data-skill-panel`): group chip, title, `code` path `.agent/skills/<slug>/` + `Copy path` button (`navigator.clipboard.writeText`, label `Copied` for 2 s, `data-action="copy-path"`), three metrics (Tokens with `<n>% of library` from `tokenEstimate / totalTokens`, Files `filesCount` "besides body", Created `formatDate`), full description, `Used in templates` chips as `NuxtLink`s to `/templates/:id` (or `Not in any template`), `<SkillPanelActivity>`, footer with `Edit skill` link and a `Delete` button that emits `delete` (inline confirm is US5); empty state `Pick a skill to see its details` when no skill
- [X] T031 [US1] Create `admin/slices/skill/components/skill/panel/Host.vue` with the desktop host only for now: `aside.hidden.xl:block.w-[380px].shrink-0.sticky.top-4.max-h-[calc(100vh-2rem)].overflow-y-auto` rendering `Panel` with `data-host="column"`; props `skill`, `layout`; slots for drawer / sheet added in US4
- [X] T032 [US1] Rewrite `admin/slices/skill/components/skill/list/Provider.vue`: header as today; `useAsyncData('admin-skills', () => skillStore.fetchAll())` for `pending` / `error` / `refresh` only; `useSkillListQuery`, `useSkillLayout`; computeds `ordered` (by `sortOrder` or `updatedAt desc`), `visible` (filterSkills), `summary`, `counts`; `selectedSkill = byName(selectedSlug) ?? (layout === 'desktop' ? visible[0] : null)` with an unknown slug cleared; layout `div.flex.gap-6` → `main.min-w-0.flex-1` (Summary, SizeStrip, Controls, `ul[data-skill-list]` of Rows, States) + `Host`; the list keeps `min-w-[560px]` only inside `xl:`; no horizontal overflow (`min-w-0` on the column, `overflow-x-hidden` on the page root)
- [X] T033 [US1] Replace the old `ConfirmDialog` delete flow in the rewritten Provider with a temporary call to `useConfirmStore().ask` so Delete keeps working until US5 lands; keep `admin/slices/skill/pages/skills/index.vue` as is
- [X] T034 [US1] Verify US1 by quickstart §1 and §6 at 1440 px; `cd admin && bun test slices/skill && npx nuxt typecheck && cd .. && bun run locale:check`; restore `app/slices/setup/api/**` if touched

**Checkpoint**: desktop library works end to end against the real API; a shared link reproduces search, group, sort and selection.

---

## Phase 4: User Story 2 — Put the library in a deliberate order, shared by everyone (Priority: P2)

**Goal**: drag with mouse or keyboard, badges, pending bar with Discard / Save order, atomic save with a 409 on concurrent change, rollback on failure, leave guard; `reorder_skills` tool.

**Independent Test**: spec US2 scenarios 1–8, quickstart §2, `e2e/reorder.mjs`.

### API

- [X] T035 [P] [US2] Create `api/src/slices/skill/domain/skillOrder.service.ts` with `version(items)` (sha1 over `id:sortOrder` lines sorted by id, `node:crypto`), `read()` → `{ version, items }`, `save(version, items)` (validates a full permutation with distinct `sortOrder` → `BadRequestException`, calls the gateway's transactional write, rethrows `ConflictException({ statusCode: 409, code: 'ORDER_CHANGED', message: 'The library order changed since you loaded it.' })` on mismatch), `reorderByNames(names)` → `{ order: { name, position }[], unknown: string[] }`; register in `api/src/slices/skill/skill.module.ts` providers + exports
- [X] T036 [P] [US2] Extend `api/src/slices/skill/domain/skill.gateway.ts` and `api/src/slices/skill/data/skill.gateway.ts` with `readOrder()` (select `id, sortOrder` ordered by `sortOrder, name`) and `writeOrder(expectedVersion, items, version)` inside `prisma.$transaction`: `SELECT id, "sortOrder" FROM "Skill" FOR UPDATE` via `$queryRaw`, compare `version(rows)` to `expectedVersion` (throw a typed `OrderChangedError` the service maps to 409), then one `$executeRaw` `UPDATE "Skill" AS s SET "sortOrder" = v.ord FROM unnest(${ids}::text[], ${orders}::int[]) AS v(id, ord) WHERE s.id = v.id` (R4; `updatedAt` untouched)
- [X] T037 [P] [US2] Create DTOs `api/src/slices/skill/dtos/skillOrder.dto.ts` (`SkillOrderItemDto { id, sortOrder }`, `SkillOrderDto { version, items }`) and `saveSkillOrder.dto.ts` (`SaveSkillOrderDto { @IsString version; @ValidateNested({ each: true }) @Type(() => SkillOrderItemDto) items }`); export from `dtos/index.ts`
- [X] T038 [US2] Add to `api/src/slices/skill/skill.controller.ts`, **above** `GET ':id'`: `@Get('order') @ApiOperation({ operationId: 'getSkillOrder' })` → `order.read()` and `@Patch('order') @ApiOperation({ operationId: 'saveSkillOrder' })` → `order.save(dto.version, dto.items)`; inject `SkillOrderService`
- [X] T039 [P] [US2] Write `api/src/slices/skill/domain/skillOrder.service.spec.ts`: version is stable under item reordering, differs when a `sortOrder` changes; `save` rejects a missing / duplicated id and duplicate `sortOrder` with 400; a gateway `OrderChangedError` becomes a 409 with `code: 'ORDER_CHANGED'`; `reorderByNames(['b'])` over `[a, b, c]` writes `[b, a, c]` and reports unknown names
- [X] T040 [US2] Add `reorder_skills` to `api/src/slices/skill/skill.tool.ts` per `contracts/agent-tools.md` (operator-only, `destructive: false`, `names: string[]`, calls `SkillOrderService.reorderByNames`, returns `ok({ order, unknown })`, a 409 becomes `ok({ error: 'The order changed while reordering — try again' })`); inject the service; extend `api/src/slices/skill/skill.tool.spec.ts` with: not listed for a plain agent, forbidden without operator, happy path, unknown name, 409 mapped
- [X] T041 [US2] Regenerate and gate: `cd api && bun run build && bun run generate:swagger && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/skill && npx eslint --quiet src/slices/skill`; `cd admin && bun run build:api` (SDK gains `getSkillOrder`, `saveSkillOrder`)

### Admin logic with tests

- [X] T042 [P] [US2] Create `admin/slices/skill/utils/reorder.ts`: `moveVisible(fullOrder: string[], visibleIds: string[], from: number, to: number): string[]` (visible rows take the new relative order, hidden rows keep their indices), `orderDiff(saved: string[], draft: string[])` → `{ byId: Record<id, delta>, movedCount }` (delta = savedIndex − draftIndex; badge `↑n` for positive, `↓n` for negative), `toOrderItems(order)` → `{ id, sortOrder }[]` (1-based); `reorder.test.ts` covers the brief's two unit cases (move inside a filtered list; diff for badges) plus edge rows at both ends
- [X] T043 [US2] Extend `admin/slices/skill/domain/skill.gateway.ts`, `skill.service.ts`, `data/skill.gateway.ts`, `data/skill.mapper.ts`: `fetchOrder()` → `ISkillOrder`, `saveOrder(order)` → `ISkillOrder`; the data gateway maps an axios 409 with `code === 'ORDER_CHANGED'` to a thrown `ISkillOrderConflict` and rethrows everything else
- [X] T044 [US2] Extend `admin/slices/skill/stores/skill.ts` with `order: { version: string | null; saved: string[]; draft: string[] | null }`; `fetchAll` then `fetchOrder` fills `saved` + `version`; `moveDraft(from, to, visibleIds)` via `moveVisible`; `discardOrder()`; `saveOrder()` (PATCH; success → `saved = draft`, `draft = null`, write `sortOrder` into items, keep new `version`; `ISkillOrderConflict` → `await fetchAll()` then rethrow; other error → `draft = null` then rethrow); `remove` drops the id from `saved` / `draft`; `movedCount` / `orderDiff` as getters

### Admin interaction

- [X] T045 [US2] Create `admin/slices/skill/composables/useSortableList.ts` (R1): `useSortableList({ listEl, itemSelector: '[data-skill-row]', handleSelector: '[data-skill-handle]', enabled, touchHoldMs: 200, onMove })` — pointer events with `setPointerCapture`, long-press timer on `pointerType === 'touch'`, `dragging` index, `dropIndex` from `elementFromPoint` midpoint test, `indicatorTop` for the 3 px line, cancel on `Escape` / `pointercancel`; keyboard: `moveBy(index, delta)` exported for the handle's ↑/↓; stay under ~250 lines or switch to `vue-draggable-plus` as research says
- [X] T046 [P] [US2] Create `admin/slices/skill/components/skill/list/OrderBar.vue` (`data-skill-order-bar`): `List order changed: <n> position(s) moved`, `Discard` (`data-action="discard"`) and `Save order` (`data-action="save-order"`, disabled while saving); sticky above the list on desktop, fixed bottom on phone (class via prop)
- [X] T047 [US2] Wire reordering into `admin/slices/skill/components/skill/list/Provider.vue` and `Row.vue`: `useSortableList` enabled only when `sort === 'custom'` (and, on phone, `reorderMode` — US4); dragged row `opacity-50 motion-reduce:transition-none`, `div[data-skill-drop-indicator]` positioned at `indicatorTop` with `h-[3px] bg-primary`; handle `@keydown.up/.down` → `moveBy`; `aria-live="polite"` region `data-skill-live` set to `<slug> moved to position <x> of <n>` after each move; `data-moved` badge on rows from `orderDiff`; `OrderBar` when `draft` exists; Save → `toast.success('Order saved')`; `ISkillOrderConflict` → `toast.warning('Someone else changed the order. The list was reloaded.')`; other error → `toast.error('Could not save the order')`
- [X] T048 [US2] Add the leave guard to `admin/slices/skill/components/skill/list/Provider.vue`: `onBeforeRouteLeave` → `useConfirmStore().ask({ title: 'Discard unsaved order?', … })` when `draft` exists (pattern: `admin/slices/agent/template/components/template/item/Provider.vue`), plus a `beforeunload` listener registered while dirty
- [X] T049 [US2] Write `specs/025-skills-redesign/e2e/reorder.mjs` at 1440 px: mouse-drag row 1 below row 3 → badge + bar text; Save → toast and `GET /skills/order` reflects it; keyboard ↓ on a handle → live-region text; Discard → original order; `page.route('**/skills/order', 500)` → rollback + error toast; `page.route(… 409 { code: 'ORDER_CHANGED' })` → reload message; print PASS/FAIL
- [X] T050 [US2] Run quickstart §2 by hand (two browser profiles for the shared order and the 409) and `cd admin && bun test slices/skill && npx nuxt typecheck`; confirm `updatedAt` did not change after a save (`SELECT name, "updatedAt" FROM "Skill"`)

**Checkpoint**: the order survives reload for every admin, agents and templates untouched, the agent can `reorder_skills`.

---

## Phase 5: User Story 3 — Create or edit a skill with confidence (Priority: P2)

**Goal**: the new form with Title → slug generation, live validation incl. server uniqueness, Group select, 140-counter, body counters, sticky preview, local draft, Ctrl/Cmd+S, leave guard, redirect with `?skill=`; `group` reaches the agent tools.

**Independent Test**: spec US3 scenarios 1–9, quickstart §3, `e2e/form.mjs`.

### API

- [X] T051 [P] [US3] Create `api/src/slices/skill/dtos/nameAvailable.dto.ts` (`NameAvailableQueryDto { @Matches(SLUG) name; @IsOptional() @IsString() excludeId? }`, `NameAvailableDto { name, available, existingId? }`) and add `@Get('name-available') @ApiOperation({ operationId: 'skillNameAvailable' })` to `api/src/slices/skill/skill.controller.ts` above `GET ':id'`, using `gateway.findByName`
- [X] T052 [P] [US3] In `api/src/slices/skill/skill.controller.ts` wrap `create` and `update` so a Prisma `P2002` on `name` becomes `ConflictException({ statusCode: 409, code: 'SKILL_EXISTS', message, existing: { id, name, title } })` (R13); a small `isUniqueNameViolation(err)` helper in `api/src/slices/skill/domain/skillErrors.ts`
- [X] T053 [P] [US3] Add `group: z.enum(SKILL_GROUPS).nullable().optional()` to `update_skill` in `api/src/slices/rancher/rancher.tool.ts` and to `create_skill` in `api/src/slices/skill/skill.tool.ts`; extend `api/src/slices/rancher/rancher.tool.spec.ts` (`group: 'routing'` passed, `null` clears) and `api/src/slices/skill/skill.tool.spec.ts` (`create_skill` passes `group`)
- [X] T054 [US3] Write `api/src/slices/skill/skill.controller.spec.ts` for `nameAvailable` (free / taken / taken-but-excluded / bad slug 400) and the 409 mapping on create; then `cd api && bun run build && bun run generate:swagger && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/skill src/slices/rancher && npx eslint --quiet src/slices/skill src/slices/rancher/rancher.tool.ts`; `cd admin && bun run build:api`

### Admin logic with tests

- [X] T055 [P] [US3] Create `admin/slices/skill/utils/slugify.ts` (`lowercase → [^a-z0-9]+ → '-' → collapse → trim`) with `SLUG_RE` and `slugError(value)` → `'Name is required' | 'Use lowercase letters, digits and dashes' | null`; `slugify.test.ts` (`DevOps Engineer!` → `devops-engineer`, leading digits kept, dashes collapsed, empty → `''`)
- [X] T056 [P] [US3] Create `admin/slices/skill/utils/tokens.ts` (`estimateTokens`, same three fixtures as the API) and `countLines(body)`; `tokens.test.ts`
- [X] T057 [P] [US3] Create `admin/slices/skill/composables/useSkillDraft.ts`: `useLocalStorage('admin.skill.draft.<userId>.<slug|new>', null)` with `userId = useAuthStore().user?.id` (no user → no-op), `save(values)` debounced 500 ms stamping `savedAt`, `restore()`, `clear()`, `savedAt` ref for the header label; keyed by the slug at save time, re-keyed when the slug changes
- [X] T058 [US3] Extend `admin/slices/skill/domain/skill.gateway.ts`, `skill.service.ts`, `data/skill.gateway.ts`, `data/skill.mapper.ts` with `isNameAvailable(name, excludeId?)` → `{ available, existingId? }`; `stores/skill.ts` passthrough `isNameAvailable`; the data gateway maps a 409 `SKILL_EXISTS` from `create` / `update` to a thrown `ISkillExistsConflict` (type already exists)

### Admin form

- [X] T059 [US3] Create `admin/slices/skill/components/skill/item/SlugField.vue`: `Label for="name"`, `Input id="name"` with `aria-invalid` and `aria-describedby="name-hint"`, hint `Folder: .agent/skills/<slug>/` or the error / `This name is taken` / (edit mode, changed) `Renaming moves the folder to .agent/skills/<slug>/ in every agent on the next redeploy.`; availability check via `useDebounceFn(300)` → `store.isNameAvailable` with a request counter so only the latest answer applies; emits `update:modelValue`, `touched`, `validity`
- [X] T060 [P] [US3] Create `admin/slices/skill/components/skill/item/RowPreview.vue` (`data-skill-preview="row"`): the `Row.vue` look for unsaved values (title, slug, description clamp, group chip, `≈ <tokens> tokens · not in any template · not saved yet`), no handle, no Edit
- [X] T061 [P] [US3] Create `admin/slices/skill/components/skill/item/Preview.vue` (`data-skill-preview="markdown"`): `renderMarkdown(body)` from `#bridle/utils/markdown` in `div.chat-md`, recomputed with `watchDebounced(body, …, { debounce: 200 })`, title `What the agent reads`
- [X] T062 [US3] Rewrite `admin/slices/skill/components/skill/item/Form.vue`: fields in order Title (`id="title"`), `SlugField`, Group `Select` (`id="group"`, options from `SKILL_GROUP_KEYS` + `No group`), Description `Textarea` with `data-description-count` `N / 140` turning `text-destructive` plus hint past 140, Body `Textarea.font-mono` with `data-body-lines` / `data-body-tokens`; slug auto-fills from title until `touched`; `valid` computed (title, slug validity incl. availability, body); emits `submit` only when valid and no check in flight (awaits it); sticky right column (`lg:grid-cols-[1fr_380px]`, `lg:sticky lg:top-4`) with `RowPreview`, `Preview`, and the Templates note card (`A new skill is not in any template…` on create; template chips read-only on edit); below `lg` a `Tabs` `Write | Preview` above the editor and `RowPreview` under the form; header slot for the actions
- [X] T063 [US3] Rewrite `admin/slices/skill/components/skill/create/Provider.vue`: breadcrumbs `Skills / New skill`, header with `Draft · edited <relative>` (`data-skill-draft`), `Cancel` (`data-action="cancel"`) and `Create skill` (`data-action="submit"`, disabled while invalid); `useSkillDraft` restore on mount and save on change; `onKeyStroke` Ctrl/Cmd+S → submit; `onBeforeRouteLeave` + `beforeunload` guard while dirty; on success `draft.clear()`, `toast.success('Skill <slug> created')`, `navigateTo({ path: '/skills', query: { skill } })`; a 409 `SKILL_EXISTS` surfaces as the slug field error; below `md` the two buttons are `fixed bottom-0` in a bar with safe-area padding
- [X] T064 [US3] Update `admin/slices/skill/components/skill/edit/Provider.vue`: same layout (`Skills / <title>`, `Cancel` / `Save changes`), slug editable with the rename warning, no draft, leave guard while dirty, Ctrl/Cmd+S; after save keep the existing `SkillRedeployDialog` flow and close to `/skills?skill=<slug>`; `SkillEditFilesCard` stays
- [X] T065 [US3] Write `specs/025-skills-redesign/e2e/form.mjs`: title → slug and hint; manual slug then title change → slug unchanged; `Bad Slug!` → error + disabled submit; an existing slug → `This name is taken`; reload mid-way → draft restored and label shown; Ctrl+S → redirect to `/skills?skill=…` and toast
- [X] T066 [US3] Run quickstart §3 and §7 (agent `update_skill` with a group); `cd admin && bun test slices/skill && npx nuxt typecheck && cd .. && bun run locale:check`

**Checkpoint**: a skill can be created and edited through the new form; group shows up in the library and through the agent.

---

## Phase 6: User Story 4 — Tablet and phone without losing the list (Priority: P3)

**Goal**: drawer at 768–1279, cards + bottom sheet + Reorder mode below 768, no horizontal scroll at the five widths, reduced motion honoured.

**Independent Test**: spec US4 scenarios 1–5, quickstart §4, `e2e/drawer.mjs` and `e2e/sheet.mjs`.

- [X] T067 [US4] Extend `admin/slices/skill/components/skill/panel/Host.vue` with the two other hosts: `tablet` → `Sheet` + `SheetContent side="right" class="w-[min(420px,90vw)] sm:max-w-none motion-reduce:animate-none motion-reduce:transition-none"` (`data-host="drawer"`); `phone` → `SheetContent side="bottom" class="h-[90vh] rounded-t-xl …"` (`data-host="sheet"`) with a grab handle `button[aria-label="Close details"]` whose pointer drag of > 80 px down closes it; `open = layout !== 'desktop' && !!skill`; `@update:open=false` → emit `close` (the Provider calls `clearSelection()`); `SheetTitle` = skill title for the dialog name; focus returns to the row's title button via the Sheet's trigger ref passed from the Provider
- [X] T068 [US4] In `admin/slices/skill/components/skill/list/Row.vue` add the phone card variant (`layout === 'phone'`): stacked title / slug, description clamp, wrapping meta, and a `DropdownMenu` `⋯` trigger `button.size-11` (`data-skill-menu`, `aria-label="More actions for <slug>"`) with `Edit` and `Delete` items; hide the inline Edit button and the handle unless `reorderMode`
- [X] T069 [US4] In `admin/slices/skill/components/skill/list/Controls.vue` render sort as a `<select id="sort">` with a label below `md`, keep chips in one scrolling row (`snap-x`, `-mx-4 px-4`), and add a `Reorder` toggle button (`data-action="reorder-mode"`, phone + custom sort only) emitting `toggle-reorder`
- [X] T070 [US4] In `admin/slices/skill/components/skill/list/Provider.vue`: `reorderMode` ref (phone only; drag enabled = `sort === 'custom' && (layout !== 'phone' || reorderMode)`), `OrderBar` pinned (`fixed bottom-0 inset-x-0`) with `Cancel` / `Save order` while in reorder mode, leaving the mode discards the draft after the same confirm; `Summary` already `grid-cols-2` below `md`; page root `overflow-x-hidden`, every slug `break-anywhere`; all touch targets ≥ 44 px (`min-h-11` on row buttons below `md`)
- [X] T071 [US4] Reduced motion pass: `motion-reduce:` variants on the dragged row and drop indicator in `admin/slices/skill/components/skill/list/Row.vue` and `Provider.vue`, on both Sheet contents in `admin/slices/skill/components/skill/panel/Host.vue`, and on the `Copied` swap in `admin/slices/skill/components/skill/panel/Panel.vue`; verify with the devtools "Emulate CSS prefers-reduced-motion"
- [X] T072 [P] [US4] Write `specs/025-skills-redesign/e2e/drawer.mjs` at 1024×800: no `?skill` → no `[data-host="drawer"]`; click a row → drawer with `role="dialog"` and `data-host="drawer"`; Esc closes, `document.activeElement` is the row's title button, URL has no `skill`; backdrop click and Back also close; `scrollWidth === clientWidth`
- [X] T073 [P] [US4] Write `specs/025-skills-redesign/e2e/sheet.mjs` at 390×844: cards present, `⋯` button is 44×44, tap → bottom sheet `data-host="sheet"` ≥ 85 % of viewport height, close button closes; `Reorder` → handles visible and the pinned bar; `scrollWidth === clientWidth`; chips row scrolls horizontally without page overflow
- [ ] T074 [US4] Measure quickstart §4 at 390 / 768 / 1024 / 1280 / 1440 (`scrollWidth`, list width with the panel open ≥ 560 at ≥ 1280) and record the five numbers for the PR

**Checkpoint**: the list is the priority on every width; the panel never squeezes it.

---

## Phase 7: User Story 5 — Delete a skill from its panel, without a modal (Priority: P3)

**Goal**: inline Keep / Delete in the panel naming the templates, neighbour selected afterwards; the phone menu uses the same confirmation.

**Independent Test**: spec US5 scenarios 1–3, quickstart §5.

- [X] T075 [US5] Create `admin/slices/skill/components/skill/panel/DeleteInline.vue` (`data-skill-delete-confirm`): text `Delete <slug>? It is removed from <A> and <B>.` (two names joined by `and`, three or more as `A, B and C`; none → `Delete <slug>? It is not in any template.`), buttons `Keep` (`data-action="keep"`) and `Delete` (`data-action="delete"`, `variant="destructive"`, disabled while deleting); focus moves to `Keep` when shown and back to the Delete button on Keep
- [X] T076 [US5] Wire it into `admin/slices/skill/components/skill/panel/Panel.vue` (replaces the footer while confirming) and `admin/slices/skill/components/skill/list/Provider.vue`: compute `neighbourOf(slug)` from `visible` (next, else previous, else none) before calling `skillStore.remove(id)`, then `select(neighbour)` or `clearSelection()`; the phone `⋯ → Delete` opens the sheet with the confirmation already showing; remove the temporary `useConfirmStore` delete from T033; `toast.success('Skill <slug> deleted')`
- [X] T077 [US5] Run `specs/025-skills-redesign/quickstart.md` §5 (middle, last, only skill) and confirm `/templates/:id` no longer lists the deleted skill; `cd admin && npx nuxt typecheck`

**Checkpoint**: all five stories work independently and together.

---

## Phase 8: Polish & cross-cutting

- [ ] T078 [P] Accessibility pass on both pages: every icon-only button has `aria-label`, chips / segments / handles are real `button`s, focus ring visible, the five group chip colour pairs and the muted meta text measure ≥ 4.5:1 (adjust classes in `admin/slices/skill/domain/skill.groups.ts` if not); run a Lighthouse / axe check on `/skills` and `/skills/create` and fix what it reports
- [X] T079 [P] Update `README.md` (Skills section) and `docs/agent-tools.md` (table row for `reorder_skills`, `group` on `update_skill` / `create_skill`) in one short paragraph each
- [X] T080 Full gate run and PR: `cd api && bun run build && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/skill src/slices/rancher && npx eslint --quiet src/slices/skill src/slices/rancher/rancher.tool.ts`; `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check`; all four e2e scripts; restore `app/slices/setup/api/**` and `.specify/feature.json` to HEAD if they show as modified; commit(s) `feat(skill): …(CLEAN-205)`; push over HTTPS with the token recipe from memory; open the PR into `main` with: ticket link, the commands run, the twin-console statement ("app has no skill slice; admin common / bridle imported, not changed"), the hidden-for-lack-of-backend list (five-event Activity history — no audit log), the five width measurements and the e2e output; put the PR URL on CLEAN-205 and move it to In Testing (transition 51)

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: T001 before everything; T002 only gates the e2e tasks (T049, T065, T072, T073).
- **Phase 2 is blocking**: T003–T011 (API) then T012–T016 (admin, needs the regenerated SDK from T011). T005 / T006 are parallel to T003–T004; T007 needs T005; T008–T010 need T006–T007; T012–T014 are parallel after T011; T015 needs T013–T014; T016 needs T015.
- **US1 (Phase 3)**: T017–T023 all parallel after Phase 2; T024–T029 parallel after their utilities; T030 needs T020 / T029; T031 needs T030; T032 needs everything above it; T033–T034 last.
- **US2 (Phase 4)**: API T035–T037 parallel, T038 after them, T039–T040 after T035, T041 closes the API side; admin T042 parallel with the API; T043 after T041; T044 after T042 + T043; T045–T046 parallel after T044; T047 after T045 + T046 and after US1's Provider (T032); T048–T050 after T047.
- **US3 (Phase 5)**: API T051–T053 parallel, T054 closes; admin T055–T057 parallel with the API; T058 after T054; T059 after T055 + T058; T060–T061 parallel after T056; T062 after T059–T061; T063–T064 after T062 (T063 also needs T057); T065–T066 last. US3 does not depend on US2.
- **US4 (Phase 6)**: needs US1 (T030–T032); T067–T069 parallel; T070 needs T069 and US2's T047 for the reorder mode; T071–T074 after T070.
- **US5 (Phase 7)**: needs US1's Panel (T030) and Provider (T032); independent of US2–US4 except the phone menu path from T068.
- **Polish (Phase 8)**: after the stories you ship.

### Parallel example — Phase 2 (API side)

```text
T005 skill.groups.ts   |  T006 tokens.ts + spec   (parallel, after T003–T004)
T007 types → T008 mapper → T009 gateway → T010 DTOs → T011 regen
```

### Parallel example — US1 utilities and components

```text
T017 formatTokens | T018 editTime | T019 summary | T020 activity | T021 filterSkills | T022 useSkillListQuery | T023 useSkillLayout
T024 Summary | T025 SizeStrip | T026 Controls | T027 Row | T028 States | T029 Activity
→ T030 Panel → T031 Host → T032 Provider → T033 → T034
```

### Parallel example — US2 API vs admin

```text
API:   T035 | T036 | T037  →  T038  →  T039 | T040  →  T041
Admin: T042 (while the API is in flight)  →  T043 (after T041)  →  T044  →  T045 | T046  →  T047  →  T048 → T049 → T050
```

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 + Phase 2 (one migration, richer entity, store refactor) — the API already serves every field the library needs.
2. Phase 3 — the desktop library. Stop, run quickstart §1 and §6, demo. This alone replaces the old table with the summary, strip, search, chips, sort and panel.

### Incremental delivery

3. US3 (form) next if the team wants group data entered before order matters; otherwise US2 (shared order) — the two are independent and can run in parallel on separate branches stacked on the MVP.
4. US4 (responsive hosts) once the Provider and Panel are stable; US5 (inline delete) any time after US1.
5. Phase 8 before the PR.

### Notes

- Keep every `[P]` task in its own file to avoid same-file conflicts; the Provider (T032 / T047 / T070 / T076) is the one file four stories touch, so land those in order.
- Commit per logical group with `(CLEAN-205)`; Jira gets a checkpoint comment at the end of each phase (large task rule).
- If `useSortableList` grows past ~250 lines (T045), switch to `vue-draggable-plus` as research R1 allows, and say so in the PR.
