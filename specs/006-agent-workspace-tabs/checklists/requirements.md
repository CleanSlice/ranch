# Specification Quality Checklist: Agent workspace — vertical agent tabs + settings panel

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation iteration 1 — 2026-08-20

Three `[NEEDS CLARIFICATION]` markers open; everything else passing.

| # | Requirement | Question |
|---|-------------|----------|
| 1 | FR-006 | With a single visible agent, render the rail anyway or hide it? |
| 2 | FR-008 | Is the admin agents table removed entirely, or kept as a secondary "all agents" view? |
| 3 | FR-020 | Which agent does the app workspace open on landing? |

### Validation iteration 2 — 2026-08-20

All three answered by the requester and written back into the spec; checklist fully passing.

| # | Requirement | Decision |
|---|-------------|----------|
| 1 | FR-006 | Rail always rendered — layout does not change shape as agents come and go. |
| 2 | FR-008 | Table removed entirely; the workspace is the only agents screen in admin. |
| 3 | FR-020 | Last opened agent, remembered per browser; falls back to first running, then first in list. |

Knock-on edits: US2 gained an acceptance scenario for the remembered agent, SC-011 covers
it as an outcome, and Assumptions records that the memory is per-browser rather than
server-side.

### Validation iteration 3 — 2026-08-20

Requester corrections after reading the draft; checklist still fully passing.

| Area | Correction |
|------|-----------|
| FR-010, SC-003 | The conversation is **not** stretched to full width. The chat widget keeps its current min/max width and the pod logs stay beside it — removing the nine-tab column buys room for the rail and the panel, not chat width. The "40% wider conversation" outcome was wrong and is replaced by "chat and logs both fully visible side by side, neither narrower than today". |
| FR-009 | Split by scope: create + cluster capacity go to the **top action row** (where "Back to agents" sits today); edit, start/stop, restart and delete go to the **settings panel**, as the reference draws them. The earlier draft put create and capacity in the rail header. |
| FR-019 | Same no-stretch rule applies to app — the conversation keeps its readable width. |
| Reference | `export-1a/` stays untracked and is dropped after implementation, so this spec is the durable record of it. |

### Validation iteration 4 — 2026-08-20 (during `/speckit-plan`)

| Area | Correction |
|------|-----------|
| FR-013 | The settings panel is **open by default**, not collapsed — the agent's controls (edit, start/stop, restart, delete) live inside it, so collapsed-by-default would hide them behind a click. The persist-on-toggle rule is unchanged. US1 scenario 1 updated to match. |

This is what forced the layout tier work in [plan.md](../plan.md) § Layout budget: a
default-open panel plus an unstretched chat plus the logs plus the rail exceeds 1440px, so the
panel docks only on wide screens and overlays below.

### Validation iteration 5 — 2026-08-20 (during `/speckit-plan`)

The requester asked where a section's content should render when its row is clicked. The
answer changed the shape of the panel, so several requirements moved with it.

| Requirement | Was | Now |
|-------------|-----|-----|
| FR-012 | Sections reachable from the panel | …and their content renders in the middle canvas, at the width it already has |
| FR-014 | Sections expand and collapse inside the panel (accordion) | The panel **navigates**: every section stays one click away, the current one is marked, and returning to the conversation is one action with the transcript intact |
| FR-016 | `?tab=` expands a section in the panel | `?tab=` puts that section in the canvas |
| FR-018 | Panel must be wide enough for tables and editors | Panel stays **narrow** — it holds names, counts, identity and controls, and no content |
| SC-004 | 8 sections functionally unchanged | …and **zero** of them need layout changes to fit their new home |
| SC-004a | — | **New.** Returning from a section to the conversation is one action and the transcript is unchanged |

Why it matters: the accordion reading was mine, taken from "с возможностью быть свернутыми",
and it would have forced a redesign of Files, Paddock and Environment to fit ~400px. The
reference's own chevrons and counts read as navigation. Full reasoning and the rejected
alternatives are in [research.md](../research.md) R2.

Notes worth carrying into planning:

- The spec names concrete screens and routes (`/agents/:id`, `?tab=`) because they are
  existing, user-visible contracts the feature must not break — not implementation choices.
- FR-015 (section counts) depends on data each section already reads; the Assumptions
  section records that a section ships without its count rather than blocking on a new
  endpoint.
- FR-008 removing the table means FR-009 (create, capacity, edit, start/stop, restart,
  delete) is the checklist to verify nothing was lost with it.
