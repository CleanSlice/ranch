# Phase 0 — Research: Agent workspace

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-20

The Technical Context carried no `NEEDS CLARIFICATION` markers — the spec's three open
questions were answered by the requester before planning started. What follows is the design
research the plan depends on: eight decisions, each with what was rejected and why.

---

## R1 — Fitting five columns into a screen that holds three

**Question**: FR-010 keeps the chat at `min-w-100 max-w-200` with the logs panel beside it,
FR-001 adds a rail, FR-013 opens a settings panel by default, and the admin console already
spends 256px on its primary sidebar. What gives?

**The arithmetic** (Tailwind 4: `min-w-100` = 400px):

```
sidebar 256 + rail 272 + chat 400 + logs 400 + panel 320  =  1648px   (+ gaps ~1690px)
```

A 1440px screen is ~250px short; a 1536px screen is ~150px short. Only ≥1700px holds all five
with any slack.

Note this is the *chat* mode of the canvas. In section mode the canvas is one flexible column
instead of two fixed ones (R2), so the arithmetic stops binding entirely — a section gets
~910px at 1440px and ~850px at 1700px, against ~800px today.

**Decision (revised during implementation)**: the panel always takes real space above the
tablet breakpoint, and the **chat/logs pair absorbs the difference** by shrinking.

The original decision — float the panel over the right edge below 1700px so the chat never
went under its 400px floor — was implemented and then reverted on sight. Two things were
wrong with it in practice:

- The floating panel **covered the pod logs**, which are half of why an operator is on this
  screen. Hiding content is worse than shrinking it.
- The hard `min-w-100` floors on *both* halves meant an 812px minimum for the pair. Once the
  rail took its 272px, a narrower container simply **overflowed**, and `overflow-x-clip` on
  the layout ate the chat card's right border. Content silently cut off is the worst of the
  available failure modes.

So the floor is now gated on there being room for it (`min-[1400px]:min-w-100`), both halves
carry `min-w-0` below that, and the logs keep their existing collapse button for when the
operator wants the chat back at full width.

| Viewport | Rail | Chat | Logs | Settings panel |
|----------|------|------|------|----------------|
| ≥1400px | docked | docked, 400px floor restored | docked | **docked**, open by default |
| 1024–1399px | docked | docked, shrinks with the pair | docked, shrinks | **docked**, open by default |
| <1024px | on-demand overlay | full width | existing behaviour | full-screen overlay |

At ≥1400px the middle of the screen is what it always was. Below that everything stays
visible and bordered, just narrower — and one click on the logs' own collapse button hands
the whole middle column back to the chat.

**Rationale**: the requester's correction was that the chat and logs pair must not *change* —
which the ≥1400px behaviour honours exactly. Below that, something has to give, and the
choice is between shrinking (everything visible, borders intact) and hiding or clipping. On a
screen that cannot hold the ideal layout, seeing all of it slightly smaller beats seeing part
of it cut off.

**Alternatives considered**:

- **Dock the panel everywhere and auto-collapse the logs when it opens.** Still rejected:
  silently collapsing a panel the operator left open reads as the UI fighting them, and the
  operator can do it themselves in one click when they want the room.
- **Hide the logs entirely below a breakpoint.** Would keep the chat's 400px floor intact at
  every width, but the logs' own toggle lives in that column — hiding it takes the logs away
  with no way back, which FR-025 forbids.
- **Float the panel over the right edge (the original decision).** Implemented, then reverted:
  see the revised decision above.
- **Shrink the chat's minimum width below 400px.** Directly contradicts the requester's
  instruction to leave the chat as it is.
- **Narrow icon-only rail (~64px).** Kills FR-002 — the whole point is that a rail entry
  carries name, status and date.
- **Make the rail an overlay at every width.** Turns one-click agent switching (SC-002) into
  two clicks.

---

## R2 — Where a section renders when the operator clicks it

**Question**: the panel lists eight sections. Clicking one — where does its content go?
Inline in the panel, in the middle of the screen, in a wide drawer, somewhere else?

**Decision**: the panel is a **navigator**. Clicking a section shows it in the **middle
canvas, in place of the conversation**, at the width that column already provides. The
conversation stays mounted behind it (`v-show`, not `v-if`) and returns with one click. The
panel stays visible throughout, marking which section is current, so moving to another section
is also one click.

**What decided it — the width of the actual content.** Measured against the eight existing
components:

| Section | Survives a ~400px panel? |
|---------|--------------------------|
| Overview | Yes — a card grid that already collapses to one column |
| Knowledge | Yes — a list |
| Secrets | Yes — key/value rows with a reveal toggle |
| Channels | Yes — small forms |
| Chats | Yes for the list; opening a conversation wants width |
| Environment | Borderline — a key/value/actions table, would need stacked rows |
| **Files** | **No** — a tree and an editor side by side |
| **Paddock** | **No** — scenario and run tables |

An inline panel therefore means redesigning at least three components that work fine today,
for zero user benefit. Rendering in the canvas means changing **none** of them — they get
roughly the width they already have (~910px at 1440px with the panel overlaying, ~850px at
1700px docked, against ~800px today).

**The reference agrees.** Its panel rows carry `›` chevrons and count badges — the vocabulary
of navigation, not of an accordion. The earlier draft of this plan read "с возможностью быть
свернутыми" as *sections* collapsing and specified an accordion; on review that phrase more
plausibly describes the panel itself, and the requester confirmed the navigator reading.

**Cost, stated plainly**: the operator cannot read the conversation and a settings section at
the same time. That case is real — "the agent says it can't find a file, let me look at
Files" — but it is occasional, while cramped tables would be felt in every session that opens
Files or Paddock. The trade goes to the common case.

**Alternatives considered**:

- **Inline accordion in the panel.** The only real advantage is simultaneous view. Costs the
  three redesigns above, and would have kept a drag-resize handle on the roadmap as a
  workaround for a problem the canvas model does not have.
- **Wide modal drawer over everything.** Gets the width, but hides the rail and the
  conversation, and below 1700px the panel is itself an overlay — drawer inside a drawer.
- **Hybrid: light sections inline, heavy ones in the canvas.** Maps neatly onto real usage
  (glance vs. deep dive) and could be signalled with a distinct icon per row. Rejected for
  predictability: two behaviours in one list means the operator learns which rows do what.
  Worth revisiting only if the simultaneous-view case turns out to matter more than expected.

**Consequences elsewhere in this plan**: no shadcn `accordion` needs vendoring; the panel
shrinks from 384px to 320px; plan Risk 1 disappears and is replaced by the narrower Risk 1a
(keep the chat mounted).

---

## R3 — Where the rail's live status comes from

**Question**: FR-005 requires rail status to track live runtime state without a manual
refresh, in both consoles.

**Finding**: `api/src/slices/agent/agent/agent.controller.ts:166` exposes
`@Sse('status/stream')` and it is annotated **`@Public()`** — "EventSource cannot send
Authorization headers". `admin` already consumes it through `useAgentStatusStore`
(`stores/agentStatus.ts`, backed by a gateway/mapper/service triple, ~317 lines total), and
`useAgentLifecycle` already connects and disconnects it per mounted agent page. `app` has no
equivalent — its list page fetches once and never refreshes; its detail page polls every 3s
only while the agent is transitional.

**Decision**:

- **admin**: the rail reads `useAgentStatusStore.statuses` — zero new plumbing, and the store
  ref-counts subscribers so the rail and `useAgentLifecycle` share one `EventSource`.
- **app**: the rail refreshes the agent list on a 30s interval, reusing the interval pattern
  already in `agentList/Provider.vue` for cluster capacity. The open agent keeps its existing
  3s transitional poll.

**Rationale for not porting SSE to `app` now**: it means duplicating a gateway, mapper,
domain service, types file and store into `app/slices/agent` — ~317 lines of layered
plumbing — to make a rarely-changing list update 30s sooner. The endpoint being public means
that port stays available as a clean follow-up whenever the app rail's staleness is actually
felt. The trade-off is recorded as plan Risk 4 rather than hidden: an agent stopped from
elsewhere can read stale in the app rail for up to 30s.

---

## R4 — Resetting per-agent state without remounting the rail

**Question**: FR-026 requires that switching agents leaves nothing of the previous agent
behind — messages, logs, file tree, section content. Today `admin/…/pages/agents/[id]/index.vue`
achieves this with `definePageMeta({ key: (route) => \`agent-${route.params.id}\` })`, which
remounts the entire page subtree on every id change. With a rail on that page, the rail would
remount too: the column would flash and the agent list would refetch on every switch.

**Decision**: move the remount boundary inward. The page drops its dynamic key; the workspace
provider renders a persistent `<AgentWorkspaceRail>` beside `<AgentWorkspaceMain :key="id">`.
Everything that holds per-agent state lives under `Main.vue`; the rail and the top bar do not.

**Rationale**: it is the same mechanism (Vue's `key` forcing a fresh component tree), applied
one level down, so the guarantee that motivated the original comment on that file is
preserved exactly. The rail's own data is the agent *list*, which is agent-independent.

**Verification**: quickstart step 4 watches the network panel while switching agents — the
list request must not repeat.

---

## R5 — Where settings-section counts come from

**Question**: FR-015 wants a count beside Knowledge, Files, Secrets and Channels. Is there an
aggregate endpoint?

**Finding**: no, and none is needed — each count is already reachable from a store the
corresponding section uses:

| Section | Source | Cost |
|---------|--------|------|
| Knowledge | `useAgentKnowledges(agentId, agentRef).resolved.length` — resolves the per-agent override or the template default | 2 requests, both `useAsyncData`-deduped with the section itself |
| Files | `useAgentFileStore().list(agentId)` node array length | 1 request, shared with the Files section |
| Secrets | `agentSecret` store list length | 1 request, shared with the Secrets section |
| Channels | `useAgentChannelStore().fetchForAgent(agentId)` length | 1 request, shared with the Channels section |

**Decision**: one `useAgentSectionCounts(agentId)` composable that fires the four fetches
**only once the panel is open**, independently, each `catch`-ing to `null`. A count that is
absent, still in flight, or failed renders nothing — the section header and its chevron are
unaffected (FR-015, US3 scenario 2).

**Rationale**: the requests are the same ones the sections themselves make and `useAsyncData`
keys are shared, so opening a section after seeing its count costs nothing extra. Gating on
panel-open avoids four requests per agent switch for operators who keep the panel collapsed.

**Alternative rejected**: adding an aggregate `GET /agents/:id/counts` endpoint. It would be
one request instead of four, but it means an API change, a DTO, a regenerated OpenAPI client
in both consoles, and a new server-side fan-out — for numbers that are decoration on a panel.
Revisit only if the four-request fan-out shows up as a real cost.

---

## R6 — How `/agents` picks the agent to land on

**Question**: FR-007 (admin: the Ranch admin agent) and FR-020 (app: last opened) both need
`/agents` to resolve to a specific agent, while FR-004 wants the address to stay linkable.

**Decision**: `/agents/index.vue` in each console becomes a **resolver page** — it fetches the
list it already fetched before, picks an id, and `navigateTo(\`/agents/${id}\`, { replace: true })`.

- **admin**: `agents.find(a => a.isAdmin)` → else the most recently updated → else the empty
  state.
- **app**: remembered id (if still in the visible list) → first `running` → first in list →
  else the empty state.

`replace: true` keeps `/agents` out of the history stack, so Back from an agent goes where the
operator came from rather than bouncing through the resolver.

**Rationale**: keeping `/agents/:id` as the canonical address is what preserves deep links,
sharing, browser history and the existing `?tab=` links. Rendering the workspace at a bare
`/agents` URL and only mutating the address on the first rail click would leave the landing
agent unlinkable and break the back button on the first switch.

**Empty state**: when the list is empty the resolver renders in place rather than redirecting
— the create CTA for Owner/Admin, the "ask an admin" line otherwise, mirroring what each
console already shows today.

---

## R7 — Panel open state, and keeping `?tab=` alive

**Question**: FR-013 (open by default, choice persists) and FR-016 (`?tab=env` still opens
that section, closing clears the parameter) interact — one is a preference, the other is a
URL.

**Decision**: split them cleanly.

- **Open/closed** is a *preference*: `localStorage`, key `agent:settingsPanelOpen`, absent ⇒
  open. Not in the URL — an operator's panel habit should not travel in a shared link.
- **Which section is expanded** is *addressable*: the existing `?tab=<value>` query parameter,
  unchanged in name and values so every old link keeps working. Present ⇒ the panel is open
  regardless of the stored preference, expanded on that section. Closing the panel removes the
  parameter (`router.replace`), exactly as FR-016 requires.
- **Legacy `?tab=chat`** — `chat` was a tab and is now the canvas itself. It is treated as "no
  section": the workspace opens normally, panel in its stored state, and the stale parameter is
  stripped. An unrecognised value behaves the same way.
- The usage strip's `@details` event, which today sets `activeTab = 'overview'`, instead opens
  the panel on the Overview section (FR-025).

**Rationale**: preferences that ride in the URL leak into shared links and make two operators
disagree about "the same" page; addressable state that lives only in `localStorage` breaks
deep links. Each piece of state goes where its purpose puts it.

---

## R8 — Does the `app` rail need shadcn primitives?

**Question**: admin has ~22 vendored shadcn components; `app` has exactly one (`badge`).
The rail is the same *concept* in both consoles — should the app rail pull in shadcn?

**Decision**: no. The `app` rail is hand-rolled Tailwind, matching `agentList/Card.vue` and
`agentChat/Provider.vue` beside it. The status dot with its `animate-ping` pulse, the initials
avatar, and the relative-time bucketing all already exist in `Card.vue` and move into
`RailItem.vue` rather than being re-derived.

**Rationale**: `app` is a deliberately lighter console — pulling reka-ui in for a list of rows
would add a dependency and a styling idiom the rest of the console does not use, for a
component that is a `<ul>` of buttons. The shared *behaviour* between the two rails is thin
(pick an agent, show status); the shared *styling* is zero, since the consoles have different
design languages.

**Consequence for reuse**: the two rails are separate components in separate consoles by
design. What they share is the contract in [contracts/components.md](./contracts/components.md),
not code — there is no cross-console package to put shared code in, and creating one for two
list components would be the wrong trade.

---

## Rejected outright

- **A shared `@cleanslice/*` package for the rail.** No such package boundary exists between
  `app` and `admin` today; introducing one for two visually divergent list components is
  overhead with no payoff.
- **Keeping the agents table behind `/agents/all`.** The requester explicitly chose full
  removal (FR-008).
- **Virtualised rail list.** Worth it at thousands of rows; a Ranch install has dozens. Plain
  rendering plus the FR-023 search filter is enough, and virtualisation can be added later
  without changing the contract.
