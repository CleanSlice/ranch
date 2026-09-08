# Implementation Plan: Sheet Structure for the Agent

**Branch**: `feat/CLEAN-69-sheet-structure` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Jira**: [CLEAN-69](https://dreamvention.atlassian.net/browse/CLEAN-69)

## Summary

Give the agent the shape of every sheet, derived from layout and not from words: table blocks with their header and data span, the title area above, and the label → value pairs after each table with their cells. Surface it in the preview (before the rows, so it survives budget cuts) and in `query_attachment` (`describe` and a new `structure` op). Add generic answer discipline to the tool description: name the row used, mention the other closing lines, say when sheets differ. Extend the reference fixture so the reported case (transport + payable lines) is under test.

## Technical Context

**Language/Version**: TypeScript on NestJS 11 (API only). **Dependencies**: none new; consumes `CellRow[]` from `workbook.reader.ts`. **Storage**: none. **Testing**: Jest, colocated, fixtures generated. **Constraints**: no keyword dictionary (user decision); structure computed from rows already read (no second workbook pass); preview growth < 15% on the reference workbook; existing CLEAN-67 tests unchanged except fixture-driven expectations. **Scope**: 1 new module + spec, edits to extractor, tool, service hint, fixtures and four existing specs.

## Constitution Check

Constitution still unratified (template). De-facto rules: Jira CLEAN ticket and branch naming — PASS (CLEAN-69, `feat/CLEAN-69-sheet-structure`); vertical slices — PASS (pure domain module in `bridle/domain`); no hand-written generated types — N/A (no DTO change; tool I/O is MCP JSON); reuse — PASS (reader output reused; no new dependency); no customer data — PASS (fixtures generated). Post-design re-check: unchanged.

## Project Structure

```text
specs/011-sheet-structure/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/sheet-structure.md
└── checklists/requirements.md

api/src/slices/bridle/
├── domain/sheetStructure.ts          # NEW — detectSheetStructure(rows) + constants + types
├── domain/sheetStructure.spec.ts     # NEW
├── domain/documentText.extractor.ts  # structure lines per sheet, budgeted before rows
├── domain/documentText.extractor.spec.ts
├── domain/attachment.service.ts      # hint sentence extended
├── domain/attachment.service.spec.ts
├── domain/workbook.reader.ts         # guessHeader delegates to structure (optional)
├── domain/__fixtures__/buildReferenceWorkbooks.ts  # sheet 2 closing block + title pair; EXPECTED
├── attachment.tool.ts                # describe.structure, op "structure", description text
└── attachment.tool.spec.ts
```

## Delivery

One slice, three commits: (1) module + spec + fixture, (2) preview + tool + guidance + spec updates, (3) docs/PR. Jira: start and end comments (small task).

## Risks

- Heuristic thresholds (dense = 3 cells) may misclassify a two-column table as sparse rows; then its rows become pairs, which is still readable. Constants make tuning cheap.
- Wide title blocks with many merged cells: merged continuations never appear as cells, so density is computed on masters only — correct by construction.
