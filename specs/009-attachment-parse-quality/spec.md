# Feature Specification: Attached Document Display and Extraction Quality

**Feature Branch**: `feat/CLEAN-67-attachment-parse-quality`

**Ticket**: [CLEAN-67](https://dreamvention.atlassian.net/browse/CLEAN-67)

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Нужно провести анализ, касательно парсинга загруженных файлов, и обработки их. Первое, после перерзагрузки страницы, отправленный файл превращается в текст и занимает колосальное количество места. Нужно это исправить или оптимизировать. Второе, может допускать ошибки. Можем ли этот момент тоже исправить, для более качественной работы с документами. В серьезных организациях, такие ошибки - недопустимы"

## Context

Since CLEAN-63 a document attached to a chat message (spreadsheet, Word document, PDF) is converted to text on the server and that text is appended to the message the agent receives. Two consequences were observed in the admin agent chat:

1. **After a page reload the user's bubble shows the agent-facing text.** While the page is open the bubble shows the typed text plus a file chip. After reload the conversation is restored from the persisted transcript, and that transcript stores the *combined* text (typed text + the full extracted document). A three-sheet workbook produced a bubble several screens tall, mostly a supplier name repeated forty times per row. The same combined text appears in chat history and exports.

2. **The agent misreads spreadsheets.** In the observed conversation it reported per-sheet totals of ~2,706 and ~5,098 where the sheets contained single values of 1,476 and 2,598.40, and only corrected itself after the user challenged it. The spreadsheet text the agent receives repeats merged-cell values across every column they span, drops blank rows, gives no row or column coordinates, does not mark formula/total cells, and is replayed in full on every later turn of the conversation. Together this makes arithmetic over the sheet unreliable.

Both problems share a root: the text a person typed and the text the agent is fed are stored as a single string, and that string is neither compact nor faithful to the structure of the source document.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reloaded conversation shows what I typed, not what the agent was fed (Priority: P1)

An operator attaches a workbook to a message, sends it, and later reloads the page (or opens the conversation on another device, or opens it in chat history). The message bubble looks the same as it did right after sending: the typed text and a compact file chip. The extracted document text is not shown inline.

**Why this priority**: Every conversation with a document attachment becomes unreadable after reload today. It affects every operator, on every reload, regardless of whether the agent answered well.

**Independent Test**: Attach a multi-sheet workbook, send "распарси", reload the page. The bubble must show "распарси" and one chip named after the file. Repeat for chat history and export. Delivers value on its own even if extraction quality is untouched.

**Acceptance Scenarios**:

1. **Given** a sent message with a typed text and one document attachment, **When** the page is reloaded, **Then** the bubble shows only the typed text and the file chip, and its height is comparable to a message without attachments.
2. **Given** a message that had a file and no typed text, **When** the conversation is restored, **Then** the bubble shows the file chip and no synthetic body text (or a minimal placeholder), never the extracted document.
3. **Given** a message with several attachments of mixed kinds (image, spreadsheet, PDF), **When** restored, **Then** one chip per attachment appears in the original order and the typed text is unchanged.
4. **Given** a conversation persisted **before** this change (transcript already contains the combined text), **When** restored, **Then** the extracted block is still hidden and the chip is shown: the fix applies on read, no migration of old conversations is required.
5. **Given** chat history browsing or export of the same conversation, **When** opened, **Then** the user turn shows typed text and attachment names, not the extracted body.
6. **Given** the operator wants to check what the agent actually received, **When** they use the existing debug affordance in the admin chat, **Then** they can view the agent-facing text for that message on demand; it stays hidden by default.

---

### User Story 2 - The agent receives a faithful, compact view of a spreadsheet (Priority: P1)

An operator attaches a workbook produced by an accounting or ERP system: merged header cells spanning many columns, blank separator rows, total rows computed by formulas, and sometimes hidden sheets. The agent receives a representation in which each value appears once, every value can be located by sheet and cell reference, blank rows and section boundaries are preserved, and computed totals are distinguishable from entered data.

**Why this priority**: This is the direct cause of the wrong totals in the observed conversation. Without a faithful representation no amount of prompting produces reliable numbers, and the duplicated content is also what makes the stored transcript enormous.

**Independent Test**: Extract the reference workbook from the screenshot ("Накл. на склад" sheets). The output must contain "ТОВ Асканія-Флора" once per merged region, must carry a row/column reference for each row, must include a per-sheet row/column count, and must be at least 70% smaller than today's output for the same file.

**Acceptance Scenarios**:

1. **Given** a sheet with a cell merged across 40 columns, **When** extracted, **Then** its value appears exactly once, annotated with the range it spans.
2. **Given** a sheet with blank rows separating two blocks, **When** extracted, **Then** the boundary is visible (row numbers jump or an explicit gap marker), so the two blocks are not read as one table.
3. **Given** rows of unequal length, **When** extracted, **Then** column positions are stable across rows (same column letter means the same column on every row).
4. **Given** a cell whose value is produced by a formula, **When** extracted, **Then** the value is marked as computed, so a grand-total row is not re-added to the data it summarises.
5. **Given** a workbook with hidden sheets, **When** extracted, **Then** hidden sheets are labelled as hidden (or omitted, with a note that they were omitted) so the agent does not mix them with visible data.
6. **Given** a workbook larger than the extraction budget, **When** extracted, **Then** each sheet reports how many rows were included and how many were omitted, and the cut happens at a row boundary, never in the middle of a row.
7. **Given** a Word document with tables, **When** extracted, **Then** table rows keep their cell separation rather than being flattened into a paragraph.
8. **Given** an existing text file, image, or PDF attachment, **When** sent, **Then** behaviour is unchanged from today (this story does not regress other kinds).

---

### User Story 3 - Numeric answers about a document are correct and verifiable (Priority: P2)

An operator asks "what is the total per sheet" or "which item is the largest on sheet 2". The agent's answer matches the workbook, cites the cells it used, and does not need to be challenged to get it right.

**Why this priority**: This is what the user ultimately cares about ("в серьезных организациях такие ошибки недопустимы"). It builds on Story 2; a faithful representation is necessary but the agent still performs arithmetic in prose, which is inherently error-prone for larger tables.

**Independent Test**: A reference set of workbooks with known answers (sums, maxima, counts per sheet, multi-block sheets). Ask the same questions through the chat and compare with the expected values.

**Acceptance Scenarios**:

1. **Given** the reference workbook from the screenshot, **When** asked for the total per sheet, **Then** the answer for each sheet matches the workbook, with the cell references used.
2. **Given** a sheet containing a formula total row, **When** asked for the sum of a column, **Then** the total row is not double-counted.
3. **Given** a question that cannot be answered from the attached document (value not present), **When** asked, **Then** the agent says so instead of estimating ("~2,706 (точно розраховується)" style answers are not acceptable).
4. **Given** a question that requires aggregating more than a handful of values (sum, maximum, count, filtered subset over a sheet range), **When** the agent answers, **Then** the number comes from a deterministic query over the attached workbook, not from arithmetic performed in prose, and the answer states the sheet and range that were queried.
5. **Given** the operator asks for a value the agent cannot obtain through the query capability (for example a cross-document comparison), **When** the agent answers, **Then** it says which part was computed and which part was reasoned, so the operator knows what to double-check.

**Decision (2026-09-08, CLEAN-67)**: option B. Beyond the faithful representation of Story 2, the agent gets a deterministic way to query an attached workbook (sum, max/min, count, filter over a sheet range, lookup of a cell or row). Rationale: options A and C only reduce the frequency of arithmetic errors, while the stated requirement is that such errors are unacceptable; pre-computed aggregates (C) are unreliable on accounting exports with several blocks per sheet and embedded total rows. The query works on the stored attachment bytes by attachment id, so no new persistent storage is required. Stories 1, 2 and 4 do not depend on this capability and can ship first.

---

### User Story 4 - Long conversations with documents stay affordable and accurate (Priority: P3)

An operator attaches a document once and then asks a series of follow-up questions. Later turns should not degrade in accuracy or become slower/costlier because the whole document is re-sent with the history every time.

**Why this priority**: Secondary effect of the same root cause. Valuable, but Stories 1-3 deliver the visible fixes; this one protects follow-up turns and cost.

**Independent Test**: Attach a large workbook, ask ten follow-up questions. Per-turn cost/latency after the first turn should not grow with the document size, and answers to the tenth question should be as accurate as to the first.

**Acceptance Scenarios**:

1. **Given** a document attached on turn 1, **When** the operator asks a follow-up on turn 10, **Then** the agent can still answer from the document.
2. **Given** the same conversation, **When** usage per turn is inspected, **Then** turns 2-10 do not each carry the full extracted document as part of the user's typed text.

---

### Edge Cases

- A message consisting only of an attachment and no typed text: the bubble must not be empty in a confusing way and must not fall back to showing the extracted block.
- Workbook with a single hidden sheet and nothing visible: the agent must be told the workbook has no visible sheets rather than silently receiving hidden data.
- Sheet with 100 columns but only 3 populated: column references must still be correct; the representation should not emit 97 empty cells per row.
- Cells containing dates, percentages, currency formatting, and error values: the representation must render them unambiguously (dates as dates, not serial numbers; errors as errors).
- Very wide merged region containing a long text: the value appears once with its span, not truncated mid-word.
- Extraction failure (corrupt or password-protected file): degrades to today's "attached but not readable" notice; never partial garbage in the prompt and never a broken bubble after reload.
- Transcript entries whose attachment metadata is missing (older records): the display fix must still strip the extracted block by its recognisable boundaries.
- Two attachments with the same file name in one message: chips and extracted sections must stay distinguishable.
- The public share view of an agent (CLEAN-66) rendering a conversation with attachments: must show the same compact bubble.

## Requirements *(mandatory)*

### Functional Requirements

**Display after restore**

- **FR-001**: A restored user message MUST be displayed as the text the person typed plus one chip per attachment; the extracted document text MUST NOT be rendered inline in the bubble.
- **FR-002**: FR-001 MUST hold for the admin agent chat, chat history browsing, chat export, and any other surface that replays the persisted conversation, including conversations persisted before this change.
- **FR-003**: The agent-facing text for a message MUST remain inspectable on demand by an operator through the existing debug affordance, and MUST be hidden by default.
- **FR-004**: Attachment chips after restore MUST offer the same actions as chips shown immediately after sending (name, size, download where permitted).

**Extraction fidelity**

- **FR-005**: Each spreadsheet value MUST appear exactly once in the extracted representation; a value spanning a merged region MUST be emitted once, annotated with the region it spans.
- **FR-006**: Every extracted row MUST carry a stable row reference, and every value MUST be attributable to a stable column reference, so the agent can cite a cell and the operator can verify it.
- **FR-007**: Blank rows and blank columns that separate blocks of data MUST be preserved as visible boundaries (explicit gap markers or row-number jumps), not silently removed.
- **FR-008**: Values produced by formulas MUST be distinguishable from entered values.
- **FR-009**: Hidden sheets MUST be labelled as hidden or omitted with a note; the agent MUST be able to tell visible from hidden data.
- **FR-010**: Each sheet section MUST start with a summary: sheet name, visibility, number of rows and columns present, and number of rows omitted due to the size budget.
- **FR-011**: When the size budget is reached, truncation MUST occur at a row boundary and the omission MUST be reported per sheet; no row may be cut in the middle.
- **FR-012**: The size budget MUST be applied to the de-duplicated representation, so that duplicated merged values never consume the budget.
- **FR-013**: Dates, numbers, percentages, currency and error cells MUST be rendered unambiguously in the representation (human-readable dates; numeric values without floating-point noise; errors marked as errors).
- **FR-014**: Word documents MUST preserve table structure (rows and cell separation) in the extracted text.
- **FR-015**: Extraction failures MUST degrade to the existing "attached but not readable" notice; partial or malformed output MUST never reach the agent.
- **FR-016**: Existing behaviour for images, plain-text files and PDFs MUST be unchanged except where this specification requires otherwise.

**Answer quality**

- **FR-017**: The agent MUST be instructed to cite the sheet and cell references it used when reporting numbers derived from an attached document, and to state explicitly when a requested value is not present in the document.
- **FR-018**: The agent MUST have a deterministic way to query an attached workbook for the duration of the conversation: sum, minimum, maximum and count over a sheet range, filtering rows by a column condition, and reading a specific cell or row. Results MUST be computed from the stored file, not by the agent in prose.
- **FR-018a**: The query capability MUST address the workbook by the attachment reference already carried on the message, so it works on later turns of the same conversation and after a page reload.
- **FR-018b**: The agent MUST be instructed to use the query capability whenever a numeric answer depends on more than a handful of values, and to report the sheet and range it queried alongside the result.
- **FR-018c**: Query results MUST respect the same fidelity rules as the representation: merged regions count once, formula cells are reported with their computed value and flagged as computed, hidden sheets are excluded unless explicitly requested.
- **FR-019**: A reference set of workbooks with known answers MUST exist and be runnable as a regression check for extraction output and, where feasible, for end-to-end answers.

**Conversation cost**

- **FR-020**: The extracted document content MUST NOT be replayed as part of the user's typed text on every subsequent turn; later turns MUST still be able to reference the document.

### Key Entities

- **Conversation message (user turn)**: what a person sent: typed text, list of attachments, timestamp. Displayed in chat, history, export and share views.
- **Attachment**: an uploaded file with name, type, size, readability flag, and a reference to its stored bytes. Belongs to exactly one message.
- **Agent-facing document content**: the derived, structured text the agent receives for one attachment. Composed of sheet sections (for workbooks) or document sections, each with a summary, coordinates and omission accounting. Distinct from the typed text; inspectable on demand.
- **Sheet section summary**: name, visibility, rows/columns present, rows omitted; used by the agent to sanity-check its own reading and by tests to assert accounting.
- **Reference workbook set**: fixture documents with expected extraction output and expected answers to a fixed list of questions.
- **Workbook query**: a request from the agent naming an attachment, a sheet, a range and an operation (sum, min, max, count, filter, read); returns the computed result plus the coordinates it covered and any exclusions (hidden sheet, merged duplicates, formula cells).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After reload, a user message with a three-sheet workbook attached occupies no more vertical space than the same message without the attachment plus one chip row; 0 conversations show extracted text inline (verified on admin chat, history, export, share view).
- **SC-002**: For the reference workbook from the observed conversation, the agent-facing representation is at least 70% smaller in characters than the current output while containing every distinct value of the source.
- **SC-003**: Across the reference workbook set, every distinct cell value appears exactly once in the extracted output, and 100% of merged regions are annotated with their span.
- **SC-004**: On the reference question set (per-sheet totals, largest item, counts, filtered sums, "value not present"), the agent's first answer matches the expected value in 100% of cases where the answer is obtainable by a query, and no answer contains a fabricated total for a value absent from the document.
- **SC-004a**: For every aggregate question in the reference set, the agent's answer names the sheet and range that were queried, so an operator can verify it in the source workbook without asking a follow-up.
- **SC-005**: For a conversation with a document attached on turn 1, tokens attributable to the user's typed text on turns 2-10 do not grow with document size.
- **SC-006**: A workbook that exceeds the size budget reports the exact number of omitted rows per sheet; 0 truncations cut a row mid-way.
- **SC-007**: No regression in existing attachment behaviour: the current attachment test suite passes unchanged for images, text files and PDFs.

## Assumptions

- The admin agent chat is the surface where problem 1 is visible; the app console chat restores messages from its own local copy and already shows only the typed text. The display fix targets every surface that replays the persisted transcript (admin chat, chat history, export, public share view).
- No migration of already persisted conversations is required: the display fix is applied when a conversation is read, so old conversations benefit automatically.
- The size budget for extracted text (currently a per-file character cap) remains, but applies after de-duplication and per sheet, with row-boundary truncation.
- Operators in serious organisations value correctness over completeness: an explicit "N rows omitted from sheet X" is preferable to a silently partial table.
- The debug affordance already present in the admin chat (DEBUG toggle) is the appropriate place to expose the agent-facing text; no new UI for that is required.
- Story 3 is delivered as a deterministic query capability over the attached workbook (decision B). Stories 1, 2 and 4 are independent of it and may ship first; the query capability follows as its own step.
- The query capability reads the stored attachment bytes on demand; no separate persistent copy of the parsed workbook is kept.
- Legacy office formats (`.doc`, `.xls`, PowerPoint) remain "attached but not readable" as today; widening the readable set is out of scope.
- Optical recognition of scanned PDFs is out of scope.
- The app console remains English/Russian via its i18n pipeline; the admin console stays English-only. Any new user-visible copy in the app follows `docs/i18n.md`.
