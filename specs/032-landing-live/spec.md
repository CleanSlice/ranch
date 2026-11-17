# Feature Specification: Live landing — light beam in the hero, running scenes in Platform, scroll-driven Infrastructure

**Feature Branch**: `feat/CLEAN-234-landing-live` (spec directory `032-landing-live`)

**Created**: 2026-11-17

**Status**: Draft

**Ticket**: [CLEAN-234](https://dreamvention.atlassian.net/browse/CLEAN-234) `[APP]`

**Input**: User description: "Прочитай и выполни: C:\Users\maxim\orca\workspaces\ranch\skills-redesign\Claude outputs\landing-live\IMPLEMENTATION_PROMPT_LANDING_LIVE.md. Работаем в текущем ворктри. Перед началом посмотри preview.mp4 из той же папки."

**Reference**: the `landing-live` package — `preview.mp4` (37 seconds of the page in motion), four stills, and the finished code cut against version 0.3.86. The recording is the visual target. Where the page and the recording disagree, the recording wins unless this spec says otherwise.

## Background

The public landing is the page a visitor sees at the root of the app console before signing in. Today it describes the product in still pictures: the six Platform cards are an icon, a title and a paragraph, and Infrastructure is a list of four steps. A visitor reads that agents chat, deploy and log, and sees none of it happen.

This feature makes the page show the product at work. Nothing about what the page says changes; how it says it does.

## Scope

**In scope:**

- The hero: a beam of light that falls into the demo panel, and a light inside the primary buttons that follows the pointer.
- The Platform section: a small running scene in each of its six cards.
- The Infrastructure section: one pinned scene driven by scrolling on wide screens, a plain list on narrow ones.
- The English and Russian strings these scenes need.

**Out of scope:**

- The admin console, the API, the CLI.
- Sign-in, routes, the console's own chat, and every landing section not named above ("How it works", the agents list, the closing call to action and the footer keep their content).
- New third-party dependencies.
- The wording, timing and colours of the package: they are carried over as delivered, not re-tuned.
- The menu item "Как это работает" wrapping onto two lines at 1024 px in Russian. It wraps today and is not part of this change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor sees what the platform does without reading (Priority: P1)

A visitor scrolls to the Platform section. Each of the six cards is playing a short scene of its capability: a question is asked in a chat, the agent thinks, the answer arrives word by word with its sources; a selection moves across three agent templates; lifecycle phases light up in turn; four workflow steps complete left to right; a log gains a line about once a second; the status dot of each agent in a fleet changes in turn.

**Why this priority**: Platform is the section that answers "what does this do". It is the largest change in what a visitor understands, and it stands on its own without the other two.

**Independent Test**: Open the landing signed out, scroll to Platform, watch for fifteen seconds. All six scenes run and loop; a line under the grid says the data is a demo.

**Acceptance Scenarios**:

1. **Given** the Platform section is on screen, **When** the visitor watches the chat card, **Then** a question appears, then a "thinking" state, then the answer word by word, then a sources chip, and a second, different exchange follows the first.
2. **Given** the Platform section is on screen, **When** the visitor watches the other five cards, **Then** each shows its own motion: the template selection moves, the phases light in order, the workflow steps complete left to right, the log grows, the fleet's indicators change in turn.
3. **Given** the Platform section has scrolled off screen or the tab is hidden, **When** time passes, **Then** the scenes do not advance, and they resume when the section is visible again.
4. **Given** the scenes are running, **When** the visitor looks under the card grid, **Then** a note states that the scenes show sample data.

---

### User Story 2 - A visitor follows a deployment from record to first reply (Priority: P2)

On a wide screen the visitor scrolls into Infrastructure. The section pins under the page header: four stations on the left, one window on the right. As the visitor scrolls, the active station moves from 01 to 04 and the window changes with it — the agent's record filling in, the workflow's steps completing, the pod starting and logging, the agent answering its first message. A light runs around the window's frame and warms as the sequence advances. The station titles are buttons: pressing one scrolls to that station.

On a narrow screen there is no pinning. The four stations are a list, each with its own window shown in its finished state.

**Why this priority**: It turns the least readable section into the page's main demonstration, but the page is already useful with Story 1 alone, and this section must first of all not break narrow screens.

**Independent Test**: At 1440 px scroll through Infrastructure and see the four states in order; press station 03 and land on it. At 390 px see four stations stacked, each with a completed window, and no sideways scrolling.

**Acceptance Scenarios**:

1. **Given** a viewport 1024 px wide or wider, **When** the visitor scrolls through Infrastructure, **Then** the scene stays pinned under the header while the active station advances 01 → 02 → 03 → 04 and the window shows record, workflow, pod and chat in that order.
2. **Given** the pinned scene, **When** the visitor scrolls back up, **Then** the stations and the window go back through the same states in reverse.
3. **Given** the pinned scene, **When** the visitor presses a station title, **Then** the page scrolls to that station and it becomes the active one.
4. **Given** a viewport narrower than 1024 px, **When** the visitor reaches Infrastructure, **Then** nothing pins: four stations appear as a list, each followed by its window in the finished state.
5. **Given** either layout, **When** the visitor looks at the window and under the section, **Then** a "Demo" badge is on the window and a note under the section says the data is sample data.

---

### User Story 3 - The hero draws the eye to the demo panel (Priority: P3)

Behind the headline stands a soft column of light; the letters sit in front of it. From the row of buttons down to the top edge of the demo panel runs a thin bright line with sparks travelling down it, and the panel's top edge glows where the line lands. The primary "Get started" buttons — in the hero and in the page header — carry a warm spot near the arrow; under the pointer the spot follows it, and returns when the pointer leaves.

**Why this priority**: It is polish on a hero that already works. It adds no information, so it comes last.

**Independent Test**: Load the landing and look at the hero for five seconds; move the pointer across "Get started" and away.

**Acceptance Scenarios**:

1. **Given** the hero is on screen, **When** the page has loaded, **Then** a soft column of light is visible behind the headline and the headline text stays fully legible in front of it.
2. **Given** the hero is on screen, **When** the visitor watches the space between the buttons and the demo panel, **Then** a bright line connects them, sparks move down it, and the panel's top edge glows.
3. **Given** a primary button, **When** the pointer moves over it, **Then** the warm spot inside it follows the pointer, and **When** the pointer leaves, **Then** the spot returns to its resting place near the arrow.
4. **Given** the demo panel shows a live public agent instead of the sample one, **When** the hero is displayed, **Then** the beam lands on the panel the same way.

---

### Edge Cases

- **Reduced motion.** A visitor who asked their system for less motion sees the beam standing still with no sparks, every card scene in its finished state (the full answer in the chat, all workflow steps complete), the Infrastructure window readable without animation, and a button spot that does not move.
- **Hidden tab or section off screen.** Scenes stop advancing and do not catch up in a burst when they come back.
- **Touch devices.** There is no pointer to follow; the button spot stays at rest and buttons work as before.
- **Longer Russian text.** Scene text in Russian is longer than in English; it must not overflow its card or window at any supported width.
- **Short viewports.** The pinned scene must fit under the header on a short wide screen without clipping the window's content.
- **Jumping by anchor or station button.** Arriving in the middle of Infrastructure shows the state that belongs to that scroll position, not the first one.
- **API unavailable.** The hero falls back to the sample panel, as it does today; the beam and the scenes do not depend on the API.
- **Browser support.** Where a browser lacks one of the visual effects, the content stays readable and usable; losing an effect is acceptable, losing text or a control is not.

## Requirements *(mandatory)*

### Functional Requirements

**Hero**

- **FR-001**: The hero MUST show a soft column of light behind the headline, with the headline text in front of it and fully legible.
- **FR-002**: The hero MUST show a bright line from the button row to the top edge of the demo panel, with sparks travelling down it and a glow on the panel's top edge.
- **FR-003**: Primary and accent buttons on the landing MUST carry a warm spot that follows the pointer while it is over the button and returns to rest when it leaves.

**Platform**

- **FR-004**: Each of the six Platform cards MUST play a scene of its own capability: chat, templates, lifecycle, workflow, logs, agent fleet.
- **FR-005**: The chat scene MUST go question → thinking → answer word by word → sources, and alternate between two exchanges.
- **FR-006**: Scenes MUST advance only while the Platform section is visible and the tab is in the foreground.
- **FR-007**: A note under the Platform grid MUST state that the scenes show sample data.

**Infrastructure**

- **FR-008**: At 1024 px and wider, Infrastructure MUST be a scene pinned under the page header in which scrolling moves the active station from 01 to 04 and changes one window through four states: agent record, workflow, pod, chat.
- **FR-009**: The scene MUST be reversible: scrolling back returns through the same states.
- **FR-010**: Station titles in the pinned layout MUST be operable controls that scroll the page to their station, reachable and usable by keyboard.
- **FR-011**: Below 1024 px, Infrastructure MUST be a list of four stations, each with its own window in the finished state, with no pinning.
- **FR-012**: The Infrastructure window MUST carry a "Demo" badge and the section MUST carry a note that the data is sample data.

**Across the page**

- **FR-013**: With reduced motion requested, the page MUST show the beam static and without sparks, every scene in its finished state, and a button spot that does not move.
- **FR-014**: The page MUST have no horizontal scrolling at 1440, 1024, 768 and 390 px in English and in Russian.
- **FR-015**: Every new piece of visitor-facing copy MUST exist in English and in Russian. Sample identifiers, resource values and mock log lines are shown the same in both languages.
- **FR-016**: The change MUST add no errors to the browser console and no failed requests beyond those the page produces today.
- **FR-017**: The change MUST stay inside the landing of the app console. The admin console, the API and every other app page MUST behave as before.
- **FR-018**: The change MUST add no third-party dependency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor who watches the Platform section for 15 seconds sees all six capabilities demonstrated in motion, against zero today.
- **SC-002**: Scrolling through Infrastructure at 1440 px shows the four deployment states in order, each one distinct, with the active station matching the window 100% of the time in both scroll directions.
- **SC-003**: At 1440, 1024, 768 and 390 px, in both languages (eight combinations), the page has no sideways scrolling and no text cut off or overlapping.
- **SC-004**: With reduced motion requested, nothing on the landing moves by itself, and every scene still shows its complete content.
- **SC-005**: While the Platform section is off screen, its scenes advance zero steps.
- **SC-006**: The page's console shows no error that was not there before the change.
- **SC-007**: Both sample-data notes and the "Demo" badge are visible wherever a scene shows data, in both languages.
- **SC-008**: The project's translation, locale, test, type and build checks all pass with the change in place.

## Assumptions

- **The package is the implementation.** The code was written and reviewed outside this worktree against 0.3.86. The work here is to carry it over, prove it with the project's checks and the browser, and report — not to redesign it. It includes the earlier `landing-refine` package, which is not applied separately.
- **The page gets longer, and that is expected.** At 1440 px the landing grows from 5362 px to 7631 px; the pinned scene accounts for the difference.
- **Russian strings were written by hand, and are kept.** The project's rule is that English is the source and Russian is generated. The package ships hand-written Russian for its 19 new strings together with the matching source hashes, so the translation check passes and a later sync leaves them alone. This is a deliberate exception requested by the package's author; the sync is not run as part of this work. A plan for this feature records it as a waiver rather than leaving it silent.
- **The locale check's exception list moves with the code.** The scenes show sample identifiers, Kubernetes terms and mock log lines that are never translated. They moved between files, so the list of allowed untranslated strings is updated to match: entries that no longer excuse anything are removed, the same kinds of strings in the Infrastructure scene are added. No visitor-facing copy is exempted.
- **The admin twin needs nothing.** `common` exists in both consoles, but only the app console has a landing; the admin console has no landing components and uses none of the landing's styles.
- **Chromium is what was verified.** Safari, Firefox and a real touch device were not checked by the package's author. The places at risk are gradient-filled headline text, the masked ring of light around the Infrastructure window, colour mixing and conic gradients in the same ring, and the small-viewport height unit used for the pinned scene. They are to be checked or reported as unchecked, not assumed.
- **Scene data is sample data.** No scene reads from the API or holds a product entity; nothing here is stored.
