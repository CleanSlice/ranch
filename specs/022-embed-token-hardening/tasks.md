# Tasks: Embed chat tokens scoped to the chat, transcripts only for their owner

**Input**: Design documents from `specs/022-embed-token-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's quality gate requires passing tests
for every project touched, and research R6 names the specs to extend. Each
story's spec tasks come before its implementation tasks and must fail first.

**Organization**: Tasks are grouped by user story. All work is in `api/`;
paths below are relative to the repository root. No `admin/` or `app/` file
changes (twin-console check recorded in quickstart.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 credential by default, US2 embed token chat-only, US3 transcript owner, US4 subject validation

## Path Conventions

- API: `api/src/slices/<slice>/…`, colocated `*.spec.ts`
- Run specs with `cd api && npx jest <paths>` after `npx prisma generate`; never `bun run test` next to a running dev API
- Typecheck with `cd api && bun run build`

---

## Phase 1: Setup

**Purpose**: a worktree that can run the API specs.

- [ ] T001 Run `cd api && bun install && npx prisma generate`, then `npx jest src/slices/user/auth/guards src/slices/bridle/bridle.controller.spec.ts src/slices/bridle/domain/chatIdentity.spec.ts src/slices/agent/peer/guards/a2a.guards.spec.ts` and confirm green before any change (baseline; record failures that pre-exist)

---

## Phase 2: Foundational

**Purpose**: the one shared piece every story reads: the embed marker on the token payload.

- [ ] T002 Add `typ?: 'embed'` to `IAuthTokenPayload` and export `isEmbedToken(payload: unknown): boolean` (true only when `payload.typ === 'embed'`) in `api/src/slices/user/auth/domain/auth.types.ts`, with a doc comment saying the chat verifiers accept it and the platform verifiers refuse it

**Checkpoint**: typecheck passes (`cd api && bun run build`); nothing behaves differently yet.

---

## Phase 3: User Story 1 - Nobody reads platform data without a credential (Priority: P1) 🎯 MVP

**Goal**: every route needs a JWT unless it is on a reviewed, test-pinned list of public exceptions; routes that authenticate by their own key or token keep working.

**Independent Test**: with no credential, `/settings`, `/llms`, `/knowledges`, `/agents` answer 401 `TOKEN_MISSING`; `/health`, `/setup/status`, login, refresh and logout work; `POST /agents/:id/usage` with `x-bridle-api-key` and `POST /auth/embed/token` with an `rk_` key still pass their own guard; `publicRoutes.spec.ts` fails when a `@Public()` is added or removed without updating it.

### Tests for User Story 1

- [ ] T003 [US1] Create `api/src/slices/user/auth/guards/publicRoutes.spec.ts` in the fork's shape (recursive scan of `*.controller.ts` under `api/src`, count of lines matching `^[ \t]*@Public\(\)[ \t]*$`, `toEqual` against `EXPECTED_PUBLIC_ROUTES`, plus the "finds more than 30 controllers" guard). Fill `EXPECTED_PUBLIC_ROUTES` with the research R0 list and a one-line reason per entry. Run it: it must fail now (only 4 files carry `@Public()`)

### Implementation for User Story 1

- [ ] T004 [US1] Register `{ provide: APP_GUARD, useClass: JwtAuthGuard }` in the `providers` of `api/src/app.module.ts` with the fork's comment explaining deny-by-default and that `@Public()` drops only the JWT requirement
- [ ] T005 [P] [US1] Add `@Public()` to `login`, `register`, `refresh`, `logout` and `embed/token` in `api/src/slices/user/auth/auth.controller.ts` (`me` stays guarded)
- [ ] T006 [P] [US1] Add `@Public()` to `status` and `init` in `api/src/slices/setup/init/init.controller.ts` and to the single route in `api/src/slices/setup/health/health.controller.ts`
- [ ] T007 [P] [US1] Add `@Public()` to `import-state` and `download` in `api/src/slices/integration/integration.extension.controller.ts` and to `import-state` in `api/src/slices/browser/browser.extension.controller.ts` (the `token` routes stay behind `JwtAuthGuard`)
- [ ] T008 [P] [US1] Add class-level `@Public()` to `api/src/slices/integration/integration.internal.controller.ts` and `api/src/slices/browser/browser.internal.controller.ts` with a comment that `BridleApiKeyGuard` still authenticates every route
- [ ] T009 [P] [US1] Add `@Public()` to `POST agents/:agentId/usage` in `api/src/slices/usage/usage.controller.ts` (the GET routes stay JWT-only)
- [ ] T010 [P] [US1] Add class-level `@Public()` to `api/src/slices/bridle/bridle.controller.ts` with a comment that the controller resolves JWT, share and anonymous identities itself and that transcript access is decided per channel (US3)
- [ ] T011 [P] [US1] Add `@Public()` to `resolve` in `api/src/slices/agent/shareLink/share.controller.ts`
- [ ] T012 [P] [US1] Add `@Public()` to both routes in `api/src/slices/agent/peer/a2a.controller.ts` with a comment that the `ap_` credential rides in `Authorization: Bearer` and the global guard would otherwise reject it before `A2aCardGuard`/`A2aPeerGuard` run (not in the fork yet; note for the catch-up)
- [ ] T013 [P] [US1] Add `@Public()` to `start` and `status` in `api/src/slices/mcpServer/oauth/mcpOauth.controller.ts` with a comment that `BridleApiKeyGuard` reads `x-bridle-api-key` and no JWT is sent (not in the fork yet; note for the catch-up)
- [ ] T014 [US1] Run `cd api && npx jest src/slices/user/auth/guards/publicRoutes.spec.ts`; reconcile every mismatch by reading the controller, not by editing the number, until it passes with the reviewed list
- [ ] T015 [US1] Run the full API suite once (`cd api && npx jest`) and `bun run build`; fix any spec that constructed a controller expecting no global guard
- [ ] T016 [US1] Manual check per quickstart.md step 2 and 3 against a local API: anonymous 401 on settings/llms/knowledges/agents, health 200, usage without key refused by its own guard (not `TOKEN_MISSING`)

**Checkpoint**: commit as `fix(api): require a credential on every route by default, with a pinned public allowlist (CLEAN-175)`. The platform hole is closed on its own.

---

## Phase 4: User Story 2 - An embed token only opens the chat (Priority: P1)

**Goal**: an embed token is stamped `typ: 'embed'` and refused by every verifier that grants platform access; the chat surface keeps accepting it, admin embed tokens included.

**Independent Test**: mint an embed token; `/settings`, `/llms`, `/knowledges`, `/agents`, `/users`, `/api-keys` answer 401 `TOKEN_INVALID`; the WebSocket handshake, `POST /api/agent/:id/message`, attachment upload and the visitor's own transcript work; a console login still passes `GET /auth/me`; an admin embed token still lands in the `admin` chat but gets 401 on `/settings` and on the A2A card route.

### Tests for User Story 2

- [ ] T017 [P] [US2] In `api/src/slices/user/auth/guards/jwtAuth.guard.spec.ts` add: a verified payload with `typ: 'embed'` (roles `[]` and roles `['Owner']`) is refused with 401 `TOKEN_INVALID` and `req.user` stays unset; a payload without `typ` passes as before
- [ ] T018 [P] [US2] In `api/src/slices/user/auth/domain/auth.service.spec.ts` add a `mintEmbedToken` block: the signed payload carries `typ: 'embed'`, `sub`, `email`, `roles`; `Owner`/`Admin` stripped without `allowAdminRoles`; kept with it; TTL cap unchanged
- [ ] T019 [P] [US2] In `api/src/slices/agent/peer/guards/a2a.guards.spec.ts` add: `A2aCardGuard` refuses a verified Owner JWT that carries `typ: 'embed'`
- [ ] T020 [P] [US2] In `api/src/slices/bridle/domain/chatIdentity.spec.ts` add: `clientIdFromJwtPayload` maps `{ typ: 'embed', roles: ['Owner'] }` to `admin` and `{ typ: 'embed', sub: 'wslid-A1' }` to `wslid-A1` (the chat keeps accepting embed tokens)

### Implementation for User Story 2

- [ ] T021 [US2] In `mintEmbedToken` of `api/src/slices/user/auth/domain/auth.service.ts` add `typ: 'embed'` to the payload and extend the doc comment: chat-only credential, refused by `JwtAuthGuard` and `A2aCardGuard`
- [ ] T022 [US2] In `api/src/slices/user/auth/guards/jwtAuth.guard.ts` after a successful verify: if `isEmbedToken(payload)`, log `Rejected embed token outside chat sub=… METHOD url` (never the token) and throw `unauthorized(AuthErrorCodes.TokenInvalid)`; update the class doc comment
- [ ] T023 [US2] In `A2aCardGuard` of `api/src/slices/agent/peer/guards/a2a.guards.ts` refuse a payload where `isEmbedToken(payload)` with the existing `refuse('Not allowed to read this card')`, with a one-line comment
- [ ] T024 [US2] Run `cd api && npx jest src/slices/user/auth src/slices/agent/peer/guards src/slices/bridle/domain/chatIdentity.spec.ts` and `bun run build`
- [ ] T025 [US2] Manual check per quickstart.md step 2 with a minted token (embed column all 401) and a widget session on a public agent (chat works, own history loads)

**Checkpoint**: commit as `fix(auth): embed tokens open only the chat (CLEAN-175)`.

---

## Phase 5: User Story 4 - A minted identity is well-formed (Priority: P3, done before US3 on purpose)

**Goal**: `POST /auth/embed/token` refuses a `sub` that is empty, too long, path-like, a reserved channel name or an existing user id. Ordered before US3 so the ownership rule never meets a subject it was not designed for.

**Independent Test**: `admin`, `../x`, `anon-1`, `share-x`, `http-y`, `agent:x`, an empty value and a 129-char value answer 400 naming `sub`; a `sub` equal to an existing user's id answers 400 `sub must not be an existing user id`; `wslid-A1234567` answers 200.

### Tests for User Story 4

- [ ] T026 [P] [US4] Create `api/src/slices/user/auth/dtos/embedToken.dto.spec.ts` using `class-validator`'s `validate` on a plain `EmbedTokenDto`: the eight rejected values above fail on `sub`; `wslid-A1234567`, `user_42` and a 128-char value pass
- [ ] T027 [P] [US4] In `api/src/slices/user/auth/domain/auth.service.spec.ts` add: `mintEmbedToken` throws `BadRequestException` with message `sub must not be an existing user id` when the Prisma stub returns a user for that id, and signs normally when it returns null

### Implementation for User Story 4

- [ ] T028 [US4] In `api/src/slices/user/auth/dtos/embedToken.dto.ts` replace `@MinLength(1)` on `sub` with `@MaxLength(128)` and `@Matches(/^(?!admin$)(?!anon-)(?!share-)(?!http-)[A-Za-z0-9_-]{1,128}$/, { message: 'sub: letters, digits, dash and underscore only, 1-128 characters, not admin and not prefixed anon-, share- or http-' })`; update the `@ApiProperty` description and example (`wslid-A1234567`)
- [ ] T029 [US4] In `mintEmbedToken` of `api/src/slices/user/auth/domain/auth.service.ts` look up `this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true } })` and throw `BadRequestException('sub must not be an existing user id')` when found, with a comment that console users' chat channels are their user ids
- [ ] T030 [US4] Run `cd api && npx jest src/slices/user/auth` and `bun run build`; regenerate `api/swagger-spec.json` through the build and confirm only the `sub` pattern and max length changed in the DTO schema (no console SDK regen needed; if `git status` shows generated console files, revert them)
- [ ] T031 [US4] Manual check per quickstart.md step 5 (six 400s) plus one mint with a real user id from the local database (400)

**Checkpoint**: commit as `fix(auth): validate the embed token subject (CLEAN-175)`.

---

## Phase 6: User Story 3 - A conversation belongs to its owner (Priority: P2)

**Goal**: transcript read, delete and archive on a JWT-named channel are allowed only to the JWT whose chat identity equals the channel, or to an admin; `share-`, `anon-` and `http-` channels keep today's rules; the refusal is a uniform 403.

**Independent Test**: with a token for `wslid-A1234567`: GET/DELETE/archive on `channel=wslid-A1234567` succeed; on `channel=wslid-B9999999` 403 `CHANNEL_FORBIDDEN`; with no credential 403 on both, identical for a channel that has no file; an Owner JWT reads any channel; a share visitor is unchanged; `anon-x` is unchanged.

### Tests for User Story 3

- [ ] T032 [US3] In `api/src/slices/bridle/bridle.controller.spec.ts` add a `describe('BridleController — transcripts on a jwt channel')` block, reusing the existing request/controller helpers: owner token on own channel 200 for `transcript`, `deleteTranscript` and `archiveTranscript`; foreign token 403 `CHANNEL_FORBIDDEN`; no credential 403; a channel with no file and no credential 403 (and `fileCalls` empty, proving the check runs before the read); admin token on a `wslid-…` channel 200; `anon-x` with no credential 200; the existing share block still green

### Implementation for User Story 3

- [ ] T033 [US3] Add `ChannelForbidden = 'CHANNEL_FORBIDDEN'` to the bridle error codes (next to the share codes the controller already throws, in `api/src/slices/bridle/domain/` or the shareLink codes file the controller imports; pick the one `requireChannelAccess` already uses and keep it exported)
- [ ] T034 [US3] Rewrite `requireChannelAccess` in `api/src/slices/bridle/bridle.controller.ts`: keep the `share-` branch verbatim; return early for `anon-` and `http-` prefixes with a comment citing specs/010 R8 and FR-007; otherwise `resolveRequester` and allow `kind === 'jwt' && (clientId === channel || clientId === 'admin')`; else `throw new ForbiddenException({ code: ChannelForbidden })`. Update the doc comment above it and the three `@ApiOperation` descriptions (GET at ~775, DELETE at ~885, archive at ~950) to say a JWT-named channel is owner-or-admin only
- [ ] T035 [US3] Run `cd api && npx jest src/slices/bridle` and `bun run build`
- [ ] T036 [US3] Manual check per quickstart.md step 4, then the admin console (chat transcript, reset, Chats list, a visitor conversation) and the app console (reload keeps history, "New chat" archives) as logged-in users; then the Augeo demo in ranch mode: history survives reload, "New chat" works

**Checkpoint**: commit as `fix(bridle): transcript read, delete and archive only for the channel owner or an admin (CLEAN-175)`.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T037 [P] Update `api/src/slices/user/auth/guards/public.decorator.ts` doc comment: it is now the only way out of the global guard and the allowlist test pins every use
- [ ] T038 [P] Add a short "Authentication surface" note to `README.md` (or the API section of it): credential required by default, `@Public()` + `publicRoutes.spec.ts`, embed tokens are chat-only, transcript ownership rule; link CLEAN-175
- [ ] T039 Re-run the full gate: `cd api && npx jest` and `bun run build`; `git status` clean of generated console files
- [ ] T040 Open the PR into `main` titled `fix(api): embed tokens open only the chat, credential required by default, transcripts for their owner (CLEAN-175)`; body lists the commands run, the twin-console statement from quickstart.md, the two fork follow-ups (A2A and OAuth `start`/`status` exemptions), and links CLEAN-141 and CLEAN-176; put the PR URL on CLEAN-175 and move it to In Review
- [ ] T041 After deploy to dev-mazda through the fork catch-up: run the handoff's section 8 script (R1, R3, R5 parts) and record the result on CLEAN-175; then revoke the demo `embed:mint` key and mint a new one for the demo

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (US1). US1 is the MVP and ships on its own.
- Phase 4 (US2) depends on Phase 2 (the `typ` claim) and on T010 (the chat controller is `@Public()`, which is what makes "no `@EmbedAllowed()` needed" true).
- Phase 5 (US4) depends only on Phase 2; it is placed before US3 by plan decision.
- Phase 6 (US3) depends on T010 (class-level `@Public()`) and benefits from US4; it does not depend on US2.
- Phase 7 after all stories.

Story graph: US1 → US2; US1 → US3; US4 independent after Phase 2.

## Parallel Opportunities

- Phase 3: T005–T013 touch ten different files and can be done in parallel after T004; T003 can be written before T004.
- Phase 4: T017–T020 are four different spec files, parallel; then T021–T023 are three different files, parallel.
- Phase 5: T026 and T027 parallel; T028 and T029 parallel.
- Phase 7: T037 and T038 parallel.

## Implementation Strategy

1. **MVP = Phase 1–3**: one commit that closes the production hole and pins the surface. Reviewable and deployable alone; the fork catch-up for this part is a near no-op.
2. Then US2 (embed chat-only) and US4 (subject rules), each its own commit.
3. Then US3 (ownership), its own commit.
4. One PR with four commits in that order, so a reviewer can read the guard change without the chat change on top.

## Format validation

All 41 tasks start with `- [ ]`, carry a sequential `T0nn` id, carry a `[USn]` label in the story phases only, mark `[P]` only where files differ and nothing in the same phase is a prerequisite, and name at least one file path or command.
