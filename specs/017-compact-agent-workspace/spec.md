# Feature Specification: Compact agent workspace — Chat / Settings, one-line usage, logs bar

**Feature Branch**: `feat/CLEAN-123-compact-agent-workspace`

**Created**: 2026-09-25

**Status**: Draft

**Tracker**: [CLEAN-123](https://dreamvention.atlassian.net/browse/CLEAN-123)

**Visual reference**: two screenshots pasted into the request — (1) the agent workspace
with a `Chat · Overview · Files` header, `$14.48 · 30d`, a `Stop` button and a `…` menu,
a borderless conversation, and a collapsed `▸ Logs` bar under the composer; (2) a grid of
agent cards (initials, name, created date, one-line description, resource chips, a status
footer) used as the look for the Settings hub. They are not tracked; this document is the
durable record of them.

**Input**: User description: "Идея в доработке интерфейса агента, чтобы максимально сжать все лишнее. Вот референс. По тезисам: табы оставить chat / settings — а там уже все остальные табы; в usage блоке оставить только «$15.31/30d · claude-haiku-4-5» — остальное по клику на текст; логи слева убрать вниз и снести границы у чата, дав ему максимально пространства; и при переходе в settings там будут карточки (примерный дизайн) и при клике мы попадаем в нужную табу. Но основное все вынесено. Только проработай кнопку share, так как она переносится под «...» кнопку, выпадашку, а при клике на нее открывается еще один оверлей выпадашка, могут быть колизии кликов, проверь как лучше будет, может эту кнопку тогда аккордеоном сделать, или не стоит если проблем не возникнет."

## Overview

The admin agent workspace (specs/006) put everything an operator might need on screen at
once: an identity row with five lifecycle and management buttons, a full-width usage strip
with six figures, a bar of seven tabs plus a **More** menu, and a conversation that shares
its column fifty-fifty with the pod logs. It is complete, and it is crowded. The thing the
operator came for — the conversation — gets less than half the width and starts three rows
down.

This feature keeps every capability and hides most of the chrome:

- **Two tabs, not eleven.** The header offers **Chat** and **Settings**. Settings is a hub
  of cards, one per section the old tab bar used to show; a card opens that section. Every
  old `?tab=` deep link still lands on its section.
- **One usage line.** The strip becomes a single muted line — cost for 30 days and the top
  model — and clicking it reveals the rest.
- **The chat owns the column.** The side logs go; the conversation loses its card border
  and takes the full width of the middle column. The pod logs become a thin collapsed bar
  under the composer that shows the latest line and opens in place when the operator wants
  the log.
- **One visible action.** Stop/Start stays in the header. Restart, Tools, Edit, Share and
  Delete fold into the `…` menu.

The **Share** action gets its own analysis below, because it is the one item in that menu
with controls of its own, and a panel stacked over a menu is where click and keyboard
collisions live. The requester's call is that it opens beside the Share row, inside the
menu, which the analysis turns into a submenu of rows.

**Scope: admin console only.** The app console's agent page has no section tabs, no usage
strip, no side logs and no `…` menu — it is already the compact shape this feature aims
for. Its Share button stays a standalone button. This is the twin-console check the
project rule asks for; the app needs nothing.

## The Share button under `…` — decision

**Question.** Share currently is its own header button that opens a floating panel with a
link field, Copy, Regenerate and Revoke (the last two with an inline two-step confirm).
Moving it into the `…` menu means the share controls have to open from a menu row. Does
that collide?

**What collides, if done naively.** If the share panel opens as a *second* overlay while
the menu is still open — or is dropped as-is, text field and all, *inside* the menu:

- The menu closes on the first click outside itself. A separate panel is outside the menu,
  so the operator's first click into it closes the menu and drops the panel with it.
- Menus own the keyboard: arrow keys move between rows, typed letters jump to rows, Enter
  and Space activate. A text field inside a menu gets those keystrokes stolen, so the
  operator cannot select the link or move the caret.
- Escape closes the top-most overlay, and with two overlays open which one closes is a
  guess the operator has to make twice.

**Decision (requester's call, 2026-09-25): Share opens beside its own row, inside the
menu, as a submenu — and the menu stays open.** The share controls become *part of the
menu* rather than a second overlay laid over it, so nothing is nested and nothing fights:

- The submenu opens on hover, click or → on the **Share** row, to the right of it (to the
  left when there is no room), and closes when the pointer or focus moves to another row —
  exactly like a nested menu anywhere else.
- Its rows, when the agent is shared: the **link itself** as a read-only row (monospace,
  truncated, with "Shared <date>" beneath), **Copy link** (the row reads "Copied" for a
  moment afterwards), **Open in the app**, **Regenerate**, **Revoke** (destructive). When
  the agent is not shared: a line saying so (or "Link revoked" right after a revoke) and a
  single **Share** row. While the link is loading, or when the read failed: the same
  states the panel shows today, as rows (spinner; "Could not load the share link" +
  **Try again**). When admin cannot build the app URL: the same amber note, as a row,
  with Regenerate and Revoke still offered.
- Choosing Copy link, Share, Regenerate, Revoke or Try again **does not close the menu**.
  Regenerate and Revoke swap the submenu's rows for the question ("Revoke this link?
  Anyone using it will lose access immediately.") with **Revoke link** / **Cancel** rows —
  the same inline two-step the panel has, still inside the menu.
- Because every control is a menu row, the keyboard works the menu's way: ↑ ↓ move
  between rows, Enter activates, ← or Escape closes the submenu and returns focus to the
  Share row, a second Escape closes the menu. Nothing needs typing — the link is copied,
  not edited — so there is no text field for the menu to fight over.
- Clicks inside the submenu are clicks on menu rows, so no outside-click fires. There is
  exactly one menu open at any time; the submenu is part of it.

**What this rules out.** The current floating panel is not reused inside the menu: its
text field is the one control a menu cannot host. The link is shown as a read-only row
instead, and Copy link is how the operator takes it. The app console keeps its floating
panel with the field; the admin panel component is retired, since the header was its only
host. **Tools** and **Delete agent** keep closing the menu before they open their sheet /
dialog, as today.
## User Scenarios & Testing *(mandatory)*

### User Story 1 - The conversation gets the room (Priority: P1)

An operator opens an agent. Under the identity row they see two tabs, **Chat** and
**Settings**, a single muted usage line, a Stop button and a `…` button. The conversation
starts right under that row, without a card border, and runs the full width of the middle
column. Under the composer sits a thin collapsed **Logs** bar showing the newest log line
and how many entries the log holds. Nothing else is on screen.

**Why this priority**: it is the point of the feature — the reason to compress everything
else is to give the chat the space and the first fold.

**Independent Test**: open any running agent; count the rows above the first message
(identity, tab row — two), confirm the chat is borderless and full width, confirm the logs
bar is collapsed by default and shows a live line.

**Acceptance Scenarios**:

1. **Given** an agent workspace, **When** it opens, **Then** the header shows exactly the
   Chat and Settings tabs, the one-line usage, Stop/Start and `…`, and the chat begins
   directly beneath with no card border and no side column.
2. **Given** the chat is open, **When** the operator reads the bottom of the column,
   **Then** the composer sits above a collapsed Logs bar that shows the most recent log
   line with its time and an entry count.
3. **Given** the collapsed Logs bar, **When** the operator clicks it, **Then** the log
   panel opens in place below the composer (taking a share of the column's height, the chat
   shrinking to make room), with the refresh, auto-refresh and close controls it has
   today; clicking the bar again or its close control collapses it.
4. **Given** the log is expanded and the agent is restarting, **When** log reads return
   transient errors, **Then** the panel shows the same "restarting / setting up" overlay it
   shows today, and the collapsed bar says the agent is restarting instead of showing a
   stale line.
5. **Given** an agent with no pod (stopped), **When** the workspace opens, **Then** the
   Logs bar states there is no running pod and stays collapsible.
6. **Given** the Settings tab is open, **When** time passes, **Then** the Logs bar is not
   polling behind Settings (the conversation stays alive, its log polling does not).

---

### User Story 2 - Settings is a hub of cards (Priority: P2)

The operator clicks **Settings**. Instead of a bar of tabs they see a grid of cards, one
per section: Overview, Knowledge, A2A, Files, Channels, Logs, Secrets, Environment, Chats,
Paddock. Each card shows the section name, its one-line description and, where the
section has a count today (knowledge bases, peers, files, secrets, channels), that count.
Clicking a card opens that section at full width; a way back to the hub is visible from
inside any section. Old deep links (`?tab=knowledge`, `?tab=peers`, …) still land on their
section.

**Why this priority**: it is what makes hiding nine tabs acceptable — every section stays
two clicks from the chat and its counts stay visible before opening.

**Independent Test**: open Settings, count ten cards with their descriptions and counts;
click Files, land on the Files section; use the back affordance and land on the hub; open
`?tab=knowledge` directly and land on Knowledge.

**Acceptance Scenarios**:

1. **Given** the Chat tab is active, **When** the operator clicks Settings, **Then** a hub
   with exactly ten cards appears, each with name and description, and the five countable
   ones show their counts (a count that is not known yet shows a placeholder, not `0`).
2. **Given** the hub, **When** the operator clicks a card, **Then** that section renders at
   full width where the hub was, the Settings tab stays highlighted, and the address bar
   reflects the section so the link can be shared.
3. **Given** a section is open, **When** the operator uses the back affordance, **Then**
   the hub returns without leaving the workspace.
4. **Given** a link with any of the eleven pre-existing `?tab=` values (including the
   legacy `peers`), **When** it is opened, **Then** the workspace lands on that section
   inside Settings; `chat`, an unknown value, or no value lands on Chat.
5. **Given** a section is open, **When** the operator clicks Chat, **Then** the
   conversation returns with its transcript, scroll position and connection intact.
6. **Given** the Settings hub is open, **When** the operator switches to another agent in
   the rail, **Then** the new agent opens on Chat.

---

### User Story 3 - One usage line that opens on demand (Priority: P2)

The header shows `$15.31 / 30d · claude-haiku-4-5` in muted text. Clicking the line
reveals the rest of what the strip used to show — calls, input and output tokens, today's
calls and model — plus the link to the full usage card in Overview.

**Why this priority**: it removes a whole row while keeping every figure one click away.

**Independent Test**: read the line on a running agent; click it; see the six figures and
the Details link; follow Details and land on Overview.

**Acceptance Scenarios**:

1. **Given** an agent with usage, **When** the header renders, **Then** the usage reads as
   one line: 30-day cost, the `/ 30d` qualifier, and the top model, and nothing else.
2. **Given** the line, **When** the operator clicks it, **Then** a small panel opens under
   it with cost, calls, input, output, today's calls (with today's model on hover) and a
   **Details** action; Details opens the Overview section.
3. **Given** the usage is still loading, has failed, or is empty, **When** the header
   renders, **Then** the line says so in the same muted style ("loading", "unavailable",
   "no usage yet") and is not clickable until there is something to show.
4. **Given** an agent with cost but no reported model, **When** the line renders,
   **Then** it shows the cost alone without a dangling separator.
5. **Given** a narrow window, **When** the line does not fit, **Then** the model name
   truncates first; the cost never does.

---

### User Story 4 - Actions fold into `…` and Share still works from there (Priority: P3)

The header shows only Stop (or Start) as a visible action. The `…` menu holds Restart,
Tools, Edit, Share and Delete agent. Hovering or choosing Share opens a submenu beside
that row — link, Copy link, Open in the app, Regenerate, Revoke — and the menu stays open
while the operator copies, regenerates or revokes the link.

**Why this priority**: it is the last row of chrome to compress, and the one piece the
request asked to think through.

**Independent Test**: open `…`, hover Share, confirm the submenu opens beside the row with
the menu still open; choose Copy link (row reads "Copied", menu stays); choose Revoke,
then Cancel (rows restore, menu stays); press ← (submenu closes, focus on Share), Escape
(menu closes).

**Acceptance Scenarios**:

1. **Given** a running agent, **When** the header renders, **Then** the only visible action
   buttons are Stop and `…`; a stopped agent shows Start and `…`.
2. **Given** the `…` menu, **When** it opens, **Then** it lists Restart, Tools, Edit,
   Share ▸ and Delete agent in that order, Delete visually separated and destructive.
3. **Given** the menu, **When** the operator hovers or clicks Share or presses →, **Then**
   a submenu opens beside the Share row and the menu stays open; on a shared agent it
   shows the link row, Copy link, Open in the app, Regenerate and Revoke.
4. **Given** the submenu, **When** the operator chooses Copy link, **Then** the link is on
   the clipboard, the row reads "Copied" for a moment, and the menu stays open.
5. **Given** the submenu, **When** the operator chooses Revoke, **Then** its rows are
   replaced by the question with Revoke link / Cancel; Cancel restores the rows; Revoke
   link revokes and the submenu then reads "Link revoked" with a Share row — the menu
   stays open throughout. Regenerate behaves the same with its own wording.
6. **Given** the submenu, **When** the operator presses ← or Escape, **Then** only the
   submenu closes and focus is on the Share row; a second Escape closes the menu; a click
   outside the menu closes everything at once. **Given** an agent that is not shared,
   **When** the submenu opens, **Then** it says so and offers one Share row; choosing it
   creates the link and the submenu shows the link rows without closing.
7. **Given** the menu, **When** the operator chooses Tools, **Then** the menu closes and the
   Tools sheet opens; choosing Delete agent closes the menu and opens the confirmation
   dialog, as today.
8. **Given** an agent that is restarting or toggling, **When** the menu opens, **Then**
   Restart is disabled the way the old button was, and Stop/Start is disabled in the
   header.

---

### Edge Cases

- **Pending-restart banner**: the amber "settings were updated, restart to apply" banner
  keeps its place above the header; the Restart it offers is unaffected by Restart moving
  into `…`.
- **Runtime offline**: the "runtime offline" warning stays visible text in the identity
  row; it is a warning, not chrome.
- **Status and deploy age**: the status word, its reason and "restarted 2m ago" are folded
  into a status dot on the avatar with the detail on hover (see Assumptions). A `failed`
  or `unreachable` status still reads at a glance through the dot's colour.
- **Logs bar while the log is empty**: the bar shows "no entries yet" with a count of 0.
- **Logs expanded then agent switched**: the new agent opens with the bar collapsed.
- **Deep link to `?tab=settings`**: opens the hub itself.
- **Narrow window**: the tabs, usage line, Stop and `…` stay on one row; the usage line
  truncates its model name; below the width where they cannot share a row, the usage line
  wraps under the tabs rather than pushing `…` off screen.
- **Keyboard-only operator**: Tab reaches Chat, Settings, the usage line, Stop and `…` in
  that order; the hub cards are focusable and open on Enter; the Share submenu is walked
  with ↑ ↓, opened with → and closed with ← or Escape, like any nested menu.
- **Chat overlays** (starting / stopped / failed) that blur the message area today keep
  doing so over the borderless chat; the composer and the Logs bar stay usable.

## Requirements *(mandatory)*

### Functional Requirements

**Header and tabs**

- **FR-001**: The workspace header MUST show exactly two section tabs, **Chat** and
  **Settings**, with Chat as the default.
- **FR-002**: The header MUST place, on the same row as the tabs, the one-line usage, the
  Stop/Start action and the `…` menu, and nothing else beyond the identity block.
- **FR-003**: The identity block MUST keep the agent initials, name and admin marker, and
  MUST show the runtime status as a coloured dot on the avatar with the status word, its
  reason and the last-deploy age available on hover.
- **FR-004**: The pending-restart banner and the "runtime offline" warning MUST remain
  visible text where they are today.

**Settings hub**

- **FR-005**: The Settings tab MUST open a hub of cards, one per existing section
  (Overview, Knowledge, A2A, Files, Channels, Logs, Secrets, Environment, Chats, Paddock),
  each showing the section's name and one-line description.
- **FR-006**: Cards for sections that expose a count today (Knowledge, A2A, Files,
  Secrets, Channels) MUST show that count, with a distinct placeholder while the count is
  unknown; an unknown count MUST NOT render as `0`.
- **FR-007**: Clicking a card MUST open that section at full width under the header, keep
  the Settings tab highlighted, and MUST offer a visible way back to the hub.
- **FR-008**: The address MUST reflect the open section so it can be shared, and every
  pre-existing `?tab=` value (the nine original tabs, `logs`, and the legacy `peers`) MUST
  land on its section inside Settings; `chat`, no value, or an unknown value MUST land on
  Chat; a value for the hub itself MUST open the hub.
- **FR-009**: Switching between Chat and any Settings view MUST NOT tear down the
  conversation: transcript, scroll position and connection survive the round trip.

**Usage**

- **FR-010**: The usage MUST render as one line containing only the 30-day cost, a `/ 30d`
  qualifier and the top model; when the model is unknown the line MUST show the cost alone.
- **FR-011**: Clicking the line MUST open a small panel with cost, calls, input tokens,
  output tokens, today's calls (today's model on hover) and a **Details** action that opens
  the Overview section.
- **FR-012**: While usage is loading, failed or empty the line MUST say so in the same
  muted style and MUST NOT open the panel.

**Conversation and logs**

- **FR-013**: The conversation MUST render without a card border and MUST take the full
  width of the middle column; the side log column is removed.
- **FR-014**: A collapsed Logs bar MUST sit directly under the composer showing the newest
  log line (time and text) and the total entry count, highlighting the count of warnings
  and errors when it is not zero.
- **FR-015**: Clicking the bar MUST expand the log panel in place below the composer, with
  its existing refresh, auto-refresh and close controls; the chat area MUST shrink to make
  room, and clicking the bar or its close control MUST collapse it again.
- **FR-016**: The bar and the expanded panel MUST honour the existing restart / first-start
  overlay states and MUST state "no running pod" when the agent is stopped.
- **FR-017**: Log polling for the bar MUST stop while a Settings view is open and while the
  full-width Logs section is open, so the log is never fetched twice at once.

**Actions menu and Share**

- **FR-018**: The `…` menu MUST contain, in order, Restart, Tools, Edit, Share ▸ and Delete
  agent, with Delete separated and styled destructive; disabled states MUST follow the
  same conditions the standalone buttons use today.
- **FR-019**: Share MUST be a submenu of the `…` menu that opens beside the Share row on
  hover, click or →, and opening it MUST NOT close the menu. When the agent is shared its
  rows MUST be the read-only link (with the shared-since date), Copy link, Open in the
  app, Regenerate and Revoke; when not shared, a "not shared" (or "Link revoked") line and
  one Share row; while loading or after a failed read, the same states the panel shows
  today, as rows.
- **FR-020**: Choosing Copy link, Share, Regenerate, Revoke, Try again or a confirm row MUST
  keep the menu open; Regenerate and Revoke MUST show their inline two-step question as
  rows inside the submenu; ← or Escape MUST close only the submenu and return focus to the
  Share row; a click outside the menu MUST close the whole menu. The link MUST NOT be
  presented as an editable field inside the menu.
- **FR-021**: Choosing Tools MUST close the menu and open the Tools sheet; choosing Delete
  agent MUST close the menu and open the existing confirmation dialog.

**Twin console**

- **FR-022**: The app console's agent page MUST be left unchanged: it has no section tabs,
  usage strip, side logs or `…` menu, and its Share button stays a standalone button.

### Key Entities

- **Section**: one of the ten agent sections (name, description, optional count, address
  value). The Settings hub is a view over the list of sections; a section view is one
  section opened at full width.
- **Usage summary**: the agent's 30-day totals (cost, calls, input, output), today's calls
  and model, and the top model — shown as one line, expanded on click.
- **Log entry**: a timestamped line with an optional warning/error level; the bar shows the
  newest and counts the rest.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a 1440-px-wide window the conversation occupies at least 90% of the middle
  column's width (today: 50%) and its first message starts within two rows of the top of
  the column (today: four — banner aside).
- **SC-002**: Every one of the ten sections is reachable from Chat in at most two clicks
  (Settings, card), and every one of the eleven pre-existing `?tab=` values plus the hub
  value opens the right view on first load.
- **SC-003**: All six usage figures remain reachable in one click from the header line, and
  the full usage card in two.
- **SC-004**: Across the Share flow (open `…`, open Share, Copy link, Revoke → Cancel, ←,
  Escape) the menu never closes unexpectedly, no click is swallowed, and every row is
  reachable with arrow keys; Tools and Delete close the menu exactly once, before their
  sheet / dialog opens.
- **SC-005**: The log is fetched by at most one poller at a time in any state of the
  workspace (bar collapsed, bar expanded, Settings open, Logs section open).
- **SC-006**: The workspace passes a keyboard-only walk: tabs, usage line, Stop, `…`, every
  menu item, the share panel and its close, and every hub card, with focus visibly landing
  where the walk expects.

## Assumptions

- **Admin only.** The reference screenshots are admin views (Overview/Files tabs, Stop,
  `…`). The app console is the twin and needs nothing; the PR states this.
- **Stop/Start stays visible** because it is the one lifecycle action the reference keeps
  in the header; Restart moves into `…` together with Tools, Edit, Share and Delete.
- **Status becomes a dot on the avatar** (the reference draws a green dot at the avatar's
  corner and nothing else beside the name). The status word, reason and "restarted 2m ago"
  live in that dot's hover detail. The "runtime offline" text and the pending-restart
  banner stay visible because they are warnings, not chrome.
- **Logs keep their full-width section** as a card in Settings in addition to the bar, so
  an operator who wants the whole screen for a log still has it; the bar is for glancing,
  the section is for reading.
- **The Logs bar's counts** are "N entries" plus a highlighted warning/error count when
  there is one. The reference's "14 routine" is read as the ordinary lines; no new log
  classification is introduced.
- **The usage panel opens under the line, not as a page.** The full card stays where it is
  in Overview; the click-through panel is the strip's six figures and the Details link.
- **Hub card counts reuse the counts the old tab bar already showed**; no new sources.
- **Section descriptions on the cards are the one-liners the tab bar already carries.**
- **Deep-link contract is unchanged**: the existing address values are kept byte-for-byte;
  one new value for the hub is added. The default (no value) stays Chat.
- **The conversation is kept alive behind Settings**, as the current workspace rule requires; only its
  log polling pauses.
- **The share link's lifecycle is unchanged** (read on open, never mint; Regenerate and
  Revoke confirm inline); only its presentation changes, from a floating panel with a text
  field to rows in a submenu. Admin's floating panel component is retired because the
  header was its only host; the app console keeps its own panel.
