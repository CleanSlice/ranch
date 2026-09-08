# Tasks: Sheet Structure for the Agent

**Input**: `specs/011-sheet-structure/` (spec, plan, research, data-model, contracts, quickstart)

**Jira**: [CLEAN-69](https://dreamvention.atlassian.net/browse/CLEAN-69) — small task: start + end comment.

**Tests**: included (FR-007).

## Phase 1: Setup

- [X] T001 Extend `api/src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts`: sheet 2 adds title pair `A3 "ІД Код" / B3 3563416774` and `A2 "Одержувач:"`, and after the items rows 9–14: `Всього без ПДВ` `=SUM(F5:F7)`, `ПДВ (20%)` `=F9*0.2`, `Загальна сума з ПДВ` `=F9+F10`, `Транспортні витрати` 2500, `Сума до сплати` `=F11+F12`, and a text-only line `Сума до сплати: <words>`; extend `EXPECTED.sheet2` with `subtotal`, `vat`, `withVat`, `transport`, `payable`, `footerRows`, `titlePairCell`. Add `buildTwoTables()` (two dense blocks separated by a pair row) and `buildPairsOnly()` (no dense rows).

## Phase 2: User Story 1 + 2 — structure detection (P1/P2)

- [X] T002 [US1] Write `api/src/slices/bridle/domain/sheetStructure.spec.ts` per quickstart: reference sheet 1 (table B4:F6, header R4 with 4 labels, data 5–6, footer pairs at rows 10–12 with computed flags, title lines rows 1–3); reference sheet 2 (title pair A3→B3, five footer pairs in order with cells, text-only line row 14); index row joins header; two tables each with own footer; pairs-only sheet (no tables, all in title); label on the right; two numbers one label; merged label span; constants exported.
- [X] T003 [US1] Create `api/src/slices/bridle/domain/sheetStructure.ts` implementing research D1: types from data-model.md, `DENSE_ROW_MIN_CELLS`, `HEADER_TEXT_RATIO`, `INDEX_ROW_MAX_VALUE`, `detectSheetStructure(rows: CellRow[]): SheetStructure`, `formatStructureLines(structure): string[]` (the `title:` / `tables:` / `after <range>:` lines per contract). Export from `domain/index.ts`.
- [X] T004 [US2] `guessHeader()` in `api/src/slices/bridle/domain/workbook.reader.ts` left as is: on every fixture it already equals the first table's header, and `describe` now returns the full `structure` next to it, so a rewrite would only add risk.

## Phase 3: User Story 1 — preview and tool (P1)

- [X] T005 [US1] In `api/src/slices/bridle/domain/documentText.extractor.ts` `formatWorkbookPreview`: for visible sheets compute the structure from the full section rows (before the `maxRows` cut: read the sheet without `maxRows`, detect, then apply the preview cap to rows) and emit `formatStructureLines` after the sheet header; charge them to the budget before rows and never drop them.
- [X] T006 [US1] Extend `api/src/slices/bridle/domain/documentText.extractor.spec.ts`: reference sheet 2 block contains `after B4:F7:` with all five pairs and cells; `tables:` line for sheet 1; structure lines survive a budget that cuts rows; preview size for the reference workbook grows < 15% vs. structure-less output (compute both in-test by calling `formatWorkbookPreview` with `{ structure: false }` — add that option); plain header+rows sheet has no `after` line.
- [X] T007 [US1] In `api/src/slices/bridle/attachment.tool.ts`: `describe` adds `structure` per visible sheet (from a full `readSheet` under `MAX_QUERY_CELLS`); new `op: "structure"` with `sheet` + `include_hidden`; extend the zod enum and DESCRIPTION with the guidance sentence from contracts/sheet-structure.md.
- [X] T008 [US1] Extend `api/src/slices/bridle/attachment.tool.spec.ts`: `describe` returns sheet 2 structure with five footer pairs; `structure` op on sheet 2 and on the hidden sheet (gated); `structure` without sheet → error; adjust `read F:F` and `aggregate max F:F` cases on sheet 2 to the item rows (`F5:F7`).
- [X] T009 [US1] In `api/src/slices/bridle/domain/attachment.service.ts` extend `SPREADSHEET_HINT` with "each sheet lists its tables and the label → value lines after them"; update the assertion in `attachment.service.spec.ts`.

## Phase 4: Polish

- [X] T010 Run `cd api && bunx jest` and `bunx tsc --noEmit`; `bunx eslint --fix` on touched files; update `specs/009-attachment-parse-quality/contracts/query-attachment-tool.md` with a pointer to the new op.
- [X] T011 Commit with `CLEAN-69`, push, open PR into `main`, link on the ticket, move to In Testing; end comment with what changed and the restart note.

## Dependencies

T001 → T002/T003 (fixtures used by specs) → T004..T009 (preview and tool consume the module) → T010 → T011. T005/T006 and T007/T008 can run in parallel after T003.
