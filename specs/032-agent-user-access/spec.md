# Feature Specification: Agent access by role

**Feature Branch**: `feat/CLEAN-231-agent-user-access`

**Created**: 2026-11-17

**Status**: Draft

**Ticket**: [CLEAN-231](https://dreamvention.atlassian.net/browse/CLEAN-231)

**Input**: User description: "Необходимо заняться разделением прав на агентов. Я себе представляю это так. Есть Owner/Admin/User. У Владельца будут все доступы и все настройки. Админ может настраивать агентов для разных юзеров, но при этом он не может давать доступ юзеру к тем агентам, которых нет у самого. При выдаче агентов юзеру я вижу это как блек и white листы. То есть изначально они пустые - все агенты разрешены. Но их можно настраивать, главное реализовать это таким образом, чтобы невозможно было вызвать коллизию в списках. Если добавить агента в черный список, в белом он должен исчезнуть. Так как пагинации нет, тут проще всего будет фильтровать. Владелец конечно может вертеть доступами как угодно"

## Background

Ranch already has three roles for people: Owner (exactly one), Admin and User.
The roles decide what a person may *do* (manage users, deploy agents, change
settings), but not *which agents* they may do it with: every signed-in account
sees and can open every agent. This feature adds the second dimension.

Terms used below:

- **Allowed list** (the "white list") and **denied list** (the "black list") —
  two lists of agents kept per account.
- **Reach** — an account reaches an agent when it may see it, open it and use
  it in whatever way its role permits.
- **Ceiling** — the set of agents an Admin reaches. An Admin can never hand out
  more than that.

## Clarifications

### Session 2026-11-17

- Q: Should a User be able to pin agents in the user console? → A: Yes.
  Pinning is a personal convenience open to every account, whatever its role.
  Today the pin is one installation-wide mark that only the Owner and Admins
  may set, so a User's click is refused.
- Q: After signing out as the Owner and signing in as a User in the same
  browser, the Owner's chat with an agent was visible for about a second. Is
  that acceptable? → A: No. Nothing of the previous account may be shown, even
  briefly. Cause found: the browser keeps a copy of each conversation and the
  last opened agent so a reload is not blank; both are kept per agent, not per
  account, and survive sign-out. The live channel did not send anything wrong.
- Q: What becomes of the existing installation-wide pins once pinning is
  personal? → A: They are dropped. Pins are personal only; every account
  starts with none after the upgrade, and there is no "pinned for everyone".
- Q: What happens to an account when the only agent in its allowed list is
  deleted? → A: Deleting an agent never widens access. The account reaches no
  agents and is marked for review until its access is edited (FR-006).

- Q: The Ranch assistant cannot tell who is talking to it, so a User can ask
  it to delete any agent. Defer, or fix here? → A: Fix it, including in the
  agent runtime. The assistant must act with the power of the person asking,
  never with its own. Tracked as CLEAN-232 and delivered first.
- Q: Are comparable routes closed to a User? → A: No. Audit of 2026-11-17:
  137 of 252 routes accept any signed-in account whatever its role, among them
  model credentials with their keys, installation settings, agent secrets and
  files, templates, skills, knowledge bases, logs and usage. The user console
  itself calls only the agent routes. These are closed under CLEAN-232 too.

- Q: How is the person the assistant acts for established? → A: By a token
  the service itself issues, so it cannot be forged. Never by what the agent
  says about the person.
- Q: If Users later get to create agents in the user console, will the
  assistant refuse a User who asks to delete an agent they created? → A: It
  must not. Who created an agent is recorded from now on (it is not recorded
  today), and one rule decides who may manage an agent: the Owner, an Admin
  who reaches it, or its creator. Opening creation to Users is out of scope
  here; the rule must already cover it.
- Q: When a User asked the assistant to delete an agent, it attempted two
  tools, both failed with "Session not found", and it then described the
  management console and other workarounds. What should it do? → A: Answer at
  once and plainly, according to who it is talking to and where. It must know
  the person's role and which console they are in, offer only what they can
  do, and suggest nothing they cannot. The lost connection behind that error
  must repair itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Owner decides which agents an account gets (Priority: P1)

The Owner opens a person's account in the management console and sees two
lists, allowed and denied, both empty: the person reaches every agent. The
Owner moves a few agents into the denied list, or picks the handful the person
should have and puts them in the allowed list. From that moment the person sees
and can use exactly those agents, everywhere.

**Why this priority**: This is the feature. Without it there is nothing to
delegate to Admins and nothing to enforce. It is also useful alone: an
installation with one Owner and several Users is fully served by this story.

**Independent Test**: As Owner, restrict one User account, sign in as that
User, and confirm the agent list, direct links and chat all honour the lists.

**Acceptance Scenarios**:

1. **Given** an account with both lists empty, **When** its holder opens the
   agent list, **Then** every agent is there, including one created a minute
   ago.
2. **Given** an account with agent A in the denied list and an empty allowed
   list, **When** its holder opens the agent list, **Then** every agent except
   A is there, and a newly created agent appears too.
3. **Given** an account with agents A and B in the allowed list, **When** its
   holder opens the agent list, **Then** only A and B are there, and a newly
   created agent does not appear.
4. **Given** agent A is in an account's allowed list, **When** the Owner adds A
   to that account's denied list, **Then** A is no longer in the allowed list,
   and the console shows it in the denied list only.
5. **Given** agent A is in an account's denied list, **When** the Owner adds A
   to that account's allowed list, **Then** A is no longer in the denied list.
6. **Given** a person whose account does not reach agent A, **When** they open
   a saved link to A or to one of its chats, **Then** they are refused exactly
   as if the agent did not exist.
7. **Given** a person has agent A open, **When** the Owner denies A for their
   account, **Then** their next action on A is refused and A is gone from
   their lists without them signing in again.
8. **Given** the Owner removes the last agent from an account's allowed list,
   **When** the console is about to save, **Then** it states that the account
   will reach every agent that is not denied, and saves only after the Owner
   confirms.

---

### User Story 2 - An Admin hands out agents, within their own ceiling (Priority: P2)

An Admin opens a User's account and manages the same two lists. The Admin sees
and can pick only the agents they reach themselves. Whatever they do, the User
never ends up reaching an agent the Admin does not reach.

**Why this priority**: Delegation is what makes the feature scale past one
Owner, and the ceiling is the security promise of the whole design. It depends
on Story 1 for the lists and their enforcement.

**Independent Test**: As Owner, limit an Admin to agents A and B. As that
Admin, edit a User and confirm that no sequence of edits lets the User reach
agent C.

**Acceptance Scenarios**:

1. **Given** an Admin who reaches A and B only, **When** they edit a User,
   **Then** only A and B are offered for either list.
2. **Given** that Admin and a User whose allowed list is A, **When** the Admin
   adds B to the User's allowed list, **Then** the User reaches A and B.
3. **Given** that Admin and a User whose allowed list is A, **When** the Admin
   tries to remove A, leaving the allowed list empty, **Then** the change is
   refused with an explanation: it would open agents the Admin does not have.
4. **Given** that Admin and a User whose lists also mention agent C, **When**
   the Admin saves any change, **Then** the entries about C are unchanged, and
   the Admin was never shown C by name.
5. **Given** an Admin whose own lists are empty, **When** they edit a User,
   **Then** every agent is offered and no change is refused on ceiling grounds.
6. **Given** an Admin, **When** they try to change their own access, another
   Admin's, or the Owner's, **Then** the change is refused.
7. **Given** a request that bypasses the console and names an agent outside
   the Admin's ceiling, **When** it is sent, **Then** it is refused in full and
   nothing is saved.

---

### User Story 3 - The Owner limits an Admin (Priority: P3)

The Owner gives an Admin a subset of agents. In the management console that
Admin now sees, deploys, restarts, edits and deletes only those agents; the
others do not appear in lists, counters or search.

**Why this priority**: It is what gives Story 2 a ceiling other than
"everything". An installation where every Admin is trusted with every agent
works without it.

**Independent Test**: As Owner, deny agent C for an Admin, sign in as that
Admin and confirm C is absent from every screen and refused on direct access.

**Acceptance Scenarios**:

1. **Given** an Admin whose account does not reach agent C, **When** they open
   the management console, **Then** C is absent from the agent list, search,
   pinned agents and any summary that names agents.
2. **Given** that Admin, **When** they send a management action for C directly
   (restart, edit, delete, read its settings), **Then** it is refused.
3. **Given** an Admin whose allowed list is A and B, **When** they create a new
   agent D, **Then** D joins their allowed list and they keep working with it.
4. **Given** the Owner, **When** they open any account or any agent, **Then**
   nothing is hidden or refused, whatever lists exist.

---

### User Story 4 - The same through the Ranch assistant (Priority: P4)

A person who may manage access in the console asks the Ranch assistant in chat:
"which agents can Jane use?", "take the billing agent away from Jane", "let
Jane use only the support agent". The assistant does it under the same rules
and asks for confirmation before a change that removes or widens access.

**Why this priority**: The project rule is that a console capability is not
finished until the assistant can do it. It adds no new behaviour, so it comes
last, but the feature does not ship without it.

**Independent Test**: In chat, change a User's lists through the assistant and
confirm the console shows the same result; then ask for a change the ceiling
forbids and confirm the same refusal.

**Acceptance Scenarios**:

1. **Given** a person allowed to manage a User's access, **When** they ask the
   assistant what that User can reach, **Then** the answer matches the console.
2. **Given** the same person, **When** they ask the assistant for a change,
   **Then** the assistant states the resulting access and applies it only
   after a yes.
3. **Given** a person not allowed to make a change in the console, **When**
   they ask the assistant for it, **Then** it is refused for the same reason.
4. **Given** a person who does not reach agent C, **When** they ask the
   assistant to list, describe or act on agents, **Then** C is neither
   mentioned nor acted upon.

---

### User Story 5 - Nothing carries over between accounts in one browser (Priority: P1)

Two people share a computer, or one person tests with two accounts. The first
signs out, the second signs in. The second sees only what their own account
reaches, from the first frame: no chat, agent name, pin or list from the
previous account, not even for a moment.

**Why this priority**: Hiding an agent on the server is worth little if the
browser still shows the previous account's conversation with it. This was
observed in practice, and it is the one place where the access rule can be
broken without any request being wrongly answered.

**Independent Test**: Sign in as the Owner, open a chat with an agent and
exchange messages. Sign out, sign in as a User in the same browser and record
the screen: at no frame is the Owner's conversation or last opened agent
visible.

**Acceptance Scenarios**:

1. **Given** the Owner chatted with agent A and signed out, **When** a User
   signs in in the same browser and lands on agents, **Then** no message of
   the Owner's conversation is displayed at any moment.
2. **Given** the same sequence and a User who does not reach agent A, **When**
   the User lands on agents, **Then** A is not opened, named or shown, and the
   User lands on an agent they do reach, or on the empty state.
3. **Given** a person who reloads the page without changing account, **When**
   the page loads, **Then** their own conversation is restored at once, as
   today.
4. **Given** the Owner signed out, **When** the same Owner signs in again,
   **Then** their conversations are complete, restored from the server if the
   browser copy was removed.
5. **Given** a session that ended by itself (expired, revoked), **When**
   another account signs in in that browser, **Then** the same guarantees
   hold as after an explicit sign-out.

---

### User Story 6 - Everyone pins their own agents (Priority: P3)

A User pins the two agents they talk to most. Those agents move to the top of
that User's lists. Nobody else's order changes, and no management power is
needed.

**Why this priority**: A small convenience next to access control, but it is
broken for the largest group of people today, and it has to be settled here:
a pin is a statement about an agent an account reaches.

**Independent Test**: As a User, pin an agent and confirm it moves to the top
and stays there after a reload; sign in as another account and confirm its
order is unchanged.

**Acceptance Scenarios**:

1. **Given** a User who reaches agent A, **When** they pin A, **Then** A is at
   the top of their agent lists, at once and after a reload, on any device.
2. **Given** that User pinned A, **When** another account opens its agent
   lists, **Then** A is where it was for that account.
3. **Given** a User pinned A, **When** they unpin it, **Then** A returns to its
   ordinary place for them.
4. **Given** an account that does not reach agent C, **When** it tries to pin
   C by any means, **Then** it is refused as if C did not exist.

---

### User Story 7 - The assistant acts with the power of the person asking (Priority: P1)

Whoever talks to the Ranch assistant gets from it exactly what they could do
themselves in the consoles. A User who asks it to delete an agent is told it
cannot do that for them; an Admin gets what an Admin may do, for the agents
that Admin reaches; the Owner gets everything. The same holds for a visitor on
a share link and for someone writing to the assistant from a messenger.

**Why this priority**: Today the assistant acts with the Owner's power for
anyone, which makes every other rule in this document optional for whoever
opens a chat with it. Delivered first, under its own ticket.

**Independent Test**: Sign in as a User, open the Ranch assistant and ask it
to list users, read a setting and delete an agent. Each is refused, the
assistant does not offer those abilities, and nothing changes.

**Acceptance Scenarios**:

1. **Given** a User in a chat with the Ranch assistant, **When** they ask for
   any management action, **Then** the assistant has no such ability to offer,
   and a forced attempt is refused where the action is carried out.
2. **Given** an Admin limited to agents A and B, **When** they ask the
   assistant to list agents or to restart agent C, **Then** only A and B are
   listed and C is reported as not found.
3. **Given** the Owner, **When** they ask the assistant for anything it could
   do before, **Then** it still does it.
4. **Given** a visitor on a share link, an anonymous visitor or an unapproved
   messenger user, **When** they talk to an agent that has management
   abilities, **Then** none of those abilities is offered or usable.
5. **Given** a scheduled job or an administrator configured on the agent's
   messenger channel, **When** the assistant works for them, **Then** it keeps
   its full abilities, as today.
6. **Given** an agent running a version that does not say who is asking,
   **When** it attempts a management action, **Then** the action is refused.
7. **Given** a person asks the assistant to pin an agent, **When** it does so,
   **Then** the pin is that person's own.

---

### User Story 8 - Every route asks for a role (Priority: P1)

A person signed in as a User, calling the service directly instead of through
the console, can do nothing more than the user console lets them do.

**Why this priority**: The assistant is one way around the roles; calling the
routes directly is the other, and today it is wide open. Same ticket as
Story 7.

**Independent Test**: With a User's session, call every route of the service.
Only the routes on a short, reviewed list answer; the rest refuse.

**Acceptance Scenarios**:

1. **Given** a User's session, **When** it reads model credentials, settings,
   an agent's secrets, files, logs or usage, **Then** each is refused.
2. **Given** a User's session, **When** it creates, changes or deletes a
   template, a skill, a knowledge base, a setting or a credential, **Then**
   each is refused and nothing changes.
3. **Given** a route added later without a stated role, **When** the checks
   run, **Then** they fail until a role is stated for it.
4. **Given** an Admin or the Owner in the management console, **When** they
   use any screen, **Then** it works as before.
5. **Given** an agent's own runtime, **When** it calls the routes it uses
   today, **Then** they still answer.

---

### User Story 9 - The assistant knows whom it is talking to (Priority: P2)

A User in the user console asks the assistant for something only an
administrator can do. The first reply says, in a sentence, that their account
cannot do that. It does not try, does not fall back to other means, and does
not walk them through a management console they cannot open. An Admin or the
Owner asking the same thing gets it done.

**Why this priority**: Closing the hole (Story 7) makes the action
impossible; this makes the conversation honest about it. Without it the
assistant tries, fails and improvises.

**Independent Test**: As a User, ask the assistant to delete an agent. One
reply, a plain refusal, no attempt recorded. As the Owner, the same request
is carried out after confirmation.

**Acceptance Scenarios**:

1. **Given** a User in the user console, **When** they ask for a management
   action, **Then** the first reply is a plain refusal that names no
   workaround and no place they cannot go, and no action was attempted.
2. **Given** the Owner in the management console, **When** they ask for the
   same action, **Then** the assistant proceeds as it does today.
3. **Given** the service was restarted while a conversation was open,
   **When** the person asks for something the assistant can do, **Then** it
   is done without the agent being restarted.
4. **Given** the assistant cannot reach the service at all, **When** asked,
   **Then** it says so in a sentence and suggests nothing else.

---

### User Story 10 - An agent remembers who created it (Priority: P3)

Every agent created from now on records who created it, whether in a console
or through the assistant. The people who manage the agent can see it. The
record is what will let a User, once Users can create agents, manage exactly
their own.

**Why this priority**: Nothing visible changes for Users today, since they
cannot create agents. It is here because adding it later would mean agents
with no known creator and a second pass over every rule.

**Independent Test**: Create an agent as an Admin in the console and another
by asking the assistant; both show that Admin as creator. Check the rule: a
creator who is not an Admin may manage that agent and no other.

**Acceptance Scenarios**:

1. **Given** an Admin creates an agent in the console, **When** its details
   are opened, **Then** the creator is shown.
2. **Given** a person asks the assistant to create an agent, **When** it is
   created, **Then** the creator is that person, not the assistant.
3. **Given** an agent that existed before this feature, **When** its details
   are opened, **Then** the creator is shown as unknown.
4. **Given** the creator's account is deleted, **When** the agent's details
   are opened, **Then** the agent is intact and the creator is shown as a
   removed account.
5. **Given** an account that created agent X and is not an Admin, **When** the
   rule is asked whether it may manage X and agent Y, **Then** the answer is
   yes for X and no for Y.

---

### Edge Cases

- **An agent is deleted while it is the only entry of someone's allowed
  list.** Deleting an agent must never widen anyone's access. The account does
  not fall back to "every agent": it reaches no agents and is flagged in user
  management as needing review, until someone with the right edits its access.
- **A deleted agent sits in a denied list.** The entry disappears with the
  agent; nothing else changes.
- **Two people edit the same account's access at once.** The result is one of
  the two edits, or a refusal for the later one. Never a merge that puts an
  agent in both lists, and never a merge that breaks the Admin's ceiling.
- **Both lists are non-empty.** The denied entries are redundant while the
  allowed list restricts the account, and are kept: they apply again the day
  the allowed list is emptied.
- **Every agent is denied.** The account reaches nothing and sees an empty
  state that says access is managed by an administrator, not an error.
- **A User is promoted to Admin, or an Admin demoted.** The lists stay as they
  are. What changes is what the role lets the person do with the agents they
  reach.
- **An account becomes the Owner, or stops being it.** While it is the Owner
  its lists are ignored, not erased.
- **The Owner narrows an Admin after that Admin handed agents out.** Users keep
  what they were given. The ceiling limits what an Admin can grant from now on;
  it does not reach back.
- **A person loses an agent they had pinned or had open in a chat.** The pin
  and the chat disappear from their view; the conversation history is not
  deleted and returns if access returns.
- **An agent was pinned for everyone before the upgrade.** It returns to its
  ordinary place for everyone; whoever wants it on top pins it for themselves.
- **The agent an account is denied is the Ranch assistant itself.** Allowed:
  the person simply has no assistant. The Owner cannot be affected.
- **A restricted Admin sees a User with empty lists.** The User reaches agents
  the Admin does not. The Admin may deny or allow agents within their own
  ceiling; they are told, without names, that the account also has access
  they cannot manage.

## Requirements *(mandatory)*

### Functional Requirements

**The access rule**

- **FR-001**: Each Admin and User account MUST have an allowed list and a
  denied list of agents, both empty when the account is created.
- **FR-002**: An account MUST reach an agent when, and only when, the agent is
  not in its denied list and its allowed list is either empty or contains the
  agent.
- **FR-003**: The Owner MUST reach every agent and every setting regardless of
  any list.
- **FR-004**: An agent MUST never be in both lists of one account. Adding it to
  one list MUST remove it from the other in the same change, and no sequence
  of edits, simultaneous or not, may leave it in both.
- **FR-005**: An agent MUST appear at most once in a list, and a list MUST
  never keep an entry for an agent that no longer exists.
- **FR-006**: Deleting an agent MUST NOT make any account reach an agent it did
  not reach before. An account whose allowed list loses its last entry this
  way MUST reach no agents and be marked for review.

**Enforcement**

- **FR-007**: The rule MUST be enforced on every route to an agent, not only
  in lists: opening it by direct link, chatting with it, reading its history,
  files, settings, logs and usage, and every management action.
- **FR-008**: An agent an account does not reach MUST be indistinguishable from
  an agent that does not exist: not listed, not counted, not suggested by
  search, not named in errors.
- **FR-009**: Agent lists MUST be produced by filtering the full set of agents
  against the account's lists at the moment of the request, so that a change
  in access needs no rebuild or re-sign-in to take effect.
- **FR-010**: A change in access MUST apply to the affected person's very next
  action, including in a session that is already open.
- **FR-011**: Access through an agent's public or shared link, and through
  channels outside the consoles, MUST be unaffected by these lists.

**Who may change what**

- **FR-012**: The Owner MUST be able to view and change the lists of any Admin
  or User account without restriction.
- **FR-013**: An Admin MUST be able to view and change the lists of User
  accounts, and MUST NOT be able to change their own, another Admin's or the
  Owner's.
- **FR-014**: A User MUST NOT be able to view or change any lists, their own
  included.
- **FR-015**: When an Admin edits a User, only agents the Admin reaches MUST be
  shown and selectable.
- **FR-016**: A change made by an Admin MUST be refused, in full, if after it
  the User would reach an agent that the User did not reach before and the
  Admin does not reach.
- **FR-017**: Entries in a User's lists about agents the Admin does not reach
  MUST survive the Admin's edit unchanged and MUST NOT be revealed by name.
  The Admin MUST be told that such entries exist.
- **FR-018**: A refused change MUST say why in terms the person can act on
  (for example, "this would open agents you do not have; ask the Owner").
- **FR-019**: The ceiling MUST be checked where the change is applied, so that
  it holds for any client, not only the console's own screens.

**Editing experience**

- **FR-020**: The access editor MUST show, for one account, both lists and a
  plain statement of the result ("reaches every agent", "reaches every agent
  except 2", "reaches only these 3", "reaches no agents").
- **FR-021**: Before saving a change that turns a restricted account into one
  that reaches every non-denied agent, the editor MUST state that outcome and
  require confirmation.
- **FR-022**: User management MUST show at a glance which accounts are
  restricted and which are marked for review.
- **FR-023**: An agent created by an Admin whose allowed list is not empty
  MUST be added to that Admin's allowed list.
- **FR-024**: Installations that upgrade MUST start with empty lists for every
  existing account, so nobody's access changes on upgrade.

**Ranch assistant**

- **FR-025**: Viewing and changing an account's agent access MUST be available
  through the Ranch assistant to the same people, under the same rules and
  with the same refusals as in the console.
- **FR-026**: The assistant MUST ask for confirmation before any change of
  access, stating the resulting access first.
- **FR-027**: When the assistant acts for a person, it MUST list, describe and
  act on only the agents that person reaches.

**Switching accounts in one browser**

- **FR-028**: Anything the browser keeps to make a reload fast (conversation
  copies, the last opened agent, list and view state that names agents) MUST
  belong to one account and MUST never be displayed to another.
- **FR-029**: On sign-out, what the page holds about that account's agents and
  conversations MUST stop being displayed immediately, without waiting for a
  reload. When a session ends by itself (expiry, revocation) the page may stay
  behind the sign-in prompt so the same person can continue; if a different
  account signs in there, the page MUST be reset before anything is displayed
  to it.
- **FR-030**: After signing in, the first thing displayed MUST come from the
  new account's own data. A conversation or agent MUST NOT be drawn before it
  is known to belong to the signed-in account.
- **FR-031**: These guarantees MUST NOT cost a returning person their history:
  whatever the browser no longer keeps is restored from the server.

**Personal pins**

- **FR-032**: Every account, whatever its role, MUST be able to pin and unpin
  any agent it reaches, in the user console.
- **FR-033**: A pin MUST belong to the account that set it: it changes the
  order of that account's agent lists and nobody else's, and follows the
  account across devices.
- **FR-034**: Pinning MUST require no management power and MUST NOT change
  anything about the agent itself.
- **FR-035**: Pinning an agent the account does not reach MUST be refused under
  FR-008.
- **FR-036**: The installation-wide pin MUST cease to exist. On upgrade its
  marks are discarded, every account starts with no pins, and no role can pin
  an agent for anybody but itself.
- **FR-037**: Pinning through the Ranch assistant MUST act on the asking
  person's own pins only, in line with FR-033.

**Acting for a person (CLEAN-232)**

- **FR-038**: Every action an agent takes against the service on someone's
  behalf MUST state who that is: a signed-in person, a party the agent's own
  configuration trusts (a scheduled job, an administrator of its messenger
  channel), or a guest.
- **FR-039**: The service MUST grant such an action the lesser of what the
  agent may do and what the stated party may do. Stating a party MUST never
  give an agent more than it has without one.
- **FR-040**: For a signed-in person, the service MUST decide by that person's
  current role and agent access, read at the moment of the action, not by
  anything the agent says about them.
- **FR-041**: An action that states no party MUST be treated as a guest's.
- **FR-042**: A guest and a User MUST have no management ability through any
  agent. An agent MUST NOT offer an ability the person it is talking to cannot
  use.
- **FR-043**: What the Owner, a scheduled job and a trusted channel
  administrator can do through the assistant MUST be unchanged.

- **FR-048**: That an agent is acting for a particular signed-in person MUST
  be proven by something only the service can issue. An agent MUST NOT be
  able to produce, alter or reuse it for another person or another agent.
- **FR-049**: Such proof MUST stop working when the person's session ends and
  after a bounded time.
- **FR-050**: A party that is not a signed-in person (a scheduled job, a
  channel administrator named in the agent's configuration) MUST never have
  more than the agent itself has, and a guest MUST have no management
  ability.

**The assistant in context (CLEAN-232)**

- **FR-051**: In every conversation the assistant MUST know the role of the
  person it is talking to and which console they are in.
- **FR-052**: The abilities the assistant has in a conversation MUST be
  exactly those the person may use.
- **FR-053**: Asked for something the person cannot do, the assistant MUST say
  so in its first reply, in plain words, without attempting it, without
  another route, and without directing the person to a place they cannot
  open.
- **FR-054**: A lost connection between an agent and the service MUST repair
  itself on the next use. If it cannot, the assistant MUST say the service is
  unavailable and nothing else.

**Who created an agent (CLEAN-232)**

- **FR-055**: Every agent created from now on MUST record the account that
  created it, in a console or through the assistant. Agents that exist
  already have no recorded creator.
- **FR-056**: The creator MUST be visible to those who manage the agent, and
  an agent MUST survive the removal of its creator's account.
- **FR-057**: One rule MUST decide who may manage an agent, everywhere: the
  Owner; an Admin who reaches it; its creator, while they reach it.
- **FR-058**: That rule MUST already hold for a creator who is a User, so that
  letting Users create agents later needs no change to it. Letting them do so
  is not part of this feature.

**A role on every route (CLEAN-232)**

- **FR-044**: Every route of the service MUST state the least role that may
  call it. A route that states none MUST be refused to Users and to agents.
- **FR-045**: The routes open to a User MUST be only those the user console
  needs: their own session and profile, the agents they reach, their own
  conversations with those agents, sharing an agent they reach, and their
  pins.
- **FR-046**: The routes open to an agent's runtime MUST be only those it
  calls today, each stated explicitly.
- **FR-047**: The sets of routes open to the public, to a User and to an
  agent's runtime MUST each be pinned by an automated check that fails when a
  route joins a set without the check being updated.

### Key Entities

- **Pin**: A mark one account puts on one agent it reaches. Many accounts may
  pin the same agent independently.
- **Account**: A person's sign-in with one role: Owner, Admin or User. Exactly
  one Owner exists.
- **Agent**: A deployed assistant that accounts open and talk to.
- **Creator**: The account that created an agent. At most one per agent, may
  be unknown, never changes.
- **Agent access** (one per Admin or User account): the allowed list, the
  denied list, and whether the account is marked for review. Each list is a
  set of agents; the two sets never intersect.
- **Ceiling**: Not stored. The set of agents an Admin reaches at the moment
  they make a change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Owner or Admin can limit an account to a chosen set of agents
  in under one minute, starting from the user list.
- **SC-002**: Across every route to an agent (list, search, direct link, chat,
  history, files, settings, management actions, the assistant), 100% of
  attempts by an account that does not reach the agent are refused, and none
  reveals the agent's name.
- **SC-003**: Zero accounts ever hold the same agent in both lists, including
  under simultaneous edits of the same account.
- **SC-004**: Zero changes made by an Admin leave a User reaching an agent the
  Admin does not reach and the User did not reach before, including changes
  sent outside the console.
- **SC-005**: After an upgrade, every existing account reaches exactly the
  agents it reached before.
- **SC-006**: A change in access is in effect for the affected person within
  five seconds, without them signing in again.
- **SC-007**: Deleting an agent changes the set of other agents any account
  reaches in zero cases.
- **SC-008**: A person shown a refusal can tell, from the message alone, who
  to ask to get the change made.
- **SC-009**: After one account signs out and another signs in in the same
  browser, zero messages, agent names or pins of the first account are
  displayed, in any frame of a screen recording of the sign-in.
- **SC-010**: A User can pin an agent in one action, and the order of every
  other account's lists is unchanged by it.
- **SC-011**: Through a chat with any agent, a User, a share-link visitor and
  an anonymous visitor can complete zero management actions, out of every
  management ability the assistant has.
- **SC-013**: Asked by a User for a management action, the assistant refuses
  in its first reply with zero attempts, in 100% of the scripted requests.
- **SC-014**: After the service restarts, the assistant's next action for a
  person succeeds without the agent being restarted.
- **SC-015**: A forged, expired, or borrowed proof of identity gets zero
  management actions carried out.
- **SC-016**: 100% of agents created after release show their creator.
- **SC-012**: With a User's session, zero routes outside the reviewed list
  answer with anything but a refusal; the Owner and an Admin lose zero screens
  in the management console.

## Assumptions

- The three roles stay. What the Owner and Admins can do in the management
  console stays as it is. What a User can do by going around the user console
  (through the assistant, or by calling the service directly) is cut down to
  what the user console offers: that is a correction, not a new policy.
- Through the assistant, an Admin gets the abilities whose console
  counterpart an Admin may use, and the Owner-only ones stay Owner-only.
- Access is all-or-nothing per agent. An account that reaches an agent can do
  with it whatever its role already allows; per-agent permission levels (read
  only, chat only) are out of scope.
- Lists are kept per account. Groups, teams and reusable access templates are
  out of scope.
- Only the Owner manages Admins' access. Admins do not manage each other.
- Narrowing an Admin does not take agents back from Users that Admin already
  served. The Owner adjusts those accounts separately.
- The lists govern signed-in people in the two consoles and the Ranch
  assistant acting for them. Public and shared agent links, messaging
  channels, and agents talking to other agents are not people's accounts and
  are unaffected.
- A credential that acts for a person (a personal key, an assistant session)
  carries that person's access.
- The editor lives in the management console's user management. The user
  console gets no editor; it only shows the agents the person reaches.
- The number of agents per installation stays small enough to show unpaged,
  as today, so filtering the full list on each request is acceptable.
- A history of who changed whose access is not part of this version.
- "Empty allowed list means every agent" is the default the description asks
  for. The one deliberate exception is agent deletion (FR-006), where falling
  back to "every agent" would silently widen access.
