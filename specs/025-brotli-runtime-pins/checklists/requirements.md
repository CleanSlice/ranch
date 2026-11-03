# Specification Quality Checklist: Pinned runtime images for the Brotli RCE

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-02
**Feature**: [spec.md](../spec.md)
**Ticket**: [CLEAN-204](https://dreamvention.atlassian.net/browse/CLEAN-204)

## Content Quality

- [~] No implementation details (languages, frameworks, APIs) — **deliberate deviation, see note 1**
- [x] Focused on user value and business needs
- [~] Written for non-technical stakeholders — **partial, see note 2**
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — **two remain: FR-012, FR-013, see note 3**
- [x] Requirements are testable and unambiguous — holds for FR-001 … FR-011
- [x] Success criteria are measurable
- [~] Success criteria are technology-agnostic (no implementation details) — same deviation as note 1
- [x] All acceptance scenarios are defined — 14 across 5 stories
- [x] Edge cases are identified — 8, each traced to a file, a workflow or a past incident
- [~] Scope is clearly bounded — bounded except for the browser-pool question in FR-013
- [x] Dependencies and assumptions identified — 8 assumptions, each labelled verified or unverified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FR-001 … FR-011
- [x] User scenarios cover primary flows — both installations, all six surfaces, both agent workload shapes
- [x] Feature meets measurable outcomes defined in Success Criteria
- [~] No implementation details leak into specification — same deviation as note 1

## Notes

**Note 1 — version numbers and file paths are the requirement, not implementation.** The template asks a spec to avoid naming languages, frameworks and versions. For a CVE remediation that rule inverts: "Bun 1.4.4" and "Node 22.23.4" *are* the business requirement, because the only thing separating a safe deployment from an exploitable one is which number a `FROM` line names. Stripping them would leave a spec nobody could verify. The file-and-line citations stay for the same reason — each one is evidence that a surface exists, gathered by reading the repository rather than assumed. This deviation is recorded rather than silently taken.

**Note 2 — the stakeholder here is an operator.** The feature has no end-user-visible behaviour: nothing in either console changes. The audience that has to read and act on this is whoever runs the clusters, so the user stories are written as operator journeys. The Context section carries the business framing (a KEV-listed critical CVE reachable by any unauthenticated client) for anyone who needs the *why* without the mechanics.

**Note 3 — two open decisions, both genuinely the user's.** Neither has a defensible default:

- **FR-012, the interim mitigation.** The report proposed a Traefik middleware rejecting `Content-Encoding: br`. That covers the upstream cluster only, because Mazda runs AWS ALB with no middleware mechanism. A one-line application-level change (`inflate: false` on the API's body parsers) would cover both installations immediately and needs no edge configuration — but it also rejects gzip and deflate request bodies with 415, and no inventory of what clients send a compressed body exists. Shipping the stop-gap trades a small availability risk for closing the only unauthenticated path days earlier; skipping it accepts the exposure until the images roll. The answer changes what gets built first.
- **FR-013, browser-pool's scope.** It is a sixth surface the original report did not include, and its Node version is chosen inside `ghcr.io/browserless/chromium:latest`, a third-party base. We can rebuild and measure, but if the result is still below 24.22.1 the fix belongs to browserless, not here. Keeping it in this ticket risks blocking the other five surfaces on someone else's release; splitting it keeps this ticket shippable at the cost of one more open item.

Everything the two questions do not touch is complete and ready for `/speckit-plan`. The spec records the assumption each answer would replace, so planning can proceed on the five settled surfaces either way.

**What was verified rather than assumed.** Measured in the repositories during this pass: the six `FROM` lines and their current values; body-parser 2.2.2 invoking `createBrotliDecompress()` for `Content-Encoding: br`; the API mounting `json()` with inflation left at its default; the existence of all target base tags in their registries; `publish-runtime.yml` tagging `:latest` on main-branch pushes; `ops-restart-agents.yaml` restarting containers in place rather than re-creating pods; CodeBuild's build arguments carrying no `--pull`; the Mazda agent image being built from upstream `runtime` and referenced by the database plus a `latest` tag; Mazda's ingress being ALB; the fork's Dockerfiles being identical to upstream; PR #49 merged on 2026-10-26; and `runtime`'s own CI passing a frozen install under Bun 1.4.4 on 2026-11-02. Explicitly *not* verified, and flagged as such in Assumptions: the live pod versions (taken from the user's report), the Node version inside today's browserless base, and bridle's current default branch.
