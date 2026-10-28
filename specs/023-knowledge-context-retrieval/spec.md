# Feature Specification: Knowledge Retrieval Hands the Agent the Found Passages, Not Another Model's Answer

**Feature Branch**: `fix/CLEAN-184-knowledge-context-retrieval`

**Created**: 2026-10-28

**Status**: Draft

**Ticket**: [CLEAN-184](https://dreamvention.atlassian.net/browse/CLEAN-184)

**Input**: User description: "Задача: `query_knowledge` должен отдавать агенту найденные фрагменты, а не ответ чужой LLM. … Агент получает сырые найденные фрагменты (чанки текста, плюс сущности и связи графа, если они полезны) с указанием источника и сам составляет ответ. Генерации ответа внутри LightRAG на пути агента больше нет. Консольный путь не трогать." The full brief, with its proposed design, tests and manual check, is kept verbatim in [`brief.md`](./brief.md); the plan phase takes its design from there after verifying it against the deployed retrieval service.

Earlier description from the same conversation (the symptom as first reported): the agent, asked about adaptive headlights on the 2026 Mazda3 Hatchback, had the answer in two of three knowledge lookups and still hedged, later explaining that one lookup's "I don't have enough information" had outweighed the two that answered; and the answer carried a plain "Source: 26MY Mazda3 Spec Deck" line instead of a cited source.

## Background

An agent bound to a knowledge base asks it questions through one tool. Today
that tool does not return what the base *contains*; it returns what the
retrieval service's own language model *wrote* after reading the matching
passages. The agent never sees the passages. It sees a second model's prose,
including that model's refusals, and has no way to tell a refusal born of a
thin retrieval from a document that genuinely says nothing.

The production case that exposed this: a Mazda agent, 26MY Mazda3 Spec Deck
indexed, asked "For the Mazda3 hatchback what trim levels come with adaptive
headlights?". The agent issued three rephrased lookups in parallel. Two came
back with the trim table (AFS standard on 2.5 S Premium and 2.5 Turbo Premium
Plus, absent on 2.5 S, Select Sport, Preferred and Carbon Edition). The third
came back with "I do not have sufficient information in the provided knowledge
base to generate a comprehensive list…". The agent treated that sentence as
evidence from the source and told the visitor it had no exact breakdown.

Verified in the code (paths in `brief.md`): the lookup asks the retrieval
service for a generated answer; only the generated text and the file
references are kept; the "nothing relevant" detector recognises two canned
phrasings and lets every partial refusal through as an ordinary answer. Each
parallel lookup is therefore an independent retrieval *and* an independent
generation, so results contradict each other and a refusal reads as "the
documents do not say".

The console has a separate, intentional "ask the base and get a written
answer" screen. That stays as it is; this feature changes the agent's path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The agent answers from the document's own words (Priority: P1)

A visitor asks the Mazda agent a factual question whose answer is in an
indexed document. The agent's knowledge lookup returns the matching passages
verbatim, each naming the document it came from. The agent reads the table,
answers directly and cites the spec deck. No second model stands between the
document and the agent.

**Why this priority**: This is the defect. A customer-facing agent gave a
wrong, hedged answer while holding the right one. Everything else in this
spec exists to make this story safe to ship.

**Independent Test**: With the Mazda base indexed, ask the AFS question five
times. Every answer names 2.5 S Premium and 2.5 Turbo Premium Plus, carries no
"I cannot guarantee" hedge, and cites the 26MY Mazda3 Spec Deck. Inspect the
tool result: it holds passage text containing the trim table, with the deck as
source, and no sentence written by the retrieval service.

**Acceptance Scenarios**:

1. **Given** the Mazda base holds the indexed spec deck, **When** the agent
   looks up adaptive headlights on the Mazda3 hatchback, **Then** the tool
   result contains at least one passage whose verbatim text includes the AFS
   trim table and whose source is the spec deck, and contains no prose
   composed by the retrieval service.
2. **Given** the agent issues three rephrasings of the same question in one
   turn, **When** one rephrasing matches fewer passages, **Then** that
   result holds fewer or zero passages and never a sentence such as "I do
   not have sufficient information"; a zero-passage result is reported as
   "no relevant content" in the same shape the tool uses today.
3. **Given** the same question asked five times in a row, **When** the
   answers are compared, **Then** they agree on the trims; no run falls back
   to "check the spec sheet".
4. **Given** a passage answers the question directly, **When** the agent
   writes its reply, **Then** the tool's own description has told it to
   answer from the passages, to cite the source, and that a lookup that found
   nothing does not refute a lookup that found the answer.

---

### User Story 2 - Every lookup result fits the agent's window, whole (Priority: P2)

A broad question against a large base matches many passages. The tool returns
as many whole passages as fit a fixed size budget, most relevant first, and
says how many it left out. The agent's runtime, which cuts over-long tool
results at a fixed length, never has to cut this one, so the agent never
receives a half-passage or broken structure.

**Why this priority**: Returning raw passages makes results larger and more
variable than one paragraph of prose. Without a budget on the producing
side, the consuming side truncates blindly and the agent reads garbage or
nothing. This is what makes Story 1 reliable rather than lucky.

**Independent Test**: Ask four or five table- or list-shaped questions
(prices, engines, trims) against the Mazda base; every tool result is at or
under the budget, parses as valid structured data, and, when the matches did
not all fit, states `truncated` and the count of omitted passages.

**Acceptance Scenarios**:

1. **Given** matched passages whose total size exceeds the budget, **When**
   the result is built, **Then** passages are added whole in relevance order
   until the next one would not fit, the rest are dropped, and the result
   states that it was truncated and how many passages were omitted.
2. **Given** several bases bound to the agent, **When** one lookup fans out
   across them, **Then** the budget is divided between the bases and the
   combined result still fits.
3. **Given** any lookup, **When** its result is produced, **Then** it is at
   most about 12 000 characters and is always valid structured data,
   truncated or not.
4. **Given** two passages with identical text (the same chunk found through
   two search modes), **When** the result is built, **Then** the text
   appears once.

---

### User Story 3 - Nothing the knowledge tool already guarantees is lost (Priority: P2)

The agent path keeps every protection it has today: a base that is not ready
says so instead of answering; an empty isolated base is not asked at all; a
base on the shared pool is asked once, not once per binding; a base that
fails or times out is named in the result and does not take the others with
it; every passage is bound to a source the reader can open and rate; and no
agent ever sees a passage from a base it is not bound to.

**Why this priority**: Each of these was a production incident once
(isolation, shared-pool duplication, silent timeouts, uncitable references).
Re-introducing one while fixing another is not a fix.

**Independent Test**: The existing tool, isolation and client specs pass
unchanged in intent on the new path, and a new case shows that a passage
from an unbound base never reaches the caller.

**Acceptance Scenarios**:

1. **Given** an isolated base with no indexed source, **When** the agent
   asks it, **Then** the result is "no relevant content" and the retrieval
   service is not called.
2. **Given** two bound bases where one times out, **When** the agent asks
   both, **Then** the result names the base that did not answer, with the
   existing advice to retry later, and carries the other base's passages.
3. **Given** a passage from a document the retrieval service knows under an
   old name, **When** the result is built, **Then** the passage is still
   bound to the current source row by the same resolution the tool uses
   today; a passage that resolves to no row is visible as unattributed and
   logged, not dropped silently.
4. **Given** a base that is not bound to the calling agent, **When** any
   lookup runs, **Then** none of its passages appear in the result.
5. **Given** a successful lookup, **When** the result is read by the agent
   runtime, **Then** the list of consulted sources it already expects (one
   entry per distinct source row) is present, so the runtime can number
   them and the chat can list them.

---

### User Story 4 - The console's written answer stays, and a half-refusal is marked as one (Priority: P3)

An operator uses the console's "ask the knowledge base" screen and still gets
a written answer, as today. When the retrieval service's model replies with a
partial refusal ("I do not have sufficient information…", "does not contain
enough information…", "not able to provide a complete…"), the console path
recognises it as such instead of presenting it as the base's answer.

**Why this priority**: The console path is deliberately unchanged, so the
risk is low, but it shows the same refusals to operators that misled the
agent. Flagging them is small and separable.

**Independent Test**: The console query returns the generated answer for an
ordinary question (existing test); for a canned partial refusal it is marked
as "no relevant content" or an equivalent visible flag.

**Acceptance Scenarios**:

1. **Given** the console asks a base an ordinary question, **When** the
   answer arrives, **Then** it is the written answer, unchanged from today.
2. **Given** the retrieval service answers the console with a partial
   refusal, **When** the result is returned, **Then** it is flagged as
   such rather than shown as content from the base.

---

### Edge Cases

- A single passage longer than the whole budget: it is cut to the budget with
  a visible marker rather than dropped, so a one-chunk answer is never empty.
- The retrieval service offers no structured "context only" endpoint on the
  deployed version: the lookup falls back to the text-context form of the
  existing endpoint, still without generation; which path is in use is
  recorded where a maintainer will read it.
- Graph facts (entities and relations) are available but long: they are
  optional, short, and never a rephrasing of the passages; passages take
  precedence inside the budget.
- Zero passages and zero facts: "no relevant content", same shape as today.
- A base mid-migration (`complete: false`): the flag is still reported so the
  agent can say the base is still being re-processed.
- The agent names a base it is not bound to: refused, as today.
- Retrieval takes longer than the bound: the timeout error and its advice are
  unchanged; the bound itself may be lowered once generation is gone, with
  the reason recorded.
- Two bases return the same document text (shared pool plus an isolated
  copy): deduplicated by text within one result.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On the agent's path, a knowledge lookup MUST return the matched
  passages verbatim, each with the name and identity of the source it came
  from and the base it belongs to, and MUST NOT include prose composed by the
  retrieval service's model.
- **FR-002**: The result MAY include short graph facts (entities, relations)
  when they are useful; they MUST NOT restate the passages and MUST yield to
  passages when the budget is tight.
- **FR-003**: Passages with identical text MUST appear once per result.
- **FR-004**: A lookup that matches nothing MUST be reported as "no relevant
  content" in the same shape the tool uses today, never as a sentence.
- **FR-005**: Each tool result MUST fit about 12 000 characters including its
  framing and MUST always be valid structured data. When the matches exceed
  the budget, whole passages are kept in relevance order, the remainder is
  dropped, and the result states `truncated` with the count omitted. When a
  lookup spans several bases, the budget is divided between them.
- **FR-006**: The agent path MUST keep the current guarantees: a base whose
  retrieval instance is not ready is reported as such; an isolated base with
  no indexed source is not asked; the `complete` flag is reported; bases on
  the shared pool are asked once; a base that fails or times out is named in
  the result without affecting the others; the existing timeout message and
  advice are kept.
- **FR-007**: Every passage MUST be bound to a source row through the
  resolution the tool uses today; a passage whose source cannot be resolved
  stays visible as unattributed and is logged.
- **FR-008**: The result MUST carry the list of consulted sources in the shape
  the agent runtime already reads (one entry per distinct source row), so
  numbering and the chat's source list keep working.
- **FR-009**: The tool's description MUST say what the result now is:
  verbatim document fragments to answer from and cite; a lookup that found
  nothing does not refute another lookup's finding; when passages answer the
  question directly, answer with confidence and without "cannot guarantee"
  hedges. The existing instructions to call the tool before drafting and to
  batch independent questions in one turn stay. Timing figures that described
  the old generation path are re-measured or removed.
- **FR-010**: An agent MUST NOT receive passages from a base it is not bound
  to.
- **FR-011**: The console's knowledge query MUST keep returning a written
  answer; its only change is that partial refusals from the retrieval
  service's model are detected and flagged rather than shown as the base's
  answer.
- **FR-012**: The retrieval time bound MUST remain in place; if it is lowered
  because generation is gone, the new value carries its reason.
- **FR-013**: The agent runtime's own output cap MUST NOT be raised for this
  change; fitting the budget is the producing side's job.
- **FR-014**: The pull request MUST state which retrieval endpoint and mode
  are used and why, include a real (shortened) tool result, and report answer
  time before and after.

### Key Entities

- **Passage**: one verbatim fragment of an indexed document as the retrieval
  service stored it; carries its text, the source's display name and
  identity, and the base it came from. Never paraphrased.
- **Knowledge lookup result**: what one tool call returns for one base: the
  base's identity and name, its `complete` flag, the ordered passages, optional
  graph facts, whether the result was truncated and how many passages were
  omitted, the consulted-sources list, or the "no relevant content" reason, or
  a named error. Several bases produce several such results in one call.
- **Partial refusal**: a sentence written by the retrieval service's model
  saying it lacks enough information for a complete answer; on the agent path
  it no longer exists, on the console path it is detected and flagged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On staging with the Mazda base, the adaptive-headlights question
  is answered correctly and without a hedge in 5 of 5 consecutive runs, each
  answer citing the 26MY Mazda3 Spec Deck.
- **SC-002**: For the AFS question and 3 to 4 further table- or list-shaped
  questions, 100% of tool results are at or under the budget and parse as
  valid structured data.
- **SC-003**: No tool result on the agent path contains a refusal sentence
  from the retrieval service's model (0 occurrences across the manual set and
  the automated specs).
- **SC-004**: Median agent answer time for knowledge questions does not rise
  and is expected to fall, since the retrieval service no longer generates;
  the before/after numbers are in the PR.
- **SC-005**: The automated specs beside the slice (retrieval client, tool,
  isolation, console path) pass, including the Mazda AFS regression case, and
  the PR names the command that ran them.
- **SC-006**: The console query screen behaves as before for ordinary
  questions, and a partial refusal is visibly flagged.

## Assumptions

- The deployed retrieval service (LightRAG, image tag `latest`) exposes either
  a structured "data only" query or a "context only" option on its query
  endpoint; the plan phase checks the live instance's API description before
  choosing and records the choice.
- The 12 000-character budget is derived from the agent runtime's 16 000
  character cap on a tool result minus room for framing; an MCP result reaches
  that cap as a single string, so the producing side must stay under it.
- Relevance order is whatever the retrieval service reports; the API does not
  re-rank.
- A passage longer than the budget is cut with a marker rather than dropped.
- Search mode defaults to the richest mode the deployed instance supports;
  otherwise the mode used today.
- The duplicate retrieval client in the separate `reins/nestjs/` repository
  is out of scope and is noted in the PR.
- The console UI and the runtime's own output cap are out of scope.
- The hypothesis that the agent's intermediate text (the table it wrote
  between tool calls) was hidden in the chat's collapsed "Thought for a
  moment" block is not part of this feature; it is to be checked against the
  session events and raised as its own CLEAN ticket if confirmed.
- The CleanSlice MCP that the brief asks to consult before coding was not
  reachable from the session that wrote this spec; the plan phase runs it or
  records that it was unavailable.
