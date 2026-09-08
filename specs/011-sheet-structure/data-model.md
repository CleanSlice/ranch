# Phase 1 — Data Model: Sheet Structure for the Agent

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

Derived data only; nothing persisted. Produced by `detectSheetStructure(rows)` in `api/src/slices/bridle/domain/sheetStructure.ts` from the `CellRow[]` the reader already returns.

## `SheetStructure`

| Field | Type | Notes |
|---|---|---|
| `title` | `Segment` | Rows before the first table (or all rows when there is no table). |
| `tables` | `TableBlock[]` | In row order. |

## `TableBlock`

| Field | Type | Notes |
|---|---|---|
| `range` | `string` | Bounding rectangle of the block's cells, A1 (`B4:F6`). |
| `headerRow` | `number \| null` | First row when mostly text; null when the block starts with data. |
| `headerCells` | `Record<string, string>` | Column letter → label, from the header row. Empty when no header. |
| `indexRow` | `number \| null` | Column-numbering row under the header, when present. |
| `dataRows` | `[number, number] \| null` | First and last data row numbers; null when the block is header-only. |
| `rowCount` | `number` | Data rows in the block. |
| `footer` | `Segment` | Rows after this block until the next block (or the end). |

## `Segment`

| Field | Type | Notes |
|---|---|---|
| `pairs` | `LabelValuePair[]` | Row order, then column order. |
| `lines` | `TextLine[]` | Text-only rows, row order. |

## `LabelValuePair`

| Field | Type | Notes |
|---|---|---|
| `label` | `string \| null` | Text of the nearest text cell on the row (left preferred, then right); null when the row has no text. |
| `labelCell` | `string?` | Address of that cell; `labelSpan` when merged. |
| `labelSpan` | `string?` | |
| `value` | `number` | Normalised number. |
| `valueCell` | `string` | |
| `computed` | `boolean` | Formula cell. |
| `display` | `string` | As rendered (percent, trimmed float). |

## `TextLine`

| Field | Type | Notes |
|---|---|---|
| `cell` | `string` | Address of the first text cell on the row. |
| `text` | `string` | All text cells on the row joined with ` · `. |
| `row` | `number` | |

## Constants (`sheetStructure.ts`)

| Name | Default | Purpose |
|---|---|---|
| `DENSE_ROW_MIN_CELLS` | 3 | Rows with at least this many cells are table rows. |
| `HEADER_TEXT_RATIO` | 0.6 | Share of text cells for a block's first row to count as header. |
| `INDEX_ROW_MAX_VALUE` | 200 | A row of integers 1..n (n ≤ this) under the header is a column-index row. |

## Tool I/O additions (`query_attachment`)

- `describe` → each visible sheet gains `structure: SheetStructure`.
- new `op: "structure"` → `{ attachment, sheet, structure, warnings }`; requires `sheet`; hidden sheets need `include_hidden`.
