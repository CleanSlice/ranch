# Tasks: Attached Document Display and Extraction Quality

**Input**: Design documents from `specs/009-attachment-parse-quality/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/ (agent-facing-document.md, query-attachment-tool.md, transcript-and-history.md), quickstart.md

**Jira**: [CLEAN-67](https://dreamvention.atlassian.net/browse/CLEAN-67) — large task: one checkpoint comment per phase.

**Tests**: included. FR-019 requires a reference workbook set with known answers runnable as a regression check, and the API house style is colocated Jest specs. Write each spec before the code it covers and watch it fail first.

**Organization**: grouped by user story. US1 (display) and US2 (representation) are independent of each other. US3 (tool) builds on the reader from US2. US4 (preview budget) is a constants flip that only makes sense after US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 … US4 from spec.md
- Paths are repository-relative

---

## Phase 1: Setup

**Purpose**: constants and fixtures every later phase reads.

- [X] T001 Add `SPREADSHEET_INLINE_BUDGET_CHARS = 40_000`, `SPREADSHEET_PREVIEW_ROWS_PER_SHEET = 200`, `MAX_QUERY_CELLS = 50_000` with doc comments (why each exists, what it caps) to `api/src/slices/bridle/domain/attachment.constants.ts`; leave `MAX_EXTRACTED_TEXT_CHARS` at 100 000 and reword its comment to "PDF/DOCX/text bodies only".
- [X] T002 [P] Create `api/src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts` exporting `buildSupplierInvoice(): Promise<Buffer>` (sheet 1 "Накл. на склад(1)": A1:AN1 merged supplier name, A2:AN2 merged label, header row 4 `B=Товар C=Кількість D=Ціна F=Сума`, rows 5–6 items with `F` as formula `C*D`, rows 7–9 empty, rows 10–12 totals as formulas `SUM`, one date cell, one percent-formatted cell, one `#REF!` error cell; sheet 2 "Накл. на склад(2)": 3 items, max `F` = 1476; sheet 3 "Розрахунки": `state = 'hidden'`, 120 rows), `buildWideSparse(): Promise<Buffer>` (100 columns, 3 populated), `buildLongSheet(rows = 300)`, and `EXPECTED` (sum F5:F6 sheet 1, sum without total rows = 162231.5, grand total 194677.8, sheet 2 max = 1476 with its address, sheet count, merged counts). Include a `main()` that writes the files to `process.argv[2]` and prints `EXPECTED` when run directly (quickstart prerequisite).

---

## Phase 2: Foundational

**Purpose**: the block grammar both US1 (read) and US2 (write) must share. Blocks all stories.

- [X] T003 Write `api/src/slices/bridle/domain/attachmentBlocks.spec.ts` covering `splitAttachmentBlocks()` per contracts/agent-facing-document.md §5: new fenced block with id; legacy fenced block without id; legacy notice line; new notice line; attachment-only message (text becomes `""`, `agentText` set); three blocks after typed text; typed text containing a line `[Attached file: x]` that is NOT followed by a valid fence (text untouched, no `agentText`); fence widened to four backticks; truncated JSONL tail (unterminated fence → untouched). Also cover `fencedBlock()`/`noticeBlock()` builders round-tripping through the splitter.
- [X] T004 Create `api/src/slices/bridle/domain/attachmentBlocks.ts`: `ATTACHMENT_MARKER = '[Attached file: '`; `fencedBlock({ name, id, hint?, body })` (chooses a fence wider than any backtick run in `body`, header `[Attached file: NAME — id: UUID]` + optional hint); `noticeBlock({ name, id, mimeType, size })`; `truncationNotice(removed, limit)` (existing wording); `splitAttachmentBlocks(text): { text: string; agentText?: string }` implementing §5 steps 1–4 as a pure function with a line-based parser (no regex over the whole body). Export from `api/src/slices/bridle/domain/index.ts`.
- [X] T005 Refactor `api/src/slices/bridle/domain/attachment.service.ts` so `fencedBlock()` / `binaryNoticeBlock()` delegate to `attachmentBlocks.ts` and pass the attachment `id`; keep public static signatures used by `bridleClientWs.handler.ts` and the controller compiling. Run `cd api && bun run test -- attachment` to confirm `attachment.service.spec.ts` still passes, then update its expectations for the `— id:` header.

**Checkpoint**: `bun run test -- attachmentBlocks attachment.service` green. Post Jira comment on CLEAN-67: grammar shared by write and read side landed; next is the read-time split.

---

## Phase 3: User Story 1 — Reloaded conversation shows what I typed (Priority: P1) 🎯 MVP

**Goal**: after reload, in history, in export and in the coming share view, a user bubble shows typed text + chips; the agent-facing text is available only under DEBUG.

**Independent Test**: quickstart §2 — attach a workbook, send "распарси", reload: same bubble; DEBUG on shows "What the agent received"; history and markdown export show typed text + file names; a pre-CLEAN-67 conversation also renders compact.

### Tests

- [X] T006 [P] [US1] Create `api/src/slices/agent/file/domain/transcriptReader.service.spec.ts` with a fake `IFileGateway` returning JSONL fixtures: user event with new-format block → `text` typed, `agentText` full; legacy block → same; attachment-only event with `data.attachments` → kept with `text: ""`; assistant text untouched; parse-failure line untouched. Assert `agentText` is absent when nothing was split.
- [X] T007 [P] [US1] Extend `api/src/slices/chat/domain/chatExport.spec.ts`: markdown output for a user message with `attachments` prints the typed text then `📎 name (size)` lines and never contains `[Attached file:`; csv has an `attachments` column with names joined by `; `; json keeps `agentText`.

### Implementation — API

- [X] T008 [US1] In `api/src/slices/agent/file/domain/transcriptReader.service.ts` add `agentText?: string` to `TranscriptMessage`; in `read()` for `evt.type === 'user'` call `splitAttachmentBlocks(evt.data.text)` and emit `text` (typed) and `agentText` when present; keep the "attachment-only message is not dropped" rule using the split result (`text === '' && attachments.length` or `agentText` present).
- [X] T009 [P] [US1] Add `@ApiPropertyOptional() agentText?: string` to `TranscriptMessageDto` and reword the `text` description to "what the person typed; attachment contents are not included" in `api/src/slices/bridle/dtos/transcript.dto.ts`.
- [X] T010 [P] [US1] Add `attachments?: TranscriptAttachmentDto[]` (import from `#/bridle/dtos`) and `agentText?: string` to `ChatMessageDto` in `api/src/slices/chat/dtos/chatMessage.dto.ts`.
- [X] T011 [US1] In `api/src/slices/chat/chat.controller.ts` (messages + export) and `api/src/slices/chat/myChat.controller.ts` (messages): pass `attachments` through; strip `agentText` from the page unless the parsed `types` include `tool_call` or `tool_result` (contracts/transcript-and-history.md).
- [X] T012 [US1] Update `api/src/slices/chat/domain/chatExport.ts` `toMarkdown`/`toCsv` per T007; `toJson` unchanged (messages already carry the new fields).
- [X] T013 [US1] Run `cd api && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api` and `cd app && bun run build:api`; commit the regenerated SDK files (`admin/slices/setup/api/data/repositories/api/*.gen.ts`, `app/slices/setup/api/data/repositories/api/*.gen.ts`).

### Implementation — admin agent chat

- [X] T014 [US1] In `admin/slices/bridle/stores/bridle.ts`: add `agentText?: string` to `IBridleMessageData` and to `ITranscriptPageMessage`; make `toBridleMessage()` copy `agentText`; leave `_hydrateAttachments()` as is.
- [X] T015 [US1] In `admin/slices/bridle/components/bridle/Message.vue`: accept a `debugEnabled?: boolean` prop; for `isUser && message.agentText && debugEnabled` render a `<details>`-style disclosure titled "What the agent received" (collapsed by default) containing `agentText` in a `<pre class="max-h-[40vh] overflow-auto text-xs whitespace-pre-wrap">`; wire the prop from `admin/slices/bridle/components/bridle/Provider.vue` where `Message` is rendered (`:debug-enabled="debugEnabled"`).

### Implementation — chat history bubbles

- [X] T016 [P] [US1] In `admin/slices/chat/components/chat/message/Bubble.vue`: when `message.attachments?.length`, render one inert chip per attachment (lucide `FileText`, name, `formatBytes(size)`) above the user text; add `attachments` to the message type in `admin/slices/chat/domain/chat.types.ts` if the generated type is not used directly.
- [X] T017 [P] [US1] Same for `app/slices/chat/components/chat/message/Bubble.vue` and `app/slices/chat/domain/chat.types.ts`; add key `chat.message.attachment` (e.g. `"Attached file"`) to `app/slices/chat/i18n/locales/en.json`, then run `cd app && bun run i18n:sync` (never hand-edit `ru.json`).

**Checkpoint**: quickstart §2 steps 1–7 pass; `bun run test` in `api` green. Post Jira comment: reload/history/export no longer show the dump; old conversations included; next is the spreadsheet representation.

---

## Phase 4: User Story 2 — Faithful, compact spreadsheet view (Priority: P1)

**Goal**: the agent-facing block for a workbook follows contracts/agent-facing-document.md §3; Word tables keep rows; the block header carries the attachment id.

**Independent Test**: quickstart §3 — with DEBUG on, the block shows the supplier name once with `[A1:AN1]`, row numbers, `(rows 7–9 empty)`, `[=]` on totals, hidden sheet header-only, per-sheet included/omitted counts, and is ≥ 70 % smaller than the `main` output for the same file.

### Tests

- [X] T018 [P] [US2] Create `api/src/slices/bridle/domain/workbook.reader.spec.ts` using T002 fixtures: `readWorkbook(buffer)` returns `WorkbookSummary.sheets` in order with `state`, `usedRows`, `usedCols`, `mergedRegions`; `readSheet(wb, 1)` yields only master cells for merged regions with `span`; formula cells have `computed: true` and the cached value; empty rows absent but row numbers preserved; wide-sparse sheet yields 3 cells per row, not 100; date → `YYYY-MM-DD`; percent → `12.5%`; error → `#REF!`; `0.1 + 0.2` style value → `0.3`; hidden sheet readable only via `{ includeHidden: true }`.
- [X] T019 [P] [US2] Extend `api/src/slices/bridle/domain/documentText.extractor.spec.ts`: workbook line lists 3 sheets with sheet 3 `hidden`; `R1: A1[A1:AN1]=` appears once and the supplier string appears exactly once per merged region; `(rows 7–9 empty)` present; `[=]` on `F10..F12`; sheet 3 has header line only with the `include_hidden` hint; long sheet (300 rows) with `previewRowsPerSheet: 50` reports `rows 1–50 included · 250 rows omitted` and never cuts mid-row; a budget of 500 chars cuts at a row boundary and every sheet still has a header; DOCX with a 2×2 table yields two `a | b` lines; existing txt/pdf cases unchanged.

### Implementation

- [X] T020 [US2] Create `api/src/slices/bridle/domain/workbook.reader.ts`: types `SheetInfo`, `SheetSection`, `CellRow`, `CellRef` from data-model.md §5; `loadWorkbook(buffer): Promise<Workbook>`; `describeWorkbook(wb): WorkbookSummary`; `readSheet(wb, sheetRef: string | number, opts: { range?: string; includeHidden?: boolean; maxRows?: number; maxCells?: number }): SheetSection`; `normalizeCell(cell): CellRef | null` implementing the normalisation rules (merged master only via `cell.isMerged && cell.master === cell` skip logic, `cell.type === ValueType.Formula` → computed, `numFmt` percent/date handling, `toPrecision(15)` trim, rich text, hyperlink text, error text); `parseA1Range(range)` and `resolveSheet(wb, ref)` helpers with the error messages from contracts/query-attachment-tool.md.
- [X] T021 [US2] Rewrite `extractSpreadsheet()` in `api/src/slices/bridle/domain/documentText.extractor.ts` on top of the reader: emit the workbook line, then per sheet the header line and `R<n>:` rows per contract §3 (pipe escaping, `⏎` for newlines, `(rows a–b empty)` for ≥2 blank rows, hidden → header only). Accept options `{ previewRowsPerSheet, budgetChars }` and enforce both at row boundaries, updating each sheet header's `included`/`omitted` counts after the cut. Return `null` only when no sheet has any cell.
- [X] T022 [US2] Rewrite `extractDocx()` in `api/src/slices/bridle/domain/documentText.extractor.ts`: `mammoth.convertToHtml({ buffer })` then a local `htmlToText()` (block elements → lines, `<tr>` → cells joined with ` | `, `<li>` → `- `, strip other tags, decode entities); fall back to `extractRawText` when the HTML pass throws.
- [X] T023 [US2] In `api/src/slices/bridle/domain/attachment.service.ts` `expand()`: for spreadsheet MIME types call `extractDocumentText` with the preview options (`SPREADSHEET_PREVIEW_ROWS_PER_SHEET`, `SPREADSHEET_INLINE_BUDGET_CHARS`) and build the block with the spreadsheet hint sentence from contract §2.1; other kinds keep `MAX_EXTRACTED_TEXT_CHARS` + truncation notice. Add assertions to `attachment.service.spec.ts` for the hint and for "no truncation notice on spreadsheets".
- [X] T024 [US2] Verify size: run `cd api && bun run ts-node src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts ./tmp`, extract with the old (git stash-free: check out `main` copy of the extractor into a scratch file) and new extractor, and record both character counts in a comment on `documentText.extractor.spec.ts` as a snapshot assertion `expect(newLen).toBeLessThan(oldLen * 0.3)` using the old length as a constant.

**Checkpoint**: `bun run test -- workbook.reader documentText attachment.service` green; quickstart §3 passes. Post Jira comment: new spreadsheet format, Word tables, id in header; next is the query tool.

---

## Phase 5: User Story 3 — Correct, verifiable numbers (Priority: P2)

**Goal**: the agent can compute over an attached workbook deterministically through `query_attachment` and cites the range it queried.

**Independent Test**: quickstart §4 — after an agent restart, the questions in the table return the fixture's expected values with sheet/range cited and a tool call visible in the debug panel; a question about a non-existent sheet gets "there is no such sheet", not a number.

**Depends on**: Phase 4 (T020 reader).

### Tests

- [X] T025 [P] [US3] Create `api/src/slices/bridle/attachment.tool.spec.ts` with an in-memory `IBridleAttachmentGateway` seeded with T002 fixtures under `agent-a`: caller without `agent:` sub → `isError`; caller `agent:b` asking for agent-a's id → "not available to this agent"; `describe` lists 3 sheets with states and `headerGuess` row 4; `read` `B4:F12` returns rows 4,5,6,10,11,12 only; `aggregate sum F5:F6` = EXPECTED item sum with `cells` listed; `aggregate sum F5:F12 include_computed=false` excludes totals; `aggregate max` on sheet 2 = 1476 at its address; `find "всього"` returns B12 with `rowCells` containing F12; hidden sheet without `include_hidden` → error, with it → data; range over `MAX_QUERY_CELLS` → error; non-spreadsheet attachment → error naming the mime; bad range string → error.

### Implementation

- [X] T026 [US3] Create `api/src/slices/bridle/attachment.tool.ts`: `@Injectable() BridleAttachmentTool` with one `@Tool({ name: 'query_attachment', description: <text from contracts/query-attachment-tool.md>, parameters: z.object({...}) })` method; `extractAgentId()` identical to `KnowledgeTool`; fetch via `IBridleAttachmentGateway.fetch(agentId, attachment_id)`; dispatch `describe` / `read` / `aggregate` / `find` onto `workbook.reader.ts`; build the JSON result shapes and error messages from the contract; `ok()`/`err()` helpers as in `knowledge.tool.ts`.
- [X] T027 [US3] Register `BridleAttachmentTool` in `providers` of `api/src/slices/bridle/bridle.module.ts`.
- [X] T028 [P] [US3] In `api/src/slices/mcpServer/domain/mcpServer.seeder.ts` add `export const DOCUMENTS_MCP_ID = 'mcp-documents'` and seed a built-in entry (name `Documents`, description "Built-in MCP server hosted by this Ranch's own API. Exposes query_attachment for spreadsheets attached in chat. Auth uses the agent's RANCH_API_TOKEN.", same `url`, `streamableHttp`, bearer `${RANCH_API_TOKEN}`, `enabled: true`, `builtIn: true`).
- [X] T029 [US3] In `api/src/slices/agent/agent/agent.controller.ts` `getMcps()`: after the knowledge injection, push the `DOCUMENTS_MCP_ID` entry when it exists, is enabled and is not already in `enabledServers` (dedupe by id). Extend the existing controller spec if one covers `getMcps`, otherwise add a focused case in `api/src/slices/agent/agent/agent.controller.spec.ts`.
- [ ] T030 [US3] Manual: restart the dev agent, run `specs/009-attachment-parse-quality/quickstart.md` §4; capture the tool call from the DEBUG panel and paste the four answers into the Jira checkpoint comment.

**Checkpoint**: `bun run test -- attachment.tool agent.controller` green; quickstart §4 passes. Post Jira comment with the observed answers; next is the preview budget.

---

## Phase 6: User Story 4 — Long conversations stay affordable (Priority: P3)

**Goal**: later turns do not carry a full workbook dump in history; the tool remains the path to the full data.

**Independent Test**: quickstart §5 — after 5 follow-up questions only the first user turn carries `agentText` with the document; usage per turn does not step up.

**Depends on**: Phase 5 (the tool must exist before the inline block is reduced to a preview).

- [X] T031 [US4] Confirm the defaults in `api/src/slices/bridle/domain/attachment.constants.ts` (`SPREADSHEET_INLINE_BUDGET_CHARS = 40_000`, `SPREADSHEET_PREVIEW_ROWS_PER_SHEET = 200`) are the ones applied by `expand()` (T023) and document in the constants' comments that the query tool is the source of truth beyond the preview.
- [X] T032 [US4] Add a case to `api/src/slices/bridle/domain/attachment.service.spec.ts`: a 300-row fixture produces a block under `SPREADSHEET_INLINE_BUDGET_CHARS` whose sheet header reports the omitted rows and whose hint names `query_attachment`.
- [ ] T033 [US4] Manual: `specs/009-attachment-parse-quality/quickstart.md` §5; record `agentText.length` of turn 1 and confirm turns 2–6 have no `agentText`, note usage figures in the Jira checkpoint comment.

**Checkpoint**: Post Jira comment: preview budget in place with numbers from §5.

---

## Phase 7: Polish & Cross-Cutting

- [X] T034 [P] Run `cd api && bun run lint && bun run format` and fix findings in the touched files.
- [ ] T035 [P] Run `specs/009-attachment-parse-quality/quickstart.md` §6 (txt + png + pdf regression) and §2 step 8 if CLEAN-66 has merged; note results in the PR description.
- [X] T036 [P] Update `specs/007-chat-file-attachments/spec.md` line about the 100k limit being configurable with a pointer to the four constants, and add a "Superseded by CLEAN-67 for spreadsheets" note under its FR-020.
- [ ] T037 Full run: `bun run test` at repo root; `cd api && bun run build`; `cd admin && bun run build`; `cd app && bun run build`.
- [ ] T038 Commit per phase (include `specs/009-attachment-parse-quality/` and `.specify/feature.json` in the first commit) with Conventional Commits + ticket, e.g. `fix(bridle): split typed text from attachment blocks on transcript read (CLEAN-67)`, `feat(bridle): coordinate-addressed spreadsheet extraction (CLEAN-67)`, `feat(bridle): query_attachment MCP tool (CLEAN-67)`, `feat(bridle): bounded spreadsheet preview (CLEAN-67)`; open a PR into `main` titled `CLEAN-67: attached documents — compact bubbles, faithful spreadsheet extraction, query_attachment tool`, link the ticket, put the PR URL on CLEAN-67 and move it to In Review.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** → no dependencies.
- **Phase 2 (Foundational)** → needs T001; blocks every story (US1 reads the grammar, US2 writes it).
- **Phase 3 (US1)** → needs Phase 2. Independent of US2–US4.
- **Phase 4 (US2)** → needs Phase 2 and T002. Independent of US1.
- **Phase 5 (US3)** → needs T020 (reader) from Phase 4 and T004 (id in header) from Phase 2.
- **Phase 6 (US4)** → needs Phase 5.
- **Phase 7** → after the stories you intend to ship.

### Parallel opportunities

- T001 ‖ T002.
- After Phase 2: **US1 (T006–T017) and US2 (T018–T024) in parallel** — different files throughout (agent/file + chat + front-ends vs bridle/domain extractor + reader).
- Inside US1: T006 ‖ T007; T009 ‖ T010; T016 ‖ T017.
- Inside US2: T018 ‖ T019 before T020.
- Inside US3: T025 ‖ T028 while T026 is written.
- Phase 7: T034 ‖ T035 ‖ T036.

### Parallel example: after Phase 2

```text
Developer A (US1): T006, T007 → T008 → T009, T010 → T011 → T012 → T013 → T014 → T015 → T016, T017
Developer B (US2): T018, T019 → T020 → T021 → T022 → T023 → T024
Then B continues: T025, T028 → T026 → T027 → T029 → T030 → T031–T033
```

---

## Implementation Strategy

### MVP — User Story 1 only

1. T001–T005 (setup + grammar).
2. T006–T017.
3. Validate with quickstart §2. This alone removes the giant bubbles everywhere, including for old conversations, and is safe to ship on its own.

### Incremental delivery

1. MVP above → PR-able.
2. US2 (T018–T024) → the agent sees a faithful table; the observed miscount causes are gone.
3. US3 (T025–T030) → numbers are computed; requires an agent restart to take effect.
4. US4 (T031–T033) → preview budget; only after US3.
5. Polish (T034–T038).

### Notes

- Never commit customer workbooks; fixtures are generated by T002.
- `ru.json` in `app/` is generated by `bun run i18n:sync`, never edited by hand (T017).
- No new dependencies are expected; if one appears necessary, stop and record the reason in research.md before adding it.
- Each phase ends with a Jira checkpoint comment (large-task rule) and a commit carrying `CLEAN-67`.
