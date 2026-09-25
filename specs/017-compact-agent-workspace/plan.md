# Implementation Plan: Compact agent workspace — Chat / Settings, one-line usage, logs bar

**Branch**: `feat/CLEAN-123-compact-agent-workspace` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-compact-agent-workspace/spec.md`

**Tracker**: [CLEAN-123](https://dreamvention.atlassian.net/browse/CLEAN-123)

## Summary

Compress the admin agent workspace (specs/006) without dropping a capability. The header
keeps two tabs, **Chat** and **Settings**; the ten sections become cards in a Settings hub
and open at full width from there, with every old `?tab=` deep link still landing on its
section. The six-figure usage strip becomes one muted line that opens a small popover. The
side log column goes: the chat drops its card chrome and takes the whole middle column,
and the pod logs become a collapsed bar under the composer that expands in place. Stop /
Start stays in the header; Restart, Tools, Edit, Share ▸ and Delete fold into the `…` menu.

The one piece the request asked to think through — **Share under `…`** — is, at the
requester's call, a **submenu**: it opens beside the Share row and the menu stays open. To
make that collision-free every share control becomes a menu row (link as a read-only row,
Copy link, Open in the app, Regenerate, Revoke, the inline two-step as rows), so the
keyboard and the outside-click rules are the menu's own and there is never a second
overlay ([research.md](./research.md) R6).

Admin only. The app console's agent page has no tabs, usage strip, side logs or menu, so
it is already the shape this feature targets; the twin check is recorded in the spec
(FR-022) and repeated in the PR. No API, store or data-model change: every number and
line the new surfaces show is already fetched by the components they replace.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3.5, Nuxt 4 (`compatibilityVersion: 4`, `ssr: false`)

**Primary Dependencies** (`admin` only): shadcn-vue / reka-ui 2.10.3 (vendored under
`admin/slices/setup/theme/components/ui` — `dropdown-menu`, `tooltip`, `card`, `tabs`,
`sheet` are all present; the share panel uses reka-ui `Popover*` directly), Tailwind 4,
Pinia 3, `@vueuse/core`, `@tabler/icons-vue`.

**Storage**: none. One transient client preference (logs bar expanded/collapsed) lives in
component state and resets per agent, as the spec's edge case asks.

**Testing**: `admin` runs `bun test slices` over `*.test.ts` files (nine exist today, all
pure utils: `share/utils/shareUrl.test.ts`, `bridle/utils/chatFlow.test.ts`, …). This
feature adds three util tests of the same shape (tab-value routing, log summary, usage
line text) and relies on `bun run typecheck` (regenerates the SDK first — revert the
generated files afterwards, see memory) plus the manual walkthrough in
[quickstart.md](./quickstart.md) for the interaction rules (overlay sequencing, single
poller, keyboard walk). There is no component-test harness and this plan does not add one.

**Target Platform**: evergreen desktop browsers; the admin console is desktop-first.

**Project Type**: web frontend — the `admin` Nuxt console inside the Bun workspace
monorepo. `api` and `app` are untouched.

**Performance Goals**: no new requests. The usage line reuses the per-agent usage fetch
the strip already makes; hub card counts reuse `useAgentSectionCounts`; the logs bar
polls at the same 5 s cadence the side panel did, and **at most one** log poller is alive
in any workspace state (SC-005).

**Constraints**:
- `admin` is English-only (no i18n work).
- Slice layout: components auto-import by path (`components/agent/logs/Bar.vue` →
  `<AgentLogsBar>`, `components/usage/Line.vue` → `<UsageLine>`).
- The conversation stays mounted behind Settings (`v-show`, never `v-if` — the rule in
  `workspace/Canvas.vue`); only its log polling pauses.
- `?tab=` values are a shared-link contract: the eleven existing values (nine original,
  `logs`, legacy alias `peers`) keep their meaning; one value is added for the hub.
- Overlay rule from the spec: the `…` menu is the header's only floating surface; Share is
  a submenu of it whose rows keep it open (`select` default prevented).

**Scale/Scope**: one console, one screen, ~6 new components, ~7 edited, 3 util tests,
0 deleted routes. `UsagePanel`'s `strip` variant becomes dead once `Main.vue` stops using
it and is removed in the same PR (verify with `graft callers` first).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unedited template (every principle is a
`[PRINCIPLE_N_NAME]` placeholder), so there are no ratified constitutional gates. The plan
is checked against what the repo actually enforces:

| Governing rule | Source | Status |
|----------------|--------|--------|
| Jira-first cycle: issue → In Progress → branch → comments → PR | `CLAUDE.md`, `.cursor/rules/project.mdc` | ✅ CLEAN-123 in progress, branch from `origin/main`, start comment posted |
| Slice architecture; components live in the owning slice | `registerSlices.ts` | ✅ `agent`, `usage`, `share`, `bridle` slices only |
| Client state: entities live once in their store; components render by id | `docs/state.md` | ✅ no new store; usage/logs/share already read from stores/composables |
| Twin consoles: touching a shared slice means checking the twin | `CLAUDE.md`, `docs/…` | ✅ `share` and `bridle` are twins — app needs nothing (FR-022); stated in PR |
| Agent tools: a console capability needs a Ranch tool | `docs/agent-tools.md` | ✅ no new capability — pure re-arrangement of existing ones |
| `admin` English-only; `app` strings via `en.json` | `docs/i18n.md` | ✅ admin only |
| OpenAPI types generated, never hand-written | `CLAUDE.md` | ✅ no API change |
| No commit / PR without a `CLEAN-` id | `CLAUDE.md` | ✅ |

**Gate result**: PASS. Complexity Tracking stays empty.

**Post-Phase-1 re-check**: PASS. Phase 1 confirmed no store or gateway changes. Shared-slice
edits: an additive `frameless` prop on admin's `BridleProvider` (default off), and in admin's
`share` slice the panel becomes a composable plus a submenu; the app twins of both are
untouched and the PR says so.

## Project Structure

### Documentation (this feature)

```text
specs/017-compact-agent-workspace/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R9
├── data-model.md        # Phase 1: view-models and state
├── quickstart.md        # Phase 1: manual + automated validation
├── contracts/
│   ├── url-tab-contract.md   # ?tab= values before/after
│   └── components.md         # props/emits of new and changed components
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
admin/slices/agent/agent/
├── components/agent/
│   ├── workspace/
│   │   ├── Main.vue            # EDIT: header → identity+dot, Chat/Settings tabs, UsageLine, Stop, … menu (Share/Tools/Edit/Restart/Delete)
│   │   ├── Tabs.vue            # EDIT: two tabs, no overflow menu
│   │   ├── Canvas.vue          # EDIT: 'settings' branch → SettingsHub; section views get SectionFrame
│   │   ├── SettingsHub.vue     # NEW: grid of SectionCard
│   │   ├── SectionCard.vue     # NEW: one section card (icon, title, desc, count)
│   │   ├── SectionFrame.vue    # NEW: back-to-hub row + title above an open section
│   │   └── sections.ts         # EDIT: WORKSPACE_TABS, SECTIONS, 'settings' value, sectionOf()/workspaceTabOf()
│   ├── chat/Tab.vue            # EDIT: drop side column, frameless BridleProvider, AgentLogsBar under it
│   ├── logs/
│   │   ├── Panel.vue           # unchanged (rendered inside the bar when expanded, and by the Logs section)
│   │   └── Bar.vue             # NEW: collapsed summary ↔ expanded Panel
│   └── status/Dot.vue          # NEW: avatar-corner status dot with tooltip (status · reason · deploy age)
├── composables/
│   ├── useAgentTab.ts          # EDIT: unchanged API; toAgentTab now accepts 'settings'
│   └── useAgentRailEntries.ts  # EDIT: export the TONE map for status/Dot.vue
└── utils/
    ├── agentLogs.ts            # EDIT: + summarizeAgentLogs()
    ├── agentLogs.test.ts       # NEW
    └── sections.test.ts        # NEW (toAgentTab / sectionOf / workspaceTabOf)

admin/slices/usage/
├── components/usage/
│   ├── Line.vue                # NEW: "$15.31 / 30d · model" + popover with the six figures + Details
│   └── Panel.vue               # EDIT: remove the now-unused `strip` variant
└── utils/
    ├── usageLine.ts            # NEW: usageLineText(totals, topModel) — pure
    └── usageLine.test.ts       # NEW

admin/slices/share/
├── components/share/menu/Sub.vue   # NEW: Share ▸ submenu of rows (DropdownMenuSub)
├── composables/useShareLink.ts     # NEW: the panel's logic, lifted verbatim
└── components/share/panel/Provider.vue
                                # DELETE: Main.vue was its only host (app keeps its own panel)

admin/slices/bridle/components/bridle/Provider.vue
                                # EDIT: `frameless` prop — no Card chrome/header; status + New chat move to the composer row
```

**Structure Decision**: everything stays in the slices that own it today. The workspace
gains three small components (hub, card, frame) and the logs slice gains the bar; the
usage line is a sibling of the panel it replaces; share and bridle receive additive props
only. No new slice, no new store, no new route.

## Layout after the change

```text
┌ rail ┐ ┌──────────────────────────────────────────────────────────────────────────┐
│      │ │ [pending-restart banner — only when set]                                  │
│      │ │ (R•) Rancher  ⛨   [Chat] [Settings]        $14.48 / 30d · haiku  [■ Stop] [⋯] │
│      │ │                                                   ┌ ⋯ ────────┐ ┌ Share ▸ ──────┐│
│      │ │                                                   │ Restart   │ │ <link> · date ││
│      │ │                                                   │ Tools     │ │ Copy link     ││
│      │ │                                                   │ Edit      │ │ Open in app   ││
│      │ │                                                   │ Share   ▸ │ │ Regenerate    ││
│      │ │                                                   │ ───────── │ │ Revoke        ││
│      │ │                                                   │ Delete    │ └───────────────┘│
│      │ │                                                   └───────────┘                  │
│      │ │ runtime offline (only when true)                                          │
│      │ │ ┌ chat (frameless, full width) ─────────────────────────────────────────┐ │
│      │ │ │  transcript …                                                        │ │
│      │ │ │  ┌ composer ───────────────────────────────────────────┐             │ │
│      │ │ │  │ …                       Debug Markdown · New chat ● ok │             │ │
│      │ │ │  └──────────────────────────────────────────────────────┘             │ │
│      │ │ │  ▸ Logs  ● 23:45:42.539  flushed 1 changed files     21 entries · 2 ⚠ │ │
│      │ │ └──────────────────────────────────────────────────────────────────────┘ │
└──────┘ └──────────────────────────────────────────────────────────────────────────┘
```

Settings tab: the same header, then either the hub grid (cards, 3 per row ≥1280 px, 2
below) or `SectionFrame` (← Settings · Section title) above the section rendered exactly
as it renders today.

## Phase 0 → [research.md](./research.md)

Nine decisions, none left open: tab model (R1), hub and frame (R2), usage line (R3),
frameless chat (R4), logs bar and the single-poller rule (R5), `…` menu and the Share
submenu (R6, revised 2026-09-25 at the requester's call), status dot (R7), width budget
(R8), tests (R9).

## Phase 1 → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

No persisted entities. The data model lists the view-models and transient state the new
components hold and the derivations between the `?tab=` value, the workspace tab and the
section. Contracts pin the address values and the props/emits of every new or changed
component so `/speckit-tasks` can split the work by file.

## Complexity Tracking

No constitution violations; nothing to justify.
