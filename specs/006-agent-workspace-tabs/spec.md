# Feature Specification: Agent workspace — vertical agent tabs + settings panel

**Feature Branch**: `feat/CLEAN-36-agent-workspace-tabs`

**Created**: 2026-08-20

**Status**: Draft

**Tracker**: [CLEAN-36](https://dreamvention.atlassian.net/browse/CLEAN-36)

**Visual reference**: `export-1a/Agent Interface 1a.dc.html` — left rail of agents, conversation in the middle, settings in a right-hand panel. Deliberately untracked and temporary: it is dropped once the implementation lands, so treat the description in this spec as the durable record of it.

**Input**: User description: "Необходимо обыграть реализацию для admin/app приложений. В app набор агентов — это скучные плашки сейчас, должен быть список табов вертикальных. То же самое и в admin, только все настройки агента перетекают в правый бар с возможностью быть свернутыми; в настройках чуть больше деталей, например количество знаний, файлов и т.д. Важно, чтобы основные пункты навигации в админке не были удалены — референс может запутать: мы работаем лишь с интерфейсом агентов. Отказываясь от agents-таблицы, мы сразу будем падать в главного агента (rancher) с возможностью переключиться на других по табам; в табах можно вывести лёгкую информацию как сейчас в таблице — статус, дату создания, не перегружая."

## Overview

Both consoles today make a person pass through an index screen before they can do the
one thing they came for — talk to an agent. In `admin` that index is a table; in `app`
it is a grid of cards. Once inside an agent, `admin` spends a whole vertical column on
nine settings tabs — a column that exists only to reach configuration the operator opens
rarely, sitting permanently next to the thing they came for.

This feature turns the agent screen into a workspace of three parts: a vertical list of
agents on the left that doubles as navigation between them; a middle column that shows
the conversation with the pod logs beside it exactly as they are today; and (in `admin`
only) a right-hand panel that navigates the agent's settings and holds its controls. The
agents table and the agent cards grid stop being a stop on the way and are retired.

**The right-hand panel navigates; it does not contain.** It lists the eight sections with
their counts and carries the agent's identity and lifecycle controls, and it stays narrow.
Opening a section shows that section in the middle column, in place of the conversation,
at the width that section already renders at today — which is why none of the eight
existing section components has to be redesigned. The conversation is not torn down when
that happens: it stays alive behind the section and returns with one click.

**The conversation is not stretched.** The chat widget keeps its current sizing and keeps
the logs panel next to it — a chat column that runs the full width of a wide monitor is
harder to read, not easier, and the logs are half of why an operator is on this screen.
What the change buys is the removal of a navigation column, not extra chat width.

The admin console's own primary navigation (Workspace / Admin sidebar with Rancher,
Agents, Templates, Users, LLM, Settings, …) is **not** part of this change and stays
exactly as it is. The visual reference does not draw it; that is an artefact of the
mockup, not an instruction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin: one agent workspace instead of a table plus nine tabs (Priority: P1)

An operator opens **Agents** in the admin console. Instead of a table, they land directly
in a conversation with the main (Ranch admin / "rancher") agent. Every agent they can
manage is listed vertically on the left with just enough to tell them apart — name, live
status, when it was created, an admin marker. Clicking another entry swaps the
conversation without leaving the screen. Everything that used to live in the nine
vertical tabs — Overview, Knowledge, Files, Secrets, Environment, Channels, Chats,
Paddock — is now reached from a panel on the right, which the operator can collapse when
they just want to talk. That panel is a **navigator**: it lists the sections with their
counts and the agent's controls, and opening a section shows it in the middle of the
screen, where the conversation was, at the width that section has always had. The
conversation is not destroyed by that — it comes back with one click, transcript intact.

**Why this priority**: This is the whole point of the ticket — the operator's default
intent (talk to an agent) becomes the default state of the screen, and the two competing
navigation columns collapse into one rail plus one panel.

**Independent Test**: Open `/agents` as an admin with at least two agents, one of them
the admin agent. Verify the conversation opens immediately, the left rail lists both
agents, switching between them changes the conversation, and each of the eight settings
sections is reachable from the right panel and behaves as it did before.

**Acceptance Scenarios**:

1. **Given** an admin console with a Ranch admin agent, **When** the operator opens the
   Agents area for the first time, **Then** the workspace opens on that agent's
   conversation with no table in between, and the settings panel is already open so the
   agent's controls are one glance away rather than one click.
2. **Given** the workspace is open on agent A, **When** the operator clicks agent B in
   the left rail, **Then** the conversation, header, usage strip and settings panel all
   switch to agent B and the address bar points at agent B.
3. **Given** the workspace is open, **When** the operator collapses the settings panel,
   **Then** the space goes back to the conversation-and-logs pair within their existing
   size limits, and the panel can be reopened from the header.
4. **Given** no section is open, **When** the operator looks at the middle column, **Then**
   the chat and the pod logs sit side by side with every border drawn and nothing clipped —
   at the sizes they have today when the viewport allows it, and shrunk together rather
   than overflowing when it does not.
5. **Given** the operator opens a section from the panel, **When** the section renders,
   **Then** it takes the middle column at the width that column already has, the panel
   marks that section as the open one, and a single control returns to the conversation
   with its transcript and connection intact.
6. **Given** an operator follows an old link carrying a settings-section parameter (e.g.
   `?tab=env`), **Then** the workspace opens with the settings panel already showing that
   section; closing the panel removes the parameter from the address.
7. **Given** the admin console's primary sidebar, **When** the workspace ships, **Then**
   every navigation entry that existed before is still present and still works.

---

### User Story 2 - App: a vertical agent list instead of a grid of cards (Priority: P2)

A customer opens the agents area of the app console. Instead of a grid of cards they see
the same vertical rail of agents on the left and a conversation beside it, at the readable
width it has today. Rail entries carry the same light information as the admin rail —
name, status, last activity. There is no settings panel here: management stays in admin.

**Why this priority**: It gives the customer console the same "you are already in a
conversation" feel, but the admin surface is the one with the acute problem (two
navigation columns), so it lands second.

**Independent Test**: Open the agents area in `app` as a user who can see two or more
agents. Verify a conversation opens directly, the rail lists the visible agents, and
switching entries switches the conversation — with no settings panel anywhere.

**Acceptance Scenarios**:

1. **Given** a user with visible agents, **When** they open the agents area, **Then** a
   conversation opens directly and the other agents are listed in the left rail.
2. **Given** the user last talked to agent B, **When** they return to the agents area
   later, **Then** the workspace opens on agent B; if agent B is no longer visible to
   them, it opens on the first running agent instead.
3. **Given** the app workspace, **When** the user looks for agent settings, **Then**
   there is no settings panel and no settings sections — only the conversation and the
   controls the user already had (restart, where permitted).
4. **Given** a user whose role does not permit creating agents, **When** the rail
   renders, **Then** the create action is absent, exactly as it was on the cards screen.
5. **Given** every user-visible string added by this story, **When** the locale is
   switched to Russian, **Then** the string is translated (English source in the slice's
   `en.json`, Russian generated by the sync tool).

---

### User Story 3 - Admin: settings panel that says more at a glance (Priority: P3)

Inside the right-hand panel, each section shows how much is behind it before the operator
opens it — how many knowledge bases the agent can query, how many stored files, how many
secrets, how many messaging channels. The number is the reason to click, so it has to be
there before the click. The panel remembers whether it was open.

**Why this priority**: Additive polish on top of User Story 1 — the panel is useful
without the counts, but the counts are what make it worth opening.

**Independent Test**: Open the settings panel for an agent with known amounts of
knowledge, files, secrets and channels; verify each number matches what the corresponding
section lists when opened.

**Acceptance Scenarios**:

1. **Given** an agent attached to 12 knowledge bases, **When** the settings panel renders,
   **Then** the Knowledge section shows 12 alongside its name.
2. **Given** a count that cannot be determined (the source is unreachable or still
   loading), **When** the section renders, **Then** the section is still listed and still
   openable, simply without a number.
3. **Given** the operator collapsed the panel and later returns to the workspace, **Then**
   the panel is still collapsed.

---

### User Story 4 - Long agent lists and narrow screens (Priority: P4)

An operator with dozens of agents types part of a name into the rail's search field and
the list narrows to matches. On a narrow window the rail and the panel step out of the
way so the conversation stays readable, and each can be summoned back on demand.

**Why this priority**: Only bites once an installation has many agents or a small window;
the workspace is usable without it.

**Independent Test**: With 20+ agents, type a fragment of one name and confirm the rail
filters to matching entries; then narrow the window below the tablet breakpoint and
confirm the conversation stays usable with the rail and panel collapsed.

**Acceptance Scenarios**:

1. **Given** a rail with many agents, **When** the operator types a fragment of a name,
   **Then** only agents whose name matches remain, and clearing the field restores the
   full list.
2. **Given** a search that matches nothing, **Then** the rail says so rather than
   rendering an empty column.
3. **Given** a narrow viewport, **When** the workspace opens, **Then** the conversation
   occupies the screen, and the rail and the settings panel each open as a full-screen
   overlay when summoned.

---

### Edge Cases

- **No agents at all**: the workspace shows an empty state in place of the conversation,
  with the create action for roles that have it and an explanatory line for roles that
  do not — mirroring today's empty states on both consoles.
- **No admin ("rancher") agent in admin**: landing falls back to the most recently
  updated agent; if there are none, the empty state above.
- **The selected agent is deleted** (by this operator or another): the workspace moves to
  the next entry in the rail and reports what happened; if the rail is now empty it shows
  the empty state.
- **A direct link to an agent that is not in the rail** (stopped, no longer visible to
  the user, or plainly nonexistent): the "agent not found / unavailable" state that both
  consoles already render, with the rail still usable to move elsewhere.
- **Agent is stopped, failed or restarting**: the existing overlay covers the conversation
  area only — the rail, the header, the usage strip and the settings panel stay usable.
- **The "settings changed — restart the agent" banner**: still appears above the
  conversation and is not hidden by the panel.
- **The usage strip's "Details" action** currently jumps to the Overview tab; it must open
  the Overview section in the middle column instead.
- **Switching agents while a section is open**: the same section opens for the newly
  selected agent rather than dropping back to its conversation — an operator comparing
  Environment across two agents should not have to re-navigate on every switch.
- **The agent goes down while a section is open**: the section keeps working (it reads
  stored configuration, not the pod), and the conversation shows its stopped/failed
  overlay when the operator returns to it.
- **Very long agent names** truncate in the rail with the full name available on hover.
- **Rapid switching between agents** must not leave one agent's conversation, logs, file
  tree or settings visible under another agent's name.
- **A user whose visible agent list contains exactly one agent** still gets a coherent
  screen (see FR-006).

## Requirements *(mandatory)*

### Functional Requirements

**Agent rail (both consoles)**

- **FR-001**: Both consoles MUST present the agents a user can see as a vertical list in
  a left rail that stays visible while a conversation is open.
- **FR-002**: Each rail entry MUST identify its agent and carry light status information
  only: a visual identifier (initials/avatar), the agent's name, its runtime status, a
  timestamp (creation date in admin, last activity in app), and the admin marker where
  the agent is a Ranch admin agent. Entries MUST NOT carry per-agent action controls.
- **FR-003**: The rail MUST mark exactly one entry as the one currently open, and
  selecting another entry MUST switch the entire workspace — conversation, header,
  status, usage strip and (in admin) settings panel — to that agent.
- **FR-004**: Selecting an agent MUST update the address so the workspace is linkable and
  the browser's back and forward controls move between previously opened agents.
- **FR-005**: Agent runtime status shown in the rail MUST track the live status the
  console already receives, without a manual refresh.
- **FR-006**: The rail MUST be rendered whenever the workspace is open, including when the
  user can see exactly one agent — the layout does not change shape as agents come and go,
  and the rail keeps hosting the search field. (Creating an agent and cluster capacity live
  in the top action row, not in the rail — see FR-009.)

**Admin workspace**

- **FR-007**: The admin agents area MUST open directly on an agent conversation. The
  agent chosen on landing MUST be the Ranch admin ("rancher") agent when one exists, and
  the most recently updated agent otherwise.
- **FR-008**: The admin agents table MUST be removed entirely — not relocated to a
  secondary route and not reachable from anywhere in the console. The workspace is the
  only agents screen.
- **FR-009**: Every capability the table provided MUST survive the change, in one of two
  homes. **Workspace-level** actions — creating an agent, and free cluster capacity with
  its "cluster full" warning — MUST sit in the top action row of the page, at the level
  where the "Back to agents" link sits today. **Per-agent** actions — edit, start/stop,
  restart, delete — MUST live in the settings panel alongside the agent's identity, as the
  visual reference shows.
- **FR-010**: The nine-item vertical settings column on the agent page MUST be removed.
  The conversation MUST NOT be stretched to fill the freed space: the chat widget keeps its
  maximum width and its even split with the pod logs panel beside it, so at the widths this
  screen is designed for the middle of the workspace reads exactly as it does today.
  Where the viewport cannot hold that ideal, the pair MUST shrink together rather than
  overflow — nothing may be clipped or hidden — and the logs' existing collapse control MUST
  remain the way to give the conversation the whole column back.</br>
  *(Amended during implementation: the chat's 400px minimum is applied from 1400px upward.
  Held unconditionally, it overflowed the row on narrower screens and the layout's
  `overflow-x-clip` cut the chat card's right border off — a worse outcome than a narrower
  chat. See [research.md](./research.md) R1.)*
- **FR-011**: The admin console's primary navigation MUST be unchanged: no entry removed,
  renamed or relocated, and the Agents entry MUST lead to this workspace.

**Admin settings panel**

- **FR-012**: All eight existing settings sections — Overview, Knowledge, Files, Secrets,
  Environment, Channels, Chats, Paddock — MUST be reachable from a panel on the right of
  the workspace, and each MUST behave exactly as it does today. Their content MUST render
  in the middle column, in place of the conversation, at the width that column already
  provides — no section component is redesigned to fit a narrower container.
- **FR-013**: The panel MUST be **open by default** — the agent's controls (edit,
  start/stop, restart, delete) live inside it, so a collapsed-by-default panel would hide
  them behind a click. It MUST be collapsible and re-openable from the workspace header,
  and once the operator collapses or reopens it, that choice MUST persist across
  navigation and reloads until they change it again.
- **FR-014**: The panel MUST act as a navigator, not a container: every section MUST stay
  listed and one click away while another section is open, and the panel MUST mark which
  section the middle column is currently showing. Returning to the conversation MUST take
  one action, and the conversation MUST come back with its transcript and its live
  connection intact — opening a section MUST NOT tear the chat down.
- **FR-015**: The panel MUST show, next to each section that has a countable amount, how
  many items it holds — knowledge bases, files, secrets, channels — and MUST render the
  section normally when a count is unavailable.
- **FR-016**: Existing deep links of the form `?tab=<section>` MUST open the workspace
  with that section showing in the middle column and the panel marking it as current;
  returning to the conversation MUST remove the parameter.
- **FR-017**: The panel MUST expose the agent's lifecycle actions (stop/start, restart,
  edit) and its identity (name, id, status), so the operator never needs the retired
  table to act on an agent.
- **FR-018**: The panel MUST stay narrow — it holds a list of section names with counts, an
  identity block and a row of controls, and nothing else. It MUST NOT overlap or hide the
  top action row, and while a section is open in the middle column the panel MUST remain
  visible so the operator can move to another section or back to the conversation.

**App workspace**

- **FR-019**: The app agents area MUST replace the card grid with the same rail plus
  conversation layout and MUST NOT expose any settings panel or settings sections. As in
  admin, the conversation MUST keep its current readable width rather than stretching to
  fill whatever the rail leaves over.
- **FR-020**: On landing, the app workspace MUST open the conversation with the agent the
  user opened last. The remembered choice MUST survive a reload and MUST be discarded when
  that agent is no longer visible to the user. On a first visit — or after the remembered
  agent disappears — the workspace MUST fall back to the first running agent, and to the
  first agent in the list when none is running.
- **FR-021**: The app workspace MUST preserve the role-dependent behaviour of the current
  cards screen: create is offered only to Owner/Admin, cluster capacity is shown only to
  those roles, and the restart control keeps its current permission rule.
- **FR-022**: Every user-visible string the app workspace introduces MUST be defined as an
  English key in the owning slice and MUST have a generated Russian translation; strings
  computed in script MUST travel as keys. The admin console stays English-only.

**Behaviour shared by both**

- **FR-023**: The rail MUST offer a name search that filters the list, with a distinct
  "nothing matches" state.
- **FR-024**: Below the tablet breakpoint the rail and (in admin) the settings panel MUST
  each collapse to an on-demand full-screen overlay, leaving the conversation readable.
  The logs panel keeps whatever responsive behaviour it has today — this feature adds the
  two new columns' behaviour, it does not redesign the existing pair.
- **FR-025**: Existing conversation behaviour MUST be preserved: the restart banner, the
  stopped/failed/restarting overlay over the message area, the usage strip and its
  Details action, and the admin log side-stack — including its collapse-to-a-button
  behaviour and the space it hands back to the chat when collapsed.
- **FR-026**: Switching agents MUST fully reset per-agent state (messages, logs, file
  tree, section content) so no data from the previously open agent survives the switch.
- **FR-027**: While the agent list is loading, the rail MUST show placeholder entries
  rather than an empty column, matching the loading treatment already used on both
  consoles.

### Key Entities

- **Agent**: the unit the rail lists and the workspace opens. Attributes that matter here:
  name, runtime status, creation and last-update timestamps, whether it is the Ranch admin
  agent, the template it runs, and the knowledge bases attached to it.
- **Rail entry**: one agent's row in the vertical list — identifier, name, status, a
  timestamp, admin marker, and whether it is the currently open agent.
- **Settings section** (admin only): one of the eight areas of agent configuration —
  a name, a one-line description, an optional count of what it holds, and its own content.
- **Workspace selection**: which agent is currently open and, in admin, which settings
  section (if any) is expanded — both reflected in the address so the screen is linkable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening the agents area and being in a conversation with an agent takes
  **zero** intermediate clicks, down from one (table row / card) today, on both consoles.
- **SC-002**: Switching from one agent's conversation to another's takes **one** click
  from anywhere in the workspace.
- **SC-003**: At a 1440px viewport with the rail and the settings panel both open, the
  conversation and the pod logs are both **fully visible** side by side — every border drawn,
  nothing clipped, no horizontal scrolling of the page. At 1400px and above with the panel
  collapsed, each is at least as wide as it is today.
- **SC-004**: All **8** settings sections remain reachable and functionally unchanged; a
  walkthrough of each section performs the same operations it performed before the change,
  and **zero** of the eight section components need layout changes to fit their new home.
- **SC-004a**: Returning from any open section to the conversation takes **one** action and
  the transcript is unchanged — no reconnect, no re-fetch, no scroll position lost.
- **SC-005**: **100%** of previously working `?tab=<section>` links still land on the
  intended section.
- **SC-006**: **Every** admin primary navigation entry present before the change is
  present after it.
- **SC-007**: An operator can tell an agent's status and age from the rail alone, without
  opening it — verified for all five runtime statuses.
- **SC-008**: With 50 agents in the rail, finding a specific agent by name takes under
  **5 seconds** and the list stays responsive while scrolling and filtering.
- **SC-009**: Every string introduced in the app console renders translated in Russian —
  zero untranslated or raw-key strings in the workspace, verified by the existing
  undefined-key check.
- **SC-010**: At a 390px-wide viewport the conversation remains fully usable — no
  horizontal scrolling of the page and the message input reachable without dismissing an
  overlay.
- **SC-011**: A returning app user lands back on the agent they last talked to in **100%**
  of visits where that agent is still visible to them, and never lands on a "which agent?"
  screen.

## Assumptions

- **The visual reference is a direction, not a pixel contract.** `export-1a` shows a
  three-column arrangement (rail, conversation, settings) and the kind of information each
  column carries; the actual implementation reuses each console's existing design system
  rather than reproducing the mockup's colours and shapes.
- **The reference's missing admin sidebar is an artefact of the mockup.** The admin
  primary navigation is out of scope and stays untouched — stated explicitly by the
  requester.
- **"Rancher" here means the Ranch admin agent** (the agent flagged as admin), not the
  existing `/rancher` setup-status page, which is a separate screen and stays as it is.
- **`/agents/:id` remains the canonical address of an open agent**, so landing on the
  agents area resolves to a specific agent's address rather than keeping a bare `/agents`
  URL — this is what keeps deep links, sharing and browser history working.
- **Creating an agent** and **cluster capacity** ("N slots free" and the cluster-full
  warning) both live in the top action row of the workspace — the level currently occupied
  by the "Back to agents" link, which has nothing left to link back to once the table is
  gone. They belong together: the capacity number is what qualifies the create action.
- **Per-agent lifecycle actions** (edit, start/stop, restart) and **delete** live in the
  settings panel, next to the agent's identity — the arrangement the visual reference
  shows. They leave the page header, which means reaching them requires opening the panel.
- **The chat and logs pair is untouched.** The chat widget's minimum and maximum widths
  and the logs panel beside it stay as they are; the freed column simply lets the rail and
  the settings panel exist without squeezing them.
- **The middle column is a canvas with two modes** — conversation (default) or one open
  section. This is what lets the eight section components keep their current width and
  therefore their current markup. The visual reference supports it: its panel rows carry
  chevrons and counts, which is the vocabulary of navigation, not of an accordion.
- **The conversation stays mounted behind an open section** rather than being destroyed
  and rebuilt, so returning to it costs nothing and the websocket is not churned. The cost
  is that chat and settings cannot be read side by side; that trade was made deliberately,
  because cramping Files and Paddock into a narrow panel would hurt every session while
  the side-by-side case is rare.
- **Counts in the settings panel** are gathered per section as the panel opens rather than
  from a single new aggregate endpoint; knowledge count is already available on the agent
  record, the rest come from the sources each section already reads. A count that has not
  arrived yet simply does not render.
- **App users see whichever agents the API already exposes to them**; this feature changes
  presentation only and introduces no new visibility rule.
- **The "last opened agent" the app workspace restores is remembered per browser**, not
  stored server-side — a convenience, not a synced preference, so a different device
  simply falls back to the first running agent.
- **No API or data-model change is expected.** If a count turns out to be unavailable
  without a new endpoint, that section ships without its count rather than blocking.
- **The admin console remains English-only**; only the app console's strings go through
  the `en.json` → sync → `ru.json` workflow.
