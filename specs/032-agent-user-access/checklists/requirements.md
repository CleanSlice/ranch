# Specification Quality Checklist: Agent access by role

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-17
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

- Validated in one pass on 2026-11-17; no item failed.
- No [NEEDS CLARIFICATION] markers were used. Three decisions were taken as
  defaults and are worth a look in `/speckit-clarify` before planning:
  1. FR-006: deleting the last agent of an allowed list leaves the account
     with no agents and a review mark, instead of falling back to "every
     agent".
  2. FR-016 / FR-017: an Admin may narrow a User freely but cannot widen past
     their own ceiling, so an Admin with limited access cannot empty a User's
     allowed list.
  3. Assumptions: narrowing an Admin does not cascade to Users they already
     served, and only the Owner manages Admins.
- Clarify session 2026-11-17 added Stories 5 and 6, FR-028 to FR-035, SC-009
  and SC-010. Code pointers for planning, kept out of the spec on purpose:
  - Account switch flash: `app/slices/bridle/stores/bridle.ts` persists each
    conversation under `bridle:conversation:<agentId>` (and `bridle:seq:`),
    `app/slices/agent/composables/useLastAgent.ts` keeps `agent:lastOpened`;
    neither is per account, and `logout()` in
    `app/slices/user/auth/stores/auth.ts` clears only the token and the user.
    `bridle/components/bridle/chat/Provider.vue` hydrates from that copy
    before the server answers. `bridle` is a twin slice: check `admin/`.
  - Pin: `pinned` is one flag on the agent (CLEAN-216), written through the
    agent update that requires Owner or Admin; the `pin_agent` assistant tool
    describes it as installation-wide.
- FR-009 names filtering at request time because the feature description asks
  for it; it is stated as behaviour (no rebuild, no re-sign-in), not as a
  design.
- `.specify/feature.json` is left pointing at `main`'s value on purpose: it is
  a one-line tracked file that every parallel feature rewrites and it has
  caused merge conflicts before. Pass `specs/032-agent-user-access` to the
  downstream SpecKit commands explicitly.
