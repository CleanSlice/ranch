---

description: "Task list for the agent workspace (CLEAN-36)"
---

# Tasks: Agent workspace — vertical agent tabs + settings panel

**Input**: Design documents from `/specs/006-agent-workspace-tabs/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks are generated.** Neither console has a test runner — `admin/package.json` and `app/package.json` both declare `"test": "echo '… no tests yet'"` and a stub `lint`. The spec did not request TDD, and standing up a test framework is a separate piece of work with its own ticket. The gates for this feature are `bun run typecheck`, `bun run i18n:check` and the manual walkthrough in [quickstart.md](./quickstart.md); every phase ends with the quickstart steps that cover it.

**Organization**: Tasks are grouped by user story so each can be implemented, verified and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 / US2 / US3 / US4, matching the user stories in [spec.md](./spec.md)
- Every task names the exact file it touches

## Path Conventions

Two Nuxt consoles in a Bun workspace, each a set of auto-registered slice layers:

- **admin**: `admin/slices/agent/agent/…` — components auto-import by path (`components/agent/workspace/Rail.vue` → `<AgentWorkspaceRail>`)
- **app**: `app/slices/agent/…` — same convention (`components/agentWorkspace/Rail.vue` → `<AgentWorkspaceRail>`)
- **No `api/` changes.** If a task seems to need one, stop — that is a design error, not a task.

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline and the safety net for deleting the table

- [X] T001 Run `bun run typecheck` and `bun run i18n:check` on `feat/CLEAN-36-agent-workspace-tabs` before any edit and record that both are clean, so a later failure is attributable to this work rather than to pre-existing drift
- [X] T002 [P] Read `admin/slices/agent/agent/components/agent/list/Provider.vue` end to end and reconcile every capability it provides against the checklist in [quickstart.md](./quickstart.md) step 10 — append anything the checklist is missing. This is the precondition for T020 (deleting the file), per [plan.md](./plan.md) Risk 2

**Checkpoint**: Baseline green, deletion inventory complete

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The admin section model and panel-state plumbing that US1, US3 and the admin half of US4 all build on

**⚠️ Blocks US1, US3 and US4-admin. Does NOT block US2** — the app console shares no code with admin (see [research.md](./research.md) R8), so US2 can start immediately in parallel with this phase.

- [X] T003 Rewrite `admin/slices/agent/agent/components/agent/item/tabs.ts`: drop the `chat` entry, add `countKey: keyof SectionCounts | null` per section, export the `AgentSettingsSection` union. The eight remaining `value` strings (`overview`, `knowledge`, `files`, `secrets`, `env`, `channels`, `chats`, `paddock`) must stay byte-identical — that is the `?tab=` compatibility guarantee (FR-016)
- [X] T004 Create `admin/slices/agent/agent/composables/useSettingsPanel.ts`: panel open/closed backed by `localStorage['agent:settingsPanelOpen']` with **absent ⇒ open** (FR-013), `?tab=` read/write via `router.replace`, normalisation of legacy `chat` and unrecognised values to "no section", and the forced-open-without-persisting rule for deep links. Guard every storage access in try/catch like `stores/agent.ts` already does. Contract: [contracts/preferences.md](./contracts/preferences.md), [contracts/routes.md](./contracts/routes.md)

**Checkpoint**: Section metadata and panel state exist; admin story work can begin

---

## Phase 3: User Story 1 - Admin: one agent workspace (Priority: P1) 🎯 MVP

**Goal**: `/agents` in admin lands straight in the Ranch admin agent's conversation, with a rail of agents on the left and a settings navigator on the right. The table is gone; the chat and logs keep their current size.

**Independent Test**: Open `/agents` as an admin with at least two agents, one of them the admin agent. The conversation opens with no table in between, the rail lists both agents, switching between them switches the workspace, all eight sections open in the middle column, and the primary sidebar is untouched. Quickstart steps 1–6, 8–11.

### Implementation for User Story 1

- [X] T005 [P] [US1] Create `admin/slices/agent/agent/composables/useAgentRailEntries.ts` — derive `RailEntry[]` from the agent list per [data-model.md](./data-model.md): initials, status reconciled from `useAgentStatusStore.statuses` over the DB row (same precedence `rancher/Provider.vue` uses), status tone, `createdAt` timestamp, `isAdmin`, `isActive` (FR-002, FR-005)
- [X] T006 [P] [US1] Create `admin/slices/agent/agent/components/agent/workspace/RailItem.vue` — one row: avatar, name (truncated with `title`), status dot + label, created date, Ranch-admin marker. Presentational only, **no action controls** (FR-002)
- [X] T007 [P] [US1] Create `admin/slices/agent/agent/components/agent/workspace/TopBar.vue` — `New agent` link plus the `N slots free` badge and its cluster-full warning, occupying the row where `← Back to agents` sits today. `capacity: null` renders no badge, so non-privileged roles never hit the `@Roles(Owner, Admin)` endpoint (FR-009)
- [X] T008 [US1] Create `admin/slices/agent/agent/components/agent/workspace/Rail.vue` — vertical list of `RailItem`, exactly one marked active, skeleton rows while `pending` (FR-027), emits `select` without navigating. Search is deferred to T035 (depends on T005, T006)
- [X] T009 [P] [US1] Create `admin/slices/agent/agent/components/agent/settings/NavItem.vue` — section row: title, one-line description, count slot, chevron, current-section marker. Renders no section content (FR-018)
- [X] T010 [US1] Create `admin/slices/agent/agent/components/agent/workspace/Canvas.vue` — the two-mode middle column: chat branch toggled with **`v-show`** (never `v-if` — see § The two rules that must not be broken), section branch with `v-if` and a `section → component` map covering all eight, plus the `‹ Chat` return control and the section name header. Files and Secrets get the explanatory copy that their `Card` wrappers carry today (FR-012, FR-014)
- [X] T011 [US1] Create `admin/slices/agent/agent/components/agent/settings/Panel.vue` — identity block (avatar, name, id, status, `statusReason` when failed, resources), the navigator list of eight `NavItem`s, and the lifecycle row: `Stop`/`Start`, `Restart`, `Edit`, and `Delete` behind the existing `ConfirmDialog`. Emits `update:section`, holds no section content (FR-017, FR-018) (depends on T003, T009)
- [X] T012 [US1] Create `admin/slices/agent/agent/components/agent/workspace/Main.vue` — per-agent subtree: pending-restart banner, compact agent header (avatar, name, status pill, `Manage agent` toggle), usage strip, and `Canvas`. Calls `useAgentLifecycle(id, agent, refresh)` unchanged (depends on T010)
- [X] T013 [US1] Create `admin/slices/agent/agent/components/agent/workspace/Provider.vue` — the shell: `TopBar` · `Rail` · `<Main :key="id">` · `Panel` hosted either as a docked `<aside>` at `min-width: 1700px` or as a `Sheet` below it (`useMediaQuery` from `@vueuse/core`). Owns the single `useAsyncData('admin-agents')` and the routing on `select`. **The `:key` goes on `Main`, never on the provider or the rail** (R4, FR-026) (depends on T007, T008, T011, T012)
- [X] T014 [US1] Rewrite `admin/slices/agent/agent/components/agent/item/Provider.vue` as a thin host for `<AgentWorkspaceProvider :id="id" />`, moving its header, tabs and `TabsContent` out — the eight section components move to `Canvas.vue` with their props unchanged (depends on T013)
- [X] T015 [US1] Edit `admin/slices/agent/agent/pages/agents/[id]/index.vue` — remove `definePageMeta({ key })`; the per-agent remount boundary now lives on `Main.vue`. Keep the comment explaining *why* the boundary exists, moved to its new home (R4)
- [X] T016 [US1] Rewrite `admin/slices/agent/agent/pages/agents/index.vue` as a resolver: fetch the list, pick `agents.find(a => a.isAdmin)` → else most recently updated → else render the empty state in place, and `navigateTo(id, { replace: true })` (FR-007, [contracts/routes.md](./contracts/routes.md))
- [X] T017 [US1] Edit `admin/slices/agent/agent/components/agent/chat/Tab.vue` — recompute the `h-[calc(100vh-15.5rem)]` height for the workspace's new chrome (top action row + compact header + usage strip, minus the deleted tabs column). **Do not touch `min-w-100`, `max-w-200`, `basis-1/2` or the logs panel** (FR-010, FR-025)
- [X] T018 [US1] Wire the usage strip's `@details` in `Main.vue` to open the Overview section in the canvas instead of switching to a tab (FR-025, edge case)
- [X] T019 [US1] Handle the deleted-agent edge case in `Provider.vue`: when the open agent disappears from the list, `push` to the next rail entry and surface what happened; empty rail ⇒ empty state ([contracts/routes.md](./contracts/routes.md))
- [X] T020 [US1] Delete `admin/slices/agent/agent/components/agent/list/Provider.vue` — only after T002's checklist is fully ticked and every capability has a verified new home (FR-008, FR-009)
- [X] T021 [US1] Confirm `admin/slices/agent/agent/plugins/menu.ts` and every other `plugins/menu.ts` are unchanged, and that the `Agents` sidebar entry still resolves to the workspace (FR-011)

**Checkpoint**: Admin workspace fully functional. This alone satisfies CLEAN-36's original acceptance criteria and is the MVP.

---

## Phase 4: User Story 2 - App: vertical agent list instead of cards (Priority: P2)

**Goal**: The app console's agents area opens straight into a conversation with the same rail on the left — no cards, no settings panel.

**Independent Test**: Open the app agents area as a user who can see two or more agents. A conversation opens directly, the rail lists the visible agents, switching entries switches the conversation, and there is no settings panel anywhere. Quickstart steps 13–16.

**Independent of Phase 2** — no shared code with admin (R8).

### Implementation for User Story 2

- [X] T022 [P] [US2] Create `app/slices/agent/composables/useLastAgent.ts` — read/write `localStorage['agent:lastOpened']`, guarded, **with the validate-on-read rule**: the stored id is used only if it is in the currently visible agent list ([contracts/preferences.md](./contracts/preferences.md))
- [X] T023 [P] [US2] Create `app/slices/agent/components/agentWorkspace/RailItem.vue` — hand-rolled Tailwind, no shadcn (R8). Move the status-tone map, the initials derivation and the relative-time bucketing over from `agentList/Card.vue` rather than rewriting them; timestamp is `updatedAt` here, not `createdAt` (FR-002)
- [X] T024 [US2] Create `app/slices/agent/components/agentWorkspace/Rail.vue` — same shape as the admin rail (list, one active, skeletons, emits `select`), app styling. Search deferred to T036 (depends on T023)
- [X] T025 [US2] Create `app/slices/agent/components/agentWorkspace/Provider.vue` — rail + conversation, **no settings panel** (FR-019). Refreshes the agent list every 30s (R3), writes `agent:lastOpened` on every successful open, preserves the role rules of the cards screen: create only for Owner/Admin, capacity only for those roles (FR-021) (depends on T022, T024)
- [X] T026 [US2] Edit `app/slices/agent/components/agentChat/Provider.vue` — keep every bit of its logic (restart, transitional polling, overlay stages, status pill) and remove only the `← Back to agents` link and its own `h-[calc(100vh-3.5rem-1px)]` wrapper, both of which the workspace now owns. Keep the conversation's readable width — do not stretch it (FR-019)
- [X] T027 [US2] Rewrite `app/slices/agent/pages/agents/index.vue` as a resolver: remembered id (validated) → first `running` → first in list → empty state in place, then `navigateTo(id, { replace: true })` (FR-020)
- [X] T028 [US2] Edit `app/slices/agent/pages/agents/[id].vue` to render `<AgentWorkspaceProvider :id="id" />`
- [X] T029 [US2] Delete `app/slices/agent/components/agentList/Card.vue` and `app/slices/agent/components/agentList/Provider.vue` after confirming nothing else references them (only the index page did)
- [X] T030 [US2] Add the new English keys to `app/slices/agent/i18n/locales/en.json` — a `rail.*` group for anything new, **reusing the existing `status.*` and `relative_time.*` keys rather than duplicating them**. Copy computed in script travels as a key, never as text (FR-022, `docs/i18n.md`)
- [X] T031 [US2] Run `bun run i18n:sync` and commit `en.json` and the generated `ru.json` together; never hand-write `ru.json` first (FR-022)
- [X] T032 [US2] Verify `app/slices/common/components/layout/Provider.vue`'s `isFlush` regex still matches the workspace route and still excludes `/agents/create`; the workspace inherits the flush treatment unchanged ([contracts/routes.md](./contracts/routes.md))

**Checkpoint**: Both consoles now open on a conversation with a rail. US1 and US2 work independently.

---

## Phase 5: User Story 3 - Settings panel that says more at a glance (Priority: P3)

**Goal**: Each section in the admin panel shows how much is behind it before the operator clicks.

**Independent Test**: Open the panel for an agent with known amounts of knowledge, files, secrets and channels; each number matches what that section lists when opened, `0` renders as `0`, and an unavailable count renders as nothing at all. Quickstart step 7.

**Depends on**: Phase 2 (T003 for `countKey`) and US1 (T011 for the panel that displays them).

### Implementation for User Story 3

- [X] T033 [US3] Create `admin/slices/agent/agent/composables/useAgentSectionCounts.ts` — `(agentId, enabled: Ref<boolean>)` firing nothing until `enabled`, then four independent fetches: `useAgentKnowledges().resolved.length`, `useAgentFileStore().list(id).length`, the `agentSecret` store list length, and `useAgentChannelStore().fetchForAgent(id).length`. Each catches to `null`; keys are shared with the sections themselves so opening a section afterwards costs nothing extra (R5)
- [X] T034 [US3] Wire the counts through `settings/Panel.vue` into `settings/NavItem.vue`, gated on the panel being open. **`null` renders nothing** — no `0`, no spinner, no error badge; `0` is a real value meaning "none attached" (FR-015, US3 scenario 2) (depends on T033)

**Checkpoint**: Counts visible and honest about what they do not know.

---

## Phase 6: User Story 4 - Long lists and narrow screens (Priority: P4)

**Goal**: A rail with dozens of agents is searchable, and the workspace stays usable below the tablet breakpoint.

**Independent Test**: With 20+ agents, a name fragment filters the rail and a non-matching search says so; below 1024px the rail and (admin) the panel become on-demand overlays with the conversation still usable at 390px. Quickstart step 17.

**Depends on**: US1 for the admin rail, US2 for the app rail. The two halves are independent of each other.

### Implementation for User Story 4

- [X] T035 [P] [US4] Add the name search and its "nothing matches" state to `admin/slices/agent/agent/components/agent/workspace/Rail.vue` — case-insensitive substring on `name`, clearing restores the full list. Not persisted, by design ([contracts/preferences.md](./contracts/preferences.md)) (FR-023)
- [X] T036 [P] [US4] Add the same search and empty-result state to `app/slices/agent/components/agentWorkspace/Rail.vue`, with its strings as English keys in `app/slices/agent/i18n/locales/en.json` (FR-023, FR-022)
- [X] T037 [US4] Below `1024px` in `admin/…/workspace/Provider.vue`: the rail becomes an on-demand overlay and the panel a full-screen sheet, leaving the canvas readable. The logs panel keeps whatever responsive behaviour it has today — do not redesign the existing pair (FR-024)
- [X] T038 [US4] Same narrow-screen treatment for the rail in `app/slices/agent/components/agentWorkspace/Provider.vue`; verify the conversation at 390px has no horizontal page scroll and a reachable input (FR-024, SC-010)
- [X] T039 [US4] Run `bun run i18n:sync` again for the keys T036 added, committing `en.json` and `ru.json` together

**Checkpoint**: All four stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 Run `bun run typecheck` and `bun run i18n:check` — both must be clean before anything else in this phase counts
- [ ] T041 Walk [quickstart.md](./quickstart.md) steps 1–18 end to end and record the result of each. Steps 6 (chat survives a section round trip) and 10 (nothing lost with the table) are the two that most need a careful pass
- [X] T042 [P] Confirm no leftover references to the deleted components or to the old tab column: grep for `AgentListProvider`, `AGENT_TABS`, `TabsContent` under `admin/slices/agent` and `app/slices/agent`
- [X] T043 [P] Re-read the eight section components and confirm **none of them needed a layout change** — if one did, the navigator model was not implemented as designed and R2's premise is broken (SC-004)
- [X] T044 Post the implementation checkpoint on CLEAN-36 and open the PR into `main` with `CLEAN-36` in the title, then put the PR URL on the issue and move it to In Review (`CLAUDE.md` delivery cycle)

---

## Implementation notes — what was built differently, and why

Recorded during `/speckit-implement`. Each of these is a deliberate departure
from the task text; the task's *intent* is met in every case.

| # | Task | Departure |
|---|------|-----------|
| 1 | T003 | The file was **renamed** `components/agent/item/tabs.ts` → `components/agent/settings/sections.ts`. There are no tabs any more, and leaving the old name would have left the codebase describing a screen that no longer exists. The eight `value` strings are byte-identical, which is the part that was actually load-bearing. |
| 2 | T013, T037 | **No shadcn `Sheet` anywhere.** The panel is one element whose docking is pure CSS (`min-[1700px]:static` / `max-lg:fixed inset-0`), so crossing a breakpoint never remounts it or duplicates its state. `Sheet` is modal — a default-open modal would have blocked the conversation it sits beside, and below 1700px the panel is itself an overlay, so a section opening inside it would have been a drawer in a drawer. The narrow rail overlay is a plain fixed div for the same reason. |
| 3 | T017 | The chat's `h-[calc(100vh-15.5rem)]` was **removed rather than re-tuned**. The canvas gives it a bounded height, so `h-full` is correct and there is one fewer magic number to re-derive every time a header moves. `min-w-100` / `max-w-200` / `basis-1/2` and the logs panel beside it are untouched, as required. |
| 4 | T033 | The knowledge count is assembled by hand (agent override, else the template's defaults) instead of riding `useAgentKnowledges`. That composable fires its `useAsyncData` calls the moment it is called, which would have broken the "nothing fetches until the panel is open" rule the same task asks for. |
| 5 | T035, T036 | Search landed **with** the rails (T008, T024) rather than as a second pass over the same two files. Same code, one edit instead of two. |
| 6 | T006 | Added `formatDate` beside the existing `formatDateTime` in `admin/slices/common/utils/formatDate.ts`. The rail row carries status and a date on one 272px line; the full timestamp cost width without adding information. |
| 7 | T030 | Retired keys as well as adding them: `list.title`, `list.lede`, `list.running_of`, the whole `card.*` group and `chat.back_to_agents` belonged to the deleted grid and the deleted back-link. `i18n:sync` dropped their Russian counterparts. |
| 8 | contracts/routes.md | **Corrected a contract that contradicted FR-018.** It said closing the panel while a section is open keeps `?tab=`; FR-018 requires the navigator to stay visible whenever a section is on the canvas, so that state is unreachable. Closing now returns to the conversation and clears the parameter. |

## Verification status

| Gate | Result |
|------|--------|
| `bun run typecheck` | ✅ clean (2/2 packages) — and **proven to be a real gate**: probe errors in a `.ts` file and in a `.vue` template were both caught before being reverted |
| `bun run i18n:check` | ✅ 6 slice/locale pairs in sync, 175 keys, no undefined usages |
| `admin` production build | ✅ complete |
| `app` production build | ✅ complete |
| [quickstart.md](./quickstart.md) steps 1–18 | ⛔ **not run** — needs a browser against a running `ranch dev` stack (T041) |

The builds resolve every auto-imported component and composable, so the wiring
is verified. What is **not** verified is anything only a browser can show:
layout at each breakpoint, the chat surviving a section round trip without a
reconnect, the rail not refetching on switch, and the deep-link behaviour.

## Dependencies & Execution Order

### Phase dependencies

```
Phase 1 (Setup)
      │
      ├──────────────────────────────► Phase 4 (US2, app) ──┐
      │                                                      │
      ▼                                                      │
Phase 2 (Foundational, admin)                                │
      │                                                      │
      ▼                                                      │
Phase 3 (US1, admin) ── MVP                                  │
      │                                                      │
      ├──► Phase 5 (US3, counts)                             │
      │                                                      │
      └──► Phase 6 (US4) ◄───────────────────────────────────┘
                    │
                    ▼
             Phase 7 (Polish)
```

- **US2 does not wait for Phase 2 or Phase 3.** The consoles share no code, so the app half can be built by a second person from the moment Setup is done.
- **US3** needs T003 (`countKey`) and T011 (the panel).
- **US4** needs T008 (admin rail) for its admin half and T024 (app rail) for its app half; those halves do not need each other.

### Within User Story 1

The dependency spine is: `useAgentRailEntries` + `RailItem` → `Rail`; `NavItem` → `Panel`; `Canvas` → `Main`; then `Provider` needs all four of `TopBar`, `Rail`, `Panel`, `Main`. Everything after `Provider` (T014–T021) is wiring and removal, and T020 is gated on T002.

### Parallel opportunities

- **Phase 1**: T002 is `[P]` — it is reading, not editing
- **Phase 3**: T005, T006, T007, T009 are all `[P]` — four separate new files with no shared dependency. T010 can also start once T003 is done
- **Phase 4**: T022 and T023 are `[P]`
- **Phase 6**: T035 and T036 are `[P]` — different consoles
- **Phase 7**: T042 and T043 are `[P]`
- **Across phases**: one person on US1 (admin) and one on US2 (app) is the natural split, and they never touch the same file

## Parallel Example: User Story 1 opening moves

```
T005 useAgentRailEntries.ts   ─┐
T006 workspace/RailItem.vue   ─┼─ four independent new files, no shared edits
T007 workspace/TopBar.vue     ─┤
T009 settings/NavItem.vue     ─┘
                               │
                               ▼
                      T008 Rail.vue (needs T005, T006)
                      T011 Panel.vue (needs T003, T009)
```

## Implementation Strategy

**MVP is Phase 1 → 2 → 3 (US1).** That alone deletes the table, lands the workspace, and satisfies CLEAN-36's original acceptance criteria. It is shippable without US2, US3 or US4.

**Increment 2 is US2** — the app console, which can be built in parallel and shipped separately.

**US3 and US4 are polish** on top: counts make the panel worth opening, search and the narrow-screen overlays matter once an install has many agents or someone opens the console on a laptop. Neither blocks a release.

### The two rules that must not be broken

1. **`v-show`, never `v-if`, on the chat branch of `Canvas.vue`** (T010). Unmounting the chat drops the websocket, the transcript, the scroll position and the restart overlay state — SC-004a exists to forbid exactly that, and quickstart step 6 checks it in the Network panel.
2. **The `:key` lives on `Main.vue`, not on the page or the provider** (T013, T015). On the page it remounts the rail on every agent switch, refetching the list and flashing the column; quickstart step 4 checks it.

### Known trade-offs already decided — do not relitigate during implementation

| Decision | Where it is argued |
|----------|--------------------|
| Sections render in the canvas, not inside the panel | [research.md](./research.md) R2 |
| `app` gets a 30s list poll, not an SSE port | [research.md](./research.md) R3 |
| Counts fan out to four requests rather than a new aggregate endpoint | [research.md](./research.md) R5 |
| Panel docks at ≥1700px and overlays below | [research.md](./research.md) R1 |
| The two rails are separate components, not a shared package | [research.md](./research.md) R8 |
