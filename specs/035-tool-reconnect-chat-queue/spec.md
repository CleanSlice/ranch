# Feature Specification: Tools That Reconnect, a Start That Explains Itself, and a Chat Queue

**Feature Branch**: `feat/CLEAN-245-tool-reconnect-chat-queue`

**Created**: 2026-11-25

**Status**: Draft

**Ticket**: [CLEAN-245](https://dreamvention.atlassian.net/browse/CLEAN-245)

**Input**: User description: "Retry as in Claude: when a tool falls, we try to bring it back. Extend the statuses during a reconnect: the user must understand why bringing the pod up takes longer than usual. Also a chat queue as in the Orca terminal: while the agent is starting nothing can be typed, which hurts UX. Add a ladder of at most three messages, reorderable if the user wants, and unlock the input."

## Background

On 20 November the Mazda cluster recreated all four agent pods at the same second, about ninety seconds before the Ranch API was answering again. Each agent tried its tool servers once, got an error page, and went on without them. For three days the agents were shown as running while every question ended in "I can't reach the Mazda documents right now — please try again in a few minutes". One visitor took a whole product quiz against an agent that could not open a single document. Nothing in the console said so, and "a few minutes" was never going to help: only a manual restart did.

Two things were missing. An agent that loses a tool server has no way back to it, and nobody — not the person chatting, not the Admin — is told that the agent is working with less than it was given.

A third, older annoyance sits next to them: while an agent is starting, the chat input is locked. A person who opens the chat with a question in mind has to wait and watch before typing it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An agent gets its tools back without anyone restarting it (Priority: P1)

An agent starts while one of its tool servers is not answering. The agent comes up anyway, keeps trying that server, and as soon as the server answers the agent's tools are there — for the very next question, without a restart. The same happens when a server that was connected drops away later: the next call that needs it brings the connection back.

**Why this priority**: This is the failure that cost three days. Everything else in this feature is about making that failure visible or more comfortable; this story makes it stop.

**Independent Test**: Start an agent with its tool server switched off, switch the server on a minute later, ask a question that needs the tool. The answer uses the tool and nobody touched the agent.

**Acceptance Scenarios**:

1. **Given** a tool server that does not answer when the agent starts, **When** the server begins answering, **Then** the agent's tools from that server are available within one minute, with no restart.
2. **Given** an agent whose tool server is still not connected, **When** a person sends a message, **Then** the agent makes one more attempt to connect before it answers, and uses the tools if the attempt succeeds.
3. **Given** a connected tool server whose connection drops, **When** the agent calls a tool that only reads, **Then** the connection is reopened and the call is repeated once; the person sees an ordinary answer.
4. **Given** a connected tool server whose connection drops, **When** the agent calls a tool that changes something, **Then** the call is not repeated on its own; the agent is told the server was unreachable and that the outcome is unknown.
5. **Given** a tool server that refuses the agent's credentials, **When** the agent retries, **Then** it stops after that refusal and reports the server as refused rather than unreachable — retrying a refusal is not waiting out an outage.
6. **Given** a tool server that never comes back, **When** the agent answers a question that needs it, **Then** it says the tool is unavailable; it does not tell the person to "try again in a few minutes" unless it is in fact still retrying.

---

### User Story 2 - A slow start says what it is waiting for (Priority: P1)

A person opens a chat, or an Admin opens the agent's page, while the agent is starting. Instead of one unchanging "Starting…", the status names the step in progress. When the start is slower than usual because a tool server is not answering, the status says exactly that: which server, and that the agent is retrying. When the agent gives up waiting and opens for chat without that server, the status keeps saying it is working with limited tools until the server is back.

**Why this priority**: Without it, the fix in Story 1 makes starts silently longer and the degraded state stays invisible — the same blindness that let the incident run three days.

**Independent Test**: Start an agent with one tool server switched off and watch the chat and the agent's page: the wait is named, then the limited state is named, then both clear when the server is switched on.

**Acceptance Scenarios**:

1. **Given** an agent that is starting normally, **When** a person watches the chat, **Then** the status moves through named steps (for example: starting, loading files, connecting tools, ready) rather than showing one label throughout.
2. **Given** a tool server that does not answer during start, **When** the wait passes the usual start time, **Then** the status says the agent is waiting for that server by name and that it keeps trying.
3. **Given** a start still waiting for a tool server after the waiting limit, **When** the limit passes, **Then** the agent becomes available for chat and is shown as running with limited tools, naming the missing server, in the chat and on the agent's page and in the agents list.
4. **Given** an agent shown as limited, **When** the missing server connects, **Then** the limited mark disappears within a minute without a page reload.
5. **Given** an agent that has stayed limited for longer than the alert threshold, **When** the threshold passes, **Then** an incident is opened for that agent and the usual notification is sent; it closes when the server connects.
6. **Given** a visitor on a share link or a signed-in User who is not an Admin, **When** the agent is limited, **Then** they are told in plain words that part of the agent's knowledge or tools is temporarily unavailable; server names and error text are shown to Admins and the Owner only.
7. **Given** the Ranch agent, **When** an Admin asks it why an agent is slow to start or what is wrong with it, **Then** it can report the same connection state the console shows.

---

### User Story 3 - Type while the agent is not ready (Priority: P2)

A person opens a chat while the agent is starting, or while it is still answering the previous message. The input is open. What they send does not vanish and is not refused: it lands in a small queue just above the input — "Queued · 2" — and goes to the agent, in order, as soon as the agent can take it.

**Why this priority**: It removes a daily irritation and makes the longer, more honest starts of Story 2 painless, but nothing breaks without it.

**Independent Test**: Restart an agent, type two messages while it is starting; both appear in the queue and are delivered in order once the agent is ready, each getting its own answer.

**Acceptance Scenarios**:

1. **Given** an agent that is starting or reconnecting, **When** a person opens the chat, **Then** the input accepts text and attachments.
2. **Given** an agent that is not ready, **When** the person sends a message, **Then** it appears in the queue above the input, not in the conversation, and the input is empty again.
3. **Given** queued messages, **When** the agent becomes ready, **Then** the first one is sent and appears in the conversation; the next is sent after the agent has finished answering the previous one.
4. **Given** an agent that is answering, **When** the person sends another message, **Then** it is queued and goes out when the current answer is finished.
5. **Given** three messages in the queue, **When** the person tries to send a fourth, **Then** it is not queued, the text stays in the input, and a short line says the queue is full.
6. **Given** an agent that is ready and idle and an empty queue, **When** the person sends a message, **Then** it is sent straight away as today; the queue is never shown.

---

### User Story 4 - Change your mind about what is queued (Priority: P3)

Before a queued message goes out the person can move it up or down, take it out, or pull it back into the input to rewrite it. The queue can be folded to one line when it is in the way.

**Why this priority**: A queue that can only be filled is a trap; but with at most three messages, plain order already covers most uses.

**Independent Test**: Queue three messages, move the third to the top, delete the second; when the agent is ready, the former third is sent first and the deleted one never is.

**Acceptance Scenarios**:

1. **Given** two or more queued messages, **When** the person moves one, **Then** the new order is the order they are sent in.
2. **Given** a queued message, **When** the person removes it, **Then** it is never sent and its attachments are discarded.
3. **Given** a queued message, **When** the person chooses to edit it, **Then** it leaves the queue and its text and attachments are back in the input.
4. **Given** a queued message, **When** the person chooses to send it now, **Then** [NEEDS CLARIFICATION: what "Now" does while the agent is answering — see Question 1].
5. **Given** the queue, **When** the person folds it, **Then** only the header with the count remains, and unfolding restores the list.
6. **Given** a person using only the keyboard or a screen reader, **When** they reorder, remove or edit a queued message, **Then** each action is reachable and announced.

---

### Edge Cases

- The agent fails to start (crash loop, stopped by an Admin) while messages are queued: nothing is sent; the queue stays, the chat says the agent did not start, and the person can keep or clear the queue.
- The person reloads the page or the connection to Ranch drops while messages are queued: the queue is still there afterwards, in the same order, on that device.
- The person leaves the chat and comes back days later with a queue still waiting: queued messages older than a day are not sent on their own; the person is asked whether to send or discard them.
- The same person has the chat open in two tabs: a message queued in one is not sent twice.
- A queued message carries attachments that are no longer allowed when its turn comes (limit changed, file too large): that message stays in the queue marked as not sendable, with the reason; the ones behind it still go out.
- The agent's request limit is reached while the queue is draining: draining stops, the remaining messages stay queued, and the existing limit notice is shown.
- A tool server is disabled or removed by an Admin while the agent is retrying it: retrying stops and the limited mark for it is removed.
- A tool server connects but lists no tools, or fewer than before: that is a connected server, not a limited agent.
- Several tool servers are missing at once: the status names the count and lists them for Admins; one incident covers the agent, not one per server.
- The Ranch API restarts while agents keep running (the opposite of the incident): tools come back on the next call, and agents are not marked limited for the seconds in between.
- A message queued while the agent was limited is sent when the agent is ready, not held until the tools are back — "limited" is still ready.

## Requirements *(mandatory)*

### Functional Requirements

**Reconnecting**

- **FR-001**: An agent MUST start even when one or more of its tool servers cannot be reached, and MUST keep trying each unreachable server at growing intervals, not more than one minute apart, for as long as the agent runs.
- **FR-002**: Before answering a message, an agent with a tool server still unreachable MUST make one further attempt to reach it, bounded so that it adds no more than a few seconds to the answer.
- **FR-003**: When a tool call fails because the connection to its server is gone, the agent MUST reopen the connection and repeat the call once if, and only if, the tool is declared as reading only.
- **FR-004**: A failed call to a tool that changes something MUST NOT be repeated automatically; the agent MUST be told the server was unreachable and that the outcome is unknown.
- **FR-005**: A refusal of the agent's credentials MUST end retrying for that server and be reported as a refusal, distinct from an outage.
- **FR-006**: Tools that become available after a reconnect MUST be offered under the same per-person rules as tools available from the start (access level, audience, the template's tool allowlist).

**Status**

- **FR-007**: While an agent starts, its status MUST name the current step, and MUST be the same in the chat, on the agent's page and in the agents list.
- **FR-008**: When a start is waiting for a tool server, the status MUST say so and, for Admins and the Owner, name the server and how long the agent has been trying.
- **FR-009**: An agent MUST become available for chat no later than a fixed waiting limit after its start, even if tool servers are still missing; from then on it MUST be shown as running with limited tools until every enabled server is connected.
- **FR-010**: The limited state MUST clear on its own within one minute of the last missing server connecting, without a restart and without a page reload.
- **FR-011**: An agent that stays limited beyond an alert threshold MUST open an incident through the existing incident and notification path, and close it when the agent is no longer limited.
- **FR-012**: People who are not Admins or the Owner — Users, share-link visitors — MUST see the limited state in plain words and MUST NOT see server names, addresses or error text.
- **FR-013**: The Ranch agent MUST have a way to read an agent's tool-connection state, for the same audience that can see it in the console.
- **FR-014**: The agent MUST know, for the turn it is answering, which of its tool servers are missing and whether it is still retrying them, so that what it tells the person is true.

**Queue**

- **FR-015**: The chat input MUST accept text and attachments whenever the person is allowed to write to this agent, including while the agent is starting, reconnecting or answering.
- **FR-016**: A message sent while the agent cannot take it MUST be placed in a queue shown directly above the input, with a header giving the count.
- **FR-017**: The queue MUST hold at most three messages; a fourth MUST be refused with an explanation and MUST leave the person's text untouched in the input.
- **FR-018**: Queued messages MUST be sent one at a time, in queue order, each after the agent has finished with the one before.
- **FR-019**: The person MUST be able to reorder queued messages, remove one, and return one to the input for editing.
- **FR-020**: The person MUST be able to fold the queue to its header and unfold it.
- **FR-021**: The queue MUST survive a page reload and a dropped connection on the same device, and MUST belong to one conversation of one person: it is never shown to, or sent on behalf of, anyone else.
- **FR-022**: A queued message MUST be sent exactly once, including when the chat is open in several tabs.
- **FR-023**: Queued messages MUST NOT be sent when the agent fails to start, and MUST NOT be sent unprompted when they are more than a day old.
- **FR-024**: A queued message that cannot be sent when its turn comes MUST stay in the queue with the reason shown and MUST NOT block the messages behind it.
- **FR-025**: Draining the queue MUST respect every rule an ordinary send respects: request limits, attachment rules, access to the agent.
- **FR-026**: The queue MUST behave the same in the admin console, the app console and on the share page.
- **FR-027**: Every queue action MUST be usable from the keyboard and announced to assistive technology.

### Key Entities

- **Tool server connection**: for one agent and one of its tool servers — whether it is connected, still being retried, refused or disabled; since when; how many attempts; the last error (for Admins only).
- **Agent readiness**: what an agent's status is made of during and after a start — the step it is on, whether it takes messages, and whether it is limited and by what.
- **Queued message**: text and attachments a person has sent that the agent has not yet been given; belongs to one person and one conversation; has a position, a time it was queued, and, if it could not be sent, the reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a tool server is unreachable at an agent's start and comes back later, the agent uses its tools within one minute of the server answering, in 100% of trials, with no restart.
- **SC-002**: No agent stays without one of its enabled tool servers for more than ten minutes without an open incident and a notification.
- **SC-003**: In a replay of the 20 November event — all agents restarted ninety seconds before the API is up — every agent answers a document question correctly within three minutes of the API coming up, and none is restarted by hand.
- **SC-004**: During a slow start, a person asked "why is this taking long?" can answer from the screen alone, without opening logs.
- **SC-005**: A person can send their first message within two seconds of opening a chat, whatever state the agent is in.
- **SC-006**: Messages queued during a start are delivered in the order shown, exactly once, in 100% of trials, including across a page reload.
- **SC-007**: Reordering, removing or editing a queued message takes one action each.
- **SC-008**: The phrase "try again in a few minutes" (or its equivalent) is given only while the agent is in fact retrying; in a session where it has stopped, the agent says the tool is unavailable.

## Assumptions

- The queue covers both waits the reference shows and the request names: the agent starting or reconnecting, and the agent still answering. Today a message sent during an answer goes to the agent at once; after this change it waits its turn.
- The waiting limit before an agent opens for chat without its tools is about one minute past the usual start; the alert threshold for an incident is about five minutes. Both are settings, not constants.
- "Limited" is a mark on a running agent, not a new failure state: a limited agent takes messages, counts as running for capacity and billing, and is not restarted automatically.
- Which tools only read is already declared for the Ranch's own tools (CLEAN-240). For third-party tool servers nothing is declared, so their calls are treated as changing something and are not repeated automatically.
- The queue lives on the person's device. A queue started on a laptop is not waiting on a phone. Three messages and a day's lifetime make that acceptable.
- The embedded widget shipped from the separate Bridle SDK repository is out of scope here; it keeps its current input behaviour until a follow-up.
- Agents get the reconnecting behaviour when they run a runtime version that has it. Agents pinned to an older version (Mazda is on 0.34.1) keep today's behaviour until their template is moved; the status and the queue degrade to today's single "Starting…" for them rather than showing something untrue.
- Why the pods were recreated on 20 November, and making the API start before agents, belong to the cluster's operators and are not part of this feature.
