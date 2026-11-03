# Implementation Plan: Skills library redesign

**Branch**: `feat/CLEAN-205-skills-redesign` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md) | **Ticket**: [CLEAN-205](https://dreamvention.atlassian.net/browse/CLEAN-205)

**Input**: Feature specification from `specs/025-skills-redesign/spec.md`

## Summary

Replace the admin Skills table and the New / Edit skill form with the "Skills Redesign" layout: a library summary with a token-size strip, search / group chips / sort held in the URL, a reorderable list whose order is shared by every admin, a skill panel that becomes a drawer on tablets and a bottom sheet on phones, inline delete, and a form with live slug validation, counters, a sticky preview and a local draft.

Technical approach: three additive columns on `Skill` (`group`, `sortOrder`, `tokenEstimate`) with a backfill migration; the list response gains `templates` (id, name) and `filesCount`; a `GET /skills/order` + `PATCH /skills/order` pair saves the whole order atomically with a version hash so a stale save gets a 409; `GET /skills/name-available` backs the slug check. In `admin/slices/skill` the store becomes the single record of each skill (`byId`, `upsert`, `patch`), four pure utilities carry the testable logic (slugify, reorder, edit time, order diff), a pointer-events composable does the dragging, and Reka-ui's Sheet does the drawer and the bottom sheet. The Ranch agent gets `group` on `update_skill` / `create_skill` and a new `reorder_skills` tool.

## Technical Context

**Language/Version**: TypeScript 5 everywhere. API: NestJS on Bun 1.4 (jest for specs). Admin: Nuxt 4 / Vue 3.5 / Pinia 3, Tailwind 4, shadcn-vue on reka-ui 2.9, `bun test` for unit tests.

**Primary Dependencies**: existing only — `@vueuse/core` 14 (`useMediaQuery`, `useLocalStorage`, `useDebounceFn`, `useTimeAgoIntl` via `useRelativeTime`), `reka-ui` Dialog/Sheet (focus trap, Esc, overlay, return focus), `vue-sonner` toasts, `marked` + `dompurify` through `#bridle/utils/markdown`, `lucide-vue-next` icons, Prisma 6 with `prisma-import`. No new package: see research R1 (drag-and-drop) and R9 (e2e).

**Storage**: PostgreSQL via Prisma. One migration: `20261103120000_skill_library_order` (add three columns, index on `sortOrder`, backfill order by `createdAt` and token estimate from `body`).

**Testing**: API — jest specs beside the code (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run test` while a dev API runs). Admin — `cd admin && bun test slices` for pure utilities (the only kind of admin test the repo has; no component test runner). E2E — playwright-core scripts under `specs/025-skills-redesign/e2e/` in the CLEAN-102 style (`specs/015-chat-message-reliability/e2e/lib.mjs`), run by hand against a local stack; Playwright is deliberately not a repo dependency. Gates: `bun run build` (api typecheck), `npx nuxt typecheck` (admin), `bun run locale:check`, `npx eslint --quiet <files>` (api).

**Target Platform**: admin console in a desktop browser first; tablet and phone widths are in scope (390 / 768 / 1024 / 1280 / 1440 are the acceptance widths). Tailwind's default breakpoints (`md` 768, `lg` 1024, `xl` 1280) match the brief exactly, so no theme change.

**Project Type**: web application — `api/` (NestJS slice `skill`, plus `rancher` for one tool) and `admin/` (Nuxt slice `skill`). `app/` has no skill slice and is untouched.

**Performance Goals**: the list is small (tens of skills, not thousands). Search debounce 150 ms, slug check debounce 300 ms, body counters and preview debounced so a 50 000-character body does not stall typing; relative times tick once a minute from one shared interval.

**Constraints**: no horizontal page scroll at any width; list ≥ 560 px while the panel is open; `updatedAt` must not move when only the order changes (so "Edited" stays honest); order save all-or-nothing; no `toLocale*` / `Intl.*` outside `#common/utils/format` (locale check); admin stays English-only; generated SDK types are regenerated, never hand-edited.

**Scale/Scope**: ~12 skills today, design for a few hundred; two admin pages rewritten, one API slice extended, one migration, one agent tool added and two extended.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| I. The slice is the unit | PASS | Everything lives in `api/src/slices/skill` and `admin/slices/skill`; the only sideways reach is one tool edit in `api/src/slices/rancher/rancher.tool.ts` (where `update_skill` already lives) and read-only imports of `#bridle/utils/markdown` and `#common` list/date components, both already imported by other slices. Nothing new goes into `common`. |
| II. Twin consoles | PASS | `skill` exists only in `admin`. No twin slice (`common`, `bridle`, …) is modified, only imported. The PR states: "app checked, has no skill slice; admin common/bridle untouched". |
| III. Secrets stay behind `api/` | PASS | No credential involved. |
| IV. One entity, one store | PASS | `useSkillStore` gains `byId` / `byName` / `upsert` / `patch`; list rows, summary, strip, panel, drawer and sheet all render from the store; `useAsyncData` keeps only `pending` / `error` / `refresh`; pending reorder is a store-level draft order with rollback, not component copies. |
| V. Console is a window, chat is the hands | PASS | New console capabilities and their tools: set a group → `update_skill` + `create_skill` gain `group`; reorder → new `reorder_skills` (operator-only, non-destructive, same `SkillOrderService` as the controller); the list already has `list_skills`, which now returns the new fields; delete already has `delete_skill` (confirm). Slug availability is a read the agent gets from `list_skills`. See `contracts/agent-tools.md`. |
| VI. English is the source | PASS | Admin is English-only; no `app` strings. |
| VII. A rule stays a rule | PASS | No model call. Token estimate is `ceil(chars / 4)`; group is a fixed list; order version is a hash. |
| Generated code is generated | PASS | API DTO changes → `bun run build && bun run generate:swagger` → `cd admin && bun run build:api`. No hand-written SDK types. |
| Tracker / surface | PASS | CLEAN-205, `[ADMIN]`; API changes are in service of the admin surface. |
| Quality gates | PLANNED | Commands listed in quickstart; twin check stated in the PR; every magic number carries its reason (research R-numbers). |

**Post-design re-check (after Phase 1)**: no new violation. The one copy-not-share decision (token formula and group list exist in both `api` and `admin`) is the repo's norm for cross-project code, kept honest by a TypeScript `satisfies` on the generated `SkillGroup` union and by identical fixtures in both test files (research R2, R3).

## Project Structure

### Documentation (this feature)

```text
specs/025-skills-redesign/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R14
├── data-model.md        # Phase 1: Skill columns, order version, admin shapes
├── quickstart.md        # Phase 1: how to run and verify
├── contracts/
│   ├── skills-api.md    # REST endpoints and DTOs
│   ├── skills-ui.md     # URL params, breakpoints, data-* hooks, a11y names
│   └── agent-tools.md   # tool metadata
├── e2e/                 # implementation phase: playwright-core scripts
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

`.specify/feature.json` is left at main's value on purpose (it is tracked and every parallel feature rewrites it, which makes PRs conflict); downstream SpecKit commands are given `specs/025-skills-redesign` explicitly.

### Source Code (repository root)

```text
api/
├── prisma/migrations/20261103120000_skill_library_order/migration.sql
└── src/slices/
    ├── skill/
    │   ├── skill.prisma                      # + group String?, sortOrder Int, tokenEstimate Int, @@index([sortOrder])
    │   ├── skill.controller.ts               # + GET order, PATCH order, GET name-available; 409 on duplicate name
    │   ├── skill.module.ts                   # + SkillOrderService
    │   ├── skill.tool.ts / skill.tool.spec.ts # create_skill gains group; + reorder_skills
    │   ├── domain/
    │   │   ├── skill.groups.ts               # SKILL_GROUPS keys (single source for validation)
    │   │   ├── tokens.ts / tokens.spec.ts    # estimateTokens(body)
    │   │   ├── skillOrder.service.ts / .spec.ts   # version hash, save with check, reorderByNames
    │   │   ├── skill.types.ts                # + group, sortOrder, tokenEstimate, filesCount, templates
    │   │   └── skill.gateway.ts              # + readOrder, writeOrder, nameAvailable
    │   ├── data/
    │   │   ├── skill.gateway.ts              # include templates; order ops in one $transaction with raw UPDATE
    │   │   └── skill.mapper.ts               # new fields
    │   └── dtos/                             # skill.dto, createSkill.dto (group), skillOrder.dto, saveSkillOrder.dto, nameAvailable.dto
    └── rancher/rancher.tool.ts (+ .spec.ts)  # update_skill gains group

admin/slices/skill/
├── domain/
│   ├── skill.groups.ts                       # key → label, colour classes; `satisfies Record<SkillGroup, …>`
│   ├── skill.types.ts                        # + new fields, ISkillOrder
│   ├── skill.gateway.ts / skill.service.ts   # + fetchOrder, saveOrder, isNameAvailable
├── data/skill.gateway.ts, skill.mapper.ts
├── stores/skill.ts                           # byId/byName/upsert/patch; order: saved, draft, version; saveOrder with rollback
├── composables/
│   ├── useSkillListQuery.ts                  # ?q ?group ?sort ?skill (replace vs push)
│   ├── useSkillLayout.ts                     # desktop / tablet / phone from useMediaQuery
│   ├── useSortableList.ts                    # pointer-events drag with touch hold, drop index, keyboard moves
│   └── useSkillDraft.ts                      # localStorage draft keyed by user + slug
├── utils/                                    # pure, each with a bun test
│   ├── slugify.ts, reorder.ts (moveVisible, orderDiff), editTime.ts (isRecent, editedThisWeek), summary.ts, activity.ts, tokens.ts, formatTokens.ts
├── components/skill/
│   ├── list/Provider.vue (rewritten), Summary.vue, SizeStrip.vue, Controls.vue, Row.vue, OrderBar.vue, States.vue
│   ├── panel/Panel.vue, Host.vue (column | drawer | sheet), DeleteInline.vue, Activity.vue
│   ├── item/Form.vue (rewritten), SlugField.vue, Preview.vue, RowPreview.vue
│   ├── create/Provider.vue, edit/Provider.vue # breadcrumbs, header actions, redirect with ?skill=
│   └── (import/*, redeploy/* unchanged)
└── pages/skills/* (unchanged routes)
```

**Structure Decision**: web application with the existing `api/` + `admin/` split; all feature code stays inside the two `skill` slices, following their domain / data / stores / components layering. Pure logic goes to `utils/` so `bun test slices` covers it without a DOM.

## Complexity Tracking

No constitution violation to justify. Noted for the reviewer, not as waivers:

| Choice | Why | Simpler alternative rejected because |
|---|---|---|
| Hand-rolled `useSortableList` instead of a library | Keyboard moves, aria-live, a 3 px indicator, filtered reorder and a 200 ms touch hold all need custom code anyway; SortableJS mutates the DOM under `v-for` and has no keyboard model; dnd-kit is React-only (R1) | Adding `vue-draggable-plus` would still need the keyboard and filtered-order layers on top, plus a dependency the brief allows only when nothing comparable exists |
| Raw SQL `UPDATE … FROM unnest()` for the order save | Prisma's `@updatedAt` bumps on every `update`, which would make "Edited 3 h ago" lie after a reorder; one statement is also the cheapest atomic write (R4) | Per-row `prisma.skill.update` with `updatedAt` echoed back works but is N statements and easy to get wrong on the next edit |
| Token formula and group list copied into admin | No shared package between `api` and `admin`; the repo copies and pins with tests (R2, R3) | A `GET /skills/groups` endpoint would still leave colours and labels in the console |
