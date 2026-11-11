# Feature Specification: App console redesign

**Feature Branch**: `feat/CLEAN-215-app-console-redesign`

**Ticket**: [CLEAN-215](https://dreamvention.atlassian.net/browse/CLEAN-215) — `[APP]`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Возьми в работу полный редизайн App версии" with the brief `skills-redesign/Claude outputs/IMPLEMENTATION_PROMPT.md`. The brief describes a reference implementation that already exists, uncommitted, in the `skills-redesign` worktree, plus a new layer of light interactive animations. Visual references are the screenshots in `Claude outputs/{landing,auth,console,hero}` and the `ranch-orbit-logo-*.png` logos; the `ranch-landing-*-orbit.png` files in the folder root are outdated. Where the brief and the reference code disagree, the brief wins; where the brief and this repo's rules disagree (`CLAUDE.md`, constitution), the repo's rules win and the difference is recorded under Assumptions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor understands RANCH from the landing and starts (Priority: P1)

A visitor opens the public landing page and, without scrolling, sees a floating pill navigation, the orbit brand, a two-line headline on a cinematic planet scene, a short lede and two calls to action. Directly beneath is a product panel that shows the real console: an agent card with status and resources, and a tabbed area where the deployment workflow plays as a scripted demo and, when a public agent allows this page's origin, the chat tab is the real chat with that agent. Scrolling down, the visitor reads how it works in three steps (Configure, Deploy, Chat), what the platform does (a bento of six capabilities with a live-looking chat card), what runs underneath (a four-stage pipeline from configuration to an active agent), a closing call to action and a footer. Sections appear as they come into view. "Get started" leads to login or, for a signed-in user, into the console.

**Why this priority**: The landing is the first thing every prospect and every returning user sees, and today's version is a plain feature grid. Nothing else in this feature is visible to someone who has not signed in.

**Independent Test**: Open the landing anonymously at 1920, 1440, 1024, 768, 390 and 360 px wide. Compare each against the reference screenshots. Check the fold on 1440 shows headline, lede, both buttons and the top of the Stage. Scroll the whole page and confirm each section reveals once. Click every navigation item and both calls to action. Repeat with reduced motion on and confirm the page is fully visible without scrolling animations and without the video.

**Acceptance Scenarios**:

1. **Given** an anonymous visitor on a 1440 px wide screen, **When** the landing loads, **Then** above the fold they see the pill navigation (section anchors, language switch, Log in, Get started), the eyebrow "AI agent infrastructure", a headline of exactly two lines, the lede, the two buttons and the top edge of the Stage panel, on a dark planet scene with stars.
2. **Given** the landing has loaded, **When** the visitor looks at the Stage panel, **Then** it shows an agent card (avatar, name, template, status dot, CPU and memory) and tabs Chat / Runtime / Workflow; the Workflow tab plays a five-step deployment (submit workflow, schedule pod, pull image, start container, agent online) with done, running and pending states, and demo content is labelled as demo.
3. **Given** at least one public agent allows the landing's origin, **When** the visitor opens the Chat tab, **Then** it is a real conversation with that agent (the CLEAN-179 behaviour); **Given** none does, **Then** the tab explains that only public agents allowing this origin are previewed here.
4. **Given** the visitor scrolls, **When** a section enters the viewport, **Then** its heading and cards fade and rise into place once and stay; scrolling back up does not replay them.
5. **Given** a visitor on a phone (390 px), **When** they open the menu, **Then** the menu is a fully opaque panel (the hero does not show through it) with the same links, and the headline, lede, buttons and Stage stack vertically with no horizontal scroll.
6. **Given** a signed-in user opens the landing, **When** they look at the navigation, **Then** "Get started" reads "Open console" and leads to the agents page, and "History" appears beside "Agents".
7. **Given** the visitor switches language in the navigation, **When** the page re-renders, **Then** every landing string changes language, including the Stage demo copy; nothing is left in the other language.

---

### User Story 2 - An operator works their agents from the Orbit console (Priority: P1)

A signed-in user opens Agents and sees their agents as nodes on elliptical rings around the RANCH hub: running agents on the inner ring with the admin agent at twelve o'clock, then deploying, pending, failed and stopped agents further out. Each node shows initials, name and status; the status colours the node's border, and a failed agent pulses red. A toolbar above holds the view switch (Orbit / Drum / List), a search box with a keyboard shortcut, and a status legend with counts. At the bottom the free slot count and "Create agent" are always visible. Selecting a node opens that agent in the cockpit on the right: a character sheet (status, class, template, resources, access, created and updated) with Restart, Stop or Start, Share and New chat, above the chat. The sheet collapses to a header line and remembers that choice. On a phone or tablet the orbit is replaced by the list behind a "Switch agent" button, and the chat takes the full width.

**Why this priority**: The agents page is where users spend their time once signed in. The current rail-and-chat layout gives no overview of the fleet's health and hides stop/start behind other screens.

**Independent Test**: Sign in to an account with agents in every status, including the admin agent. Open Agents in Orbit view at 1440 and 1920. Count nodes per ring against the status counts in the legend. Tab through the nodes, open one with Enter, read the sheet, press Stop and watch the node, list row and chat overlay change together, then Start it again. Collapse the sheet, reload, confirm it stays collapsed. Resize below 1024 px and confirm the list-and-chat layout.

**Acceptance Scenarios**:

1. **Given** a user with agents in several statuses, **When** Orbit view renders, **Then** running agents fill the inner ring first (admin agent at twelve o'clock), then deploying, pending, failed and stopped agents in that order; rings hold at most 12, 22 and 32 nodes before the next opens; node labels sit on the side away from the hub.
2. **Given** the orbit is shown, **When** an agent is `failed`, **Then** its node border pulses red and the legend counts it under Failed; **When** an agent is `deploying` or `pending`, **Then** its status dot breathes in the accent colour.
3. **Given** keyboard focus is on the orbit, **When** the user presses Tab and the arrow keys, **Then** focus moves between nodes with a visible ring and the node's name and status are announced; **When** they press Enter, **Then** that agent opens in the cockpit.
4. **Given** the hub in the centre, **When** the user clicks it, **Then** the admin agent opens in the cockpit.
5. **Given** the search box, **When** the user presses Cmd+K (Mac) or Ctrl+K and types, **Then** nodes that do not match dim and matching nodes stay bright; Enter opens the first match; Esc clears the search and restores every node.
6. **Given** an agent is open in the cockpit, **When** the user reads the sheet, **Then** it shows the status, the class "AGENT" or "ADMIN · AGENT", the template, resources (CPU and memory), access (private or public), and "Created <date> · updated <relative time> ago", with the available actions: Restart, Stop (for running, deploying or pending) or Start (for stopped or failed), Share, New chat.
7. **Given** a running agent is open, **When** the user presses Stop, **Then** within one frame the sheet status, the orbit node and the chat overlay all show the stopping state, the Stop button is disabled while the request is in flight, and when the server confirms, the agent reads `stopped` everywhere; **Given** the server refuses, **Then** all three surfaces roll back to `running` and the sheet shows the server's message as received.
8. **Given** the sheet is expanded, **When** the user collapses it, **Then** only the agent header line remains above the chat, the choice survives a reload in this browser, and on a phone the sheet starts collapsed.
9. **Given** the agents list is 30 seconds old, **When** the poll returns, **Then** nodes update in place without re-laying out the rings for agents whose status did not change; **Given** the open agent is `deploying` or `pending`, **Then** it is refreshed every 3 seconds until it settles.
10. **Given** the viewport is narrower than 1024 px, **When** the user opens Agents, **Then** they see the list behind a "Switch agent" button and the chat uses the full width; the view switch is not shown.
11. **Given** the footer of the toolbar, **When** the user has N agent slots left in their quota, **Then** it reads "N slots free" and "Create agent" opens the create flow; **Given** zero slots, **Then** "Create agent" is disabled and the text says no slots are free.

---

### User Story 3 - A user signs in or registers through the Session gate (Priority: P2)

A visitor opens Log in and sees the same planet scene as the landing. On the left a route runs "You → RANCH hub → Your agents"; the first node is lit. On the right a light panel holds a switch between Log in and Create account, pill-shaped fields and a dark submit button. As the visitor focuses a field, light runs along the line towards the hub. On submit the hub lights up; if the server refuses, the hub turns red and the form shows the error; on success the visitor lands in the console. On a phone the route compresses into a single line above the panel and "Back to home" becomes an icon. The "Session ended" dialog inside the console, which reuses the same form, looks exactly as it does today.

**Why this priority**: Every user passes through this screen, and it is the first impression after the landing. It is P2 only because the current login already works and stays usable if this story ships later.

**Independent Test**: Open /login and /register at 1440 and 390 with a running API. Focus a field, submit wrong credentials, submit right ones. Register with registration enabled and with it disabled. Inside the console, force the session to expire and confirm the Session ended dialog is unchanged against a screenshot from main.

**Acceptance Scenarios**:

1. **Given** /login opens, **When** nothing is typed, **Then** the route shows three nodes with the first ("You") lit and the hub and agents nodes dark, and the panel shows Log in selected with Create account beside it.
2. **Given** the visitor focuses or types in a field, **When** the stage becomes "filling", **Then** light runs along the line from "You" to the hub; **When** they submit, **Then** the hub lights up while the request is in flight.
3. **Given** the server refuses the credentials, **When** the response arrives, **Then** the hub turns red, the form shows the error message as received, and the user can correct and resubmit; a later successful submit clears the red state.
4. **Given** the visitor switches to Create account, **When** the panel changes, **Then** the URL is /register and the browser Back button returns to /login; **Given** registration is disabled by the server flag, **Then** the register panel says registration is closed and offers Log in instead.
5. **Given** a 390 px wide screen, **When** /login opens, **Then** the route is one horizontal line above the panel, "Back to home" is an icon button with an accessible label, and the panel fills the width without horizontal scroll.
6. **Given** the console's session expires, **When** the Session ended dialog opens, **Then** it renders the plain form without the gate scene, route or light panel, pixel-identical to the current main build.
7. **Given** reduced motion is on, **When** the stage changes, **Then** the nodes change colour instantly and no light travels along the lines.

---

### User Story 4 - An operator browses agents on the Drum (Priority: P2)

A user switches the console to Drum view and sees agent cards on a horizontal 3D carousel, the front card at full size and its neighbours receding to the sides. They turn it with the mouse wheel or trackpad, by dragging, or with the arrow keys; when they stop, the drum settles on the nearest card. Turning only selects; Enter or a click on the front card opens that agent in the cockpit. The view is remembered the next time they open Agents in this browser.

**Why this priority**: An alternative way to browse for users who think in cards rather than in a map. It shares the toolbar, search and cockpit with Orbit and ships after it.

**Independent Test**: Switch to Drum, scroll the wheel across ten agents, drag, use arrow keys, press Enter, reload and confirm Drum is still the view. Check with a screen reader that the drum announces the active card.

**Acceptance Scenarios**:

1. **Given** Drum view with N agents, **When** it renders, **Then** cards are spaced at a fixed 30° step around a horizontal axis, the front card is at natural size and fully opaque, and side cards are smaller and dimmer.
2. **Given** the user scrolls the wheel horizontally or vertically, drags, or presses Left/Right, **When** input stops for 110 ms, **Then** the drum settles on the nearest card and that card becomes the active one without opening it.
3. **Given** a card is at the front, **When** the user presses Enter or clicks it, **Then** that agent opens in the cockpit; clicking a side card only turns the drum to it.
4. **Given** assistive technology, **When** the drum is focused, **Then** it is announced as a list box whose active item is the front card, and moving the drum updates the active item.
5. **Given** the user chose Drum, **When** they come back to Agents later in the same browser, **Then** Drum is the view; a different browser starts with the default view.

---

### User Story 5 - The landing responds to the visitor with light animation (Priority: P3)

As the visitor moves the pointer over the Capabilities bento, a thin copper-to-lavender glow follows along the card borders and flows between neighbouring cards. Inside the big chat card a soft spotlight follows the pointer. When Steps come into view a beam of light runs Configure → Deploy → Chat once, then repeats slowly. In the Runtime pipeline the light passes stage 1 to 4 in step with the highlighted stage. A single slow copper beam circles the hero Stage panel. Section headings reveal from blur. The primary "Get started" button carries a faint shimmer every few seconds. A row of technology marks RANCH is built on (Kubernetes, Argo Workflows, Docker, Socket.IO, Bridle) scrolls slowly and pauses on hover. The closing call to action has a few rare, dim meteors. None of it moves when the visitor prefers reduced motion; pointer effects are absent on touch devices, replaced by a single highlight when the card appears; nothing loops while off-screen or while the tab is hidden; and the page is not slower than before.

**Why this priority**: Polish on top of a complete landing. It must not ship if it costs performance or accessibility, so it comes last and is measured.

**Independent Test**: With a mouse, hover each bento card and the chat card; scroll Steps and Runtime into view; watch the Stage border, the button and the marquee for 15 seconds. Repeat with reduced motion on: nothing moves. Repeat in touch emulation: no pointer effects, one highlight on reveal. Switch to another tab for 10 seconds and back: loops resumed from pause. Run Lighthouse on main and on this branch at 1440 and on a mobile profile.

**Acceptance Scenarios**:

1. **Given** a pointer device, **When** the pointer approaches a bento card, **Then** a 1 to 1.5 px glow in copper fading to lavender appears on the nearest edges and moves along the borders and across to adjacent cards as the pointer moves; no card gets a fill.
2. **Given** the pointer is over the big chat card, **When** it moves, **Then** a soft spotlight follows it inside that card only; no other card has a spotlight.
3. **Given** Steps scroll into view, **When** the section appears, **Then** one beam travels Configure → Deploy → Chat once, then repeats about every 6 seconds while the section stays on screen; **Given** the Runtime pipeline appears, **Then** light passes stages 1 to 4 and the current stage highlights in sync, replacing the existing dotted line rather than overlaying it.
4. **Given** the hero is on screen, **When** the visitor watches the Stage panel, **Then** a single copper beam circles its edge once every 8 to 12 seconds.
5. **Given** a section heading scrolls into view, **When** it reveals, **Then** it sharpens from blur as part of the existing reveal; the hero headline is visible immediately, unblurred, on first paint.
6. **Given** the primary "Get started" button, **When** the visitor looks at it for 10 seconds, **Then** a faint highlight sweeps across it at most a few times, and its shape and colours are unchanged.
7. **Given** the technology row, **When** it renders, **Then** it shows only Kubernetes, Argo Workflows, Docker, Socket.IO and Bridle as monochrome marks, scrolls slowly, pauses on hover, and is captioned as what RANCH is built on, never as customers.
8. **Given** the closing call to action is on screen, **When** the visitor watches for 10 seconds, **Then** at most a handful of dim meteors cross it; **Given** reduced motion, **Then** none appear.
9. **Given** reduced motion is on, **When** the page loads and the visitor hovers, scrolls and waits, **Then** no beam, shimmer, meteor or marquee moves; glows either show at rest or not at all.
10. **Given** a device without hover, **When** a bento card reveals, **Then** its border glows once and settles, and no spotlight or glow follows touches.
11. **Given** any looping effect, **When** its section leaves the viewport or the tab is hidden, **Then** it pauses, and it resumes when visible again.
12. **Given** measurements on the same machine and network, **When** Lighthouse runs on main and on this branch, **Then** Performance on this branch is not lower, the largest contentful paint element is still the hero image, cumulative layout shift is 0 and interaction latency stays under 200 ms; the JavaScript added for effects is at most about 30 KB gzip.

---

### Edge Cases

- A user with no agents opens Orbit: the hub is shown alone with the legend at zero, the free slot count, and "Create agent" as the primary action; Drum shows an empty state with the same action.
- A user with more than 66 agents (ring capacity 12 + 22 + 32): rings keep their capacities and extra agents open a fourth ring; the layout still has no overlapping nodes at 1440 px.
- Two agents share the same initials: nodes still distinguish them by name label and the label is truncated with an ellipsis, with the full name available on hover and to assistive technology.
- An agent arrives with a status the console has no wording for: its node takes the neutral colour and shows the status text as received, without translation.
- The video loop fails to load or play (blocked autoplay, codec unsupported): the static hero image stays and nothing else changes; no error is shown to the visitor.
- The visitor is on a metered connection or on 2g/3g, or the viewport is under 768 px, or reduced motion is on: the video is never requested.
- The hero leaves the viewport while the video plays: it pauses and resumes when the hero returns.
- The visitor opens the landing with a `?brand=` override or a brand cookie: that brand's mark and wordmark render; an unknown value falls back to the default orbit brand.
- The visitor tabs through the Orbit: focus order follows ring order then angle, and the hub is focusable as "Admin agent".
- A Stop request is in flight when the 30 s poll returns the old status: the optimistic state is kept until the request settles, then the next poll wins.
- The API session dies while the sheet action is in flight: the Session ended dialog takes over and the sheet shows no second error.
- Registration is disabled: /register renders the closed message in the gate layout, with the same scene, and the route stays idle.
- The brief's known problem: on 1440×900 the lit horizon of the scene is almost hidden behind the Stage panel. FR-010 requires both candidate fixes as screenshots before the owner picks one.

## Requirements *(mandatory)*

### Functional Requirements

**Brand**

- **FR-001**: The default brand MUST be "orbit": a mark (the R with a chat cloud, no orbital rings) and a wordmark (rounded RANCH), used in the landing header, the gate, the console header and the orbit hub.
- **FR-002**: The brand MUST be switchable per request by a `brand` query parameter, per browser by a brand cookie, and per deployment by a public configuration value, in that precedence; unknown values fall back to orbit.
- **FR-003**: The brand component MUST offer full, mark-only, wordmark-only and symbol variants, so every surface uses the same assets.
- **FR-004**: The landing palette MUST be the dark plum background with copper accent and lavender depth, and its colours, durations and speeds MUST be named tokens that can be tuned without editing components. The console's dark theme MUST use the matching palette.

**Landing**

- **FR-005**: The landing MUST consist of header, hero, Steps, Capabilities, Runtime, CTA and footer, in that order, each reachable from the header's section anchors.
- **FR-006**: The header MUST be a floating pill with section anchors, language switch, Log in and Get started for visitors, and Agents, History and Open console for signed-in users; the mobile menu MUST be fully opaque.
- **FR-007**: The hero headline MUST wrap to at most two lines at 1440 px and MUST be visible on first paint without any reveal or blur effect.
- **FR-008**: The hero Stage MUST show a real agent card and three tabs; the Workflow and Runtime tabs are scripted demos labelled as demo; the Chat tab MUST be the real chat with a public agent that allows the page's origin, and otherwise MUST explain why no agent is previewed (keeps CLEAN-179).
- **FR-009**: The hero MUST render a static scene image first and MAY upgrade to a muted 7-second video loop that loads only after the page has loaded and the browser is idle, fades in over 1.2 s once it is playing, pauses when the hero is off screen, and is never requested when the visitor prefers reduced motion, the viewport is narrower than 768 px, the connection asks to save data, or the connection is 2g or 3g. Scroll parallax of 8 % MUST apply equally to image and video.
- **FR-010**: On a 1440×900 viewport the lit horizon of the scene MUST remain visible above the Stage panel. Two candidate fixes MUST be produced as 1440×900 screenshots (with a 390 check for each) and posted to the ticket before the landing zone is finalised: (a) raise the scene by shifting the image and video focal point upward; (b) reduce how far the Stage panel overlaps the scene so the panel starts lower. The owner picks one on the screenshots (decision 2026-11-09: compare both first); the chosen variant is recorded in the plan and the other is discarded.
- **FR-011**: Steps MUST present Configure → Deploy → Chat as three cards with a small UI illustration each; Capabilities MUST be a bento with a large live-chat card, Agent templates, Runtime lifecycle, and a row of Workflow orchestration, Logs & monitoring, Multi-agent management; Runtime MUST show the four-stage pipeline Configuration → Argo Workflow → Kubernetes runtime → Active agent.
- **FR-012**: Sections MUST reveal once on scroll through a single page-level observer; with reduced motion everything is visible immediately. One-shot entrance animations MUST be frozen after they end so the fixed header keeps its position.
- **FR-013**: Landing copy MUST contain no invented metrics, testimonials, customer logos or counters. Where a number would be expected and none exists, the slot stays empty and is raised as a question.

**Session gate**

- **FR-014**: /login and /register MUST share one gate layout: the hero scene, a route "You → RANCH hub → Your agents" on the left, and a light panel on the right with a Log in / Create account switch over the two real routes.
- **FR-015**: The route MUST reflect four stages driven only by the form's own state: idle (first node lit), filling (light runs to the hub), connecting (hub lit), failed (hub red). Success navigates to the console. The gate MUST never claim a server event the form did not see.
- **FR-016**: Below 768 px the route MUST compress to one line above the panel and "Back to home" MUST become an icon button with an accessible label.
- **FR-017**: The Session ended dialog MUST keep using the shared form without the gate variant: same markup, same classes, same layout as on main. It renders in the console's theme like every other console surface, so with the console going dark (FR-004) the dialog is dark too; that theme change is the only visual difference allowed.
- **FR-018**: With registration disabled, /register MUST show the closed-registration message in the gate layout and offer Log in.

**Agent console**

- **FR-019**: The console MUST offer Orbit, Drum and List views at 1024 px and wider, remembered per browser; below 1024 px it MUST always show the list behind a "Switch agent" control with the chat at full width.
- **FR-020**: Orbit MUST place agents on elliptical rings around the hub ordered running (admin first, at twelve o'clock), deploying, pending, failed, stopped, with ring capacities 12, 22, 32 and labels pointing away from the hub; the layout MUST be a pure, testable calculation.
- **FR-021**: Node border colour MUST follow status; failed MUST pulse red; deploying and pending MUST breathe. Nodes MUST be buttons operable by Tab, arrow keys and Enter, with name and status exposed to assistive technology. The hub MUST open the admin agent.
- **FR-022**: Drum MUST be a horizontal 3D carousel with a fixed 30° step, front card at natural size, driven by wheel (either axis), drag and arrow keys, settling on the nearest card 110 ms after input stops; turning selects and Enter or a click on the front card opens. It MUST be exposed as a list box with an active descendant.
- **FR-023**: Orbit and Drum MUST share one toolbar: search opened by Cmd+K / Ctrl+K where Enter opens the first match and Esc clears, a status legend with counts on its own line, and a footer with "N slots free" and Create agent.
- **FR-024**: The cockpit MUST be 460 px wide, 520 px from 1280 px and up, with the character sheet above the chat: status, class (AGENT or ADMIN · AGENT), template, resources, access, "Created · updated N ago"; actions Restart, Stop or Start by status, Share, New chat. The sheet MUST collapse to its header, remember the choice per browser, and start collapsed on phones.
- **FR-025**: Restart, Stop and Start MUST optimistically patch the single agent record in the store and roll back on failure; the orbit node, the list row, the drum card and the chat overlay MUST all render from that record so they change together. Errors MUST be shown as received; a dead session is left to the Session ended dialog.
- **FR-026**: The agents list MUST refresh every 30 seconds and the open agent every 3 seconds while it is deploying or pending; these intervals are not changed by this feature.
- **FR-027**: Relative times ("updated 2 d ago") and dates in the sheet MUST go through the console's format utilities and follow the active language; server-sent text (status strings without wording, error messages) MUST be shown as received.

**Animation layer**

- **FR-028**: The landing MUST add the following pointer- and scroll-reactive effects, recoloured to the landing tokens: border glow across the Capabilities bento, spotlight on the big chat card only, a beam across Steps (once on reveal, then about every 6 s), a beam through the Runtime pipeline that replaces the existing dotted line, one slow border beam on the hero Stage (8 to 12 s cycle), blur reveal on section headings inside the existing reveal, a shimmer on the primary button, a technology marquee of Kubernetes, Argo Workflows, Docker, Socket.IO and Bridle with pause on hover, and rare dim meteors in the CTA.
- **FR-029**: At most one attention-drawing (looping) effect MUST be in view at a time; every other effect only responds to the pointer or to reveal.
- **FR-030**: With reduced motion, every effect MUST be static: no beams, shimmer, meteors or marquee movement; glows at rest or absent. On devices without hover, pointer effects MUST be off and replaced by a single highlight on reveal.
- **FR-031**: Every looping effect MUST pause while off screen and while the document is hidden.
- **FR-032**: Effects MUST animate only transform and opacity (filter and box-shadow allowed on hover), MUST cause no layout shift, and any canvas-based effect MUST render client-side only with a same-size placeholder.
- **FR-033**: The landing MUST NOT use WebGL, three.js or shader backgrounds, cursor effects, GSAP-based text reveal, or a second heavy background behind the hero video.
- **FR-034**: Added effect code MUST stay within about 30 KB gzip and MUST NOT lower the landing's Lighthouse Performance score, change the largest contentful paint element away from the hero image, introduce layout shift, or push interaction latency above 200 ms; before/after measurements MUST be recorded.

**Non-regression and housekeeping**

- **FR-035**: Login, registration, routing, chat, session handling and the Session ended dialog MUST behave exactly as before for every flow not described here.
- **FR-036**: Every user-visible string MUST be added to the English source and translated through the project's sync; the translation check MUST pass. Russian copy MUST read naturally and without marketing filler.
- **FR-037**: Unused reference assets (the unused brand icon and the empty stage archive) MUST be removed rather than committed.
- **FR-038**: The work MUST land as reviewable commits per zone (brand, landing, gate, console) and then one per animated section, each animated section accompanied by 1440 and 390 screenshots for the owner's approval before the next.

### Key Entities

- **Agent**: id, name, status (running, deploying, pending, failed, stopped, or an unknown value shown as received), isAdmin, template, CPU and memory, access (private or public, allowed origins), created and updated times. One record per agent, read by node, row, card, sheet and chat overlay.
- **Agent quota**: total slots and used slots for the current user, from which "N slots free" is derived.
- **Console view preference**: Orbit, Drum or List, and the sheet expanded/collapsed flag; remembered per browser, not per account.
- **Brand variant**: the active brand (orbit by default) and where it came from (query, cookie, deployment config).
- **Gate stage**: idle, filling, connecting, failed; mirrors the sign-in form's state only.
- **Deployment demo step**: ordered steps of the Stage's Workflow tab with a state of done, running or pending.
- **Landing effect**: a named effect with its colour, speed and duration tokens, its trigger (pointer, reveal, loop) and its paused/active state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At each of 1920, 1440, 1024, 768, 390 and 360 px, the landing, the gate and the console match the reference screenshots in layout and content, with no horizontal scroll and no element overlapping text, as judged by the owner on the submitted screenshots.
- **SC-002**: Lighthouse Performance for the landing on this branch is equal to or higher than on main, on the same machine and profile; the largest contentful paint element is the hero image; cumulative layout shift is 0; interaction latency is under 200 ms.
- **SC-003**: The JavaScript added for the animation layer is at most about 30 KB gzip; the hero video is at most 0.7 MB (AV1) and 1.7 MB (H.264) in its largest, 1440 variant (the 1080 variant for ordinary screens is 0.5 / 1.1 MB) and is never requested on viewports under 768 px, with reduced motion, with save-data, or on 2g/3g.
- **SC-004**: With reduced motion enabled, a 30-second recording of the landing, the gate and the console shows zero moving elements apart from the user's own scrolling.
- **SC-005**: Every agent node, the hub, the drum, the view switch, the search, the sheet actions and the gate form are operable with the keyboard alone and announced with name and state by a screen reader; the Orbit and Drum pass an automated accessibility audit with no critical issues.
- **SC-006**: A Stop or Start pressed in the sheet is reflected in the node, the row and the chat overlay in the same frame, and after a forced server refusal all three show the previous status again within one second along with the server's message.
- **SC-007**: The Session ended dialog on this branch has the same markup, classes and layout as on main at 1440 and 390 (the form's console branch is byte-identical in the diff; the screenshots differ only by the console's dark theme).
- **SC-008**: Sign-in and registration with a live API succeed in both languages, including the registration-closed case, with the route showing filling, connecting and failed states as described.
- **SC-009**: Typecheck, build, unit tests and the translation check all pass for the app, and the PR names the commands run; the orbit layout calculation has unit tests covering ordering, ring capacities and label side.
- **SC-010**: A first-time visitor can find and reach Log in or Get started from the landing within 10 seconds on desktop and on a phone, and every header anchor scrolls to its section.

## Assumptions

- **Source of truth for copy**: the brief says Russian copy is written by hand; this repo's rule is that the English file is the source and Russian is generated by the sync and then hand-reviewed. The spec follows the repo rule: English first, generated Russian, then a human pass for tone. The twin console (`admin`) stays English-only and is not touched by this feature.
- **Reference code is the starting point**, not the deliverable: the uncommitted changes in the `skills-redesign` worktree (on the unrelated CLEAN-205 branch) are reviewed, moved to this branch, brought to repo conventions and extended. The screenshots in `Claude outputs/{landing,auth,console,hero}` are the visual reference; the `ranch-landing-*-orbit.png` files are ignored as outdated.
- **Twin consoles**: `agent`, `bridle`, `common`, `setup`, `share` and `user` exist in both consoles. This feature changes the `app` console only; the admin console keeps its own agent, auth and layout surfaces. The plan and PR state this check explicitly.
- **Animation library**: Inspira UI components are copied into the theme's component folder, adapted to the current Tailwind version and recoloured to the landing tokens; no component library is installed as a runtime dependency beyond its documented peers. Components for the previous Tailwind major are not used.
- **CTA effect**: meteors (5 to 8, dim) rather than sparkles. **Marquee placement**: before the CTA, not under the hero, so the hero keeps one attention-drawing effect (the Stage border beam). **Runtime beam**: whichever of the two documented beam components can replace the existing dotted line in place; the plan decides. **Drum spotlight**: not added; the console is a working tool.
- **Default console view**: Orbit for a browser with no stored preference.
- **Free slots** come from the user's existing agent quota as the console already knows it; no new quota data is introduced.
- **Video assets** already exist (7.3 s loop, AV1 and H.264, no audio) and are shipped as static files; no media pipeline is added.
- **Measurement baseline** is the landing on `main` at the commit this branch starts from, measured with the same Lighthouse profile and machine as the "after" run.
- **Approval checkpoints**: each animated section is a separate commit with 1440 and 390 screenshots posted to the ticket, and the owner's OK gates the next section; the zone commits (brand, landing, gate, console) do not wait.
- **Hero horizon at 1440×900** (FR-010): the owner chose to see both fixes (raise the scene vs. reduce the Stage overlap) as screenshots before deciding; the plan carries this as a two-screenshot task gating the landing zone commit.
