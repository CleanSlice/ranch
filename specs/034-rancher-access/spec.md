# Feature Specification: The Ranch assistant for everyone, on the Owner's terms

**Feature Branch**: `feat/CLEAN-240-rancher-access`

**Created**: 2026-11-20

**Status**: Draft

**Ticket**: [CLEAN-240](https://dreamvention.atlassian.net/browse/CLEAN-240)

**Input**: User description: "как я понимаю сейчас к главному агенту rancher доступ имеет лишь владелец, даже админам он недоступен. с этим я согласен, но что если админу захочется создать агента или внести какие-то настройки через главного агента — получается он не сможет это сделать. что если реализовать подобным образом, что список тулзов для ранчера и его доступность будет настраивать сам владелец. по умолчанию ранчер доступен всем с минимальными тулзами, чтобы удобно взаимодействовать с платформой, ведь в этом его и суть. нужно сделать гибким этот функционал. в agent access нужно вынести его для удобного взаимодействия с ним и думаю проваливаться в advanced настройки. отдельно проработай UX, удобные чекбоксы, тумблеры или прочее, чтобы настройка агента не превращалась в рутину"

## Background

The Ranch assistant (Rancher) is the agent that does in chat what the
management console does with clicks. Since specs/032 (CLEAN-231, CLEAN-232) it
acts with the power of the person asking, never with its own.

The report that started this ticket was an Admin who could not open the
assistant at all. Looking at how that happens showed the problem is narrower
and more awkward than "only the Owner has it":

1. **The assistant is one row in the list of all agents.** An account's Agent
   access card lists it between ordinary agents, with the same Default /
   Allowed / Denied control. Nothing says it is a different kind of thing.
2. **Allowing one agent takes the assistant away.** The lists work as "an
   account reaches everything, unless something is Allowed, and then only
   that". The moment the Owner limits an Admin to one agent ("Reaches only
   these 1"), the assistant falls outside the list. The Admin's console drops
   the assistant from the menu, and asking for it answers "not found". The
   Owner did not decide that; it is a side effect of deciding something else.
   To give it back, the Owner has to find "Rancher" in the list and mark it
   Allowed, account by account.
3. **What the assistant offers is not the Owner's to shape.** A person gets
   from it everything their role can do, or (when it is hidden) nothing. The
   Owner cannot say "Admins may create and restart agents through the
   assistant but not touch users and keys", or "this User may only ask
   questions".
4. **There is no single place that answers "who has the assistant, and for
   what".** The answer is spread over every account's lists.

Terms used below:

- **Assistant**: the Ranch assistant, the one agent marked as the
  installation's main agent. It is managed by the Owner only (specs/032,
  specs/033); that does not change here.
- **Ability**: one thing the assistant can do for a person in chat, such as
  "restart an agent" or "list knowledge bases".
- **Area**: a named group of abilities that belong together, the way the
  assistant already groups what it can do: Agents, Agent workspace,
  Knowledge, Skills, Templates, Models, Connected services, Colleagues, Chats
  and usage, Users and keys, Settings, Test runs, Browser.
- **Level**: a named, ready-made choice of abilities. Three of them: *Basic*,
  *Standard*, *Full* (defined in the requirements).
- **Role ceiling**: everything a person's role lets them do in the console.
  Nothing in this feature lets the assistant do more for a person than that.
- **Reach**: as in specs/032 — whether an account's lists let it see and use
  an ordinary agent.

## Clarifications

### Session 2026-11-20

- Q: What level does a role get while the Owner has configured nothing? → A:
  Full for Admins, Basic for Users. An Admin who uses the assistant today
  loses nothing when the feature arrives. A User keeps looking and asking;
  managing agents they created through the chat becomes something the Owner
  switches on (Standard), for all Users or for one.
- Q: May an Admin set the assistant for a User? → A: Yes, for Users they may
  already edit under specs/032, and never above what the Admin gets
  themselves. Roles, other Admins and their own account stay the Owner's.

### Amended 2026-11-26 (CLEAN-254)

The first answer above, and three places further down that follow from it,
speak of a User "managing agents they created". That was the rule of
specs/032 (`canManage`, the creator line) carried over unexamined, and it
made every agent ability the editor offers for a User a switch that did
nothing: no User can create an agent, so none ever had an agent to manage.
Found on production: a User was given "Restart an agent" in a custom
setting, the assistant reported it as included, and never had the tool.

The rule since:

- An agent ability the Owner or an Admin gave a person through the assistant
  setting works, **through the assistant**, on every agent that person
  **reaches** (the access lists of specs/032), whoever created it, and never
  on the Ranch admin agent.
- It is the ability that was given and no other: a User given "Restart an
  agent" is not offered "Delete an agent".
- The console is unchanged. A User still has no management there; the
  management routes keep the rule of specs/032.
- A level means for a User what its summary says. Basic holds everything
  that only reads, which now includes reading about the agents they reach
  (status, files, logs, secret names, connections); Standard adds changing
  them. Before this, both were empty for a User where agents are concerned.

Read the passages marked "(amended, CLEAN-254)" below with this in place of
"an agent the User created". The text is left as it was written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Limiting an account to some agents no longer takes the assistant away (Priority: P1)

The Owner limits an Admin or a User to a handful of agents. The assistant
stays available to that account, because whether an account has the assistant
is now its own decision, separate from the lists of ordinary agents. The
assistant is not a row in those lists any more.

**Why this priority**: This is the failure that was reported. Without it
everything else in this spec configures something people keep losing by
accident.

**Independent Test**: Take an account that reaches every agent, mark one
ordinary agent Allowed, save, sign in as that account. The assistant is still
in the menu, opens, and answers.

**Acceptance Scenarios**:

1. **Given** an Admin with no lists, **When** the Owner marks one ordinary
   agent Allowed and saves, **Then** the Admin still sees and can open the
   assistant.
2. **Given** an account's Agent access card, **When** anyone who may open it
   looks at the list of agents, **Then** the assistant is not among the rows,
   and typing its name into the search finds nothing there.
3. **Given** an account that had the assistant marked Denied before this
   feature, **When** the installation is updated, **Then** the assistant is
   off for that account and the card says so.
4. **Given** an account that had the assistant marked Allowed before this
   feature, **When** the installation is updated, **Then** the assistant is on
   for that account and its other Allowed agents are unchanged.
5. **Given** an account that had an Allowed list without the assistant in it,
   **When** the installation is updated, **Then** the assistant is on for that
   account at the default for its role — the Owner never chose to take it
   away.

---

### User Story 2 - The Owner sets what each role gets from the assistant (Priority: P1)

On the assistant's own page the Owner sees one card, "Who can use the
assistant", with a row for Admins and a row for Users. Each row has a switch
(on or off) and a level: Basic, Standard or Full. One click changes what every
account of that role gets, unless the account has its own setting.

**Why this priority**: This is the flexibility that was asked for, at the
grain where one decision covers most accounts. It is also where the default
lives, so a new installation is useful without anyone configuring anything.

**Independent Test**: Set Users to Basic and Admins to Standard. Sign in as a
User and ask the assistant to restart an agent the User created: it has no
such ability to offer. Sign in as an Admin and ask the same about an agent the
Admin reaches: it does it. Ask the Admin's assistant to create a user: it has
no such ability to offer.

*(amended, CLEAN-254)* The User's half reads: ask the assistant to restart an
agent the User **reaches**; on Basic it has no such ability to offer. Then
raise that User to Standard, or give them "Restart an agent" in a custom
pick, and ask again in the same conversation: it restarts the agent. Ask it
to restart an agent the User does not reach, or the assistant itself: it
finds no such agent.

**Acceptance Scenarios**:

1. **Given** a new installation, **When** nobody has configured anything,
   **Then** the assistant is on for every role and every non-Owner account
   gets the default level for its role.
2. **Given** the Owner sets Admins to Standard, **When** an Admin asks the
   assistant what it can do, **Then** it lists what Standard holds within an
   Admin's ceiling, and nothing else.
3. **Given** the Owner switches the assistant off for Users, **When** a User
   signs in, **Then** the assistant is not offered anywhere in their console
   and asking for it answers as for something that does not exist.
4. **Given** the Owner changes a role's level while a person of that role has
   the chat open, **When** that person sends their next message, **Then** the
   assistant works at the new level, without the person signing in again.
5. **Given** any level, **When** a person asks for something their role cannot
   do in the console, **Then** the assistant cannot do it either.

---

### User Story 3 - One account gets something different, from its own page (Priority: P2)

On an account's page, the Agent access card opens with the assistant on top,
apart from the list of agents: a switch, the level, and a line saying where
the setting comes from ("Same as all Admins" or "Set for this account"). The
Owner changes it for this one person in two clicks and can put it back with
one.

**Why this priority**: Roles cover most people; the exception is the reason
the card was opened in the first place. It depends on story 2 for the thing an
account differs from.

**Independent Test**: With Admins on Standard, set one Admin to Full and
another to off. The first can manage users through the assistant, the second
does not see the assistant, a third still has Standard.

**Acceptance Scenarios**:

1. **Given** an account with no setting of its own, **When** its card is
   opened, **Then** the assistant row shows the role's switch and level and
   says "Same as all Admins" (or Users).
2. **Given** the Owner picks another level for the account, **When** it is
   saved, **Then** the row says "Set for this account" and offers "Use the
   Admins' setting" to drop the exception.
3. **Given** an account with its own setting, **When** the Owner later changes
   the role's setting, **Then** the account keeps its own.
4. **Given** an Admin who may edit a User's access (specs/032), **When** they
   open that User's card, **Then** they can set the assistant for the User no
   higher than what they themselves get, and cannot change it for an Admin or
   for themselves.
5. **Given** the Owner's own account, **When** its card is opened, **Then**
   the assistant row says the Owner always has everything and offers no
   controls.

---

### User Story 4 - Advanced: area by area, and ability by ability (Priority: P2)

Next to the level is "Advanced". It opens a panel that lists the areas, each
with one switch and a count ("Agents — 12 of 16"). Opening an area shows its
abilities as a checklist with a plain-language name each, and "All" / "None"
at the top. A choice that no longer matches a level is shown as "Custom", and
the three levels stay one click away to start over from.

**Why this priority**: Levels are a guess at what people want. The request was
for flexibility, and this is where it lives — but one step deeper, so that the
common case never has to look at 170 checkboxes.

**Independent Test**: For Admins, start from Standard, open Advanced, switch
the "Users and keys" area off and, inside "Agents", untick "Delete an agent".
An Admin's assistant then restarts agents, cannot delete one, and offers
nothing about users or keys.

**Acceptance Scenarios**:

1. **Given** the Advanced panel for a role or an account, **When** it opens,
   **Then** every area the role's ceiling allows is listed with a switch and a
   count of abilities on out of abilities available.
2. **Given** an area is switched off, **When** it is saved, **Then** none of
   its abilities are offered to the people the setting covers.
3. **Given** some abilities in an area are unticked, **When** the panel is
   looked at, **Then** the area's switch shows a "partly on" state and the
   level reads "Custom".
4. **Given** a Custom choice, **When** the Owner picks a level again,
   **Then** they are told the custom choice will be replaced, and it is,
   only after they agree.
5. **Given** an ability that changes or deletes something, **When** it is
   shown in the checklist, **Then** it carries a mark that says so, and the
   panel can show "only the ones that change things".
6. **Given** abilities outside the role's ceiling, **When** the panel is
   opened for that role, **Then** they are shown greyed out with "Owner only"
   (or "Admins and above"), and cannot be ticked.
7. **Given** the search field in the panel, **When** the Owner types "restart",
   **Then** only matching abilities remain, in their areas.

---

### User Story 5 - One place answers "who has the assistant, and for what" (Priority: P3)

On the assistant's page, under the two role rows, a short list names every
account that differs from its role: who, what they have instead, who set it
and when. From there the Owner opens the account or drops the exception.

**Why this priority**: It is what makes exceptions safe to hand out: they do
not get forgotten. Nothing breaks without it.

**Independent Test**: Give two accounts their own setting. Both appear in the
list with the right level; dropping one from the list returns that account to
its role's setting.

**Acceptance Scenarios**:

1. **Given** no account differs from its role, **When** the page is opened,
   **Then** the list says so in one line instead of showing an empty table.
2. **Given** accounts that differ, **When** the page is opened, **Then** each
   is listed with its switch state, its level, who set it and when.
3. **Given** an account's role changes (an Admin becomes a User), **When** the
   list is opened, **Then** an exception that is now above the new role's
   ceiling is shown as reduced to that ceiling, and says so.

---

### User Story 6 - The same through the assistant (Priority: P3)

The Owner asks the assistant in chat: "what can Admins do through you?", "let
Jane manage users through you", "switch yourself off for Users". It answers
and applies under the same rules as the console, stating the result before
anything that removes an ability from people takes effect.

**Why this priority**: The constitution's rule that a console capability is
not finished until the assistant can do it. It adds no new behaviour.

**Independent Test**: In chat, as the Owner, change a role's level and one
account's setting; open the console and see both.

**Acceptance Scenarios**:

1. **Given** the Owner in chat, **When** they ask what a role or an account
   gets, **Then** the answer matches the console.
2. **Given** the Owner asks for a change, **When** it narrows what people can
   do, **Then** the assistant states what will be lost and by whom and applies
   it only after the Owner confirms.
3. **Given** an Admin in chat, **When** they ask to change the assistant's
   settings for a role or for an Admin, **Then** the assistant has no such
   ability to offer.
4. **Given** an Admin who may set it for a User (story 3), **When** they ask
   in chat, **Then** it is applied with the same ceiling as in the console.

---

### User Story 7 - The assistant knows about levels and can explain them (Priority: P3)

The assistant knows, in every conversation with a signed-in person, which
level that person is on. A person who asks for something it does not offer
them is told that this is not part of what they have been given and who can
change that, instead of "I have no tool for that". A person who asks "what can
you do for me?" gets their level explained. The Owner can ask the assistant
what the levels are, what each includes and who has which, and gets an
explanation that matches the console. A person's console shows, next to the
assistant's name, what level they are on.

**Why this priority**: Without it a narrowed assistant looks broken, and the
Owner hears about it as a bug.

**Independent Test**: As an Admin on Basic, ask the assistant to create an
agent. The answer says creating agents is not included for this account and
that the Owner decides it.

**Acceptance Scenarios**:

1. **Given** a person whose level leaves an ability out, **When** they ask for
   it, **Then** the assistant says it is not included for them and names the
   Owner as the one who decides, without listing what other people have.
2. **Given** a person whose role could never do it, **When** they ask,
   **Then** the answer is the one they get today.
3. **Given** a person with the assistant on, **When** they open it, **Then**
   they can see their level and, on request, the areas it covers.
4. **Given** the Owner in chat, **When** they ask "what are the levels?" or
   "what is the difference between Basic and Standard?", **Then** the
   assistant explains each level in plain words, area by area, for Admins and
   for Users, and says who is on which — the same as the console shows.
5. **Given** a person on any level, **When** they ask "what does my level
   mean?", **Then** the assistant names their level and what it covers for
   their role, and nothing about other accounts.
6. **Given** the contents of a level change with a release, **When** anyone
   asks the assistant to explain it afterwards, **Then** the explanation
   matches the new contents without the assistant being reconfigured.
7. **Given** a person on a narrowed level, **When** they start a conversation,
   **Then** the assistant already knows their level; they do not have to say
   it, and it does not have to be asked to look it up.

---

### Edge Cases

- **The Owner.** Always on, always everything. No setting applies to the
  Owner and none is offered.
- **The assistant acting for itself** (a scheduled job, its own heartbeat):
  unaffected. These settings are about people.
- **Anonymous callers** — a visitor of a share link to the assistant, a
  messenger user, an embedded widget: unchanged by this feature. They get no
  management ability at any setting (specs/032, specs/033).
- **Off, and a chat already open.** The next message is refused the way a
  revoked agent is refused today; the conversation so far stays readable to
  the Owner as before.
- **Narrowed in the middle of a task.** An ability taken away between two
  steps of one answer is not used for the second step.
- **A new ability appears with a release.** It joins the levels according to
  the rule that defines them (FR-010), is off in every Custom choice, and the
  Advanced panel marks it "new" until the Owner has seen it.
- **An ability is removed with a release.** It disappears from every choice;
  nothing else in the choice moves.
- **No assistant on the installation** (nobody is marked as the main agent):
  the cards say there is no assistant yet and offer no controls; settings
  already made are kept for when there is one.
- **Another agent is made the assistant.** The settings follow the role of
  being the assistant, not the agent that held it.
- **An account is deactivated or removed.** Its exception goes with it.
- **The last ability of an area is unticked.** Same as switching the area off.
- **Every area is off.** Shown as such, with a hint that switching the
  assistant off says the same thing more clearly; it is still allowed, and the
  person keeps a chat that can only talk.
- **An Admin limited by lists.** What the assistant lists and acts on for them
  is still only the agents they reach; this feature decides which abilities
  they get, never which agents.
- *(amended, CLEAN-254)* **A User given an agent ability.** The same holds,
  and it is now the whole answer to "which agents": the ones the User
  reaches, not the ones they created. The Ranch admin agent is never among
  them. An agent out of their reach, an id that names nothing and the Ranch
  admin agent are answered alike.

## Requirements *(mandatory)*

### Functional Requirements

**Availability**

- **FR-001**: Whether an account has the assistant MUST be decided by a
  setting of its own and MUST NOT depend on the account's lists of ordinary
  agents.
- **FR-002**: The assistant MUST NOT appear as a row in any account's list of
  agents, and MUST NOT be settable through that list by any route, in the
  console or in chat.
- **FR-003**: With nothing configured, the assistant MUST be on for every
  Admin and every User.
- **FR-004**: When the assistant is off for a person, every surface MUST treat
  it as an agent that does not exist for them: not in menus or lists, not
  openable by address, not named in answers.
- **FR-005**: The Owner MUST always have the assistant with every ability. No
  setting applies to the Owner.

**What it offers**

- **FR-006**: What the assistant offers a person MUST be the abilities their
  setting includes, limited to their role ceiling. A setting MUST never give a
  person an ability their role does not have in the console.
- **FR-007**: A setting MUST be expressible as one of three levels or as a
  custom choice of areas and abilities.
- **FR-008**: The levels MUST be:
  - **Basic** — see and ask: everything that only reads, about the agents the
    person reaches and about the platform, plus what is personal to them
    (pinning an agent, their own profile). Nothing that changes an agent, a
    setting or another person.
  - **Standard** — Basic plus the day-to-day work on agents: create, start,
    stop, restart, edit, their files, knowledge, skills, colleagues and test
    runs. Nothing about users, keys, models, connected services or
    installation settings.
  - **Full** — everything the person's role can do in the console.
- **FR-009**: The default level for a role with nothing configured MUST be
  Full for Admins and Basic for Users.
- **FR-010**: Which level a given ability belongs to MUST follow from two
  things the platform already knows about it — its area and whether it only
  reads — so that an ability added later lands in the right levels without
  anyone deciding it by hand.
- **FR-011**: An ability that is not offered to a person MUST be absent from
  what the assistant believes it can do for them, not offered and then
  refused.
- **FR-012**: A change of setting MUST apply to a person's next message,
  without a new sign-in and without restarting the assistant.

**Who decides**

- **FR-013**: The Owner MUST be able to set, per role (Admin, User): on or
  off, and the level or custom choice.
- **FR-014**: The Owner MUST be able to set the same per account, and to drop
  an account's setting so it follows its role again.
- **FR-015**: An account's own setting MUST win over its role's, in both
  directions (more or less).
- **FR-016**: An Admin MUST be able to set the assistant for a User they may
  edit under specs/032, to no more than the Admin gets themselves, and MUST
  NOT be able to set it for any role, for an Admin, or for themselves.
- **FR-017**: Everything in FR-013 to FR-016 MUST be available through the
  assistant in chat, to the same people, with the same ceilings.
- **FR-018**: A change that takes abilities away from people, made in chat,
  MUST state who loses what and wait for confirmation.

**The cards**

- **FR-019**: The assistant's page MUST have a card with one row per role:
  switch, level, "Advanced", and how many accounts follow it.
- **FR-020**: That card MUST list the accounts whose setting differs from
  their role, with what they have, who set it and when, and a way to drop the
  exception.
- **FR-021**: An account's Agent access card MUST show the assistant first,
  apart from the list of agents: switch, level, where the setting comes from,
  "Advanced", and a way back to the role's setting.
- **FR-022**: Changing switch or level MUST take one click each and one save.
- **FR-023**: The Advanced panel MUST show areas with a switch and an
  on/available count, abilities inside an area as a checklist with
  plain-language names, "All"/"None" per area, a search, a filter for
  abilities that change things, and the levels as starting points.
- **FR-024**: An area with some abilities off MUST show a "partly on" state,
  and the level MUST read "Custom".
- **FR-025**: Abilities above the role ceiling MUST be shown disabled with the
  reason, never hidden, so the Owner sees what the role itself rules out.
- **FR-026**: Replacing a custom choice with a level MUST ask first.
- **FR-027**: Every control MUST be usable from the keyboard and readable by a
  screen reader, with the three-state area switch announced as on, off or
  partly on.

**For the person**

- **FR-028**: A person MUST be able to see, where the assistant is offered to
  them, what level they are on and which areas it covers.
- **FR-029**: When a person asks for an ability their setting leaves out, the
  assistant MUST say it is not included for them and that the Owner decides,
  and MUST NOT describe what other accounts have.

**What the assistant knows**

- **FR-032**: In every turn with a signed-in person, the assistant MUST be
  told that person's level by the platform, as part of what it is told about
  who it is talking to. For the Owner it MUST be told that levels exist and
  that the Owner sets them. This is wording only and MUST NOT be what decides
  what the assistant may do.
- **FR-033**: The assistant MUST be able to explain the levels — what each
  includes, area by area, for each role — and MUST take that from the
  installation's own definitions, not from text it carries, so that the
  explanation stays true when a level's contents change.
- **FR-034**: To anyone but the Owner the assistant MUST explain only the
  person's own level and role, never what other accounts or roles have.
- **FR-035**: An assistant running on an older runtime, which does not pass
  the level on, MUST still be limited exactly the same and MUST still be able
  to answer "why can't you do this" when asked.

**Carrying over**

- **FR-030**: On update, an account that had the assistant marked Denied MUST
  end with the assistant off; one that had it Allowed, or had it hidden only
  by an Allowed list of other agents, MUST end with it on at its role's
  level. The assistant MUST be removed from every list of agents.
- **FR-031**: Every change of these settings MUST be recorded with who made
  it, for whom, and when.

### Key Entities

- **Assistant setting for a role**: for Admins and for Users — whether the
  assistant is on, and its level or custom choice. Two records at most.
- **Assistant setting for an account**: the same, for one account, with who
  set it and when. Exists only for accounts that differ from their role.
- **Choice**: a level name, or a custom set — which areas are on and, inside
  an area, which abilities are off.
- **Ability**: something the assistant can do. Known to the platform with its
  area, a plain-language name, whether it only reads, whether it destroys
  something, and the lowest role that may use it.
- **Area**: a named group of abilities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an account is limited to any set of ordinary agents, it
  still has the assistant in 100% of cases where nobody switched the
  assistant off for it.
- **SC-002**: The Owner changes what all Admins get from the assistant in at
  most 3 clicks from the assistant's page, save included.
- **SC-003**: The Owner gives one account a different level in at most 3
  clicks from that account's page, save included.
- **SC-004**: The common custom case — "Standard, but nothing destructive" —
  takes under one minute in the Advanced panel without scrolling through
  every ability.
- **SC-005**: A changed setting is in force for the affected person's next
  message in 100% of cases.
- **SC-006**: In a test that asks the assistant, as each role at each level,
  for one ability from every area: it offers exactly what the setting and the
  role ceiling allow, and nothing else, in 100% of cases.
- **SC-007**: No Admin ends an update of the installation with less from the
  assistant than they had before, unless the assistant was marked Denied for
  them. Users end it on Basic, which is the one deliberate reduction (see
  Clarifications).
- **SC-008**: A person asking for an ability left out of their setting is told
  so in the first answer, 100% of the time, with no ability named that belongs
  to other accounts.
- **SC-009**: Asked by the Owner to explain the three levels, the assistant's
  answer agrees with the console on what each level includes in every area,
  for both roles, in 100% of a scripted set of ten questions.

## Assumptions

- The roles are Owner, Admin and User, as in specs/032. There are no custom
  roles; "per role" means two rows.
- A setting can only narrow what a role allows. Letting the Owner grant an
  Admin an Owner-only ability through the assistant would make the chat more
  powerful than the console for the same person, which specs/032 ruled out
  (User Story 7 there). If the Owner wants an Admin to have Owner power, the
  way to do that is the role.
- The assistant stays managed by the Owner only: its page, its files, its
  restart and who it is (specs/032, specs/033). This feature is about using
  it, not about managing it.
- The areas are the groups the assistant's abilities already carry. This spec
  does not regroup them.
- Users who managed agents they created through the assistant lose that on
  update, until the Owner raises Users (or the one account) to Standard. The
  update tells the Owner so once, on the assistant's page.
  *(amended, CLEAN-254)* Still so for those Users, and the notice still says
  what is true of them. What changed is what raising Users to Standard gives:
  the day-to-day work on every agent a User reaches, not only on agents they
  created. An Owner who wants less gives single abilities in a custom pick,
  or limits the account's agents with the lists.
- "Basic" is the "minimal tools to work with the platform comfortably" of the
  request: look around, ask, get explanations, keep personal things. It
  changes nothing that belongs to anyone else.
- Users see the assistant where they see it today in their console; Admins and
  the Owner in the management console. No new place to chat is added.
- Settings are per installation. There is one assistant per installation.
- The card on the assistant's page is the Owner's; an Admin who cannot manage
  the assistant does not see it.
