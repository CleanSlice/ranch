# Feature Specification: Agent must not look "running" when its runtime is not connected to the bridle hub

**Feature Branch**: `feat/CLEAN-55-agent-bridle-connectivity`

**Created**: 2026-09-01

**Status**: Draft

**Jira**: [CLEAN-55](https://dreamvention.atlassian.net/browse/CLEAN-55)

**Input**: User description: "Prod incident: an agent pod was Running+Ready for 19 hours, DB status `running`, admin showed green — while chat reported `agent_status {connected:false}` and 'Agent is not connected'. Cause: `integrations/bridle_url` / `bridle_api_key` were unset, the pod started without BRIDLE_* env and never registered on the bridle hub. Nothing surfaced this; diagnosis took hours. Make this diagnosable in seconds from the admin: expose hub connectivity in agent status, write a diagnostic status reason after a grace window, warn at deploy time when the settings are empty, and give the admin UI (status indicator + chat) actionable troubleshooting."

## Clarifications

### Session 2026-09-01

- Q: How should "pod healthy but runtime not connected to the hub" be represented — a dedicated status value or a derived display on top of `running`? → A: Dedicated status value (working name `unreachable`): the sweep demotes `running` → `unreachable` after the grace window; runtime registration promotes it back to `running`. The new status counts as live for capacity (the pod still occupies resources).
- Q: Should a deploy with empty `bridle_url`/`bridle_api_key` be blocked with a clear error, or proceed with a warning? → A: Proceed with warn-log + immediate diagnostic status reason (no hard block), so agents can still be provisioned before integrations are configured; the `unreachable` status and the reason make the consequence visible.
- Q: Where should the troubleshooting hint send the operator to fix the integration settings? → A: Link directly to the admin bridle settings page at `/settings/bridle`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator sees "running but offline" at a glance (Priority: P1)

An operator opens the admin agent list (or an agent's detail view) and can immediately tell the difference between an agent that is genuinely online (pod healthy **and** runtime connected to the bridle hub) and an agent whose pod is healthy but whose runtime never reached the hub. For the latter, a distinct visual state (different color/badge) is shown, and a tooltip explains the likely cause and the fix (check bridle integration settings, then restart the agent).

**Why this priority**: This is the exact gap that cost hours of diagnosis in the production incident. Surfacing hub connectivity in the primary status views is the core value of the feature; everything else refines it.

**Independent Test**: Deploy an agent with bridle integration settings empty. Verify the admin agent list/status indicator shows a "running, not connected" state with a diagnostic reason after the grace window, without opening chat or inspecting the cluster.

**Acceptance Scenarios**:

1. **Given** an agent whose pod is healthy and whose runtime is connected to the hub, **When** the operator views agent status, **Then** the agent shows the normal "running" state and its status payload reports hub connectivity as true.
2. **Given** an agent whose pod is healthy but whose runtime has not connected to the hub for longer than the grace window, **When** the operator views agent status, **Then** the agent shows the dedicated "unreachable" status (not "running") and its status reason explains: pod is running but the runtime never connected to the bridle hub — check bridle integration settings, then restart the agent.
3. **Given** an agent in the "unreachable" status, **When** its runtime registers on the hub, **Then** the diagnostic status reason is cleared and the agent returns to "running".
4. **Given** an operator watching the live status stream, **When** hub connectivity changes, **Then** the streamed status reflects the new connectivity without a page reload.

---

### User Story 2 - Misconfiguration is flagged at deploy time (Priority: P2)

When an operator deploys/starts an agent while the bridle integration settings (`bridle_url` / `bridle_api_key`) are empty, the system immediately records a diagnostic status reason on the agent naming the missing setting and its consequence ("the agent pod will start without credentials and can never come online"), and logs a warning. The deploy itself proceeds.

**Why this priority**: Catches the incident's root cause at the earliest possible moment — before the grace window even matters — turning a silent misconfiguration into an explicit message at the moment it is introduced.

**Independent Test**: Clear a bridle integration setting, deploy an agent, and verify the agent's status reason names the missing setting immediately after deploy, and a warning appears in the service logs.

**Acceptance Scenarios**:

1. **Given** empty `bridle_url` or `bridle_api_key` integration settings, **When** an agent deploy is initiated, **Then** the deploy proceeds, a warning is logged, and the agent's status reason immediately names the missing setting and states that the agent cannot come online until it is set and the agent is restarted.
2. **Given** both bridle integration settings populated, **When** an agent deploy is initiated, **Then** no such warning or status reason is produced.

---

### User Story 3 - Chat shows actionable troubleshooting instead of bare "offline" (Priority: P3)

An operator opens an agent's chat in the admin. The agent's status says "running" but the chat socket reports the agent as not connected. Instead of only "Agent is not connected", the chat shows a troubleshooting hint: inspect the agent's environment preview (where missing BRIDLE_* variables are visible), check the bridle integration settings, and note that a restart of the agent is required after fixing them.

**Why this priority**: The chat is where the incident was first noticed. The hint closes the loop for operators who arrive at the problem from the chat side, but the P1 status surfacing already makes the state discoverable.

**Independent Test**: With an agent in the "running but not connected" state, open its chat in the admin and verify the troubleshooting hint (env preview, integration settings, restart note) is displayed instead of a bare offline message.

**Acceptance Scenarios**:

1. **Given** an agent whose status is "running" or "unreachable" while its chat socket reports not connected, **When** the operator opens the chat, **Then** a hint is shown pointing to the agent env preview, the bridle integration settings (direct link to `/settings/bridle`), and the need to restart the agent after fixing the settings.
2. **Given** an agent that is genuinely connected, **When** the operator opens the chat, **Then** no troubleshooting hint is shown.

---

### Edge Cases

- **API service restart**: hub connectivity is in-memory in the API process; right after an API restart every agent briefly looks disconnected. The grace window MUST prevent agents from being flagged during this period.
- **Runtime reconnect flaps**: brief disconnect/reconnect cycles (runtime restarts, network blips) MUST NOT flip the visual state or write/clear the reason repeatedly within the grace window.
- **Stopped agents**: agents intentionally stopped MUST NOT be flagged as "not connected" — existing stopped semantics stay untouched.
- **Deploy in progress**: agents inside the existing deploy grace period MUST NOT be flagged; existing deploy-tracker stale protection stays untouched.
- **Reason lifecycle**: a diagnostic reason set by the sweep or at deploy time MUST be cleared when the runtime registers on the hub; it must not linger and mislead.
- **Failed pods**: existing failure handling (crash loops, missing pods → failed + reason) keeps precedence; the new "not connected" diagnostics only apply to healthy-pod cases.
- **Public status endpoint**: the agent status endpoint is public; the new connectivity flag and reasons MUST NOT introduce secret values (URLs with credentials, key material) into it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Agent status snapshots and the live status stream MUST include a boolean hub-connectivity indicator per agent, sourced from the live in-process hub connection registry.
- **FR-002**: The periodic status sweep MUST detect the state "pod healthy + status running + runtime not connected to the hub for longer than a grace window" and record a human-readable diagnostic status reason that names the bridle integration settings and states that a restart is required after fixing them.
- **FR-003**: The grace window MUST cover API restarts, agent deploys in progress, and short reconnect flaps so that none of these produce a false "not connected" flag.
- **FR-004**: When the sweep confirms "pod healthy + runtime not connected past the grace window", the agent's status MUST change to a dedicated status value (working name `unreachable`) together with the diagnostic reason — the agent list and any other status consumer must not present it as plain "running". The new status MUST count as live/occupying capacity, since the pod still consumes resources.
- **FR-005**: When a runtime registers on the hub, the agent MUST return to `running` and any diagnostic reason about missing hub connectivity MUST be cleared.
- **FR-006**: Existing semantics MUST be preserved: stopped agents, deploy-grace/stale protection, and failed-pod handling behave exactly as before.
- **FR-007**: The deploy path MUST detect empty bridle integration settings (`bridle_url`, `bridle_api_key`), log a warning, and immediately record a status reason on the agent naming the missing setting and its consequence. The deploy itself MUST NOT be blocked.
- **FR-008**: The admin agent status indicator (list and detail) MUST render the `unreachable` status as its own visual state (distinct color/badge, not the "running" green) and expose the status reason (e.g., tooltip).
- **FR-009**: The admin chat MUST, when the chat socket reports not connected while the agent status is `running` (within grace) or `unreachable`, display a troubleshooting hint referencing the agent env preview, the bridle integration settings (linking directly to `/settings/bridle`), and the required agent restart — instead of only a bare offline message.
- **FR-010**: Hub connectivity MUST NOT be persisted to the database; it is read live from the API process each time status is produced.
- **FR-011**: The public agent status endpoint MUST NOT gain any secret values through this feature.
- **FR-012**: The new sweep behavior MUST be covered by automated unit tests: flagging after grace, clearing on registration, and non-interference with stopped/deploy-grace paths.

### Key Entities

- **Agent status**: per-agent operational state exposed to the admin — status value, human-readable status reason, pod state, and (new) hub-connectivity flag.
- **Hub connection registry**: live, in-process record of which agent runtimes currently hold a connection to the bridle hub; the source of truth for "actually reachable".
- **Bridle integration settings**: operator-managed settings (`bridle_url`, `bridle_api_key`) baked into the agent pod at deploy time; empty values silently produce a pod that can never connect and require a restart after correction.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can identify a "running but not connected" agent from the admin agent list within 90 seconds of the condition arising (grace window + one sweep cycle; fresh deploys additionally respect the deploy grace period), versus hours in the original incident.
- **SC-002**: When an agent is deployed with empty bridle settings, the diagnostic reason is visible on the agent immediately after the deploy starts — before the pod is even scheduled.
- **SC-003**: Zero false "not connected" flags during normal API restarts and agent deploys (verified over a restart + deploy cycle).
- **SC-004**: After the runtime successfully connects, the diagnostic state clears within one sweep interval without operator action.
- **SC-005**: In a re-run of the incident scenario (empty bridle settings, healthy pod), an operator following only the on-screen hints reaches the root cause (missing settings, restart needed) without consulting logs or the cluster.

## Assumptions

- **Dedicated `unreachable` status (clarified 2026-09-01)**: the status must be truthful for every consumer (agent list, public status endpoint, DB), not only inside an open chat window. The cost — the new value propagates through DTOs, admin UI mappings, and capacity counting (`LIVE_DB_STATUSES`, where it MUST count as live) — is accepted. The grace window is what keeps this safe across API restarts and reconnect flaps.
- **Deploy with empty bridle settings warns but does not block (confirmed 2026-09-01)**: blocking would break the flow where an agent is provisioned before integrations are configured. Warning + immediate status reason makes the misconfiguration visible from second zero, and the `unreachable` status takes over once the grace window expires — the misleading green "running" of the incident can no longer occur.
- The existing deploy-grace window is a suitable baseline for the "not connected" grace; if reused, it must also absorb API-process restarts (connectivity registry starts empty). A dedicated timeout is acceptable if the deploy-grace cannot cover that case cleanly.
- The existing status-reason mechanism and its admin display are reused; no new persistence or transport is introduced for reasons.
- The agent env preview endpoint referenced by the chat hint already exists and shows the absence of BRIDLE_* variables.
- Frontend API clients are regenerated from the updated backend contract as part of the normal build flow.
