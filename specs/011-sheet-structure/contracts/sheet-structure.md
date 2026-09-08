# Contract: sheet structure in the preview and in `query_attachment`

Extends `specs/009-attachment-parse-quality/contracts/agent-facing-document.md` §3 and `query-attachment-tool.md`.

## Preview lines (per visible sheet, after the `== Sheet … ==` header, before rows)

```
== Sheet 2: Накл. на склад(2) == visible · 14 rows × 12 cols used · rows 1–14 included · 0 rows omitted
title: A1[A1:L1] "ТОВ \"Асканія-Флора\"" · A2 "Одержувач:" · A3 "ІД Код" → B3=3563416774
tables: B4:F7 (header R4: B=Товар | C=Кількість | D=Ціна | F=Сума; data R5–R7)
after B4:F7: B9 "Всього без ПДВ" → F9=[=]2706 · B10 "ПДВ (20%)" → F10=[=]541.2 · B11 "Загальна сума з ПДВ" → F11=[=]3247.2 · B12 "Транспортні витрати" → F12=2500 · B13 "Сума до сплати" → F13=[=]5747.2 · B14 "Сума до сплати: п'ять тисяч …"
R1: A1[A1:L1]=ТОВ "Асканія-Флора"
…
```

Rules:

| Line | Content | Omitted when |
|---|---|---|
| `title:` | pairs as `<labelCell> "<label>" → <valueCell>=<[=]><value>`, lines as `<cell> "<text>"`, joined with ` · `, row order | the title segment is empty |
| `tables:` | one entry per block: `<range> (header R<n>: <col>=<label> \| …; data R<a>–R<b>)`; `header none` / `data none` when absent; entries joined with `; ` | no tables |
| `after <range>:` | that block's footer pairs and lines, same format as `title:` | the footer is empty |
| pairs without a label | `<valueCell>=<value>` alone | – |
| labels | quotes inside are escaped as `\"`; newlines as `⏎`; pipes as `\|` | – |

Budget: structure lines are charged against the sheet's budget before its rows; when they do not fit, rows are dropped first, never the structure lines. Hidden sheets get no structure lines.

## `query_attachment`

### `describe` — per visible sheet, added field

```json
"structure": {
  "title": { "pairs": [ { "label": "ІД Код", "labelCell": "A3", "value": 3563416774, "valueCell": "B3", "computed": false, "display": "3563416774" } ],
             "lines": [ { "row": 1, "cell": "A1", "text": "ТОВ \"Асканія-Флора\"" }, { "row": 2, "cell": "A2", "text": "Одержувач:" } ] },
  "tables": [ {
    "range": "B4:F7", "headerRow": 4, "headerCells": { "B": "Товар", "C": "Кількість", "D": "Ціна", "F": "Сума" },
    "indexRow": null, "dataRows": [5, 7], "rowCount": 3,
    "footer": { "pairs": [ { "label": "Всього без ПДВ", "labelCell": "B9", "value": 2706, "valueCell": "F9", "computed": true, "display": "2706" }, … ],
                "lines": [ { "row": 14, "cell": "B14", "text": "Сума до сплати: …" } ] }
  } ]
}
```

`headerGuess` from CLEAN-67 stays for compatibility and now mirrors the first table's header.

### `structure` — new operation

Parameters: `attachment_id`, `op: "structure"`, `sheet` (required), `include_hidden` (optional).

Result: `{ "attachment": {…}, "sheet": {…}, "structure": SheetStructure, "warnings": [] }`.

Errors: as for `read` (missing sheet, hidden sheet, cell cap).

## Guidance text

Tool description, appended (no domain words):

> When you report a figure from a sheet, name the label and the cell of the row you took it from, and mention the other label → value lines after the same table that change the amount. If sheets close differently, say so instead of forcing one layout on all of them. Use op "structure" to see a sheet's tables and closing lines.

Preview hint, appended: `each sheet lists its tables and the label → value lines after them.`
