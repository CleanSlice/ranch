---

description: "Task list for error tracking in api, admin and app"
---

# Tasks: Error Tracking for API, Admin and App

**Input**: Design documents from `/specs/029-error-tracking/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Ticket**: [CLEAN-218](https://dreamvention.atlassian.net/browse/CLEAN-218) — branch `feat/CLEAN-218-error-tracking`

**Tests**: Included where the design depends on them: the rules spec and the twin test are how FR-005 and FR-006 are met, not an extra.

**Organization**: Grouped by user story. The rules file serves every story, so it is Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to
- Paths are relative to the repository root

## Rules that hold for every task

- `sentry.rules.ts` exists in three places and is byte-identical. Edit it in `api/src/slices/setup/sentry/`, then copy it to both consoles in the same commit.
- `admin/slices/setup/sentry/` and `app/slices/setup/sentry/` are identical file for file. Write in `admin`, copy to `app`.
- Never run Prettier or ESLint over `admin/` or `app/`. The API is linted: `cd api && bun run lint`.
- No real DSN, token or slug in any file, commit, PR or ticket comment.
- Run jest directly (`cd api && bunx jest <path>`), not `bun run test`, while a dev API is running.

---

## Phase 1: Setup

**Purpose**: Dependencies and empty slices.

- [X] T001 Add `@sentry/bun@^10.56.0` to `dependencies` in `api/package.json`
- [X] T002 [P] Add `@sentry/vue@^10.56.0` to `dependencies` in `admin/package.json` and in `app/package.json`
- [X] T003 Run `bun install` at the repository root and confirm `bun.lock` resolves a single `@sentry/core` 10.x for all three projects
- [X] T004 [P] Create `admin/slices/setup/sentry/nuxt.config.ts`: alias `#app-sentry` to the slice directory and `runtimeConfig.public.sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN ?? ''`; copy the file unchanged to `app/slices/setup/sentry/nuxt.config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one rule set, its spec, its two copies and the guard that keeps them equal.

**⚠️ CRITICAL**: No user story starts before this phase is complete.

- [X] T005 Write `api/src/slices/setup/sentry/sentry.rules.spec.ts` (jest), table-driven from [contracts/reporting-rules.md](./contracts/reporting-rules.md): `resolveDsn` (empty, whitespace, `example.com`, valid); the seven `decide` rows in order, asserting `report` and `reason`; tags and extra for a known 5xx; every key in the scrub list filtered in headers, extra and nested contexts; `request.data` and `request.cookies` deleted; query parameters filtered with the rest of the URL kept; `user` reduced to `{ id }`; `scrubBreadcrumb` drops category `console`; `createBeforeSend` drops the 21st event inside 60 s using an injected clock and returns `null` when scrubbing throws. Run it and see it fail.
- [X] T006 Implement `api/src/slices/setup/sentry/sentry.rules.ts` to the contract: `resolveDsn`, `decide`, `scrubEvent`, `scrubBreadcrumb`, `createBeforeSend`, `buildInitOptions`, and the `ReportingConfig` and `Decision` types from [data-model.md](./data-model.md). Import types only (`import type` from `@sentry/core`). Read no global: no `process`, no `window`, no SDK call. Constants `SERVER_FAILURE_STATUS = 500` and `MAX_EVENTS_PER_MINUTE = 20` each carry a one-line comment with the reason from [research.md](./research.md) R11 and plan Quality Gate 4. Make T005 pass.
- [X] T007 Run `cd api && bun run lint` so the file is in the API's Prettier style, then copy `api/src/slices/setup/sentry/sentry.rules.ts` byte for byte to `admin/slices/setup/sentry/sentry.rules.ts` and `app/slices/setup/sentry/sentry.rules.ts`
- [X] T008 Write `scripts/sentry-twin.test.ts` (bun test, modelled on `scripts/chat-md-twin.test.ts`): the three `sentry.rules.ts` files are byte-identical; every file under `admin/slices/setup/sentry/` has a byte-identical counterpart under `app/slices/setup/sentry/` and the reverse; `sentry.rules.ts` contains no `process.`, `window.` or non-type import. Run `bun run test:scripts`.

**Checkpoint**: Rules exist and are tested, nothing is wired. Post a checkpoint comment on CLEAN-218.

---

## Phase 3: User Story 1 - A failure in the API reaches the team (Priority: P1) 🎯 MVP

**Goal**: Unexpected API failures, inside a request and outside one, arrive in the Ranch Api project with operation, release and installation.

**Independent Test**: [quickstart.md](./quickstart.md) §3 — production-mode API with a scratch DSN; one forced request failure and one forced background failure both arrive; a 401 and a 400 do not.

- [X] T009 [P] [US1] Create `api/src/slices/setup/sentry/sentry.config.ts`: `readReportingConfig(env = process.env): ReportingConfig` with `project: 'api'`, `dsn` through `resolveDsn(env.SENTRY_DSN)`, `installation` from `SENTRY_INSTALLATION`, else the hostname of `PUBLIC_API_URL`, else `'unknown'`, `release` from `RANCH_VERSION ?? '0.0.0'`, `production: env.NODE_ENV === 'production'`
- [X] T010 [US1] Create `api/src/slices/setup/sentry/sentry.client.ts`: `initSentry()` returns at once unless the config is production with a DSN; otherwise `require('@sentry/bun')` inside the function and `init` with `buildInitOptions(config)` and an `integrations` function that removes the SDK's `OnUncaughtException` and `OnUnhandledRejection` integrations ([research.md](./research.md) R6). Export `captureRequestError(err, { operation, userId, agentId })`, `captureProcessError(err, kind)` and `captureBackgroundError(err, area)`; each is a no-op before init, sets the labels from [data-model.md](./data-model.md) on a scope, never awaits and never throws.
- [X] T011 [P] [US1] Change `api/src/slices/setup/error/error-handling.interceptor.ts`: when wrapping a non-`HttpException` as a 500, pass `{ cause: error }` as the third `HttpException` argument. The response body and status stay exactly as they are.
- [X] T012 [US1] Write `api/src/slices/setup/sentry/sentry.filter.spec.ts` with `sentry.client` mocked: a 404 `HttpException` is delegated and not captured; a 500 with a `cause` captures the cause; a plain `Error` is captured; `operation` is `METHOD` plus the route pattern, not the raw URL; `userId` comes from `req.user.sub`; `agentId` from `req.params.agentId`; a throw inside capture still reaches `super.catch`.
- [X] T013 [US1] Implement `api/src/slices/setup/sentry/sentry.filter.ts`: `@Catch() SentryExceptionFilter extends BaseExceptionFilter`; in `catch`, skip non-HTTP hosts, call `captureRequestError(exception.cause ?? exception, …)` inside a `try`, then always `super.catch(exception, host)`. Make T012 pass.
- [X] T014 [P] [US1] Create `api/src/slices/setup/sentry/index.ts` exporting `initSentry`, `captureBackgroundError`, `captureProcessError` and `SentryExceptionFilter`
- [X] T015 [US1] Change `api/src/main.ts`: call `initSentry()` as the first statement after the imports; add `captureProcessError(reason, 'unhandledRejection')` and `captureProcessError(err, 'uncaughtException')` beside the existing `console.error` lines, leaving those lines as they are; register `app.useGlobalFilters(new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter))` before the interceptors
- [X] T016 [US1] Add `captureBackgroundError(err, '<area>')` next to the existing `logger.error` in each catch that meets the rule in [research.md](./research.md) R6 — logs and continues, in code not reached from an HTTP handler's call stack. Certain by their own message: `api/src/slices/chat/domain/chatInsight.service.ts:62`, `api/src/slices/reins/knowledge/domain/indexReconcile.service.ts:103`, `api/src/slices/reins/extraction/domain/textExtraction.service.ts:169`, `api/src/slices/reins/migration/domain/migration.service.ts:91`. Read the call chain and apply the rule to: `chat/domain/chatSync.service.ts:42`, `chat/domain/chatInsight.service.ts:116`, `reins/knowledge/domain/indexReconcile.service.ts:196,232`, `reins/knowledge/domain/knowledge.service.ts:393,938`, `reins/extraction/domain/textExtraction.service.ts:149`, `reins/migration/domain/migration.service.ts:73`, `mcp/services/sse-ping.service.ts:171`, `agent/agent/domain/agentDeploy.service.ts:165,224`. Leave request-path sites alone: the filter has them. List in the PR which sites were wired and which were left, with the reason.
- [X] T017 [P] [US1] Add `SENTRY_DSN=` and `SENTRY_INSTALLATION=` with one comment line each (empty turns reporting off; production only) to `api/.env.example`
- [X] T018 [US1] Run `cd api && bunx jest src/slices/setup && bun run build && bun run lint`, then [quickstart.md](./quickstart.md) §3 and §6 against a scratch GlitchTip project. Confirm the API starts and serves under Bun with the SDK loaded.

**Checkpoint**: The API reports. Post a checkpoint comment on CLEAN-218.

---

## Phase 4: User Story 2 - A failure in either console reaches the team (Priority: P1)

**Goal**: Unexpected failures in admin and app screens arrive in their own project, decided by the same rules.

**Independent Test**: [quickstart.md](./quickstart.md) §4 — production build of each console with a scratch DSN; a component error and an API 500 arrive in that console's project; an expired session and a 400 do not.

- [X] T019 [P] [US2] Add `sentryProject: 'admin'` to `runtimeConfig.public` in `admin/nuxt.config.ts` and `sentryProject: 'app'` in `app/nuxt.config.ts`
- [X] T020 [P] [US2] Create `admin/slices/setup/sentry/sentry.config.ts`: `readReportingConfig(pub, hostname, dev): ReportingConfig` — pure, takes its inputs as arguments; `project` from `pub.sentryProject`, `dsn` through `resolveDsn(pub.sentryDsn)`, `installation` from `hostname || 'unknown'`, `release` from `pub.ranchVersion`, `production: !dev`
- [X] T021 [US2] Create `admin/slices/setup/sentry/sentry.client.ts`: `initSentry(config)` does nothing unless production with a DSN, otherwise `Sentry.init(buildInitOptions(config))` from `@sentry/vue` without passing `app`, so no Vue error handler is installed ([plan.md](./plan.md) Consoles). Export `captureSentryException(err)`, `setSentryUser(id | null)` and `setSentryScreen(pattern)`; each is a no-op before init and never throws.
- [X] T022 [P] [US2] Create `admin/slices/setup/sentry/sentry.client.test.ts` (bun test, `toBe`/`toEqual` only): `readReportingConfig` in dev, without a DSN, with a placeholder DSN and enabled; the capture functions are no-ops and do not throw before init
- [X] T023 [US2] Create `admin/slices/setup/sentry/plugins/sentry.client.ts`: build the config from `useRuntimeConfig().public`, `window.location.hostname` and `import.meta.dev`; call `initSentry`; in `router.afterEach` call `setSentryScreen` with the matched route pattern (`to.matched.at(-1)?.path`), never the resolved path
- [X] T024 [P] [US2] Create `admin/slices/setup/sentry/index.ts` exporting `captureSentryException`, `setSentryUser`, `setSentryScreen`
- [X] T025 [US2] Copy every file created in T020–T024 unchanged into `app/slices/setup/sentry/` and run `bun run test:scripts`
- [X] T026 [US2] Change `admin/slices/setup/error/domain/error.service.ts` and `app/slices/setup/error/domain/error.service.ts` identically: import `captureSentryException` from `#app-sentry` and call it as the last statement of `handleError`, after the dev logging, where main-site has it. Change nothing above it; the early returns for geo-block, maintenance and the 401 redirect stay.
- [X] T027 [US2] Run `bunx turbo typecheck --filter=app --filter=admin`, `cd admin && bun test slices/setup`, `cd app && bun test slices/setup`, then [quickstart.md](./quickstart.md) §4 for both consoles, which also proves the runtime variable reaches an `ssr: false` build ([research.md](./research.md) R13)

**Checkpoint**: Both consoles report. Post a checkpoint comment on CLEAN-218.

---

## Phase 5: User Story 3 - Nothing private leaves the product (Priority: P1)

**Goal**: No token, password, key, email, chat text or file content in any event.

**Independent Test**: [quickstart.md](./quickstart.md) §5 — force failures through sign-in, chat, file upload and credential paths; every event's JSON is clean.

- [X] T028 [US3] Extend `api/src/slices/setup/sentry/sentry.rules.spec.ts` with Ranch-shaped events: a request event whose body is a chat message; one with a `ranch_session` cookie and an `Authorization: Bearer` header; one whose `extra` holds a provider credential under `apiKey`; a share URL with `?token=`. Assert each comes out clean. Fix `sentry.rules.ts` if any fails, and re-copy to both consoles.
- [X] T029 [P] [US3] In `api/src/slices/setup/sentry/sentry.client.ts`, pass only `{ id }` to the scope's user, and confirm `captureRequestError` attaches no request object, body or headers of its own
- [X] T030 [US3] In `admin/slices/setup/sentry/plugins/sentry.client.ts`, watch `useAuthStore().user` (from `#auth`) and call `setSentryUser(user?.id ?? null)` on change, so the id is cleared on sign-out; copy the file unchanged to `app/slices/setup/sentry/plugins/sentry.client.ts`
- [ ] T031 [US3] Run [quickstart.md](./quickstart.md) §5 for the API and one console and read the raw JSON of each event. Record in the PR what was forced and that each event was clean.

**Checkpoint**: Stories 1–3 together are the shippable minimum.

---

## Phase 6: User Story 4 - The feed contains only what someone should act on (Priority: P2)

**Goal**: Expected errors, dev sessions and the user's own network never produce an event.

**Independent Test**: [quickstart.md](./quickstart.md) §2 and the "no event" rows of §3 and §4 — a scripted run of every expected error yields zero events, then one server failure yields exactly one.

- [X] T032 [US4] Change `ErrorMapper.toErrorEntity` in `admin/slices/setup/error/data/error.mapper.ts` and `app/slices/setup/error/data/error.mapper.ts` identically: when the failed request has no `response` and no `statusCode`, return an `ErrorEntity` with `code: ErrorCodes.ERR_NETWORK`, or `'ERR_CANCELED'` when the source error's `code` is `ERR_CANCELED`, keeping `isToast` and the message as today ([research.md](./research.md) R9). The two files differ today only in one comment word; keep it that way.
- [X] T033 [P] [US4] Add `admin/slices/setup/error/data/error.mapper.test.ts` (bun test): no response → `ERR_NETWORK`; a cancelled request → `ERR_CANCELED`; a 500 response is unchanged; copy to `app/slices/setup/error/data/error.mapper.test.ts`
- [X] T034 [P] [US4] Confirm in `api/src/slices/setup/sentry/sentry.rules.spec.ts` that a `DOMException` named `TimeoutError` is dropped for project `api` and reported for `admin`, and that a failed dynamic import is dropped; add the cases if T005 did not cover them
- [X] T035 [US4] Run [quickstart.md](./quickstart.md) §2 with a DSN set in dev for all three projects and confirm no request to the tracker host; then the expected-error rows of §3 and §4

---

## Phase 7: User Story 5 - Only the Ranch production reports (Priority: P2)

**Goal**: Destinations live in cluster secrets; a build that sets nothing, the Mazda fork included, sends nothing.

**Independent Test**: [quickstart.md](./quickstart.md) §7 — no DSN set: clean start, zero requests to any tracker.

- [X] T036 [P] [US5] Add to the console container `env` in `k8s/deploy/40-admin.yaml` and `k8s/platform/admin/deployment.yaml`: `NUXT_PUBLIC_SENTRY_DSN` with `valueFrom.secretKeyRef` `name: ranch-console-env`, `key: ADMIN_SENTRY_DSN`, `optional: true`
- [X] T037 [P] [US5] Add the same to `k8s/platform/app/deployment.yaml` with `key: APP_SENTRY_DSN`
- [X] T038 [P] [US5] Add `NUXT_PUBLIC_SENTRY_DSN=` with a one-line comment to `admin/.env.example` and `app/.env.example`
- [X] T039 [US5] Extend `scripts/sentry-twin.test.ts`: no tracked file contains a real DSN — a 32-hex key followed by `@` and a host — outside `node_modules`; the only allowed match is a placeholder on `example.com` (SC-009)
- [X] T040 [US5] Write `docs/operations/error-tracking.md`: what is and is not reported (link the rules contract), the variables and where their values live (from [contracts/configuration.md](./contracts/configuration.md)), how to create `ranch-console-env` and add `SENTRY_DSN` to `ranch-api-env`, how to verify, that no dev or stage exists, and that the Mazda fork stays off because its gitops has neither the secret nor the reference
- [X] T041 [US5] Run [quickstart.md](./quickstart.md) §7 for all three projects

---

## Phase 8: User Story 6 - A console stack trace points at the real source (Priority: P3)

**Goal**: Console events from a released build resolve to source files and lines; a build without the token still works.

**Independent Test**: [quickstart.md](./quickstart.md) §8.

- [ ] T042 [US6] Spike, before anything else in this phase: build `admin` locally with `sourcemap: { client: 'hidden' }`, run a pinned `@sentry/cli` `sourcemaps inject` and `sourcemaps upload` against a scratch project on the team's GlitchTip, force an error, and check the trace resolves ([research.md](./research.md) R12). Record the CLI version and the result in `specs/029-error-tracking/research.md` under R12. If it does not resolve, switch T044 to GlitchTip's official CLI binary pinned by checksum and note that there.
- [ ] T043 [P] [US6] In `admin/nuxt.config.ts` and `app/nuxt.config.ts`, set `sourcemap.client` to `'hidden'` when `process.env.SENTRY_UPLOAD === '1'` and to `false` otherwise
- [ ] T044 [US6] In the builder stage of `admin/Dockerfile` and `app/Dockerfile`: accept `ARG GLITCHTIP_URL`, `ARG GLITCHTIP_ORG`, `ARG GLITCHTIP_PROJECT`; replace the build `RUN` with one that mounts `--mount=type=secret,id=glitchtip_token`, sets `SENTRY_UPLOAD=1` only when the secret file is non-empty, builds, and in that case injects and uploads `.output/public` with release `RANCH_VERSION`, then deletes every `*.map` under `.output`. The token is never an `ARG` or `ENV`.
- [ ] T045 [US6] In `.github/workflows/build-images.yaml`, for the admin and app build steps: pass `secrets: glitchtip_token=${{ secrets.GLITCHTIP_AUTH_TOKEN }}` and build args from `vars.GLITCHTIP_URL`, `vars.GLITCHTIP_ORG`, `vars.GLITCHTIP_PROJECT_ADMIN` / `vars.GLITCHTIP_PROJECT_APP`; document the secret and variables in the header comment beside `GHCR_PAT` and `API_URL`
- [ ] T046 [US6] Run [quickstart.md](./quickstart.md) §8: a build with the secret resolves traces and ships no `.map`; a build without it succeeds. Add the source-map section to `docs/operations/error-tracking.md`.

---

## Phase 9: Polish & Rollout

- [X] T047 Run every gate in [plan.md](./plan.md) "Gates to run before the PR" and keep the output for the PR body
- [X] T048 [P] Add one paragraph to `CLAUDE.md` and the matching line to `.specify/memory/constitution.md` only if a rule changed — expected outcome: the twin-consoles paragraph gains "`setup/sentry` is identical in both consoles and `sentry.rules.ts` in all three projects; `scripts/sentry-twin.test.ts` enforces it". If nothing else changed, the constitution needs no edit; say so in the PR.
- [ ] T049 Commit with Conventional Commits and the ticket id, one commit per checkpoint (`feat(api): …`, `feat(admin,app): …`, `chore(k8s): …`, `ci: …`, `docs: …`, each ending `(CLEAN-218)`); push over HTTPS; open a PR into `main` that links CLEAN-218, names the gates and their results, states the twin check in words, and lists the background sites from T016. Put the PR URL on the ticket and move it to review.
- [ ] T050 When CI is green, merge as the DREAM account (`gh api user` first, then `gh pr merge <n> --merge`), watch the `Release Platform` run for that push and report its conclusion
- [ ] T051 Rollout, with the user, since it needs cluster access and the real DSNs: add `SENTRY_DSN` to `ranch-api-env`, create `ranch-console-env` with `ADMIN_SENTRY_DSN` and `APP_SENTRY_DSN`, restart the three deployments, run [quickstart.md](./quickstart.md) §9, comment the result on CLEAN-218 and move it to Done

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → everything else.
- **US1 (3)** and **US2 (4)** are independent of each other after Phase 2.
- **US3 (5)** needs US1 and US2: it tightens and verifies their adapters.
- **US4 (6)** needs US2 for the mapper's effect to be observable; T034 needs only Phase 2.
- **US5 (7)** needs US1 and US2 to have something to configure; T036–T038 can be written any time after Phase 2.
- **US6 (8)** needs US2. It blocks nothing and may ship in a second PR on the same ticket.
- **Polish (9)** last. T051 needs the release from T050.

### Within a story

- A spec task comes before the implementation it pins (T005 → T006, T012 → T013).
- Anything written in `admin/slices/setup/sentry/` is copied to `app` before the story's verification task.
- A change to `sentry.rules.ts` is copied to both consoles in the same commit, or T008 fails.

### Parallel opportunities

- T001 and T002; T004 alongside them.
- After Phase 2: US1 (T009–T018) and US2 (T019–T027) by two people, since they share no file.
- Inside US1: T009, T011, T014, T017 touch different files.
- Inside US2: T019, T020, T022, T024.
- Inside US5: T036, T037, T038.

## Parallel example: after Phase 2

```text
Stream A (api):      T009 → T010 → T012 → T013 → T015 → T016 → T018
Stream B (consoles): T019, T020 → T021 → T023 → T025 → T026 → T027
```

## Implementation Strategy

### MVP

Phases 1–5: the API and both consoles report, and nothing private leaves. US3
is P1 for a reason — do not deploy Stories 1 and 2 without it.

### Incremental delivery

1. Phases 1–2: rules and guard. Nothing user-visible, safe to merge alone.
2. Phase 3: API reporting, verifiable against a scratch project.
3. Phases 4–5: consoles and the privacy pass.
4. Phases 6–7: noise rules and configuration. With these the first PR is complete.
5. Phase 8: readable traces, same PR or a second one.
6. Phase 9: merge, release, real DSNs, production check.

Until T051 nothing reports anywhere: the code ships switched off.

## Notes

- 51 tasks: Setup 4, Foundational 4, US1 10, US2 9, US3 4, US4 4, US5 6, US6 5, Polish 5.
- Checkpoint comments on CLEAN-218 after Phases 2, 3, 4 and at the end.
- The line numbers in T016 are from `main` at the time of writing; find the `logger.error` by its message if they have moved.

## Implementation status (2026-11-11)

42 of 51 done. Open: T031, T042–T046 (User Story 6), T049–T051.

**What changed against the tasks as written**

- **T009 / configuration.** The API's "deployed" gate is `RANCH_VERSION` set
  and not `dev`, not `NODE_ENV === 'production'`: the live manifest runs the
  production API with `NODE_ENV: "dev"` ([research.md](./research.md) R10).
- **T036–T037.** One secret, `ranch-error-tracking`, with a key per project,
  referenced as optional from all five manifests — including the two API
  ones, which the tasks did not list.
- **T016.** The rule was widened to "logs at error level and carries on, so
  the error reaches neither a caller nor the filter". Twelve sites wired; the
  ones left, and why, are in [research.md](./research.md) R6.
- **T006.** The rules file imports nothing at all, not even types.
- **T021.** The console loads the SDK with a dynamic import, only when
  reporting is on, and keeps up to ten errors caught while it loads.
- **T043.** Reverted: the conditional source-map setting is dead config until
  the Dockerfile step exists, so it waits for User Story 6.

**How the verification tasks were run**

The team's GlitchTip was not touched; a local HTTP server stood in for it
([research.md](./research.md) R14).

- **T018** — jest, build and lint on the real code. Quickstart §3 and §6 at
  the adapter under Bun with `NODE_ENV=dev`, not on a booted API: that needs a
  database, which this machine does not run.
- **T027, T035, T041** — `admin` in a real browser: production build with a
  DSN (events arrive), production build without one (nothing sent, SDK not
  downloaded), `nuxt dev` with one (nothing sent, SDK not downloaded). `app`
  was not opened in a browser; its slice is byte-identical and its typecheck
  and tests pass.
- **T031 is open.** The scrubbing is covered by the rules spec on
  Ranch-shaped events, and the events seen above carried no body, no cookie
  and a filtered token. Forcing real failures through sign-in, chat, file
  upload and credential paths, and reading the raw JSON, needs a running
  Ranch. Do it at rollout, on the first events, before leaving reporting on.
- **Full gates**: API jest 176 suites / 2498 tests; console tests 280 and
  233; script tests 99; typecheck clean for both consoles; `locale:check` and
  `i18n:check` clean.

**User Story 6** needs an upload token for the tracker and its organisation
and project slugs, none of which this work had.
