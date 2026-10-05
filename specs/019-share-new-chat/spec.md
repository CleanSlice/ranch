# Feature Specification: "New Chat", Full History and the Pinned Ranch Agent in the Customer Console

**Feature Branch**: `feat/CLEAN-136-share-new-chat`

**Created**: 2026-10-02

**Status**: Draft

**Ticket**: [CLEAN-136](https://dreamvention.atlassian.net/browse/CLEAN-136)

**Input**: User description: "Проанализируй кнопку "New Chat" то, что именно она делает, стирает ли полностью контекст, освобождает память или прочее. После найденного проанализируй, насколько это корректно относильно базового поведения нового чата в любой другой LLM, и сама задача, в share окне добавить кнопку нового чата, так как там она опущена"

**Scope update (2026-10-02, at planning)**: "нужно добавить кнопку new chat в share и app экраны" — the customer console's own chat is in scope alongside the share page.

**Scope update (2026-10-02, after a production check)**: "почему … не видно сообщений пользователя в app, а так же в app не закреплен Rancher агент, как это в admin сделано" → "включи оба в CLEAN-136". Two more gaps between the consoles are in scope: the customer console chat does not show the conversation the server holds, and its agent list does not pin the Ranch admin agent.

## Background

An agent can be opened in three places: the **admin console** chat (the team
operating the platform), the **customer console** chat (a signed-in person
talking to an agent), and the **share page** — a public link handed to people
outside the product. A person on the share page is a *visitor*: no account, one
conversation with the agent, remembered per browser.

Only the admin console chat has a "New chat" button. The share page and the
customer console chat have none, so a visitor or a console user is locked into
a single conversation with each agent. A conversation that went wrong, got too
long, or simply belongs to a different question cannot be left behind.

### What "New chat" does today (admin console)

| Question | Finding |
|----------|---------|
| Is the conversation wiped from the screen? | Yes — messages, thinking steps, debug traces and messages still waiting to be delivered are all dropped. |
| Is the agent's context for this conversation erased? | Yes, when the agent is online: the stored conversation is deleted and the running agent is told to forget its own copy, so the next message starts from nothing. The confirmation dialog still warns that context "may persist until the next restart" — that warning is out of date. |
| Is the old conversation kept anywhere? | No. It is deleted for good. A second, non-destructive path exists that sets the conversation aside instead of deleting it, but no screen uses it. |
| Is the agent's long-term memory erased? | No. Notes the agent promoted into its long-term memory during the conversation survive and are available in every later conversation. |
| Are uploaded files freed? | No. Files attached to the old conversation stay in storage. |
| What if the agent is mid-answer? | Not handled. The button stays enabled while the agent is answering, and nothing stops that answer from arriving in the new conversation. |
| What if the reset fails? | It is reported as success: the screen empties, and the old conversation comes back on the next reload. |
| What if the agent is offline? | The button is hidden, because an offline agent cannot be told to forget and would bring the old conversation back when it returns. |
| Does everyone looking at the conversation see the reset? | No. The customer console keeps its own copy of the conversation in the browser, so a conversation reset from the admin console stays on a console user's screen indefinitely. |

### How that compares with "New chat" elsewhere

In mainstream assistants (ChatGPT, Claude, Gemini and their peers) "New chat"
means the same four things everywhere:

1. The new conversation starts with **no context** from the previous one.
2. The previous conversation is **kept**, not destroyed — it stays in a history
   list, which is why no confirmation is asked.
3. Anything the product calls **memory** is a separate, longer-lived thing and
   survives a new chat.
4. An answer still being written for the old conversation **never appears** in
   the new one.

Against that baseline, today's button is right on points 1 and 3, and wrong on
2 and 4: it destroys instead of keeping, and it does not protect the new
conversation from a late answer. It also has one failure no mainstream product
has — reporting a failed reset as a clean slate.

This feature brings "New chat" to the share page and to the customer console
chat, and builds it to the baseline rather than copying the admin console's
gaps.

### Two more gaps found on the way

**The customer console shows only what this browser has seen.** The admin
console loads a conversation from the server when it opens. The customer
console shows the copy kept in the browser and nothing else. Checked on
production on 2026-10-02 with an owner account: the conversation with the Ranch
admin agent holds 14 messages on the server, 5 of them the person's, and the
server returns all of them — which is what the admin console loads. The
customer console never asks for them: in a browser that was not there when they
were written it has nothing to show. The one way the customer console ever
catches up from the server restores the agent's answers only, so a person can
find answers on screen with no questions above them. Whatever was written in
the admin console, on another device or in another browser is missing.

This is also why a reset made in the admin console never reaches a console
user, and it would leave "New chat" half true: an agent that forgot, in front
of a screen that did not.

**The Ranch admin agent is not pinned.** The admin console puts the Ranch admin
agent ("Rancher") first in the agent list and marks it. The customer console
lists agents newest first and does not know which one is the admin agent; on
production Rancher, the oldest agent, is the last of 22.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor starts over with a clean conversation (Priority: P1)

A visitor has been talking to a shared agent. The conversation drifted, or they
have a new, unrelated question. They press "New chat" on the share page,
confirm, and get an empty conversation. The agent answers the next message as
if meeting them for the first time in this conversation: nothing said earlier
is referred to or assumed.

**Why this priority**: This is the reported gap. Without it a visitor has no
way out of a conversation, and a long or confused conversation makes every
later answer worse.

**Independent Test**: Open a share link, tell the agent a made-up code word,
press "New chat", then ask for the code word. The screen is empty after the
reset and the agent does not know the word.

**Acceptance Scenarios**:

1. **Given** a visitor with at least one message in the conversation and the
   agent available, **When** they press "New chat" and confirm, **Then** the
   conversation area is empty and shows the same starting state as a first
   visit.
2. **Given** a visitor who told the agent a fact and then started a new chat,
   **When** they ask about that fact, **Then** the agent's answer shows no
   knowledge of the previous conversation.
3. **Given** a visitor who started a new chat, **When** they reload the page or
   open the same link in another tab of the same browser, **Then** they see the
   new conversation, never the old one.
4. **Given** a visitor who pressed "New chat", **When** the confirmation is
   shown and they cancel, **Then** nothing changes and the conversation
   continues.
5. **Given** a conversation with no messages yet, **When** the visitor looks at
   the "New chat" action, **Then** it is not available — there is nothing to
   start over from.
6. **Given** a visitor using the share page in Russian, **When** they use "New
   chat", **Then** the button, the confirmation and any message about the
   outcome are in Russian.

---

### User Story 2 - Console user starts over and keeps the old conversation (Priority: P1)

A signed-in person is talking to an agent in the customer console. They press
"New chat" in the chat header, confirm, and get an empty conversation with an
agent that remembers nothing of the previous one. The conversation they left is
not lost: it is in their chat history as an earlier conversation they can open
and read.

**Why this priority**: Same gap as the visitor's, on the screen the product's
own customers use every day. Keeping the old conversation in history is what
makes this "New chat" rather than "delete chat".

**Independent Test**: In the console, tell an agent a made-up code word, press
"New chat", ask for the code word, then open chat history. The agent does not
know the word, and the earlier conversation — code word included — is in
history, marked as closed.

**Acceptance Scenarios**:

1. **Given** a console user with at least one message in the conversation and
   the agent available, **When** they press "New chat" and confirm, **Then**
   the conversation area is empty and the agent answers without any context
   from before.
2. **Given** a console user who started a new chat, **When** they open their
   chat history, **Then** the conversation they left is there, complete,
   readable and marked as closed, and the new conversation appears separately
   once it has messages.
3. **Given** a console user who started several new chats with the same agent,
   **When** they open their chat history, **Then** each closed conversation is
   listed on its own.
4. **Given** a conversation that several people share — everyone with the
   owner or admin role talks to an agent in one common conversation — **When**
   one of them starts a new chat, **Then** everyone who has that conversation
   open, in either console, sees it become empty without reloading.
5. **Given** a console user in Russian, **When** they use "New chat" and open
   the closed conversation in history, **Then** every label is in Russian.

---

### User Story 3 - A new chat never pretends (Priority: P2)

Starting over either truly happens or visibly does not. Nobody is shown an
empty conversation while the old one is still alive behind it, and an answer
that belonged to the old conversation never lands in the new one. This holds
on the share page and in the console alike.

**Why this priority**: A false clean slate is worse than no button. The person
believes the agent forgot, shares something on that assumption, and the agent
answers with the old context — or the old conversation reappears on reload.

**Independent Test**: Trigger a reset while the agent is unavailable, while it
is mid-answer, and with the network cut; in each case confirm that the person
ends up either with a real new conversation or with the old one intact and a
message saying why.

**Acceptance Scenarios**:

1. **Given** the agent cannot be reached to forget the conversation, **When**
   the person looks at the "New chat" action, **Then** it is unavailable and
   the page says why.
2. **Given** a reset that fails partway, **When** the failure is known,
   **Then** the old conversation stays on screen untouched and the person is
   told the new chat could not be started.
3. **Given** the agent is in the middle of an answer, **When** the person tries
   to start a new chat, **Then** no part of that answer appears in the new
   conversation, now or after a reload.
4. **Given** the share link was revoked while the page was open, **When** the
   visitor tries to start a new chat, **Then** they see the same "link no
   longer works" state as for any other action, and nothing is reset.
5. **Given** a message that had not been delivered and files staged in the
   composer, **When** the person starts a new chat, **Then** neither is sent
   into the new conversation.

---

### User Story 4 - The owner keeps what a visitor left behind (Priority: P3)

The team that runs the agent reviews what visitors asked. When a visitor starts
a new chat, the conversation they closed does not disappear: it is still in the
agent's conversation history as a closed conversation, and the visitor's next
messages appear as a separate, new one.

**Why this priority**: Visitors are anonymous and outside the product; their
conversations are the only record of how a shared agent is used. A
visitor-controlled button that erased that record would let any visitor delete
the audit trail.

**Independent Test**: As a visitor, hold a conversation, start a new chat, send
one more message. In the admin console's conversation history, find two
conversations for that visitor — the closed one, complete, and the new one.

**Acceptance Scenarios**:

1. **Given** a visitor closed a conversation by starting a new chat, **When**
   the agent's conversation history is opened, **Then** the closed conversation
   is listed once, complete and readable, and marked as closed.
2. **Given** the same visitor starts several new chats over time, **When** the
   history is opened, **Then** each closed conversation is listed separately
   and none overwrote another.
3. **Given** a visitor started a new chat, **When** the visitor looks for the
   previous conversation, **Then** it is not offered to them — the share page
   has no history list.
4. **Given** a closed conversation had ratings or a summary attached, **When**
   it is opened in history, **Then** they are still attached to it.

---

### User Story 5 - The conversation is the same wherever it is opened (Priority: P1)

A person opens an agent's chat in the customer console — on a new laptop, in
another browser, or after talking to the same agent in the admin console — and
sees the conversation as it is: their own messages and the agent's, in order,
with earlier ones a scroll away. The share page follows the same rule for a
visitor's own conversation.

**Why this priority**: Today the console shows answers without questions, or
nothing at all, for a conversation that exists. It is a visible defect on its
own, and "New chat" depends on it: a screen that shows its own saved copy
cannot honestly show that a conversation was closed.

**Independent Test**: Hold a conversation with an agent in the admin console.
Open the same agent in the customer console in a browser that has never opened
it. The same messages are there, the person's included.

**Acceptance Scenarios**:

1. **Given** a conversation written in the admin console, **When** the same
   person opens that agent in the customer console in a fresh browser, **Then**
   they see the same messages — theirs and the agent's — in the same order.
2. **Given** a conversation longer than one screenful of history, **When** the
   person scrolls to the top, **Then** earlier messages are loaded above and
   the place they were reading does not jump.
3. **Given** a conversation the person is in the middle of, **When** they
   reload the page, **Then** every message appears exactly once, and a message
   that had not been delivered is still shown as not delivered.
4. **Given** a message sent with a file, **When** the conversation is opened
   elsewhere, **Then** the message shows its attachment.
5. **Given** the history cannot be loaded, **When** the chat opens, **Then**
   it shows what this browser has, stays usable, and catches up on the next
   successful load.
6. **Given** a conversation that was reset while this device was switched off,
   **When** the person next opens it there, **Then** they see the new
   conversation, not the one that was closed.

---

### User Story 6 - The Ranch admin agent is first in the list (Priority: P3)

A person opens the agents area of the customer console. The Ranch admin agent
is the first entry in the agent list and carries a mark saying what it is, as
in the admin console. The other agents keep their order.

**Why this priority**: A convenience, and a small one — but with twenty agents
the one that manages the rest is at the bottom of the list, below the fold.

**Independent Test**: With at least three agents, one of them the Ranch admin
agent and not the newest, open the agents area. It is first and marked.

**Acceptance Scenarios**:

1. **Given** a list where the Ranch admin agent is not the newest, **When** the
   agents area opens, **Then** it is the first entry and carries the admin
   mark; the rest are in their usual order.
2. **Given** a search term that does not match the admin agent, **When** the
   list is filtered, **Then** it is hidden like any other non-matching agent.
3. **Given** no agent is the admin agent, **When** the list opens, **Then** it
   looks as it does today.
4. **Given** a person returning to the agents area, **When** it picks the agent
   to open, **Then** it still opens the one they used last — the pin changes
   the order of the list, not where the person lands.

---

### Edge Cases

- **Two tabs, one person**: a reset in one tab while another tab shows the old
  messages. The other tab becomes empty on its own; if it was offline at the
  time, it becomes empty when it reconnects or reloads.
- **A second device that was away**: a console user's other device was switched
  off when the reset happened. On its next open it loads the conversation from
  the server and shows the new one (User Story 5, scenario 6).
- **History that is seconds behind**: the server's copy of a conversation can
  trail the live exchange by a moment. A reload right after an answer still
  shows that answer, once.
- **The same sentence twice**: a person who sends "ok" twice sees two messages
  after a reload, not one and not three.
- **More than one admin agent**: if several agents are flagged, all of them
  come first, in their usual order among themselves.
- **Double press**: pressing confirm twice, or pressing "New chat" again before
  the first reset finished, results in exactly one reset and one closed
  conversation in history.
- **Nothing stored yet**: the first message is still on its way and no
  conversation has been saved; starting a new chat still ends with an empty
  conversation and does not create an empty closed conversation.
- **The last exchange**: a reset pressed seconds after the agent's answer still
  closes a conversation that contains that answer.
- **Regenerated link**: a visitor who opens a replaced link keeps their
  identity and current conversation, and "New chat" resets it as usual.
- **Other people**: a visitor's new chat never touches another visitor's
  conversation, nor a console conversation. A console user's new chat never
  touches another user's conversation, except the one conversation owners and
  admins deliberately share.
- **Agent comes back**: the agent was unavailable when the page loaded and
  becomes available; the action becomes available without a reload.
- **Long-term memory**: someone starts a new chat to make the agent "forget
  everything". The conversation is forgotten; anything the agent had already
  promoted into its long-term memory is not. The wording must not promise more
  than a new conversation.
- **The landing page chat**: the demo chat on the landing page offers no "New
  chat"; a signed-in person resets the same conversation from the agent's page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The share page and the customer console's agent chat MUST each
  offer a "New chat" action whenever they show a working conversation.
- **FR-002**: The action MUST ask for confirmation before it takes effect. For
  a visitor the confirmation MUST say that the current conversation will be
  closed and cannot be returned to; for a console user it MUST say that the
  conversation moves to their history.
- **FR-003**: After a confirmed new chat, the person MUST see an empty
  conversation in the same starting state as a first visit, with an empty
  composer.
- **FR-004**: After a confirmed new chat, the agent MUST answer without any
  context from the closed conversation.
- **FR-005**: The new conversation MUST be what the person sees on every later
  load in the same browser; the closed conversation MUST NOT reappear in the
  live chat.
- **FR-006**: A new chat MUST affect only the conversation it was asked for. A
  person MUST NOT be able to reset a conversation that is not theirs.
- **FR-007**: A closed conversation MUST be preserved, complete and readable,
  as one separate closed entry in conversation history, together with whatever
  was attached to it (ratings, summary). Each new chat MUST add one such entry
  and MUST NOT replace an earlier one or leave a duplicate.
- **FR-008**: The action MUST be unavailable when the conversation is empty.
- **FR-009**: The action MUST be unavailable while a real reset cannot be
  guaranteed — while the agent cannot be reached to forget the conversation,
  and while the agent is still answering — and the page MUST make the reason
  visible.
- **FR-010**: If a new chat fails, the system MUST leave the existing
  conversation on screen unchanged, MUST say it could not be started, and MUST
  NOT show an empty conversation.
- **FR-011**: An answer, or any part of one, that belongs to the closed
  conversation MUST NOT appear in the new conversation.
- **FR-012**: Messages not yet delivered and files staged but not sent at the
  moment of the reset MUST be discarded, not carried into the new conversation.
- **FR-013**: Repeating the action before it completes MUST result in a single
  reset.
- **FR-014**: When the share link is no longer valid, the action MUST behave
  like every other action on the share page: the visitor sees the invalid-link
  state and nothing is reset.
- **FR-015**: Every piece of text the action shows — label, confirmation,
  reason, outcome — MUST be available in each language the customer console
  supports.
- **FR-016**: The action MUST NOT claim to erase the agent's long-term memory,
  and MUST NOT erase it.
- **FR-017**: The share page MUST NOT expose closed conversations to the
  visitor.
- **FR-018**: A console user MUST be able to find and read their own closed
  conversations in their chat history, distinguishable from current ones.
- **FR-019**: When a conversation is reset — from the share page, the customer
  console or the admin console — every screen that has that conversation open
  MUST show it empty without a reload.
- **FR-020**: The customer console chat and the share page MUST show a
  conversation as the server holds it — the person's messages and the agent's,
  in order — whichever console, browser or device they were written in.
- **FR-021**: Earlier parts of a long conversation MUST be reachable by
  scrolling up, loaded in pages, without moving what the person is reading.
- **FR-022**: Loading history MUST NOT duplicate or drop anything on screen: a
  message appears once; a message not yet delivered stays, with its state; an
  answer still being written stays.
- **FR-023**: A message sent with files MUST show those files as attachments
  when the conversation is loaded from history.
- **FR-024**: If history cannot be loaded, the chat MUST show what the browser
  has, stay usable, and MUST NOT present a conversation as empty that it merely
  failed to load.
- **FR-025**: A conversation that was closed while a device was away MUST NOT
  be shown on that device as the current one once history has loaded.
- **FR-026**: The customer console's agent list MUST show the Ranch admin agent
  first, marked as such; other agents keep their order, the name search applies
  to it like any other, and which agent opens on landing is unchanged.
- **FR-027**: The admin mark's label MUST be available in each language the
  customer console supports.

### Key Entities

- **Visitor**: an anonymous person using a share link, recognised by their
  browser. Has one current conversation per shared agent.
- **Console user**: a signed-in person. Has one current conversation per
  agent; people with the owner or admin role share a single one.
- **Current conversation**: the live exchange with the agent — what the chat
  shows and what the agent uses as context.
- **Closed conversation**: a conversation ended by starting a new chat.
  Read-only, timestamped by when it was closed, kept in conversation history.
- **Agent long-term memory**: what the agent has chosen to remember across all
  conversations. Not part of any single conversation and not affected by a new
  chat.
- **Conversation history**: the server's record of the current conversation —
  the authority for what was said. A browser's own saved copy is only what the
  server does not hold yet.
- **Ranch admin agent**: the agent flagged as the one that manages the install.
  At most one in practice; shown first and marked in both consoles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person gets from a running conversation to an empty one in two
  actions (press, confirm), and the empty conversation is on screen within 2
  seconds of confirming in at least 95% of resets.
- **SC-002**: In 100% of test runs, an agent asked about a fact stated only in
  the closed conversation does not know it.
- **SC-003**: In 100% of test runs, reloading the page after a new chat shows
  the new conversation; the closed one never returns to the live chat.
- **SC-004**: 100% of closed conversations are present, complete and listed
  exactly once in conversation history — visitors' in the admin console,
  console users' also in their own history.
- **SC-005**: Zero cases in which a new chat changes a conversation it was not
  asked for.
- **SC-006**: In 100% of failed resets, the person still has their original
  conversation and has been told the new chat did not start.
- **SC-007**: Zero cases in which an answer to the closed conversation appears
  in the new one, including when the reset is attempted mid-answer.
- **SC-008**: Every other screen showing the same conversation is empty within
  2 seconds of the reset, without a reload.
- **SC-009**: A conversation opened in the customer console in a fresh browser
  shows the same latest messages as the admin console shows for it — the
  person's included — within 2 seconds of the chat opening, in 100% of test
  runs.
- **SC-010**: Zero duplicated and zero missing messages across 20 reloads at
  different moments of a conversation: idle, mid-answer, right after an answer,
  with an undelivered message.
- **SC-011**: The Ranch admin agent is the first entry of the agent list in
  100% of loads where the person can see it.

## Assumptions

- **Keep, don't destroy.** A new chat from the share page or the customer
  console sets the old conversation aside rather than deleting it. The product
  already has a non-destructive way to do this, currently unused; this feature
  relies on it.
- **Confirmation is kept**, although mainstream products ask for none. A
  visitor loses access to the old conversation for good, and a console user's
  reset may empty a conversation colleagues share, so one confirmation is the
  honest trade.
- **No visitor-facing history.** A list of past conversations on the share page
  is a separate feature and out of scope.
- **Console history shows the person's own conversations.** Closed ones are
  added to that same history; reading a visitor's conversations remains an
  admin console capability.
- **Long-term memory is out of scope.** What an agent remembers across
  conversations, and whether a shared agent should remember anything about
  anonymous visitors at all, is a separate question and is not changed here.
- **Uploaded files stay.** Files attached to a closed conversation remain with
  it; reclaiming their storage is out of scope.
- **Admin console button is not redesigned here.** It keeps deleting rather
  than keeping, and its outdated warning and unguarded mid-answer reset are
  recorded for a follow-up ticket. What changes for the admin console is only
  what FR-019 needs: a reset made anywhere reaches every open screen, and a
  reset made there reaches the customer console.
- **The landing page demo chat is out of scope.** It shows the same
  conversation as the agent's page for a signed-in person, and an anonymous
  demo visitor has nothing worth keeping.
- **Identity is as today.** A visitor is recognised per browser; a different
  browser or cleared site data is a different visitor with a different
  conversation.
- **History comes from where the admin console's comes from.** The same server
  record, the same paging. Anything that record does not carry — the agent's
  thinking steps, for one — is not part of loaded history in either console.
- **The pin follows the list.** The Ranch admin agent is pinned for whoever has
  it in their agent list. Who may see or talk to it is not changed here.
- **Landing is unchanged.** The customer console keeps opening the agent the
  person used last (spec 006, FR-020); it does not start landing on the admin
  agent the way the admin console does.
