# Implementation Plan: Agent Overview redesign

**Branch**: `feat/CLEAN-228-agent-overview-redesign` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/031-agent-overview-redesign/spec.md`

**Ticket**: [CLEAN-228](https://dreamvention.atlassian.net/browse/CLEAN-228) `[ADMIN]`

**Reference**: the prototype `agent-overview-redesign.html` — target for layout, density and wording.

## Summary

The agent Settings page of the admin console gets a compact, grouped section
list and a rebuilt Overview: a four-figure summary strip, then Configuration,
Request limit, Access, Usage, Advanced and Delete agent. Everything editable
is edited where it stands; one save bar for the page appears when something
changed and saves only what changed in a single request. The separate Edit
page for an existing agent is retired.

It is a console change only. Every field is already accepted by the existing
agent update, every figure already has a route, and the request-limit rules
of CLEAN-224 are untouched: no API, DTO, migration or agent-tool change.

Browser checks against a running local stack are a condition of done, and the
CLEAN-224 browser suite must still pass on the same build.

## Technical Context

**Language/Version**: TypeScript 5.x, Nuxt 4 / Vue 3.5 / Pinia (`admin/`).

**Primary Dependencies**: no new dependency. shadcn-vue pieces already in
`admin/slices/setup/theme/components/ui/` (Switch, Accordion, Tabs, Badge,
Tooltip, Select, Input, Textarea, Checkbox, Sheet), `@tabler/icons-vue`, the
console's confirm store. The theme has no TagsInput, Collapsible, ToggleGroup
or Progress; the chip input and the bars are written in the slice (research
R9).

**Storage**: none new. Reads and writes go through the existing stores:
`agent`, `agentLimit`, `agentStatus`, `usage`, `llm`, `knowledge`, `template`.

**Testing**: `cd admin && bun test slices` for the pure modules (sections,
draft, limit preview, origin parsing, usage days); `npx nuxt typecheck`;
`bun run locale:check`; playwright-core scripts in
`specs/031-agent-overview-redesign/e2e/` with one entry `all.mjs`, which also
runs `specs/030-agent-request-limits/e2e`.

**Target Platform**: the admin console in a desktop browser first (1280 to
1920 px), usable down to phone width. Light appearance only — the console has
no theme switch.

**Project Type**: web console (monorepo, slices). Slices touched: `agent`
(admin), `usage` (admin, one pure util), `common` (admin, hooks on the confirm
dialog).

**Performance Goals**: no new polling beyond what Overview does today; pod
metrics stop polling while the tab is hidden (they do not today). Typing a
limit redraws the chart within a frame: the preview is a pure function over
60 numbers.

**Constraints**: `?tab=` values are a shared-link contract and do not change.
A save sends only changed fields. No `Intl.*` / `toLocale*` in components;
admin stays English. No Prettier or ESLint over `admin/`; patch surgically.
The `data-*` hooks read by the CLEAN-224 scripts keep their names.

**Scale/Scope**: about 12 new or rewritten components, 5 pure modules with
tests, 5 components and 1 page removed, 7 browser scripts, 3 existing browser
scripts adjusted.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | All of it is the admin `agent` slice, except `usageDays()` which belongs to `usage` (it reshapes that slice's rows) and two hooks on `common`'s confirm dialog. Nothing new in `common`. |
| II. Twin consoles | Pass, admin only | `agent`, `common` and `usage` are touched in admin. The app console's `agent` slice has its own workspace (CLEAN-215) and shares no component with this one; `common` in app has no confirm dialog of this kind. The PR says so in words, with the greps that back it. |
| III. Secrets stay behind `api/` | Pass | No credential. Embed snippets keep their placeholders. |
| IV. One entity, one store | Pass | The agent stays in `agent`, limits in `agentLimit`. The draft holds only the fields the operator touched and exists while the page is open — form state, not a second copy (research R3). Saves go through the stores' existing `update` / `save` with rollback. |
| V. The console is a window, the chat is the hands | Pass, nothing owed | No capability is added or removed: every edit made here was possible before, on the Edit page or in the visibility card. The tools that cover them are unchanged (and their gaps for limits are being closed separately under CLEAN-224). |
| VI. English is the source | Pass | Admin is English-only; dates and numbers through `#common/utils/format`. |
| VII. A rule stays a rule | Pass | What changed, what a save contains, whether a restart is offered, what a limit would have done to the last hour — all are pure functions with tests. No model call. |

**Quality gate 4 — numbers a reviewer would otherwise take on trust**:

| Value | Where | Why this value |
|-------|-------|----------------|
| list ≤ 200 px wide, row ≤ 36 px | section list | the prototype's 190 px / 34 px with a little room; SC-001 |
| chart scale `max(peak × 1.25, min(limit, peak × 2.2) × 1.12, 4)` | limit chart | the prototype's rule: headroom above the busiest bar, the line kept in view until the limit is more than about twice the traffic, a floor of 4 so an idle hour is not a blank |
| presets 10 / 30 / 60 / 120 | per-minute field | the prototype's; shortcuts for typing, not recommendations |
| 7 days | usage chart | the prototype's; a week reads at a glance, 30 days stay one click away |
| 10 s pod metrics, 3 s load, usage once | summary | unchanged from today; only the pause while hidden is new |

**Post-design re-check**: no violation. Two deliberate widenings beyond
"move the pixels", both because leaving them would ship a known wrong:
demote gets a confirmation it lacks today, and the header menu's Delete uses
the same dialog as the Delete block (research R11).

## Project Structure

### Documentation (this feature)

```text
specs/031-agent-overview-redesign/
├── plan.md  spec.md  research.md  data-model.md  quickstart.md
├── contracts/overview-ui.md        # structure, states, data-* hooks
├── checklists/requirements.md
├── e2e/                            # written in implementation
│   ├── nav.mjs  summary.mjs  edit.mjs  limit.mjs  access.mjs  rest.mjs  all.mjs
│   └── shots/
└── tasks.md                        # /speckit-tasks
```

### Source Code (repository root)

```text
admin/slices/agent/agent/
├── components/agent/
│   ├── workspace/
│   │   ├── sections.ts                 # + group, new order
│   │   ├── SettingsNav.vue             # headings, one-row layout, orientation
│   │   ├── SectionRow.vue              # NEW (replaces SectionCard.vue, deleted)
│   │   └── Main.vue                    # menu "Edit" removed; Delete opens the shared dialog
│   ├── overview/
│   │   ├── Tab.vue                     # provides the draft, mounts the blocks and the bar
│   │   ├── Summary.vue                 # NEW
│   │   ├── ConfigCard.vue              # NEW  name, description, model, knowledge, resources, template
│   │   ├── LimitCard.vue               # NEW  switch, three fields, presets, verdict, meters, chart
│   │   ├── AccessCard.vue              # NEW  landing switch, origins, embed
│   │   ├── UsageCard.vue               # rewritten: four figures, seven days, sheet with the panel
│   │   ├── AdvancedCard.vue            # NEW  debug, promote/demote, identifiers
│   │   ├── DangerCard.vue              # NEW
│   │   ├── SaveBar.vue                 # NEW
│   │   ├── Row.vue                     # NEW  label + control row used by the blocks
│   │   └── (LlmCard, KnowledgeCard, MetricsCard, RuntimeCard — deleted)
│   ├── access/OriginsInput.vue         # NEW  chips
│   ├── load/Meters.vue                 # unchanged
│   ├── load/Chart.vue                  # + previewLimit, scale rule, over-limit marks
│   ├── load/Provider.vue               # deleted (folded into LimitCard)
│   ├── delete/Dialog.vue               # NEW  moved out of edit/Provider.vue
│   ├── visibility/Provider.vue         # deleted
│   ├── edit/Provider.vue               # deleted
│   ├── debug/Provider.vue              # deleted
│   └── item/Form.vue                   # create only; edit-only branches removed
├── composables/
│   ├── useAgentDraft.ts                # NEW
│   ├── useUnsavedGuard.ts              # NEW
│   └── useAgentTab.ts                  # setTab asks the guard
├── utils/
│   ├── agentDraft.ts (+test)           # NEW  pure: diff, count, payload, restart
│   ├── limitPreview.ts (+test)         # NEW  pure: over, refused, peak, chartTop
│   ├── origin.ts (+test)               # NEW  pure: parseOrigin
│   ├── agentLimitForm.ts (+test)       # placement of PUBLIC_AGENT_NEEDS_LIMITS by the switch
│   └── sections.test.ts                # new order and groups
└── pages/agents/[id]/edit.vue          # redirect to ?tab=overview

admin/slices/usage/utils/usageDays.ts (+test)        # NEW  pure
admin/slices/common/components/confirm/Dialog.vue    # data-confirm-* hooks

specs/030-agent-request-limits/e2e/
├── settings.mjs  operator.mjs          # adjusted per research R13
├── seed.mjs                            # + credential, knowledge bases, usage rows
└── lib.mjs                             # + helpers shared with 031
```

**Structure Decision**: the admin `agent` slice, by component folder, as it
is organised today. Overview's blocks are siblings under `overview/`, each
reading the stores by agent id and the shared draft by injection; their
logic that can be a pure function is one, with a test.

## Delivery order

Each step leaves the console working.

1. **Section list** — `sections.ts`, `SectionRow`, `SettingsNav`, test,
   `nav.mjs`. Independent of everything else. *Ticket comment.*
2. **Draft, guard, save bar** — pure `agentDraft`, `useAgentDraft`,
   `useUnsavedGuard`, `SaveBar`, wired into `Tab.vue` with the existing cards
   still mounted (the visibility card moves onto the draft first, so the
   CLEAN-224 scripts are adjusted here). *Ticket comment.*
3. **Blocks** — Summary, Configuration, Request limit, Access, Usage,
   Advanced, Delete; old cards removed as each replacement lands. Summary and
   Usage are independent of the draft and can go in parallel with the rest.
   *Ticket comment per two or three blocks.*
4. **Retire the Edit page** — redirect, menu entry, deletions, `Form.vue`
   trimmed.
5. **Full browser run** — `specs/031-agent-overview-redesign/e2e/all.mjs`
   green on the finished build, including the CLEAN-224 suite; screenshots
   next to the prototype on the ticket; PR into `main` with the commands, the
   results and the twin-console statement; version bump; merge when CI is
   green; watch `Release Platform`.

## Risks

| Risk | Handling |
|------|----------|
| The record moves under the form (status stream, 3 s limit poll, refetch on open) and wipes or falsely marks edits | the draft keeps only touched fields and compares against the current saved value; a unit test moves `saved` under a touched and an untouched field |
| A way out that no guard sees (sections change only the query; another agent is a route update, not a leave) | one guard with four mechanisms (research R6); `edit.mjs` tries each |
| Saving the description clobbers `config` changed elsewhere | the payload is built from the currently saved config, never from a copy taken when the page opened; unit test |
| The CLEAN-224 browser suite silently loses coverage when its scripts are adjusted | only three mechanical changes (R13); the suite runs inside `all.mjs` and its assertion counts are compared with the last recorded run (45 / 26 / 22 / 14 / 28 / 19 / 13 / 29) |
| "None" for the model credential keeps doing nothing | not offered unless the first task proves the API clears it (R5) |
| Looks right at 1440 and breaks elsewhere | `rest.mjs` checks six widths for horizontal scroll; a manual pass against the prototype (quickstart §5) |
| The limit-tools follow-up (CLEAN-224, branch `fix/CLEAN-224-limit-tools-coverage`) lands in `main` meanwhile | it touches `api/` and `docs/` only; no overlap with `admin/` |

## Complexity Tracking

No constitution violation to justify.
