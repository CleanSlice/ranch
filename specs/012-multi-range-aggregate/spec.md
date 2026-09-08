# Feature Specification: Combined Figures Are Computed, Not Reasoned

**Feature Branch**: `feat/CLEAN-71-multi-range-aggregate` · **Ticket**: [CLEAN-71](https://dreamvention.atlassian.net/browse/CLEAN-71) · **Created**: 2026-09-08 · **Status**: Draft

**Input**: With the agent restarted and CLEAN-67/69 live, per-sheet figures were right and the transport line was recognised (sheet 3: 98.40 + 2 500.00 = 2 598.40), yet the document total used 98.40 instead of 2 598.40. Per-sheet values came from the tool; the document-level total was model arithmetic, and that is where 2 500 was lost. Transport was also placed in the "з ПДВ" column, mixing two meanings in one column.

## User Scenarios & Testing

### User Story 1 - A figure combined across ranges or sheets is computed by the tool (Priority: P1)

An operator asks for a document-level figure that combines values from several sheets or several places on one sheet. The agent obtains it with one tool call over all the ranges, and the answer shows the addends with their cells next to the result.

**Independent Test**: on the reference workbook, one `aggregate` call over sheet 1 `F12` and sheet 2 `F13` returns their sum with both cells listed; a call with a wrong sheet in one entry fails naming that entry; the cell cap applies to all entries together.

**Acceptance Scenarios**:
1. **Given** ranges on two sheets, **When** aggregated with `sum`, **Then** the result equals the sum of both ranges and each range's own value and cells are returned.
2. **Given** `max` over ranges on different sheets, **When** aggregated, **Then** the maximum across all counted cells is returned with the cell it came from.
3. **Given** an entry without a sheet and a top-level sheet, **When** aggregated, **Then** the entry uses the top-level sheet.
4. **Given** entries whose combined area exceeds the cell cap, **When** aggregated, **Then** the call fails and says so.
5. **Given** an existing single-range call, **When** aggregated, **Then** the response is unchanged (compatibility).

### User Story 2 - The agent shows its addends and keeps meanings apart (Priority: P2)

When a reported figure is combined from several values, the answer lists the addends with cells; values of different meaning are kept in separate columns or the column's meaning is stated per row.

**Independent Test**: reference question "итог по документу" — the answer lists the per-sheet values with cells and the combined result computed by the tool; nothing is added in prose.

### Edge Cases
- `where` filter with multiple ranges: applies per range, using that range's sheet.
- Duplicate ranges: counted twice, as asked; the per-range breakdown makes it visible.
- Hidden sheet in one entry without `include_hidden`: the whole call fails with the existing hidden-sheet message.
- Empty result in one entry: that part reports `value: null`; the combined value covers the rest.

## Requirements
- **FR-001**: `aggregate` MUST accept a list of ranges, each with an optional sheet (default: the top-level sheet), and MUST return the combined value plus per-range values, counted cells and cells.
- **FR-002**: Fidelity rules of the single-range call MUST apply to every entry (merged once, computed flag, hidden gated, numeric-only).
- **FR-003**: The cell cap MUST apply to the sum of all entries' areas.
- **FR-004**: The single-range call and its response shape MUST stay unchanged.
- **FR-005**: The tool description MUST instruct the agent to compute combined figures with one call over all ranges and to list the addends with cells next to the result, and to keep values of different meaning in separate columns or state the column's meaning per row. Wording stays measure-agnostic.
- **FR-006**: Tests MUST cover multi-range sum and max across sheets, top-level sheet default, `where` per entry, a bad sheet in one entry, and the combined cell cap.

## Success Criteria
- **SC-001**: On the reference workbook the combined figure across sheets 1 and 2 is exact and every addend is returned with its cell.
- **SC-002**: All existing `aggregate` tests pass unchanged.
- **SC-003**: The agent's answer to the reference "document total" question lists addends with cells and a tool-computed result (manual, quickstart).

## Assumptions
- At most 20 entries per call.
- No preview change: the preview hint already points to the tool; the addends rule belongs to the tool description that the agent reads when deciding how to answer.
