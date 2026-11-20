# Feature Specification: Identity boundaries in chat and consoles

**Feature Branch**: `fix/CLEAN-236-identity-boundaries`

**Created**: 2026-11-20

**Status**: Draft

**Ticket**: [CLEAN-236](https://dreamvention.atlassian.net/browse/CLEAN-236)

**Input**: User description: "смотри, аноним не должен подключать внешних агентов вообще. его задача лишь пользоваться агентом, а не хоть как нибудь настраивать его. у юзера есть возможность подключать a2a, через чат, но только своих доступных агентов. а если агент указывается как внешний, то главное чтобы это был не наш ranch агент, чтобы закрыть эту дыру. и исправь проблему общего хранилища ключа, а так же clientID сделай уникальный для любого админа. закроем все эти проблемы"

## Background

Agent access by role (specs/032, CLEAN-231 and CLEAN-232) decided which agents
an account reaches and made the Ranch assistant act with the power of the
person asking. Verifying it on the live installation showed three places where
one identity still spills into another:

1. **Colleagues of an agent ignore the access lists.** An agent can hand a
   question to another agent, its colleague. That connection is treated as a
   setting of the asking agent, so almost nothing asks whether the person in
   front of it reaches the colleague: not the list of colleagues, not the
   history of what was handed over, not the hand-over itself, not removal.
   And an agent connects its own colleagues for anybody who asks in the chat:
   a User limited to one agent was told the names of all 23 (reproduced), and
   any Admin can read the public card of any agent, the Ranch assistant
   included (reproduced). The full list is in
   [a2a-access-analysis.md](./a2a-access-analysis.md).
2. **Both consoles share one sign-in.** Signing in to the management console
   as the Owner silently turned the user console, open in the same browser as
   a User, into the Owner at its next renewal (reproduced). Signing out of one
   ends the other.
3. **Every Owner and Admin is the same chat participant.** They share one
   conversation per agent, so an Admin reads what the Owner wrote, and a
   message sent while the agent is busy joins the turn that is running, which
   keeps the power of whoever started it.

Terms used below:

- **Caller**: whoever a chat message to an agent comes from.
- **Anonymous caller**: a caller the installation cannot tie to an account. A
  visitor of a share link, of an embedded chat or of a public agent page, and
  a messenger user.
- **Signed-in person**: an Owner, Admin or User writing from a console.
- **Reach** and **manage**: as in specs/032. An account reaches an agent when
  its access lists let it see and use the agent. A person manages an agent
  when they are the Owner, an Admin who reaches it, or the account that
  created it and still reaches it. The Ranch assistant is managed by the
  Owner only.
- **Colleague**: an agent another agent may hand a question to. A *Ranch
  colleague* lives on this installation. An *outside colleague* lives
  elsewhere and is known by its address.
- **Connection**: the record that makes one agent the colleague of another.
  It has a direction: the colleague gains nothing in return. Below, A is the
  agent that asks and B the colleague.
- **Open to visitors**: a mark on a connection. Without it the connection
  serves only people who reach the colleague. With it the colleague serves
  everybody who talks to the asking agent.
- **Hand-over**: one question passed from an agent to a colleague. A **chain**
  is a hand-over whose colleague hands over again.
- **Console**: the management console or the user console. **Sign-in**: one
  person's session in one console.
- **Conversation**: the history between one person and one agent.

## Clarifications

### Session 2026-11-20

- Q: A User connects B to A. An Admin manages A and does not reach B. What
  does the Admin see, and may they cut the connection? → A: Nothing, and no.
  The rule adopted for the whole feature: **a connection A→B exists for a
  person only when that person reaches B.** It is asked wherever a connection
  is shown, used or changed. For that Admin, A has no colleague B: it is not
  in A's list of colleagues, A does not know it in their conversation, and
  there is nothing to remove.
- Q: Whom does a colleague serve when a User who does not manage the agent
  connected it? → A: Settled by the rule above. Whoever reaches the colleague,
  and nobody else. The connection gives nobody anything they could not get by
  asking the colleague themselves, so a User may make it.
- Q: How does a colleague come to serve anonymous callers, who reach nothing?
  → A: Only through a connection marked open to visitors. The mark is set by
  somebody who manages both agents, since it publishes the colleague to
  everyone who can talk to the asking agent.
- Q: A person reaches A and C, not B, and the only way from A to C is through
  B. May the chain run with B masked? → A: Masking is adopted, for the case
  where B legitimately works for the person: a connection open to visitors.
  There B is shown as an unnamed colleague to anybody who does not reach it.
  Through an ordinary connection the chain does not run for that person: if
  it did, an agent hidden from them would be working on their question, which
  is what the rule above forbids. They ask C themselves, or A is connected to
  C.
- Q: What becomes of the conversation all administrators shared with an
  agent? → A: It stays with the Owner only, as the Owner's own conversation.
  Admins start with an empty one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An anonymous caller uses an agent and configures nothing (Priority: P1)

A visitor opens a public agent and writes: "which agents are on this server?",
"connect yourself to the agent at this address", "drop your colleague X". The
agent answers that it cannot do that for them, and nothing about the agent
changes. Ordinary questions are answered as before, with the help of the
colleagues opened to visitors.

**Why this priority**: A public agent is reachable by anyone on the internet.
Today such a visitor can point it at a server of their own choosing, after
which the questions the agent hands over leave the installation.

**Independent Test**: As a share-link visitor of a test agent, ask it to list
the agents of the Ranch, to connect a Ranch agent, to connect an outside
address, and to remove a colleague. Compare the agent's colleagues before and
after.

**Acceptance Scenarios**:

1. **Given** an anonymous caller, **When** they ask the agent which agents
   exist on the Ranch, **Then** no agent is named and no count is given.
2. **Given** an anonymous caller, **When** they ask the agent to connect a
   Ranch agent, an outside address or a pasted agent card, **Then** nothing is
   connected and the agent says this is not available to them.
3. **Given** an anonymous caller and an agent with colleagues, **When** they
   ask the agent to remove one, **Then** every colleague stays.
4. **Given** an anonymous caller, **When** they ask the agent to look at an
   address and say what agent lives there, **Then** the agent does not read
   it as an agent card for them.
5. **Given** an agent with one colleague open to visitors and one that is
   not, **When** an anonymous caller asks a question either could answer,
   **Then** only the open one is asked, and the caller is shown that a
   colleague was asked, without its name.

---

### User Story 2 - A connection exists for a person only when they reach the colleague (Priority: P1)

A User who reaches agents A and B connects B to A in the chat. An Admin
manages A and does not reach B. On A's page the Admin sees no such colleague.
When the Admin talks to A, A answers on its own: it does not know B in that
conversation, does not name it, and cannot be asked to remove it. The User,
and anybody else who reaches B, gets A with B's help.

**Why this priority**: Today whoever manages A reads B's name, card and
answers, and can cut the connection, whatever their access to B. That makes
every connection a window onto a hidden agent.

**Independent Test**: As the Owner, connect B to A. As an Admin who manages A
and is denied B, open A's colleagues and its hand-over history, ask A who its
colleagues are, ask A a question only B can answer, and try to remove the
connection by its id.

**Acceptance Scenarios**:

1. **Given** an Admin who manages A and does not reach B, **When** they open
   A's colleagues, **Then** B is not listed and nothing shows that a
   colleague is missing.
2. **Given** the same Admin, **When** they open the history of what A handed
   over, **Then** no hand-over to B is listed.
3. **Given** the same Admin talking to A, **When** they ask who A's
   colleagues are, or name B outright, **Then** A answers as an agent that
   has no such colleague.
4. **Given** the same Admin talking to A, **When** they ask something only B
   could answer, **Then** A does not ask B, and nothing of B's reaches the
   answer.
5. **Given** the same Admin, **When** they try to remove or re-read the
   connection by its exact id, in the console or through an agent, **Then**
   the answer is the one given for an id that does not exist.
6. **Given** a User who reaches A and B, **When** they ask A the same
   question, **Then** A asks B and says the answer came from it.
7. **Given** an Admin who reads any agent's public card by its id, **When**
   the agent is one they do not manage, **Then** the answer is the one given
   for an agent that does not exist.
8. **Given** the Owner denies B to a person who used it through A, **When**
   that person next talks to A, **Then** B is gone for them at once, with no
   change to the connection.

---

### User Story 3 - A signed-in person connects only the agents they reach (Priority: P1)

A User who reaches three agents writes to one of them: "who could you work
with here?" The agent names the other two and nobody else. The User asks it
to connect one of them, and it does. Asked to connect an agent the User does
not reach, by name or by id, the agent answers exactly as it would for an
agent that does not exist. The same rule holds in the chat with the agent,
through the Ranch assistant and on the agent's page in the console.

**Why this priority**: Connecting is how a hidden agent's answers were one
request away. One rule in all three places also ends the current state, where
the console asks for much and the chat for nothing.

**Independent Test**: Limit a test User to two agents. From the chat of one,
ask for the list of agents, connect the other, then try to connect a third by
its id.

**Acceptance Scenarios**:

1. **Given** a User who reaches agents A, B and C out of twenty, **When** they
   ask A which agents it could work with, **Then** A names B and C only, and
   gives no total.
2. **Given** the same User, **When** they ask A to connect B, **Then** B
   becomes A's colleague for everybody who reaches B.
3. **Given** the same User, **When** they ask A to connect an agent they do
   not reach, by its exact id, **Then** the answer is the one given for an id
   that does not exist, and nothing is connected.
4. **Given** the Owner, **When** they ask any agent to connect any other,
   **Then** it works as today.
5. **Given** anybody but the Owner, **When** they try to connect the Ranch
   assistant to an agent, or an agent to the Ranch assistant, **Then** it is
   refused as not found, as today.
6. **Given** an installation where connecting colleagues from the chat is
   switched off, **When** any person asks an agent to connect one, **Then**
   it is refused for everyone, as today.

---

### User Story 4 - An outside address is never a way to this Ranch's agents (Priority: P1)

A signed-in person may give an agent the address of an agent that lives
somewhere else. If the address leads to this installation, in any spelling,
the agent refuses: Ranch agents are connected by name, where the access rule
is asked. An outside colleague added by somebody who manages the agent serves
everybody the agent talks to. One added by anybody else is that person's own.

**Why this priority**: Without the first half, Story 3 has a side door.
Without the second, a User decides where other people's questions are sent,
and whose text is put in front of the agent on every turn.

**Independent Test**: As a User, give a test agent the published address of
another agent of the same Ranch, in several spellings, then a real outside
address. As a second User, ask the agent a question the outside agent would
answer.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they give the agent the address of
   an agent on this Ranch, **Then** nothing is connected and the agent says
   that an address of this Ranch is not accepted there.
2. **Given** the same person, **When** they vary the spelling of that address
   (letter case, an explicit port, encoded characters, doubled slashes, a
   trailing dot), **Then** every variant is refused the same way.
3. **Given** an agent card pasted as text, or published on another server,
   whose service address is on this Ranch, or an outside address that
   redirects to this Ranch, **When** the person asks to connect it, **Then**
   it is refused the same way.
4. **Given** an address on this Ranch that names no existing agent, **When**
   the person asks to connect or preview it, **Then** the answer is the same
   as for one that names an existing agent.
5. **Given** a User who does not manage the agent and connected a real
   outside agent, **When** another person or an anonymous caller talks to the
   agent, **Then** the outside agent is not asked for them, and nothing from
   its card is part of their conversation.
6. **Given** the same connection, **When** somebody who manages the agent
   opens its colleagues, **Then** they see it, with who added it, and can
   remove it.
7. **Given** somebody who manages the agent and connects a real outside
   agent, **When** any caller talks to the agent, **Then** it works as today.

---

### User Story 5 - Every administrator has their own conversation with an agent (Priority: P1)

The Owner and two Admins all talk to the same agent. Each sees only what they
wrote and what the agent answered them. When one of them writes while the
agent is still working on somebody else's request, the message is handled as
its own request: it never becomes part of the other person's. The agent still
knows each of them is an administrator.

**Why this priority**: A request that an Admin slips into the Owner's running
turn is carried out with the Owner's power. That is the escalation specs/032
closed everywhere else.

**Independent Test**: Sign in as the Owner and as an Admin in two browsers.
Each sends a message to the same agent. Check each one's chat window, then
have the Admin write while a long Owner request is running and check whose
power the Admin's request ran with.

**Acceptance Scenarios**:

1. **Given** the Owner and an Admin who both wrote to agent A, **When** each
   opens the chat with A, **Then** each sees their own messages and answers
   only.
2. **Given** the Owner's request is running on A, **When** an Admin writes to
   A, **Then** the Admin's message is handled as the Admin's own request,
   with the Admin's power, and the Owner's request does not see it.
3. **Given** two people talking to A at once, **When** A hands a question of
   one of them to a colleague, **Then** the progress of that hand-over
   appears in that person's chat only.
4. **Given** one administrator on two devices or in both consoles, **When**
   they open the chat with A, **Then** they see the same conversation of
   their own in each.
5. **Given** an administrator talking to an agent that asks visitors for an
   access code or approval, **When** they write to it, **Then** they are let
   through as today, and are not counted as a visitor against the agent's
   request limits.
6. **Given** a caller who is not the Owner, **When** they try to present
   themselves as the old shared administrators' identity, **Then** they are
   refused.
7. **Given** the upgrade, **When** the Owner opens the chat with an agent,
   **Then** the conversation the administrators shared is there as the
   Owner's own, and an Admin opening the same chat finds it empty.

---

### User Story 6 - Opening a colleague to visitors (Priority: P2)

A front-desk agent is public. Behind it works a specialist agent that visitors
must never open directly. Somebody who manages both marks the connection open
to visitors. From then on the specialist answers through the front desk for
everybody. People who do not reach the specialist, visitors included, are
shown that a colleague was asked, never which one.

**Why this priority**: It is the one legitimate way an agent serves people who
do not reach it, and it has to be a decision somebody with authority over both
agents makes, not a side effect of a connection.

**Independent Test**: As an Admin who manages A and only reaches B, try to
open the connection A→B to visitors. As the Owner, open it. As a share-link
visitor of A, ask a question B answers.

**Acceptance Scenarios**:

1. **Given** a person who manages A and does not manage B, **When** they try
   to open A→B to visitors, **Then** it is refused.
2. **Given** a person who manages both, **When** they open A→B to visitors,
   **Then** they are told this lets everybody who talks to A be served by B,
   and it takes effect after they confirm.
3. **Given** an open connection, **When** a caller who does not reach B asks A
   a question B answers, **Then** B is asked, and the caller sees that a
   colleague was asked, with no name and nothing else that identifies B.
4. **Given** an open connection and somebody who manages A and does not reach
   B, **When** they open A's colleagues, **Then** they see one unnamed
   colleague, marked as open to visitors and as outside their access, which
   they cannot change.
5. **Given** an open connection, **When** somebody who manages both closes it,
   **Then** B again serves only the people who reach it.
6. **Given** a chain A→B→C with a caller who reaches A and C and not B,
   **When** A→B is not open to visitors, **Then** the chain does not run for
   them. **When** it is open, **Then** it runs, B is shown unnamed and C by
   name.

---

### User Story 7 - A handed-over question is a colleague's, not a visitor's (Priority: P2)

When A hands a question to B, B treats it as work from a colleague. It does
not ask the colleague for an access code, and it does not let the question
change B's own settings, whatever the question says. Whoever manages B sees
that the conversation came from a colleague, named only when they reach it.

**Why this priority**: Today B takes a handed-over question for an unknown
visitor. An agent that asks visitors for a code answers its colleague with
that request, which is recorded as the answer. And a visitor's tools at B
include the ones that rewire B.

**Independent Test**: Connect B to A, with B asking visitors for approval.
Ask A something B answers. Then ask A to tell B to connect itself to another
agent.

**Acceptance Scenarios**:

1. **Given** B asks visitors for a code or approval, **When** A hands it a
   question, **Then** B answers the question.
2. **Given** a hand-over to B, **When** the question tells B to connect,
   remove or list colleagues, or to change anything else about itself,
   **Then** B does none of it.
3. **Given** the Owner asks A something and A hands it to B, **When** B works
   on it, **Then** B acts with no more power than it has for a visitor: the
   Owner's power does not travel with the question.
4. **Given** a hand-over to B on behalf of a person, **When** B would hand it
   on to C, **Then** it does so only when that person reaches C or B→C is
   open to visitors.
5. **Given** somebody who manages B, **When** they open B's conversations,
   **Then** a handed-over one is marked as coming from a colleague, with the
   colleague's name only when they reach it, and never its id.
6. **Given** two questions handed to B at the same moment, **When** either
   would loop back or exceed the allowed length of a chain, **Then** it is
   refused as it would be alone.

---

### User Story 8 - Each console keeps its own sign-in (Priority: P2)

A person keeps the management console open as the Owner and the user console
open as a test User in the same browser. Each console stays who it is for as
long as its sign-in lasts. Signing in or out of one changes nothing in the
other.

**Why this priority**: Not a way in for an outsider (the second password is
still needed), but a console that changes account behind the person's back
shows them, and lets them act with, an account they did not choose there.

**Independent Test**: In one browser profile sign in to the user console as a
User and to the management console as the Owner. Leave both open past a
renewal, reload both, sign out of one.

**Acceptance Scenarios**:

1. **Given** the user console signed in as a User, **When** the same browser
   signs in to the management console as the Owner, **Then** the user console
   remains the User after its next renewal and after a reload.
2. **Given** both consoles signed in, **When** the person signs out of one,
   **Then** the other stays signed in.
3. **Given** only the management console signed in, **When** the person opens
   the user console, **Then** it asks them to sign in.
4. **Given** a sign-in made in one console, **When** it is presented to the
   other console, **Then** it is not accepted.
5. **Given** an account whose password is changed, whose sessions an
   administrator ends, or which is removed, **When** that happens, **Then**
   its sign-ins end in both consoles, as today.
6. **Given** a User account, **When** it is used at the management console,
   **Then** it is refused as today, and a sign-in of that User in the user
   console is untouched.

---

### User Story 9 - A connection says who made it (Priority: P3)

On an agent's page each colleague shows who connected it and when: a person
by name, or that the connection predates the record. A person who made a
connection can remove it. Otherwise removal takes somebody who manages the
agent and reaches the colleague.

**Why this priority**: Until now a colleague that appeared on an agent could
not be traced to anybody, and anybody talking to the agent could drop it.

**Independent Test**: As a User, connect a colleague from the chat. As the
Owner, read who connected it. As the User, ask the agent to remove a colleague
the Owner connected, then their own.

**Acceptance Scenarios**:

1. **Given** a colleague connected from the chat by a User, **When** somebody
   who manages the agent and reaches the colleague opens the agent's
   colleagues, **Then** the User's name and the date are shown for it.
2. **Given** a colleague connected by an administrator, **When** a User who
   does not manage the agent asks the agent to remove it, **Then** it is
   refused and the colleague stays.
3. **Given** a colleague the User connected, **When** the User asks the agent
   to remove it and confirms, **Then** it is removed.
4. **Given** a connection made before this feature, **When** it is shown,
   **Then** it says it predates the record.

---

### Edge Cases

- **A person loses reach of a colleague they connected.** The connection
  stays and keeps serving whoever reaches the colleague. For that person it
  no longer exists, their own authorship included.
- **Nobody who talks to A reaches B any more.** The connection is idle. The
  Owner sees it and can remove it.
- **A colleague is deleted.** Its connections disappear with it, as today.
- **The person who made a connection is removed.** The connection stays and
  shows that the account no longer exists.
- **An outside agent later moves to an address of this Ranch.** A connection
  that was accepted is re-checked whenever its card is read again, and stops
  working once it leads to this installation.
- **A scheduled job or a heartbeat of the agent, with nobody behind it.** It
  changes no colleagues, and it uses only connections open to visitors: a
  turn nobody asked for has no person whose reach could be asked. The same
  holds for a job that delivers its result to a person: it ran without them.
- **A messenger administrator named in the agent's own configuration.** Not
  an account of the Ranch, so the installation cannot say what they reach.
  For colleagues they are an anonymous caller.
- **A person who manages A reads another person's conversation with A.** They
  see what that person saw, B's name and answers included. Reading
  conversations is not narrowed by this feature.
- **An agent's own memory.** What an agent wrote down from one conversation
  it may repeat in another. Not narrowed by this feature either.
- **A connection that exists at the upgrade.** It serves everybody today.
  It is kept open to visitors so that nothing stops answering, and listed for
  the Owner as needing a look.
- **Both consoles are served from one host**, as in local development. The
  sign-ins are still separate.
- **A person was signed in before the upgrade.** That sign-in cannot be said
  to belong to either console. Each console asks them to sign in once.
- **Two tabs of one console, two accounts.** Out of scope: one console in one
  browser profile is one account, and specs/032 already makes a switch carry
  nothing over.
- **A scheduled job that was created from the shared administrators'
  conversation.** Its results go where that conversation went: to the Owner.
- **An agent that has not restarted since the upgrade.** It keeps answering
  administrators, at worst as ordinary signed-in people (it may ask for an
  access code). It never treats anybody as an administrator who is not one.

## Requirements *(mandatory)*

### Functional Requirements

**Colleagues: the rule**

- **FR-001**: A connection A→B to a Ranch colleague MUST exist for a signed-in
  person only when that person reaches B. For anybody else it MUST be
  indistinguishable from a connection that was never made, wherever a
  connection is shown, used or changed, unless it is open to visitors
  (FR-014).
- **FR-002**: FR-001 MUST be asked when the connection is used, not when it
  is made: a change to a person's access takes effect on their next message,
  with no change to any connection.
- **FR-003**: The Owner reaches every agent and so is served and shown every
  connection.

**Colleagues: seeing**

- **FR-004**: An agent's list of colleagues and the history of what it handed
  over MUST be shown only to a person who manages the agent, and MUST contain
  only the connections that exist for that person. No count, gap or other
  sign of the rest may appear.
- **FR-005**: What an agent knows of its colleagues in a conversation MUST be
  only the colleagues that serve that caller. The agent MUST NOT be able to
  name, describe or ask any other, whatever the caller says, including in a
  refusal.
- **FR-006**: The progress of a hand-over MUST be shown to the caller whose
  question it is, in their conversation only, even when other people are
  talking to the same agent at that moment.
- **FR-007**: An agent MUST tell a caller which agents live on the Ranch only
  when the caller is a signed-in person, and then MUST name only the agents
  that person reaches, with no total.
- **FR-008**: The card an agent publishes to its colleagues MUST be readable
  only by a colleague connected to it and by a person who manages the agent.
  For anybody else the answer MUST be the one given for an agent that does
  not exist.

**Colleagues: changing**

- **FR-009**: An anonymous caller MUST NOT be able to add, replace, remove or
  inspect a colleague of an agent, read an address as an agent card, or have
  the agent list the Ranch's agents. The refusal MUST say that this needs a
  signed-in person, and MUST NOT name agents or point to a console.
- **FR-010**: A signed-in person MUST be able to connect a Ranch colleague B
  to an agent A when they reach both, and only then. For an agent they do not
  reach, the answer MUST be the same as for an agent that does not exist. The
  rule about B MUST be the same in the chat with A, through the Ranch
  assistant and on A's page in the console. The last two stay management
  surfaces, open to a person who manages A.
- **FR-011**: A connection MUST be removable, after confirmation, by the
  person who made it, and by a person who manages A and for whom the
  connection exists. By nobody else.
- **FR-012**: A turn the agent started for itself, a messenger administrator
  who is not an account of the Ranch, and a question handed over by another
  agent MUST NOT add, remove or inspect colleagues.
- **FR-013**: Connecting the Ranch assistant on either end MUST stay with the
  Owner, and the installation-wide switch that turns connecting from the chat
  off MUST keep turning it off for everybody.

**Colleagues: open to visitors**

- **FR-014**: A connection marked open to visitors MUST serve every caller of
  A: anonymous callers, and signed-in people who do not reach B.
- **FR-015**: Only a person who manages both A and B MUST be able to set or
  clear the mark. Setting it MUST require confirmation that states what it
  opens.
- **FR-016**: To a caller who does not reach B, an open connection MUST be
  shown as an unnamed colleague: no name, no id, no address, nothing else
  that identifies B, in the chat and in every list. A person who manages A
  and does not reach B sees it so, marked as outside their access, and
  cannot change or remove it.
- **FR-017**: A caller with no signed-in person behind it (an anonymous
  caller, a scheduled turn, a messenger user) MUST be served only by
  connections open to visitors.

**Colleagues: outside addresses**

- **FR-018**: Only a signed-in person MUST be able to have an agent preview or
  connect an outside colleague, by address or from a card given as text.
- **FR-019**: An address that leads to this installation MUST be refused as an
  outside colleague, whatever its spelling, whether it is the address given,
  the address inside the card, or where a redirect ends. The check MUST be
  made on preview, on connecting and on every later re-read of the card. The
  refusal MUST be identical whether or not the address names an existing
  agent.
- **FR-020**: An outside colleague connected by a person who manages A MUST
  serve every caller of A, as today. One connected by anybody else MUST serve
  only the person who connected it, and nothing from its card may be part of
  anybody else's conversation with A.
- **FR-021**: Every outside colleague of A MUST be shown, with who connected
  it, to a person who manages A, who MUST be able to remove it.

**Colleagues: hand-overs**

- **FR-022**: A question handed to B MUST be treated by B as a colleague's:
  B's rules for admitting visitors do not apply to it.
- **FR-023**: A hand-over MUST NOT carry the power of the person it is made
  for. While working on it, B MUST NOT manage or configure anything, itself
  included.
- **FR-024**: Every hand-over of a chain MUST be checked against the person
  the chain was started for: a further colleague is asked only when that
  person reaches it or the connection is open to visitors. A chain started
  for nobody uses only connections open to visitors.
- **FR-025**: The limit on the length of a chain and the refusal of a loop
  MUST hold for every hand-over, however many arrive at an agent at once.
- **FR-026**: In B's list of conversations a handed-over conversation MUST be
  marked as coming from a colleague, named only for a viewer who reaches that
  colleague, and MUST never show its id.
- **FR-027**: The result of a hand-over MUST be readable only by the
  connection it was made through.

**Colleagues: the record**

- **FR-028**: Every connection MUST record who made it and when, and whether
  and by whom it was opened to visitors. A connection made before this
  feature MUST be shown as predating the record.
- **FR-029**: A connection that exists at the upgrade MUST keep serving
  everybody it serves today, as one open to visitors, and MUST be listed for
  the Owner as needing review.

**Conversations of administrators**

- **FR-030**: Every Owner and Admin MUST have a conversation of their own with
  each agent, the same in both consoles and on every device of theirs. No
  person's chat window may show another person's messages or the agent's
  answers to them, live or from history.
- **FR-031**: A message MUST join a running turn only when that turn belongs
  to the same person in the same conversation. A turn MUST act with the power
  of the person who started it and of nobody whose message arrived later.
- **FR-032**: An Owner or Admin MUST keep everything else the agent gives an
  administrator today: no access code or approval is asked of them, guidance
  meant for administrators is shown to them, and they are not counted as
  visitors against the agent's request limits.
- **FR-033**: The identity all administrators shared MUST stop being shared:
  nobody but the Owner may obtain it, write under it or read under it.
- **FR-034**: The conversation the administrators shared with each agent
  before the upgrade MUST become the Owner's own conversation with that
  agent, and the Owner continues it. No Admin's conversation may contain any
  of it. Whatever was addressed to the shared conversation, a scheduled job's
  results included, MUST be delivered to the Owner's.
- **FR-035**: In an agent's list of conversations each administrator's
  conversation MUST appear under that person's name. Who may read it follows
  the rule that list already has: those who manage the agent.

**Sign-ins**

- **FR-036**: A sign-in MUST belong to the console it was made in. Signing in
  to, renewing in, or signing out of one console MUST NOT sign in, change the
  account of, or sign out the other, in the same browser or anywhere else.
- **FR-037**: A sign-in made in one console MUST NOT be accepted by the other
  for renewal or for anything else.
- **FR-038**: FR-036 MUST hold when both consoles are served from the same
  host.
- **FR-039**: Whatever ends all of an account's sign-ins today (a password
  change, removal of the account, an administrator ending its sessions) MUST
  keep ending them in both consoles.
- **FR-040**: Sign-ins that exist at the moment of the upgrade MUST end. Each
  console asks for a sign-in once and says the session has ended, without an
  error.

**Rollout**

- **FR-041**: At no point of the upgrade, including while some agents still
  run the previous version, may a caller be treated as an administrator, or
  be served a colleague or a list of agents, that this specification denies
  them. An administrator may be asked for an access code by an agent that has
  not restarted yet. Nothing else may be lost.

### Key Entities

- **Connection**: one agent's right to hand questions to another. Gains who
  made it and when, whether it is open to visitors and who opened it, and,
  for an outside colleague added by somebody who does not manage the agent,
  the one person it serves.
- **Hand-over**: one question passed over a connection, with its answer.
  Gains the person the chain was started for, used to ask about reach and for
  nothing else.
- **Conversation**: the history between one person and one agent. For
  administrators it stops being one shared history per agent and becomes one
  per person, as it already is for Users. The shared one becomes the Owner's.
- **Sign-in**: one person's session. Gains the console it belongs to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across every anonymous entry (share link, embedded chat, public
  agent page, messenger), 0 of the requests to list agents, preview an
  address, connect or remove a colleague succeed, and the agent's colleagues
  are identical before and after the attempts.
- **SC-002**: For a person who manages A and does not reach B, with A→B not
  open to visitors, 0 of the following show any trace of B: A's colleagues,
  A's hand-over history, A's answers to them about its colleagues, A's answer
  to a question only B could answer, the fleet map, B's public card. An
  attempt to remove the connection by its id is answered as for an id that
  does not exist.
- **SC-003**: A person who reaches N agents is named exactly the other N-1 by
  any agent they ask, and can connect exactly those. No name and no count of
  any other agent appears in any answer.
- **SC-004**: Every tested spelling and indirection of an address of this
  installation (at least: plain, changed case, explicit port, encoded path,
  doubled slashes, trailing dot, inside a pasted card, inside a card hosted
  elsewhere, behind a redirect) is refused as an outside colleague, while a
  real outside agent is still connected on the first request.
- **SC-005**: With a connection open to visitors, a caller who does not reach
  the colleague gets its answer in 100% of matching questions and its name in
  0% of them.
- **SC-006**: A question handed to an agent that asks visitors for a code is
  answered, never met with the request for a code, and no instruction inside
  a handed-over question changes the receiving agent's settings in any
  attempt.
- **SC-007**: With two people writing to the same agent at the same time, 0
  messages, answers or hand-over steps of one are visible to the other, and 0
  requests run with the power of anybody but their sender.
- **SC-008**: With two accounts in two consoles of one browser, each console
  shows its own account through a full working day, including renewals,
  reloads and a sign-out of the other console.
- **SC-009**: An administrator talking to an agent after the upgrade is asked
  for nothing they were not asked for before: no access code, no approval,
  and no visitor limit.
- **SC-010**: For every colleague of every agent, the Owner can say who
  connected it and who opened it to visitors, or that it predates the record.

## Assumptions

- The model in [a2a-access-analysis.md](./a2a-access-analysis.md) is accepted
  as a whole. Its findings are the list this feature is checked against.
- What a colleague can do is necessarily known to the agent that asks it, so
  an unnamed colleague is hidden by name, id and address, not by ability.
- A messenger user is anonymous to the Ranch even when the agent's own
  configuration names them its administrator. They keep what that role gives
  them inside the agent.
- Questions handed over by a colleague stay outside the receiving agent's
  request limits, as today. Opening a connection to visitors therefore puts
  the colleague behind the asking agent's limits only, which is why it takes
  somebody who manages both.
- Whoever manages the receiving agent is not given a list of the agents
  connected to it, nor a way to cut them, beyond what FR-026 shows. With the
  rule of FR-001 a connection made without them serves only people who reach
  their agent already.
- A scheduled turn uses only connections open to visitors (FR-017). A job a
  User set up to ask a colleague stops asking it unless the connection is
  opened. Nothing known depends on that today.
- No internal connection exists on the main installation today, so FR-029
  matters for forks. A fork with connections reviews them once.
- Separate sign-ins mean an Owner who works in both consoles signs in to each.
  That is the intended cost of FR-036, not a regression to fix.
- People are signed out once by the upgrade (FR-040). No notice period is
  planned.
- The shared conversation becomes the Owner's with the messages Admins wrote
  in it. They were visible to the Owner already.
- The agent runtime changes with this feature: it recognises a console
  administrator by the shared identity today, and has no notion of a
  colleague's question. Agents take the new runtime on restart. The release
  order is a planning matter, bounded by FR-041.
- Out of scope, each known and left for its own ticket: a console setting for
  how an agent admits visitors; the Ranch assistant's duplicated tool server;
  truncation of long lists in the assistant's answers; trimming tools that do
  not come from the Ranch by caller; what an agent's own memory carries from
  one conversation to another.
- specs/032 stays in force. This feature changes none of its rules and
  relies on its definitions of reach, manage and ceiling.
