# Research: CLEAN-175 embed token hardening

All findings re-verified on 2026-10-26 against upstream `main` (b54c7e7a), the
Mazda fork (`E:/code/coso/mazda-ai-ranch`, `fix/CLEAN-173-bun-lockfile-frozen`
= b0a2cb69, which carries the global guard) and the Bridle SDK clone
(`E:/code/dream/cleanslice/bridle`, v0.13.3).

## R0. Credential required by default

- **Decision**: register `JwtAuthGuard` as a global `APP_GUARD` in
  `api/src/app.module.ts`, exactly as the fork does (fork commit 950e743c),
  and add `api/src/slices/user/auth/guards/publicRoutes.spec.ts` that counts
  `@Public()` decorators per controller file and compares with a reviewed
  allowlist. Every route that authenticates by something other than a user JWT
  (`ApiKeyGuard`, `BridleApiKeyGuard`, `A2aCardGuard`, `A2aPeerGuard`, an
  extension token verified by hand, a share token in the body, a signed open
  link) gets `@Public()` so the JWT requirement steps aside and its own guard
  keeps authenticating.
- **Rationale**: 18 of 43 upstream controllers attach no guard; prod answers
  `GET /settings` with vendor keys to an anonymous request. The fork's shape is
  proven for two months and CLEAN-164 already documents the rule "`@Public()`
  drops only the JWT requirement". Copying the shape keeps the next catch-up
  merge a no-op (FR-009).
- **Upstream additions the fork is missing** (report back to the fork as a
  follow-up, they are CLEAN-164-class regressions there):
  - `agent/peer/a2a.controller.ts` (2 routes): the `ap_` peer credential
    travels in `Authorization: Bearer`, so the global guard rejects it as a bad
    JWT before `A2aPeerGuard`/`A2aCardGuard` run. Both routes get `@Public()`.
  - `mcpServer/oauth/mcpOauth.controller.ts` `start` and `status`: guarded by
    `BridleApiKeyGuard` (`x-bridle-api-key`), no JWT in the call. Both get
    `@Public()`; the fork only exempted `callback`.
- **Expected allowlist (upstream)**: `agent/agent/agent.controller.ts` 5 (already),
  `agent/event/agentEvent.ingest.controller.ts` 1 (already),
  `agent/file/file.controller.ts` 1 (already),
  `mcpServer/oauth/mcpOauth.controller.ts` 3,
  `agent/peer/a2a.controller.ts` 2,
  `user/auth/auth.controller.ts` 5 (login, register, refresh, logout, embed/token),
  `setup/init/init.controller.ts` 2 (status, init), `setup/health/health.controller.ts` 1,
  `integration/integration.extension.controller.ts` 2 (`import-state`, `download`),
  `browser/browser.extension.controller.ts` 1 (`import-state`),
  `integration/integration.internal.controller.ts` 1 (class level),
  `browser/browser.internal.controller.ts` 1 (class level),
  `usage/usage.controller.ts` 1 (`POST agents/:id/usage`),
  `bridle/bridle.controller.ts` 1 (class level),
  `agent/shareLink/share.controller.ts` 1. The implementation task pins the
  exact numbers after reading each controller; a mismatch is a finding, not a
  reason to edit the test.
- **Alternatives considered**: merging the stale upstream branch
  `fix/api-global-auth-guard` (rejected: 170 commits behind, one commit, the
  fork's version is the one in production); attaching `JwtAuthGuard` to the 18
  bare controllers one by one (rejected: that is how the hole appeared, and
  nothing stops the 19th).
- **Consoles**: both consoles already send `Authorization: Bearer` on every
  request (`admin/slices/setup/api/plugins/apiBaseUrl.ts:52`, app equivalent),
  so no console change. `GET /agents/:id` and the SSE status stream are already
  `@Public()`.

## R1. Embed tokens are chat-only

- **Decision**: `mintEmbedToken` adds `typ: 'embed'` to the payload
  (`IAuthTokenPayload.typ?: 'embed'`). A helper `isEmbedToken(payload)` in
  `auth.types.ts` is used by `JwtAuthGuard` (after verify: throw
  `unauthorized(TokenInvalid)` and log `embed token outside chat`) and by
  `A2aCardGuard` (the only other JWT verifier that grants platform access by
  role). No `@EmbedAllowed()` decorator is needed: every route the widget uses
  is already outside `JwtAuthGuard`. `bridle.controller.ts` becomes
  `@Public()` at class level under R0, `BridleChatAuthGuard`,
  `BridleController.resolveRequester` and the WebSocket handshake verify the
  JWT themselves and keep accepting embed tokens.
- **Rationale**: the chat surface and the platform surface are already split
  by which guard verifies the token; the only thing missing is a claim that
  lets the platform-side verifier tell an embed token apart. Reusing the
  existing 401 `TOKEN_INVALID` keeps the console contract untouched (consoles
  never hold an embed token) and matches FR-004: the caller gets the same
  status an anonymous caller gets and no data.
- **Admin embed tokens** (`embed:mint-admin`, decided 2026-10-26): same `typ`,
  same refusal. They keep `Owner`/`Admin` roles, so inside the chat
  `clientIdFromJwtPayload` still maps them to the `admin` conversation and
  `requireChannelAccess` still treats them as admin. Outside the chat they are
  worth nothing. The 7-day TTL cap stays.
- **Other verifiers checked**: `openLink.service.ts` requires `sub === 'open-link'`
  and `agentId`/`path` claims; `browser.extension.controller.ts` and
  `integration.extension.controller.ts` verify their own payload shapes;
  `A2aPeerGuard` accepts only `ap_` credentials. None of them accepts an embed
  token today; `A2aCardGuard` would accept an admin embed token, hence the
  helper there. The MCP endpoints (`McpModule.forRoot({ guards: [JwtAuthGuard] })`)
  use the same guard class, so they refuse embed tokens with no extra work.
- **Alternatives considered**: a separate signing secret for embed tokens
  (rejected: the chat-side verifiers would need both secrets, and the fork
  would need a new env var); a decorator allowlist as the handoff sketched
  (rejected: nothing to allow once `bridle.controller.ts` is `@Public()`, and
  an allowlist nobody uses is a hole waiting to be used).

## R3. Transcript access only for the owner

- **Decision**: `requireChannelAccess` in `bridle.controller.ts` becomes:
  `share-…` keep today's rule; `anon-…` and `http-…` return early (today's
  behaviour, FR-007); every other channel resolves the requester and allows
  `kind === 'jwt'` with `clientId === channel` or `clientId === 'admin'`;
  otherwise throws `ForbiddenException({ code: 'CHANNEL_FORBIDDEN' })`. Applies
  to GET, DELETE and archive through the one helper. The check runs before the
  file read, so an existing and a missing channel answer the same 403.
- **Rationale**: the identity the hub resolves (`welcome.clientId`) is the
  channel name for console users (`admin` for owners and admins, the user id
  otherwise, `app/slices/bridle/stores/bridle.ts:336`) and for embed visitors
  (`sub`). So "owner" is exactly `clientId === channel`, with admins holding
  the `admin` channel and reading everything from the console. The 403 (not
  401) follows specs/010 R4: the app's axios interceptor bounces a 401 outside
  `/auth/` to the login page.
- **Widget compatibility**: the SDK sends `Authorization: Bearer <token>` on
  transcript fetch and archive when a token is configured
  (`bridle/sdk/src/BridleChat.ce.vue:342`, `:805`), so an identified widget
  keeps loading and archiving its own history. Anonymous widgets use `anon-…`
  channels and are untouched.
- **Alternatives considered**: closing `anon-…` too (rejected for this ticket:
  the anonymous widget has no credential to present, the ids are random, and
  the spec keeps them as today); 404 for foreign channels (rejected: the share
  routes already use a uniform 403 and the consoles handle it).

## R5. Subject validation

- **Decision**: `EmbedTokenDto.sub` gets
  `@Matches(/^(?!admin$)(?!anon-)(?!share-)(?!http-)[A-Za-z0-9_-]{1,128}$/)`
  with a message naming the rule, and `@MaxLength(128)`. In addition
  `mintEmbedToken` refuses with 400 a `sub` that equals an existing user id
  (`IUserGateway.findById`), because console users' chat channels are their
  user ids and a minted `sub` equal to one would read that user's console
  transcript under R3.
- **Rationale**: `sub` becomes the channel and part of the session file path
  `data/sessions/bridle:<sub>.jsonl`; the character class rules out `/`, `\`,
  `..` and `:` (the `agent:<id>` service-token namespace). The reserved
  prefixes are the three channel namespaces the hub mints itself. The user-id
  check is one indexed lookup per mint.
- **Alternatives considered**: forcing a mandatory prefix on every embed `sub`
  (rejected: breaks the Augeo contract already written into `chat.html` and
  every existing integrator); skipping the user-id check (rejected: cheap, and
  the only thing between a key holder's typo and a console user's history).

## R6. Tests and gates

- `api`: Jest, colocated specs. Extend `jwtAuth.guard.spec.ts` (embed `typ`
  refused), `auth.service.spec.ts` (`typ` present, reserved subs and user-id
  collisions refused), `bridle.controller.spec.ts` (owner, foreign, anonymous,
  admin on a `wslid-…` channel for GET/DELETE/archive), add
  `publicRoutes.spec.ts` (allowlist), and a `chatIdentity.spec.ts` case that
  an admin embed token still maps to `admin`. Run with `npx jest <paths>` after
  `npx prisma generate` (never `bun run test` next to a running dev API).
- `api` typecheck: `bun run build`. Consoles: no code change expected; run
  `npx nuxt typecheck` in `admin` and `app` only if the SDK regen is touched
  (it should not be: no DTO shape changes, only validation metadata).
- Twin-console statement for the PR: `bridle` slice checked in both consoles;
  neither needs a change because both already send the bearer and both read
  transcripts as `admin` or as the user's own id.

## R7. Out of scope, recorded

- Secret masking in `/settings`: CLEAN-141.
- Verified identity in the model context: CLEAN-176.
- SDK token refresh on reconnect: unchanged, one-hour TTL remains the advice.
- Fork follow-up: a2a and OAuth `start`/`status` exemptions (R0), plus the
  catch-up merge itself.
- Operational: revoke the dev demo key, issue per-environment keys to Augeo
  only after this lands on their environments.
