# Feature Specification: App profile page "Pass"

**Feature Branch**: `feat/CLEAN-217-app-profile` (spec directory `028-app-profile`)

**Ticket**: [CLEAN-217](https://dreamvention.atlassian.net/browse/CLEAN-217) `[APP]`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Возьми реализацию профиля app - C:\Users\maxim\orca\workspaces\ranch\skills-redesign\Claude outputs\profile - тут все исходники и промты"

**Source materials** (reference worktree, read-only): `Claude outputs/profile/IMPLEMENTATION_PROMPT_PROFILE.md` (the brief), `profile-a-propusk.png` (the mock-up, the visual reference), `profile-a-propusk.html` (the same mock-up as static markup, source of exact colours and sizes), `Профиль админа в консоли RANCH.md` (research: what the console knows about a person and why the rest is left out).

## Why

The app console shows who is signed in only as a name and a role badge in the
header. There is no place that answers "which account is this, what is it
allowed to do, and what does the installation I am looking at consist of".
The page answers those three questions with what the console already knows,
and nothing it does not: a profile that invents a join date or a level would
be decoration pretending to be data.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See my account as a pass (Priority: P1)

A signed-in person clicks their name in the header and lands on their
profile: a pass card with their personal sign (initials), name, role, a short
registry number and the account status, and beside it the account details —
name, email, full id with a copy button, role and console version.

**Why this priority**: This is the page. Everything else hangs on it.

**Independent Test**: Sign in, open `/profile`: every value shown matches the
signed-in account; copy the id and paste it elsewhere; open `/profile` signed
out and land on the login page with a return address.

**Acceptance Scenarios**:

1. **Given** a signed-in person on any console page, **When** they click the
   name-and-role pill in the header, **Then** the profile opens and the pill
   is marked as the current page.
2. **Given** the profile is open, **When** they look at the pass, **Then** it
   shows their initials in the personal sign, their name as the page heading,
   their role, a registry number made of the first eight letters and digits of
   their id in two groups of four, and the account status as a coloured dot
   with a word.
3. **Given** the account details card, **When** they press the copy button by
   the id, **Then** the full id is on the clipboard and "Copied" is shown and
   announced for two seconds.
4. **Given** a person who is not signed in, **When** they open `/profile`,
   **Then** they are sent to the login page and returned to the profile after
   signing in.
5. **Given** an account without a name, **When** the profile opens, **Then**
   the email stands wherever the name would, and no empty row is shown.

---

### User Story 2 - See what my role allows (Priority: P1)

The profile lists what the person can do in this console, built from their
role: available items with a check mark, items done elsewhere with an outward
arrow, unavailable items kept visible but muted, with a lock and the role
that would unlock them.

**Why this priority**: It is the one thing the header badge cannot tell, and
the reason a regular user would open the page at all: "why can I not create
an agent".

**Independent Test**: Open the profile as Owner, Admin and User: the list
matches the capability table for each role, and no unavailable item is
hidden.

**Acceptance Scenarios**:

1. **Given** an Owner or Admin, **When** they read the list, **Then** creating
   agents, starting / stopping / restarting them and seeing free cluster slots
   are marked available.
2. **Given** a regular User, **When** they read the list, **Then** those three
   items are shown muted with a lock and "needs the administrator role", and
   sharing an agent by link and starting conversations is marked available.
3. **Given** any role, **When** they read an item, **Then** the roles it is
   available to are named beside it.
4. **Given** the line about assigning roles and deleting users, **When** the
   rule behind it cannot be confirmed against the server, **Then** the line is
   not shown at all.

---

### User Story 3 - See the installation fleet on the pass (Priority: P2)

The stub of the pass shows the installation's fleet: how many agents exist,
how many are running, and for Owner / Admin how many slots are free, with a
scale of used and free slots. The numbers refresh on their own.

**Why this priority**: It makes the page worth returning to, but the page is
complete without it.

**Independent Test**: With a known set of agents, the three counters match;
stop an agent and within the refresh period "running" drops by one; as a
regular User only two counters are shown.

**Acceptance Scenarios**:

1. **Given** an Owner or Admin with cluster capacity available, **When** the
   profile opens, **Then** the stub shows agents, running and free slots, a
   scale with used slots filled and the rest outlined, and "cluster slots: N
   of M in use" beneath it.
2. **Given** a regular User, or capacity that could not be read, **When** the
   profile opens, **Then** the third counter, the scale and its caption are
   absent, not zero.
3. **Given** the profile stays open, **When** the fleet changes, **Then** the
   counters follow within 30 seconds without a reload.
4. **Given** more than 40 slots in total, **When** the scale is drawn,
   **Then** it is one bar filled by share instead of one mark per slot.

---

### User Story 4 - Leave from the profile (Priority: P3)

A session row says this browser is signed in and offers two ways on: to the
agents, and out.

**Why this priority**: Convenience; both actions already exist in the header.

**Independent Test**: "Go to agents" opens the agents page; "Log out" behaves
exactly like the header's.

**Acceptance Scenarios**:

1. **Given** the session row, **When** the person presses "Go to agents",
   **Then** the agents page opens.
2. **Given** the session row, **When** they press "Log out", **Then** the
   session ends the same way it does from the header.

---

### Edge Cases

- A name long enough to wrap to two lines: the pass grows, nothing overlaps.
- A role or account status the console has no wording for: shown as received,
  the status in a neutral colour.
- An id with fewer than eight letters and digits: the registry number shows
  what there is.
- No agents at all: the counters read zero agents and zero running because
  that is the truth; the slots block follows its own rule.
- The console version is unknown: its row is absent.
- A touch device or a coarse pointer: the pass does not tilt.
- Reduced motion is requested: the pass is flat and the foil highlight still.
- The session ends while the profile is open: the existing "Session ended"
  dialog appears as on any other page.
- Narrow screens: the two columns stack, pass first; nothing scrolls sideways.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The console MUST offer a profile page for the signed-in person
  at `/profile`, reachable only when signed in; a signed-out visit goes to the
  login page with a return address.
- **FR-002**: The header's name and role badge MUST become one link to the
  profile, visibly marked and announced as the current page while there; the
  email stands in when there is no name. The language switch and "Log out"
  stay where they are and behave as before.
- **FR-003**: The page MUST show only values the console already holds for
  the signed-in person and the installation. A missing value removes its row
  or block; zeros, dashes and placeholders standing in for missing data are
  not allowed.
- **FR-004**: The page MUST NOT show an avatar image, sign-up date, last
  login, devices or sessions list, two-factor settings, tokens, "my agents",
  a conversation count, levels, experience, streaks or a "profile completed"
  percentage. Agents are called the installation's agents, never the
  person's.
- **FR-005**: The pass MUST show: the product logo and the word "Pass"; a
  personal sign with the person's initials; the name as the page heading; the
  role; a registry number (first eight letters and digits of the id, upper
  case, two groups of four); the account status as a coloured dot always
  accompanied by a word.
- **FR-006**: The personal sign MUST be reusable on its own at any size, given
  initials, so it can later stand in the header and in lists.
- **FR-007**: The pass stub MUST show the installation fleet: the number of
  agents, the number running, and, only for Owner / Admin and only when
  capacity is known, free slots with a scale of used versus total and a
  caption "cluster slots: N of M in use". The scale MUST carry a text
  alternative naming the three numbers. The words "limit" and "plan" are not
  used for slots.
- **FR-008**: The fleet numbers MUST refresh every 30 seconds while the page
  is open, from the same agent records the rest of the console uses, without
  a second copy of them.
- **FR-009**: The account card MUST list name, email, id with a copy control,
  role and console version, each only when present; copying confirms with
  "Copied" for two seconds in a way assistive technology announces.
- **FR-010**: The capability list MUST be derived from the role by one rule
  that can be tested on its own, and MUST match this table:

  | Capability | Owner | Admin | User |
  |---|---|---|---|
  | Create agents | yes | yes | no |
  | Start, stop and restart agents | yes | yes | no |
  | See free cluster slots | yes | yes | no |
  | Share an agent by link and start conversations | yes | yes | yes |
  | Assign roles and delete users | yes, in the admin console | no | no |

  Unavailable items stay visible, muted, with a lock and the role that would
  unlock them; each item names the roles it is available to.
- **FR-011**: The last row of that table MUST be shown only if the server's
  own rule confirms it is Owner-only; otherwise the row is removed and the
  report says so.
- **FR-012**: A session row MUST state that this browser is signed in and
  offer "Go to agents" and "Log out", the latter identical in effect to the
  header's.
- **FR-013**: The pass MAY tilt up to 6 degrees after a fine pointer on
  devices that hover; nothing on the page animates endlessly; under reduced
  motion the pass is flat and still. There is no card flip.
- **FR-014**: Every interactive element MUST be at least 44 px tall, show a
  visible focus, and text MUST meet a 4.5:1 contrast. Colour never carries a
  state without a word.
- **FR-015**: The layout MUST be two columns from 1024 px (pass 400 px wide,
  details beside it) and one column below, with no sideways scroll down to
  360 px.
- **FR-016**: All copy MUST enter through the English source file with the
  second language kept in step; counters with nouns MUST use proper plural
  forms in both languages.
- **FR-017**: Login, registration, existing routes, chat, the session and the
  "Session ended" dialog MUST keep working and looking as before. No new
  dependency is added.

### Key Entities

- **Signed-in person**: name (optional), email, id, role, account status. All
  already held by the console after sign-in; nothing new is stored.
- **Installation fleet**: the agents of the installation (count, how many
  running) and, for operators, cluster capacity (free, used, total slots).
  Read-only on this page.
- **Capability**: a thing the console lets a role do; a fixed list of five,
  each available, available elsewhere, or locked for a given role.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any console page a signed-in person reaches their profile
  in one click, and every value on it matches their account: 0 invented or
  placeholder values across the Owner, Admin and User states.
- **SC-002**: The capability list is correct for all three roles: 15 of 15
  role/capability cells match the table (or 12 of 12 if the last row is
  removed under FR-011).
- **SC-003**: A change in the fleet is reflected on an open profile within 30
  seconds, with no reload.
- **SC-004**: The page is usable from 360 px to 1920 px with no sideways
  scroll, checked at 1440, 1024, 768 and 390 px, and again under reduced
  motion.
- **SC-005**: Every state from the brief renders without an empty row or a
  broken layout: Owner, Admin, User; capacity unknown; no agents; a two-line
  name; an account without a name.
- **SC-006**: Nothing that worked before breaks: sign-in, registration, the
  agents page and chat pass the same checks they passed before this change.

## Assumptions

- The visual reference is the mock-up as delivered; its numbers, email, id and
  registry number are sample values, and the page takes all of them from the
  live account and fleet.
- The brief was written against the reference worktree; this work lands on a
  branch stacked on the app console redesign (CLEAN-215, PR #176), because the
  header it changes was rewritten there. Paths and helper names in the brief
  are checked against that branch during planning, and where they differ the
  branch wins.
- The brief places the page in the sign-in area of the console's code. If
  reading the fleet from there breaks the project's module boundaries, the
  profile becomes its own module; that is a planning decision and is reported.
- The second language is generated from the English source by the project's
  sync step and then corrected by hand to the wording on the mock-up (the
  brief says "written by hand"; the repository's rule is "generated first,
  never hand-written first", and the repository's rule wins).
- The admin console has no counterpart page and gets none here; the header and
  sign-in code this touches exist in both consoles, so the plan states what
  was checked in the admin console and why it needed nothing.
- There is nothing for the Ranch agent to do here: the page adds no admin
  console capability.
- Fleet data and capacity are read with the same requests, the same refresh
  period and the same role gate the agents workspace already uses.
