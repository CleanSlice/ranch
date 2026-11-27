# Feature Specification: Resources have an owner and a visibility

**Feature Directory**: `specs/039-resource-ownership`
**Created**: 2026-11-28
**Status**: Draft
**Ticket**: CLEAN-276
**Input**: User description: "Давай полный флоу для планирования и имплементации возьмем, шаблоны и скилы включаем в модули. Пока нет сильного разделения по админам, поэтому сломаться ничего не должно, но текущие все модули лучше оставить как общие. Общий для всех админов, этого достаточно сейчас, остальное то масштабирование"

## Background

Administrators build agents out of five kinds of things: model credentials,
tool servers, knowledge bases, templates and skills. Today every Administrator
sees every one of them and can change or delete it, whoever made it. Two things
follow that the Owner has asked to end:

- An Administrator cannot keep one for themselves. A key they brought, a
  knowledge base with their documents, a template they are still writing: all of
  it is everybody's the moment it exists.
- The Owner cannot offer something for others to use without also handing them
  control of it. A shared model key can be repointed or deleted by any
  Administrator.

This feature gives each of these things an owner and a visibility. It builds on
specs/032 (which agents an account may use) and specs/034 (the assistant), and
it does not change either.

In this document **resource** means one model credential, tool server,
knowledge base, template or skill. **Owner** (capital O) is the installation's
Owner role. The person who created a resource is its **creator**.

## Clarifications

### Session 2026-11-28

- Q: Who can make a resource an Administrator created shared, available to the other Administrators? → A: Its creator. An Administrator chooses the visibility of their own resource when creating it and at any time after: private (offered first) or shared. The Owner can change the visibility of any resource.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Administrator makes something of their own (Priority: P1)

An Administrator adds a model key they pay for, or starts a template they are
not ready to show. It is theirs: they see it, change it and use it for their
agents. Other Administrators do not see it at all, in any list, search, count
or picker. When it is ready, or when they made it to help somebody, they share
it themselves.

**Why this priority**: This is the half of the request that does not exist in
any form today, and it is what makes an Administrator willing to bring their
own key or documents.

**Independent Test**: Sign in as Administrator A and create one resource of
each kind. Sign in as Administrator B: none of the five appears anywhere, and
opening one by its address answers as an address of nothing. Sign in as the
Owner: all five appear, marked as A's.

**Acceptance Scenarios**:

1. **Given** an Administrator, **When** they create a resource of any of the
   five kinds, **Then** they choose private or shared, private is offered
   first, and the page says which it is.
2. **Given** a private resource of Administrator A, **When** Administrator B
   opens the list, the search, a picker that offers such resources, or its
   address, **Then** nothing tells B that it exists.
3. **Given** a private resource of Administrator A, **When** A builds or edits
   an agent or a template of their own, **Then** A is offered that resource
   beside the shared ones.
4. **Given** a private resource of Administrator A, **When** the Owner looks,
   **Then** the Owner sees it, sees whose it is, and can change it.
5. **Given** Administrator B, **When** B creates a resource whose name equals
   the name of A's private resource, **Then** B is not told that the name is
   taken by something B cannot see.

---

### User Story 2 - Something offered for everybody to use (Priority: P1)

The Owner adds the installation's model key and marks it shared. Every
Administrator can pick it for their agents. None of them can change it, delete
it, or read the key. An Administrator does the same with something of their
own: a template made to help the Owner, a skill to show a colleague.

**Why this priority**: It is the other half of the request, and the one that
protects what the installation pays for.

**Independent Test**: As the Owner, create one shared resource of each kind.
As an Administrator: each is listed and marked shared, each can be chosen for
the Administrator's own agent or template, and every control that would change
or delete it is absent; a direct attempt to change it is refused with a reason.
Repeat with Administrator A as the creator and Administrator B as the one who
uses it.

**Acceptance Scenarios**:

1. **Given** the Owner creating a resource, **When** they save it, **Then**
   they choose whether it is shared or private, and shared is what is offered
   first.
2. **Given** a shared resource, **When** an Administrator who did not create it
   opens it, **Then** they see what it is and who shares it, and no way to
   change or delete it.
3. **Given** a shared resource, **When** such an Administrator builds an agent
   or a template, **Then** they can choose it.
4. **Given** a shared resource that holds a secret, **When** anybody opens it,
   the Owner included, **Then** the secret itself is not shown; only that one
   is set.
5. **Given** a shared resource, **When** such an Administrator tries to change
   or delete it by any route, **Then** it is refused, they are told whose it
   is and that only its creator or the Owner changes it, and nothing changes.
6. **Given** an Administrator's own private resource, **When** they make it
   shared, **Then** every Administrator can see and use it at once, and its
   creator and the Owner stay the only ones who change it.

---

### User Story 3 - Nothing changes the day this arrives (Priority: P1)

Everything that exists when the feature is installed stays shared. Every agent
keeps running, every Administrator keeps what they could do the day before.

**Why this priority**: Administrators are not separated from each other today;
an update that hides or locks what they work with would stop their work.

**Independent Test**: Take an installation with resources of all five kinds and
agents built from them. Install the feature. Every resource is shared, every
Administrator sees and changes exactly what they did before, every agent
restarts as before.

**Acceptance Scenarios**:

1. **Given** resources created before the feature, **When** it is installed,
   **Then** each is shared and has no creator recorded.
2. **Given** such a resource, **When** an Administrator changes it, **Then** it
   works as it did before the feature: a shared resource with no recorded
   creator is changed by any Administrator until the Owner decides otherwise.
3. **Given** such a resource, **When** the Owner takes it over or makes it
   private, **Then** from that moment it follows the rules of this feature.
4. **Given** what the assistant is built from (CLEAN-271), **When** the feature
   is installed, **Then** those resources stay the Owner's alone, whatever
   their visibility says.

---

### User Story 4 - Changing who can use something (Priority: P2)

An Administrator's template turned out well, and they make it shared. Or a
shared key must be withdrawn, and its creator or the Owner makes it private
again. Before a withdrawal takes effect the person is shown what it touches.

**Why this priority**: Without it a visibility is fixed at creation, and the
only way to share good work is to recreate it.

**Independent Test**: As Administrator A, make a private resource shared: other
Administrators now see and can use it, only A and the Owner change it. Make it
private again while Administrator B's agent uses it: A is shown that something
of another person uses it before confirming; afterwards the agent still runs,
and nobody but A and the Owner can choose the resource for anything new. As the
Owner, do both to a resource of A's.

**Acceptance Scenarios**:

1. **Given** a private resource, **When** its creator or the Owner makes it
   shared, **Then** every Administrator can see and use it, and its creator
   and the Owner are the ones who change it.
2. **Given** a shared resource that agents or templates of other people use,
   **When** its creator or the Owner starts making it private, **Then** they
   are shown what uses it, and confirm. The Owner sees whose those are; a
   creator who is not the Owner sees how many of other people's things use it
   and the names only of those they may see.
3. **Given** that confirmation, **When** the resource is private, **Then** what
   already uses it keeps working, and it is offered for nothing new to anybody
   but its creator and the Owner.
4. **Given** an Administrator, **When** they look at a resource they did not
   create, **Then** they cannot change its visibility.
5. **Given** a change of visibility, **When** it is made, **Then** who made it
   and when is kept and shown to the Owner and to the creator.

---

### User Story 5 - Things made of other things (Priority: P2)

A template is made of skills, tool servers and knowledge bases; an agent is
made from a template and a credential. Several Administrators may manage one
agent. A private part inside something others can see must not leak, and must
not break what they manage.

**Why this priority**: The five kinds are not independent. Without a rule here
a shared template would quietly carry somebody's private skill to everyone.

**Independent Test**: Try to attach a private skill to a shared template: it is
refused with a reason. Let Administrator A build an agent on A's private
credential; let Administrator B, who also manages that agent, open it: B sees
that it runs on a private credential of somebody else, without its details,
can restart the agent, and can replace the credential with one B may use.

**Acceptance Scenarios**:

1. **Given** a shared template, **When** anybody attaches a private skill, tool
   server or knowledge base to it, **Then** it is refused: a shared thing is
   made of shared things only.
2. **Given** a private template with private parts, **When** its creator or the
   Owner makes it shared, **Then** they are shown the private parts and choose
   to share them too or to stop. A creator can share only parts that are their
   own; a part that is another person's private resource stops it.
3. **Given** an agent that uses a private resource of Administrator A,
   **When** Administrator B, who manages that agent, opens it, **Then** B sees
   that a private resource of another person is in use, and none of its
   details.
4. **Given** that agent, **When** B restarts it, **Then** it starts as before.
5. **Given** that agent, **When** B replaces the private resource with one B
   may use, **Then** it is replaced; B cannot put A's back.
6. **Given** an Administrator, **When** they create an agent or a template,
   **Then** they can use only resources they may use: shared ones and their
   own.

---

### User Story 6 - The assistant follows the same rules (Priority: P3)

Whatever the console lets a person see, use or change, the assistant does for
that person, and nothing more.

**Why this priority**: The chat is the second way to do everything the console
does; a rule that holds in one and not in the other is not a rule.

**Independent Test**: As Administrator B, ask the assistant to list
credentials, to change a shared one, and to show A's private one by name: the
list has shared ones and B's own, the change is refused with the same reason
the console gives, and A's private one is not found. As the Owner, ask the
assistant to make a resource shared: it shows what that touches and asks before
doing it.

**Acceptance Scenarios**:

1. **Given** a person talking to the assistant, **When** it lists or looks up
   resources, **Then** it shows what that person would see in the console.
2. **Given** such a person, **When** they ask it to change something they may
   not change, **Then** it refuses with the reason, and does not look for
   another way.
3. **Given** the Owner, or the creator of a resource, **When** they ask the
   assistant to change its visibility, **Then** it says what that touches and
   asks for confirmation first.

---

### User Story 7 - A creator leaves (Priority: P3)

An Administrator's account is removed, or they stop being an Administrator.
What they made does not vanish and does not become nobody's.

**Why this priority**: It is rare, and without it private resources would be
orphaned inside running agents.

**Independent Test**: Remove an Administrator who has private resources in use
by agents. The resources now belong to the Owner, stay private, and the agents
keep running.

**Acceptance Scenarios**:

1. **Given** an Administrator with resources, **When** their account is removed
   or their role becomes User, **Then** their resources become the Owner's,
   keep their visibility, and keep working where they are used.
2. **Given** that, **When** the Owner opens the list, **Then** those resources
   are marked as having come from that person.

### Edge Cases

- **A name that is already taken by something hidden.** Creating a resource
  must not reveal a private resource of somebody else through a "name taken"
  message. Where a name must be unique for the thing to work (a skill is
  loaded by its name), the two must be able to coexist.
- **Counts and totals.** A number shown to an Administrator (resources in a
  list, skills in a template, agents using a key) counts only what they may
  see, and where a private part of another person is inside something they do
  see, it is counted as "one private" rather than hidden from the total.
- **Spend on a shared key.** Usage pages keep showing spend per agent as they
  do today; this feature does not hide or reassign spend.
- **Importing a template or a skill.** Everything an import creates belongs to
  the person who ran it and starts with the visibility that person's creation
  starts with: private for an Administrator, shared for the Owner, theirs to
  change afterwards. An import must not overwrite a resource the importer may not
  change.
- **A resource of the assistant.** What the assistant is built from is the
  Owner's alone (CLEAN-271); making it shared lets others see and use it, never
  change it, and it cannot be given to another person.
- **Withdrawing a shared resource in use.** Running agents keep running; the
  Owner sees the list of what still uses it for as long as anything does.
- **Two Administrators manage one agent.** Either may replace a private part of
  the other's with something they may use; neither can learn the other's
  private resource from the agent.
- **A User.** People with the User role do not see these modules today and
  gain nothing here.
- **Deleting a private resource that an agent of another person uses.** Its
  creator is told what uses it before deleting, as the Owner is for a shared
  one.

## Requirements *(mandatory)*

### Functional Requirements

**Ownership and visibility**

- **FR-001**: Each model credential, tool server, knowledge base, template and
  skill MUST record who created it and MUST have a visibility of either
  private or shared.
- **FR-002**: A resource created by an Administrator MUST take the visibility
  that Administrator chooses at creation, with private offered first.
- **FR-003**: A resource created by the Owner MUST take the visibility the
  Owner chooses at creation, with shared offered first.
- **FR-004**: The visibility of a resource MUST be changeable by its creator
  and by the Owner, at any time, and by nobody else.
- **FR-005**: Every change of visibility MUST record who made it and when, and
  the Owner and the creator MUST be able to read that.

**Who sees, uses and changes**

- **FR-006**: A private resource MUST be seen, used and changed by its creator
  and by the Owner, and by nobody else.
- **FR-007**: For anybody else a private resource MUST be indistinguishable
  from one that does not exist: absent from lists, searches, pickers and
  counts, and answering its address the way an address of nothing does.
- **FR-008**: A shared resource MUST be seen and used by every Administrator.
- **FR-009**: A shared resource with a recorded creator MUST be changed and
  deleted only by that creator and by the Owner.
- **FR-010**: "Use" MUST mean choosing the resource when creating or editing an
  agent or a template the person manages. A person MUST be able to choose only
  resources they may use.
- **FR-011**: A refusal to change a resource the person can see MUST say why:
  whose it is, and that its creator or the Owner can change it. A shared
  resource MUST show every Administrator who shares it.
- **FR-012**: A stored secret MUST never be shown to anybody, whatever the
  visibility; a resource says only whether one is set (CLEAN-275).

**Existing installations**

- **FR-013**: Every resource that exists when the feature is installed MUST be
  shared and have no recorded creator.
- **FR-014**: A shared resource with no recorded creator MUST be changed and
  deleted by any Administrator, as before the feature, until the Owner takes it
  over or changes its visibility.
- **FR-015**: Installing the feature MUST NOT change what any agent runs on or
  what any Administrator can do on that day.
- **FR-016**: The Owner MUST be able to take over a resource with no recorded
  creator, after which it follows FR-009.

**Composition**

- **FR-017**: A shared template MUST contain only shared skills, tool servers
  and knowledge bases; attaching a private one MUST be refused with the reason.
- **FR-018**: Making a template shared while it contains private parts MUST
  show those parts to the person and proceed only if they share them too. A
  person MUST be able to share only parts whose visibility they may change;
  a private part of somebody else MUST stop it, without being named.
- **FR-019**: A person who manages an agent or a template that uses a private
  resource of somebody else MUST be told that a private resource is in use,
  without its name, contents or owner's secrets.
- **FR-020**: Such a person MUST be able to restart that agent and to replace
  the private resource with one they may use, and MUST NOT be able to select
  the other person's private resource again.
- **FR-021**: Making a shared resource private, or deleting any resource, while
  agents or templates of other people use it MUST first show the person what
  uses it and require confirmation. The Owner MUST see whose those are; a
  creator who is not the Owner MUST see how many there are and the names only
  of those they may see.
- **FR-022**: After a shared resource becomes private, what already uses it
  MUST keep working; it MUST be offered for new use only to its creator and the
  Owner.

**Names, counts and imports**

- **FR-023**: Creating or renaming a resource MUST NOT reveal the existence of
  a resource the person cannot see.
- **FR-024**: Any count or total shown to a person MUST be consistent with what
  that person can see, and a private part of somebody else inside something
  they can see MUST be shown as a private part, not omitted without a trace.
- **FR-025**: Resources created by an import MUST belong to the person who ran
  it and follow FR-002 and FR-003; an import MUST NOT overwrite a resource that
  person may not change.

**Roles and the assistant**

- **FR-026**: When a creator's account is removed or stops being an
  Administrator, their resources MUST pass to the Owner, keep their visibility,
  keep working where used, and stay marked with where they came from.
- **FR-027**: What the assistant is built from MUST stay changeable by the
  Owner only, whatever its visibility (CLEAN-271).
- **FR-028**: Everything the console offers under this feature MUST be
  available through the assistant to the same person and under the same rules:
  listing, looking up, creating, changing, deleting, and, for the creator and
  the Owner, changing a visibility with a confirmation that states what it
  touches.
- **FR-029**: The assistant MUST refuse with the same reason the console gives,
  and MUST NOT report a private resource of another person as existing.
- **FR-030**: People with the User role MUST gain no access to these modules.

**In the console**

- **FR-031**: Every list and page of the five kinds MUST show, for each
  resource the person sees, whether it is private or shared and, where it is
  not theirs, that it is the Owner's or another person's to change.
- **FR-032**: A control that would be refused MUST NOT be offered; a
  read-only resource is shown as read-only with one line saying why.
- **FR-033**: A list MUST let a person narrow it to their own resources once
  they have any.

### Key Entities

- **Resource**: one model credential, tool server, knowledge base, template or
  skill. Has a creator (possibly none, for what existed before), a visibility,
  and the record of who last changed the visibility and when.
- **Creator**: the person who made a resource. The one who, with the Owner,
  changes it.
- **Visibility**: private (the creator and the Owner) or shared (every
  Administrator may see and use).
- **Use**: a link from an agent or a template to a resource. It keeps working
  when the resource's visibility changes; it can be made only by somebody who
  may use the resource.
- **Origin**: for a resource that passed to the Owner, the person it came from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Administrator sees none of another Administrator's private
  resources in any place the product shows resources: checked across every
  list, picker, search, count and address of the five kinds, with zero
  appearances.
- **SC-002**: Every attempt by an Administrator to change or delete a shared
  resource they did not create is refused and leaves the resource unchanged:
  checked for every way of changing each of the five kinds, in the console and
  through the assistant.
- **SC-003**: On an installation updated to this feature, every agent that ran
  before the update restarts to the same result after it, and every
  Administrator can do everything they could do before: zero differences.
- **SC-004**: No stored secret appears in anything any person receives, in any
  role.
- **SC-005**: An Administrator creates a private resource and uses it for
  their own agent in the same number of steps it takes today.
- **SC-006**: The Owner makes a resource shared, or private again, in under a
  minute, having seen what it affects before confirming.
- **SC-007**: For every question the product can be asked about a resource the
  person cannot see, the answer is the same as for a resource that does not
  exist.
- **SC-008**: Every refusal a person meets names its reason and who can do the
  thing instead.

## Assumptions

- **Shared means every Administrator.** Sharing with chosen people or groups is
  a later extension; the model must not prevent it.
- **A creator shares their own.** An Administrator makes their own resource
  shared or private without asking; nobody is made to use a shared resource,
  only its creator and the Owner change it, and its secret is shown to nobody.
  An approval step by the Owner is not part of this feature.
- **Sharing a paid key is the creator's decision.** An Administrator who
  shares a model credential accepts that other Administrators' agents spend on
  it; the page says so when they share it.
- **The Owner sees and can change everything**, private resources of
  Administrators included. Private means private from other Administrators.
- **There is one Owner.** Where this document says "the Owner's", it means the
  holder of that role.
- **Secrets are write-only (CLEAN-275)** and that ships before or with this
  feature. Without it, "use but not read" is not true.
- **Agents are out of scope**: who may use and manage an agent is specs/032
  and CLEAN-259. This feature covers what agents are made of.
- **The assistant's own ingredients are out of scope** except for FR-027: they
  were closed in CLEAN-271.
- **Transferring a resource between two Administrators** is not offered. The
  only transfer is to the Owner when a creator leaves (FR-026).
- **Budgets and spending limits per shared key** are not part of this feature.
- **Template-scoped evaluation scenarios** follow their template's visibility.
- **The management console is where these modules live.** The user console has
  no pages for them; if it shows a resource by name anywhere (an agent's model,
  a template's name), the same visibility rule applies there.
