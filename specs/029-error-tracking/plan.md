# Implementation Plan: Error Tracking for API, Admin and App

**Branch**: `feat/CLEAN-218-error-tracking` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/029-error-tracking/spec.md`

**Ticket**: [CLEAN-218](https://dreamvention.atlassian.net/browse/CLEAN-218)

## Summary

Report unexpected failures from `api`, `admin` and `app` to the team's
GlitchTip, one project each, using main-site's rule set: production only,
expected errors stay out, server failures and unknown errors go in labelled
with status and error code, private data removed first.

The approach: a `setup/sentry` slice in each of the three projects. Its core is
one pure file, `sentry.rules.ts`, byte-identical in all three and guarded by a
CI test. Around it, each project has a thin adapter that owns the SDK
(`@sentry/bun` in the API, `@sentry/vue` in the consoles) and the few places
where errors are caught. Every event, however it was captured, passes through
the rules in `beforeSend`. Destinations come from cluster secrets, never from
the repository, so the Mazda fork inherits the code and stays silent.

## Technical Context

**Language/Version**: TypeScript 5.7. API on NestJS 11, run by Bun 1.4.4 in production and by jest on Node in tests. Consoles on Nuxt 4 / Vue 3.5, `ssr: false`.

**Primary Dependencies**: `@sentry/bun` (api), `@sentry/vue` (admin, app), both `^10.56.0` — the line main-site runs against the same GlitchTip ([R4](./research.md)). `@sentry/cli`, pinned, in the console Docker builder stage only.

**Storage**: N/A. No table, no migration, no store.

**Testing**: jest in `api` (`*.spec.ts`), `bun test slices` in each console, `bun test scripts` for the twin guard.

**Target Platform**: The Ranch production cluster (k8s). Browsers for the consoles.

**Project Type**: Web application — one API and two consoles in a bun workspace.

**Performance Goals**: Zero added wait on any request or screen: capture is never awaited on the request path.

**Constraints**: No private data in an event. No behaviour change on an error. No real destination or credential in the repository. Off in local development. Rules identical in three projects.

**Scale/Scope**: One installation, one environment. Three small slices (about ten new files each side of the twin), one global filter, three existing files touched in the API, two per console, two Dockerfiles, one workflow, three manifests, one doc.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How |
|-----------|---------|-----|
| I. The slice is the unit | Pass | New `setup/sentry` slice in each project. It is reached through its `index.ts`; `setup/error` calls its public capture function and nothing inside it. |
| II. Twin consoles | Pass | `setup` is a twin. `admin/slices/setup/sentry` and `app/slices/setup/sentry` are identical file for file, enforced by `scripts/sentry-twin.test.ts`. The two edits to `setup/error` (service and mapper) are made in both consoles in the same commit. The PR states both were changed. |
| III. Secrets stay behind `api/` | Pass, with a note | A console DSN is in `runtimeConfig.public` by necessity: the browser is what sends. It is an ingest address, not a credential — it cannot read anything. The API's DSN is in the API's secret. The one real credential, the source-map upload token, is a Docker build secret and never reaches a running console ([configuration](./contracts/configuration.md)). |
| IV. One entity, one store | N/A | No entity, no store, no fetch. |
| V. Console is a window, chat is the hands | N/A | No console capability is added, so there is no tool to add. |
| VI. English is the source | N/A | No user-visible string in either console. |
| VII. A rule stays a rule | Pass | Every decision is a table ([reporting rules](./contracts/reporting-rules.md)). No model call. |
| Generated code is generated | Pass | No DTO, no OpenAPI change, no SDK regeneration. |
| Surface marking is honest | Pass | CLEAN-218 is `[API][ADMIN][APP]`. |

**Quality Gate 4 — numbers that would be taken on trust**:

| Number | Value | Reason |
|--------|-------|--------|
| Server-failure threshold | 500 | main-site's rule; the HTTP boundary between "caller's fault" and "ours". |
| Rate limit | 20 events / 60 s / process | Above any real incident's distinct errors, far below a render loop ([R11](./research.md)). |
| SDK version | `^10.56.0` | Proven against this GlitchTip by main-site ([R4](./research.md)). |
| Added wait on the request path | 0 | Capture is fire-and-forget; checked in [quickstart](./quickstart.md) §6. |

**Post-design re-check**: unchanged. No violation, Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/029-error-tracking/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── configuration.md
│   └── reporting-rules.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/
├── main.ts                                  # CHANGE: init first, capture in the two process handlers, register the filter
└── slices/setup/
    ├── error/error-handling.interceptor.ts  # CHANGE: pass the original error as `cause`
    └── sentry/                              # NEW
        ├── sentry.rules.ts                  # the shared file
        ├── sentry.rules.spec.ts             # the one spec for the rules
        ├── sentry.config.ts                 # env → ReportingConfig
        ├── sentry.client.ts                 # owns the SDK: init (lazy require), capture, captureBackgroundError
        ├── sentry.filter.ts                 # global exception filter
        ├── sentry.filter.spec.ts
        └── index.ts

admin/slices/setup/                          # app/slices/setup/ is the same, file for file
├── error/
│   ├── domain/error.service.ts              # CHANGE: one capture call at the end, as in main-site
│   └── data/error.mapper.ts                 # CHANGE: no response → code ERR_NETWORK
└── sentry/                                  # NEW
    ├── nuxt.config.ts                       # alias #app-sentry, runtimeConfig.public.sentryDsn
    ├── sentry.rules.ts                      # the shared file
    ├── sentry.config.ts                     # runtimeConfig → ReportingConfig
    ├── sentry.client.ts                     # owns the SDK: init, capture, setUser, setScreen
    ├── sentry.client.test.ts
    ├── plugins/sentry.client.ts             # init, route → screen, signed-in user → id
    └── index.ts

admin/nuxt.config.ts, app/nuxt.config.ts     # CHANGE: project name; client source maps only when the upload token is present
admin/Dockerfile, app/Dockerfile             # CHANGE: optional upload step, then delete maps
.github/workflows/build-images.yaml          # CHANGE: pass the build secret and variables
k8s/deploy/40-admin.yaml                     # CHANGE: optional secretKeyRef for the DSN
k8s/platform/admin/deployment.yaml           # CHANGE: same
k8s/platform/app/deployment.yaml             # CHANGE: same
api/.env.example, admin/.env.example, app/.env.example   # CHANGE: names, empty values
scripts/sentry-twin.test.ts                  # NEW: three rules files identical; console slices identical
docs/operations/error-tracking.md            # NEW: what is reported, how to configure, how to verify
```

**Structure Decision**: The existing layout — `api/src/slices/<name>`,
`admin/slices/<name>`, `app/slices/<name>`. The feature is a new `sentry` slice
under `setup` in each, next to the `error` slice it attaches to. The slice name
and the console alias `#app-sentry` follow main-site.

## Design

### The rule set, once

`sentry.rules.ts` is pure: it imports types only and reads no global. It
exposes the functions in the [reporting rules contract](./contracts/reporting-rules.md).
It is written in the API's Prettier style, because the API lints it and the
consoles do not format; the three copies stay byte-identical and
`scripts/sentry-twin.test.ts` fails CI when they do not ([R1](./research.md)).

The rules are tested once, in the API's jest. The twin test is what makes that
one spec speak for all three copies.

### One gate

`createBeforeSend` is the only place an event is judged ([R5](./research.md)).
Manual captures pass the raw error; automatic captures arrive by themselves;
both meet the same decision, the same labels and the same scrubbing. In dev,
and without a DSN, the SDK is not initialised at all.

### API

- **Init**: `initSentry()` is the first statement of `main.ts`. It reads
  `ReportingConfig`; when enabled it `require`s `@sentry/bun` and initialises
  it with the options from the rules, minus the SDK's own
  `OnUncaughtException` and `OnUnhandledRejection` integrations, which would
  change how the process dies ([R3](./research.md), [R6](./research.md)).
- **Requests**: `SentryExceptionFilter` extends `BaseExceptionFilter`. It
  captures `exception.cause ?? exception` with `origin=request`, the operation
  as `METHOD route-pattern`, the user id from `req.user.sub` and `agentId` from
  the route parameters, then calls `super.catch`. The response is whatever it
  was before.
- **Outside requests**: one line in each of the two existing process handlers
  in `main.ts`, with `origin=background`. `captureBackgroundError(err, area)`
  for catch blocks that meet the rule in [R6](./research.md).
- **Known noise**: the Kubernetes watch timeout is ignored by rule
  ([R7](./research.md)).

### Consoles

- **Init**: the slice's client plugin initialises `@sentry/vue` when enabled.
  It does not pass `app` and does not install a Vue error handler: the existing
  `error.global.ts` handler stays the only one, and `handleError` reports.
- **Capture**: `handleError` in `setup/error` gains one call at its end,
  exactly where main-site has it. Nothing above it changes, so the toast, the
  redirect to sign-in and the dev logging are as they were (FR-025).
- **Context**: the plugin sets `screen` from the matched route pattern after
  each navigation, and the user id when the session changes, reading the auth
  slice through its public surface.
- **Environment errors**: `ErrorMapper` marks a request with no response as
  `ERR_NETWORK`; the rules drop it ([R9](./research.md)).

### Configuration and the fork

Names, sources and guarantees are in the
[configuration contract](./contracts/configuration.md). Real values go into one
new cluster secret by hand at rollout, `ranch-error-tracking`, with a key per
project. All five manifests reference their key as optional. The API counts as
deployed when it runs from a built image, not by `NODE_ENV`
([R10](./research.md)). The Mazda fork's gitops has
neither the reference nor the secret, so a catch-up merge changes nothing there
(SC-011).

### Readable traces

Last, and independent of the rest ([R12](./research.md)): with the upload token
present the console build emits hidden source maps, uploads them tagged with
`RANCH_VERSION`, and deletes them from the output. Without the token no maps
are built. The first task is to confirm the upload format against this
GlitchTip; the fallback is named.

## Delivery order

1. **Rules** — `sentry.rules.ts` and its spec in the API; copies in both
   consoles; the twin test. Nothing is wired yet. *Checkpoint comment.*
2. **API** (US1, US3, US4) — config, client, filter, `main.ts`, interceptor
   `cause`, background call sites. Quickstart §3, §5, §6. *Checkpoint comment.*
3. **Consoles** (US2, US3, US4) — slice, plugin, the two `setup/error` edits,
   in both consoles together. Quickstart §2, §4, §5. *Checkpoint comment.*
4. **Configuration** (US5) — manifests, `.env.example`, the operations doc.
   Quickstart §7.
5. **Readable traces** (US6) — verification spike, Dockerfiles, workflow.
   Quickstart §8.
6. **Rollout** — PR into `main`, merge when CI is green, watch
   `Release Platform`, add the three DSNs to the cluster secrets, quickstart §9.

Steps 1–4 are one PR. Step 5 can be the same PR or a second one on the same
ticket if the spike takes longer than the rest.

## Gates to run before the PR

```bash
cd api && bunx jest src/slices/setup && bun run build && bun run lint
bun run test:scripts
bunx turbo typecheck --filter=app --filter=admin
cd admin && bun test slices && cd ../app && bun test slices
bun run locale:check
```

`locale:check` is listed because the consoles change, not because copy does.
The PR names these commands and their results, and states the twin check in
words.

## Complexity Tracking

No violations.
