# Feature Specification: Sheet Structure for the Agent

**Feature Branch**: `feat/CLEAN-69-sheet-structure`

**Ticket**: [CLEAN-69](https://dreamvention.atlassian.net/browse/CLEAN-69)

**Created**: 2026-09-08

**Status**: Draft

**Input**: Follow-up to CLEAN-67. Asked for the total per sheet, the agent reported 98.40 for sheet 3 ("Загальна сума з ПДВ") and ignored "Транспортні витрати 2500.00" and "Сума до сплати 2598.40" on the same sheet. Extraction was correct; the model forced one scheme across sheets and never said which line it took. The fix must not rely on a dictionary of marker words: requests vary, and deciding what a line means is the agent's job.

## Context

After CLEAN-67 the agent receives every cell of a workbook with coordinates, merged regions once, formula cells marked. What it does not receive is the *shape* of a sheet: where the table is, where its header is, and which rows after the table are summary lines pairing a label with a number. On an invoice export the lines that change the amount to pay (discount, transport, payable total) sit below the item table, one label and one number per row. When the preview is long or the model is answering across several sheets, those lines are easy to skip, and nothing in the output makes them stand out from the item rows.

This feature gives the agent the structure of each sheet, derived from layout alone: table blocks, title area, and the label → value pairs after each table, each with its cell. It does not classify labels. What "сумма поставки" means for a given question is decided by the agent from the labels it sees.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The agent sees every summary line after a table (Priority: P1)

An operator attaches an invoice workbook where sheets differ in their closing lines (one has only subtotal / VAT / total, another adds discount, transport and a payable amount). The agent's view of each sheet lists, separately from the item rows, every label → value pair found after the table, with its cell.

**Why this priority**: this is the exact gap from the observed conversation. With the pairs listed side by side the agent cannot overlook one without choosing to.

**Independent Test**: extract the reference workbook (sheet 2 now carries discount, transport and payable lines); the agent-facing block for sheet 2 lists all five pairs with cells; the same pairs appear in the tool's `describe` output.

**Acceptance Scenarios**:

1. **Given** a sheet with an item table followed by rows "Всього без ПДВ 82", "ПДВ 16.40", "Загальна сума з ПДВ 98.40", "Транспортні витрати 2500", "Сума до сплати 2598.40", **When** the sheet is presented to the agent, **Then** all five appear as label → value pairs with the value cell, in row order, regardless of the words used in the labels.
2. **Given** a footer row whose number is a formula, **When** listed, **Then** the pair is marked computed.
3. **Given** a footer row with text only (amount in words, signature line), **When** listed, **Then** it appears as a note with its cell, not as a pair, and does not break the pairs around it.
4. **Given** the preview budget cuts the item rows of a long sheet, **When** the block is built, **Then** the structure lines (tables and pairs) are still present for that sheet.
5. **Given** two tables on one sheet, **When** presented, **Then** each table has its own following pairs; pairs are attributed to the table they follow.

---

### User Story 2 - The agent knows where the table and its header are (Priority: P2)

The agent's view names each table block on a sheet: its range, the header row with its labels, and the data row span. Title lines above the first table (supplier, recipient, document number) are listed with their cells, and label → value pairs in that area (codes, dates) are listed as pairs.

**Why this priority**: lets the agent aggregate over the right rows without guessing where the header ends and where the totals begin, and lets it cite "rows 5–6 of the table at B4:F12".

**Independent Test**: `describe` on the reference workbook returns for sheet 1 a table at the expected range with header row 4 and data rows 5–6, and title lines for rows 1–3.

**Acceptance Scenarios**:

1. **Given** a sheet with a merged title block, a header row and item rows, **When** described, **Then** the table range, header row, header labels per column and data row span are reported.
2. **Given** a column-numbering row directly under the header (1, 2, 3, …), **When** described, **Then** it is treated as part of the header, not as data.
3. **Given** a sheet with no dense rows at all (a list of label → value lines only), **When** described, **Then** no table is reported and all pairs are listed under the title area.

---

### User Story 3 - The agent says which line it used (Priority: P2)

When the agent reports a figure taken from a sheet, it names the label and cell of the line it used and mentions the other summary lines that change the amount. When sheets differ in structure, it says so instead of collapsing them into one table.

**Why this priority**: the observed wrong answer was undetectable without opening the file; naming the line makes the choice visible and checkable.

**Independent Test**: reference question "сумма по каждому листу" — the answer for sheet 2 names "Сума до сплати" (or the label it chose) with its cell and lists discount and transport as components; the answer notes that sheet 1 has no transport line.

**Acceptance Scenarios**:

1. **Given** a per-sheet total question, **When** answered, **Then** each figure is accompanied by the label and cell of the row used.
2. **Given** a sheet with additional summary lines after the chosen one, **When** answered, **Then** those lines are mentioned with their values.
3. **Given** sheets with different closing structures, **When** answered, **Then** the difference is stated.

---

### Edge Cases

- A label cell to the right of the number (rare layouts): the nearest text cell on the row, either side, is used; left is preferred when both exist.
- A footer row with two numbers and one label (e.g. quantity and amount): one pair per number, sharing the label.
- Merged label cell spanning several columns: the master cell is the label; its span is reported.
- A number that is actually a code (year, ID) in the title area: still a pair; the agent decides.
- A sheet where the table is the last thing (no footer): empty footer, no error.
- Hidden sheets: no structure unless `include_hidden`.
- Very large sheets: structure detection works on the rows already read under the existing cell cap; no second pass over the file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For every visible sheet the system MUST derive, from layout alone, the list of table blocks (range, header row, header labels by column, data row span).
- **FR-002**: For the rows above the first table and after each table, the system MUST list label → value pairs (label text, label cell, value, value cell, computed flag) and text-only lines (text, cell), in row order.
- **FR-003**: Pair detection MUST NOT depend on the words in the labels; any text cell next to a number on a sparse row qualifies.
- **FR-004**: The agent-facing preview MUST include, per visible sheet, the table blocks and the pairs after each table, placed before the item rows so they survive a budget cut.
- **FR-005**: `query_attachment describe` MUST return the structure per visible sheet, and a dedicated operation MUST return it for one sheet (hidden sheets with `include_hidden`).
- **FR-006**: The tool description and the preview hint MUST instruct the agent to name the label and cell of the line it used, to mention other summary lines that change the amount, and to state when sheets differ in structure. The instructions MUST NOT name domain words (VAT, transport, total).
- **FR-007**: A reference workbook sheet with discount, transport and payable lines MUST exist, and tests MUST assert the detected structure and its presence in the preview and in the tool output.
- **FR-008**: Existing behaviour of the preview (row format, merged handling, budget, hidden sheets) and of the tool's other operations MUST be unchanged.

### Key Entities

- **Table block**: a run of dense rows on a sheet; has a range, an optional header row with labels per column, and a data row span.
- **Label → value pair**: a number on a sparse row together with the nearest text on the same row; carries both cells and whether the number is computed.
- **Sheet structure**: title area (pairs, lines), the table blocks, and for each block the pairs and lines that follow it until the next block.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the reference workbook, 100% of the footer pairs on the sheet with discount and transport are present in the preview and in `describe`, with correct cells.
- **SC-002**: On the reference question "sum per sheet", the answer for the sheet with transport names the line used and lists the other summary lines; no figure is reported without a cell.
- **SC-003**: The structure lines add less than 5% to the preview of a plain 300-row table and under 800 characters to the reference invoice (whose sheets are mostly title and closing lines, so the relative share is high by construction); the per-segment listing is capped so no sheet can add more than a bounded amount.
- **SC-004**: All existing CLEAN-67 tests pass unchanged except for fixture-driven expectations updated for the new footer rows.

## Assumptions

- "Dense row" means three or more non-empty cells; "sparse row" means one or two. These thresholds are constants, not literals.
- A header row is the first row of a table block whose cells are mostly text; a row of small sequential integers right under it is a column-index row and belongs to the header.
- Structure is derived from the rows already read for the preview or the tool call; no separate scan of the workbook.
- The admin/app UI does not change; this feature is API-only.
