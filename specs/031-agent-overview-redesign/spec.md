# Feature Specification: Agent Overview redesign — compact section list, summary strip, settings edited in place

**Feature Branch**: `feat/CLEAN-228-agent-overview-redesign` (spec directory `031-agent-overview-redesign`)

**Created**: 2026-11-16

**Status**: Draft

**Ticket**: [CLEAN-228](https://dreamvention.atlassian.net/browse/CLEAN-228) `[ADMIN]`

**Input**: User description: "Теперь возьми в имплементацию полный редизайн UI в overview агента - C:\Users\maxim\Downloads\agent-overview-redesign.html Здесь задача поправить левые табы, уменьшив их и все блоки внутри overview агента"

**Reference**: the prototype `agent-overview-redesign.html` ("Ranch Admin: agent Overview, redesign prototype"). It is the visual and structural target. Where it and the shipped product disagree about behaviour, this spec says which one wins.

## Background

The agent page of the admin console has two tabs, Chat and Settings. Settings is a list of sections on the left and the selected section on the right; Overview is the first section and the one people land on.

What is wrong with it today, checked against the console on 2026-11-16:

1. **The section list is heavy.** Each of its eleven entries is a bordered card with a tinted icon tile, a name and a sentence of description. The list is about as tall as the screen and takes attention from the content next to it; the descriptions are read once and then only cost space.
2. **Overview is seven separate cards that overlap.** Usage, Request load, LLM, Knowledge bases, Resource usage, Runtime, and Visibility & embed. Status is in Runtime, the public flag is in Runtime and again in Visibility, resources are in Runtime (configured) and in Resource usage (live), the model is in LLM and in the header. Nothing on the page says in one glance how the agent is doing.
3. **Overview shows, the Edit page changes.** Name, description, model, knowledge and resources are displayed on Overview but edited on a separate page reached by an "edit" link; debug mode, admin tools and deletion live there too. Visibility and limits are the exception — they are edited on Overview since CLEAN-224, with their own Save button inside their card. So there are two places to edit an agent and two kinds of Save.
4. **The prototype was drawn before request limits shipped.** Its "Request limit" block shows one per-minute limit with an "each user" mode, a queue, presets and a platform default. The product shipped something else (CLEAN-224): limits per minute, hour and day, one allowance per agent shared by everyone, a refusal with a wait and never a queue, off by default, required for public agents.

## Scope

**In scope:**

- The section list of the agent's Settings: compact rows, grouped.
- Everything inside Overview: a summary strip and six blocks — Configuration, Request limit, Access, Usage, Advanced, Delete agent.
- Editing the agent's configuration in place on Overview, with one save bar for the whole page.
- Retiring the separate Edit page for an existing agent.

**Out of scope:**

- The other sections' own content (Knowledge, A2A, Channels, Secrets, Environment, Files, Chats, Logs, Events, Paddock). They get the new list beside them and nothing else.
- The Chat tab, the agent rail on the left, the page header's actions (Stop, Pin, the menu).
- The form for creating a new agent.
- The app console. Its agent workspace was redesigned separately (CLEAN-215) and shares no layout with this one.
- Any change to what limits do. This feature rearranges how they are shown and edited; the rules of CLEAN-224 stand.
- New capabilities drawn in the prototype but not in the product: a limit per user, a queue for requests over the limit, a platform-wide default limit.

## Where the prototype and the product disagree

| In the prototype | Decision |
|------------------|----------|
| One limit, per minute | Three limits — per minute, per hour, per day — each optional, as shipped. The per-minute one leads; hour and day sit beside it. |
| "Counted: whole agent / each user" | Not shown. There is one allowance per agent (decided 2026-11-16, CLEAN-224). A line says so: everyone who talks to the agent shares it. |
| "Over the limit: decline, or hold in a queue" | Not shown as a choice. Requests over the limit are declined with a wait. The preview of what the person sees stays, with the real wording. |
| "Use platform default (120)" | Not shown. There is no platform default; the busiest minute, hour and day the agent has seen are shown as the basis for choosing. |
| Preset chips 10 / 30 / 60 / 120 | Kept as shortcuts for the per-minute limit only. They fill the field; they are not a recommendation. |
| An On / Off switch for the limit | Kept. For a public agent it cannot be switched off, and says why. |
| "Sample traffic" in the chart | The agent's real requests per minute for the last hour, live. |
| "Landing page" switch with the limits in another block | Kept as drawn, in Access. Turning it on for an agent with no limit is refused at save, pointing at the Request limit block. |
| The preview sentence "I'm getting more requests than I can take right now…" | The sentence people actually get: "This agent has reached its message limit. Try again in 0:42." |
| A sidebar entry "New" tag on Request limit | Not shown. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An operator finds a section without the list getting in the way (Priority: P1)

The operator opens an agent's Settings. On the left is a narrow list of sections: an icon, a name, and a count where the section holds things. The sections are grouped under three small headings — Configure, Data, Observe — with Overview above them. The whole list fits on the screen without scrolling and leaves the width to the content.

**Why this priority**: The list is on screen for every section, not only Overview. It is the cheapest change and the one people feel on every visit.

**Independent Test**: Open any agent's Settings on a laptop-sized screen and confirm all eleven sections are visible at once with no scrolling in the list, each one line high, and that choosing one shows its content as before.

**Acceptance Scenarios**:

1. **Given** an agent's Settings, **When** the page opens, **Then** the list shows Overview first, then Configure (Knowledge, A2A, Channels, Secrets, Environment), Data (Files, Chats) and Observe (Logs, Events, Paddock).
2. **Given** the list, **Then** each entry is one line with an icon, a name and — for Knowledge, A2A, Channels, Secrets and Files — a count aligned to the right; no entry shows a description.
3. **Given** a section whose count is not known yet or could not be loaded, **Then** no number is shown for it rather than a zero.
4. **Given** the selected section, **Then** it is marked by more than colour alone, and it is the one a screen reader announces as current.
5. **Given** a link to a section that worked before this change, **When** it is opened, **Then** it opens the same section.
6. **Given** the list while a long section is scrolled, **Then** the list stays in view.
7. **Given** a phone-width screen, **Then** the list becomes a single row that scrolls sideways, the group headings are dropped, and the content takes the full width.
8. **Given** the keyboard only, **Then** every entry can be reached and chosen, with a visible focus mark.

---

### User Story 2 - An operator sees how the agent is doing at a glance (Priority: P1)

At the top of Overview is one strip of four figures: whether the agent is running, what it cost in the last 30 days, how loaded its pod is, and how many requests it took in the last minute against its limit. The operator does not have to read four cards to learn that the agent is fine.

**Why this priority**: It is the reason to open Overview at all, and it replaces two cards that are removed.

**Independent Test**: Open Overview for a running agent with traffic and confirm each of the four figures matches what the detailed blocks and the other screens show for the same agent.

**Acceptance Scenarios**:

1. **Given** a running agent, **Then** the strip shows Status with a marker and a word, and beneath it whether the pod is ready and when the agent was last updated.
2. **Given** the agent's usage, **Then** the strip shows the spend for the last 30 days, with the number of calls and input tokens beneath it.
3. **Given** the pod's live figures, **Then** the strip shows CPU and memory as small bars with used against allotted.
4. **Given** an agent with a per-minute limit, **Then** the strip shows requests in the last minute "of N allowed"; **given** no per-minute limit, it says there is no limit per minute.
5. **Given** the last hour's traffic, **Then** beneath the requests figure is the peak per minute this hour, or — if any request was refused this hour — how many were.
6. **Given** a stopped or failed agent, **Then** Status says so in words, the pod load reads as not available rather than as zero, and the other two figures still show.
7. **Given** a figure whose source failed to load, **Then** that cell says it is unavailable and the other three are unaffected.
8. **Given** the page stays open, **Then** status, pod load and requests keep themselves current without a reload.
9. **Given** a phone-width screen, **Then** the strip is two by two.

---

### User Story 3 - An operator changes the agent without leaving Overview (Priority: P1)

The operator renames the agent, picks another model, ticks a knowledge base, raises the memory, sets a limit and makes the agent public — all on Overview. Nothing is saved while they edit. A bar appears at the bottom saying how many things changed; one press saves everything, another discards it.

**Why this priority**: It removes the second place to edit an agent and the second kind of Save. Without it the redesign is a repaint.

**Independent Test**: Change the name, the model and one limit, see the bar count three changes, save once, reload, and confirm all three held.

**Acceptance Scenarios**:

1. **Given** Overview, **Then** Configuration shows Name, Description, Model, Knowledge, Resources and Template as a list of labelled rows, each editable where it stands, except Template, which is shown as fixed after creation with a link to it.
2. **Given** no changes, **Then** there is no save bar.
3. **Given** one field changed, **Then** the field is visibly marked as changed and a bar appears saying "1 unsaved change", with Discard and Save.
4. **Given** several fields changed across different blocks, **Then** the bar counts them all and one Save writes them all.
5. **Given** a change to CPU or memory, **Then** the bar says resources apply on restart and the save button offers to save and restart.
6. **Given** a changed field set back to its saved value by hand, **Then** it stops counting as a change, and the bar leaves when nothing is changed.
7. **Given** Discard, **Then** every field returns to what is saved and the bar leaves.
8. **Given** a save the server refuses, **Then** nothing is half-saved from the operator's point of view: the bar stays, the refused field says why in words, and the other edits are still there to be saved after the fix.
9. **Given** unsaved changes, **When** the operator tries to leave the page, switch section or pick another agent, **Then** they are asked before the changes are lost.
10. **Given** Knowledge, **Then** the operator chooses between the template's knowledge bases and their own selection; the list of bases appears only for their own selection, each with how many sources it holds.
11. **Given** Model, **Then** the current credential's state and fallback model are shown beside the choice, with a way to the place where credentials are managed.
12. **Given** the old address of the Edit page for an existing agent, **When** it is opened, **Then** the operator lands on Overview of the same agent.

---

### User Story 4 - An operator sets the request limit against what the agent really gets (Priority: P2)

The Request limit block has a switch, the three limits, and under them the agent's own last hour: requests per minute as bars with the per-minute limit drawn as a line across them. As the operator types a number the line moves, bars above it turn red, and a sentence says what that limit would have done to the last hour.

**Why this priority**: The limits themselves shipped in CLEAN-224 and work; this makes choosing a number a matter of looking rather than guessing.

**Independent Test**: On an agent with traffic in the last hour, type a per-minute limit below the hour's peak and confirm the over-limit minutes turn red and the sentence states how many minutes and how many requests would have been refused — before saving anything.

**Acceptance Scenarios**:

1. **Given** an agent with limits off, **Then** the switch is off, the limit fields are present but subdued, the chart shows the last hour with no line, and the sentence says there is no limit and what the hour's peak was.
2. **Given** the switch turned on, **Then** the fields become active and nothing is saved until Save.
3. **Given** a per-minute number being typed, **Then** the line moves to it at once, minutes above it are marked, and the sentence says "at N per minute, X of the last 60 minutes would have gone over, with Y requests refused" — or that no request would have been touched.
4. **Given** a limit far above the hour's traffic, **Then** the chart keeps the traffic readable and says the limit is above the scale rather than flattening the bars.
5. **Given** the preset shortcuts, **When** one is pressed, **Then** it fills the per-minute field and counts as a change like typing would.
6. **Given** hour and day limits, **Then** each has its own field with the same rules as before: optional, and a longer window may not allow fewer requests than a shorter one.
7. **Given** each limit field, **Then** the busiest minute, hour and day of the last 30 days is shown beside it.
8. **Given** a public agent, **When** the operator turns the switch off or empties every field, **Then** the save is refused with the reason, in this block.
9. **Given** the block, **Then** it says who is not counted (operators, other agents) and what is not covered (Telegram, the agent's scheduled runs), and shows the sentence a limited person reads.
10. **Given** live usage, **Then** the block shows how much of each set limit is used right now and when a full one has room again, requests in progress, and requests refused in the last hour.
11. **Given** an agent that was public before limits existed, **Then** the block asks for a limit in plain words.

---

### User Story 5 - An operator controls who can reach the agent (Priority: P2)

Access is one block: a switch for the landing page, the allowed origins as removable chips with a field to add one, and the embed code folded away until asked for.

**Why this priority**: The settings exist today; this gives them a clearer form and takes three always-open code samples off the page.

**Independent Test**: Add an origin by typing it and pressing Enter, see it become a chip, remove another, save, and confirm the list on reload; open Embed code and copy a snippet.

**Acceptance Scenarios**:

1. **Given** the landing-page switch, **Then** it says in words what the current state means: private and hidden from the public list, or public and listed.
2. **Given** the origins field, **When** a full origin is typed and Enter or a comma is pressed, **Then** it becomes a chip; a duplicate is not added twice.
3. **Given** something that is not an origin (a path, no scheme), **Then** it is not added and the hint says what an origin looks like.
4. **Given** a chip, **Then** it can be removed with the pointer and with the keyboard, and the removal names the origin for a screen reader.
5. **Given** no origins, **Then** the hint says every origin needs a token; **given** some, that pages on those origins can open the chat without one.
6. **Given** Embed code, **Then** it is closed by default; opened, it offers Floating bubble, Inline and Mint a token, one at a time, each with Copy and one line of explanation.
7. **Given** a public agent, **Then** the snippets omit the token; **given** a private one, they include its placeholder — as today.
8. **Given** a private agent with an active share link and no limits, **Then** the warning from CLEAN-224 is still shown.
9. **Given** the switch turned on for an agent with no limit, **When** saved, **Then** it is refused and the reason points to the Request limit block.

---

### User Story 6 - An operator reads usage, and reaches rare and risky things on purpose (Priority: P3)

Usage is one block: four figures for 30 days and a small chart of the last seven days. Debug mode, admin tools and identifiers are folded under Advanced. Deleting the agent is a separate, visibly dangerous block at the bottom.

**Why this priority**: These are read or used rarely. They complete the page and let the old Edit page go.

**Independent Test**: Confirm the four usage figures match the existing usage panel for the same agent; open Advanced, switch debug mode, save; start deleting the agent and cancel.

**Acceptance Scenarios**:

1. **Given** Usage, **Then** it shows cost, calls, input tokens and output tokens for 30 days, a seven-day chart of input tokens with each day's value, and today so far.
2. **Given** an agent with no usage, **Then** the block says so instead of drawing empty bars.
3. **Given** "All 30 days", **Then** it leads to the full usage view that exists today.
4. **Given** Advanced, **Then** it is closed by default and its header says what is inside.
5. **Given** debug mode in Advanced, **Then** switching it counts as a change and is saved with the bar.
6. **Given** the Ranch admin agent, **Then** Advanced shows that it has admin tools and offers to demote it; for another agent it offers to promote it, as the Edit page does today, with the same warning.
7. **Given** Identifiers, **Then** the agent's id can be selected and copied, with when it was created and last updated.
8. **Given** Delete agent, **Then** the block states what deleting does and that it cannot be undone, and pressing it asks for confirmation with the options the Edit page offers today (download the files first, also wipe stored files).
9. **Given** deletion or promotion, **Then** they act at once after their own confirmation and are not part of the save bar.

---

### Edge Cases

- **The agent changes under the operator.** Its status, load and usage keep updating while they edit; fields they have changed are not overwritten by a refresh.
- **Two operators edit the same agent.** The second save wins field by field, as today. Fields the second operator did not change are not sent, so they do not undo the first operator's.
- **A save that partly cannot apply.** A refusal for the limit or the public flag leaves every edit on screen, marks the field at fault and saves nothing that depends on it.
- **Saving resources.** "Save and restart" restarts the agent after saving; the operator can also save without restarting, and is told the new resources wait for the next restart.
- **Leaving with unsaved changes** through the browser's back button, a link in the rail, a section in the list, or closing the tab: the operator is asked each time.
- **A very long agent name, a long origin, many knowledge bases, many origins.** Nothing overflows its block; long text wraps or is cut with the full value available.
- **No model credential, no knowledge bases in the installation, no usage, no traffic.** Each block has a sentence for it and a way to fix it where there is one.
- **A stopped agent.** Everything is still editable; the summary and the limit block show what they know and say what they cannot.
- **Narrow screens** down to phone width: the page never scrolls sideways; rows stack label above control; the save bar stays reachable above the on-screen keyboard.
- **Reduced motion.** Nothing on the page animates for a reader who asked for less motion.
- **Zoom to 200%.** Everything stays readable and reachable.

## Requirements *(mandatory)*

### Functional Requirements

**Section list**

- **FR-001**: The Settings section list MUST show each section as a single compact line: icon, name, and a right-aligned count where the section has one. Descriptions MUST NOT be shown in the list.
- **FR-002**: The list MUST be grouped: Overview alone, then Configure (Knowledge, A2A, Channels, Secrets, Environment), Data (Files, Chats), Observe (Logs, Events, Paddock), each group under a small heading.
- **FR-003**: All eleven entries and three headings MUST fit without scrolling on a screen 720 px high.
- **FR-004**: The selected section MUST be distinguishable without relying on colour and MUST be exposed as the current one to assistive technology.
- **FR-005**: Every address that opened a section before this change MUST open the same section after it.
- **FR-006**: A count that is unknown or failed to load MUST be shown as absent, not as zero.
- **FR-007**: The list MUST stay visible while the section beside it scrolls, and on a phone-width screen MUST become one horizontally scrollable row without headings.

**Overview structure**

- **FR-008**: Overview MUST consist of, in this order: a summary strip, Configuration, Request limit, Access, Usage, Advanced, Delete agent. The separate Runtime, Resource usage, LLM and Knowledge bases cards MUST no longer appear.
- **FR-009**: Every fact shown on Overview today MUST still be reachable on Overview after the change: status and its reason, workflow, template, resources configured and in use, model, provider, fallback model and credential state, knowledge bases, usage, request load, visibility, origins, embed snippets, created and updated times.

**Summary strip**

- **FR-010**: The strip MUST show four figures: status, spend for 30 days, pod load (CPU and memory, used against allotted), and requests in the last minute against the per-minute limit.
- **FR-011**: Each figure MUST have one line of supporting detail beneath it, as listed in User Story 2.
- **FR-012**: Status, pod load and requests MUST stay current without a reload while the page is visible, and MUST stop updating while it is not.
- **FR-013**: A figure that cannot be known MUST say so in its own cell without affecting the others, and MUST NOT be shown as zero.

**Editing in place**

- **FR-014**: Name, description, model, knowledge selection, CPU and memory MUST be editable on Overview. Template MUST be shown as fixed after creation.
- **FR-015**: No edit on Overview MUST be saved until the operator saves. Edits to configuration, request limits, access and debug mode MUST be saved together by one action.
- **FR-016**: While anything is changed, a bar MUST stay in view stating how many changes are unsaved, with Discard and Save. It MUST be absent when nothing is changed.
- **FR-017**: Each changed field MUST be visibly marked as changed until saved or discarded.
- **FR-018**: When CPU or memory is among the changes, the bar MUST say that resources apply on restart and MUST offer to save and restart.
- **FR-019**: Discard MUST return every field to its saved value.
- **FR-020**: A refused save MUST leave all edits in place, name the field at fault next to that field in words, and keep the bar.
- **FR-021**: A save MUST send only what changed.
- **FR-022**: Leaving Overview with unsaved changes — to another section, another agent, another page, or by closing the tab — MUST ask the operator first.
- **FR-023**: The separate Edit page for an existing agent MUST be retired; its address MUST lead to Overview of the same agent. Creating a new agent is unchanged.

**Request limit**

- **FR-024**: The block MUST offer an on/off switch and three optional limits — per minute, per hour, per day — under the rules of CLEAN-224, unchanged: off by default, at least one required for a public agent, a longer window never lower than a shorter one, whole numbers from 1.
- **FR-025**: The block MUST NOT offer a per-user mode, a queue, or a platform default.
- **FR-026**: The block MUST show the agent's real requests per minute for the last 60 minutes, updating live, with the per-minute limit drawn across it.
- **FR-027**: While the per-minute value is being edited, before any save, the chart MUST mark the minutes that exceed it and a sentence MUST state how many of the last 60 minutes would have gone over and how many requests would have been refused, or that none would.
- **FR-028**: When the limit is above what the chart can show, the chart MUST keep the traffic readable and state that the limit is above the scale.
- **FR-029**: Preset shortcuts for the per-minute limit MUST fill the field and count as an edit.
- **FR-030**: The busiest minute, hour and day of the last 30 days MUST be shown beside the matching field.
- **FR-031**: The block MUST state that everyone who talks to the agent shares the allowance, who is not counted, what is not covered, and MUST show the sentence a limited person reads.
- **FR-032**: The block MUST show current use against each set limit, when a full window has room again, requests in progress, and requests refused in the last hour.
- **FR-033**: A refusal to save limits MUST appear in this block, by the field or switch it concerns.

**Access**

- **FR-034**: Access MUST hold the landing-page switch, the allowed origins and the embed code, and nothing about access MUST be shown elsewhere on Overview.
- **FR-035**: Origins MUST be added one at a time and shown as removable items; anything that is not a scheme and host MUST be refused with a hint; duplicates MUST NOT be added.
- **FR-036**: Embed code MUST be closed by default and, opened, MUST show one of three snippets at a time with Copy.
- **FR-037**: Snippets MUST keep today's content, including the difference between public and private agents.

**Usage, Advanced, Delete**

- **FR-038**: Usage MUST show cost, calls, input and output tokens for 30 days, the last seven days as a chart with values, today so far, and a way to the full usage view.
- **FR-039**: Advanced MUST be closed by default and hold debug mode, admin tools (promote or demote) and identifiers.
- **FR-040**: Delete agent MUST be its own block, state what deletion does, and require the same confirmation and offer the same options as today.
- **FR-041**: Promotion, demotion and deletion MUST act after their own confirmation and MUST NOT wait for the save bar.

**Across the page**

- **FR-042**: The page MUST use the console's existing colours, type and controls. The admin console has one appearance, light; no dark variant is part of this feature.
- **FR-043**: The page MUST work from phone width upward without scrolling sideways; rows MUST stack label above control on narrow screens.
- **FR-044**: Everything MUST be operable by keyboard with a visible focus mark; switches, segmented choices and folded blocks MUST expose their state to assistive technology; no information MUST depend on colour alone.
- **FR-045**: Nothing MUST animate for a reader who asked for reduced motion.
- **FR-046**: Dates, times and numbers MUST go through the console's format module; the admin console stays English.
- **FR-047**: What the Ranch agent can do through its tools MUST be unaffected: this feature adds no capability and removes none.

**How it is proven**

- **FR-048**: The behaviour in User Stories 1 to 5 MUST be covered by automated browser tests that drive the real console against a running platform, kept with this spec.
- **FR-049**: The browser tests for request limits that shipped with CLEAN-224 MUST keep passing, updated only where the page's structure changed.
- **FR-050**: The feature is not done until those tests have been run and passed on the finished build, and the pull request names the command and the result.

### Key Entities

- **Section**: one part of an agent's settings — a name, an icon, a group, and optionally a count. Eleven of them, in a fixed order.
- **Agent configuration**: what an operator can change about an agent on Overview — name, description, model credential, knowledge selection (the template's or its own), CPU and memory, debug mode, landing-page visibility, allowed origins, request limits.
- **Pending changes**: the differences between what is on screen and what is saved, per field, with whether any of them needs a restart. Exists only in the open page.
- **Summary**: four read-only figures drawn from status, usage, pod metrics and request load.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The section list takes at most 200 px of width and at most 480 px of height on a desktop screen, down from a list as tall as the screen; every section is reachable without scrolling the list at 720 px of height.
- **SC-002**: An operator can state whether an agent is running, what it cost this month and whether it is near its limit within 5 seconds of opening Overview, without scrolling.
- **SC-003**: Changing an agent's name, model and limit takes one save and no navigation away from Overview.
- **SC-004**: Overview's content above the fold on a 1440×900 screen includes the summary and the start of Configuration, where today it shows two cards.
- **SC-005**: An operator choosing a per-minute limit can see, before saving, how many of the last 60 minutes it would have affected.
- **SC-006**: No edit is lost silently: in testing, every attempt to leave with unsaved changes is intercepted.
- **SC-007**: Nothing that could be seen or done on Overview and the Edit page before is missing after: a checklist of every fact and action passes.
- **SC-008**: The page has no horizontal scroll at 390, 768, 1024, 1280, 1440 and 1920 px widths.
- **SC-009**: Every browser test for this feature and for request limits passes on the finished build.

## Assumptions

- **The prototype is the target for layout, density and wording; the product is the target for behaviour.** Where the prototype sketches a capability that does not exist, the capability is not built here (see the table of disagreements).
- **"All blocks inside Overview" includes editing.** The prototype's Configuration block says "what used to need the separate Edit page", so the Edit page is folded in and retired rather than kept beside it.
- **One save bar replaces the Save button inside "Visibility & embed"** that CLEAN-224 added. Saving visibility and limits together in one action is kept; it now happens with everything else.
- **The agent rail, the admin sidebar and the page header are drawn in the prototype only for context.** They stay as they are.
- **Group names and order of sections follow the prototype.** The addresses of sections do not change.
- **Preset shortcuts are kept, the platform default is not.** A shortcut is a convenience for typing; a default would be a number chosen for someone else's traffic, which CLEAN-224 decided against.
- **The seven-day chart shows input tokens**, as drawn; the full 30 days remain one click away.
- **Light appearance only**, as the prototype is drawn (confirmed 2026-11-16): the admin console has no theme switch and no dark styles, so none are designed or tested here.
- **Depends on** the routes and stores that already feed Overview and the Edit page (agent, usage, pod metrics, request limits and load, credentials, knowledge bases); no new data is needed from the platform.
- **Twin consoles**: `agent` exists in both consoles, but this layout is the admin console's own. The app console is checked and left alone.
