# Phase 1 — Data Model: Attached Document Display and Extraction Quality

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

No database table and no Prisma migration. Two persisted things exist already and are unchanged: attachment bytes in S3 under `agents/{agentId}/data/attachments/{uuid}{ext}`, and the runtime-authored JSONL transcript. Everything below is the shape of data in flight or derived at read time.

---

## Entities

### 1. `TranscriptMessage` (API, read model) — **changed**

`api/src/slices/agent/file/domain/transcriptReader.service.ts`

| Field | Type | Change | Notes |
|---|---|---|---|
| `id` | `string` | – | Runtime event id. |
| `role` | `'user' \| 'assistant' \| 'summary' \| 'tool_call' \| 'tool_result' \| 'system'` | – | |
| `text` | `string` | **semantics change** | For `user`: the typed text only (attachment section removed per the grammar in [contracts/agent-facing-document.md](./contracts/agent-facing-document.md)). Other roles unchanged. |
| `agentText` | `string?` | **new** | For `user` only, and only when it differs from `text`: the full string the model received. Absent otherwise. |
| `ts` | `number` | – | |
| `attachments` | `ITranscriptAttachment[]?` | – | Sanitised metadata, unchanged. |

**Invariant**: `text` is never derived from `attachments`; the split is grammar-driven so records with missing metadata still split. A `user` message whose `text` becomes empty after the split and which has no `attachments` is still emitted (its `agentText` proves the turn happened).

### 2. `TranscriptMessageDto` / `ChatMessageDto` (API, wire) — **changed**

- `TranscriptMessageDto` (`api/src/slices/bridle/dtos/transcript.dto.ts`): add optional `agentText: string`. `text` documented as "what the person typed".
- `ChatMessageDto` (`api/src/slices/chat/dtos/chatMessage.dto.ts`): add optional `attachments: TranscriptAttachmentDto[]` and optional `agentText: string`.

Both regenerate into `admin/` and `app/` SDKs via `build:api`.

### 3. `IBridleMessageData` (admin store) — **changed**

`admin/slices/bridle/stores/bridle.ts:44`

| Field | Type | Change |
|---|---|---|
| `agentText` | `string?` | **new** — copied from the transcript; shown only under DEBUG (D7). Never set on the live echo. |

### 4. `AgentFacingDocument` (derived, never persisted separately)

The text block produced for one attachment by `expand()`. Its persisted form is the substring inside the runtime's `data.text`. Grammar and examples: [contracts/agent-facing-document.md](./contracts/agent-facing-document.md).

| Part | Present for | Content |
|---|---|---|
| header line | all kinds | `[Attached file: NAME — id: UUID]` (+ hint sentence for spreadsheets) |
| fenced body | text kinds, PDF, DOCX | extracted text, `MAX_EXTRACTED_TEXT_CHARS` cap, row-agnostic |
| fenced body | spreadsheets | `WorkbookSummary` + one `SheetSection` per sheet |
| notice line | unreadable binaries | unchanged wording, now with id |

### 5. `WorkbookSummary` and `SheetSection` (derived)

Produced by the shared reader (`api/src/slices/bridle/domain/workbook.reader.ts`) and consumed by both the extractor and the tool.

**WorkbookSummary**

| Field | Type | Notes |
|---|---|---|
| `sheets` | `SheetInfo[]` | In workbook order, hidden included. |

**SheetInfo**

| Field | Type | Notes |
|---|---|---|
| `index` | `number` | 1-based workbook position. |
| `name` | `string` | |
| `state` | `'visible' \| 'hidden' \| 'veryHidden'` | exceljs `worksheet.state`. |
| `usedRows` | `number` | `actualRowCount`. |
| `usedCols` | `number` | `actualColumnCount`. |
| `mergedRegions` | `number` | `model.merges.length`. |

**SheetSection** (preview or `read` result)

| Field | Type | Notes |
|---|---|---|
| `info` | `SheetInfo` | |
| `rows` | `CellRow[]` | Non-empty rows only, in order. |
| `includedRows` | `[from, to]` | Row numbers actually emitted. |
| `omittedRows` | `number` | Non-empty rows dropped by the budget. |

**CellRow**: `{ row: number; cells: CellRef[] }`

**CellRef**

| Field | Type | Notes |
|---|---|---|
| `address` | `string` | A1 notation of the master cell. |
| `span` | `string?` | `A1:AN1` when the cell is the master of a merged region. |
| `kind` | `'text' \| 'number' \| 'boolean' \| 'date' \| 'error'` | What the cell holds, so aggregates count only numbers and header guessing ignores dates. |
| `value` | `string \| number \| boolean \| null` | Normalised (see below). |
| `display` | `string` | What is printed (dates, percent, trimmed floats). |
| `computed` | `boolean` | `true` for formula cells (value = cached result). |
| `error` | `string?` | Excel error text (`#REF!`) when the cell holds an error. |

**Normalisation rules** (shared by extractor and tool — FR-013, FR-018c):
- merged: only the master cell is a `CellRef`; other cells of the range are skipped entirely;
- numbers: `Number(value.toPrecision(15))` then `String()`; percent `numFmt` → `display = (v*100)%` with up to 2 decimals;
- dates: `YYYY-MM-DD` when the time part is midnight, otherwise `YYYY-MM-DD HH:mm`;
- rich text: concatenated runs; hyperlink: its text;
- formula: `value` = cached result normalised as above, `computed = true`; a formula with no cached result → `value = null`, `display = "(formula, no cached value)"`.

### 6. `AttachmentQuery` / `AttachmentQueryResult` (MCP tool I/O)

Schema and examples in [contracts/query-attachment-tool.md](./contracts/query-attachment-tool.md). Summary:

**AttachmentQuery**

| Field | Type | Required for |
|---|---|---|
| `attachment_id` | `string` (uuid) | all |
| `op` | `'describe' \| 'read' \| 'aggregate' \| 'find'` | all |
| `sheet` | `string \| number` (name or 1-based index) | read, aggregate, find |
| `range` | `string` (A1 range, e.g. `F5:F47`) | read (optional, default used range), aggregate |
| `fn` | `'sum' \| 'min' \| 'max' \| 'count' \| 'avg'` | aggregate |
| `where` | `{ column: string; op: 'eq' \| 'ne' \| 'contains' \| 'gt' \| 'lt'; value: string \| number }?` | aggregate, read (optional row filter) |
| `query` | `string` | find |
| `include_hidden` | `boolean` (default false) | any |
| `include_computed` | `boolean` (default true) | aggregate |

**AttachmentQueryResult** (always JSON text in the MCP `content`)

| Field | Present for | Notes |
|---|---|---|
| `attachment` | all | `{ id, name }` |
| `sheets` | describe | `SheetInfo[]` |
| `sheet` | read/aggregate/find | `SheetInfo` |
| `rows` | read | `CellRow[]`, capped by `MAX_QUERY_CELLS` with `truncated: true` |
| `value` | aggregate | number (or `null` for empty input) |
| `covered` | aggregate | `{ range, cellsCounted, cellsSkipped: { empty, nonNumeric, computedExcluded, mergedDuplicates } }` |
| `matches` | find | `CellRef[]` with row context |
| `warnings` | any | e.g. `"sheet is hidden"`, `"range clipped to used area"` |

**Validation**: `attachment_id` must be a UUID and must resolve under the caller's own agent; `range` must parse as A1 and lies within the used area (clipped with a warning); `sheet` must exist (error lists available sheets); at most `MAX_QUERY_CELLS` (default 50 000) cells per call.

---

## Constants (`api/src/slices/bridle/domain/attachment.constants.ts`)

| Name | Default | Purpose |
|---|---|---|
| `MAX_EXTRACTED_TEXT_CHARS` | 100 000 (unchanged) | Cap for PDF/DOCX/text inline bodies. |
| `SPREADSHEET_INLINE_BUDGET_CHARS` | 40 000 | Cap for the spreadsheet preview block, de-duplicated output, row boundaries. |
| `SPREADSHEET_PREVIEW_ROWS_PER_SHEET` | 200 | Max non-empty rows per sheet in the preview. |
| `MAX_QUERY_CELLS` | 50 000 | Cap per `query_attachment` call. |

All four are exported constants, not literals in code paths, so they can be tuned without touching logic (spec Assumptions).

---

## State transitions

None new. Attachment lifecycle (staged → uploaded → sent → wiped with the agent) is unchanged from 007.
