# Feature Specification: Rancher & Agent Usage Panel Redesign

**Feature Branch**: `feat/dashboard-agent-costs`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "наша задача - импрувнуть rancher в админке, дропнув лишние метрики, все кроме Rancher usage · 30d. нужно этому блоку установить пагинацию, и переключать между общей стоимостью и вызовами, и стоимостью только этого агента. это относится к каждому агенту, в которого мы заходим — там должен быть блок со стоимостью и всем прочим что сейчас в usage есть. ранчер устанавливаем по центру экрана, блок со стоимостью - справа от него. у остальных агентов, придумай как лучше расположить, ведь там логи еще"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Focused Rancher page: chat centered, usage on the right (Priority: P1)

An administrator opens the Rancher page in the admin panel. Instead of a grid of count tiles (Agents, Templates, Skills, LLMs, Knowledges) competing for attention, they see the Rancher chat placed in the center of the screen with a single usage panel to its right. The count tiles are gone — the navigation they provided is already available in the main menu.

**Why this priority**: This is the explicit core request — declutter the Rancher page so cost/usage is the only metrics surface, and give the chat the primary, central position. Every other story builds on this panel.

**Independent Test**: Open the Rancher page with setup complete. Verify the count tiles are absent, the chat occupies the central area, and the usage panel sits to its right. Delivers immediate value as a cleaner, cost-focused landing page.

**Acceptance Scenarios**:

1. **Given** setup is complete and the Rancher agent is deployed, **When** the administrator opens the Rancher page, **Then** the Rancher chat is displayed in the center of the screen and the usage panel is displayed to its right.
2. **Given** setup is complete, **When** the administrator opens the Rancher page, **Then** no count tiles (Agents, Templates, Skills, LLMs, Knowledges) are displayed anywhere on the page.
3. **Given** setup is NOT complete, **When** the administrator opens the Rancher page, **Then** the existing step-by-step setup wizard is shown unchanged.

---

### User Story 2 - Usage panel with switchable views and pagination (Priority: P1)

The usage panel ("Rancher usage · 30d") becomes interactive. The administrator can switch it between three views: total cost across all agents, call volume, and the cost of only the current agent (on the Rancher page, the Rancher agent itself). Within the panel, the day-by-day breakdown of the last 30 days is paginated so the administrator can step through history instead of seeing only aggregate totals.

**Why this priority**: The view toggle and pagination are the explicitly requested behavioral upgrades to the panel; without them the redesign is only cosmetic.

**Independent Test**: On the Rancher page, switch the panel between the three views and page through the daily breakdown. Each view shows distinct, correct numbers.

**Acceptance Scenarios**:

1. **Given** the usage panel is visible, **When** the administrator selects the "total cost" view, **Then** the panel shows the combined 30-day cost across all agents in the workspace.
2. **Given** the usage panel is visible, **When** the administrator selects the "calls" view, **Then** the panel shows call volume for the same period.
3. **Given** the usage panel is visible, **When** the administrator selects the "this agent" view, **Then** the panel shows cost figures for the current agent only.
4. **Given** the daily breakdown contains more entries than fit on one page, **When** the administrator uses the pagination controls, **Then** the next/previous set of daily entries is shown and the current position is indicated.
5. **Given** the daily breakdown fits on a single page, **When** the panel renders, **Then** pagination controls are hidden or disabled (no dead controls).
6. **Given** the selected view has no data (e.g., the agent has never made a call), **When** the panel renders, **Then** a clear empty state is shown instead of zeros without context.

---

### User Story 3 - The same usage panel on every agent page (Priority: P2)

When the administrator opens any individual agent, the same usage panel is present: cost plus everything the current usage block reports — today's model, input/output tokens and calls, and the 30-day totals (cost, top model, input tokens, output tokens, call count) — with the same view toggle and pagination. Because agent pages also surface live logs next to the chat, the panel is arranged so that chat remains primary and logs remain accessible: the chat stays centered, and the right-hand side area holds logs and the usage panel stacked together, each collapsible so neither permanently crowds out the other.

**Why this priority**: Extends the same capability to every agent, but depends on the panel built in Stories 1–2. The Rancher page alone already delivers value.

**Independent Test**: Open any non-Rancher agent. Verify the usage panel appears with full field parity to the Rancher page panel, scoped to that agent, and that logs and chat both remain usable alongside it.

**Acceptance Scenarios**:

1. **Given** any agent's page, **When** the administrator opens it, **Then** a usage panel is available showing today's snapshot (model, input/output tokens, calls) and 30-day totals (cost, top model, input tokens, output tokens, calls).
2. **Given** an agent's page, **When** the administrator switches the panel to "this agent" view, **Then** figures reflect only that agent.
3. **Given** an agent's page with the logs panel open, **When** the usage panel is shown, **Then** the chat remains the central, primary surface and logs remain reachable (both can be shown, collapsed, or expanded without navigating away).
4. **Given** an agent that has never reported usage, **When** its page is opened, **Then** the panel shows an explicit "no usage reported yet" state.

---

### Edge Cases

- **Setup incomplete on the Rancher page**: the wizard keeps precedence; the usage panel appears only once the Rancher agent exists (there is no agent to report usage before that).
- **Rancher admin agent missing/deleted**: the "this agent" view has no subject; the panel falls back to the total view with an explanatory empty state for the agent-scoped view.
- **Partial data in the total view**: agents that never reported usage contribute zero and must not break the aggregate.
- **Narrow screens**: when there is no horizontal room for a right-hand panel, the usage panel stacks below the chat (Rancher page) or below the logs area (agent pages) rather than truncating.
- **Day boundary**: "today" figures and the 30-day window shift at day rollover; a refresh reflects the new window without stale mixed periods.
- **Very large numbers**: token counts in the millions/billions and sub-cent costs render legibly (formatted, not raw).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Rancher page MUST NOT display the count tiles (Agents, Templates, Skills, LLMs, Knowledges); the usage panel is the only metrics block on the page.
- **FR-002**: On the Rancher page, the Rancher chat MUST occupy the central area of the screen with the usage panel positioned to its right.
- **FR-003**: The usage panel MUST offer three switchable views: (a) total cost across all agents, (b) call volume, (c) cost of the current agent only. The active view MUST be visually indicated.
- **FR-004**: The usage panel MUST include a paginated day-by-day breakdown of the last 30 days; pagination controls MUST indicate position and MUST NOT appear when a single page suffices.
- **FR-005**: The usage panel MUST present all data the current usage block reports: today's snapshot (model, input tokens, output tokens, calls) and 30-day totals (cost, top model, input tokens, output tokens, call count).
- **FR-006**: Every individual agent page MUST provide the same usage panel with identical capabilities (views, pagination, fields), where "this agent" is scoped to the agent being viewed.
- **FR-007**: On individual agent pages, the usage panel MUST coexist with chat and logs: chat remains the primary central surface, and logs remain reachable while the usage panel is visible (recommended arrangement: logs and usage stacked in the side area, each collapsible).
- **FR-008**: The panel MUST show a clear empty state when no usage has been reported for the selected view/scope.
- **FR-009**: The Rancher setup wizard flow MUST remain unchanged for incomplete setups; the redesigned layout applies to the post-setup state.
- **FR-010**: The existing page-level refresh action MUST also refresh the usage panel's data in whichever view is active.

### Key Entities

- **Usage daily entry**: one day of one agent's activity — date, model, input tokens, output tokens, call count, cost.
- **Usage summary**: an agent's 30-day totals (cost, input/output tokens, calls), top model, and today's snapshot.
- **Aggregate usage**: the combined 30-day cost and call volume across all agents in the workspace (new concept — today only per-agent figures exist).
- **Agent**: the subject of the "this agent" view; on the Rancher page this is the Rancher admin agent, on an agent page it is that agent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator landing on the Rancher page can state the workspace's 30-day spend within 5 seconds, without navigating anywhere else.
- **SC-002**: An administrator can find any single agent's 30-day cost in at most 2 navigation steps from anywhere in the admin panel.
- **SC-003**: The usage panel exposes 100% of the fields available today (today's model/tokens/calls + 30-day cost/top model/tokens/calls) on both the Rancher page and every agent page — zero field regressions.
- **SC-004**: All 30 days of the breakdown are reachable through pagination — no day of the window is inaccessible.
- **SC-005**: On the Rancher page, the count tiles are gone and the number of distinct metric blocks is exactly one.
- **SC-006**: On agent pages, chat and logs remain simultaneously usable after the panel is added — neither is permanently hidden or displaced off-screen at standard desktop sizes.

## Assumptions

- **"Total cost" means all agents combined**: the request contrasts "общей стоимостью" (total cost) with "стоимостью только этого агента" (cost of only this agent), so the total view aggregates cost across all agents in the workspace over the same 30-day window. This aggregate does not exist today and is a new capability.
- **Pagination applies to the daily breakdown**: the panel currently shows only aggregate totals; the paginated content is the day-by-day usage history for the 30-day window (the only list-shaped data in scope).
- **The 30-day window stays the reporting period**; no custom date ranges are in scope.
- **Removing the count tiles loses no unique capability**: Agents, Templates, Skills, LLMs and Knowledges are all reachable from the main navigation.
- **Agent-page arrangement is delegated to design**: the user explicitly asked for a proposal ("придумай как лучше"). The recommended arrangement — chat centered, side area holding logs and the usage panel stacked with individual collapse controls — is a default, not a hard constraint; refinement during design is acceptable as long as FR-007 holds.
- **The setup wizard and chat behavior are otherwise untouched**; this feature changes layout and the usage panel only.
- **Access control is unchanged**: whoever can open the admin Rancher/agent pages today can see the usage panel; no new roles or permissions.
