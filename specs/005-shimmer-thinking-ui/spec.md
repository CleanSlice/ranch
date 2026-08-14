# Feature Specification: Agent Thinking Shimmer & Extended Thinking Display

**Feature Branch**: `feat/CLEAN-10-shimmer-thinking`

**Created**: 2026-08-14

**Status**: Draft

**Jira**: [CLEAN-10](https://dreamvention.atlassian.net/browse/CLEAN-10) — "Bridle UI: shimmer-анимация текста во время генерации ответа" (epic CLEAN-27 «004 — Bridle: SDK и админка»)

**Input**: User description: "Наша таска - CLEAN-10. Нужно для нее создать ветку и работать на ней. Приложил визуальный референс (Atlassian Rovo «Rovo is thinking…»), хочу добиться максимально похожего стиля при раздумии агента."

**Visual reference**: Atlassian Rovo chat — a status line "Rovo is thinking…" whose text carries a left-to-right shimmer (light sweep) animation, followed by a vertical timeline of named work steps (e.g. "Locating Project Users") with expand/collapse chevrons; expanding a step reveals a paragraph of the agent's reasoning connected by a thin vertical rule. The whole thinking block itself can be collapsed with a chevron in its top-right corner.

## Problem

While a Bridle agent prepares an answer, the chat visitor sees only three bouncing dots — and the dots disappear the instant the first text arrives. Worse, when the agent works with tools between text outputs (searching, reading files, calling services), the visitor sees **nothing at all** for many seconds: no indication that work is happening, no sense of progress. This reads as a frozen chat, erodes trust during long generations, and looks dated next to contemporary AI assistants (Rovo, ChatGPT, Claude) that show a live, styled "thinking" state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shimmering "thinking" status while the agent works (Priority: P1)

A website visitor sends a message in the embedded Bridle chat. From the moment the agent starts working until the first words of the answer appear, the visitor sees a status line — "«Agent name» is thinking…" — rendered with a shimmering (light-sweep) text animation in the style of the visual reference. The status replaces today's three bouncing dots and stays visible through tool-use phases that previously showed nothing.

**Why this priority**: This is the core of CLEAN-10 and delivers value on its own — it removes the "dead air" problem for every response, regardless of whether the agent publishes any extended-thinking detail. It is the visible baseline all other stories build on.

**Independent Test**: Open any page with the embedded chat, send a message that takes a few seconds to answer, and observe: the shimmer status appears promptly, persists through the whole generation (including silent tool phases), and disappears when answer text starts arriving.

**Acceptance Scenarios**:

1. **Given** an embedded chat with an idle agent, **When** the visitor sends a message, **Then** a shimmering "«Agent» is thinking…" status line appears in the conversation within one second of the agent acknowledging the message.
2. **Given** the thinking status is visible, **When** the first fragment of the answer arrives, **Then** the shimmer status is replaced by the growing answer text without visual jumps.
3. **Given** the agent spends time on tool work that produces no visible text, **When** the visitor watches the chat, **Then** the thinking indication remains animated the entire time (no period with zero activity indication).
4. **Given** the visitor's device/browser requests reduced motion, **When** the thinking state shows, **Then** the status text is displayed without the shimmer animation but still clearly indicates in-progress work.

---

### User Story 2 - Extended thinking: named steps with expandable detail (Priority: P2)

While the agent works, the thinking block grows a vertical timeline of named steps in the reference style (e.g. "Searching the knowledge base", "Reading order history"). Each step has an expand/collapse control; expanding reveals the agent's reasoning text for that step, connected by a thin vertical rule. Steps appear live as the agent progresses. The whole thinking block can be collapsed via a chevron, and after the answer is complete the block collapses into a single summary row that the visitor can re-expand to review what the agent did.

**Why this priority**: This is the "+расширенное мышление" part of the task and the essence of the visual reference. It turns waiting time into transparency and trust, but it depends on agents actually publishing thinking content, so it layers on top of Story 1 rather than replacing it.

**Independent Test**: Chat with an agent configured to publish thinking steps; verify steps appear live with correct labels, expand to show reasoning text, and the completed block collapses to a re-expandable summary row.

**Acceptance Scenarios**:

1. **Given** the agent publishes a thinking step while working, **When** the step is received, **Then** it appears in the thinking timeline with its label, in arrival order, without disturbing the visitor's scroll position or requiring a refresh.
2. **Given** a step with reasoning detail, **When** the visitor activates its expand control, **Then** the reasoning text is revealed beneath the label with the reference's timeline styling; activating again collapses it.
3. **Given** steps are arriving, **When** the visitor does nothing, **Then** steps stay collapsed by default (labels only) and the active step is visually distinguishable from completed ones.
4. **Given** the answer has finished, **When** the visitor looks at the message, **Then** the thinking block is collapsed into one summary row above the answer, and re-expanding it shows all steps and details as they were.
5. **Given** an agent that publishes no thinking steps, **When** it answers, **Then** the visitor simply sees the Story 1 shimmer status — no empty timeline, no errors.

---

### User Story 3 - Same thinking experience in the team's agent preview chat (Priority: P3)

An operator testing an agent from the platform's admin area sees the same shimmer status and thinking timeline in the built-in agent chat preview, so the team can develop, verify and demo the behavior without embedding the widget on an external page.

**Why this priority**: Parity for the surface the team uses daily. Valuable for verification and demos, but the end-visitor widget is the product surface the task targets, so this follows it.

**Independent Test**: Open an agent's chat preview in the admin area, send a message, and observe the same thinking behavior as in the embedded widget.

**Acceptance Scenarios**:

1. **Given** an agent open in the admin chat preview, **When** the operator sends a message, **Then** the shimmer status and (if published) thinking steps render with the same behavior as in the embedded widget, adapted to the admin area's look.

---

### Edge Cases

- Agent answers almost instantly (&lt; ~1s): the thinking status may appear only briefly or not at all — the transition must not flicker or leave artifacts.
- Connection drops mid-thinking: the thinking block must not spin forever; when the conversation reconnects or times out, the block resolves to a non-animated state consistent with the chat's existing error/timeout behavior.
- Very long reasoning text in a step: detail area stays readable (wraps, does not break the chat layout, scrolls with the conversation).
- Many steps (10+): the timeline remains scrollable and does not push the composer off screen; the chat keeps auto-following the newest activity only if the visitor hasn't scrolled up.
- Visitor sends a new message while the previous answer is still thinking: each response's thinking block stays attached to its own answer.
- Older/unchanged agents that know nothing about thinking publishing: behavior degrades gracefully to Story 1's status line (or current behavior at minimum), with no errors.
- Dark and light widget themes, custom brand colors: shimmer and timeline must remain visible and on-brand in both, using the widget's existing theming.
- Reduced-motion preference: all decorative animation (shimmer, sweeps) is disabled; state is still communicated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat MUST show an animated "thinking" status line with a shimmering text effect from when the agent acknowledges a visitor's message until the first answer text arrives, replacing the current three-dot indicator.
- **FR-002**: The thinking indication MUST remain visible and animated during phases where the agent works without producing visible text (e.g. tool use), so the visitor never sees a silent gap during generation.
- **FR-003**: The status line MUST identify the agent by its configured display name (e.g. "«Agent» is thinking…") and match the visual reference's style: shimmer sweep over the status text and an expand/collapse affordance for the block.
- **FR-004**: When agents publish named thinking steps, the chat MUST render them live as a vertical timeline beneath the status line, in arrival order, each with a label; steps arrive collapsed by default.
- **FR-005**: Each thinking step with detail MUST be individually expandable and collapsible by the visitor, revealing the step's reasoning text in the reference's timeline styling.
- **FR-006**: The visitor MUST be able to collapse and re-expand the entire thinking block; after the answer completes, the block MUST auto-collapse into a single summary row that remains re-expandable.
- **FR-007**: The active (in-progress) step MUST be visually distinguishable from completed steps.
- **FR-008**: The thinking display MUST render only content the agent explicitly publishes for the visitor; internal data not intended for visitors (system prompts, raw tool payloads, diagnostics) MUST NOT appear in it.
- **FR-009**: The feature MUST degrade gracefully: agents that publish no thinking content produce the Story 1 status line only, and chats with pre-feature agents keep working without errors.
- **FR-010**: The thinking UI MUST adopt the widget's existing theming (light/dark modes, brand color variables) without requiring per-site custom styling.
- **FR-011**: The thinking UI MUST respect the visitor's reduced-motion preference by disabling the shimmer/animation while still communicating the in-progress state, and the thinking content MUST be accessible to assistive technologies (steps announced as expandable regions).
- **FR-012**: The same thinking experience MUST be available in the platform's admin agent chat preview (Story 3), visually adapted to that surface.

### Key Entities

- **Thinking status**: the transient "agent is working" state of a pending answer — carries the agent's display name and whether generation is still in progress.
- **Thinking step**: a unit of published agent work — has a short label, optional reasoning detail text, an order, and a state (active or completed); belongs to exactly one pending/completed answer.
- **Assistant answer**: the message the thinking relates to — after completion it retains its (collapsed) thinking block for review.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of agent responses that take longer than one second, the visitor sees an animated thinking indication for the entire wait — there is no moment between sending a message and the first answer text with zero activity indication (today's tool-use phases show nothing).
- **SC-002**: In a side-by-side comparison with the supplied visual reference, the task owner signs off the thinking state as matching the reference style (shimmer status line, step timeline, expand/collapse behavior) before release.
- **SC-003**: The thinking UI renders correctly (readable, on-brand, no visual defects) in both light and dark themes and with the reduced-motion preference enabled, verified on the supported browsers.
- **SC-004**: Conversations with agents that do not publish thinking content behave exactly as specified for Story 1 — zero errors or regressions in existing chat flows.
- **SC-005**: A visitor can reveal any thinking step's detail with a single click/tap, and re-open the collapsed thinking block of a finished answer with a single click/tap.

## Assumptions

- The primary surface is the embeddable Bridle chat widget (the product surface visitors see); the admin agent chat preview follows for parity (P3). Other platform chat surfaces are out of scope for this feature.
- The Rovo screenshot is a style reference, not a pixel-exact target: we match the pattern (shimmer status text, timeline of expandable steps, collapsible block) using Bridle's own colors, fonts and iconography — no Atlassian branding is copied.
- Agents decide what thinking content to publish; the chat renders what it receives verbatim. Producing well-formed step labels/details is the agent side's responsibility, and the visitor-facing stream carries only content intended for visitors (FR-008).
- Extended thinking requires agent-side publishing that does not exist yet; until an agent adopts it, visitors get the Story 1 experience. Story 1 must not depend on any agent-side change.
- Step labels and reasoning text appear in whatever language the agent publishes them (typically the conversation language); the status line's fixed text follows the widget's existing localization approach.
- Standard web widget expectations apply for performance: the animation must not degrade chat responsiveness on typical devices.
