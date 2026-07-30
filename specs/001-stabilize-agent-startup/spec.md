# Feature Specification: Stabilize Agent Startup Status & Logs

**Feature Branch**: `001-stabilize-agent-startup`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Стабилизировать запуск агента: при старте/рестарте статус ведёт себя обманчиво — после stop → start агент сначала показывает status: failed и только через ~30 секунд обновляется до running; для первого запуска и рестарта используется один статус deploying, из-за чего складывается впечатление, что агент обновляется, а не запускается впервые; во время рестарта в панели логов какое-то время отображается сырая ошибка инфраструктуры (log fetch failed: HTTP 400, container is waiting to start: ContainerCreating); при успешном первом запуске в логах видна красная ошибка (подключение к серверу инструментов: connect failed, 404), хотя всё работает."

## Clarifications

### Session 2026-07-30

- Q: Где должна храниться «правда» о том, что агент запускается впервые, а не рестартует, чтобы интерфейс различал их даже после перезагрузки страницы? → A: Вариант B — существующий набор статусов не меняется; сервер дополнительно сообщает контекст запуска (первый запуск / рестарт / обновление) отдельным признаком. Дополнительно зафиксировано: причина транзитного `failed` после stop → start должна быть диагностирована и устранена в источнике, а не скрыта на стороне интерфейса.
- Q: По какому критерию запуск агента считается «окончательно неудавшимся», после чего можно показывать статус ошибки? → A: Вариант B — явные сигналы среды выполнения (циклические падения, невозможность создать/запустить среду) **плюс** страховочный таймаут 5 минут, после которого запуск помечается как проблемный с понятным объяснением.
- Q: Что делать с ошибкой подключения к серверу инструментов («connect failed … 404») при первом запуске — чинить причину или только подачу в логах? → A: Вариант A — диагностировать и устранить причину в рамках этой фичи (инструменты реально не подключаются: «total 0 tools registered»); правило FR-008 о подаче некритичных ошибок при этом сохраняется.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Status never lies during start/restart (Priority: P1)

An operator stops an agent and starts it again (or restarts a running agent). From the moment the action is confirmed until the agent is ready, the displayed status continuously shows that a startup is in progress. It never flashes a failure state while the agent is actually coming up, and it switches to "running" promptly once the agent is ready. Today the agent shows `failed` for roughly half a minute after a start before flipping to `running`, which makes a healthy launch look broken.

**Why this priority**: A status that reads "failed" during every normal start destroys trust in the status display entirely — operators can no longer tell real failures from healthy launches. This is the core confusion the feature exists to remove.

**Independent Test**: Can be fully tested by performing stop → start and restart cycles on a test agent while watching the status display, and confirming no failure state ever appears during a launch that ends in "running".

**Acceptance Scenarios**:

1. **Given** a stopped agent, **When** the operator starts it, **Then** the status shows a startup-in-progress state continuously until the agent is ready, and at no point shows a failure state.
2. **Given** an agent whose startup has completed, **When** the operator is viewing the agent, **Then** the displayed status changes to "running" without any manual refresh within 10 seconds of the agent becoming ready.
3. **Given** an agent that is starting, **When** the operator reloads the page mid-startup, **Then** the displayed status still shows startup-in-progress (the truthful state does not depend on staying on the page).
4. **Given** an agent whose startup genuinely fails (e.g., it can never become ready), **When** the failure is definitive, **Then** the status shows a failure state with a human-readable reason — real failures must still be visible.

---

### User Story 2 - First start, restart, and update are distinguishable (Priority: P2)

An operator deploying a brand-new agent sees messaging that clearly says the agent is being started for the first time. An operator restarting or updating an existing agent sees messaging that clearly says it is restarting/updating. Today both flows show the single status "deploying", which makes a first launch feel like an update of something that already existed.

**Why this priority**: Removes the "it seems to be updating, not starting for the first time" confusion. Less critical than the false-failure problem, but essential for operators to understand what the system is actually doing.

**Independent Test**: Deploy a never-before-run agent and separately restart an existing one; verify the two flows present visibly different startup messaging.

**Acceptance Scenarios**:

1. **Given** a newly created agent that has never run, **When** it is deployed, **Then** the status/messaging communicates a first-time start.
2. **Given** an existing agent that is running or stopped, **When** the operator restarts or starts it, **Then** the status/messaging communicates a restart — not a first-time launch and not a failure.

---

### User Story 3 - Log panel stays friendly while the agent comes up (Priority: P2)

An operator watching the log panel during a start or restart sees a clear, human-readable message that the agent is coming up and logs will resume shortly. Once the agent's runtime can serve logs, streaming resumes automatically. Today the panel briefly renders a raw infrastructure error dump (HTTP status code, JSON body, response headers) while the runtime is still being created.

**Why this priority**: The raw error blob is the most alarming single artifact of the current experience — it looks like a crash report during every routine restart. It is presentation-only and independently fixable.

**Independent Test**: Restart an agent with the log panel open and confirm that at no point is raw protocol/infrastructure error text rendered, and that logs resume without a manual reload.

**Acceptance Scenarios**:

1. **Given** an agent that is restarting and whose runtime cannot yet serve logs, **When** the log panel refreshes, **Then** the operator sees a friendly waiting message (not a raw error response) for as long as logs are unavailable.
2. **Given** the agent's runtime has become able to serve logs, **When** the next automatic refresh occurs, **Then** log streaming resumes without any manual action.

---

### User Story 4 - A successful start shows no misleading errors (Priority: P3)

An operator watching the startup logs of an agent that launches successfully sees no error-level entries that suggest the launch is broken. If an optional integration (such as a tool-server connection) fails while the agent itself starts fine, the message clearly states what is affected and that the agent is otherwise operational — or the underlying issue is fixed so the error does not occur. Today a successful first launch shows a red "connect failed" error even though the agent works.

**Why this priority**: Contributes to the same "healthy launch looks broken" confusion, but the agent is functional, so it is less urgent than the status and log-panel fixes.

**Independent Test**: Perform a fresh first-time launch of an agent and review every error-level entry in the visible startup log; each one must correspond to a real, user-actionable problem.

**Acceptance Scenarios**:

1. **Given** an agent that starts successfully, **When** the operator reviews the visible startup log, **Then** no error-level entry implies the startup failed.
2. **Given** an optional integration fails to connect while the agent itself starts fine, **When** this is shown in the log, **Then** the message identifies what is degraded (e.g., which tools are unavailable) and does not present the launch itself as failed.

---

### Edge Cases

- What happens when the operator stops an agent and immediately starts it again? No stale terminal status (previous "failed" or "stopped") may leak into the new launch's display.
- What happens when a restart is requested while a deploy is already in progress? The display must remain in a single coherent startup state, not oscillate between states.
- How does the system distinguish a slow-but-healthy startup from a genuine failure? Transient not-ready conditions during startup must not be reported as failure; only a definitive failure (agent can never become ready) may be.
- What happens when an agent hangs in startup indefinitely? After the 5-minute safety timeout the operator sees that startup exceeded the expected time (with explanation) instead of an eternal "starting" state.
- What happens when the log panel is open across the restart boundary? The panel must transition from old-run logs to the waiting message to new-run logs without showing raw errors.
- What happens when the operator opens the agent page for the first time mid-startup (no prior in-page context)? The correct startup state must still be shown.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST report a distinct startup-in-progress state from the moment a start or restart is requested until the agent is either confirmed ready or has definitively failed.
- **FR-002**: The system MUST NOT display a failure status for an agent whose startup is still in progress; a failure status may only be shown once the startup has definitively failed. A startup counts as definitively failed only when (a) the runtime emits an explicit failure signal (e.g., repeated crashes, inability to create or schedule the agent's runtime), or (b) a safety timeout of 5 minutes elapses without the agent becoming ready — in which case the display states that startup exceeded the expected time.
- **FR-003**: The system MUST visibly distinguish a first-time start of a never-run agent from a restart/update of an existing agent. The distinction MUST come from a server-provided launch context (first start / restart / update) supplied alongside the existing status vocabulary, which remains unchanged — so it survives page reloads and is not inferred client-side.
- **FR-004**: The displayed status MUST update to "running" without user action within 10 seconds of the agent becoming ready.
- **FR-005**: The displayed lifecycle state MUST be equally correct whether the operator stayed on the page, reloaded it, or opened it mid-startup.
- **FR-006**: While the agent's runtime is not yet able to serve logs, the log view MUST show a human-readable waiting message; raw infrastructure or protocol error responses MUST never be rendered to the operator.
- **FR-007**: The log view MUST resume streaming automatically once logs become available, without a manual reload.
- **FR-008**: A startup that completes successfully MUST NOT display error-level messages implying the launch failed; failures of optional integrations MUST be presented as clearly non-fatal and MUST name what is affected.
- **FR-009**: When a startup genuinely fails, the system MUST display a failure state together with a human-readable reason.
- **FR-010**: After an agent is stopped, a subsequent start MUST transition directly from the stopped state to the startup-in-progress state without transiently displaying stale states from earlier runs.
- **FR-011**: The root cause of the transient "failed" status observed after stop → start MUST be diagnosed and eliminated at its source; the fix MUST NOT merely hide or re-label the status in the user interface.
- **FR-012**: The root cause of the tool-server connection failure observed on first launch MUST be diagnosed and fixed within this feature, so that a successful launch registers its tools without any error entry. The FR-008 presentation rule still applies to any genuinely optional integration failure that remains possible.

### Key Entities

- **Agent**: A deployable assistant an operator manages; has a user-visible lifecycle status and a startup history (has it ever run before).
- **Lifecycle status**: The user-visible state of an agent. The existing status vocabulary (deploying, running, stopped, failed) is retained; a separate server-provided **launch context** (first start / restart / update) accompanies the in-progress state so the UI can tell the flows apart. Exactly one status applies at any moment, and the sequence of displayed states during any operation must be plausible (no failure during a healthy launch).
- **Startup log stream**: The chronological log output an operator sees while and after an agent comes up, including its availability gaps during startup.
- **Lifecycle action**: An operator-initiated start, restart, or stop that drives status transitions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across 20 consecutive successful start or restart cycles, a failure status is displayed 0 times.
- **SC-002**: In at least 95% of successful starts, the displayed status reads "running" within 10 seconds of the agent becoming ready, with no manual refresh.
- **SC-003**: An operator can tell from the status display alone — without opening logs — whether an agent is starting for the first time or restarting.
- **SC-004**: Across 20 consecutive restart cycles with the log panel open, raw infrastructure/protocol error text is rendered 0 times.
- **SC-005**: A successful first-time launch produces 0 visible error-level log entries that do not correspond to a real, user-actionable problem.
- **SC-006**: When a startup genuinely fails, the operator sees a failure state with a reason within 1 minute of the failure becoming definitive.

## Assumptions

- The statuses operators see today are "deploying", "running", "stopped", and "failed"; both first start and restart currently surface as the single status "deploying", which is the root of the "updating vs first launch" confusion.
- The ~30-second "failed" display observed after stop → start is a status-reporting artifact (the agent ends up running), not an actual crash-and-recover; the fix targets truthful reporting, not startup mechanics.
- The raw log-fetch error appears because logs are requested before the agent's runtime has started — an expected condition during every launch, so it must be handled as a normal waiting state, not an error.
- The red "connect failed" error on first launch concerns the built-in tool-server integration: the agent chats fine but registers zero tools, so the integration is genuinely broken, not just noisy. Diagnosing and fixing its root cause is in scope (FR-012); if diagnosis shows the cause lies outside this project, the scope is revisited explicitly during planning.
- Scope is the truthfulness and clarity of status and startup-log presentation in the agent management experience; making agents start faster, and changes to how agents are scheduled or run, are out of scope.
- Real failures must remain at least as visible as they are today; this feature must not suppress or delay genuine failure reporting (FR-009, SC-006).
