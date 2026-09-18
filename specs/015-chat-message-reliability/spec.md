# Feature Specification: Chat message reliability — nothing lost, nothing doubled, same after reload

**Feature Branch**: `015-chat-message-reliability` (git: `fix/CLEAN-102-chat-message-reliability`, Jira: CLEAN-102)

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Необходимо решить проблему с чатом, где возникают артефакты в виде неправильной группировки сообщений, иногда они просто исчезают, когда задал вопрос на главной странице, перешел в агента и этого сообщения нет, иногда возникало такое что сообщение просто проглатывалось после перезагрузки страницы и все, приходится писать заново. Иногда сообщения дублируются. Нужно отображать время когда было отправлено сообщение. Если оно было отправлено но не доставлено, из-за чего исчезнет после обновления страницы, это нужно помечать под самим письмом, загрузку, если слишком долго доставляется. Иногда зависает ответ, хотя в логах он уже отображается. Агент может писать разными сообщениями, а после перезагрузки ломается форматирование и все в один пузырь накладывается. Сообщение почему-то мое опускается, хотя сначала пишу я, а потом ответ агента."

## Evidence from the screenshots *(context, supplied with the request 2026-09-18)*

Four screenshots came with the request. What they show, as observed:

- **Live turn, correct** (admin, "Chat with Rancher"): the agent answers in several
  separate bubbles, each followed by its own "Thought for a moment" step, with the
  person's question sitting between them where it was asked.
- **Same kind of turn after a reload, broken** (admin, two screenshots): the agent's
  separate messages are fused into one bubble with no break between them — "Проверю:Ха!
  **Работает!**", "Попробую с токеном:✅ **Хост доступен**", "…с полной информацией о
  себе.Skyhunter сообщает…". The thinking steps that separated them are gone.
- **Wrong order and a duplicate** (app console, conversation started from the home
  page): the person's question "Спроси у Elderly Care Match: assisted living near
  Seattle, WA" appears first, then the agent's greeting "Access granted! Send me a
  message." and its first reply, and then **the same question again**, below the reply
  it caused.

Reported without a screenshot: a question asked on the home page is missing once the
agent chat opens; a sent message is gone after a reload and has to be typed again; the
reply stays on "thinking" although the agent's logs already contain the answer. None of
these has been reproduced on demand yet — all are described as "sometimes".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What I sent is never silently lost (Priority: P1)

A person types a question — on the home page or in an agent's chat — and sends it. From
that moment the message is theirs to keep: it is visible in the conversation it belongs
to, it survives moving from the home page into the agent's chat, and it survives a page
reload. If the agent never received it, the message is still there, says so, and can be
sent again without retyping.

**Why this priority**: Losing what a person wrote is the most damaging failure in a
chat: it costs the work of writing it again and removes any reason to trust the
conversation. Every other story assumes the message exists.

**Independent Test**: Send a question from the home page and confirm it is the first
message in the agent chat that opens. Send a message in an agent chat, reload
immediately, and confirm it is still there. Send a message while the agent is
unreachable, reload, and confirm the text is still there, marked as not delivered, with
a way to resend.

**Acceptance Scenarios**:

1. **Given** a person on the home page, **When** they send a question and are taken to
   the agent's chat, **Then** that question is shown in the chat exactly once, before
   any agent reply to it.
2. **Given** a message that the agent has received, **When** the person reloads the page
   at any moment afterwards — including while the agent is still answering —, **Then**
   the message is shown in the same place in the conversation.
3. **Given** a message that was sent but never reached the agent, **When** the person
   reloads the page on the same device, **Then** the text is not lost: it is shown as not
   delivered and can be resent in one action, without retyping.
4. **Given** a not-delivered message, **When** the person resends it and it is received,
   **Then** it becomes an ordinary delivered message and appears once.
5. **Given** a not-delivered message, **When** the person chooses to discard it,
   **Then** it is removed and does not come back after a reload.

---

### User Story 2 - The conversation reads in the order it happened, each message once (Priority: P1)

A person reads a conversation top to bottom and it matches what happened: their question
comes before the reply it caused, a greeting the agent sent before the question comes
before the question, and no message — theirs or the agent's — appears twice.

**Why this priority**: A conversation in the wrong order or with repeats cannot be read
or quoted, and a doubled question looks like it was sent twice (and may make the person
wonder whether the agent acted on it twice).

**Independent Test**: Run a scripted conversation — greeting, question from the home
page, multi-message reply, follow-up question sent while the agent is still answering —
and compare the displayed sequence with the sequence of events, live and after a reload.

**Acceptance Scenarios**:

1. **Given** a person sends a question and the agent replies, **When** the conversation
   is displayed, **Then** the question is above the reply, live and after a reload.
2. **Given** a conversation opened from the home page where the agent also sends a
   greeting, **When** it is displayed, **Then** greeting, question and reply each appear
   once, in the order they actually happened.
3. **Given** a connection that drops and recovers in the middle of a turn, **When** the
   chat catches up, **Then** no message already on screen is shown a second time.
4. **Given** the same conversation open in two tabs, **When** a message is sent from
   one, **Then** each tab shows it once.
5. **Given** a person sends a follow-up while the agent is still answering, **When** the
   turn completes, **Then** the follow-up stays where it was sent relative to the agent
   messages that came before and after it.
6. **Given** a person has scrolled up to re-read earlier messages, **When** they send a
   message, **Then** the view scrolls to the bottom so the message they just sent is
   visible — the usual chat behaviour.
7. **Given** a person has scrolled up and has not sent anything, **When** the agent's
   messages or thinking steps arrive, **Then** the view stays where the person left it.

---

### User Story 3 - A reloaded conversation looks like the one I watched (Priority: P2)

A person watches an agent work through a task: several separate messages, with thinking
steps between them. After a reload, or when opening the conversation later from the chat
history, they see the same thing — the same number of agent messages, split in the same
places, with the same formatting.

**Why this priority**: History is how people return to an answer and how operators
review what an agent did. Today a reload glues messages together and destroys the
paragraph breaks, so the saved conversation is harder to read than the live one and
looks like a different answer.

**Independent Test**: Have an agent answer in at least three separate messages with
formatted content (list, inline code, bold). Record the live view, reload, open the same
conversation from history, and compare message count, boundaries and formatting.

**Acceptance Scenarios**:

1. **Given** an agent turn that produced N separate messages, **When** the conversation
   is reloaded or opened from history, **Then** it shows N separate agent messages with
   the same text in each.
2. **Given** an agent message containing lists, inline code, bold text or line breaks,
   **When** the conversation is reloaded, **Then** the formatting is the same as it was
   live, and no two sentences that were in different messages run together.
3. **Given** a turn where thinking steps were shown between agent messages, **When** the
   conversation is reloaded, **Then** the messages stay separate where those steps were;
   whether the steps themselves are shown again is covered under Assumptions.
4. **Given** a conversation reloaded while the agent is still answering, **When** the
   rest of the answer arrives, **Then** it continues as further messages in the same
   turn rather than restarting, doubling or merging into an earlier bubble.

---

### User Story 4 - The answer shows up when the agent has answered (Priority: P2)

When the agent has finished answering, the person sees the answer. The chat does not
stay on "thinking" after the agent is done, and when something really has gone wrong the
person is told, instead of watching an indicator that will never finish.

**Why this priority**: A reply that exists but is not shown is indistinguishable from an
agent that failed; people reload, resend and create the duplicates above. It ranks below
the first two stories because a reload currently recovers the answer, whereas lost and
doubled messages are not recoverable by the person.

**Independent Test**: Trigger turns of different lengths, including one where the
connection is interrupted just before the agent finishes, and check that the answer
appears without a manual reload and the thinking indicator ends.

**Acceptance Scenarios**:

1. **Given** the agent has completed its answer, **When** the completion was missed by
   the open chat (for example because the connection dropped for a moment), **Then** the
   chat recovers the answer on its own and shows it without a manual reload.
2. **Given** a turn that ends in an error on the agent's side, **When** this happens,
   **Then** the thinking indicator stops and the person sees that the turn failed.
3. **Given** a turn that is legitimately long, **When** the person waits, **Then** the
   chat keeps showing that the agent is working and does not declare a failure while
   progress is still arriving.

---

### User Story 5 - I can see when a message was sent and whether it got through (Priority: P2)

Every message shows the time it was sent. Under their own messages a person can tell
the state at a glance: still sending, taking unusually long, delivered, or not delivered.
Delivered is the quiet default; the states that need attention are the ones that stand
out.

**Why this priority**: This is the new capability in the request and it is what turns
the failures above from silent into visible. It comes after the fixes because marking a
lost message is a poor substitute for not losing it, but it is what lets a person act
when delivery does fail.

**Independent Test**: Send messages under normal conditions, under a slow connection and
with the agent unreachable, and check the time and the state shown under each, live and
after a reload.

**Acceptance Scenarios**:

1. **Given** any message in a conversation, **When** it is displayed, **Then** the time
   it was sent is visible with it, in the viewer's local time, and the date is
   recognisable for messages from earlier days.
2. **Given** a message the person has just sent, **When** delivery takes longer than the
   "slow" threshold, **Then** a loading state appears under that message until it is
   delivered or marked not delivered.
3. **Given** a message that did not reach the agent within the "failed" threshold or was
   rejected, **When** this is determined, **Then** "not delivered" is shown under that
   message together with the way to resend it.
4. **Given** a delivered message, **When** the conversation is reloaded, **Then** its
   time is unchanged — the time shown is when it was sent, not when the page was loaded.
5. **Given** the app console in Russian, **When** times and states are shown, **Then**
   the wording is localised; the admin panel stays in English.

---

### User Story 6 - An agent shows the same status everywhere (Priority: P3)

*Added 2026-09-18 on request, with a screenshot: the admin's agent list shows Rancher as
"Deploying" while the same agent's header and Overview, on the same screen, show
"Failed — startup did not produce a running agent within 5 minutes".*

An operator looking at the agents screen sees one status per agent. When an agent's
status changes — deploying to running, deploying to failed, running to stopped — every
place on screen that shows that agent's status changes with it, without a reload.

**Why this priority**: It is not a chat defect, but it undermines the same trust: an
operator watching the list waits for a deploy that has already failed. It is ranked
last because the correct status is visible one click away and nothing is lost.

**Independent Test**: Start a deploy that will fail (or succeed) and keep the agents
screen open with that agent selected. Compare the status in the list row, the header and
the Overview card at the moment the status changes and one minute later.

**Acceptance Scenarios**:

1. **Given** the agents screen open with an agent in "Deploying", **When** the deploy
   fails or completes, **Then** the list row, the header and the Overview card show the
   new status within the same few seconds, without a reload.
2. **Given** an agent that is not the selected one, **When** its status changes,
   **Then** its row in the list reflects the change without the operator opening it.
3. **Given** a status with a reason (for example the start-up timeout), **When** it is
   shown in the list, **Then** the reason is available there too.

---

### Edge Cases

- The person sends a question from the home page, and the agent is starting up or
  unreachable: the question must be waiting in the agent chat, marked according to its
  real state, not dropped.
- The person sends, then reloads before any confirmation arrives: after the reload the
  message is either shown as delivered (it did arrive) or as not delivered — never both,
  never neither.
- A resend races with a late confirmation of the original: the agent must not receive or
  act on the same message twice, and the conversation shows it once.
- The device clock is wrong or differs from the agent's: order must still follow what
  actually happened, not the device clock.
- Two messages are sent within the same second: both are kept, in send order.
- The agent sends an empty or whitespace-only message between two real ones: it must not
  create an empty bubble, and must not cause its neighbours to merge.
- A message carries attachments: the delivery state and the resend action cover the
  message together with its files.
- A very long conversation is loaded in pages: grouping and order stay correct across
  the page boundary, and a message on the boundary is not duplicated.
- A not-delivered message is kept on one device and the person opens the conversation on
  another: the other device shows only what the agent received (see Assumptions).
- Conversations saved before this change, where messages were already fused: see
  Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

**Keeping what was sent**

- **FR-001**: A message sent from the home page MUST appear in the agent chat that opens
  for it, exactly once, positioned before any agent reply to it.
- **FR-002**: A message the agent has received MUST be shown in the conversation after
  any page reload, including a reload during the agent's answer.
- **FR-003**: A message that was sent but has not been confirmed as received MUST be
  retained on the sending device across reloads until it is delivered or the person
  discards it.
- **FR-004**: A person MUST be able to resend a not-delivered message in one action,
  with its text and attachments intact, and MUST be able to discard it.
- **FR-005**: Resending MUST NOT result in the agent handling the same message twice,
  even if the original turns out to have been received.

**Order and uniqueness**

- **FR-006**: Messages MUST be displayed in the order the events happened in the
  conversation, and this order MUST be the same live and after a reload.
- **FR-007**: The displayed order MUST NOT depend on the clock of the viewer's device.
- **FR-008**: Each message MUST be displayed at most once per conversation view,
  including after reconnects, catch-up after a dropped connection, paged loading of
  older history, and when the conversation is open in several tabs.
- **FR-009**: A message the person sent MUST be recognised as the same message when the
  saved conversation is loaded, so that the local copy and the saved copy never appear
  side by side.

**Same conversation after reload**

- **FR-010**: Separate agent messages within one turn MUST remain separate when the
  conversation is reloaded or opened from history, with the same boundaries as live.
- **FR-011**: The text and formatting of each message MUST be the same live and after a
  reload; text from different messages MUST NOT be joined without a break.
- **FR-012**: When a conversation is reloaded during an agent's answer, the remainder of
  the answer MUST continue the same turn without duplicating or merging with messages
  already shown.
- **FR-013**: Empty agent messages MUST NOT be rendered and MUST NOT change how
  neighbouring messages are grouped.

**Answers that arrive**

- **FR-014**: When the agent has completed an answer and the open chat has not shown it,
  the chat MUST obtain and display it without the person reloading, within the recovery
  time in SC-005.
- **FR-015**: The thinking indicator MUST end when the turn ends — by completion, by
  failure or by cancellation — and a failed turn MUST be shown to the person as failed.
- **FR-016**: A long-running turn MUST NOT be reported as failed while progress from the
  agent is still arriving.

**Time and delivery state**

- **FR-017**: Every message, from the person and from the agent, MUST show the time it
  was sent, in the viewer's local time; messages from earlier days MUST be attributable
  to their date.
- **FR-018**: The time shown for a message MUST be stable: the same value live, after a
  reload and in the chat history.
- **FR-019**: Under each of the person's own messages the chat MUST be able to show one
  of: sending, slow (loading shown because delivery is taking longer than usual),
  delivered, not delivered. "Delivered" MAY be shown unobtrusively or implied by the
  absence of any other state.
- **FR-020**: The loading state MUST appear once delivery has taken longer than the
  "slow" threshold, and the message MUST be marked not delivered once the "failed"
  threshold passes or delivery is rejected (defaults under Assumptions).
- **FR-021**: The not-delivered mark MUST be placed under the message it refers to, and
  MUST make clear that the message will not be kept by the agent unless resent.

**Scrolling**

- **FR-024**: Sending a message MUST scroll the conversation to the bottom, wherever the
  person was scrolled to, so that the message they sent is in view.
- **FR-025**: Incoming content (agent messages, streamed text, thinking steps) MUST keep
  the view pinned to the bottom only for a person who is already at the bottom; it MUST
  NOT pull back a person who scrolled up to read. This holds in both surfaces.

**Several views of one conversation**

- **FR-026**: When the same person has the same conversation open in more than one
  place — two tabs, the admin panel and the app console, a second device — every open
  view MUST receive the agent's messages. Opening a second view MUST NOT stop the first
  one from receiving them.

**Agent status consistency (admin)**

- **FR-027**: Every place in the admin that shows an agent's status MUST show the same
  value, and MUST reflect a status change within 10 seconds without a reload — including
  list rows for agents other than the selected one.

**Scope**

- **FR-022**: All of the above MUST hold in every place the product shows a live agent
  chat: the admin panel's chats with Rancher and with agents, and the app console's
  agent chat including conversations started from the home page.
- **FR-023**: New user-visible wording in the app console MUST be available in every
  language the console supports; the admin panel remains English-only.

### Key Entities

- **Conversation**: one continuous exchange between a person and an agent; has an
  ordered sequence of messages and may be viewed live or from history.
- **Message**: one bubble's worth of content from the person or the agent. Has a stable
  identity that is the same live and in the saved conversation, an author, content with
  formatting, optional attachments, the time it was sent, and a position in the
  conversation's order.
- **Turn**: the person's message plus everything the agent produced in response —
  possibly several agent messages with thinking steps between them. Has a state:
  running, completed, failed or cancelled.
- **Delivery state**: for a person's message — sending, slow, delivered, not delivered.
- **Unsent message**: a person's message retained on their device because delivery was
  never confirmed; can be resent or discarded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 scripted sends across the covered chats — including sends from the
  home page and sends followed by an immediate reload — zero messages are lost: each one
  is visible afterwards either as delivered or as not delivered with its text intact.
- **SC-002**: In the same run, and in runs with the connection interrupted mid-turn,
  zero messages are displayed twice.
- **SC-003**: For 20 scripted conversations including multi-message agent turns, the
  sequence of messages shown after a reload is identical to the sequence shown live:
  same count, same order, same boundaries, same formatting.
- **SC-004**: A person's question is never displayed below the agent reply it caused —
  zero occurrences in the scripted conversations, including those started from the home
  page.
- **SC-005**: When an agent has finished answering, the answer is visible in an open
  chat within 10 seconds in at least 99% of turns, and in 100% of turns without a manual
  reload.
- **SC-006**: Every message in the covered chats shows its sent time, and that time is
  identical before and after a reload.
- **SC-007**: When a message cannot be delivered, the person sees the not-delivered mark
  under it within 35 seconds of sending, and can resend it in one action without
  retyping.
- **SC-009**: With one conversation open in two views, 100% of agent messages appear in
  both views.
- **SC-010**: After an agent's status changes, no two places on the admin's agents screen
  disagree about it for longer than 10 seconds.
- **SC-008**: People no longer need to retype a message because the chat lost it: zero
  such reports in the two weeks after release, against the recurring reports that
  prompted this work.

## Assumptions

- **Both surfaces are in scope.** The screenshots show the admin panel ("Chat with
  Rancher") and the app console (Russian "Немного подумал", home-page flow), and they
  share the same chat behaviour, so the fix covers both. Read-only transcript viewers in
  the chat history are in scope only for User Story 3 and the sent time.
- **Thresholds.** "Slow" is 5 seconds without confirmation; "not delivered" is 30
  seconds without confirmation, or an explicit rejection. These are starting values to
  be tuned during planning, not contractual numbers beyond SC-007.
- **"Delivered" means received by the agent's side and saved to the conversation** — the
  point after which a reload will show the message. It does not mean the agent has read
  or answered it.
- **Unsent messages are kept per device.** A message that never reached the agent exists
  only on the device that wrote it; another device shows the conversation as the agent
  knows it. Syncing unsent messages between devices is out of scope.
- **No automatic resend.** A not-delivered message is resent by the person, not silently
  by the chat, so that an agent never acts on something the person has given up on.
  Re-establishing the connection and catching up on the agent's answer is automatic.
- **Thinking steps after reload.** Whether the collapsed "Thought for a moment" steps
  are shown again in a reloaded conversation is existing behaviour and is not changed
  here; what this work guarantees is that messages stay split where those steps were.
- **Time format.** Time of day under each message, with a date separator between days;
  the full date and time are available on demand (for example on hover). Relative times
  ("5 min ago") are not required.
- **Existing conversations.** Conversations saved before this change whose agent
  messages were already stored fused together are not repaired retroactively unless the
  original boundaries can be recovered at no extra cost; the guarantees apply to
  conversations and turns created after release.
- **Other channels are out of scope.** Telegram and other messenger channels have their
  own delivery model (see `003-telegram-restart-recovery`) and are not changed here.
- **Root causes are not yet established.** All failures are reported as intermittent.
  Planning starts with reproducing each one; if a reported symptom turns out to have a
  cause outside the chat (for example agent start-up, covered by
  `001-stabilize-agent-startup`), it is tracked there and referenced from this feature.
