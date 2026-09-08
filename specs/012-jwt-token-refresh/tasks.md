# Tasks: Session stays alive while you work, and ends honestly when it cannot (CLEAN-72)

**Input**: Design documents from `specs/012-jwt-token-refresh/`

**Prerequisites**: plan.md, spec.md, research.md (§3.2 model, R0–R14), data-model.md, contracts/session-api.md, quickstart.md

**Tests**: API tests are included (plan: "tests for every new server path", Jest, colocated `*.spec.ts`, hand-rolled stubs — `bridleChatAuth.guard.spec.ts:26-55` pattern). Consoles have no test runner; verification is `bun run build:api && bun run typecheck` per console, `bun run i18n:check` (app), and quickstart.

**Organization**: Grouped by user story. US1 (session renews itself) and US2 (honest ending) are both P1 and together form the MVP; US3 (admin live chat) is P2. Foundational work carries the session model, the 401 codes and the guard changes because every story reads them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 from spec.md
- File paths are repo-relative; API = `api/src/…`, consoles = `app/slices/…`, `admin/slices/…`

## Path Conventions

- New API slice: `api/src/slices/user/session/{session.prisma, session.module.ts, domain/, data/}`
- Auth slice: `api/src/slices/user/auth/{auth.controller.ts, auth.module.ts, domain/, dtos/, guards/}`
- Init slice: `api/src/slices/setup/init/{init.module.ts, init.controller.ts, domain/init.service.ts}`
- Bridle: `api/src/slices/bridle/{bridle.controller.ts, guards/bridleChatAuth.guard.ts, handlers/bridleClientWs.handler.ts}`
- App: `app/slices/setup/api/plugins/api.ts`, `app/slices/user/auth/{stores, plugins, data, domain, components/auth, i18n/locales}`, `app/slices/common/layouts/default.vue`, `app/slices/bridle/stores/bridle.ts`
- Admin: `admin/slices/setup/api/plugins/apiBaseUrl.ts`, `admin/slices/user/auth/{stores, plugins, data, utils, components}`, `admin/slices/common/layouts/default.vue`, `admin/slices/bridle/{stores/bridle.ts, components/bridle/Provider.vue}`, `admin/slices/agent/agent/components/agent/chat/Tab.vue`, `admin/slices/rancher/components/rancher/Provider.vue`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, env, constants and the slice skeleton so every later task has a home.

- [ ] T001 Add `cookie-parser` and `@types/cookie-parser` to `api/package.json` (`cd api && bun add cookie-parser && bun add -d @types/cookie-parser`) and register `app.use(cookieParser())` in `api/src/main.ts` right after the `json`/`urlencoded` middleware (`:36-37`)
- [ ] T002 [P] Add env defaults to `api/.env.example`: change `JWT_EXPIRES_IN=7d` → `JWT_EXPIRES_IN=15m`; append `SESSION_IDLE_DAYS=7`, `SESSION_ABSOLUTE_DAYS=30`, `SESSION_COOKIE_SECURE=false` with a one-line comment each; mirror the same four into `k8s/deploy/30-api.yaml` env block (`JWT_EXPIRES_IN: "15m"`, `SESSION_COOKIE_SECURE: "true"`, idle `"7"`, absolute `"30"`)
- [ ] T003 [P] Create the session slice skeleton `api/src/slices/user/session/` with `domain/index.ts` barrel, `domain/session.types.ts` (`SESSION_SECRET_PREFIX = 'rs_'`, `SESSION_SECRET_BYTES = 32`, `SESSION_COOKIE_NAME = 'ranch_session'`, `SESSION_COOKIE_PATH = '/auth'`, `ISessionData { id, userId, secretHash, expiresAt, absoluteExpiresAt, lastSeenAt, revokedAt, userAgent, createdAt, updatedAt }`, `ISessionConfig { idleDays, absoluteDays, cookieSecure }`, `ISessionIssue { sessionId, secret, cookieMaxAgeSeconds }`) and an empty `session.module.ts` shaped like `api/src/slices/user/apiKey/apiKey.module.ts` (`imports: [forwardRef(() => AuthModule)]`)
- [ ] T004 [P] Add auth error codes to `api/src/slices/user/auth/domain/auth.types.ts`: `AuthErrorCodes = { TokenMissing: 'TOKEN_MISSING', TokenExpired: 'TOKEN_EXPIRED', TokenInvalid: 'TOKEN_INVALID', SessionMissing: 'SESSION_MISSING', SessionExpired: 'SESSION_EXPIRED', SessionInvalid: 'SESSION_INVALID' } as const`, `AuthErrorCode` type, `sid?: string` on `IAuthTokenPayload`, `expiresIn: number` on `IAuthResult`, and a helper `unauthorized(code: AuthErrorCode): UnauthorizedException` returning `new UnauthorizedException({ code, message: <human text per code> })` (object-body precedent: `api/src/slices/agent/shareLink/domain/shareLink.types.ts:57-65`); plus `classifyJwtError(err: unknown): AuthErrorCode` (`err?.name === 'TokenExpiredError'` → `TokenExpired`, else `TokenInvalid`); export all from `domain/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Session persistence + service, machine-readable 401s in every guard, and the shortened default token lifetime. Every story reads these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Add Prisma model in `api/src/slices/user/session/session.prisma`: `model Session { id String @id @default(uuid()); userId String; secretHash String @unique; expiresAt DateTime; absoluteExpiresAt DateTime; lastSeenAt DateTime @default(now()); revokedAt DateTime?; userAgent String?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; @@index([userId]); @@index([expiresAt]) }` — no relation to `User` (repo convention, `api/src/slices/user/apiKey/apiKey.prisma:9`) (depends on T003)
- [ ] T006 Run `cd api && bun run migrate`, rename the generated folder to `api/prisma/migrations/20260908120000_user_session/`, add a leading `-- Additive: new table Session (hashed secret, sliding + absolute expiry). Safe on an existing database.` comment, confirm `bun run generate` succeeds (depends on T005)
- [ ] T007 [P] Define `abstract class ISessionGateway` in `api/src/slices/user/session/domain/session.gateway.ts`: `create(input: { userId, secretHash, expiresAt, absoluteExpiresAt, userAgent? }): Promise<ISessionData>`, `findByHash(secretHash): Promise<ISessionData | null>`, `touch(id, expiresAt): Promise<ISessionData>` (sets `expiresAt` + `lastSeenAt = now`), `revoke(id): Promise<void>` (sets `revokedAt = now` if null), `pruneForUser(userId, before: { absoluteBefore: Date; revokedBefore: Date }): Promise<number>`; export from `domain/index.ts`
- [ ] T008 [P] Implement `SessionMapper` in `api/src/slices/user/session/data/session.mapper.ts` (Prisma record → `ISessionData`) following `api/src/slices/user/apiKey/data/apiKey.mapper.ts`
- [ ] T009 Implement `SessionGateway extends ISessionGateway` in `api/src/slices/user/session/data/session.gateway.ts` over `PrismaService` (`prisma.session.create/findUnique/update/updateMany/deleteMany`) (depends on T006, T007, T008)
- [ ] T010 Write `api/src/slices/user/session/data/session.gateway.spec.ts` with a `makePrismaStub()` in the style of `api/src/slices/chat/data/chat.gateway.spec.ts`: create → findByHash round-trip; `touch` moves `expiresAt` and `lastSeenAt`; `revoke` is idempotent; `pruneForUser` deletes only rows past `absoluteBefore` or revoked before `revokedBefore` and only for that user (depends on T009)
- [ ] T011 Implement `SessionService` in `api/src/slices/user/session/domain/session.service.ts` over `ISessionGateway` + `ConfigService`: `config()` reads `SESSION_IDLE_DAYS` (default 7, parsed as float), `SESSION_ABSOLUTE_DAYS` (30), `SESSION_COOKIE_SECURE` (`'false'` → false, else true); `mint()` = `rs_` + `randomBytes(32).toString('base64url')`; `hash(secret)` = sha256 hex (copy of `api/src/slices/user/apiKey/domain/apiKey.service.ts:52-54`); `create(userId, userAgent?)` → `ISessionIssue` (row with `expiresAt = now + idle`, `absoluteExpiresAt = now + absolute`); `refresh(secret)` → `{ session, cookieMaxAgeSeconds }` or throws `unauthorized(SessionMissing)` when `secret` is empty, `unauthorized(SessionInvalid)` when the prefix is wrong or no row matches the hash, `unauthorized(SessionExpired)` when `revokedAt` is set or either deadline passed; on success `touch(id, now + idle)`; `revoke(secret)` → boolean (false when no row); `pruneForUser(userId)` with `absoluteBefore = now`, `revokedBefore = now − 30d`; `cookieOptions(maxAgeSeconds)` → `{ httpOnly: true, sameSite: 'lax', path: '/auth', secure, maxAge }` and `clearCookieOptions()` (same, `maxAge: 0`); the secret is never logged (depends on T004, T007)
- [ ] T012 Write `api/src/slices/user/session/domain/session.service.spec.ts` with an in-memory `ISessionGateway` stub (`Map`, `jest.fn` per method) and a `ConfigService` stub: secret format `^rs_[A-Za-z0-9_-]{43}$`; stored value is the sha256 of the secret and never the secret; refresh slides `expiresAt` and touches `lastSeenAt` without changing the row id; refresh on revoked / idle-expired / absolute-expired → 401 body `{ code: 'SESSION_EXPIRED' }`; unknown hash → `SESSION_INVALID`; empty secret → `SESSION_MISSING`; revoke returns true then false; prune boundaries; `cookieOptions` reflects `SESSION_COOKIE_SECURE=false` (depends on T011)
- [ ] T013 Wire `api/src/slices/user/session/session.module.ts`: providers `SessionMapper`, `SessionService`, `{ provide: ISessionGateway, useClass: SessionGateway }`; exports `SessionService`; register `SessionModule` in `api/src/app.module.ts` imports next to `ApiKeyModule` (depends on T009, T011)
- [ ] T014 [P] Rewrite `api/src/slices/user/auth/guards/jwtAuth.guard.ts` to throw `unauthorized(AuthErrorCodes.TokenMissing)` for a missing/non-bearer header and `unauthorized(classifyJwtError(err))` on verify failure, logging `code` + `sub` (if decodable) at `warn` via Nest `Logger` — never the token (depends on T004)
- [ ] T015 [P] Write `api/src/slices/user/auth/guards/jwtAuth.guard.spec.ts` (new, stub pattern of `api/src/slices/bridle/guards/bridleChatAuth.guard.spec.ts:26-55`): no header → 401 `{ code: 'TOKEN_MISSING' }`; `verify` throwing an error named `TokenExpiredError` → `TOKEN_EXPIRED`; any other throw → `TOKEN_INVALID`; valid → `req.user` set; `@Public()` bypass unchanged (depends on T014)
- [ ] T016 [P] Update `api/src/slices/bridle/guards/bridleChatAuth.guard.ts`: replace the two string throws (`:80-82`, `:101`) with `unauthorized(classifyJwtError(err))` / `unauthorized(TokenMissing)`; keep the share-offered rule and the 403 branch untouched; the private `verify()` must surface the caught error to the classifier instead of swallowing to `null` when no share headers were offered (depends on T004)
- [ ] T017 [P] Update `api/src/slices/bridle/guards/bridleChatAuth.guard.spec.ts`: assertions on `message: 'Invalid or expired token'` / `'Missing access token'` become `toMatchObject({ status: 401, response: { code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'TOKEN_MISSING' } })` (or the shape `getResponse()` exposes); add the expired-vs-invalid pair (depends on T016)
- [ ] T018 [P] Change the default token lifetime: `api/src/slices/user/auth/auth.module.ts:19-29` and `api/src/slices/setup/init/init.module.ts:10-20` → `expiresIn: config.get('JWT_EXPIRES_IN') ?? '15m'`; `AuthModule` imports `SessionModule`; add a `jwtExpiresInSeconds()` helper in `api/src/slices/user/auth/domain/auth.service.ts` that converts the configured `JWT_EXPIRES_IN` (`s|m|h|d`) into seconds for `AuthDto.expiresIn` (depends on T013)
- [ ] T019 [P] Extend DTOs in `api/src/slices/user/auth/dtos/`: `auth.dto.ts` gains `@ApiProperty({ description: 'Access-token lifetime in seconds' }) expiresIn: number`; new `logoutResult.dto.ts` with `@ApiProperty() revoked: boolean`; export from `dtos/index.ts` (depends on T004)

**Checkpoint**: `cd api && bun run test -- session jwtAuth bridleChatAuth` green; `bunx tsc --noEmit` green; foundation ready.

---

## Phase 3: User Story 1 — A session I keep using never expires under me (Priority: P1) 🎯 MVP

**Goal**: Login/register/init create a session cookie; `POST /auth/refresh` returns a fresh 15-minute token from the cookie alone; both consoles keep the token in memory, attach it per request, renew proactively (timer, tab visibility, one in-flight promise) and retry once on `TOKEN_EXPIRED`/`TOKEN_INVALID`.

**Independent Test**: quickstart §3 (curl login → refresh → expired token) and §4.1–§4.4 / §5.1 with `JWT_EXPIRES_IN=90s`: no login prompt, no auth error across expiry, one `/auth/refresh` on boot and none of `/auth/me`.

### API — issue, refresh, cookie

- [ ] T020 [US1] Refactor `api/src/slices/user/auth/domain/auth.service.ts`: inject `SessionService`; replace `issueToken(user)` with `issueSession(user, userAgent?)` that calls `sessions.create(user.id, userAgent)`, signs `{ sub, email, roles, sid: sessionId }`, and returns `IAuthResult & { cookie: { value: secret, maxAgeSeconds } }` with `expiresIn = jwtExpiresInSeconds()`; `login`/`register` pass the request user agent through and call `sessions.pruneForUser(user.id)` after a successful login; add `refresh(secret, userAgent?)`: `sessions.refresh(secret)` → load the user by `session.userId` via the existing user gateway → `unauthorized(SessionInvalid)` when missing or `status === 'disabled'` → sign a new token with the same `sid` → return the same shape (cookie re-set with the same secret and the new `maxAge`) (depends on T011, T018)
- [ ] T021 [US1] Write `api/src/slices/user/auth/domain/auth.service.spec.ts` (new): stub `SessionService`, `IUserGateway`, `JwtService`, `SettingService`: login result has `expiresIn` and a `sid` in the signed payload; `refresh` returns a new token with the same `sid`; missing user → `SESSION_INVALID`; disabled user → `SESSION_INVALID`; the returned cookie value equals the minted secret and never appears in `accessToken` or `user` (depends on T020)
- [ ] T022 [US1] Update `api/src/slices/user/auth/auth.controller.ts`: `login` / `register` take `@Res({ passthrough: true }) res` and `@Req() req`, call `res.cookie(SESSION_COOKIE_NAME, cookie.value, sessions.cookieOptions(cookie.maxAgeSeconds))`, return `AuthDto { accessToken, expiresIn, user }`; add `@Post('refresh') @HttpCode(200)` (no guard) reading `req.cookies?.[SESSION_COOKIE_NAME] ?? ''` → `authService.refresh(...)` → same cookie set + `AuthDto`; document 401 codes with `@ApiUnauthorizedResponse({ description: "Body is `{ code: 'SESSION_MISSING' | 'SESSION_EXPIRED' | 'SESSION_INVALID' }`" })` and `operationId`s `authControllerRefresh`; `me` gets `@ApiUnauthorizedResponse` listing the `TOKEN_*` codes (depends on T019, T020)
- [ ] T023 [US1] Write `api/src/slices/user/auth/auth.controller.spec.ts` (new, direct `new AuthController(stubService, stubApiKeyService, stubSessions)` with a `res` stub capturing `cookie()` calls): login sets the cookie with `httpOnly`, `path: '/auth'`, `sameSite: 'lax'`; refresh without a cookie → 401 `SESSION_MISSING`; refresh with a cookie re-sets it and returns `expiresIn` (depends on T022)
- [ ] T024 [P] [US1] Delegate first-run bootstrap: `api/src/slices/setup/init/init.module.ts` drops its own `JwtModule` and imports `AuthModule`; `api/src/slices/setup/init/domain/init.service.ts:47-56` calls `authService.issueSession(user, userAgent)` instead of signing itself; `api/src/slices/setup/init/init.controller.ts` `init` sets the cookie exactly like login (depends on T020)
- [ ] T025 [US1] Regenerate clients: `cd api && bun run build && bun run generate:swagger`, then `cd app && bun run build:api` and `cd admin && bun run build:api`; confirm `AuthService.authControllerRefresh` and `AuthDto.expiresIn` in both `slices/setup/api/data/repositories/api/sdk.gen.ts` / `types.gen.ts` (depends on T022, T024)

### App — transport and store

- [ ] T026 [P] [US1] Extend the console auth domain in `app/slices/user/auth/domain/auth.types.ts` (`IAuthSession` gains `expiresIn: number`), `domain/auth.gateway.ts` + `domain/auth.service.ts` (add `refresh(): Promise<IAuthSession>` and `logout(): Promise<void>`), `data/auth.mapper.ts` (map `expiresIn`), `data/auth.gateway.ts` (`AuthApi.authControllerRefresh({ throwOnError: true })`, `authControllerLogout({ throwOnError: true })`) (depends on T025)
- [ ] T027 [US1] Rewrite `app/slices/setup/api/plugins/api.ts`: `client.setConfig({ baseURL, withCredentials: true })` and `client.instance.defaults.withCredentials = true`; add a **request** interceptor that sets `Authorization: Bearer <useAuthStore().accessToken>` when a token exists and the request does not already carry `X-Share-Token` (share page keeps its explicit `Authorization: null`, `app/slices/bridle/data/bridle.gateway.ts:42-51`); replace the response interceptor with: on `401` where `url` is not `/auth/*`, not the share page, and `error.config._retried !== true` → read `code = error.response?.data?.code`; if `TOKEN_EXPIRED` or `TOKEN_INVALID` → `await useAuthStore().refresh()`; on success mark `_retried = true`, set the new header, `return client.instance.request(error.config)`; on refresh failure → `useAuthStore().endSession(code)` and reject; if `TOKEN_MISSING` → existing `logout()` + `navigateTo('/login')`; every other error → reject unchanged (depends on T026)
- [ ] T028 [US1] Rewrite `app/slices/user/auth/stores/auth.ts`: remove `useCookie('access_token')`; state `accessToken`, `expiresAt: number | null`, `user`, `isHydrated`, `sessionEnded: boolean`, `sessionEndedCode: string | null`; module-scope `refreshTimer` and `refreshInFlight: Promise<boolean> | null`; `applySession(session)` sets token/user/`expiresAt = Date.now() + expiresIn*1000` and calls `scheduleRefresh()` (`setTimeout` at `expiresIn*1000 − 60_000`, skipped when ≤ 0); `refresh()` dedups on `refreshInFlight`, calls the service, returns `true`/`false`, on `SESSION_*` clears the session, on a network error (`!err.response`) keeps the token and re-arms a 30 s retry; `ensureFresh()` refreshes when `expiresAt − Date.now() < 60_000`; `init()` → `refresh()` first (success ⇒ authenticated with the returned user; failure ⇒ logged out silently), `isHydrated = true`; `login`/`register` → `applySession`; `logout()` → clear timer, discard in-flight result, call `service.logout()` (ignore errors), clear state; `endSession(code)` → clear timer/token/`expiresAt`, keep `user`, set `sessionEnded = true` + code (idempotent); remove every `handleApiAuthentication` call (depends on T026, T027)
- [ ] T029 [P] [US1] Register the visibility hook in `app/slices/user/auth/plugins/auth.ts`: after `await authStore.init()`, `document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && authStore.isAuthenticated) authStore.ensureFresh(); })` (client-only) (depends on T028)
- [ ] T030 [P] [US1] Reduce `app/slices/setup/api/utils/handleApiAuthentication.ts` to a deprecated no-op (or delete it and its imports) once T027/T028 land; `grep -rn handleApiAuthentication app/slices` must return nothing but the share gateway comment (depends on T028)

### Admin — transport and store

- [ ] T031 [P] [US1] Extend `admin/slices/user/auth/{domain/auth.types.ts, domain/auth.gateway.ts, domain/auth.service.ts, data/auth.mapper.ts, data/auth.gateway.ts}` exactly as T026 (refresh, logout, `expiresIn`) (depends on T025)
- [ ] T032 [US1] Rewrite `admin/slices/setup/api/plugins/apiBaseUrl.ts`: keep the baseURL/meta logic; `withCredentials: true` on config and instance defaults; the request interceptor reads the token from `useAuthStore().accessToken` instead of `document.cookie` (`:23-34`); the response interceptor gets the same code-aware refresh-and-retry-once logic as T027 (auth endpoints excluded by `url.includes('/auth/')`; no share page in admin) (depends on T031)
- [ ] T033 [US1] Rewrite `admin/slices/user/auth/stores/auth.ts` to the T028 shape (memory token, `expiresAt`, timer, dedup, `refresh`/`ensureFresh`/`endSession`/`logout`); `hydrate()` becomes refresh-first; `isAuthenticated` now requires `accessToken && user` (fixes the "dead cookie looks logged in" gap); keep `hasAdminAccess`; `admin/slices/setup/api/utils/handleApiAuthentication.ts` becomes a no-op / is removed with its imports (depends on T031, T032)
- [ ] T034 [P] [US1] Register the visibility hook in `admin/slices/user/auth/plugins/auth.ts` as in T029 (depends on T033)
- [ ] T035 [US1] Add `admin/slices/user/auth/utils/authedFetch.ts`: `authedFetch(input, init)` → attaches `Authorization` from the auth store, on `401` with `TOKEN_EXPIRED`/`TOKEN_INVALID` awaits `authStore.refresh()` and retries once, on refresh failure calls `authStore.endSession(code)` and returns the 401 response; also `authedXhrHeaders()` returning the current bearer for XHR uploads (depends on T033)

**Checkpoint**: quickstart §3 and §4.1–§4.4, §5.1 pass; `cd app && bun run typecheck`, `cd admin && bun run typecheck` green; `cd api && bun run test -- auth session` green.

---

## Phase 4: User Story 2 — When the session is gone, I am told once and returned to where I was (Priority: P1) 🎯 MVP

**Goal**: `POST /auth/logout` revokes; a failing bearer on the chat routes is a 401 with a code instead of an anonymous downgrade; each console shows exactly one in-place "session ended" dialog with the login form, keeps the page and the draft, and continues after sign-in; no raw error strings.

**Independent Test**: quickstart §3 (logout, expired bearer on `/message/sync`), §4.5–§4.9 and §5.2 (dialog once, draft survives, share page untouched, secret rotation recovers, multi-tab).

### API — logout, chat routes, WS codes

- [ ] T036 [US2] Add `logout(secret): Promise<boolean>` to `api/src/slices/user/auth/domain/auth.service.ts` (delegates to `sessions.revoke`) and `@Post('logout') @HttpCode(200)` to `api/src/slices/user/auth/auth.controller.ts`: reads the cookie (optional), calls `logout`, `res.clearCookie(SESSION_COOKIE_NAME, sessions.clearCookieOptions())`, returns `LogoutResultDto { revoked }`; `operationId` `authControllerLogout`; extend `auth.controller.spec.ts` (logout without cookie → 200 `{ revoked: false }` + cookie cleared; with a live cookie → `{ revoked: true }`) and `auth.service.spec.ts` (refresh after revoke → `SESSION_EXPIRED`) (depends on T022, T023)
- [ ] T037 [P] [US2] Update `BridleController.resolveRequester` and `requireChannelAccess` in `api/src/slices/bridle/bridle.controller.ts:166-223`: when a bearer is present and verification fails, throw `unauthorized(classifyJwtError(err))` **unless** `hasShareToken(headers)` (then continue to the share branch); no bearer + no share headers stays `{ clientId: null, kind: 'anonymous' }`; `verifyJwt` returns `{ payload } | { error }` instead of swallowing; add `@ApiUnauthorizedResponse({ description: "A bearer was offered but is expired or invalid and no share headers were present. Body is `{ code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' }`. Requests with no credentials stay anonymous." })` on `sendMessage` and `sendMessageSync` (depends on T004)
- [ ] T038 [US2] Update `api/src/slices/bridle/bridle.controller.spec.ts`: expired bearer without share headers on `message/sync` → 401 `{ code: 'TOKEN_EXPIRED' }` and no `hub.registerClient` call; garbage bearer → `TOKEN_INVALID`; expired bearer **with** valid share headers → share identity as before; no credentials → `sync-…` anonymous as before (depends on T037)
- [ ] T039 [P] [US2] Update `api/src/slices/bridle/handlers/bridleClientWs.handler.ts:128-158`: keep the caught verify error, and on the non-public branch `reject(classifyJwtError(err) === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN')`; public-agent downgrade unchanged; add a `// follow-up: embed SDK refresh path` note (depends on T004)
- [ ] T040 [US2] Update `api/src/slices/bridle/handlers/bridleClientWs.handler.spec.ts`: expired token on a non-public agent emits `bridle_error { code: 'TOKEN_EXPIRED' }` then disconnects; malformed token still emits `INVALID_TOKEN`; public agent + expired token still connects as `anon-…` (depends on T039)
- [ ] T041 [US2] Regenerate clients again (`cd api && bun run build && bun run generate:swagger`; `app`/`admin` `build:api`) so `authControllerLogout` exists in both SDKs (depends on T036)

### App — session-ended dialog and error surfaces

- [ ] T042 [US2] Add i18n keys to `app/slices/user/auth/i18n/locales/en.json` under `account`: `session_ended_title: "Your session has ended"`, `session_ended_body: "Sign in to continue where you left off."`, `session_ended_submit: "Sign in"`; run `bun run i18n:sync` from the repo root (generates `ru.json`; never hand-write it) and `bun run i18n:check`
- [ ] T043 [US2] Create `app/slices/user/auth/components/auth/sessionEnded/Provider.vue`: renders only while `authStore.sessionEnded`; a fixed full-screen overlay (hand-rolled like `app/slices/agent/components/agent/chat/Provider.vue:284-323`, `role="dialog" aria-modal="true"`, no dismiss control) with `$t('account.session_ended_title')`, `$t('account.session_ended_body')`, and `<AuthCommonForm>` (`app/slices/user/auth/components/auth/common/Form.vue`) in login mode prefilled with `authStore.user?.email`; on `submit` calls `authStore.login(...)` — success clears `sessionEnded` (inside `login` → `applySession`), failure shows the same inline error the login page shows; Escape and backdrop clicks do nothing (depends on T028, T042)
- [ ] T044 [US2] Mount `<AuthSessionEndedProvider />` once in `app/slices/common/layouts/default.vue` (auto-import name follows the slice convention; verify with `bun run typecheck`); the `auth` and `blank` layouts do not mount it (depends on T043)
- [ ] T045 [P] [US2] Make `app/slices/user/auth/data/authError.mapper.ts` read `error.response?.data?.code` and expose it on the mapped error (`code?: string`) so the store can tell `SESSION_*` from a bad-credentials 401 on `/auth/login`; `BadCredentialsError` only for `/auth/login`/`register` 401s without a `SESSION_*`/`TOKEN_*` code (depends on T026)
- [ ] T046 [P] [US2] In `app/slices/bridle/stores/bridle.ts:395-405` `sendMessage` catch: when the error is an auth failure already handled upstream (`err.response?.status === 401`, or `useAuthStore().sessionEnded`), do **not** write `errors[key]`; remove the optimistic user message from `conversations[key]` and restore its text into a `drafts[key]` ref (new state, read by `components/bridle/chat/Input.vue` as the initial composer value) so the message is available to resend after sign-in; other errors keep the existing `chat.error` banner (depends on T027)
- [ ] T047 [P] [US2] Guard the two header banners against raw auth strings: `app/slices/agent/components/agent/chat/Provider.vue:29-49` `onRestart` catch sets `restartError = null` (falls back to `$t('chat.restart_failed')`) when `err.response?.status === 401`; same rule in `app/slices/share/stores/share.ts:62` for the share panel error (depends on T027)

### Admin — session-ended dialog

- [ ] T048 [US2] Create `admin/slices/user/auth/components/authSessionEnded/Provider.vue` using the `reka-ui` `AlertDialogRoot/Portal/Overlay/Content/Title/Description` primitives (pattern: `admin/slices/common/components/confirm/Dialog.vue`), `:open="authStore.sessionEnded"`, no close control, English copy ("Your session has ended" / "Sign in to continue where you left off."), embedding `admin/slices/user/auth/components/authLogin/Form.vue` prefilled with `authStore.user?.email`; submit → `authStore.login(...)`; success closes via the store flag (depends on T033)
- [ ] T049 [US2] Mount `<AuthSessionEndedProvider />` once in `admin/slices/common/layouts/default.vue` (depends on T048)
- [ ] T050 [P] [US2] Admin login flow parity: `admin/slices/user/auth/components/authLogin/Provider.vue` keeps navigating after a *page* login only (`route.path === '/login'`), so a dialog login stays in place; `logout` in the store calls the new service method before clearing state (depends on T033, T041)

**Checkpoint**: quickstart §3 (logout, chat 401), §4.5–§4.9, §5.2 pass; `cd api && bun run test -- auth bridle.controller bridleClientWs` green; both consoles typecheck; `bun run i18n:check` clean.

---

## Phase 5: User Story 3 — The admin live chat recovers on its own (Priority: P2)

**Goal**: The admin socket always connects with the current token, refreshes before connecting when the token is about to expire, reconnects once after an auth rejection, and joins the session-ended state when refresh fails; transcript/upload/restart calls carry the current token.

**Independent Test**: quickstart §5.1–§5.4: streaming survives renewal and a forced reconnect without reload; a lapsed session yields the dialog within 10 s instead of "Chat reconnecting…"; upload and restart after renewal succeed.

- [ ] T051 [US3] Update `connect()` in `admin/slices/bridle/stores/bridle.ts:436-449`: signature `connect(apiUrl, agentId)` (no token); `auth: (cb) => cb({ token: useAuthStore().accessToken, agentId, capabilities: [...] })`; before `io(...)` / `socket.connect()` await `useAuthStore().ensureFresh()`; add `socket.on('bridle_error', async (e) => { if (e?.code === 'TOKEN_EXPIRED' || e?.code === 'INVALID_TOKEN') { if (!this._authRetried && await useAuthStore().refresh()) { this._authRetried = true; socket.connect(); } else { useAuthStore().endSession(e.code); } } })`; reset `_authRetried = false` on `connect` event; keep `connect_error` logging (depends on T033, T035)
- [ ] T052 [US3] Replace the `token` parameters on the store's HTTP actions in `admin/slices/bridle/stores/bridle.ts` (`fetchTranscriptPage` `:224-249`, `uploadAttachment` `:258-305` via `authedXhrHeaders()`, `loadAgentMeta` `:908`, `setDebugEnabled` `:924`, `resetTranscript` `:956`, `loadTranscript` `:993`, `_hydrateAttachments` `:1018-1031`, `loadOlderTranscript` `:1082-1102`) with `authedFetch` / the auth store; on a 401 that `authedFetch` could not recover, stop `console.warn`-swallowing and let the session-ended state show (depends on T035, T051)
- [ ] T053 [US3] Update `admin/slices/bridle/components/bridle/Provider.vue`: remove the `token` prop (`:16-51`) and every `props.token` use (`:111, :216-219, :266-270, :308-318, :412, :440-449`); restart goes through `authedFetch`; `reset` flow does `store.disconnect(); await store.resetTranscript(apiUrl, agentId); await store.connect(apiUrl, agentId)`; `connectionStatus` (`:128-158`) shows nothing socket-related while `authStore.sessionEnded` (the dialog owns the screen) (depends on T051, T052)
- [ ] T054 [P] [US3] Drop `:token="authStore.accessToken"` and the `v-if="authStore.accessToken"` gate in `admin/slices/agent/agent/components/agent/chat/Tab.vue:119-133` (gate on `authStore.isAuthenticated` instead) (depends on T053)
- [ ] T055 [P] [US3] Same change in `admin/slices/rancher/components/rancher/Provider.vue:355-362` (depends on T053)
- [ ] T056 [P] [US3] `admin/slices/common/components/update/Dialog.vue:73-89` manual `fetch` with `Authorization` → `authedFetch` (depends on T035)

**Checkpoint**: quickstart §5 passes end-to-end; `cd admin && bun run typecheck` green; `grep -rn "props.token\|:token=" admin/slices/bridle admin/slices/agent admin/slices/rancher` returns nothing.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T057 [P] Align the four `JwtModule` dev fallbacks: `api/src/slices/bridle/bridle.module.ts:69-76`, `api/src/slices/browser/browser.module.ts:40`, `api/src/slices/integration/integration.module.ts:26` use the same `'dev-secret-change-me'` fallback as `auth.module.ts` (research §2, plan §4); add a startup `Logger.warn` in `api/src/main.ts` when `JWT_SECRET` is unset
- [ ] T058 [P] Update `README.md` auth section: session cookie (`ranch_session`, `/auth`, HttpOnly), 15-minute access token, `/auth/refresh` / `/auth/logout`, the four env vars, and the 401 `code` table (link `specs/012-jwt-token-refresh/contracts/session-api.md`)
- [ ] T059 [P] Update `docs/i18n.md`-governed copy check and run `bun run i18n:check` one last time; confirm `admin/` has no new locale files
- [ ] T060 Run the full `specs/012-jwt-token-refresh/quickstart.md` (§1–§6) against the local stack with the short lifetimes in `api/.env.dev`; record results in the Jira checkpoint comment
- [ ] T061 Final verification: `cd api && bun run test && bunx tsc --noEmit && bun run lint`; `cd app && bun run build:api && bun run typecheck`; `cd admin && bun run build:api && bun run typecheck`; `git diff --stat origin/main` reviewed for stray `access_token` / `handleApiAuthentication` / `document.cookie` references
- [ ] T062 Commit per phase with Conventional Commits + ticket (`feat(api): session table, refresh and logout endpoints (CLEAN-72)`, `feat(app): …`, `feat(admin): …`), open the GitHub PR into `main` titled `feat: session renewal and honest expiry in both consoles (CLEAN-72)` with the summary from plan.md, put the PR URL on CLEAN-72, move the issue to In Review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001–T004 — T002/T003/T004 in parallel; T001 independent
- **Foundational (Phase 2)**: T005 → T006 → T009 → T010; T007/T008 parallel after T003; T011 → T012 after T004+T007; T013 after T009+T011; T014/T016 parallel after T004, their specs T015/T017 after them; T018 after T013; T019 after T004. **Blocks all stories.**
- **US1 (Phase 3)**: API chain T020 → T021, T022 → T023, T024 (parallel with T022), T025 last; then app (T026 → T027 → T028 → T029/T030) and admin (T031 → T032 → T033 → T034/T035) in parallel
- **US2 (Phase 4)**: API T036 (needs T022), T037 → T038, T039 → T040 all parallel to each other; T041 after T036; app T042 → T043 → T044, T045/T046/T047 parallel; admin T048 → T049, T050
- **US3 (Phase 5)**: needs T033 + T035 (US1 admin) and T048 (US2 admin dialog) for the session-ended branch; T051 → T052 → T053 → T054/T055; T056 any time after T035
- **Polish (Phase 6)**: after all desired stories

### User Story Dependencies

- **US1 (P1)**: only Foundational
- **US2 (P1)**: Foundational + US1's store/transport (T027/T028, T032/T033) because the dialog is driven by `endSession` and the retry path; API parts (T036–T041) need only Foundational + T022
- **US3 (P2)**: US1 admin transport (T033, T035) + US2 admin dialog (T048)

### Parallel Opportunities

- Phase 2: `{T007, T008}`, `{T014, T016, T019}`, `{T015, T017}` groups
- Phase 3: the whole app track (T026–T030) and admin track (T031–T035) run side by side after T025
- Phase 4: `{T037, T039}` and `{T042, T045, T046, T047}` and `{T048}` are independent files
- Phase 5: `{T054, T055, T056}`

---

## Parallel Example: User Story 1 (after T025)

```bash
# App track
Task: "Extend app auth domain/gateway/mapper with refresh/logout/expiresIn (T026)"
Task: "Rewrite app/slices/setup/api/plugins/api.ts with withCredentials, request + code-aware response interceptors (T027)"
# Admin track (different files)
Task: "Extend admin auth domain/gateway/mapper (T031)"
Task: "Rewrite admin/slices/setup/api/plugins/apiBaseUrl.ts (T032)"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 + Phase 2 → `bun run test -- session jwtAuth bridleChatAuth` green.
2. Phase 3 → a token expiring every 90 s is invisible to the person in both consoles (quickstart §4.1–§4.4, §5.1).
3. Phase 4 → logout revokes, chat never goes anonymous with a bad bearer, one dialog, draft survives (§3, §4.5–§4.9, §5.2).
4. **STOP and VALIDATE** with the reporter's flow: open a chat, hide the tab past the idle window, come back, send.

### Incremental Delivery

- Phase 5 (admin socket) can ship in the same PR or a follow-up commit; without it the admin chat still shows the dialog (via the HTTP path) but the socket needs a reload after renewal.
- Phase 6 last.

### Commit cadence (Conventional Commits + ticket)

- `feat(api): session table, refresh/logout, machine-readable 401s (CLEAN-72)` after Phase 2 + API parts of Phase 3/4
- `feat(app): memory token, proactive refresh, retry once, session-ended dialog (CLEAN-72)` after app parts
- `feat(admin): memory token, refresh-aware socket and fetch, session-ended dialog (CLEAN-72)` after admin parts + Phase 5
- `chore(api): align jwt dev fallbacks, docs (CLEAN-72)` after Phase 6
- Jira checkpoint comments after Phase 2, Phase 4 and Phase 5.

## Notes

- Never log or return the session secret; specs assert its absence from bodies.
- `SESSION_COOKIE_SECURE=false` only in `.env.example` / local `.env.dev`; the cluster value is `"true"`.
- The share page path (`/share`) must keep working with a dead console session — quickstart §4.8 is a regression gate.
- Agent runtimes hold 365-day service tokens without `sid`; nothing in the guards may require `sid`.
