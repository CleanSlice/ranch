# Feature Specification: Skills library redesign

**Feature Branch**: `feat/CLEAN-205-skills-redesign`

**Ticket**: [CLEAN-205](https://dreamvention.atlassian.net/browse/CLEAN-205) — `[ADMIN]`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Возьми в работу новый дизайн для skills — редизайн страниц Skills и New skill в админке" (full brief in the ticket and the `/speckit-specify` invocation; reference mockup `Skills Redesign.html`, two screens: "Skills — library" and "New skill — editor with live preview"). Where the mockup and the brief disagree, the brief wins.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the library at a glance and find a skill (Priority: P1)

An admin opens Skills and immediately sees how big the library is (count, total size in tokens, what changed this week, what is not shipped anywhere), a size strip with one coloured segment per skill, and a list where every row carries title, slug, a two-line description, group, size, which templates use it, and when it was last edited. They narrow the list by typing a search, by picking a group chip, or by switching the sort to "Recently edited". Picking a row shows that skill's details (path with Copy, size with share of library, files, created, full description, templates, activity, Edit / Delete) in a panel beside the list.

**Why this priority**: This is the page every other story starts from. Today's table shows name, title, a dash for files and a truncated description; it answers none of "how big", "where used", "what changed".

**Independent Test**: Seed a library with skills of several groups and sizes, some attached to templates and some not. Open Skills, check the four summary numbers, hover a strip segment, search for a word that appears only in one description, filter by one group, switch sort, select a row and read its panel. Reload the page with the same URL and land in the same state.

**Acceptance Scenarios**:

1. **Given** a library of N skills, **When** the page loads, **Then** the summary shows N, "≈ <sum of token estimates>", the count edited in the last 7 days with "last <relative time> ago" beneath, and the count not used in any template with those slugs beneath.
2. **Given** the list in custom order, **When** the admin looks at the size strip, **Then** there is one segment per skill in list order, each at least 8px wide and otherwise proportional to its tokens, coloured by group, with a legend of groups below; hover or keyboard focus shows "<slug>, <tokens>k tokens"; clicking selects that skill and every other segment dims.
3. **Given** the search box, **When** the admin types text, **Then** after a short pause the list shows only skills whose slug, title or description contain the text, ignoring case, and the search text appears in the URL.
4. **Given** the group chips with counts and an "All" chip, **When** one group is chosen, **Then** only that group's skills remain and the group appears in the URL; the chip counts reflect the whole library, not the current search.
5. **Given** the sort switch, **When** "Recently edited" is chosen, **Then** rows are ordered by last edit, newest first, the drag handles are inactive with the hint "Reordering is off while sorted by edit time", and the sort appears in the URL.
6. **Given** any row, **When** the admin clicks it, **Then** the row is highlighted and marked as current, the slug appears in the URL, and the skill panel shows: group tag, title, the path `.agent/skills/<slug>/` with a Copy path button that reads "Copied" for 2 seconds after a click, Tokens with "<x>% of library", Files, Created, the full description, "Used in templates" chips (linking to the template page), Activity, and Edit skill / Delete.
7. **Given** a row's meta line, **When** the skill is used in one template, **Then** the template name is shown; in several, "N templates" with the full list in a tooltip; in none, "Not in any template" in a warning colour.
8. **Given** a row's edit time, **When** rendered, **Then** it reads "Edited 3 h ago" with the absolute date in a tooltip and in a machine-readable time element, a green dot precedes it when the edit is under 24 hours old, and the relative text refreshes about once a minute without a reload.
9. **Given** a URL with search, group, sort and skill parameters, **When** opened directly, **Then** the page restores all four, and the browser Back button closes the skill panel or drawer before leaving the page.

---

### User Story 2 - Put the library in a deliberate order, shared by everyone (Priority: P2)

An admin drags rows into a new order with the mouse, or focuses a drag handle and moves the row with the arrow keys. Moved rows show how far they moved. Nothing is saved until the admin presses "Save order" in a bar that counts moved positions; "Discard" restores the saved order. The order is shared: after a reload any admin sees the same order. Agents and templates are unaffected by the order.

**Why this priority**: The brief's first "done when" line is "the order is saved and identical for every user after reload". It is the one capability the current page has no equivalent for.

**Independent Test**: With two browser sessions open, reorder in one, save, reload the other and see the new order. Verify that no agent's or template's skill set changed.

**Acceptance Scenarios**:

1. **Given** custom-order sort and no filter, **When** a row is dragged and dropped, **Then** while dragging the row is semi-transparent and the drop place is a 3px accent line; after the drop the list shows the new order, moved rows carry "↑N" / "↓N" badges relative to the saved order, and a bar reads "List order changed: N positions moved" with Discard and Save order.
2. **Given** a search or group filter is active, **When** a visible row is moved among the visible rows, **Then** the full library order is recomputed so that the visible rows take the new relative order and hidden rows keep their places; the badge counts reflect the full-order change.
3. **Given** keyboard focus on a drag handle, **When** ↑ or ↓ is pressed, **Then** the row moves one place and a live region announces "<slug> moved to position X of Y".
4. **Given** pending changes, **When** Save order is pressed, **Then** all positions are saved as one all-or-nothing operation, the bar disappears, badges clear, and a reload by any admin shows the saved order.
5. **Given** pending changes, **When** Discard is pressed, **Then** the list returns to the saved order and the bar disappears.
6. **Given** the save fails, **When** the error comes back, **Then** the list returns to the last saved order and a toast shows the error; **When** the failure is because someone else changed the order since the page loaded, **Then** the list reloads with their order and a message says so.
7. **Given** pending changes, **When** the admin navigates away or closes the tab, **Then** a confirmation is required first.
8. **Given** the sort is "Recently edited", **When** the admin tries to drag, **Then** nothing moves and the hint explains why.

---

### User Story 3 - Create or edit a skill with confidence (Priority: P2)

An admin opens New skill, types a title and watches the slug and the folder path form underneath, picks a group, writes a short description against a 140-character budget, and writes the markdown body in a monospace editor while a sticky preview shows the list row as it will appear and the markdown as the agent will read it. Mistakes (empty, wrong characters, a name already taken) are flagged under the field as they type. Work in progress survives a closed tab as a draft. Ctrl/Cmd+S submits. On success they land back on Skills with the new skill selected and a toast. Edit skill uses the same layout with "Save changes".

**Why this priority**: Every skill passes through this form; it is the second screen of the mockup and the source of the group and description data the list depends on.

**Independent Test**: Create a skill from an empty form end to end, then reload mid-way to see the draft restored, then try a taken slug and see it refused before submit.

**Acceptance Scenarios**:

1. **Given** an empty form, **When** "DevOps Engineer!" is typed as the title, **Then** the slug reads "devops-engineer" and the hint reads "Folder: .agent/skills/devops-engineer/"; **When** the admin edits the slug by hand, **Then** later title edits no longer change it.
2. **Given** the slug field, **When** it is empty, contains characters outside lowercase letters, digits and dashes, starts with a dash, or matches an existing skill (checked against the server after a short pause), **Then** an error replaces the hint, the field is marked invalid and described by the error, and Create skill is disabled.
3. **Given** the description field, **When** text is typed, **Then** a counter "N / 140" updates; beyond 140 the counter turns red and a hint says the list will cut the description.
4. **Given** the body editor, **When** text is typed, **Then** a counter shows line count and "≈ N tokens", the "How the list shows it" card shows the row as it would appear (title, slug, description, group, tokens, "not in any template"), and "What the agent reads" shows the rendered, sanitised markdown.
5. **Given** typed content, **When** the tab is closed and the page reopened by the same user, **Then** the content is restored and the header reads "Draft · edited N min ago"; after a successful create, the draft is gone.
6. **Given** a valid form, **When** Ctrl/Cmd+S is pressed or Create skill is clicked, **Then** the skill is created, the admin is redirected to Skills with the new skill selected, and a toast confirms it.
7. **Given** unsaved changes, **When** the admin navigates away, **Then** a confirmation is required.
8. **Given** Edit skill, **When** the slug is changed, **Then** a warning says the folder inside agents will be renamed; the header buttons read Cancel / Save changes.
9. **Given** New skill, **When** the Templates block is read, **Then** it says "A new skill is not in any template. Attach it on the Templates page after you create it." with no controls.

---

### User Story 4 - Use the page on a tablet or phone without losing the list (Priority: P3)

On a tablet the list takes the full width and the skill panel opens as a drawer on request. On a phone rows become cards, the panel is a bottom sheet, the summary is a 2×2 grid, group chips scroll sideways, sort is a select, and reordering is an explicit mode behind a "Reorder" button so it does not fight with scrolling.

**Why this priority**: The brief makes the list the top priority on narrow screens and lists five widths in "done when". It is independent of the data work and can land after the desktop layout.

**Independent Test**: Open the page at 390, 768, 1024, 1280 and 1440px wide; there is no horizontal page scroll at any of them, and the list is never narrower than 560px while the panel is open.

**Acceptance Scenarios**:

1. **Given** a viewport ≥ 1280px, **When** the page loads, **Then** the list and a 360–400px panel sit side by side, the panel stays in view while the list scrolls and scrolls on its own when it overflows, and the panel always shows something: the first skill or "Pick a skill to see its details".
2. **Given** a viewport of 768–1279px, **When** a row is clicked, **Then** a drawer of width min(420px, 90vw) opens from the right over a dimmed page; Esc, a click on the backdrop, the close button and the browser Back all close it; focus stays inside while open and returns to the row after; with no selection the drawer is closed and the URL has no skill parameter.
3. **Given** a viewport < 768px, **When** the list renders, **Then** rows are cards (title and slug, two-line description, wrapping meta) with Edit and Delete in a "⋯" menu whose button is 44×44; selecting a card opens a bottom sheet about 90% high with a grab handle, closable by swiping down or a button; the summary is a 2×2 grid with the size strip kept; group chips scroll horizontally in one line; sort is a select.
4. **Given** a viewport < 768px, **When** "Reorder" is pressed, **Then** handles become visible, a touch drag starts after holding about 200 ms, and Cancel / Save order are pinned to the bottom; outside this mode nothing drags.
5. **Given** any width, **When** a slug is longer than its column, **Then** it wraps rather than overflowing; all touch targets are at least 44px; drawer, sheet and drag animations are disabled when the user prefers reduced motion.

---

### User Story 5 - Delete a skill from its panel, without a modal (Priority: P3)

An admin presses Delete in the skill panel, reads an inline confirmation that names the slug and the templates it will leave, and chooses Keep or Delete. After deletion the neighbouring skill is selected so the panel never goes blank.

**Why this priority**: Replaces the existing modal; small, but it changes where deletion lives.

**Independent Test**: Delete the middle skill of three from the panel and see the next one selected; delete the last and see the previous selected; delete the only one and see the empty-library state.

**Acceptance Scenarios**:

1. **Given** a selected skill used in templates A and B, **When** Delete is pressed, **Then** the panel shows "Delete <slug>? It is removed from A and B." with Keep / Delete and no modal; a skill in no template gets a wording without the template clause.
2. **Given** the inline confirmation, **When** Delete is pressed, **Then** the skill disappears from the list, summary and strip, the templates that held it no longer list it, and the next skill (or the previous one at the end of the list) becomes selected.
3. **Given** the inline confirmation, **When** Keep is pressed, **Then** nothing changes and the panel returns to its normal content.

---

### Edge Cases

- A skill with no group: shown with a neutral "Ungrouped" tag and strip colour, counted in All, and given its own filter chip only while such skills exist.
- Token estimate when the body is empty or the skill was imported before estimates existed: 0 until the next save, shown as "≈ 0"; a one-time backfill on deploy fills existing rows so the summary is right from day one.
- Two admins reorder at once: the second save is refused, that admin's list reloads with the first admin's order and a message explains why.
- Reordering while a filter hides most rows: moving among three visible rows must not disturb the relative order of the nine hidden ones.
- Deleting the currently selected skill from another tab: the panel shows "Pick a skill to see its details" after the next list refresh rather than a stale skill.
- Search text that matches nothing: "No skills match" with a Clear search and filters action that resets search and group but keeps sort.
- Empty library: text plus New skill / Import from GitHub, and no summary numbers other than zeros.
- Load failure: a message and Retry; while loading, skeletons for the summary and six rows.
- Slug uniqueness check in flight when the user submits: submit waits for the answer rather than creating a duplicate.
- Draft from a different user on the same browser: drafts are keyed by user as well as slug, so one admin never sees another's draft.
- Edit skill where the body is large (tens of thousands of characters): counters and preview keep up without freezing input.
- Browser Back with an open drawer and pending reorder: Back closes the drawer first; leaving the page still asks about the unsaved order.

## Requirements *(mandatory)*

### Functional Requirements

**Data the library needs**

- **FR-001**: Each skill MUST carry a shared, persisted display position used only by the Skills page; it MUST have no effect on which skills an agent or a template receives.
- **FR-002**: The system MUST save a full set of positions as one all-or-nothing operation and MUST refuse the save when the order changed since the caller loaded it, telling the caller so.
- **FR-003**: Each skill MAY belong to exactly one group from a single configurable list: API, Routing, Spec lookup, Answer format, Runtime. Each group has one colour and one text label; the list lives in one place and is editable in the form.
- **FR-004**: Each skill MUST carry an approximate token size computed on the server whenever the body is saved (ceil of characters ÷ 4 when no tokenizer exists), always shown with "≈".
- **FR-005**: Each skill MUST expose the number of its files besides the body, the templates it is attached to (identifier and name, read-only), and its created and last-edited times.
- **FR-006**: Skill history MUST show, at minimum, Created and Last edited; richer events are shown only if an audit log exists (none does today — see Assumptions).

**Skills page**

- **FR-007**: The page MUST keep the current header: title, subtitle, Import from GitHub, New skill.
- **FR-008**: The page MUST show the four summary figures (count, ≈ total tokens, edited this week with "last N ago", not used in templates with slugs) and the per-skill size strip with legend as in User Story 1.
- **FR-009**: The page MUST offer search over slug, title and description (case-insensitive, applied after a short pause of about 150 ms), group chips with counts including All, and a Custom order | Recently edited sort.
- **FR-010**: Search, group, sort and selected skill MUST live in the URL (`q`, `group`, `sort`, `skill`) so a copied link restores the same view; Back MUST close the panel or drawer before leaving the page.
- **FR-011**: Each row MUST show a drag handle, a coloured group mark, bold title with monospace slug, a description clamped to two lines, a meta line (group text tag, "N.Nk tokens", templates wording per User Story 1 scenario 7, relative edit time per scenario 8) and an Edit button; clicking the row selects it with a visible highlight and a current-item marker.
- **FR-012**: Relative times MUST refresh about once a minute and use the viewer's time zone; absolute times appear in a tooltip and a machine-readable time element.
- **FR-013**: Reordering MUST behave as in User Story 2: custom-order only, mouse and keyboard, live announcements, ↑/↓ badges, pending bar with Discard / Save order, rollback and toast on failure, reload and message on a concurrent change, confirmation before leaving with unsaved order.
- **FR-014**: The skill panel MUST show group tag, title, path with Copy path (shows "Copied" for 2 s), Tokens with share of library, Files, Created, full description, Used in templates chips linking to the template page, Activity, Edit skill and Delete; it never offers template management.
- **FR-015**: Delete MUST be confirmed inline (Keep / Delete) with the slug and the affected templates named, and afterwards the neighbouring skill is selected.
- **FR-016**: The page MUST provide loading (summary and six row skeletons), error (message and Retry), empty library (text, New skill, Import from GitHub) and no-match ("No skills match", Clear search and filters) states.

**Responsive behaviour**

- **FR-017**: At ≥ 1280px the panel is a 360–400px sticky column with its own scroll that is always populated (first skill or "Pick a skill to see its details"); at 768–1279px it is a right drawer of width min(420px, 90vw) with backdrop, Esc / backdrop / close / Back to dismiss, focus trapped inside and returned to the row; at < 768px rows are cards with a 44×44 "⋯" menu holding Edit and Delete, the panel is a bottom sheet (~90% height, grab handle, swipe down or button to close), the summary is 2×2, chips scroll horizontally, sort is a select, and drag is only available in an explicit Reorder mode with a ~200 ms touch hold and pinned Cancel / Save order.
- **FR-018**: At every width there is no horizontal page scroll, long slugs wrap, touch targets are ≥ 44px, and drawer, sheet and drag animations are off under reduced-motion preference. The list is never narrower than 560px while the panel is open.

**New skill / Edit skill**

- **FR-019**: The form MUST show breadcrumbs "Skills / New skill" (or the skill's title), header actions Cancel and Create skill (Save changes on edit), and the fields in this order: Title, Name (slug), Group, Description, Body.
- **FR-020**: The slug MUST be generated from the title (lowercase, only `a-z0-9-`, runs of dashes collapsed, no leading or trailing dash) until the user edits it by hand; it MUST be validated live for presence, format `^[a-z0-9][a-z0-9-]*$`, and uniqueness via a server check after a ~300 ms pause; the hint "Folder: .agent/skills/<slug>/" or the error sits under the field with invalid and described-by semantics. On edit, changing the slug warns that the folder in agents will be renamed.
- **FR-021**: Description MUST show "N / 140"; past 140 the counter is red with a hint that the list truncates it. The server MUST keep accepting longer descriptions (the limit is advisory).
- **FR-022**: Body MUST be a monospace markdown editor with a line counter and "≈ N tokens".
- **FR-023**: A sticky preview MUST show "How the list shows it" (the future list row) and "What the agent reads" (sanitised rendered markdown using the renderer the console already has).
- **FR-024**: The Templates block on New skill MUST be the fixed sentence "A new skill is not in any template. Attach it on the Templates page after you create it."
- **FR-025**: Drafts MUST autosave locally, keyed by user and slug, surface as "Draft · edited N min ago" in the header, and be removed after a successful create.
- **FR-026**: Ctrl/Cmd+S MUST submit; leaving with unsaved changes MUST ask for confirmation; Create skill MUST be disabled while the form is invalid; success MUST redirect to Skills with `?skill=<slug>` and a toast.
- **FR-027**: At ≥ 1024px form and preview are two columns; below, one column with Write | Preview tabs above the editor and the "How the list shows it" card under the form; below 768px Cancel and Create are pinned to the bottom of the screen.

**Accessibility**

- **FR-028**: Only real buttons, links, inputs and labels are used; icon-only buttons carry an accessible name; text contrast is at least 4.5:1 including muted captions; groups are told apart by a text tag and not colour alone; keyboard focus is always visible.

**Scope limits**

- **FR-029**: Any field in FR-001..FR-006 that cannot be backed in this change MUST be hidden in the UI (never shown as a placeholder), and the PR MUST list what was hidden and why.
- **FR-030**: The change MUST NOT alter what agents receive, how templates attach skills, the Import from GitHub flows, or the post-save redeploy prompt on Edit skill.

### Key Entities

- **Skill**: a markdown document mounted into agents under `.agent/skills/<slug>/`. Has slug (unique), title, description, body, sibling files, origin source, group (optional, one of the configured list), display position (shared), approximate token size, created and last-edited times. Attached to zero or more Templates.
- **Group**: one of a fixed, centrally configured list (API, Routing, Spec lookup, Answer format, Runtime), each with a label and a colour. Not a stored entity; a value a skill carries.
- **Library order**: the complete list of skill positions plus a version marker, so that a save made against an outdated version is refused.
- **Template** (existing, read-only here): a named agent template that lists the skills it ships; the Skills page only reads the link.
- **Activity event**: a dated statement about a skill (Created, Last edited; and, if an audit log ever exists, edited body / edited description / renamed / imported / attached to template).
- **Draft**: unsaved form content kept on the admin's browser, keyed by user and slug.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an admin saves a new order and any other admin reloads Skills, 100% of positions match; no agent's or template's skill set has changed (verified by comparing before/after snapshots of every template's skill list and every agent's mounted skills).
- **SC-002**: At 390, 768, 1024, 1280 and 1440px the page has zero horizontal scroll, and with the panel open the list measures at least 560px wide.
- **SC-003**: An admin can find a skill by a word from its description and open its details in under 10 seconds from page load, without using the browser's find.
- **SC-004**: An admin can reorder a 12-item list by keyboard alone (tab to a handle, arrows, Save) with every move announced, in under 60 seconds.
- **SC-005**: A new skill can be created from an empty form in under 2 minutes, and a taken slug is flagged before submit in at least 95% of attempts (the remaining cases being an in-flight check at submit time, which still blocks the duplicate).
- **SC-006**: 100% of fields in the brief are either backed by the server or absent from the UI and named in the PR; none is shown as a placeholder.
- **SC-007**: All unit tests (slugify, relative time, filtered reorder recomputation, order diff for badges) and all end-to-end scenarios listed in the brief (mouse drag and save, keyboard move, Discard, rollback on failed save, drawer at 1024px with Esc and focus return, bottom sheet and Reorder mode at 390px, slug validation and taken name) pass in CI.
- **SC-008**: An automated accessibility check of both pages reports no contrast failures below 4.5:1 and no interactive element without an accessible name.

## Assumptions

**Existing system (found during specification, for planning)**

- Admin pages live in the `skill` slice: `/skills` (list), `/skills/create`, `/skills/:id/edit`, `/skills/import` (+ `search`, `url`). Templates have their own pages at `/templates` and `/templates/:id`, so "Used in templates" chips can link there.
- The API exposes list, get, create, update, delete, import, import-url, search, sources, and `:id/agents` (dependent agents for the redeploy prompt). The Skill model has id, name, title, description, body, files (JSON list of path + content), source, createdAt, updatedAt and a many-to-many link to Template. There is **no** group, display position or token estimate today; all three need a migration and API changes. Files count and templates can be derived from existing data.
- There is **no audit log** in the API (the `log` slice is pod logs). Activity therefore shows Created and Last edited only; the five-event history is not built in this change and the UI must not pretend otherwise.
- There is **no tokenizer** in the API or consoles; the estimate is ceil(characters ÷ 4) over the body only (files are counted, not sized).
- The admin console already has: a markdown renderer with sanitisation (used by bridle chat), a toast system, tooltip / sheet / tabs / select / skeleton / badge / card UI primitives, an icon set, a drawer-like sheet, and a utility set for formatting. No drag-and-drop library is installed in either console; the plan picks one (dnd-kit's Vue port or an equivalent) only if no existing dependency covers it.
- The existing "Redeploy N agents" prompt after saving an edited skill stays as is (FR-030); the brief does not mention it and removing it would hide that skills are baked into running agents.
- The Ranch agent has skill tools for get, search, create, delete and import, but none for update, group or order. The plan's Constitution Check decides which new console capabilities get a tool; manual display order is a candidate for a waiver (pure presentation), group assignment is not.

**Product defaults chosen where the brief was silent**

- Admin is English-only, so relative times are English; the viewer's time zone comes from the browser.
- Skills with no group are "Ungrouped": neutral colour, their own chip while any exist, included in All.
- Newly created skills take the last position; imported skills likewise. Existing skills get an initial order by creation date on migration.
- Group chip counts are over the whole library, not the current search, so the admin can see what a chip would show.
- The 140-character description budget is advisory in the UI and not enforced by the server, so imports with long descriptions keep working.
- On the inline delete confirmation, "It is removed from A and B" lists the real templates the skill is in; with none, the sentence is "Delete <slug>? It is not in any template."
- On phones, Delete from the "⋯" menu opens the same inline confirmation inside the card.
- Drafts are kept only for New skill (an Edit page has the saved record as its source of truth); the unsaved-changes guard applies to both.
- Only admins use this console; everyone who can see Skills can reorder, and there is no per-user order.
- The concurrent-change rule (FR-002) uses a version marker over the whole library order; the plan picks the mechanism.
