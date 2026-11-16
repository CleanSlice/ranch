# Specification Quality Checklist: Request limits for agents, with a live load view and a "try again in" notice

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-16
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

- Validated 2026-11-16, first pass, all items pass.
- The Background section names repository facts (which screens exist, that the
  widget is a separate repository, that the platform runs as one copy). They
  are findings the request asked for, stated as behaviour, and follow the
  house style of earlier specs (022). Requirements and success criteria carry
  no technology.
- No clarification markers were used. Five decisions were taken as documented
  assumptions and are the ones worth a second look before `/speckit-plan`:
  1. existing public agents are flagged, not capped, at rollout;
  2. one allowance per agent shared by all senders — confirmed by the user on
     2026-11-16; the per-visitor layer moved out of scope to a next phase;
  3. operators and agent-to-agent traffic are exempt;
  4. windows move with time instead of resetting on the clock;
  5. Telegram and scheduled runs are out of scope because they never pass
     through the platform.
- Revised 2026-11-16 after review: a full section on the notice's behaviour in
  the chat (wording, placement, what stays possible, when it appears and ends),
  the operator's line in the admin console, and a "How it is proven" group that
  makes browser tests against a running platform a condition of done. The
  spec names where those tests live because every earlier feature keeps them
  in the same place; it does not name a tool. Re-validated, all items pass.
- `.specify/feature.json` was left pointing at `main`'s value on purpose: every
  parallel feature rewrites that one line and it is the usual merge conflict.
  Name `specs/030-agent-request-limits` explicitly to downstream SpecKit
  commands.
