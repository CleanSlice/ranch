# Feature Specification: Chat History Inside the Agent

**Feature Branch**: `feat/CLEAN-248-agent-history-switch`

**Created**: 2026-11-26

**Status**: Draft

**Ticket**: [CLEAN-248](https://dreamvention.atlassian.net/browse/CLEAN-248)

**Input**: User description: "Take our prototype of agent chat history into work: variant A, the switch in the header." (prototype: `agent-history-prototype.html`, three variants; A was chosen)

## Background

Today a person's past conversations live on a separate History page, reached from a tab at the top of the app console. The page lists conversations with every agent together, and a card does not say which agent it belongs to. To reread what an agent said last week, a person leaves the agent, opens History, guesses the right card, reads it on a third page, and then finds the way back to the agent to continue.

A conversation belongs to an agent. The prototype tried three ways of putting history where the agent is: a switch in the agent header (A), a chip above the feed (B), a column of conversations beside the chat (C). Variant A was chosen. It keeps everything about the conversation in one group in the middle of the header, costs no width, and works the same in the wide list view and in the narrow panel of the Orbit view. Its known price is accepted: the chat and the list are not visible at the same time.

## Clarifications

### Session 2026-11-26

- Q: Does the side block of the old conversation page (message count and last activity, Summary & insights, Navigation, Export) survive the move? → A: Yes, whole, as the conversation's Overview. It is not reduced to a Summary toggle and an Export button.
- Q: Does the separate History page stay as a view across all agents? → A: No. It is deleted; it was too awkward to use.
- Q: Is new filtering logic needed on the server? → A: No. Filtering conversations by agent and by text already exists for the admin list. The list of a person's own conversations only has to accept the same two filters, under its present ownership rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find an earlier conversation without leaving the agent (Priority: P1)

A person is chatting with an agent and wants to look at something from an earlier conversation with it. In the middle of the agent header there is a switch with two positions, Chat and History, and next to it the New chat button. Choosing History replaces the message feed with the list of this person's conversations with this agent: the one going on now first, then the closed ones, newest first, grouped as Today, This week and Earlier. Each row shows the title, the last message, whether the conversation is going on or closed, how many messages it has and when it was last active. Choosing Chat brings the feed and the composer back exactly as they were.

**Why this priority**: This is the feature. Without the switch and the list nothing else here exists, and with only this story a person can already see what they talked about with this agent and when.

**Independent Test**: Open an agent that has one running conversation and several closed ones, choose History, and check that only this agent's conversations are listed, in the described order and groups; choose Chat and check the feed and a half-typed message are still there.

**Acceptance Scenarios**:

1. **Given** an open agent, **When** the person looks at the agent header, **Then** the Chat | History switch and New chat stand together in the middle, and the agent's own actions (pin, share, details and, for a manager, restart and stop) stay on the right.
2. **Given** an agent with closed conversations, **When** the person looks at the switch, **Then** the History position shows how many closed conversations there are with this agent.
3. **Given** the Chat position, **When** the person chooses History, **Then** the feed and the composer give way to the list of this person's conversations with this agent only; conversations with other agents are not in it.
4. **Given** the list, **When** it is shown, **Then** the running conversation is first and marked as going on now, closed ones follow newest first under the headings Today, This week and Earlier, and a heading with nothing under it is not shown.
5. **Given** a closed conversation that has been assessed, **When** its row is shown, **Then** the row says whether the matter was resolved or not; a conversation that has not been assessed shows neither.
6. **Given** the History position, **When** the person chooses Chat or the row marked as going on now, **Then** the current conversation is shown as it was left, including text typed but not sent.
7. **Given** the agent is in the middle of answering, **When** the person switches to History and back, **Then** the answer was not interrupted and is in the feed.
8. **Given** an agent with no conversations yet, **When** the person chooses History, **Then** an empty state says that conversations with this agent will appear here, and no counter is shown on the switch.

---

### User Story 2 - Read a closed conversation in place (Priority: P1)

The person picks a closed conversation in the list. It opens in the same place the feed was, with its messages as they were. A bar above it shows a way back to the list, the title and that it is closed. Where the composer was, a line says the conversation is closed and can only be read, with one button that leads to the current chat.

**Why this priority**: A list that cannot be opened answers "when" but not "what". Together with Story 1 this replaces the old History page for everyday use.

**Independent Test**: From the list, open a closed conversation, read it to the top, go back to the list, open another, then go to the current chat with the button in the bottom line.

**Acceptance Scenarios**:

1. **Given** the list, **When** the person picks a closed conversation, **Then** its messages replace the list, newest at the bottom, and earlier messages can be loaded upwards until the first one.
2. **Given** an open closed conversation, **When** the person looks for the composer, **Then** there is none: a line states that the conversation is closed and read-only and offers a button to the current chat.
3. **Given** an open closed conversation, **When** the person uses the back control in the bar, **Then** the list is shown again at the place and with the search they left.
4. **Given** an open closed conversation, **When** the person uses the button to the current chat, or chooses Chat in the switch, **Then** the current conversation is shown.
5. **Given** an open closed conversation, **When** it is shown, **Then** its messages look and behave as they do in history today: the agent's thinking folded above its reply, cited sources that can be opened and rated, and the person's own ratings of replies.
6. **Given** a conversation that no longer exists or is not this person's, **When** it is asked for, **Then** the panel says the conversation was not found and offers the way back to the list.
7. **Given** an open closed conversation, **When** the person presses Escape, **Then** the list is shown; pressed again in the list, the current chat is shown; pressed in the current chat, nothing happens.

---

### User Story 3 - Find a conversation by what it was about (Priority: P2)

A person with dozens of conversations with one agent types a few words into the search field above the list. The list narrows to the conversations whose title or last message contains those words. If nothing matches, the list says so and says what the search looks at.

**Why this priority**: The list works without search while conversations are few. Search is what keeps it usable after a few months with the same agent.

**Independent Test**: With at least twenty conversations with one agent, type a word that occurs in the title of exactly one old conversation and check that it is the only row left; clear the field and check the full list is back.

**Acceptance Scenarios**:

1. **Given** the History position, **When** it opens, **Then** the search field is ready for typing without a click.
2. **Given** text in the search field, **When** the person stops typing, **Then** only conversations whose title or last message contains the text are listed, regardless of letter case, and regardless of how far down the list they would have been.
3. **Given** a search with no matches, **When** the list is shown, **Then** it says nothing was found and that the search covers the title and the last message.
4. **Given** a search in effect, **When** the person opens a conversation and comes back, **Then** the same search and results are still there; leaving History for Chat clears it.

---

### User Story 4 - The conversation's Overview (Priority: P2)

Reading a closed conversation, the person wants its short version, wants to jump to a particular exchange, or wants to take it elsewhere. The Overview block of the old conversation page comes along unchanged in content: the number of messages and the time of last activity; Summary & insights, with the summary and the sentiment, resolved, language and topic marks; Navigation, the list of the person's and the agent's messages that jumps to the chosen one; and Export in the formats offered today.

Where the panel is wide enough, the Overview stands as a column to the right of the messages, as on the old page. Where it is not, an Overview control in the bar above the conversation opens it over the messages and closes it again.

**Why this priority**: The Overview is how a long conversation is read: without the navigation a person scrolls through hundreds of messages to find one. It comes after reading itself only because a short conversation can be read without it.

**Independent Test**: Open a closed conversation of at least thirty messages that has a summary; in the wide view and in the narrow panel, read the summary, jump to a message from Navigation, and export in each format.

**Acceptance Scenarios**:

1. **Given** a closed conversation in a wide panel, **When** it opens, **Then** the Overview is shown to the right of the messages with its four parts: counts, Summary & insights, Navigation and Export.
2. **Given** a closed conversation in a narrow panel, **When** it opens, **Then** only the messages are shown, and the bar has an Overview control; using it shows the same four parts over the messages, and using it again, or pressing Escape, hides them.
3. **Given** the Overview, **When** the person picks an entry in Navigation, **Then** the messages scroll to that message; in a narrow panel the Overview closes first so the message is visible.
4. **Given** a conversation without a summary, **When** the Overview is shown, **Then** Summary & insights says there is no summary yet.
5. **Given** the Overview, **When** the person chooses a format under Export, **Then** a file with that conversation is downloaded in that format, with the same contents the old page gave.
6. **Given** an Overview opened in a narrow panel, **When** the person goes back to the list or to the chat, **Then** it is closed again for the next conversation they open.

---

### User Story 5 - The top tabs go away and old links still arrive (Priority: P2)

With history inside the agent, the Agents and History tabs at the top of the app have nothing left to switch between, and they are removed. A person who bookmarked the History page, or a conversation on it, still gets where they meant to go.

**Why this priority**: Two places for the same thing would be worse than either. It comes after the stories above because it removes the old way, which is only safe once the new one is complete.

**Independent Test**: Open the app and check there are no Agents / History tabs; open a saved link to the old History page and a saved link to one old conversation.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** any page of the app is shown, **Then** the top bar has no Agents and History tabs; the logo still leads to the agents.
2. **Given** a saved link to the old History page, **When** it is opened, **Then** the person lands on the agents workspace.
3. **Given** a saved link to a conversation on the old page, **When** it is opened, **Then** the agent that conversation was with is opened with that conversation shown read-only (or the current chat, if it is the running one).
4. **Given** a saved link to a conversation with an agent the person can no longer reach, **When** it is opened, **Then** the person is told the conversation was not found, as before.

---

### User Story 6 - The same in a narrow panel (Priority: P2)

In the Orbit view the agent panel is a narrow column beside the hub, and on a phone the panel is the whole screen. The switch, New chat, the list and the reading view all work there. Where there is no room for words, the switch and New chat keep their icons and drop their labels; the counter on History stays.

**Why this priority**: The Orbit view is the default workspace, so "narrow" is the common case, not a corner.

**Independent Test**: Repeat Stories 1 and 2 in the Orbit view and at a phone width of 390 px; nothing is cut off, overlaps or scrolls sideways.

**Acceptance Scenarios**:

1. **Given** a panel too narrow for labels, **When** the header is shown, **Then** the switch and New chat show icons only, each with an accessible name and a tooltip, and the History counter is still visible.
2. **Given** a narrow panel, **When** a closed conversation is open, **Then** the bar above it keeps the back control, the title (shortened with an ellipsis if needed) and the Overview control reachable without sideways scrolling.
3. **Given** a phone-width screen, **When** the list is shown, **Then** each row keeps its title, state and time readable, and the last-message line shortens rather than wraps.

---

### User Story 7 - New chat sits with the switch (Priority: P3)

New chat moves from the row of agent actions to the conversation group beside the switch. It behaves as it does today: it asks for confirmation, closes the current conversation into history and starts a fresh one. After it, the person is in the Chat position with an empty conversation, the conversation just closed is the first closed row in History, and the counter is one higher.

**Why this priority**: The button already works where it is. Moving it is what makes the header read as "conversation in the middle, agent on the right", and the counter makes its effect visible, but nothing is blocked without it.

**Independent Test**: With a conversation that has messages, start a new chat from any of the three views (chat, list, reading a closed conversation) and check the result in History.

**Acceptance Scenarios**:

1. **Given** the current conversation has messages, **When** the person confirms New chat, **Then** the Chat position shows an empty conversation, the History counter grows by one, and the closed conversation is at the top of the closed ones.
2. **Given** the list or a closed conversation is shown, **When** the person confirms New chat, **Then** the view changes to the Chat position with the new conversation.
3. **Given** the current conversation is empty, the agent is answering, or the agent is unavailable, **When** the person looks at New chat, **Then** it is unavailable and says why, as it does today.

---

### Edge Cases

- The current conversation has no messages yet: there is no row marked as going on now, and the list starts with the closed ones.
- More conversations than fit in one load: further ones are loaded as the person reaches the end of the list; the counter always shows the full number, not the number loaded.
- A very large number of closed conversations: the counter shows "99+" above 99.
- A conversation with no title: the row and the bar show the start of its summary, or a neutral "Conversation" when there is none, as the old page did.
- The list fails to load, or a conversation fails to open: the panel says so and offers to try again; the Chat position keeps working.
- A conversation has just been closed but is not in the list yet: the list has a Sync control that brings the list up to date for this agent, as the old page had for all agents.
- The person switches to another agent while in History or while reading a closed conversation: the newly opened agent starts in the Chat position.
- The agent is stopped, starting or failed: History and closed conversations are readable regardless; only the Chat position reflects the agent's state.
- A message arrives in the current conversation while the person is in History: nothing in History moves; it is in the feed when they return.
- The page is reloaded while reading a closed conversation: the same agent and the same conversation are shown again.
- The details part of the agent header is unfolded: the switch stays in the header line and works the same.
- A person with read-only access to the agent (an ordinary user of someone else's agent): sees only their own conversations with it, never those of other people.

## Requirements *(mandatory)*

### Functional Requirements

**The switch**

- **FR-001**: The agent header in the app console MUST show a two-position switch, Chat and History, centred in the header line, with New chat directly beside it as one group; the agent's actions MUST remain a separate group on the right.
- **FR-002**: The History position MUST show the number of this person's closed conversations with the open agent, nothing at zero, and "99+" above 99.
- **FR-003**: The switch MUST be operable by keyboard and MUST announce which position is selected; each control reduced to an icon MUST keep an accessible name.
- **FR-004**: An agent MUST open in the Chat position. Changing the open agent MUST return the panel to the Chat position.
- **FR-005**: Moving between positions MUST NOT interrupt an answer in progress, lose unsent text in the composer, or lose the scroll position of the feed.

**The list**

- **FR-006**: The History position MUST replace the feed and the composer with the list of the signed-in person's own conversations with the open agent, and only those.
- **FR-007**: The list MUST show the running conversation first, when it has at least one message, marked as going on now; closed conversations MUST follow, most recently active first.
- **FR-008**: Closed conversations MUST be grouped under Today, This week (the six days before today) and Earlier, by the day of their last activity in the person's own time zone; empty groups MUST NOT be shown.
- **FR-009**: Each row MUST show the title (or the fallback described in Edge Cases), the last message on one line, the state (going on now or closed), the number of messages and the time of last activity; a closed conversation that has been assessed MUST also show resolved or not resolved.
- **FR-010**: The list MUST load further conversations on demand until all are shown, and MUST show loading, empty and failed states distinctly, with a retry on failure.
- **FR-011**: The list MUST offer a Sync control that refreshes this agent's conversations for this person and shows that it is working while it does.
- **FR-012**: Picking the running conversation MUST lead to the Chat position; picking a closed one MUST open it for reading.

**Search**

- **FR-013**: The list MUST have a search field that receives focus when the History position opens.
- **FR-014**: Search MUST match conversations whose title or last message contains the typed text, case-insensitively, across all of this person's conversations with this agent, not only those already loaded.
- **FR-015**: When nothing matches, the list MUST say so and state that search covers the title and the last message.
- **FR-016**: The search text MUST survive opening a conversation and returning to the list, and MUST be cleared on leaving History.

**Reading a closed conversation**

- **FR-017**: A closed conversation MUST open in the place of the list, with a bar above it showing a control back to the list, the title and the closed state; the number of messages and the time of last activity are in the Overview.
- **FR-018**: A closed conversation MUST be read-only: no composer, and in its place a line stating that the conversation is closed, with a control leading to the current chat.
- **FR-019**: Messages of a closed conversation MUST be shown with the same content and message-level behaviour as the existing history view: thinking folded above the reply, cited sources that open and can be rated, ratings of replies, and loading of earlier messages.
- **FR-020**: A closed conversation MUST come with its Overview, with everything the side block of the existing conversation page shows: the number of messages and the time of last activity; Summary & insights (summary, sentiment, resolved state, language, topics, and a "no summary yet" state); Navigation, which lists the person's and the agent's messages and scrolls to the one picked; and Export.
- **FR-021**: Export MUST offer every format the existing history offers and produce the same files.
- **FR-022**: Escape MUST go one step back: from a closed conversation to the list, from the list to the chat; in the chat it MUST do nothing. An open popover, dialog or Overview opened over the messages takes Escape first.
- **FR-032**: In a panel wide enough for both, the Overview MUST stand beside the messages. In a narrower panel it MUST be closed by default and opened and closed by an Overview control in the bar, shown over the messages; picking a message in Navigation MUST close it and show that message.
- **FR-023**: The conversation being read MUST be addressable: reloading the page or opening its link MUST show the same agent and conversation, and the browser's Back MUST return one step, the same as Escape.

**Navigation**

- **FR-024**: The Agents and History tabs MUST be removed from the app console's top bar.
- **FR-025**: The address of the old History page MUST lead to the agents workspace; the address of a conversation on the old page MUST lead to that conversation inside its agent.
- **FR-026**: No link, button or text in the app console, the landing page or shared-link pages may still point a person at a separate History page.

**New chat**

- **FR-027**: New chat MUST keep its present behaviour, confirmation and unavailable states; after it succeeds the panel MUST be in the Chat position, the History counter MUST reflect the newly closed conversation, and the list MUST contain it without a manual sync.

**Access and privacy**

- **FR-028**: A person MUST see only their own conversations, and only with agents they can currently reach; narrowing the list to one agent MUST NOT make any other person's conversation, or a conversation with an unreachable agent, visible or countable.
- **FR-029**: History and reading MUST be available to everyone who can open the agent, with no difference by role.

**Layout and language**

- **FR-030**: Every view in this feature MUST work in the wide list view, in the narrow panel of the Orbit view and at a phone width of 390 px, without sideways scrolling or overlapping controls; when labels do not fit, the switch and New chat MUST fall back to icons while the counter stays visible.
- **FR-031**: All new text MUST be available in every language the app console offers; dates, times and numbers MUST follow the active language. Conversation titles, messages and summaries are shown as received.

### Key Entities

- **Conversation**: one exchange between one person and one agent. Has a title, the last message, a count of messages, the time of last activity, and a state: running (at most one per person and agent) or closed. A closed conversation may carry a summary and an assessment of whether the matter was resolved.
- **Agent**: the one the conversation is with; the panel always shows the conversations of exactly one agent.
- **Message**: one entry of a conversation, from the person or from the agent, possibly with the agent's thinking, cited sources and the person's rating.
- **Panel view**: what the agent panel is showing for this person right now: the chat, the list, or one closed conversation. It belongs to the screen, not to the conversation, and is not stored for next time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open chat, a person reaches the text of any conversation they had with that agent in the last week in at most two clicks and under 10 seconds, without leaving the agent.
- **SC-002**: From a closed conversation, a person is back in the current chat, ready to type, in one click or two presses of Escape.
- **SC-003**: With 200 conversations with one agent, the list appears within 1 second of choosing History, and a search shows its result within 1 second of the last keystroke.
- **SC-004**: 100% of rows in an agent's History belong to that agent and that person; a person with conversations with five agents never sees a row of another agent, or of another person, in any of the five.
- **SC-005**: Everything the old History page offered for one conversation (messages, sources, ratings, counts, summary and insights, navigation between messages, export in all formats) is reachable from inside the agent; the files exported from the same conversation before and after the change are identical.
- **SC-009**: In a conversation of 200 messages, a person reaches any message listed in Navigation in at most two clicks, in the wide view and in the narrow panel.
- **SC-006**: All acceptance scenarios pass at 1440 px wide, in the Orbit view's narrow panel and at 390 px, with no sideways scrolling and no clipped or overlapping control.
- **SC-007**: Every saved link to the old History page or to a conversation on it leads to a working screen; none ends in an error page.
- **SC-008**: Switching to History and back during an answer loses nothing: the full answer and any unsent text are present in 100% of attempts.

## Assumptions

- **Scope is the app console.** The admin console keeps its own Chats page, which lists conversations of all people and channels and serves a different job. The twin slices were looked at; nothing in this feature changes what an Admin sees.
- **The assistant (Rancher) is an agent like any other here.** Its panel gets the same switch and history.
- **One running conversation per person and agent**, as today. The old page's Current / Earlier filter is therefore not needed inside an agent: the running conversation is a row at the top, everything else is closed.
- **No new filtering is built.** Filtering conversations by agent and by text already works for the admin list, which only an Owner or an Admin may ask for and which covers everyone's conversations. The list of a person's own conversations was deliberately left without those two filters; it now accepts them, on top of its present rule (own conversations, reachable agents only), so the answer never contains anything the unfiltered list would not.
- **Search behaves as the existing text filter does**; the list tells the person it covers the title and the last message, as the prototype states. Searching inside the full text of conversations is a different feature.
- **The Overview replaces the prototype's Summary and Export buttons.** The prototype put those two in the bar and left the rest of the old side block out; the whole block stays instead, so the bar carries one Overview control, and only where the panel is too narrow to show the block beside the messages.
- **"This week" means the six days before today**, not the calendar week, so a conversation from yesterday is never under Earlier on a Monday.
- **The view is not remembered between visits.** An agent always opens in the chat; the address of a closed conversation is the only way to arrive elsewhere.
- **A closed conversation cannot be reopened or continued**, as today; continuing means the current chat.
- **Shared-link pages are unchanged.** A visitor on a shared link has no history, as today; only links that pointed at the old History page are redirected.
- **Message-level rating in the live chat is not part of this** (CLEAN-148 covers it); ratings stay where they already work, in closed conversations.
- The prototype's demo data, colours and exact pixel sizes are illustrative. Layout, grouping, wording and behaviour of variant A are the reference; the app's existing visual language is the source for styling.
