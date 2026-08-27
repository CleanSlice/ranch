# Feature Specification: Knowledge workspaces — every base answers only for itself, and a module you can use without a briefing

**Feature Branch**: `feat/CLEAN-48-knowledge-workspaces`

**Created**: 2026-08-26

**Status**: Draft — decisions revised 2026-08-27 after the product answer; ready for `/speckit-plan`

**Tracker**: [CLEAN-48](https://dreamvention.atlassian.net/browse/CLEAN-48)

**Retrospective**: [`retrospective.md`](./retrospective.md) — the current-state
audit this specification is built on, with file-level evidence.

**Input**: User description: "Необходимо провести полный ресерч для knowledge. UI проблемы - табы не подсвечивается активный. Entity Select стоит на Infinity list переделать, так как виснет страница когда его открываешь и очень не интуитивно настройки выглядят. Не понимаешь для чего они. Нужно пробреинштормить знания (knowledge) и импрувнуть их. Главное улучшение - разделение их на воркспейсы, так как сейчас они просто выводятся все вместе. Нужно изучить вопрос и понять как надежнее это реализовать все. Со стадии планирования, может есть еще известные патерны, для знаний, которые мы упустили. Проведи ретроспективу по существующему функционалу, ибо мне не понятно откуда большинство данных берется, предложи лучшие кейсы для ranch" — plus a follow-up: the module must become more intuitive without becoming overloaded.

## Overview

Knowledge in Ranch works as an ingestion pipeline and fails as a product of
record. An operator can create a base, pour documents into it, press Index, ask
it a question — and get an answer assembled from **every** base in the
installation. The Graph tab and its entity picker have the same reach: they
describe the whole installation. Nothing in the interface says so, which is
exactly why the person using it cannot tell where the data came from.

That single defect explains most of the complaints. The entity picker is slow
because it lists the entities of everything rather than of one place. "Search
all your bound bases", the headline of the agent-side tool, costs several model
calls to retrieve the same corpus several times.

This feature has three lines of work, and the order matters.

**First, retrieval gets a boundary that is real.** A **knowledge base** becomes
the unit that answers. Ask a base and you get that base; nothing from another one
reaches the answer, its references, the graph, or the entity list. An agent given
one base cannot reach into another, or find out what is in it. This is what the
original design intended — the code already derives one retrieval namespace per
base, and the agent tool already searches per base — and it is the half that was
never wired up.

**Second, bases get findable.** Today they arrive as one flat, unsorted,
unpaginated list that every binding form re-renders as a column of identical
checkboxes, while an agent's own screen shows what it reads as a read-only
afterthought. Search, paging and an agent-first view replace the scan. No new
container is introduced above bases: with one owner and no customers there is
nothing for a container to separate, and adding one would be exactly the overload
the request warns against.

**Third, the module stops needing a briefing.** The complaint about settings —
"не понимаешь, для чего они" — is not a documentation problem. Two of the
settings, `entityTypes` and `relationshipTypes`, have never been sent anywhere in
the product's history; they are removed, not explained. The rest are either
promoted to the default path or folded away behind an explicit disclosure. The
target is a module where the ordinary journey — create, add sources, index, ask
— touches no optional control at all, and where every control still on screen
earns its place. **Intuitive here means fewer things visible, not more labels.**

**Out of scope, deliberately**: the end-user (`app`) console gets no knowledge
surface in this feature; the roadmap items catalogued in §7 of the retrospective
(reranking, the `mix` retrieval mode, chunk inspection, content-hash dedup,
scheduled re-crawl, retrieval evaluation, query metering) are recorded there and
planned separately.

## Decisions

Three scope questions were open at first draft. The code answered what it could;
the product owner answered what it could not. That answer, received 2026-08-27,
**reversed two of the three**. Both reversals are recorded with what they replace.

**The product answer.** Ranch is personal — no customers, no tenancy. Inside one
installation an operator keeps several knowledge bases and picks a subset for each
agent; an agent may hold several. Of an agent given one base out of two: «во
второй он уже не может ходить и смотреть какие там знания». Not reaching into it,
and not seeing what is in it, are both requirements.

**D1 (revised) — There is no workspace entity.** The isolation area *is* the
knowledge base. Ranch gains no container above bases and no tenancy model: with
one owner and no customers there is nothing for a tenant to separate. What the
request called «разделение на воркспейсы» is the guarantee that each base is a
real, separate area instead of a label on a shared pool — which is precisely the
defect the retrospective found. *Replaces* the earlier D1, which introduced a
workspace as a new container.

**D2 (reversed) — The isolation boundary is the knowledge base.** The earlier D2
put the boundary at a workspace holding several bases, reasoning that isolating a
corpus costs a running retrieval process. That reasoning was right about the cost
and wrong about the requirement: sharing a pool between bases produces exactly the
leakage the product forbids. The module's own design already agreed —
`workspaceOf(knowledgeId)` derives one namespace per base, and the agent tool
already issues one retrieval per bound base. This feature finishes that design
rather than replacing it. Footprint stops being a reason to change the semantics
and becomes the central engineering constraint for planning; see the assumptions.

**D3 (reversed) — A one-time re-index is required, and it costs the operator
nothing but time.** The earlier D3 kept the existing shared pool as a first
workspace. Under per-base isolation that is impossible: today's pool holds every
base's content mixed together and cannot be split after the fact. Every source is
therefore re-processed into its own base's area. This needs **no action from the
operator and loses nothing** — every source type is re-ingestable from Ranch's own
storage: pasted text from the stored content, web addresses by re-fetching, files
from object storage. The cost is model usage and a window in which bases answer
incompletely; the interface has to state both.

**D4 (new) — Grouping is a presentation problem, not a boundary.** The other half
of the original complaint — «сейчас они просто выводятся все вместе» — is about a
flat list, and a flat list is fixed by navigation, not by a container. This
feature adds no grouping entity; it makes the list searchable and paged, and makes
each agent show what it reads. If the number of bases later outgrows a searchable
list, a grouping layer can be added on top without touching isolation.

**Naming.** `workspace` is already the retrieval service's own word for the
namespace it keeps per base. The product surface therefore avoids the term
entirely: operators see knowledge bases, and "workspace" stays an implementation
detail. The feature keeps its branch and directory name for continuity only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An answer that comes from the base I chose (Priority: P1)

An operator opens a knowledge base, asks a question, and reads the answer.
Everything in it traces to a source inside that base. Another base's documents
cannot reach it — not through the answer, not through its references, not through
the graph, not through the entity list. When the base has no coverage of a topic
it says so instead of borrowing from a neighbour.

**Why this priority**: it is the product's core promise, the product owner states
it as a hard requirement, and it is currently false. Every other improvement —
finding bases, settings, pickers — is decoration on an answer the operator cannot
trust.

**Independent Test**: create two bases with disjoint, unmistakable content — a
fact present in one and absent in the other. Query each for the other's fact.
Delivered when each answers only from its own content and says so plainly when it
has no coverage.

**Acceptance Scenarios**:

1. **Given** base K1 contains a fact and base K2 does not, **When** the operator
   queries K2 for that fact, **Then** the answer does not contain it and the
   system reports that it has no relevant content.
2. **Given** base K1 contains a fact, **When** the operator queries K1 for it,
   **Then** the answer contains it and every returned reference resolves to a
   source inside K1.
3. **Given** an agent bound to K1 only, **When** it uses its knowledge tool,
   **Then** what it retrieves is limited to K1, and it cannot enumerate or
   describe what K2 holds.
4. **Given** an agent bound to K1 and K2, **When** it asks one question, **Then**
   both bases are searched and the answer attributes each part to the base it came
   from.
5. **Given** the operator opens the graph or the entity list of a base, **When**
   they read it, **Then** it describes that base only.
6. **Given** base K1 is deleted, **When** K2 is queried, **Then** K2 is unaffected
   and answers as before.

---

### User Story 2 - Finding a base, and seeing what an agent reads (Priority: P1)

An operator opens Knowledge and finds any base immediately — by name, by what it
contains, by when it was last indexed — without scanning everything in the
installation. From an agent, they see and change which bases it reads without
leaving the agent. Choosing bases for an agent shows what each one holds, not a
column of identical checkboxes.

**Why this priority**: this is the second half of the request's main improvement —
«сейчас они просто выводятся все вместе» — and the part an operator meets on every
visit. It needs no new concept, only navigation.

**Independent Test**: with 40 bases present, find a named one and change an
agent's bindings. Delivered when neither task requires scrolling an unfiltered
list of every base.

**Acceptance Scenarios**:

1. **Given** many bases exist, **When** the operator opens Knowledge, **Then**
   they can narrow the list by name and by content, and the list pages rather than
   rendering every base at once.
2. **Given** an agent is open, **When** the operator looks at its knowledge,
   **Then** they see which bases it reads and can change that from there.
3. **Given** the operator is choosing bases for an agent, **When** they open the
   picker, **Then** each entry shows what the base contains — its sources, its
   size, its state — and the picker stays usable as the number of bases grows.
4. **Given** an agent takes its bases from a template default, **When** the
   operator looks at it, **Then** it is visible that they are inherited and from
   where.
5. **Given** a base is deleted, **When** an agent that read it is opened, **Then**
   the missing binding is visible rather than silently dropped.
6. **Given** only a few bases exist, **When** the operator uses Knowledge, **Then**
   nothing added by this story costs a step compared to today.

---

### User Story 3 - A module you can use without a briefing (Priority: P2)

Someone who has never opened Knowledge creates a base, adds a document, indexes
it and gets an answer — without reading documentation, without asking a
colleague, and without touching a single optional setting. The screens they pass
through carry only what that journey needs. The controls that tune retrieval
exist, but they are folded away until asked for, and each one says what it
trades. Controls that change nothing are gone.

**Why this priority**: it is the follow-up ask stated directly — the module must
get more intuitive **without getting heavier** — and it is what turns US1 and US2
from mechanics into something usable. It sits below them because it depends on
both: two of today's confusing controls are meaningless until retrieval has a
boundary, and the flat list cannot be simplified until it has a structure.

**Independent Test**: hand the module to someone who has not seen it and not read
the code, with no instructions beyond "make this answer a question about this
document". Delivered when they succeed unaided and can afterwards state what
each control they saw does.

**Acceptance Scenarios**:

1. **Given** a new operator with a document, **When** they follow the default
   path, **Then** they reach a working answer without opening any advanced or
   optional setting.
2. **Given** any screen in the module, **When** it is rendered, **Then** exactly
   one action on it is presented as the primary one.
3. **Given** the retrieval controls, **When** the operator opens a base, **Then**
   those controls are not shown until explicitly revealed, and their defaults
   produce a usable answer.
4. **Given** a control is visible, **When** the operator reads it, **Then** it
   states what it changes — and, for retrieval controls, what it trades away.
5. **Given** the entity-type and relationship-type settings, which have never
   been applied to anything, **When** this feature ships, **Then** they are gone
   from the interface and from the published contract, and existing bases are
   unaffected by their removal.
6. **Given** any empty state — no bases, no sources, no indexed
   content — **When** the operator reaches it, **Then** it names the next action
   rather than only reporting emptiness.
7. **Given** a base, **When** the operator opens it, **Then** they can see
   without further navigation what it holds, whether it can answer yet, and what
   it will answer from.
8. **Given** an inspection surface that exists for diagnosis rather than daily
   work, **When** the module is navigated, **Then** it does not sit at the same
   level of prominence as the everyday path.
9. **Given** a setup step that requires action outside the product, **When** the
   operator reaches it, **Then** it explains why and what is unavailable until
   the action is taken.

---

### User Story 4 - The active tab is visible (Priority: P2)

An operator moving between the sections of a knowledge base can always see which
one they are on, including after a page reload or when arriving from a link.
Opening a base without naming a section lands on a sensible default rather than
an empty page.

**Why this priority**: small, self-contained, hit on every visit to a base.

**Independent Test**: visit each section directly by URL and by clicking.
Delivered when the current section is unambiguously marked in all cases and no
route under a base renders an empty body.

**Acceptance Scenarios**:

1. **Given** the operator is in any section, **When** the page is rendered,
   **Then** exactly one entry is visibly marked as current.
2. **Given** the operator opens a section's address directly, **When** the page
   loads, **Then** that entry is marked as current.
3. **Given** the operator opens a base without naming a section, **When** the
   page loads, **Then** a default section is shown and marked as current.

---

### User Story 5 - The entity picker opens instantly (Priority: P2)

An operator inspecting a knowledge graph opens the entity picker, types a few
letters, and picks an entity. It responds immediately no matter how much content
is behind it, and it offers only entities from the base they are in.

**Why this priority**: a named defect — the page freezes. US1 removes the worst
multiplier (the list stops being installation-wide) but not the problem: a single
busy base can still hold more entities than one list should render.

**Independent Test**: build a base with an entity count well beyond what
fits on a screen. Delivered when the picker opens without a perceptible pause,
filters as the operator types, and never offers an entity from another base.

**Acceptance Scenarios**:

1. **Given** a base with a large number of entities, **When** the operator
   opens the picker, **Then** it is usable immediately and the page stays
   responsive.
2. **Given** the picker is open, **When** the operator types, **Then** matching
   entities appear and can be selected.
3. **Given** two bases with different entities, **When** the operator opens
   the picker in one, **Then** only that base's entities are offered.
4. **Given** nothing has been indexed yet, **When** the operator opens the
   picker, **Then** it says there are no entities yet instead of showing an empty
   control.

---

### User Story 6 - Indexing status that tells the truth (Priority: P3)

An operator who has pressed Index can see, per source, whether it has been
accepted, is still being processed, is searchable, or has failed and why. A base
reports itself ready only when its content can actually answer a question.

**Why this priority**: it is the second half of "where does the data come from" —
today a base can read *ready* and a source *Indexed* while neither is true yet,
so a legitimately empty answer looks like a broken one. Lower than US1–US5 only
because it misleads rather than misdirects.

**Independent Test**: index a batch containing one source that cannot be
processed. Delivered when the failing source is identifiable by name with its
reason, and the base does not claim readiness it does not have.

**Acceptance Scenarios**:

1. **Given** a source was submitted but not yet processed, **When** the operator
   looks at the source list, **Then** it is shown as in progress, not as indexed.
2. **Given** a source failed, **When** the operator looks at it, **Then** they see
   that source's own reason for failing.
3. **Given** a base whose sources are all still processing, **When** the operator
   looks at the base, **Then** it does not report itself ready.
4. **Given** a base reports itself ready, **When** the operator queries it,
   **Then** its indexed content is retrievable.

---

### Edge Cases

- A base is queried while its content is still being processed → it reports what
  is and is not yet searchable rather than answering from a partial corpus
  silently.
- A base is queried before anything has been indexed → it says so; it does not
  produce a generated answer from no context.
- An agent is bound to several bases and one of them cannot be reached → the
  answer names the base it could not read instead of silently narrowing.
- A base is deleted while it is mid-index → the in-flight work is stopped or
  completed, never left half-applied, and nothing of it survives into another
  base.
- An agent or template references a base that has been deleted → the stale
  reference is visible to the operator and does not silently widen or narrow what
  the agent can read.
- Two bases are given the same name → allowed or rejected, but never ambiguous in
  a picker or in an answer's attribution.
- The transition re-index is interrupted part-way → it resumes from where it
  stopped, and no base is left holding another base's content.
- The retrieval service is unavailable → creating and editing bases still works;
  querying and graph report the outage plainly.
- More bases exist than the platform can serve as isolated areas → the ceiling is
  visible to the operator before it degrades answers, and reaching it is reported
  rather than silently answered from a shared pool.

## Requirements *(mandatory)*

### Functional Requirements

**Isolation and trust**

- **FR-001**: Querying a knowledge base MUST draw only on content that belongs to
  that base; content from another base MUST NOT influence the answer or appear in
  its references.
- **FR-002**: The graph view and its entity list MUST describe only the base being
  viewed.
- **FR-003**: When a base holds no content relevant to a question, the system MUST
  say so rather than produce an answer assembled from elsewhere.
- **FR-004**: An agent MUST be able to retrieve only from the bases bound to it,
  and MUST NOT be able to discover the existence or the contents of a base it is
  not bound to through any tool it can call.
- **FR-005**: Every reference returned with an answer MUST identify the source it
  came from and the base that source belongs to.
- **FR-006**: When an agent reads several bases, the answer MUST attribute each
  part to the base it came from.
- **FR-007**: Isolation MUST hold for the generated answer itself, not only for
  the references shown beside it; discarding foreign results after generation is
  not sufficient.
- **FR-008**: Until isolation is in place, every surface that can be queried MUST
  state the actual reach of retrieval. The product MUST NOT imply a boundary it
  does not yet provide.

**Organisation**

- **FR-009**: The knowledge list MUST be searchable and paged, and no screen MUST
  require the operator to scan every base in the installation to find one.
- **FR-010**: An agent's screen MUST show which bases it reads and MUST allow
  changing them without navigating away.
- **FR-011**: Binding screens MUST present each base with enough context to choose
  it — what it holds, its size, its state — rather than a name and a checkbox.
- **FR-012**: Where an agent's bases come from a template default, the interface
  MUST show that they are inherited and from where.
- **FR-013**: A binding that points at a deleted base MUST be visible to the
  operator rather than silently dropped.
- **FR-014**: An agent MUST be able to read several bases, and binding a base to
  an additional agent MUST NOT duplicate its content or its indexing cost.
- **FR-015**: This feature MUST NOT add a container above knowledge bases, and
  MUST NOT partition agents, templates or user access.
- **FR-016**: Nothing added for organisation MUST cost an extra step in an
  installation holding only a few bases.

**Clarity without weight**

- **FR-017**: The default path — create a base, add a source, index, ask — MUST
  be completable without opening or changing any optional setting.
- **FR-018**: Retrieval-tuning controls MUST be hidden behind an explicit
  disclosure, and their defaults MUST produce a usable answer unaided.
- **FR-019**: Each screen in the module MUST present exactly one action as
  primary.
- **FR-020**: Settings that have no effect on the system's behaviour MUST NOT be
  offered; the entity-type and relationship-type settings, which have never been
  applied, MUST be removed from the interface and from the published contract.
- **FR-021**: Every control visible in the module MUST carry a description of
  what it changes; retrieval controls MUST also state what they trade away.
- **FR-022**: Every empty state MUST name the next action.
- **FR-023**: Opening a base MUST show, without further navigation, what it
  holds, whether it can answer yet, and which sources are behind it.
- **FR-024**: Surfaces that exist for diagnosis rather than daily work MUST NOT
  occupy the same prominence as the everyday path.
- **FR-025**: Setup steps that require action outside the product MUST state why
  and what is unavailable until the action is taken.

**Interface**

- **FR-026**: Exactly one navigation entry MUST be marked as current on every
  route under a knowledge base, including on direct navigation and reload.
- **FR-027**: Opening a base without naming a section MUST show a default section
  rather than an empty page.
- **FR-028**: The entity picker MUST remain responsive regardless of how many
  entities a base holds, and MUST let the operator narrow the list by
  typing.
- **FR-029**: The entity picker MUST distinguish "nothing has been indexed yet"
  from "no entity matches what you typed".

**Status**

- **FR-030**: Each source MUST report its own state through ingestion — accepted,
  processing, searchable, or failed — and a failed source MUST carry its own
  reason.
- **FR-031**: A base MUST report itself ready only when its content is
  retrievable.
- **FR-032**: A failure affecting one source MUST NOT prevent the rest of a batch
  from being processed, and MUST NOT be reported as a failure of the base as a
  whole.

**Continuity**

- **FR-033**: The transition MUST NOT lose any base, source, uploaded file or
  binding that exists today, and MUST NOT require the operator to re-upload or
  re-enter anything.
- **FR-034**: The transition MUST re-process existing content into per-base areas
  automatically, MUST report progress per base, and MUST be resumable after an
  interruption.
- **FR-035**: Agents and templates bound to knowledge today MUST read exactly the
  same bases after the transition.
- **FR-036**: While the transition is running, a base that has not yet been
  re-processed MUST report that its answers are incomplete rather than answering
  as if it were ready.

### Key Entities

- **Knowledge base**: a named, described collection of sources, and the unit that
  answers. It is what an operator manages — ingests into, indexes, binds through
  and deletes — it reports its own ingestion state, and retrieval never crosses
  it. There is no container above it.
- **Source**: one piece of content in a base — an uploaded file, a web address, or
  pasted text. Carries its own ingestion state and failure reason, is what an
  answer's references point back to, and is re-processable from Ranch's own
  storage without the operator supplying it again.
- **Binding**: the link from an agent, or from a template as its default, to the
  bases it may retrieve from. An agent may hold several; a base may be read by
  several agents. It is the only thing that decides what an agent can reach.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a two-base isolation test where each holds a fact the other
  lacks, 100% of answers cite only sources from the base that was asked and 0%
  contain the other's fact.
- **SC-002**: An agent bound to one of two bases cannot obtain the other's content
  or a description of it through any tool available to it, across an adversarial
  set of at least 10 attempts written to elicit it.
- **SC-003**: An operator holding 40 or more bases locates a specific base in
  under 15 seconds without reading a list of every base in the installation.
- **SC-004**: With only a few bases present, the number of steps to reach any base
  is no greater than it is today — verified click-for-click against the current
  module.
- **SC-005**: A person who has never used the module reaches a correct answer to a
  question about their own document, unaided and without documentation, in under
  10 minutes — verified with at least 3 people.
- **SC-006**: The default journey touches zero optional settings; the count of
  controls an operator must interact with to reach an answer is no more than the
  fields the content itself requires.
- **SC-007**: Every setting shown on a knowledge base has an observable effect; a
  review finds zero settings that change nothing.
- **SC-008**: For every control visible by default, at least 3 people who have not
  read the code can state what it changes.
- **SC-009**: The entity picker becomes usable within 1 second of opening at any
  base size, with no frozen or unresponsive page.
- **SC-010**: 100% of navigation entries under a knowledge base show a
  distinguishable current state, verified on every section by both click and
  direct navigation.
- **SC-011**: For a batch containing a source that cannot be processed, the
  operator identifies which source failed and why, from the interface alone,
  without opening logs.
- **SC-012**: An answer produced for an agent bound to N bases attributes every
  part of itself to one of those N bases, and no retrieval is issued against any
  other base.
- **SC-013**: The transition loses zero bases, sources, uploaded files or bindings
  — verified by a before/after count on each — and requires zero operator actions
  to restore content.
- **SC-014**: "Where did this answer come from?" stops being unanswerable: for any
  answer, the operator can name the base and open the source behind each
  reference.

## Assumptions

- **The retrospective's findings are the baseline.** They were read from the
  repository at `955516f` and are recorded with file-level evidence in
  `retrospective.md`. In particular: base-level isolation is intended by the
  original design, described in the documentation, and not present in the running
  system.
- **Ranch is personal.** Stated by the product owner: no customers, no tenancy,
  one owner per installation. This is what removes the case for a container above
  knowledge bases, and it is the assumption to revisit first if Ranch ever serves
  more than one party.
- **Isolation cannot be achieved by filtering at query time.** The retrieval
  service fixes its isolation namespace when a process starts, makes it immutable
  afterwards, and offers no per-request or per-document scoping — its `/query`
  endpoint takes no namespace at all. Isolation is therefore a deployment-level
  arrangement, not a query-level one.
- **An isolated base costs a running process, not a datastore.** The retrieval
  storage is relational and namespaces isolation with a logical field in shared
  tables, so an additional area adds no database. It does add a process, at the
  current request of 500m CPU and 1Gi memory per instance. **This is the central
  problem for planning**: how many isolated bases the cluster carries at once, and
  whether instances are held permanently, started on demand, or pooled. The
  requirement is fixed; the arrangement that pays for it is not.
- **The existing pool cannot be split.** Everything ingested so far sits in one
  undifferentiated area with no per-base marker that retrieval honours, so the
  transition re-processes rather than re-labels.
- **Re-processing needs nothing from the operator.** Every source type is
  recoverable from Ranch's own storage — pasted text from the stored content, web
  addresses by re-fetching, files from object storage — so the transition costs
  model usage and time, not lost content or re-uploads. Sources whose origin has
  since disappeared (a web address that no longer resolves) are the exception, and
  the transition must report them rather than drop them silently.
- **"Workspace" stays out of the product surface.** The word already means the
  retrieval service's per-base namespace, the agent screen's layout, and "the
  whole installation" in existing copy. Operators see knowledge bases instead.
- **Removing the two dead settings is a contract change** visible to generated
  clients in both consoles. It is treated as part of this feature, not as
  incidental cleanup.
- **The `app` console is untouched.** Knowledge stays admin-only; an end-user
  surface is recorded as a candidate in the retrospective, not planned here.
- **The roadmap items in the retrospective are not in scope**: reranking, the
  `mix` retrieval mode, chunk inspection, content-hash dedup, scheduled re-crawl,
  retrieval evaluation via the existing judge harness, and knowledge query
  metering. They are written down so the next planning round starts from a list
  rather than from memory.
- **Priorities are read from the request and the product answer**: isolation is
  P1 because the product owner states it as a hard requirement and it is currently
  false; finding bases is P1 because the request names it as the main improvement;
  the clarity work follows both because it depends on both.
