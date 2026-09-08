# Phase 0 — Research: Attached Document Display and Extraction Quality

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Jira**: [CLEAN-67](https://dreamvention.atlassian.net/browse/CLEAN-67)

Everything below was verified against the code on `origin/main` (`efa6b7e`) on 2026-09-08. File references are project-relative.

---

## Findings that shape the design

### F1. The typed text and the agent-facing text are one string, end to end

- `BridleAttachmentService.expand()` (`api/src/slices/bridle/domain/attachment.service.ts:190-192`) joins `baseText` and every attachment block into one `text`.
- `BridleGateway.sendToAgent()` (`api/src/slices/bridle/data/bridle.gateway.ts:204-224`) sends that `text` to the runtime and, separately, an `attachments[]` metadata array. The runtime (external SDK, not in this repo) persists both into `data/sessions/bridle:<channel>.jsonl` as `data.text` and `data.attachments`.
- `TranscriptReaderService.render()` (`api/src/slices/agent/file/domain/transcriptReader.service.ts:249-251`) returns `data.text` verbatim.
- Admin `toBridleMessage()` (`admin/slices/bridle/stores/bridle.ts:298-308`) makes that the bubble's only text part; `_hydrateAttachments()` prepends chips but strips nothing.
- Chat history (`api/src/slices/chat/chat.controller.ts:140,254`) and export (`api/src/slices/chat/domain/chatExport.ts`) read the same service; `ChatMessageDto` carries no `attachments` at all.
- The app console's own chat (`app/slices/bridle/stores/bridle.ts`) restores from `localStorage` and is *not* affected.

We cannot add a new persisted field (e.g. `userText`) without a runtime change, because the runtime decides what it writes to the JSONL. Whatever we do must work from `data.text` + `data.attachments`.

### F2. The attachment block has a recognisable grammar, old and new

Both block shapes produced today start at the beginning of a line with `[Attached file: `:

- fenced: `[Attached file: NAME]\n```\n<content>\n```` (`attachment.service.ts:224-241`), with an optional truncation notice inside the fence;
- notice: `[Attached file: NAME (mime, N bytes). Its contents are not readable …]` (`attachment.service.ts:248-255`).

Blocks are appended after the typed text with `\n\n`. A message with no typed text is *only* blocks. This grammar is stable across CLEAN-49, CLEAN-57 and CLEAN-63 transcripts, so read-time separation can cover every conversation ever persisted.

### F3. Why the spreadsheet text misleads the model

`api/src/slices/bridle/domain/documentText.extractor.ts:59-94`:

| Behaviour | Effect on the model |
|---|---|
| `row.eachCell({ includeEmpty: true })` returns the master value for every cell in a merged range (exceljs `MergeValue.value → master.value`) | A header merged across 40 columns repeats the supplier name 40 times per row; the sum of "distinct values" is wrong |
| `eachRow({ includeEmpty: false })` | Blank separator rows vanish; two blocks read as one table |
| No row numbers, no column letters; rows are ragged (each row stops at its own last cell) | Field *k* on row A is not field *k* on row B; nothing can be cited or re-checked |
| Formula cells contribute `.result` only | A "Всього" row is indistinguishable from data and gets re-added |
| `workbook.eachSheet` includes hidden sheets | Hidden working sheets mix with visible ones |
| Only cap is `MAX_EXTRACTED_TEXT_CHARS = 100_000` per file, sliced mid-row after serialisation | Truncation eats a row in the middle; duplicates consume the budget first |
| `String(value)` for numbers | Floating-point noise (`0.30000000000000004`) |
| The composed text is persisted, so the whole dump is replayed on every later turn | Context bloat, compaction earlier, follow-up answers degrade |

exceljs exposes what is needed to fix all of it (`node_modules/exceljs/index.d.ts`): `cell.isMerged`, `cell.master`, `cell.address`, `cell.formula`, `cell.type` (`ValueType.Formula`), `cell.numFmt`, `worksheet.state` (`'visible' | 'hidden' | 'veryHidden'`), `worksheet.actualRowCount`, `worksheet.actualColumnCount`, `worksheet.model.merges`.

### F4. The agent has no tool that can compute; but adding one is cheap here

- Tools are NestJS providers decorated with `@Tool` from `#mcp`; the registry discovers every provider in the app (`api/src/slices/mcp/services/mcp-registry.service.ts:149` — no per-server filtering).
- Agent identity in a tool call is the JWT `sub = agent:<id>` (`api/src/slices/user/auth/domain/auth.service.ts:138`; `KnowledgeTool.extractAgentId`, `api/src/slices/reins/knowledge/knowledge.tool.ts:169-175`).
- Built-in `Ranch` and `Knowledge` MCP entries both point at this API's `/mcp/mcp` (`api/src/slices/mcpServer/domain/mcpServer.seeder.ts`). Any agent with either attached already receives every tool the API registers. The Knowledge entry is auto-injected when the agent has bound bases (`api/src/slices/agent/agent/agent.controller.ts:276-304`).
- Attachment bytes are fetchable by `(agentId, attachmentId)` via `IBridleAttachmentGateway.fetch` (`api/src/slices/bridle/domain/attachment.gateway.ts`), scoped to the agent's own S3 prefix.

So a `query_attachment` tool can live in the bridle slice, reuse the gateway, and be authorised by the same `agent:` sub check. The one gap: the model must *know the attachment id*. Today the block header carries only the file name; the id must be added to the header.

### F5. Word documents lose tables

`extractRawText` (`mammoth`) flattens tables to paragraphs. `convertToHtml` keeps `<table>/<tr>/<td>`; a 30-line HTML-to-text pass that turns rows into ` | `-joined lines is enough. `convertToMarkdown` exists in the package but is deprecated upstream and untyped, so it is not used.

### F6. Front-end test posture

API: Jest, colocated specs (`documentText.extractor.spec.ts`, `attachment.service.spec.ts`, `chatExport.spec.ts`). Admin and app: no test runner (`"test": "echo …"`). Front-end acceptance goes through `quickstart.md`.

### F7. Public share view (CLEAN-66) is not on `main` yet

Its branch is "In Testing". It renders the same transcript endpoint, so a fix inside `TranscriptReaderService` reaches it without coordination; the quickstart lists it as a check to run once CLEAN-66 lands.

---

## Decisions

### D1. Separate typed text from agent-facing text at **read time**, in `TranscriptReaderService`

**Decision**: `TranscriptReaderService.read()` splits a `user` event's `data.text` into `text` (what the person typed) and `agentText` (the full string the model received, only present when it differs). The split uses the block grammar from F2: the first line that starts with `[Attached file: ` begins the attachment section; the section must parse as a sequence of fenced blocks and notice lines to the end of the string, otherwise the text is left untouched. Consumers (`TranscriptMessageDto`, chat history DTO, export) get the stripped `text`; the admin debug view gets `agentText`.

**Rationale**: it is the single choke point every replay surface already uses (F1), it needs no runtime change, and it applies to conversations persisted before this ticket. Stripping by grammar rather than by `attachments[]` presence covers legacy records with missing metadata (edge case in the spec).

**Alternatives considered**:
- *Persist typed text separately* — requires the external runtime to write a new field; out of this repo's control. Recorded as a follow-up (see "Deferred").
- *Strip in the admin store only* — leaves history, export and share view broken; three fixes instead of one.
- *Strip on the client by regex* — same grammar, worse place: the JSON export would still carry the dump.

### D2. Make the boundary unambiguous going forward

**Decision**: `expand()` keeps the `[Attached file: …]` line-start marker (so old and new transcripts share one grammar) and adds the attachment id to the header: `[Attached file: NAME — id: <uuid>]`. For spreadsheets the header also carries a one-line hint that exact numbers should come from `query_attachment` with that id. The hint sits inside the block, so it is stripped with it.

**Rationale**: the model needs the id to call the tool (F4); keeping the marker keeps D1 to one parser.

**Alternatives**: a machine-only sentinel (`<!--attachments-->`) — would also work but leaks an odd token into the prompt and does not help legacy records.

### D3. Spreadsheet representation: sparse, coordinate-addressed rows with a per-sheet header

**Decision**: replace the CSV dump with the format specified in [contracts/agent-facing-document.md](./contracts/agent-facing-document.md). In short:

- workbook header listing every sheet with visibility and used dimensions, so omitted sheets are still known;
- per sheet: a summary line (name, state, rows × cols used, rows included / omitted), then rows as `R<n>: A=value | C=value` with only non-empty cells;
- a merged region is emitted once, at its master cell, as `A1[A1:AN1]=value`; the other cells of the range are skipped;
- a formula cell is emitted as `F48=[=]194677.80` (computed marker), so total rows are recognisable;
- runs of ≥2 blank rows become `(rows 12–15 empty)`; single blank rows are visible through the row-number jump;
- hidden sheets contribute their summary line only, marked `hidden`, with no rows;
- numbers are rendered without float noise (`toPrecision(15)` then trimmed), dates as `YYYY-MM-DD` or `YYYY-MM-DD HH:mm`, percent formats as `12.5%`, errors as their Excel text;
- the budget is applied to this de-duplicated output and only at row boundaries; each sheet reports `rows N–M omitted`.

**Rationale**: every FR-005…FR-013 requirement maps to one rule above; sparse rows solve the "100 columns, 3 populated" edge case; row numbers give citations for free; the format is still plain text the model reads without a parser.

**Alternatives**:
- *Markdown tables* — column-aligned but explode on wide sheets (97 empty cells per row) and cannot express merged spans.
- *CSV with row numbers* — still ragged unless padded, and padding re-introduces the width problem.
- *JSON per cell* — precise but ~3× the characters of the sparse form.

### D4. Spreadsheets inline a **preview**; the tool is the source of truth

**Decision**: for spreadsheets the inline block is capped by two new constants, `SPREADSHEET_INLINE_BUDGET_CHARS` (default 40 000) and `SPREADSHEET_PREVIEW_ROWS_PER_SHEET` (default 200), whichever hits first, always at a row boundary and always with per-sheet omission accounting. The full workbook is reachable through `query_attachment` (D5). `MAX_EXTRACTED_TEXT_CHARS` (100 000) stays for PDF and Word.

**Rationale**: with a query tool available, a full inline dump is no longer the only way to read the file, and it is the thing that bloats every later turn (F3, last row). A bounded preview keeps the model oriented (sheet names, headers, first rows) while the tool answers exact questions. This is the largest lever this repo has on Story 4 without touching the runtime.

**Alternatives**: keep 100 000 for spreadsheets — faithful to CLEAN-63's letter but leaves FR-020 unaddressed.

### D5. `query_attachment` MCP tool in the bridle slice

**Decision**: a new provider `BridleAttachmentTool` (`api/src/slices/bridle/attachment.tool.ts`) exposes one tool, `query_attachment`, with operations `describe`, `read`, `aggregate`, `find` (schema in [contracts/query-attachment-tool.md](./contracts/query-attachment-tool.md)). It resolves the caller's agent id from the JWT `sub`, fetches bytes via `IBridleAttachmentGateway.fetch(agentId, id)`, parses with the same workbook reader as the extractor (shared module `workbook.reader.ts`), and computes with the same fidelity rules (merged once, formula flagged, hidden excluded unless asked). Results are JSON with the covered range, counted cells, skipped cells and reasons.

**Rationale**: the pattern (`@Tool` + `agent:` sub + gateway) is already proven by `KnowledgeTool`; bytes are already keyed by attachment id under the agent's prefix, so no new storage; sharing the reader guarantees the tool and the preview agree on every value.

**Tool availability**: the tool is served by the same endpoint as the Ranch and Knowledge entries. To make it reachable for every agent, the seeder adds a built-in `mcp-documents` entry (same URL, bearer `${RANCH_API_TOKEN}`) and `getMcps` injects it unconditionally, mirroring the knowledge injection. Running agents pick it up on their next restart (the runtime reads its MCP list at boot).

**Alternatives**:
- *A REST endpoint the runtime calls* — the runtime has no code path for that; MCP is the only tool channel it has.
- *Compute in the runtime with a code-execution tool* — runtime change, out of this repo.
- *Store a parsed copy (e.g. JSON in S3)* — unnecessary; parsing a ≤10 MB workbook on demand is well under a second and avoids a second copy with its own lifecycle.

### D6. Word documents: HTML pass that keeps tables

**Decision**: `extractDocx` uses `mammoth.convertToHtml` and a small HTML-to-text converter: block elements become lines, `<tr>` becomes a line whose cells are joined with ` | `, `<li>` gets a `- ` prefix, everything else is stripped. `extractRawText` stays as the fallback if the HTML pass throws.

**Rationale**: satisfies FR-014 with no new dependency.

### D7. Admin display of the agent-facing text

**Decision**: `IBridleMessageData` gains `agentText?: string`. `toBridleMessage()` copies it from the transcript. `Message.vue` shows, for a user message that has `agentText` and while the DEBUG toggle is on, a compact "What the agent received" disclosure that renders it in a scrollable `<pre>`. Nothing is shown when DEBUG is off.

**Rationale**: FR-003 asks for inspectability on demand through the existing affordance; the DEBUG toggle is that affordance and already gates per-message inspection for assistant turns.

### D8. Chat history and export carry attachment names

**Decision**: `ChatMessageDto` gains `attachments?: TranscriptAttachmentDto[]` (names/types/sizes only; history has no download route and does not need one). Both `Bubble.vue` files (admin and app chat slices) render the names as inert chips above the typed text. Markdown/CSV export prints `[файл: name]` lines after the text; JSON export includes `attachments` and `agentText` as-is.

**Rationale**: FR-002 covers history and export; without the chip the turn would read as text-less. OpenAPI regen (`build:api`) is a required step in both front-ends.

### D9. Reference workbook set is generated, not copied

**Decision**: a script under `api/src/slices/bridle/domain/__fixtures__/` builds the reference workbooks with exceljs at test time (merged headers across 40 columns, blank separator rows, formula total rows, hidden sheet, dates/percent/error cells, a 300-row sheet for the budget). Expected extraction output and expected query results are asserted in Jest. The customer's real file from the screenshot is *not* committed.

**Rationale**: FR-019 without leaking customer data; exceljs-built fixtures are deterministic and already the house style (`documentText.extractor.spec.ts`).

### D10. Agent guidance travels with the block, not in a system prompt

**Decision**: the per-file hint (D2) and the tool description (D5) carry the instructions: cite sheet/cell, use the tool for aggregates, say when a value is absent. No change to per-agent `SOUL.md`/`USER.md` files.

**Rationale**: system prompts are per-agent files in S3 outside this repo (F4 notes); the tool description is what the model reads when deciding to call it, and the block hint is what it reads when the document arrives.

---

## Deferred (follow-up tickets, not in CLEAN-67)

- **Runtime-side split**: have the runtime accept `userText` + document parts separately and persist both, so read-time stripping becomes unnecessary and history replay can drop document parts entirely. Needs the external runtime repo.
- **Per-server tool filtering** in the MCP registry, so a "Documents" entry exposes only `query_attachment` rather than every registered tool.
- **Legacy `.xls`/`.doc`** and scanned-PDF OCR remain out of scope (spec Assumptions).
