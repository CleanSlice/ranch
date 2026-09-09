# Contract: `query_attachment aggregate` over several ranges

Extends `specs/009-attachment-parse-quality/contracts/query-attachment-tool.md`.

## Parameters (additions)

```json
"ranges": [ { "sheet": "string | integer (optional; default: top-level sheet)", "range": "A1 range, cell or column span" } ]
```

- 1–20 entries. When `ranges` is present, top-level `range` is ignored; top-level `sheet` is the default for entries without one.
- `fn`, `where`, `include_hidden`, `include_computed` apply to every entry.

## Result

Single range (unchanged) plus `parts` with one element. Several ranges:

```json
{
  "attachment": { "id": "…", "name": "…" },
  "fn": "sum",
  "value": 200342.2,
  "where": null,
  "parts": [
    { "sheet": { "index": 1, "name": "Накл. на склад(1)" }, "range": "F12:F12", "value": 194677.8, "cellsCounted": 1,
      "cells": [ { "address": "F12", "value": 194677.8, "computed": true } ] },
    { "sheet": { "index": 2, "name": "Накл. на склад(2)" }, "range": "F13:F13", "value": 5664.4, "cellsCounted": 1,
      "cells": [ { "address": "F13", "value": 5664.4, "computed": true } ] }
  ],
  "covered": { "cellsCounted": 2, "cellsSkipped": { "empty": 0, "nonNumeric": 0, "computedExcluded": 0, "mergedDuplicates": 0 } },
  "warnings": []
}
```

- `value` is computed over the union of counted cells: `sum`/`min`/`max`/`count` directly; `avg` = total sum / total count.
- A part with nothing counted has `value: null`.
- `cells` per part only when that part counted ≤ 50 cells.

## Errors

| Condition | Message |
|---|---|
| entry without a sheet and no top-level sheet | `aggregate: entry <n> needs a sheet, or set sheet at the top level.` |
| bad sheet / hidden sheet / bad range in an entry | the existing message, prefixed `entry <n>: ` |
| combined area over the cap | `Ranges cover <n> cells across all entries; narrow them below <limit>.` |

## Description text (appended, measure-agnostic)

> When a figure you report is combined from several values — across rows, ranges or sheets — compute it with one aggregate call over all of them (the `ranges` parameter) and list the addends with their cells next to the result. Keep values of different meaning in separate columns of your answer, or say what a column holds for each row.
