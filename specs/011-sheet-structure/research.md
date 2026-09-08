# Phase 0 — Research: Sheet Structure for the Agent

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Jira**: [CLEAN-69](https://dreamvention.atlassian.net/browse/CLEAN-69)

## Findings

### F1. What the agent sees today, and what it missed

CLEAN-67's preview (`documentText.extractor.ts`, `formatWorkbookPreview`) renders every non-empty row as `R<n>: B=… | F=[=]…`. On the reported sheet the closing lines were all there (`R14: … I=Всього без ПДВ | J=82`, … `R18: I=Сума до сплати | J=[=]2598.4`). The model chose the "з ПДВ" line to match the scheme it had used for sheet 1 and did not mention the transport or payable lines. Nothing in the output distinguishes a closing line from an item row except its position, and nothing asked the model to disclose which line it took.

### F2. The reader already yields what structure detection needs

`readSheet()` returns `CellRow[]` with per-cell `kind` (`text` / `number` / `date` / …), `computed`, `address`, `span`. Row density and text/number mix per row are enough to tell a table from its surroundings; no second pass over the workbook is needed.

### F3. Where the structure has to be surfaced

Two places read the reader's output: the preview (`formatWorkbookPreview`) and the tool (`attachment.tool.ts`: `describe` and per-sheet ops). Both must show the same structure, so detection lives in one module both import.

### F4. Keyword lists are the wrong tool

Invoice exports vary by system and language; a dictionary either misses lines or grows without end. The user's direction: give the agent the layout and let it reason. Layout is language-independent: a table is dense rows with a stable column set; a closing line is a sparse row with a text and a number.

## Decisions

### D1. Structure module: `sheetStructure.ts` in `bridle/domain`, pure, over `CellRow[]`

**Decision**: `detectSheetStructure(rows: CellRow[]): SheetStructure` with no I/O. Rules:

- `DENSE_ROW_MIN_CELLS = 3`: a row with ≥3 cells is dense.
- A **table block** is a maximal run of dense rows with consecutive row numbers. Its range is the bounding rectangle of the run's cells.
- **Header**: the block's first row when ≥60% of its cells are text (`HEADER_TEXT_RATIO`); if the next row consists of small sequential integers (1, 2, 3, …) it is a column-index row and joins the header. Data rows are the rest.
- Rows before the first block form the **title area**; rows after a block until the next block form that block's **footer**.
- On sparse rows, each numeric cell (kind `number`, or `computed`) becomes a **pair**: label = nearest text cell on the row to the left, else to the right; `label: null` when none. Text-only rows become **lines**. Dense rows outside a block cannot occur by construction.
- Merged labels keep their `span`.

**Rationale**: covers the reported sheet and the reference fixture with three constants and no vocabulary. Deterministic, cheap (single pass over rows already in memory).

**Alternatives**: Excel table objects (`ListObject`) — rarely present in exports; keyword dictionary — rejected per F4; LLM-based segmentation — non-deterministic and paid.

### D2. Preview placement: structure lines right after the sheet header, before rows

**Decision**: per visible sheet, after the `== Sheet … ==` line:

```
tables: B4:F6 (header R4: B=Товар | C=Кількість | D=Ціна | F=Сума; data R5–R6)
after B4:F6: B10 "Сума без ПДВ" → F10=162231.5 · B11 "ПДВ (20%)" → F11=[=]32446.3 · B12 "ВСЬОГО ДО СПЛАТИ" → F12=[=]194677.8
title: A1 "ТОВ \"Асканія-Флора\"" · A2 "Постачальник:" · A3 "Адреса: …"
```

Lines with no content are omitted. These lines are charged to the budget like rows but are never cut: if the budget cannot fit them, rows are dropped first. Contract in [contracts/sheet-structure.md](./contracts/sheet-structure.md).

**Rationale**: FR-004 — survives truncation; sits where the model reads a sheet's summary. Duplicating the footer values (they also appear as `R<n>` rows) costs a few hundred characters and buys salience.

### D3. Tool: `describe` gains `structure`; new op `structure`

**Decision**: `describe` returns `structure` for visible sheets (title pairs/lines, tables with header and data span and their footer pairs/lines). `op: "structure"` returns it for one sheet, honouring `include_hidden`. Cell caps as for `read`.

### D4. Guidance text stays generic

**Decision**: tool description adds: *"When you report a figure from a sheet, name the label and cell of the row you took it from, and mention the other label → value lines after the same table that change the amount. If sheets close differently, say so instead of forcing one layout on all of them."* The preview hint adds *"each sheet lists its tables and the label → value lines after them"*. No domain words.

### D5. Fixture: sheet 2 of the reference invoice gets a full closing block and title pairs

**Decision**: sheet 2 adds `A2 "Одержувач:"`, `A3 "ІД Код"` + `B3 3563416774` (title pair), and after the items: `Всього без ПДВ` (formula SUM), `ПДВ` (formula), `Загальна сума з ПДВ` (formula), `Транспортні витрати` 2500, `Сума до сплати` (formula), and a text-only line with the amount in words. `EXPECTED.sheet2` gains the payable figures. Existing tests that read sheet 2 by `F:F` narrow their range to the item rows.

## Deferred

- Column-type inference per table (numeric vs text columns) — useful for `aggregate` defaults; not needed for the reported defect.
- Multi-line labels (label on one row, value on the next) — not seen in the reported export.
