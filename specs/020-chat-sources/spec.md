# Feature Specification: Sources in Chat Answers — Numbered Citations, a Source List, and Feedback on Our Own Sources

**Feature Branch**: `feat/CLEAN-138-chat-sources`

**Created**: 2026-10-05

**Status**: Draft

**Ticket**: [CLEAN-138](https://dreamvention.atlassian.net/browse/CLEAN-138)

**Clarified (2026-10-07)**: "Берем B. С оговоркой, что добавляем для knowledge настройку политики просмотра, чтобы если была включена опция, то документ можно смотреть и скачивать" — an internal source opens the document itself, viewable and downloadable, but only when the knowledge base's new viewing policy allows it (Story 5, FR-016–FR-016d).

**Input**: User description: "Необходимо проанализировать ranch/runtime репозитории для реализации фичи с соурсами, чтобы соответствовать референсу. Возможность скрывать их. Но суть вероятно в использовании knowledge, чтобы оттуда брать источники и оставлять фидбек для них. По поводу функции добавления в избранные, пока не уверен, думаю без этого. Пока нужно оставиться на двух вариантах соурсов. Внутренние (knowledge) и внешние любые, лайк мы можем ставить только своим конечно, собирая это в knowledge, для статистики"

Earlier context from the same conversation: "[^1] — они вот такие вот плейсхолдеры ставят в коде — это LLM возвращает, а потом брайдл может привязать их к ссылкам и внизу их вывести".

## Background

An agent answers from what it knows, from the knowledge bases bound to it, and
from whatever it looks up on the way. Today the person reading the answer cannot
tell which is which: the text arrives as one block, and a fact that came from an
uploaded contract looks exactly like a fact the model produced on its own. There
is nothing to click, nothing to check, and nothing to tell the team which of
their documents are actually doing the work.

The reference is a chat where the answer carries small numbered chips after the
sentences they support, and under the answer sits a numbered list of the sources
those chips point to, with a control that hides the list.

The current state of both repositories is recorded in
[analysis.md](./analysis.md). The short version: a knowledge lookup already
returns, next to its answer, the list of knowledge sources it drew on — and that
list is dropped on the way to the person. Nothing in the chat knows a source
exists. Feedback exists only for a whole message, and only in the history views.

### Terms

- **Source** — one thing an answer drew on, shown to the reader as a numbered
  entry under the message.
- **Internal source** — a source that is an entry of one of our knowledge bases
  (an uploaded file, a saved page, a piece of text).
- **External source** — any other source: a page on the open web the agent
  looked up while answering.
- **Citation** — the numbered chip inside the answer text that points to a
  source in the list.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what an answer is based on (Priority: P1)

A person asks an agent a question. The agent consults a knowledge base. The
answer arrives with small numbered chips after the statements that came from
that knowledge, and under the answer there is a numbered list naming each source.
The person can see at a glance that the answer rests on three documents and
which statement rests on which.

**Why this priority**: This is the feature. Everything else — hiding, feedback,
statistics — hangs off a list that has to exist first. On its own it already
changes what the reader can do with an answer: trust it for a reason, or go
check.

**Independent Test**: Bind a knowledge base with known documents to an agent,
ask a question only those documents answer, and confirm the answer shows
citations and a source list whose entries are exactly the documents consulted.

**Acceptance Scenarios**:

1. **Given** an agent with a knowledge base bound, **When** the person asks a
   question the knowledge base answers, **Then** the answer shows numbered
   citations in the text and a numbered list of sources under it, and every
   citation number has an entry with the same number in the list.
2. **Given** an answer that cites the same source in two places, **When** it is
   shown, **Then** both citations carry the same number and the list holds that
   source once.
3. **Given** an answer that drew on nothing — small talk, or a reply from the
   model's own knowledge — **When** it is shown, **Then** there are no citations
   and no source list, and the message looks exactly as it does today.
4. **Given** an answer with sources, **When** the person reloads the page or
   comes back later and opens the same conversation, **Then** the citations and
   the list are still there, with the same numbers.
5. **Given** an answer still being written, **When** citations arrive in the
   text before the list is known, **Then** the reader never sees a raw
   placeholder such as `[^1]`; a citation appears as a chip or not at all.
6. **Given** a citation chip, **When** the person activates it, **Then** the
   matching entry in the list is brought into view and visibly marked.

---

### User Story 2 - Tell our sources from outside ones, and open them (Priority: P2)

The agent answered partly from the team's knowledge base and partly from a page
it found on the web. The list under the answer shows both, and the reader can
tell which entries are the organisation's own material and which are outside
pages. An outside page opens in a new tab.

**Why this priority**: The two kinds mean different things to the reader — one
is the organisation speaking, the other is the open web — and only the first can
be rated. Without the distinction, the feedback in Story 4 has nothing to stand
on.

**Independent Test**: Ask a question that makes the agent use both a knowledge
base and a web lookup; confirm both kinds appear in one numbered list, are
visibly different, and that an external entry opens the page it names.

**Acceptance Scenarios**:

1. **Given** an answer that used a knowledge base and a web page, **When** it is
   shown, **Then** the list holds both in one numbering and each entry is marked
   as internal or external.
2. **Given** an external source, **When** the person activates it, **Then** the
   page opens in a new tab and the conversation stays where it was.
3. **Given** an internal source from a knowledge base whose keeper allowed
   viewing, **When** the person activates it, **Then** the document itself opens
   — in a new tab when the browser can show it, as a download otherwise — and
   the conversation stays where it was.
4. **Given** an internal source from a knowledge base whose keeper did not allow
   viewing, **When** it is listed, **Then** it shows its name and can be rated,
   but cannot be opened, and nothing about it hints where the document is kept.
5. **Given** an internal source and a reader from the platform team, **When**
   they activate it, **Then** it opens regardless of the viewing policy, as it
   does in the knowledge console today.
6. **Given** an external source whose page has no title, **When** it is listed,
   **Then** the entry shows the site's address in a readable form rather than an
   empty line.
7. **Given** the model wrote a citation that matches nothing it actually
   consulted, **When** the answer is shown, **Then** that citation is not drawn
   and no entry is invented for it.

---

### User Story 3 - Hide the sources (Priority: P2)

A person reading a long conversation finds the lists under every answer in the
way. They hide the sources of a message with one control and bring them back
with the same control.

**Why this priority**: Asked for explicitly, and cheap. It sits below Story 1
only because there must be a list before it can be hidden.

**Independent Test**: On an answer with sources, hide the list, confirm it is
gone and the control now offers to show it, show it again.

**Acceptance Scenarios**:

1. **Given** an answer with sources, **When** it first appears, **Then** the list
   is shown and a control offers to hide it.
2. **Given** a shown list, **When** the person hides it, **Then** the list
   disappears, the answer text and its citations stay, and the control now
   offers to show the sources.
3. **Given** a hidden list, **When** the person activates a citation in the
   text, **Then** the list opens and the matching entry is marked.
4. **Given** a person who hid the sources of one message, **When** they look at
   another message, **Then** that other message's list is unaffected.
5. **Given** a message without sources, **When** it is shown, **Then** there is
   no control.

---

### User Story 4 - Say whether one of our sources helped (Priority: P3)

Next to each internal source in the list there is a like and a dislike. A person
who found that the cited document really answered the question marks it; one who
found it stale or beside the point marks it the other way. External sources have
no such control — the page belongs to someone else and nobody here can act on
the verdict.

**Why this priority**: It is the reason the feature is tied to knowledge rather
than being a display nicety, but it only becomes useful once sources are shown
and people have got used to them.

**Independent Test**: On an answer citing an internal and an external source,
confirm only the internal one can be rated, rate it, reload, and confirm the
rating is still shown.

**Acceptance Scenarios**:

1. **Given** a list with an internal and an external source, **When** it is
   shown, **Then** the internal entry carries like and dislike and the external
   entry carries neither.
2. **Given** an internal source the person has not rated, **When** they like it,
   **Then** the like shows as given, immediately.
3. **Given** a liked source, **When** the person activates the like again,
   **Then** the rating is withdrawn; **When** they activate dislike instead,
   **Then** the rating flips.
4. **Given** a rating that could not be saved, **When** the failure is known,
   **Then** the control returns to its previous state and the person is told it
   did not go through.
5. **Given** a person who rated a source, **When** they reopen the conversation
   later, **Then** their rating is shown as they left it.
6. **Given** the same source cited under two different answers, **When** the
   person rates it under one, **Then** the other is unaffected — the verdict is
   about the source's use in that answer.
7. **Given** the reference design's bookmark control, **When** the list is shown,
   **Then** there is no bookmark; saving sources to favourites is not part of
   this feature.

---

### User Story 5 - Decide whether readers may open our documents (Priority: P2)

Someone who looks after a knowledge base decides, per knowledge base, whether
the people an agent answers may open the documents it cites. A base of public
product manuals is opened up; a base of internal contracts stays closed — its
sources are still named and rated under answers, but nobody outside the platform
team can read them.

**Why this priority**: Story 2 opens documents to anyone who can read a chat,
including visitors on a shared link. That is only acceptable if the keeper of
each knowledge base chose it. The policy therefore ships with, not after, the
opening of documents.

**Independent Test**: With viewing off, confirm a cited internal source cannot
be opened from the customer console or a shared link; turn it on; confirm the
same source now opens, and that a direct request for a document of a closed base
is refused.

**Acceptance Scenarios**:

1. **Given** a knowledge base, **When** its keeper opens its settings, **Then**
   there is a viewing policy with two states — readers may open and download its
   documents, or may not — and it is off for every knowledge base that exists
   today and every new one.
2. **Given** viewing is off, **When** anyone outside the platform team tries to
   open a cited document, by click or by asking for its address directly,
   **Then** they are refused, and the chat never offered the link in the first
   place.
3. **Given** viewing is on, **When** a reader opens a cited document, **Then**
   they can view it and download it, but only documents that were actually
   cited in a conversation they can read — the policy opens cited documents, not
   the whole base to browsing.
4. **Given** the keeper turns viewing off, **When** a reader looks at an older
   answer citing that base, **Then** the entries are still named but no longer
   open.
5. **Given** the platform's own assistant, **When** the keeper asks it to open
   or close viewing for a knowledge base, **Then** it can do so after asking for
   confirmation, and can say what the policy currently is.
6. **Given** a source saved from a web page, **When** viewing is off, **Then**
   its public address is still not offered — the policy is per base, with no
   exceptions by source kind.

---

### User Story 6 - See which sources earn their place (Priority: P3)

Someone who looks after a knowledge base opens it and sees, for each source, how
often it was cited in answers and how those citations were rated. A document
cited fifty times with mostly dislikes is a document to rewrite; one never cited
is a document nobody needed.

**Why this priority**: This is what the ratings are collected for, but it is
read by a few people on the platform team and only has something to show after
Stories 1 and 4 have been live for a while.

**Independent Test**: Rate a known source under several answers from different
people, open its knowledge base, and confirm the counts match what was done.

**Acceptance Scenarios**:

1. **Given** a knowledge base whose sources were cited and rated, **When** its
   keeper opens the list of sources, **Then** each source shows how many times
   it was cited, how many likes and how many dislikes it received.
2. **Given** a source that was never cited, **When** it is listed, **Then** it
   shows zero, not a blank.
3. **Given** a person who withdrew or flipped a rating, **When** the counts are
   read, **Then** they reflect that person's current verdict only.
4. **Given** the list of sources, **When** the keeper sorts it by citations or
   by dislikes, **Then** the most cited or the worst rated come first.
5. **Given** the platform's own assistant, **When** the keeper asks it which
   sources of a knowledge base are rated worst, **Then** it can answer from the
   same numbers the console shows.

---

### Edge Cases

- **A source removed from the knowledge base after it was cited.** The old
  answer keeps the entry with the name it had; it can no longer be opened or
  rated, and it says so rather than failing on click.
- **A knowledge lookup that returns an answer but names no sources**, or names
  one that matches no entry of the knowledge base. The answer is shown without a
  citation for that part; nothing is listed that cannot be named.
- **A knowledge base that is not answering** (restarting, timing out). The reply
  carries no sources from it; no empty list is drawn.
- **Several knowledge bases consulted in one answer.** One list, one numbering;
  an entry tells which knowledge base it belongs to when more than one is
  involved.
- **The same page reached twice** in one answer (two lookups, the same address).
  One entry.
- **A very long list** — an answer that drew on twenty sources. The list stays
  readable and does not push the next message off the screen without a way to
  collapse it; the hide control from Story 3 is that way.
- **A long source name or address.** It wraps or truncates inside the message;
  it never widens the conversation.
- **Text that looks like a citation but is not one** — a footnote marker inside
  a code block, or in a message the person typed. It is left exactly as written.
- **An answer copied or exported.** Citations and the list travel as readable
  text (numbers and names), not as raw placeholders.
- **A conversation in a channel that cannot draw a list** (a messenger). The
  person never sees raw placeholders there; what such a channel shows instead is
  outside this feature, but it must not get worse than today.
- **Answers written before this feature.** They show no sources and nothing
  about them changes.
- **A person without a stable identity** (a visitor on a shared link) rating a
  source. Their rating is remembered for that browser, as their conversation is.
- **An address that is not a web page** — a script or a local file address
  offered as an external source. It is never made clickable.

## Requirements *(mandatory)*

### Functional Requirements

**Showing sources**

- **FR-001**: When an answer drew on one or more sources, the chat MUST show a
  numbered list of those sources under that answer.
- **FR-002**: The chat MUST show, inside the answer text, a numbered citation at
  each place the answer marks as supported by a source, and the number MUST
  match that source's number in the list.
- **FR-003**: Numbers MUST start at 1 for each answer, follow the order in which
  sources are first cited in the text, and be the same every time the answer is
  shown.
- **FR-004**: A source MUST appear once in an answer's list however many times
  it is cited or was consulted.
- **FR-005**: A source MUST be listed only if the agent actually consulted it
  while producing that answer. A citation that matches no consulted source MUST
  NOT be drawn, and no entry may be created for it.
- **FR-006**: A source the agent consulted but did not cite in the text MUST NOT
  be listed. *(The list explains the citations; it is not a log of everything
  the agent touched.)*
- **FR-007**: The reader MUST never see an unresolved citation placeholder, at
  any moment — while the answer is being written, after it is complete, or when
  it is loaded from history.
- **FR-008**: Activating a citation MUST bring its entry in the list into view
  and mark it visibly; if the list is hidden, it MUST be shown first.
- **FR-009**: An answer without sources MUST look exactly as it does today.
- **FR-010**: Sources MUST survive a reload and be present when the conversation
  is opened from history, in every place a conversation with an agent is drawn:
  the platform team's chat, the customer console's chat, the shared-link page,
  and the conversation history views of both consoles.

**Two kinds of source**

- **FR-011**: Every source MUST be exactly one of two kinds: internal (an entry
  of one of our knowledge bases) or external (anything else). No third kind is
  introduced by this feature.
- **FR-012**: The list MUST make the kind of each entry visible without
  activating it.
- **FR-013**: An internal source MUST be listed under the name it has in its
  knowledge base; when an answer drew on more than one knowledge base, the entry
  MUST also say which one.
- **FR-014**: An external source MUST be listed under the title of its page, or
  under a readable form of its address when there is no title, and MUST open
  that address in a new tab.
- **FR-015**: Only ordinary web addresses may be made clickable. Any other kind
  of address MUST be shown as text or left out.
- **FR-016**: Activating an internal source MUST open the document itself — to
  view where the browser can show it, to download otherwise — when its knowledge
  base's viewing policy allows it or the reader is on the platform team, and
  MUST do nothing (the entry is not offered as a link) otherwise.
- **FR-016a**: Each knowledge base MUST carry a viewing policy with two states:
  readers may open and download its cited documents, or may not. The policy MUST
  be off for all existing knowledge bases and off by default for new ones, and
  MUST be changed only by someone who can manage that knowledge base.
- **FR-016b**: A document MUST be obtainable by a reader only when its base's
  policy allows it *and* the document was cited in a conversation that reader
  can read. The policy never opens a base to browsing or to guessing addresses.
- **FR-016c**: Turning the policy off MUST take effect for every answer already
  shown, including ones already open on a screen, within the time it takes to
  reload them; a link handed out earlier MUST stop working.
- **FR-016d**: The platform's assistant MUST be able to read the policy and,
  with confirmation, change it. *(Constitution V.)*
- **FR-017**: A source that no longer exists in its knowledge base MUST stay in
  the lists of answers that cited it, under its last known name, without a way
  to open or rate it.

**Hiding**

- **FR-018**: Every answer with sources MUST carry one control that hides its
  list and, once hidden, shows it again. The list is shown by default.
- **FR-019**: Hiding MUST affect that answer only, and MUST leave the citations
  in the text in place.
- **FR-020**: The control MUST state what it will do ("hide sources" / "show
  sources") and be operable from the keyboard.

**Feedback on internal sources**

- **FR-021**: Each internal source in a list MUST carry a like and a dislike.
  External sources MUST carry neither.
- **FR-022**: A person MUST be able to give one rating per source per answer,
  change it, and withdraw it.
- **FR-023**: A rating MUST show as given immediately, and MUST return to its
  previous state with a visible notice if it could not be saved.
- **FR-024**: A person's own ratings MUST be shown as they left them when the
  conversation is opened again.
- **FR-025**: Everyone who can read the conversation MUST be able to rate —
  platform team, console users and visitors on a shared link alike. A person
  never sees anyone else's rating in the chat.
- **FR-026**: A rating MUST be recorded against the knowledge source itself, so
  that it can be counted across every conversation and agent that cited it.
- **FR-027**: Each citing of an internal source in a delivered answer MUST be
  counted against that source, whether or not anyone rated it.
- **FR-028**: Bookmarking or saving a source to favourites is NOT part of this
  feature; no such control is shown.

**Statistics**

- **FR-029**: The list of sources of a knowledge base MUST show, per source, the
  number of times it was cited and the number of likes and dislikes, with zero
  shown as zero.
- **FR-030**: That list MUST be sortable by each of those numbers.
- **FR-031**: The numbers MUST count each person's current verdict once per
  answer; a withdrawn rating is not counted.
- **FR-032**: Removing a source MUST remove its numbers with it. Removing a
  conversation MUST NOT remove the ratings already counted for a source.
- **FR-033**: The platform's assistant MUST be able to report the same numbers
  on request. *(Constitution V: the console is a window, the chat is the hands.)*

**Boundaries**

- **FR-034**: Sources MUST be shown the same way in both consoles; a difference
  between them is a defect. *(Constitution II.)*
- **FR-035**: A source entry shown to a reader MUST NOT reveal anything beyond
  its name, its kind, its knowledge base's name where required by FR-013, and —
  for external sources — its address. No storage locations, internal
  identifiers shown as text, or contents.
- **FR-036**: Channels other than the chat itself (messengers) are outside this
  feature, but a person there MUST NOT start seeing raw placeholders because of
  it.
- **FR-037**: All wording added to the customer console MUST be available in
  every language that console offers; source names, page titles and addresses
  are shown as they are, never translated. *(Constitution VI.)*

### Key Entities

- **Source (of an answer)**: one thing an answer drew on. Has a kind (internal
  or external), a display name, the number it carries in that answer, and — for
  an external source — a web address; for an internal one — which knowledge
  source and which knowledge base it is. Belongs to exactly one answer.
- **Citation**: a place in the answer text that points to one of that answer's
  sources by number. Many citations may point to one source.
- **Knowledge base** *(existing)*: gains one setting — the viewing policy: may
  readers of an agent's answers open and download the documents it cites. Off
  unless its keeper turns it on.
- **Knowledge source**: an existing entry of a knowledge base (a file, a saved
  page, a piece of text). Gains two running facts: how often it has been cited,
  and how it has been rated.
- **Source rating**: one person's verdict (like or dislike) on one internal
  source as used in one answer. At most one per person, source and answer; can
  be changed or withdrawn. Belongs to the knowledge source, and outlives the
  conversation it was given in.
- **Message rating** *(existing, unchanged)*: a person's verdict on a whole
  answer. Separate from source ratings; this feature neither replaces nor moves
  it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For answers that drew on a knowledge base, at least 90% show a
  source list, measured over a labelled set of at least 50 questions that the
  bound knowledge is known to answer.
- **SC-002**: 100% of listed sources are ones the agent actually consulted for
  that answer — zero invented entries across the same set.
- **SC-003**: Zero raw citation placeholders visible to a reader across that set
  — in the live answer, after reload, and in the history views.
- **SC-004**: Answers that drew on nothing are pixel-for-pixel what they are
  today (no control, no empty list) in 100% of checked cases.
- **SC-005**: A reader can get from a statement to the name of the document
  behind it in one action, and to an external page in two.
- **SC-006**: A person can rate a source in one action and sees the result in
  under one second; a failed rating is visibly undone.
- **SC-007**: A source list and the ratings a person gave are identical before
  and after a reload in 100% of checked cases.
- **SC-008**: The numbers shown for a source in its knowledge base equal the
  citations and ratings actually made, checked on a scripted sequence of at
  least 20 ratings including changes and withdrawals.
- **SC-009**: The same conversation shows the same sources, numbers and controls
  in every place it can be opened — verified side by side in both consoles and
  on the shared-link page.
- **SC-010**: Adding sources does not make answers arrive noticeably later: the
  time until the first words of an answer appear stays within 10% of today's on
  the labelled set.
- **SC-011**: With the viewing policy off, zero documents of that base are
  obtainable by anyone outside the platform team, checked by attempting every
  cited document of a test conversation from the customer console and from a
  shared link; with it on, 100% of cited documents open and 0% of uncited ones.

## Assumptions

- **Where sources come from.** Internal sources are the knowledge sources a
  knowledge lookup reports having used; external sources are the web pages the
  agent's own lookups returned. Addresses the model merely writes into its text
  without having consulted them stay ordinary links and are not sources.
- **Who decides what is cited.** The model places the citations; the platform
  decides whether each one is real (FR-005). Whether a statement *deserves* a
  citation is the model's call and is not checked — only that a drawn citation
  points at something actually consulted. This keeps the decision a rule, not a
  judgment (Constitution VII).
- **The viewing policy is closed by default.** Opening documents to readers is
  a decision the keeper of each knowledge base makes on purpose; nothing that
  exists today changes its behaviour until they do. The policy has two states
  only; per-source exceptions and per-agent policies were not asked for.
- **"Platform team" means the people who can open the knowledge console today.**
  Their access to documents does not depend on the policy.
- **Hiding is per answer and per view.** A hidden list stays hidden while the
  person stays on the page; it is not a saved preference and not an
  administrator setting. A switch that turns sources off for a whole agent was
  not asked for and is not included.
- **Message-level like/dislike**, visible next to the hide control in the
  reference, already exists in the history views and is left as it is. Bringing
  it into the live chat is a separate piece of work.
- **Ratings are anonymous in the statistics.** The numbers say how many, not
  who. Per-person breakdowns, comments on a rating, and trends over time are
  outside this feature.
- **One rating scale.** Like and dislike only, as for messages today.
- **Granularity is the knowledge source**, not the passage inside it. A citation
  says "this document", not "page 4, paragraph 2"; the retrieval in use today
  reports documents, and quoting passages would be a different feature.
- **Existing conversations** gain nothing retroactively: answers written before
  this feature have no recorded sources and show none.
- **Messengers and other channels** keep their current behaviour; giving them a
  textual source list is a possible follow-up.
- **The agent runtime is changed as part of this feature.** The work spans the
  platform and the runtime; the runtime change ships first or together, and an
  older runtime paired with a newer platform simply produces answers without
  sources.
