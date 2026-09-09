# Implementation Plan: Combined Figures Are Computed, Not Reasoned

**Branch**: `feat/CLEAN-71-multi-range-aggregate` · **Date**: 2026-09-08 · **Spec**: [spec.md](./spec.md) · **Jira**: [CLEAN-71](https://dreamvention.atlassian.net/browse/CLEAN-71)

## Summary
Extend `query_attachment aggregate` with a `ranges` list (each entry: optional sheet + A1 range). The tool computes the combined value over every counted cell of every entry and returns a per-entry breakdown, so a document-level figure is a single computation with visible addends. The description tells the agent to use it that way and to show the addends.

## Technical Context
API only (NestJS, TypeScript). No new dependencies, no storage, no DTO change (MCP JSON). Jest, colocated. Constraint: single-range response unchanged; cell cap across entries; measure-agnostic wording.

## Research / decisions
- **D1 — one code path.** Refactor the aggregation loop into `aggregatePart(workbook, entryArgs)` returning counted cells and skip counts; `aggregate()` runs it per entry and combines. The single-range call is the one-entry case, so compatibility is by construction.
- **D2 — response shape.** Single range: as today. Multi range: top-level `fn`, `value`, `covered` (totals), `parts[]` (`sheet`, `range`, `value`, `cellsCounted`, `cells` when ≤ 50), `warnings` (concatenated). `parts` is also present for a single range (one element) — additive, harmless.
- **D3 — cap.** Areas are summed as entries are read; the first entry that pushes the total over `MAX_QUERY_CELLS` fails the call with the existing message wording plus "across all ranges".
- **D4 — combining functions.** `sum`, `min`, `max`, `count` over the union of counted cells; `avg` = total sum / total count (not the mean of per-part means).
- **D5 — `where`.** Applied per entry against that entry's sheet, exactly as for a single range.
- **D6 — wording.** Description gains: compute combined figures with one call over all ranges; list addends with cells; keep values of different meaning in separate columns or state the column's meaning per row. No measure named as default.

## Structure
```text
specs/012-multi-range-aggregate/ (spec, plan, tasks, quickstart, contracts/multi-range-aggregate.md, checklists/requirements.md)
api/src/slices/bridle/attachment.tool.ts       # ranges param, aggregatePart(), combined aggregate(), description
api/src/slices/bridle/attachment.tool.spec.ts  # multi-range cases
specs/009-attachment-parse-quality/contracts/query-attachment-tool.md  # pointer
```

## Constitution check
Unratified template; de-facto rules pass (CLEAN ticket + branch, slice-local change, no new deps, generated fixtures). Post-design: unchanged.

## Delivery
Small task: one commit + PR; Jira start and end comments. Version bump 0.3.47 → 0.3.48 in the PR (repo convention).
