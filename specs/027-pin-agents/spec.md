# Feature Specification: Pin agents

**Feature Branch**: `feat/CLEAN-216-pin-agents` (spec directory `027-pin-agents`)

**Ticket**: [CLEAN-216](https://dreamvention.atlassian.net/browse/CLEAN-216) `[ADMIN][APP]`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Следующая фича, позволь закреплять агентов, добавив иконку, это правка для api/app/admin. Pin функция нужна, буквально один флаг"

## Why

An installation grows past a handful of agents and the ones a person reaches
for every day sink into the list behind the ones that happen to be running or
were created last. A pin is the smallest fix: one flag on the agent, shared by
everyone, that keeps it at the top of every list in both consoles and marks it
with an icon so it is recognised at a glance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pin an agent and find it first (Priority: P1)

An Owner or Admin opens an agent in the app console, pins it from the agent
sheet, and from then on that agent sits in the first block of the Orbit, the
Drum, the List and the rail, carrying a pin icon. Unpinning from the same place
returns it to its ordinary place.

**Why this priority**: This is the feature. Without the toggle and the ordering
there is nothing to ship.

**Independent Test**: With three or more agents of mixed status, pin the one
that currently sits last; it moves to the first block in every app view and
shows the pin icon; unpin it and it returns to where it was.

**Acceptance Scenarios**:

1. **Given** an Owner or Admin has an unpinned agent open in the app console,
   **When** they press Pin on the agent sheet, **Then** the sheet shows the agent
   as pinned at once, the pin icon appears on that agent's node, drum card and
   rail row, and the agent is ordered in the first block of every app view.
2. **Given** a pinned agent, **When** they press Unpin, **Then** the icon is
   removed everywhere and the agent returns to the ordinary ordering of each
   view.
3. **Given** the pin request fails, **When** the server answers with an error,
   **Then** the sheet reverts to the previous state and shows the failure the
   same way Start / Stop failures are shown.
4. **Given** a regular User (not Owner or Admin), **When** they open a pinned
   agent, **Then** they see the pin icon and the pinned ordering but no control
   to change it.

---

### User Story 2 - The same pin in the admin console (Priority: P1)

The same flag drives the admin console: an operator pins or unpins an agent
from the agent page header, the pin icon shows on the rail row and in the
header, and pinned agents sit ahead of the rest in the rail. A pin set in one console is the
pin the other console shows.

**Why this priority**: Twin consoles (constitution II). A pin that exists in
one console and not the other is half a feature, and the operators who manage
agents live in the admin console.

**Independent Test**: Pin an agent in the admin console, open the app console
as any user: the agent is pinned there too. Unpin it in the app console, reload
the admin console: it is unpinned.

**Acceptance Scenarios**:

1. **Given** an operator has an agent open in the admin console, **When** they
   pin it from the header, **Then** the header and its rail row show the pin
   icon and the row moves ahead of the unpinned agents in the rail, with the
   Ranch admin agent still at the very top where it already sits.
2. **Given** an agent was pinned in the admin console, **When** anyone loads
   the app console, **Then** that agent is pinned there without any further
   action.

---

### User Story 3 - Pin through the Ranch agent (Priority: P2)

A person asks the Ranch admin agent in chat to pin or unpin an agent by name,
and it does so with the same flag the consoles use.

**Why this priority**: Constitution V: a console capability is not finished
until the chat has the same hands. It is small, but it must not be skipped.

**Independent Test**: In the admin chat ask "pin <agent name>"; the agent list
shows the pin within one refresh. Ask to unpin; it is gone.

**Acceptance Scenarios**:

1. **Given** an Owner or Admin chats with the Ranch admin agent, **When** they
   ask to pin an agent that exists, **Then** the agent is pinned and the reply
   names the agent and its new state.
2. **Given** the named agent does not exist or the person's role may not manage
   agents, **When** they ask to pin it, **Then** nothing changes and the reply
   says why.

---

### Edge Cases

- Pinning does not depend on status: a stopped, failed, deploying or pending
  agent can be pinned, and pinning never starts, stops or restarts anything.
- Two people toggle the same agent at the same moment: the last write wins and
  both see the final state on their next refresh; nothing is lost but the
  intermediate click.
- The open agent is unpinned by someone else: the sheet shows the new state on
  the next refresh of that agent; the chat is untouched.
- Search or filter is active in a list: the pinned block comes first among the
  matches, the ordering rule does not switch off while filtering.
- An agent is deleted: its pin goes with it, nothing is left behind.
- Every agent is pinned, or none is: the lists look exactly as they do today,
  only the icons differ.
- A public or shared agent: the flag is part of the agent and rides along
  wherever the agent is read; it grants or removes no access.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every agent MUST carry a single pinned flag, off by default,
  stored with the agent and returned wherever the agent is read. The flag is
  one per agent, shared by everyone in the installation; it is not a per-person
  preference.
- **FR-002**: Owners and Admins MUST be able to set and clear the flag from the
  app console (the agent sheet) and the admin console (the agent page header;
  the admin console has no agents table, its list is the rail). Regular Users
  MUST NOT be offered the control, and the server MUST refuse the change from
  them.
- **FR-003**: Every agent list in both consoles MUST order pinned agents ahead
  of unpinned ones, keeping each list's existing order inside the pinned block
  and inside the unpinned block. Covered lists: app Orbit, Drum and the rail
  (which is also the List view); admin rail. The Ranch admin agent's existing
  place at the top of both rails is unchanged; pinned agents follow it.
- **FR-004**: A pinned agent MUST show a pin icon wherever it is rendered as a
  list entry, a node, a card or an open agent header, in both consoles, with an
  accessible name so the state is announced, not only drawn.
- **FR-005**: The toggle MUST be optimistic in both consoles: the pressed state
  shows at once, the single store record is patched, and on failure the record
  rolls back and the failure is shown where the agent's other action failures
  are shown (constitution IV).
- **FR-006**: The Ranch admin agent MUST have a tool that pins and unpins an
  agent, in the agent slice, with the metadata every tool carries, gated to
  Owner / Admin, no confirmation step (the action is reversible and harmless),
  no secrets in its result (constitution V).
- **FR-007**: Changing the pin MUST NOT change the agent's status, pod, public
  flag, allowed origins or anything else on the agent, and MUST NOT appear in
  the agent's timeline as a deployment event.
- **FR-008**: App console copy for the control, the icon's accessible name and
  the failure message MUST enter through `en.json` with `ru` generated; the
  admin console stays English (constitution VI).
- **FR-009**: Generated SDK types in both consoles MUST be regenerated from the
  API's schema so the flag is typed, never hand-written.

### Key Entities

- **Agent**: the deployable worker the consoles list and open. Gains one
  boolean attribute, *pinned*, default off. No new entity, no relation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open agent, pinning or unpinning takes one click in either
  console and the result is visible in under a second without a page reload.
- **SC-002**: After pinning one agent, it occupies the first position of every
  one of the four covered lists (app Orbit, Drum, rail; admin rail), checked
  in a browser at desktop and phone widths; 4 of 4, not most.
- **SC-003**: A pin made in one console is shown in the other console on its
  next load, by any user, 100% of the time.
- **SC-004**: Pinning changes nothing else: the agent's status, pod and access
  before and after the toggle are identical in the API's own read of the agent.
- **SC-005**: The Ranch admin agent pins and unpins a named agent on request,
  and refuses an unknown name or an unauthorised person with a reason.

## Assumptions

- "Literally one flag" is read as one flag on the agent, shared by the whole
  installation. A per-person pin (each user with their own list) is a different
  feature and is out of scope.
- The right to pin follows the right to manage agents (Owner, Admin), the same
  gate Start / Stop / Restart use. No new role or permission.
- There is no limit on how many agents can be pinned.
- The pin travels inside the agent record the consoles already hold, so no new
  store, feed or fetch is needed; the existing agent store is patched.
- The ordering rule "pinned block first, then the list's own order" applies
  without special treatment of status. A pinned stopped agent sits ahead of a
  running unpinned one; that is the point of the pin.
- The work is stacked on the app console redesign branch (CLEAN-215, PR #176)
  because the app agent components it touches (Orbit, Drum, Rail, Sheet) were
  rewritten there. The PR targets `main` once #176 has merged, or #176's branch
  until then.
- The admin console's agent page header already holds Stop / Start and the
  actions menu; the pin control sits beside them.
