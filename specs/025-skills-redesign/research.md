# Research: Skills library redesign (CLEAN-205)

Every unknown from the Technical Context, resolved. Each entry: decision, why, what else was weighed.

## R1 — Drag-and-drop

**Decision**: a pointer-events composable in the slice, `admin/slices/skill/composables/useSortableList.ts`. It owns: `pointerdown` on the handle (immediate on mouse, after a 200 ms hold on touch so a scroll gesture is not a drag), `setPointerCapture`, the dragged index and the current drop index from `elementFromPoint` over the row list, the 3 px indicator position, `pointerup` → `onMove(from, to)`. Keyboard is separate and trivial: ↑/↓ on the focused handle call the same `onMove(i, i±1)`. The pure part — `moveVisible(fullOrder, visibleIds, from, to)` and `orderDiff(saved, draft)` — lives in `utils/reorder.ts` with bun tests.

**Rationale**: nothing in either console does list sorting (`d3-drag` is a transitive dependency of the charts and is element dragging, not sorting; `@vueuse/core`'s `useDraggable` likewise). dnd-kit, which the brief names, has no Vue build. The brief's behaviours (keyboard moves with announcements, an insertion line, badges from a diff against the saved order, reorder within a filtered view, a touch hold, a mobile Reorder mode) are exactly the parts a library does not give, so a wrapper would be most of the code anyway. Pointer Events work the same for mouse, pen and touch and avoid the HTML5 DnD API's touch gaps.

**Alternatives**: `vue-draggable-plus` / `sortablejs` (moves DOM nodes itself, fights `v-for` keys, no keyboard, new dependency); `@vueuse/integrations` `useSortable` (same SortableJS underneath, package not installed); HTML5 `draggable` (no touch on iOS without polyfill, ghost image hard to style).

**Guard rail**: if the composable passes ~250 lines or needs auto-scroll while dragging, stop and switch to `vue-draggable-plus`; the pure utilities and the keyboard path stay as they are.

## R2 — Group: storage, list, colours

**Decision**: `Skill.group String?` (not a Postgres enum) validated in the DTO with `@IsIn(SKILL_GROUPS)` and `@ApiProperty({ enum: SKILL_GROUPS })`, keys `api`, `routing`, `spec-lookup`, `answer-format`, `runtime`. The API's `domain/skill.groups.ts` is the validation source. The admin's `domain/skill.groups.ts` holds key → `{ label, chip, mark, strip }` Tailwind classes and is declared `satisfies Record<SkillGroup, …>` against the generated `SkillGroup` type, so adding a key on one side fails the other's typecheck. Ungrouped skills render as "Ungrouped" with neutral classes and get a chip only while any exist (spec assumption).

**Rationale**: a string column changes without a migration when the product renames a group; the enum in Swagger gives the console a typed union for free. Colours are a console concern.

**Alternatives**: Prisma `enum SkillGroup` (every rename is a migration); `GET /skills/groups` (still leaves labels and colours client-side; one more request for nothing).

**Colour pairs** (light, 4.5:1 on their chip background, each with a `dark:` twin): API blue, Routing violet, Spec lookup green, Answer format amber, Runtime slate. They are classes in the config, not computed; the contrast is checked once in the a11y pass (SC-008).

## R3 — Token estimate

**Decision**: `Skill.tokenEstimate Int @default(0)`, computed in `domain/tokens.ts` as `Math.ceil(body.length / 4)` and written by the gateway on create, on update when `body` is present, and on import (both paths go through `create`/`update`). The migration backfills `CEIL(LENGTH(body) / 4.0)`. The admin copies the formula in `utils/tokens.ts` for the live editor counter; both test files share the same three fixtures (empty, 7 chars → 2, 4000 chars → 1000). `formatTokens(n)` renders `880`, `1.7k`, `18.9k` — one decimal under 10k, none above.

**Rationale**: no tokenizer exists in the repo and the brief allows the 4-chars rule. Server-side so the list and summary never disagree with the stored value; client-side only for a counter that updates per keystroke.

**Alternatives**: `gpt-tokenizer` / `tiktoken` (new dependency, model-specific, slow in the browser); counting files too (the brief sizes the body; files are a count).

## R4 — Shared order: column, atomic save, 409

**Decision**: `Skill.sortOrder Int @default(0)` with `@@index([sortOrder])`; `findAll` orders by `sortOrder asc, name asc`. New skills (create and both imports) take `max(sortOrder) + 1` in the same transaction as the insert. `GET /skills/order` returns `{ version, items: [{ id, sortOrder }] }` where `version` is `sha1` of the `id:sortOrder` pairs sorted by id. `PATCH /skills/order` takes `{ version, items }`; inside one `prisma.$transaction` the service locks the rows (`SELECT id, "sortOrder" FROM "Skill" FOR UPDATE`), recomputes the hash, throws `ConflictException({ code: 'ORDER_CHANGED' })` on mismatch, validates that `items` is a permutation of all ids with distinct `sortOrder`, then writes with one statement:

```sql
UPDATE "Skill" AS s SET "sortOrder" = v.ord
FROM unnest($1::text[], $2::int[]) AS v(id, ord)
WHERE s.id = v.id
```

**Rationale**: raw SQL sidesteps Prisma's `@updatedAt` so a reorder never looks like an edit (the brief's "Edited 3 h ago" would otherwise lie for the whole library). A hash over the pairs is a version marker that needs no extra table or column, and comparing it under `FOR UPDATE` is what makes "someone else changed it" a reliable 409 rather than a race. `items` carries the full permutation so the server does not have to merge partial orders.

**Alternatives**: `orderVersion` column on a singleton table (a new table for one integer); `updatedAt`-based version (moves on edits that are not reorders, so false 409s); fractional ranks (no need, the list is small and the client sends the whole order).

## R5 — Templates and files count on the list

**Decision**: `findAll` and `findById` include `templates: { select: { id, name } }`; the entity gains `templates: { id, name }[]` and `filesCount` (mapper: `files.length`). The list keeps returning `body` and `files` (slimming the list response is a separate change; the brief does not ask for it).

**Rationale**: the relation already exists; one include replaces a client-side join against the template store and keeps "Used in templates" and "Not used" derived from one fact.

## R6 — Activity without an audit log

**Decision**: client-side `utils/activity.ts` → `[{ kind: 'imported' | 'created', at: createdAt }, { kind: 'edited', at: updatedAt }]`, "Imported from GitHub" when `source` is set, and the "edited" entry only when `updatedAt` differs from `createdAt` by more than a second. No API change. The panel heading stays "Activity" so a future audit log slots in.

**Rationale**: the repo's `log` slice is pod logs; there is no event table for skills. The brief says to show Created and Last edited in that case; "imported" is derivable and the brief lists it as an event.

## R7 — URL state and Back

**Decision**: `useSkillListQuery` after `useAgentTab`: `q`, `group`, `sort` are written with `router.replace` (typing and filtering must not fill history); `skill` is written with `router.push` when the admin selects a row, strip segment or neighbour-after-delete, so Back closes the drawer / sheet or, on desktop, returns the panel to its default. Defaults (`sort=custom`, empty `q`, `group=all`, no `skill`) are omitted from the URL. On desktop the default selection (first skill) is implicit and carries no parameter. `skill` holds the slug (brief), resolved through `store.byName`; an unknown slug clears the parameter.

## R8 — Panel hosting: column, drawer, bottom sheet

**Decision**: `useSkillLayout` returns `'desktop' | 'tablet' | 'phone'` from `useMediaQuery('(min-width: 1280px)')` and `'(min-width: 768px)'`. `panel/Host.vue` renders the same `Panel.vue` in one of three hosts: a sticky `aside` (`hidden xl:block w-[380px] sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto`, 380 within the 360–400 band); `Sheet side="right"` with `class="w-[min(420px,90vw)] sm:max-w-none"`; `Sheet side="bottom"` with `class="h-[90vh] rounded-t-xl"` plus a grab handle whose pointer drag of more than 80 px downward closes it. Reka-ui Dialog supplies focus trap, Esc, overlay click, the close button and focus return to the trigger (the row's title button). Open state is `computed(() => layout !== 'desktop' && selectedId !== null)`; closing clears `?skill` via `router.back()` when the entry was pushed by us, else `replace`. `motion-reduce:animate-none motion-reduce:transition-none` on the sheet content and the dragged row honour reduced motion without touching the theme slice.

**Rationale**: one panel component, three hosts; the dialog primitive already in the theme gives the a11y behaviours the brief lists. Tailwind's `xl` is 1280 and `md` is 768, so the breakpoints are the brief's without configuration.

## R9 — Tests

**Decision**:
- Unit (admin, `bun test slices`): `slugify`, `reorder` (moveVisible with hidden rows, orderDiff badges and moved count), `editTime` (isRecent < 24 h, editedThisWeek, newest), `summary` (totals, not-used slugs), `activity`, `tokens` / `formatTokens`. Fixture-only, no DOM.
- Unit (api, jest): `tokens.spec.ts`, `skillOrder.service.spec.ts` (hash stability, 409 on mismatch, permutation validation, reorderByNames), controller-level `nameAvailable` and duplicate-name 409, `skill.tool.spec.ts` (`reorder_skills` listed for operators only, happy path, not-found) and `rancher.tool.spec.ts` (`update_skill` passes `group`).
- E2E: playwright-core scripts in `specs/025-skills-redesign/e2e/` reusing `lib.mjs` from CLEAN-102 (copied, not imported across spec folders): `reorder.mjs` (mouse drag + save, keyboard move with live text, Discard, forced 500 → rollback toast, forced 409 → reload message via a route-intercepted response), `drawer.mjs` at 1024 (open, Esc, focus back on the row), `sheet.mjs` at 390 (bottom sheet, Reorder mode, pinned bar), `form.mjs` (slug from title, bad slug, taken name, draft restore). Run by hand against `bun run dev`, results pasted into the PR. Playwright stays out of the repo, as `lib.mjs` documents.

**Rationale**: the repo has no component or browser test runner; the brief's unit list maps cleanly onto pure utilities, and the CLEAN-102 scripts are the established way to prove browser behaviour here.

## R10 — Form: slug, draft, shortcuts, leave guard

**Decision**: `utils/slugify.ts` (`lowercase → replace [^a-z0-9]+ with - → collapse → trim dashes`), applied from `title` while `slugTouched` is false. Validation is a computed over presence, `SLUG_RE`, and an `availability` ref fed by `useDebounceFn(300)` → `GET /skills/name-available?name=&excludeId=`; the last response wins (a request counter discards stale ones); submit awaits an in-flight check. Draft: `useLocalStorage(\`admin.skill.draft.${userId}.${slug || 'new'}\`)` on New skill only, where `userId` is `useAuthStore().user?.id` (`admin/slices/user/auth/stores/auth.ts`; without a user the draft is not written), with `savedAt` for the "Draft · edited N min ago" label through `useRelativeTime`; removed after create. Ctrl/Cmd+S via `onKeyStroke` from `@vueuse/core` with `preventDefault`. Leave guard: `onBeforeRouteLeave` → `useConfirmStore().ask(...)` exactly like `template/item/Provider.vue`, plus a `beforeunload` listener while dirty. The description counter is advisory; the server keeps accepting longer text.

## R11 — Markdown preview

**Decision**: `renderMarkdown(body)` from `#bridle/utils/markdown` with its default citation mode (`numbered`: a `[^n]` marker shows as a visible chip, which is the honest preview — `strip` would hide text the agent does read, and there is no "leave as is" mode in `bridle/utils/citations.ts`), rendered in a `div.chat-md` so the twin stylesheet styles it; preview re-renders through `watchDebounced(body, 200)`. Read-only import of a twin slice's utility; bridle is not modified.

## R12 — Agent tools (Constitution V)

**Decision**:
- `update_skill` (`rancher.tool.ts`): `group: z.enum(SKILL_GROUPS).nullable().optional()`; passes through to `ISkillGateway.update` like the other fields.
- `create_skill` (`skill.tool.ts`): optional `group`, same enum.
- `reorder_skills` (`skill.tool.ts`, operator-only, `destructive: false`): `names: string[]` — the named skills move to the front in that order, the rest keep their relative order; implemented as `SkillOrderService.reorderByNames(names)` which reads the current order with its version and saves through the same path as the controller (so a concurrent console save still 409s and the tool reports it). Result: the new order as `[{ name, position }]`. Template: "Put the skills «names» first in the library". Description says the order is the console's library order only and does not change what agents receive.
- `list_skills` needs no change: it returns the gateway entity, which now carries group, tokens, templates and files count.
- `delete_skill` already confirms and names the templates; unchanged.

**Rationale**: the doc's table — create/edit → a write tool with the DTO's fields, calling the same service. Reordering is a write the console can do, so it gets a tool rather than a waiver; it is cheap because the service exists for the controller.

## R13 — Duplicate names from the API

**Decision**: `POST /skills` and `PUT /skills/:id` catch Prisma `P2002` on `name` and answer `409 { code: 'SKILL_EXISTS' }` (the same code the import path uses), so the form can show the field error even when the debounced check lost a race. The agent tools get the same answer through the gateway.

## R14 — Where "Edited" comes from and the green dot

**Decision**: `updatedAt` as the server sends it; `useRelativeTime` (vueuse `useTimeAgoIntl`, already updating on its own interval) renders the text; `isRecent(updatedAt, now, 24h)` from `utils/editTime.ts` drives the dot and is unit-tested with a fixed `now`. Absolute text via `formatDateTime` from `#common/utils/format` in `title` and `<time :datetime>`; no `Intl` in components (locale check).
