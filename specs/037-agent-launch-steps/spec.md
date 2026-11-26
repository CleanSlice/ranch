# Feature Specification: Agent launch steps

**Feature Branch**: `feat/CLEAN-247-agent-launch-steps`

**Created**: 2026-11-26

**Status**: Draft

**Ticket**: [CLEAN-247](https://dreamvention.atlassian.net/browse/CLEAN-247)

**Input**: User description: "Давай при запуске агента использовать - https://inspira-ui.com/docs/en/components/miscellaneous/multi-step-loader Чтобы удобно и красиво отображать ему весь процесс поднятия агента при старте/рестарте. Докер поднят, используй pw для тестов. нужно в app/admin под соответствующую тему"

## Background

Starting or restarting an agent takes from several seconds to a few minutes. During that time both consoles show a spinner and a single line: "Setting up agent…" or "Agent is restarting…" in the admin console, "Deploying new pod… Scheduling on the cluster." in the app console. The person cannot tell how far the launch has got, whether it is moving, or where it stopped when it does not finish.

The launch is not one event. The previous instance is shut down, a new one is scheduled, its container is prepared, the agent's runtime boots, and the runtime connects back to Ranch. The consoles already receive this progress live; they just fold it into one sentence. The app console goes further and picks its sentence from the time elapsed since the launch began, so what it says is a guess.

Both consoles already have a place for this: the overlay that covers the agent's chat transcript while the agent is starting or restarting. This feature keeps that overlay where it is and replaces what it shows. Instead of a spinner and a sentence, it shows the launch as a list of steps that tick off as the agent really passes them, in the visual manner of the Inspira UI Multi Step Loader (a vertical list, completed steps checked, the current step highlighted, later steps dimmed).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a restart step by step (Priority: P1)

A person restarts a running agent, for example after changing its configuration. Instead of a spinner they see the list of launch steps. The step for shutting down the previous instance completes first, then each following step is marked done as it happens, and the list ends on "ready", after which the agent's normal view returns and they can talk to it.

**Why this priority**: Restart is the most frequent launch a person triggers by hand and the one where they sit and wait. It is the case the request names.

**Independent Test**: Restart a running agent in either console and watch the list. Each step completes in order, the last one completes when the agent is actually reachable, and the loader then gives way to the normal view.

**Acceptance Scenarios**:

1. **Given** a running agent, **When** the person presses Restart, **Then** the step list appears within one second, with the first step marked as current.
2. **Given** a restart in progress, **When** the agent passes a launch stage, **Then** the matching step is marked done and the next step becomes current, without a page reload.
3. **Given** a restart in progress, **When** the agent becomes reachable again, **Then** the final step is marked done, the completed list stays visible briefly so the result can be read, and the normal view returns.
4. **Given** a restart in progress, **When** the person reloads the page or opens the agent in another tab, **Then** the list shows the same current step, with earlier steps already marked done.

---

### User Story 2 - Watch a start step by step (Priority: P1)

A person creates a new agent, or starts one that was stopped. They see the same step list, without the step for shutting down a previous instance, because there is none. A first start is worded as setting the agent up, not as restarting it.

**Why this priority**: A first start is a new person's first impression of the product and usually the longest launch. A start after stop uses the same path.

**Independent Test**: Create an agent, or start a stopped one, and watch the list from the first step to "ready".

**Acceptance Scenarios**:

1. **Given** a stopped agent, **When** the person presses Start, **Then** the step list appears and contains no step about stopping a previous instance.
2. **Given** a newly created agent, **When** its page opens while it is still launching, **Then** the step list is shown with wording for a first start.
3. **Given** an agent that is launching, **When** a person who did not trigger the launch opens it, **Then** they see the step list at its current step.

---

### User Story 3 - See where a launch failed or stalled (Priority: P2)

A launch does not always finish. When a step fails, the list stops on that step, marks it as failed, and shows the reason the platform reported. When a step takes far longer than usual, the list says that it is taking longer than expected instead of spinning silently. From either state the person can retry the launch or go to the logs.

**Why this priority**: The single-line spinner is at its worst here: a failed or stuck launch looks the same as a slow one. This story depends on the step list from stories 1 and 2.

**Independent Test**: Launch an agent that cannot start (for example with a container image that does not exist) and confirm the list stops on the right step with the reported reason and a retry action.

**Acceptance Scenarios**:

1. **Given** a launch in progress, **When** a stage fails, **Then** the matching step is marked failed, the following steps stay not started, and the reason reported by the platform is shown as received.
2. **Given** a failed launch, **When** the person presses the retry action, **Then** a new launch begins and the list starts again from its first step.
3. **Given** a launch in progress, **When** the current step exceeds its usual duration, **Then** the step is marked as taking longer than expected and the list keeps following real progress.
4. **Given** a failed launch, **When** the person chooses to see the logs, **Then** they reach the agent's logs without losing the failure message.

---

### User Story 4 - The loader belongs to each console (Priority: P2)

The step list looks native in the admin console and in the app console: each uses its own colours, typography, corner radii and motion, in both light and dark themes, and at phone and desktop widths. In the app console the step names follow the active language.

**Why this priority**: The request asks for both consoles, each in its own theme. A loader that looks pasted in from another product would be a regression in polish.

**Independent Test**: Trigger a launch in each console, in each theme, at 390 px and 1440 px, and compare the loader with the surrounding interface.

**Acceptance Scenarios**:

1. **Given** the admin console in light or dark theme, **When** a launch is shown, **Then** the loader uses the admin console's own visual tokens and remains readable.
2. **Given** the app console in light or dark theme, **When** a launch is shown, **Then** the loader uses the app console's own visual tokens and remains readable.
3. **Given** a 390 px wide screen, **When** a launch is shown, **Then** the whole list is readable without horizontal scrolling and no step text is cut off.
4. **Given** the app console set to Russian, **When** a launch is shown, **Then** the step names are in Russian, while a failure reason from the platform is shown as received.
5. **Given** a person who has asked their device to reduce motion, **When** a launch is shown, **Then** steps change state without decorative animation.

---

### User Story 5 - The loader lives in the existing launch overlay (Priority: P3)

The step list appears in the overlay the consoles already raise over the agent's chat while it starts or restarts: same place, same size, same moments it appears and disappears. Nothing new covers the screen. Everything that is usable during a launch today stays usable: other agents, other pages, the agent's other tabs, and writing a message that is held until the agent is ready.

**Why this priority**: A launch can take minutes. Reusing the overlay keeps the change where people already look for launch status and keeps the rest of the console free, which a full-screen loader would not.

**Independent Test**: Start a launch and compare with the current behaviour: the overlay covers the same area and appears and clears at the same moments; only its content differs. Navigate elsewhere and back; the launch continues and the list shows the current step.

**Acceptance Scenarios**:

1. **Given** a launch in progress, **When** the overlay is shown, **Then** it covers the same area as the current launch overlay and nothing outside that area is blocked.
2. **Given** a launch in progress, **When** the person navigates to another agent, page or tab of the agent and returns, **Then** navigation works normally, the launch continues, and the list shows the current step.
3. **Given** the other states the overlay already shows (agent stopped, agent failed outside a launch, tools still connecting), **When** one of them applies, **Then** it is shown as it is today, unless this spec says otherwise.

---

### Edge Cases

- The launch finishes faster than the list can animate: steps are still shown completing in order, quickly, and the list does not skip to the end with steps left unmarked.
- A stage is skipped or reported out of order (for example the container was already prepared): every step before the furthest stage reached is shown as done; the list never moves backwards.
- The person opens the page in the middle of a launch: the list starts at the current step, not at the first.
- The live connection to Ranch drops during a launch: the list keeps its last known state, says progress is not being received, and catches up when the connection returns.
- The agent restarts on its own (not triggered by the person, for example after a configuration change applied by the agent or a crash): the list is shown the same way, with the steps that apply.
- The person stops the agent while it is launching: the list closes and the agent shows as stopped, not as failed.
- A second restart is requested while one is in progress: the list restarts from its first step for the newest launch and never mixes steps from two launches.
- Several agents launch at once (for example after a template change restarts every agent that uses it): each agent shows its own list with its own progress.
- The agent's instance is up but its runtime never connects back to Ranch: the list stops on the connecting step and reports it, rather than declaring the agent ready.
- The person's role allows viewing the agent but not restarting it: they see the list, without the retry action.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both consoles MUST show an agent's launch as an ordered list of named steps, in place of the current spinner with a single line of text, wherever that spinner appears today for an agent that is starting or restarting.
- **FR-002**: The list MUST cover three kinds of launch: first start of a new agent, start of a stopped agent, and restart of an existing agent.
- **FR-003**: The steps MUST name the real stages of a launch in the order they happen: the request being accepted, the previous instance shutting down (restart only), the new instance being scheduled, its container being prepared, the agent's runtime starting and connecting to Ranch (one step), and the agent being ready. Step names MUST be short: one line of a few words each.
- **FR-004**: Each step MUST be in exactly one of these states: not started, current, done, failed. At most one step is current at a time.
- **FR-005**: Step progress MUST follow the launch state the platform reports. A step MUST NOT be marked done on a timer or by any other guess.
- **FR-006**: The final step MUST be marked done only when the agent can actually be reached, by the same measure the console uses to decide that a person can talk to the agent.
- **FR-007**: Step state MUST update live, without a page reload, and MUST be reconstructed correctly when the page is opened or reloaded during a launch.
- **FR-008**: The list MUST be shown for a launch the viewer did not trigger, including a launch the agent or the platform started on its own.
- **FR-009**: When a stage fails, the list MUST stop on the matching step, mark it failed, and show the reason reported by the platform, as received and untranslated.
- **FR-010**: When the current step runs past its usual duration, the list MUST say that it is taking longer than expected. The durations used MUST each carry a stated reason.
- **FR-011**: From a failed or stalled list the person MUST be able to retry the launch (if their role allows restarting the agent) and to reach the agent's logs.
- **FR-012**: The step list MUST be shown inside the existing launch overlay of each console, covering the same area and appearing and clearing at the same moments as that overlay does today. No full-screen or additional overlay is introduced, and the rest of the console MUST remain usable during a launch.
- **FR-013**: Whatever a person can do during a launch today MUST remain possible, including writing a message that is held until the agent is ready. The overlay's other states (stopped, failed outside a launch, tools connecting) MUST keep their current behaviour.
- **FR-014**: When the launch completes, the completed list MUST stay visible long enough to be read and then give way to the agent's normal view without any action from the person.
- **FR-015**: The loader MUST be present in both the admin console and the app console with the same steps, states and behaviour, and MUST use each console's own visual language in light and dark themes.
- **FR-016**: The loader MUST be usable at widths from 390 px to 1440 px and above, with no horizontal scrolling and no truncated step text.
- **FR-017**: In the app console, step names and loader wording MUST follow the active language. In the admin console they are English.
- **FR-018**: The loader MUST respect a reduced-motion preference and MUST announce step changes and failures to assistive technology.
- **FR-019**: Each agent's list MUST reflect only that agent's launch, including when several agents launch at the same time.
- **FR-020**: The existing start, stop and restart actions and their permissions MUST keep working as they do now; this feature changes how a launch is shown, not who may trigger one.

### Key Entities

- **Launch**: one attempt to bring an agent up. It has a kind (first start, start, restart), a beginning, an outcome (in progress, ready, failed, stopped), and belongs to exactly one agent. A new launch of the same agent replaces the previous one.
- **Launch step**: one named stage of a launch. It has a position in the order, a state (not started, current, done, failed), and, when failed, the reason the platform reported. Which steps a launch has depends on its kind.
- **Agent**: the thing being launched. Its reported status and the live state of its instance and connection are what the steps are derived from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During any launch, a person can name the stage the agent is in by looking at the screen, without opening logs, in both consoles.
- **SC-002**: The step list appears within 1 second of pressing Start or Restart.
- **SC-003**: A change in the agent's launch stage is reflected in the list within 2 seconds.
- **SC-004**: In a check of at least 10 restarts and 10 starts per console, the list never shows "ready" before the agent can be talked to, and never stays on an unfinished step after it can.
- **SC-005**: When a launch fails, the person sees which step failed and the reported reason within 5 seconds of the platform reporting it, with a retry action one click away.
- **SC-006**: Reloading the page during a launch restores the list at the correct step in 100% of checked cases.
- **SC-007**: The loader passes a visual check in both consoles, in light and dark themes, at 390 px and 1440 px, with no console errors and no failed requests.
- **SC-008**: A launch does not take longer because of this feature: the time from pressing Restart to the agent being reachable is unchanged within normal run-to-run variation.

## Assumptions

- The Inspira UI Multi Step Loader is the component this feature is built on, as confirmed by the requester: it is used itself, with its own look and motion, not imitated. It is adjusted only where this spec requires something it does not do (placement inside the overlay, each console's theme, a failed step, accessibility). Its default full-screen modal presentation is not adopted: the list is placed in the launch overlay the consoles already have (FR-012), as confirmed by the requester.
- The reference component advances on a fixed timer per step by default. That mode is not used; steps are driven only by reported state (FR-005). This also replaces the app console's current wording chosen by elapsed time.
- The overlay is not dismissable today and this feature does not add a way to dismiss it.
- The step list replaces the content of the existing "starting / restarting" overlay in both consoles. Other places that mention a launch in one line (for example the logs bar summary) keep their short form, but must not contradict the step the overlay shows. Buttons that merely show a busy state while a restart is in flight (for example "Restart now" after a file import) keep their inline indicator and are out of scope.
- The stages listed in FR-003 can be derived from what the platform already reports about an agent: its status, the live state of its instance, and whether its runtime is connected. If a stage turns out not to be observable, planning decides whether to merge it into its neighbour or to add the missing signal; the step list shown to the person must only contain stages that can be observed.
- Stopping an agent is not a launch and gets no step list.
- "Both themes" means the theme each console ships: the admin console is light, the app console is dark, and neither has a switch.
- The logs of FR-011 are the logs bar the admin console already keeps under the chat. The app console has no logs view; there the way forward from a failure is the restart.
- An account that may not manage an agent is not told what kind of launch it is, nor the server's reason for a failure. Its list has no "previous instance stopped" row and shows the reason every viewer is given.
- When an agent's tools are still connecting at the end of a launch, that wait belongs to the final step of the list. The separate "tools connecting" state of the overlay remains for an agent that is already up.
- No new permissions are introduced. Whoever can see an agent can see its launch; whoever can restart it can retry.
- Verification runs against the local stack, which is already up, using Playwright, at 390 px and 1440 px in both consoles and both themes.
- This is a change to how an existing capability is displayed, not a new console capability, so no new agent tool is expected. Planning confirms this at the constitution check.
