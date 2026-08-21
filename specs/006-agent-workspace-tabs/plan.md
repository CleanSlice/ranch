# Implementation Plan: Agent workspace — vertical agent tabs + settings panel

**Branch**: `feat/CLEAN-36-agent-workspace-tabs` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-agent-workspace-tabs/spec.md`

**Tracker**: [CLEAN-36](https://dreamvention.atlassian.net/browse/CLEAN-36)

## Summary

Replace both consoles' agent index screens with a three-part workspace: a vertical rail of
agents on the left, a middle **canvas** that shows either the existing chat-and-logs pair at
its current width or one open settings section, and (admin only) a narrow right-hand panel
that **navigates** those sections and holds the agent's controls, open by default. The admin
agents table is deleted; `/agents` resolves to the Ranch admin agent and redirects to its
canonical `/agents/:id` address.

The panel navigates rather than contains (R2): section content renders in the canvas at the
width it already renders at today, so **none of the eight existing section components changes
shape**. The conversation stays mounted behind an open section and returns in one click.

No API or data-model change: every piece of data the workspace needs is already exposed —
including the **public** `GET /agents/status/stream` SSE feed that admin already consumes for
live pod state. The work is entirely in the two Nuxt consoles' `agent` slices, and it needs
no new UI primitive — the navigator model means no accordion, so the vendored shadcn set stays
as it is.

The one genuinely hard part is horizontal space, not logic. The requester's decision to keep
the chat at `min-w-100 max-w-200` with the logs panel beside it means the workspace already
consumes ~1300px before the rail and the panel exist. The plan resolves this with a
three-tier layout (§ Layout budget below and [research.md](./research.md) R1) rather than by
shrinking the chat.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3.5, Nuxt 4 (`compatibilityVersion: 4`, `ssr: false` — both consoles are SPAs)

**Primary Dependencies**:
- `admin`: shadcn-vue 2.8 / reka-ui 2.10 (vendored under `slices/setup/theme/components/ui`), Tailwind 4, Pinia 3, `@vueuse/core` 14, `@tabler/icons-vue`, `lucide-vue-next`
- `app`: Tailwind 4, Pinia 3, `@nuxtjs/i18n` 10 (en + ru), `lucide-vue-next` via the local `Icon.vue` wrapper. Only `badge` is vendored from shadcn here — app UI is hand-rolled Tailwind and must stay that way.

**Storage**: No server-side storage change. Two client-side preferences are added: the settings panel's open/closed state and the app's last-opened agent (see [data-model.md](./data-model.md) § Client-side preferences).

**Testing**: **There is no automated test infrastructure in either console** — `admin`/`app` `package.json` both declare `"test": "echo '... no tests yet'"` and `"lint": "echo '... not configured'"`. The honest gates for this feature are `bun run typecheck` (turbo, filters `app` + `admin`), `bun run i18n:check`, and the manual walkthrough in [quickstart.md](./quickstart.md). This plan does not pretend otherwise and does not introduce a test framework as a side quest.

**Target Platform**: Modern evergreen browsers; desktop-first for `admin`, desktop + mobile for `app`.

**Project Type**: Web frontend — two Nuxt consoles in a Bun workspace monorepo alongside a NestJS `api` that this feature does not touch.

**Performance Goals**: Switching agents in the rail repaints in one frame budget and issues no more than the requests the agent page already makes. The rail itself costs one list request that both consoles already perform. Settings-section counts are lazy and never block the panel's first paint.

**Constraints**:
- Horizontal budget is the binding constraint — chat `min-w-100` (400px) + logs `min-w-100` (400px) + admin sidebar (256px) leaves ~384px of slack on a 1440px screen, which the rail alone consumes.
- `admin` stays English-only; every new `app` string goes through `en.json` → `bun run i18n:sync` → `ru.json` (`docs/i18n.md`).
- Slice architecture: each console is a set of Nuxt layers auto-registered by `registerSlices.ts`; components auto-import by path (`components/agent/workspace/Rail.vue` → `<AgentWorkspaceRail>`).

**Scale/Scope**: 2 consoles, 3 routes reworked, ~10 new components, 1 deleted table component, no new UI primitives. Rail must stay usable at dozens–hundreds of agents.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **an unedited template** — every principle is still a
`[PRINCIPLE_N_NAME]` placeholder. There are no ratified constitutional gates to check against,
and inventing them here would be fabricating governance the project never agreed to.

What this repo *does* enforce, and what this plan is therefore checked against:

| Governing rule | Source | Status |
|----------------|--------|--------|
| Jira-first delivery cycle: issue → In Progress → branch → comments → PR | `CLAUDE.md`, `.cursor/rules/project.mdc` | ✅ CLEAN-36 in progress, branch `feat/CLEAN-36-agent-workspace-tabs`, start comment posted |
| Slice architecture — code lives in the owning slice, layers register themselves | `registerSlices.ts`, per-slice `nuxt.config.ts` | ✅ all work lands in `admin/slices/agent/*` and `app/slices/agent` |
| DDD layering inside a slice (`data` → `domain` → `stores` → `components`) | existing slices | ✅ no new gateways/services needed; components + composables only |
| `app` is bilingual, `admin` is English-only | `docs/i18n.md`, `CLAUDE.md` | ✅ FR-022; `i18n:check` is a gate |
| OpenAPI types are generated, never hand-written | `CLAUDE.md` | ✅ no API surface change, no new DTOs |
| No commit/PR without a `CLEAN-` id | `CLAUDE.md` | ✅ |

**Gate result**: PASS — no violations, so [§ Complexity Tracking](#complexity-tracking) stays empty.

**Post-Phase-1 re-check**: PASS. The navigator model removed the one thing that would have
touched shared ground — the earlier draft vendored a new shadcn `accordion` primitive; it is
no longer needed. The design now adds nothing outside the two `agent` slices.

## Layout budget

The numbers that drive every layout decision below (Tailwind 4: `min-w-100` = 25rem = 400px,
`max-w-200` = 50rem = 800px):

| Column | Width |
|--------|-------|
| Admin primary sidebar | 256px (16rem), user-collapsible to 48px |
| Agent rail | 272px (17rem) |
| Canvas — chat mode | chat + logs, each capped at 800px; the 400px floor applies only at ≥1400px |
| Canvas — section mode | one section, flexible |
| Settings panel (navigator) | 320px (20rem) |
| **Everything docked with both floors applied** | **≈1690px** |

**Revised during implementation.** The first version floated the panel below 1700px so the
chat never went under its 400px floor. In the browser that turned out to cover the pod logs,
and where the container was narrower still, the hard floors on both halves overflowed the row
and `overflow-x-clip` cut the chat card's right border off. The rule now:

- **≥1400px** — everything docked, chat and logs at the sizes they have on `main`.
- **1024–1399px** — everything still docked and fully visible; chat and logs shrink together,
  and the logs' existing collapse button hands the column back to the chat in one click.
- **<1024px** — rail and panel are both on-demand full-screen overlays; the canvas is the page.

Full reasoning and the rejected alternatives: [research.md](./research.md) R1.

One component (`AgentSettingsPanel`) renders in both hosts, and the docked/overlay split is
pure CSS — no media-query JavaScript, so crossing a breakpoint never remounts it. The panel
shrank from 384px to 320px when it stopped hosting content — it now holds only names, counts, an
identity block and a control row, which is close to the reference's own 312px.

## Project Structure

### Documentation (this feature)

```text
specs/006-agent-workspace-tabs/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions R1..R8
├── data-model.md        # Phase 1 — view models & client preferences
├── quickstart.md        # Phase 1 — manual validation walkthrough (no test runner exists)
├── contracts/
│   ├── routes.md        # URL + query-parameter contract
│   ├── components.md    # Component props/emits contract
│   └── preferences.md   # Client-side persisted keys
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

```text
admin/slices/agent/agent/
├── components/agent/
│   ├── workspace/
│   │   ├── Provider.vue        # NEW — three-column shell, tier switching, panel state
│   │   ├── Rail.vue            # NEW — vertical agent list, search, live status
│   │   ├── RailItem.vue        # NEW — one agent row (avatar, name, status, created)
│   │   ├── TopBar.vue          # NEW — "New agent" + cluster capacity (replaces "Back to agents")
│   │   ├── Main.vue            # NEW — compact agent header + usage strip + canvas, :key="id"
│   │   └── Canvas.vue          # NEW — two modes: chat+logs (kept mounted) or one open section
│   ├── settings/
│   │   ├── Panel.vue           # NEW — navigator: identity, section list with counts, lifecycle row
│   │   └── NavItem.vue         # NEW — one section row (title, desc, count, current marker)
│   ├── item/
│   │   ├── Provider.vue        # REWRITTEN — becomes a thin host for workspace/Provider
│   │   └── tabs.ts             # REWRITTEN — AGENT_TABS drops `chat`, gains section metadata
│   ├── list/Provider.vue       # DELETED — the agents table
│   ├── chat/Tab.vue            # EDITED — hosted by Canvas.vue, kept mounted; chat sizing untouched
│   └── overview|knowledge|env|paddock/…   # UNCHANGED — reused verbatim inside sections
├── composables/
│   ├── useAgentLifecycle.ts    # UNCHANGED — already owns SSE + restart/stop/start
│   ├── useAgentSectionCounts.ts # NEW — lazy per-section counts, each failing soft to null
│   └── useSettingsPanel.ts     # NEW — open state + persistence + ?tab= deep link
└── pages/agents/
    ├── index.vue               # REWRITTEN — resolver: pick landing agent, replace-navigate
    ├── create.vue              # UNCHANGED
    └── [id]/index.vue          # EDITED — drops the per-agent page key (moves inward)

app/slices/agent/
├── components/
│   ├── agentWorkspace/
│   │   ├── Provider.vue        # NEW — rail + chat shell
│   │   ├── Rail.vue            # NEW — hand-rolled Tailwind, no shadcn
│   │   └── RailItem.vue        # NEW — reuses Card.vue's status/relative-time logic
│   ├── agentChat/Provider.vue  # EDITED — hosted inside the workspace, header trimmed
│   └── agentList/{Card,Provider}.vue  # DELETED — the card grid
├── composables/useLastAgent.ts # NEW — last-opened agent memory
├── i18n/locales/en.json        # EDITED — new keys (ru.json generated by i18n:sync)
└── pages/agents/
    ├── index.vue               # REWRITTEN — resolver: last-opened → first running → first
    └── [id].vue                # EDITED — renders the workspace
```

**Structure Decision**: Slice architecture, unchanged. Every new file lands inside the
`agent` slice of the console that owns it — `admin/slices/agent/agent` and `app/slices/agent`
— so both consoles keep registering themselves through `registerSlices.ts` with no config
edits. Component names come from the path (`components/agent/workspace/Rail.vue` →
`<AgentWorkspaceRail>`), which is why the directories above are nested the way they are.
Nothing lands outside a feature slice: the navigator model needs no new UI primitive, so the
vendored shadcn set under `slices/setup/theme` is untouched.

## Phase 0 — Research

Complete. Eight decisions recorded in [research.md](./research.md):

| # | Question | Decision |
|---|----------|----------|
| R1 | How do five columns fit in 1440px? | Three tiers; panel docks only ≥1700px, overlays below |
| R2 | Where does a section render when clicked? | Panel navigates; the section takes the middle canvas at its current width |
| R3 | How does the rail get live status? | admin: existing SSE store; app: 30s list refresh, SSE deferred |
| R4 | How is per-agent state reset on switch? | `:key` moves from the page down to `Main.vue` so the rail survives |
| R5 | Where do section counts come from? | Four existing stores, lazily, each failing soft to `null` |
| R6 | How does `/agents` pick the landing agent? | Resolver page + `replace` navigation to the canonical `/agents/:id` |
| R7 | How is panel state persisted, and how does `?tab=` still work? | `localStorage` for open/closed, query param drives the expanded section |
| R8 | Does `app` need shadcn primitives for the rail? | No — hand-rolled Tailwind, matching the console it lives in |

## Phase 1 — Design & Contracts

Complete. Artifacts:

- **[data-model.md](./data-model.md)** — the four view models the workspace needs
  (`RailEntry`, `SettingsSection`, `WorkspaceSelection`, `SectionCounts`) plus the two
  persisted client preferences. No server entities change.
- **[contracts/routes.md](./contracts/routes.md)** — what each route resolves to, the
  `?tab=` deep-link contract including the legacy `chat` value, and the redirect rules.
- **[contracts/components.md](./contracts/components.md)** — props/emits for every new
  component, and the exact reuse contract for the eight existing section components.
- **[contracts/preferences.md](./contracts/preferences.md)** — the two `localStorage` keys,
  their shapes, and their invalidation rules.
- **[quickstart.md](./quickstart.md)** — the manual walkthrough that stands in for the
  automated suite this repo does not have, mapped to FR/SC ids.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | ~~**Panel width vs heavy sections.**~~ **Dissolved by R2.** Sections render in the canvas at the width they already have, so Files, Environment and Paddock need no layout work at all. | Retained here as a record: this was the plan's top risk while the panel was a container, and it is the main reason the navigator model won. |
| 1a | **Chat state lost when a section opens.** If the chat is unmounted rather than hidden, returning costs a websocket reconnect and a transcript refetch — and the restart overlay state goes with it. | `v-show`, never `v-if`, on the chat branch of `Canvas.vue`. SC-004a is the check; quickstart step 6 verifies the transcript and scroll position survive a round trip. |
| 2 | **Deleting the table loses a capability nobody noticed.** FR-009 lists six; a seventh may be hiding in `list/Provider.vue`. | Before deleting, diff the file against the new homes and tick off every action, badge and warning. Quickstart step 10 is that checklist. |
| 3 | **Rail remount on every agent switch** would refetch the list and flash the column. | R4 — the `:key` lives on `Main.vue`, not the page. Verified by watching the network panel while switching (quickstart step 4). |
| 4 | **`app` gets no live status** without the SSE port, so a stopped agent can read "Running" for up to 30s in the rail. | Accepted for v1 and stated in R3; the open agent still polls at 3s while transitional. The SSE endpoint is public, so the port is a clean follow-up. |
| 5 | **i18n drift** — a string added to a template but never to `en.json` renders as a raw key. | `bun run i18n:check` is a release gate (`docs/i18n.md`); quickstart step 16 runs it. |

## Complexity Tracking

No constitution violations to justify — this section is intentionally empty.
