# Tasks: Combined Figures Are Computed, Not Reasoned

**Jira**: [CLEAN-71](https://dreamvention.atlassian.net/browse/CLEAN-71) — small task: start + end comment. **Tests**: included (FR-006).

- [X] T001 [US1] Extend `api/src/slices/bridle/attachment.tool.spec.ts`: multi-range `sum` over sheet 1 `F12` + sheet 2 `F13` with per-part values and cells; `max` across sheets returns the cell; entry without sheet uses the top-level sheet; `where` per entry; bad sheet in entry 2 → error prefixed `entry 2:`; combined cap (two large ranges on the corner sheet) → error; single-range response still has `sheet`, `range`, `covered`, `cells`.
- [X] T002 [US1] In `api/src/slices/bridle/attachment.tool.ts`: add `ranges` to the zod schema; extract `aggregatePart()`; make `aggregate()` iterate entries, sum areas against `MAX_QUERY_CELLS`, combine per contract D4, and return `parts`; keep the single-range shape.
- [X] T003 [US2] Append the addends/columns sentence to `DESCRIPTION` in `api/src/slices/bridle/attachment.tool.ts` (contract wording); mention `ranges` in the `op` description.
- [X] T004 Pointer in `specs/009-attachment-parse-quality/contracts/query-attachment-tool.md`; `bunx jest`, `bunx tsc --noEmit`, `eslint --fix` on touched files; version 0.3.47 → 0.3.48.
- [X] T005 Commit with `CLEAN-71`, push, PR into `main`, link on the ticket, In Testing, end comment.
