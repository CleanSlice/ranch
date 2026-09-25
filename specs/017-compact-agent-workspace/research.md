# Research: Compact agent workspace

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-25

All findings come from reading the current `admin` code on `origin/main` (22f58b1). No
`NEEDS CLARIFICATION` markers were carried over from the spec; the decisions below are
the ones the plan needs to be executable.

---

## R1 — Tab model: two workspace tabs over ten sections, one URL parameter

**Decision**: keep `?tab=` as the single addressable state and widen its vocabulary by one
value, `settings`. `sections.ts` gets three exports:

- `WORKSPACE_TABS = ['chat', 'settings']` — what the header renders.
- `SECTIONS` — the ten sections (today's `AGENT_TABS` minus `chat`), each with `value`,
  `title`, `desc`, `countKey`, and an `icon`.
- `AgentTab = 'chat' | 'settings' | Section['value']` — the full `?tab=` vocabulary.

Two pure derivations replace `PRIMARY_TABS` / `OVERFLOW_TABS`:

- `workspaceTabOf(tab)`: `'chat'` for `chat`, `'settings'` for everything else.
- `sectionOf(tab)`: the section record for a section value, `null` for `chat` and
  `settings`.

`toAgentTab()` keeps its contract — unknown → `chat`, `peers` → `a2a` — and additionally
accepts `settings`. `useAgentTab()` is untouched: `setTab('settings')` writes
`?tab=settings`, `setTab('chat')` strips the parameter, `setTab('files')` writes
`?tab=files` and the header highlights Settings because `workspaceTabOf('files')` is
`settings`.

**Rationale**: the eleven existing values are a shared-link contract (spec FR-008); the
cheapest way to keep every link working is to not touch the parameter, only its
interpretation. A second parameter (`?tab=settings&section=files`) would break the rule
that one value describes the screen and would need a migration for old links.

**Alternatives considered**: nested routes (`/agents/:id/settings/files`) — rejected: the
page is pinned to one instance by `definePageMeta({ key: 'agents-workspace' })` so the rail
survives agent switches, and a route change would reintroduce the remount the key exists
to prevent. Keeping `More` as an overflow inside Settings — rejected: the hub already
lists everything.

---

## R2 — Settings hub and section frame

**Decision**: `Canvas.vue` gains one branch: when `tab === 'settings'` it renders
`<AgentWorkspaceSettingsHub :sections :counts @open>`; when `sectionOf(tab)` is set it
renders `<AgentWorkspaceSectionFrame :section @back>` above the section component exactly
as it renders today. The hub is a responsive grid of `SectionCard`s modelled on the second
reference screenshot: an icon tile (tabler icon per section, in the same tinted square the
agent avatars use), title, one-line description (the `desc` already on each section), and
a count chip for the five countable sections (`null` → a muted "…" placeholder, never
`0`). The frame is one row: a ghost button "← Settings" that calls `setTab('settings')`
and the section title.

**Rationale**: the existing section components are untouched (the same argument specs/006
made — they already render at full width). The hub costs one new grid and one small card;
the frame is the "visible way back" FR-007 asks for.

**Alternatives considered**: keeping a slim secondary tab row under Settings — rejected
by the request ("основное всё вынесено"); a hub that opens sections in a sheet/drawer —
rejected: several sections (Files tree, Paddock, Chats) need the full width.

---

## R3 — Usage as one line with a popover

**Decision**: a new `usage/components/usage/Line.vue` (`<UsageLine :agent-id @details>`).
It reads the same `usageStore.fetchForAgent(agentId)` the strip reads (via `useAsyncData`
with the same key so the request is shared), and renders:

- loading → muted "Loading usage…" (not a button)
- error → muted "Usage unavailable" (not a button)
- empty → muted "No usage yet" (not a button)
- data → a text button `{{ usageLineText }}` that toggles a reka-ui `Popover` beneath it
  listing Cost / Calls / Input / Output / Today (today's model in the `title`) and a
  **Details** action that emits `details` (Main.vue routes it to `setTab('overview')`).

`usageLineText(totals, topModel)` is a pure util in `usage/utils/usageLine.ts`:
`"$15.31 / 30d · claude-haiku-4-5"`, or `"$15.31 / 30d"` when `topModel` is null. It
uses the existing `formatUsd`. The model part gets `truncate` in the template so the cost
never truncates (spec story 3, scenario 5).

`UsagePanel`'s `strip` variant is deleted in the same change; `graft grep` on origin/main shows
`Main.vue` as its only host. The `panel` variant (Overview card, Rancher) is untouched.

**Rationale**: a fourth variant inside the 400-line `Panel.vue` would put a popover in a
component that otherwise has none; a sibling component is smaller and easier to reason
about. Sharing the `useAsyncData` key keeps SC "no new requests".

**Alternatives considered**: showing the six figures in a tooltip — rejected: a tooltip
cannot hold the Details action and is keyboard-hostile.

---

## R4 — Frameless chat

**Decision**: admin's `BridleProvider` gets a boolean `frameless` prop (default `false`).
When set:

- the root `Card` drops its border, shadow and background (`border-0 shadow-none
  bg-transparent`) — it stays a `Card` so `data-slot="card-content"` still exists for the
  Chat Tab's overlay-measurement code;
- the `CardHeader` (bot icon, title, Tools button, restart prompt, New chat, connection
  status) is not rendered;
- the composer's toggle row (`Debug`, `Markdown`) also hosts, right-aligned, the **New
  chat** ghost button and the connection status dot + label — the reference draws
  "● Reconnecting…" beside the send button;
- the transcript and composer are capped at a readable measure (`max-w-4xl mx-auto`) so a
  wide monitor does not produce 1600 px lines. The Chat Tab drops its
  `basis-1/2 max-w-200` wrapper and the side column entirely.

`app/slices/bridle` already has the equivalent `showHeader` prop (its chat provider is
rendered headerless by the app agent page). The names differ on purpose: admin's flag
also strips the frame, not only the header.

**Rationale**: the fewest lines that satisfy "снести границы у чата" without forking the
chat widget; every control that lived in the header keeps a visible home.

**Alternatives considered**: moving "New chat" to the `…` menu — rejected: the reset
belongs to the bridle store/provider, and hoisting it means threading a callback through
Main → Canvas → Chat Tab → BridleProvider for one button.

---

## R5 — Logs bar under the composer, single poller

**Decision**: a new `logs/Bar.vue` (`<AgentLogsBar :agent-id :restarting :first-start>`)
rendered by the Chat Tab under the `BridleProvider`, only while `props.active` is true
(the same guard the side logs used, so nothing polls behind Settings). It has two
mutually exclusive states, switched with `v-if` so exactly one `useAgentLogs` instance —
and therefore one 5 s poller — exists at a time:

- **collapsed** — the bar owns a `useAgentLogs` instance and renders one row:
  `▸ Logs · <latest time> <latest text>` on the left and `<N> entries` on the right,
  with `· <k> ⚠` appended in amber when `alerts > 0`. Special states, in priority order:
  `restarting` prop → "Agent is restarting…" (or "Setting up agent…" on first start);
  `containerWaitingLabel` → that label with a spinner; `statusLabel` (no pod / fetch
  failed) → that label; `error` → "Logs unavailable"; empty → "No entries yet · 0".
- **expanded** — the bar renders the existing `AgentLogsPanel` with `closable` in a region
  that takes ~40 % of the column height (`basis-2/5 min-h-56`), the chat shrinking above
  it; the panel's close emits back to collapsed. The header row of the panel is its own
  (title, Auto 5 s, Reload, ✕), so the bar adds no second header.

`summarizeAgentLogs(groups: IAgentLogGroup[]): ILogSummary` is a pure util added to
`utils/agentLogs.ts` — `{ latest: IAgentLogLine | null; total: number; alerts: number }`
where `alerts` counts lines with a `level`. Unit-tested.

The expanded/collapsed flag is a `ref` inside the bar; `Main.vue` is keyed by agent id,
so switching agents remounts the bar collapsed (spec edge case).

**Rationale**: the `v-if` swap is what makes SC-005 provable by construction rather than
by discipline — there is no moment with two composable instances. Reusing `AgentLogsPanel`
unchanged keeps the restart overlay, level chips, day separators and sticky scroll.

**Alternatives considered**: one shared `useAgentLogs` instance passed down to the panel —
rejected: the panel calls the composable itself and is also mounted by the full-width
Logs section; changing its ownership model for the bar is a bigger diff for the same
result. A resizable split — deferred: a fixed 40 % region is what the reference implies.

---

## R6 — `…` menu and Share as a submenu

**Decision**: `Main.vue`'s header actions become `[Stop|Start] [⋯]`. The menu lists, in
order: **Restart** (disabled under the same `isRestarting || toggling` condition), **Tools**
(`toolCatalogStore.openSheet(agentId)`), **Edit** (`DropdownMenuItem as-child` around
`NuxtLink`), **Share ▸** (a `DropdownMenuSub`), a `DropdownMenuSeparator`, **Delete agent**
(destructive, as today).

Share is a submenu, per the requester (2026-09-25): it opens beside the Share row and
the menu stays open. The vendored `dropdown-menu` set already ships `DropdownMenuSub`,
`DropdownMenuSubTrigger` and `DropdownMenuSubContent`. A new `ShareMenuSub.vue` in the
`share` slice renders the trigger row and a `SubContent` whose *every* control is a
`DropdownMenuItem`:

| State | Rows |
|-------|------|
| loading | one disabled row with a spinner |
| read failed | "Could not load the share link." (disabled) · **Try again** |
| shared | link row (`DropdownMenuLabel`, mono, truncated, `title` = full URL; "Shared <date>" under it) · **Copy link** / "Copied" · **Open in the app** (`as-child` → `<a target=_blank>`) · **Regenerate** · **Revoke** (destructive) |
| shared, app URL unknown | the amber note as a disabled row · **Regenerate** · **Revoke** |
| confirming | the question (disabled row) · **Revoke link** / **Replace link** (destructive, spinner while pending) · **Cancel** |
| not shared | "This agent is not shared." / "Link revoked." (disabled) · **Share** |

Rows that must not close the menu call `event.preventDefault()` in their `@select`
handler. Verified in reka-ui 2.10.3 `Menu/MenuItem.js`: the item checks
`itemSelectEvent.defaultPrevented` and skips the close when it is set — the same contract
as Radix. Only **Open in the app** lets the menu close (it navigates away).

The panel's logic (link, `isShared`, `appUrlMissing`, `shareUrl`, `loadingLink`,
`linkUnknown`, `sharedSince`, `copied` + timer, `confirming`, `revoked`, `onCopy`,
`onShare`, `onConfirm`) is lifted verbatim into a composable `useShareLink(agentId)` in
`share/composables/`, so the submenu is template-only on top of it. The read happens when
the submenu opens (`@update:open` on `DropdownMenuSub`) — reading, never minting, as
today. Admin's `share/panel/Provider.vue` is deleted: `graft grep` on origin/main shows
`Main.vue` as its only host, and the header no longer renders it.

Why rows and not the panel as-is: reka-ui `MenuContent` owns keyboard navigation
(arrows, typeahead on printable keys, Tab prevented) and focus moves only between
`role=menuitem` elements, so a readonly `<input>` and plain `<button>`s inside a
`SubContent` would be unreachable by keyboard and would lose printable keys to typeahead.
As menu rows the same controls get the menu's keyboard for free (spec FR-020). Nothing
in the flow needs typing: the URL is copied, not edited.

Submenu geometry is reka-ui's default: opens to the `right` side of the row, flips left
on collision, closes on pointer leave toward another row (with the built-in grace area)
or on ←/Escape, which returns focus to the trigger row.

Tools and Delete keep today's sequence (menu closes on select, then the sheet / dialog
opens). The Tools sheet is mounted by the chat composer, which stays mounted behind
Settings, so Tools works from any tab.

**Rationale**: spec § "The Share button under `…` — decision". This is the only shape in
which "next to the Share row, menu stays open" holds without a second overlay: the
submenu *is* the menu.

**Alternatives considered**: sequence menu → floating popover anchored to `…` (the
previous R6) — dropped at the requester's request: the panel should sit beside the Share
row and the menu should stay open. A `SubContent` holding the existing panel markup —
rejected: the text field and plain buttons are not menu items (keyboard-unreachable).
An accordion row inside the menu — rejected for the same reason plus the height jump.

---

## R7 — Status dot on the avatar

**Decision**: a new `status/Dot.vue` (`<AgentStatusDot :status :status-reason
:deploy-verb :deploy-ago :deploy-hint-title>`) rendered at the avatar's bottom-right
corner in `Main.vue`, replacing the `Badge` and the "restarted 2m ago" text. Colour and
pulse come from the `TONE` map in `useAgentRailEntries.ts` (exported for this). The dot is
wrapped in the vendored `Tooltip` whose content reads `running · restarted 2 minutes ago`,
then the reason line when present, then the existing "Last deploy started … · files picked
up …" hint. The `runtimeOffline` text and the pending-restart banner stay as visible text.

**Rationale**: the reference draws only a dot; the rail already renders the same status
dot per agent, so the header and the rail agree at a glance. Tooltip primitives are
vendored (`ui/tooltip`), so no new dependency.

**Alternatives considered**: keeping the Badge — rejected by the reference; folding status
into the usage popover — rejected: unrelated information.

---

## R8 — Width budget

**Decision**: the middle column is `flex-1 min-w-0` as today; the frameless chat is
`w-full` inside it with the transcript and composer capped at `max-w-4xl` and centred. The
header row is a single flex row: identity (shrinks, name truncates) · tabs · spacer · usage
line (model truncates) · Stop · `…`. Below ~900 px the usage line wraps under the tabs
(`flex-wrap` with the line given `order` after the tabs and `basis-full`), so Stop and `…`
never leave the row.

**Rationale**: specs/006 solved the horizontal budget by shrinking nothing; this feature
removes the 400 px log column, so the constraint that shaped 006 disappears. The cap keeps
long assistant messages readable on 1920 px screens.

---

## R9 — Tests and gates

**Decision**: three `bun test`-shaped util tests, no component tests:

- `utils/sections.test.ts` — `toAgentTab` accepts `settings`, still maps `peers` → `a2a`,
  unknown → `chat`; `workspaceTabOf` / `sectionOf` derivations for every value.
- `utils/agentLogs.test.ts` — `summarizeAgentLogs`: empty → `{latest: null, total: 0,
  alerts: 0}`; latest is the last line of the last group; alerts counts warn+error.
- `usage/utils/usageLine.test.ts` — with and without a model; no dangling separator.

Gates: `bun test slices` in `admin`, `bun run typecheck` in `admin` (revert the regenerated
SDK files afterwards), and the [quickstart.md](./quickstart.md) walk for the overlay
sequencing, single-poller and keyboard rules, which cannot be asserted without a component
harness.

**Rationale**: matches the repo's actual test surface (nine util tests, `bun test
slices`); pretending to have component coverage would be worse than saying which checks
are manual.
