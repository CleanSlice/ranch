# Contract: `query_attachment` MCP tool

Served by this API's MCP endpoint (`/mcp/mcp`), registered from `api/src/slices/bridle/attachment.tool.ts` with the `@Tool` decorator from `#mcp`. Callable only with an agent-issued JWT (`sub = agent:<id>`); any other caller gets an `isError` result, never data.

## Description (what the model reads)

> Query a spreadsheet attached to this conversation by its attachment id (shown in the `[Attached file: … — id: …]` line). Use it whenever an answer depends on more than a handful of numbers: sums, counts, min/max, filtered totals, or looking up a specific row or cell. Numbers returned here are computed from the file; never estimate them yourself when this tool can answer. Always report the sheet and range you queried next to the number. If the value the person asks for is not in the file, say so — do not approximate. Start with `op: "describe"` when you are unsure which sheet or range to use.

## Parameters (zod → JSON schema)

```json
{
  "attachment_id": "uuid — required",
  "op": "\"describe\" | \"read\" | \"aggregate\" | \"find\" — required",
  "sheet": "string (name) | integer (1-based index) — required for read/aggregate/find",
  "range": "A1 range like \"F5:F47\" — required for aggregate; optional for read (default: used area)",
  "fn": "\"sum\" | \"min\" | \"max\" | \"count\" | \"avg\" — required for aggregate",
  "where": { "column": "letter", "op": "\"eq\"|\"ne\"|\"contains\"|\"gt\"|\"lt\"", "value": "string | number" },
  "query": "string — required for find; case-insensitive substring over cell text",
  "include_hidden": "boolean, default false",
  "include_computed": "boolean, default true — when false, formula cells are excluded from aggregate"
}
```

## Results

All results are one `text` content item containing JSON. Errors set `isError: true` with a one-sentence message that names what to change (e.g. `Sheet "Итого" not found; available: 1 "Накл. на склад(1)", 2 "Накл. на склад(2)"`).

### `describe`

```json
{
  "attachment": { "id": "…", "name": "XLS_20260828_122853_AE11C31A.XLSM" },
  "sheets": [
    { "index": 1, "name": "Накл. на склад(1)", "state": "visible", "usedRows": 48, "usedCols": 40, "mergedRegions": 6,
      "headerGuess": { "row": 4, "cells": { "B": "Товар", "C": "Кількість", "D": "Ціна", "F": "Сума" } } },
    { "index": 3, "name": "Розрахунки", "state": "hidden", "usedRows": 120, "usedCols": 8, "mergedRegions": 0 }
  ]
}
```

`headerGuess` is the first row with ≥2 non-empty text cells; advisory only.

### `read`

```json
{
  "attachment": { "id": "…", "name": "…" },
  "sheet": { "index": 1, "name": "…", "state": "visible", "usedRows": 48, "usedCols": 40 },
  "range": "B4:F12",
  "rows": [
    { "row": 4, "cells": [ { "address": "B4", "value": "Товар", "display": "Товар", "computed": false }, … ] },
    { "row": 12, "cells": [ { "address": "F12", "value": 194677.8, "display": "194677.8", "computed": true } ] }
  ],
  "truncated": false,
  "warnings": []
}
```

Merged regions appear once, at the master cell, with `"span": "A1:AN1"`. Rows with no cells in the range are omitted; the `row` numbers make gaps visible.

### `aggregate`

```json
{
  "attachment": { "id": "…", "name": "…" },
  "sheet": { "index": 2, "name": "Накл. на склад(2)", "state": "visible" },
  "fn": "sum",
  "range": "F5:F8",
  "where": null,
  "value": 1476,
  "covered": {
    "cellsCounted": 1,
    "cellsSkipped": { "empty": 3, "nonNumeric": 0, "computedExcluded": 0, "mergedDuplicates": 0 }
  },
  "cells": [ { "address": "F5", "value": 1476, "computed": false } ],
  "warnings": []
}
```

- `cells` lists every counted cell when `cellsCounted ≤ 50`; otherwise it is omitted and `covered` is the audit trail.
- `count` counts numeric cells; `avg` is `sum / count`; `min`/`max` over numeric cells; `value: null` when nothing was counted.
- With `where`, a row is included only if the cell in `where.column` on that row satisfies the condition (string comparison for `eq/ne/contains`, numeric for `gt/lt`).
- Formula cells are included with `computed: true` unless `include_computed: false`; the result never double-counts a merged region because only master cells exist in the reader's output.

### `find`

```json
{
  "attachment": { "id": "…", "name": "…" },
  "sheet": { "index": 1, "name": "…" },
  "query": "всього",
  "matches": [
    { "address": "B12", "value": "ВСЬОГО ДО СПЛАТИ", "rowCells": [ { "address": "F12", "value": 194677.8, "computed": true } ] }
  ],
  "truncated": false
}
```

At most 100 matches; `rowCells` gives the other non-empty cells on the same row so a label can be tied to its number in one call.

## Errors

| Condition | Message shape |
|---|---|
| Caller is not an agent token | `query_attachment can only be called by an agent runtime.` |
| Attachment not found under the caller's agent | `Attachment <id> is not available to this agent.` (no distinction between "other agent" and "gone") |
| Attachment is not a spreadsheet | `Attachment "<name>" is a <mime>; query_attachment only reads xlsx/xlsm workbooks.` |
| Sheet missing | lists available sheets with index, name and state |
| Hidden sheet without `include_hidden` | `Sheet "<name>" is hidden; pass include_hidden: true to read it.` |
| Bad range | `range must be A1 notation like "B5:F47".` |
| Over `MAX_QUERY_CELLS` | `Range covers <n> cells; narrow it below <limit>.` |
| Workbook unreadable | `Attachment "<name>" could not be parsed as a workbook.` |

## Availability

The tool is discovered by the MCP registry like every `@Tool` provider. The seeder adds a built-in `mcp-documents` server entry (same URL as `mcp-ranch`, bearer `${RANCH_API_TOKEN}`, `builtIn: true`), and `GET /api/agent/:id/mcps` injects it for every agent. Agents already running receive it after their next restart.
