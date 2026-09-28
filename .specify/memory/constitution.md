# CleanSlice Ranch Constitution

The rules a plan is checked against. They are not style preferences: each one is
here because breaking it has already cost this project a bug, a rewrite, or a
customer clicking something broken.

`CLAUDE.md` tells an agent how to work. This file tells a *plan* what it has to
answer for before Phase 0. Where the two overlap, they must agree; where they
disagree, fix both in the same PR.

## Core Principles

### I. The slice is the unit

A feature lives in its slice — `api/src/slices/<name>`, `admin/slices/<name>`,
`app/slices/<name>` — and takes its domain, data, and presentation with it. A
plan names the slices it touches before it names files. Code that does not
belong to a slice belongs to `common`, and `common` is a deliberate decision,
not a parking space.

New top-level slices are cheap; a helper reaching sideways into another slice's
internals is not. Cross-slice needs go through the owning slice's public surface.

### II. Twin consoles (NON-NEGOTIABLE)

Seven slices exist in both consoles: `agent`, `bridle`, `chat`, `common`,
`setup`, `share`, `user`. A change to any of them is unfinished until its twin
has been looked at. Grep the symbol in both trees. The plan states which console
is affected; the PR states which was checked and why the other needed nothing.

Shared behaviour here is copied, not shared, so the copies drift in silence.
`share` shipped two `buildShareUrl` functions a day apart — different
environment variables, different token encoding — because CLEAN-104 and
CLEAN-110 solved the same problem without meeting, and CLEAN-111 had to go back
and collapse them. Searching one tree and finding nothing proves nothing about
the other.

### III. Secrets stay behind `api/`

Vendor credentials live in `.env.project` and are read only by `api/`.
`runtimeConfig.public` is shipped to the browser in full: a key placed there is
public the moment it deploys, and rotating it is the only remedy.

A plan that introduces a credential says which service holds it and names the
environment variable. Keys are never printed, committed, or pasted into a
ticket, a doc, or a PR description.

### IV. One entity, one store

An entity lives once, in its Pinia store. Fetches upsert, live pushes patch,
components render by id. `useAsyncData` carries loading state, never the entity
itself. Optimistic changes go through the store's `patch()` and carry a
rollback.

A second copy of the same entity held in a component is a bug waiting for the
two to disagree. See `docs/state.md` before adding a store, a fetch, or a feed.

### V. The console is a window, the chat is the hands

An admin-console capability is not finished until the Ranch agent has a tool for
it: in the slice, carrying `topic` / `title` / `template`, gated to the right
audience, `confirm` on anything destructive, no secrets in its result, and a
spec. The API refuses to boot a tool without that metadata.

A plan that adds a console capability lists the matching tool, or states why the
capability is not something the agent should be able to do. See
`docs/agent-tools.md`.

### VI. English is the source, translations are generated

In `app`, `en.json` per slice is the source of truth and `bun run i18n:sync`
generates `ru`. Templates use the injected `$t`; copy decided in script travels
as a key, never as a literal. Hand-writing `ru.json` first is how the two fall
out of step. `admin` stays English-only. See `docs/i18n.md`.

### VII. A rule stays a rule

A decision that can be expressed as a rule, a lookup, or a calculation is
written as one. Code owns the workflow.

Where a decision genuinely needs semantic understanding, the plan must name four
things before implementation starts:

- **the judgment** — one narrow question, not "figure out what the user wants";
- **the possible answers** — including what happens when none of them fit;
- **the threshold** — and what the system does below it, which is usually
  handing the case to a person;
- **the calibration** — a task, on a labelled sample of our own data, that
  produces that threshold.

A threshold copied from a vendor's example is not a threshold. A typed response
guarantees the shape of an answer, never its truth. This applies to every model
call the product makes, whoever the vendor is.

## Additional Constraints

**Generated code is generated.** Types that OpenAPI emits are regenerated, never
hand-written. If `api/swagger-spec.json` or the console SDKs are missing,
regenerate before asking where the schema is.

**The tracker is Jira `CLEAN`.** Not Linear. Every branch, commit, and PR
carries a `CLEAN-<n>` id. The project card at `.cursor/rules/project.mdc` holds
the identity, transitions, and PR conventions; this file does not duplicate
them.

**Surface marking is honest.** A ticket is `[ADMIN]`, `[APP]`, `[ADMIN][APP]`,
or `[API]` according to what it actually changes. Repo tooling that changes no
surface carries no surface prefix rather than a convenient one.

## Quality Gates

A plan is not approved, and work is not done, until:

1. Every principle above is either satisfied or explicitly waived in
   *Complexity Tracking*, with the reason. Silence is not a waiver.
2. Typecheck and tests pass for every project touched, and the PR names the
   commands that were run. "Should be fine" is not a result.
3. The twin-console check from Principle II is stated in the PR, in words.
4. Anything a reviewer would have to take on trust — a threshold, a timeout, a
   retry count, a magic number — carries the reason it has that value.

## Governance

This constitution supersedes habit and precedent. Code already in `main` that
contradicts it is debt, not licence: cite it as debt, do not copy it.

Amendments land in their own PR with a `CLEAN-` id, state what changed and why,
and bump the version below: MAJOR for removing or reversing a principle, MINOR
for adding one or materially widening its scope, PATCH for wording that does not
change what is required. When an amendment makes `CLAUDE.md` or a file under
`docs/` wrong, the same PR fixes it.

A principle that is waived in three consecutive plans is not being followed, and
should be amended or removed rather than quietly ignored.

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28
