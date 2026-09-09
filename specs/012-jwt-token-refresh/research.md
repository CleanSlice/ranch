# Research: session tokens in Ranch — why "invalid token" appears above the chat

**Ticket**: [CLEAN-72](https://dreamvention.atlassian.net/browse/CLEAN-72)
**Date**: 2026-09-08
**Scope**: current-state audit of authentication tokens across `api/`, `app/`, `admin/`. Facts with file references first, then the answer to "do we need a refresh mechanism, and what is the correct fix". No implementation here — that is `plan.md`.

---

## 1. What exists today

### 1.1 One token, minted once, never renewed

| Fact | Where |
|---|---|
| Console JWT lifetime `JWT_EXPIRES_IN ?? '7d'`, secret `JWT_SECRET ?? 'dev-secret-change-me'` | `api/src/slices/user/auth/auth.module.ts:19-29`, `api/.env.example:9-10`, `k8s/deploy/30-api.yaml:61-67` |
| Issued on login / register / first-run owner bootstrap; no per-call override, so always the module default | `auth.service.ts:47-72, 74-106, 117-127`; `api/src/slices/setup/init/domain/init.service.ts:49-56` |
| Payload is `{ sub, email, roles }` — no session id, nothing beyond the library defaults | `api/src/slices/user/auth/auth.types.ts` |
| **No refresh endpoint, no refresh-token model, no rotation, no sliding expiry** — `grep -rni refresh api/src/slices/user` is empty; `/auth` exposes only `login`, `register`, `me`, `embed/token` | `auth.controller.ts:34, 41, 51, 61` |
| Other token families exist with their own TTLs and are *not* the console session: agent service token 365d, embed token 15m (admin embeds capped at 7d), browser/integration extension tokens 30d, browserless 15m | `auth.service.ts:129-143, 155-185`; `browser.extension.controller.ts:71-88`; `integration.extension.controller.ts:59-82`; `browser/data/browserless.client.ts:144-147` |
| Four separate `JwtModule` registrations with **different dev fallback secrets** (`dev-secret-change-me`, `bridle-dev-secret`, `ranch-dev-secret`). Harmless when `JWT_SECRET` is set; in a local env without it, a token minted by auth cannot be verified by bridle | `auth.module.ts`, `bridle/bridle.module.ts:69-76`, `browser/browser.module.ts:40`, `integration/integration.module.ts:26` |

### 1.2 How the API rejects a token

- Hand-rolled guard, no Passport: `api/src/slices/user/auth/guards/jwtAuth.guard.ts:27-48`. Missing header → `401 'Missing access token'`; any `verify` failure → `401 'Invalid or expired token'`.
- The guard does **not** distinguish an expired token from a bad signature, and emits no machine-readable code — only that string. A client therefore cannot tell "come back and renew" from "this token will never work again".
- Guard is opt-in per controller (`@UseGuards(JwtAuthGuard)`), not global. Same string in `bridle/guards/bridleChatAuth.guard.ts:81`.
- Error bodies are plain Nest `{ statusCode, message, error }`; only 2xx bodies are wrapped in `{ success, data }` (`setup/error/response.interceptor.ts`).

### 1.3 The chat routes: an expired console token becomes an anonymous visitor

`api/src/slices/bridle/bridle.controller.ts`:

- `POST :agentId/message` (`:246`) and `POST :agentId/message/sync` (`:297`) are **unguarded**. `resolveRequester` (`:166-188`) verifies the bearer best-effort; an expired token returns `null` from `verifyJwt` (`:190-196`) and the requester falls through to `{ clientId: null, kind: 'anonymous' }`. The handler then mints a throwaway `sync-<uuid>` channel (`:305`).
- Consequence: **sending a message with an expired token does not fail** — it silently re-identifies the person as an anonymous embed visitor. Conversation continuity, access approval and history (all keyed on the client id, see the doc comment at `:143-160`) are lost for that message.
- Attachment upload/download *are* guarded (`:415, :490`) and answer `401 'Invalid or expired token'`.

### 1.4 Live connection (admin agent workspace): socket.io handshake

`api/src/slices/bridle/handlers/bridleClientWs.handler.ts`:

- Token travels in the socket.io handshake `auth` object (`:68-78`), verified at `:132-137`.
- Expired token on a non-public agent → `reject('INVALID_TOKEN')` (`:156-157`): emits `bridle_error { code: 'INVALID_TOKEN' }` then disconnects (`:85-93`).
- Expired token on a public agent from a whitelisted origin → silently downgraded to `anon-<id>` (`:148-154`) — the same identity loss as 1.3.

### 1.5 The `app` console

| Fact | Where |
|---|---|
| Token stored in a JS-readable cookie `access_token`, `maxAge` 7d, mirrored into the store; `isAuthenticated = token && user` | `app/slices/user/auth/stores/auth.ts:19-30` |
| Attached as a static `Authorization: Bearer` header on the shared axios client, set once per `applyToken` | `stores/auth.ts:38-42`; `app/slices/setup/api/utils/handleApiAuthentication.ts:3-7` |
| Boot: `init()` calls `/auth/me`; failure silently clears the token, user is treated as logged out | `stores/auth.ts:73-89` |
| 401 interceptor: any 401 outside `/auth/*` and outside `/share` → `logout()` + `navigateTo('/login')`, then the rejection is **still re-thrown** to the caller | `app/slices/setup/api/plugins/api.ts:17-49` |
| **No `exp` decoding, no timer, no `visibilitychange` handling, no proactive renewal** anywhere in `app/` (the only `visibilitychange` listener is the share page re-resolving its *share* token, `share/components/share/page/Provider.vue:195-206`) | — |
| Chat transport is plain HTTP (`POST /message/sync`, server holds up to 120s); no WebSocket, no SSE | `app/slices/bridle/data/bridle.gateway.ts:56-79` |
| Generated hey-api client uses `throwOnError: false`; raw `apiClient.instance` calls (attachment upload/download) throw | `app/slices/setup/api/data/repositories/api/client.gen.ts`; `bridle.gateway.ts:100-141` |

**Where the red alert in the chat comes from.** `sendMessage` in `app/slices/bridle/stores/bridle.ts:350-406` writes `(err as Error).message || 'Failed to reach agent'` into `errors[key]` on any throw (`:400-402`). `bridle/components/bridle/chat/Provider.vue:246-252` renders it as a destructive box `"{{ $t('chat.error') }}: {{ error }}"` inside the scroll column. On a fresh conversation the message list is empty, so this box is the first thing in the chat body — "at the top of the chat".

Two more banners sit literally under the chat header and surface raw error strings the same way: the restart banner `app/slices/agent/components/agent/chat/Provider.vue:235-244` (`restartError = err.message`, `:44`, from a `JwtAuthGuard` endpoint) and the share panel error (`share/stores/share.ts:62` → `share/components/share/panel/Provider.vue:253, 376`).

The literal server string `"Invalid or expired token"` reaches the UI only through the one mapper that copies the Nest `message` verbatim (`setup/error/data/error.mapper.ts:30-31`), which is wired only for `AuthGateway` (`user/auth/data/auth.gateway.ts:18`). Every other gateway passes errors through untouched (`common/data/BaseGateway.ts:11-13, 39-41`), so their `err.message` is whatever axios or the caller produced.

> **To confirm by reproduction during planning** (see §4): which of the above producers renders the exact text the reporter saw. It does not change the design — every candidate is the same root cause (a dead token that nobody renewed and nobody handled), and every candidate is closed by the same fix.

### 1.6 The `admin` console

| Fact | Where |
|---|---|
| Identical cookie (`access_token`, 7d); `isAuthenticated = !!accessToken` — **no user check**, so a dead cookie looks logged-in until the first request fails | `admin/slices/user/auth/stores/auth.ts:15-23` |
| Request interceptor re-reads the cookie per request; 401 → `logout()` + `/login` | `admin/slices/setup/api/plugins/apiBaseUrl.ts:24-56` |
| Chat is socket.io: `connect()` captures the token **once** in `auth: { token }`; `reconnection: true` replays that frozen token on every reconnect; a second `connect()` is a no-op (`if (this._socket) return`) | `admin/slices/bridle/stores/bridle.ts:437-449` |
| `connect_error` → `console.error` only. **`bridle_error` is not listened for anywhere** in the repo (grep `INVALID_TOKEN` hits only the server handler) | `stores/bridle.ts:466-470` |
| Net effect: after expiry the admin chat shows "offline / reconnecting" forever until a page reload; HTTP calls 401 and bounce to `/login`; attachment upload shows `Upload failed (401)` under the composer | `bridle/components/bridle/Provider.vue:490-493`; `stores/bridle.ts:284, 817`; `Input.vue:150-156` |

### 1.7 Public share link (CLEAN-66) — deliberately different, and already correct

Opaque `sl_…` secret, no expiry, transported as `X-Share-Token` + `X-Share-Visitor` headers, rejected with **403 + `code`** (never 401) precisely so the console's 401 interceptor cannot hijack a visitor (`bridleChatAuth.guard.ts:44-49, 85-98`; `app/slices/setup/api/plugins/api.ts:30-39`). This is the one place where "console session died but the page must keep working" was designed on purpose. It is out of scope here and must not regress.

---

## 2. Root cause, stated once

A 7-day token is minted at login and then **nothing renews it, nothing watches its expiry, and nothing handles its death coherently**:

1. Renewal is impossible: there is no endpoint to obtain a fresh token without re-entering credentials.
2. Expiry is invisible to the client: neither console decodes `exp`, and the server answers every failure with the same 401 string, so "expired" and "forged" are indistinguishable.
3. Death is handled three different ways at once: the interceptor logs out and redirects, the calling store paints a raw error into the chat, and the chat send route quietly turns the person into an anonymous visitor. The admin socket adds a fourth: a silent permanent "offline".

A second, independent way to produce the same symptom: **`JWT_SECRET` rotation** (or a local env without `JWT_SECRET`, where the four modules fall back to different secrets). The cookie survives, the token is now "invalid" rather than "expired", and the user sees the same alert. Distinguishing the two in the API response is the only way support can tell them apart.

---

## 3. Do we need a refresh mechanism?

Three shapes were considered.

| Option | What it is | What it fixes | Cost / risk |
|---|---|---|---|
| **A. Short access token + rotating refresh token** (textbook: 15-min access JWT, long-lived opaque refresh token in an httpOnly cookie, server-side store, rotation + reuse detection, revocation) | Full session model | Everything in §2, plus server-side logout/revocation and a shrunken blast radius for a leaked access token | New persisted model, an httpOnly cookie next to the JS-readable access token, request retry while a refresh is in flight, socket reconnect with the current token. Largest change of the three — but the client half is the same machinery B needs, and the reference implementation in skyhunter (§3.1) has already paid the design cost |
| **B. Sliding renewal of the single token** (`/auth/refresh` exchanges a *still-valid* token for a fresh one; clients renew proactively when the remaining lifetime drops below a threshold, on app boot, and when a hidden tab becomes visible) | Session stays alive as long as the person keeps using the product | The "idle for a while, come back, dead token" case for any idle shorter than the token lifetime; no new storage; no cookie-strategy change; socket handshakes can pick up the newest token on reconnect | Cannot renew a token that already expired → an idle longer than the full lifetime still ends in re-login (acceptable, and must be handled well by C). No revocation (same as today) |
| **C. Honest expiry handling only** (no renewal: decode `exp`, one "session expired" state, login that returns to the same chat, socket listens to `INVALID_TOKEN`, server never silently downgrades an expired console token to anonymous, API distinguishes expired vs invalid) | Removes the raw alert and the silent anonymous chat | The *symptom*, in every console, regardless of why the token died | Does not make the session last longer; a weekly re-login stays |

**First answer (2026-09-08, before the reference implementation was reviewed): B + C.** The objection to A was that the console token has to stay readable by the browser for the socket handshake and XHR uploads.

**Revised answer after reviewing the reference implementation: A, in the shape already proven in skyhunter, plus C.** The objection does not hold once the two credentials are separated: the *session* lives in an httpOnly cookie the browser never reads, and the *access token* stays a short JS-readable JWT exactly as today. That is what skyhunter does, and it is the model this feature adopts. See §3.1.

### 3.1 Reference implementation: skyhunter (`E:/code/sh/skyhunter`)

| Piece | Skyhunter | Where |
|---|---|---|
| Session credential | Opaque Stytch `session_token`, **httpOnly Secure** cookie `session_token`, 60 min, **sliding**: every refresh re-authenticates the session with `session-duration-minutes` and re-sets the cookie | `api/.../controller/auth/AuthControllerImpl.java` (`setSessionTokenCookie`, `refresh`), `service/stytch/impl/StytchServiceImpl.java` (`refreshSession`), `application.yml:4` |
| Access token | `sessionJwt`, **5 min**, returned in the body; client keeps it in a JS cookie `API_TOKEN` for the `Authorization` header and STOMP connect headers | `AuthController.java` (login/refresh docs), `app/.../websocket/.../webSocket.repository.ts:360-373` |
| `POST /auth/refresh` | Reads the session cookie, **works with an expired JWT**, returns a new JWT | `AuthControllerImpl.java` `refresh()` |
| `POST /auth/logout` | Revokes the session server-side, clears the cookie | `AuthControllerImpl.java` `logout()` |
| Proactive renewal | Timer at `exp − 30 s`, re-armed after every successful token acquisition | `app/slices/user/auth/stores/auth.ts` `scheduleProactiveRefresh` |
| Tab return | `visibilitychange` → `refreshIfExpiringSoon()` | `app/slices/user/auth/plugins/auth.ts` |
| Dedup | One in-flight refresh promise shared by timer, visibility handler and 401 path | `stores/auth.ts` `refreshInFlight` |
| Reactive backstop | 401 → refresh → **retry once** (`retry: 1`, `retryStatusCodes: [401]`, `auth()` re-reads the cookie on every attempt) | `app/slices/setup/api/api.config.ts` |
| Live connection | `beforeConnect` refreshes if the token is within 30 s of expiry; socket auth error → logout; own timer at `exp − 60 s` | `webSocket.repository.ts:34-76, 92-96`, `websocket/plugins/di.ts:32-36` |
| Local JWT check | `sessions.authenticateJwtLocal(jwt, 300, 60)` — no network per request | `StytchServiceImpl.java:149-158` |

Two things in it are *not* carried over: `init()` treats the presence of the JS cookie as "authenticated" before `/refresh` answers (Ranch keeps requiring `/auth/me`), and the cookie is `SameSite=None` with a TODO (Ranch's consoles and API share the site `cleanslice.org` — `api.ranch…`, `admin.ranch…` in `k8s/deploy/30-api.yaml:161`, `40-admin.yaml:66` — so `Lax` is enough). Stytch itself is replaced by a session table: Ranch has no identity provider and does not need one for this.

### 3.2 The model this feature adopts

**Two credentials with different jobs.**

1. **Session** — opaque random secret, stored **hashed** in a new `Session` row (`userId`, `expiresAt` = sliding idle window, `absoluteExpiresAt`, `lastSeenAt`, `revokedAt`, optional user-agent), delivered as an **httpOnly, Secure, SameSite=Lax** cookie scoped to the API. Created on login / register / first-run bootstrap. Never readable by console code. Ends by idle window, absolute maximum, explicit logout, or server-side revocation.
2. **Access token** — the existing console JWT, shortened to **~15 min**, carrying `sub`, `email`, `roles` and a session id claim. Kept where it is today (JS-readable, `Authorization: Bearer`, socket handshake `auth`, XHR uploads). Verified locally by the existing guard; no per-request DB lookup.

**Renewal** — `POST /auth/refresh` (cookie in, no body): validate the session (exists, not revoked, inside idle and absolute windows), slide `expiresAt`, touch `lastSeenAt`, re-set the cookie, return a fresh JWT. Works regardless of whether the old JWT is expired. Failure is `401` with a code (`SESSION_MISSING` / `SESSION_EXPIRED` / `SESSION_INVALID`). No session-token rotation on refresh: two tabs share one cookie and would race each other; rotation adds nothing here because the cookie is httpOnly.

**Logout** — `POST /auth/logout` marks the session revoked and clears the cookie; the client drops the JWT and stops its timers. Revocation takes effect at the latest at the next refresh (≤ access-token lifetime).

**Guard** — `JwtAuthGuard` and `BridleChatAuthGuard` return a machine-readable reason: `TOKEN_MISSING`, `TOKEN_EXPIRED` (`TokenExpiredError`), `TOKEN_INVALID` (everything else), and log which. The bridle `/message` routes stop treating an unverifiable bearer as anonymous: **a bearer that fails verification is a 401; no bearer stays anonymous** (embed visitors send none). The WS handler keeps `bridle_error { code }` and adds `TOKEN_EXPIRED`.

**Clients (app and admin, one shared auth composable each)** — skyhunter's client model verbatim, minus the two exclusions above:
- boot: call `/auth/refresh` first (the console cannot see the httpOnly cookie, so it must ask); on success set the JWT and load `/auth/me`; on `SESSION_*` → logged-out, no error shown;
- proactive timer at `exp − 60 s`, `visibilitychange` → refresh if within the buffer, one in-flight promise;
- 401 `TOKEN_EXPIRED` → refresh → retry the request once; 401 `TOKEN_INVALID` or a failed refresh → **session-ended state** with return-to-place; every reader of the token (axios header, socket `auth`, XHR upload) reads the *current* value, never a captured one;
- admin socket: refresh before (re)connect if expiring; on `bridle_error TOKEN_EXPIRED/INVALID_TOKEN` refresh and reconnect once, then session-ended;
- explicit logout calls the endpoint, clears timers and discards any in-flight refresh result;
- share page untouched: its interceptor exemption stays.

**Other token families** (agent service 365d, embed 15m/7d, extension 30d, browserless 15m) already pass an explicit `expiresIn` and are not sessions; they are untouched. Only the console session's default lifetime changes.

**Suggested values** (planning may adjust): access token 15 min; idle window 7 days (today's total lifetime becomes the *inactivity* limit, which is strictly better for the reported flow); absolute maximum 30 days; proactive buffer 60 s.

**What this buys over B**: the reported flow — tab idle longer than the access token but shorter than the idle window — recovers silently instead of forcing a login; logout actually ends the session; a leaked access token is worth minutes, not a week; `JWT_SECRET` rotation invalidates access tokens but not sessions, so people are renewed rather than logged out.

**What it costs**: one Prisma model and migration, `cookie-parser` in the API (absent today), `withCredentials` on both console clients (absent today; CORS already answers `credentials: true`, `api/src/main.ts:73, 98`), and the client renewal machinery — which B needed anyway.

---

## 4. What planning must settle (not the spec)

- Reproduce the reporter's screen once against `main` with a token forced to expire (short `JWT_EXPIRES_IN`) and record which producer in §1.5 rendered the text. Expected: the restart banner or an attachment call for a logged-in owner; the `/message/sync` path for a message-only flow.
- Final lifetimes (access token, idle window, absolute maximum) and the cookie's `path`/`domain` for local dev where consoles and API run on different ports of `localhost` (same site → `Lax` still works; `Secure` must be conditional on HTTPS).
- Where the session id claim is read, if anywhere, outside `/auth/refresh` — the intent is *no* per-request DB check; if instant revocation is ever required, that is the one place to add it.
- Migration for already-signed-in people: an old 7-day JWT with no session cookie must fall through to the session-ended state once, not loop.
- Dev fallback secrets: align the four `JwtModule` fallbacks or make the API refuse to start without `JWT_SECRET` outside tests.

---

## 5. Phase 0 decisions (for `plan.md`)

All Technical Context unknowns resolved. Code references verified against `origin/main` @ `35fcc0c`.

### R0. Where the session lives in the API

- **Decision**: a new slice `api/src/slices/user/session/` (prisma model, abstract gateway, Prisma gateway, mapper, `SessionService`), mirroring `user/apiKey`. `AuthService` gets the session service injected and grows `refresh()` and `logout()`; `issueToken()` becomes `issueSession()` and is the *only* console-token minter — `InitService` (`api/src/slices/setup/init/domain/init.service.ts:47-56`) stops duplicating it and calls `AuthService` instead (`InitModule` imports `AuthModule`, which is `@Global()` anyway).
- **Rationale**: one place to mint, one place to verify; the init duplicate is exactly the kind of drift that produced four `JwtModule` fallbacks.
- **Alternatives**: put the model inside `user/auth` (rejected: auth has no data layer today and the slice convention is one model per slice); a global `APP_GUARD` (rejected: out of scope, changes every route's default).

### R1. Session secret and storage

- **Decision**: `rs_` + 32 random bytes base64url, hashed with unsalted SHA-256 hex (`secretHash @unique`), exactly the `ApiKeyService` pattern (`api/src/slices/user/apiKey/domain/apiKey.service.ts:11-54`). The private `hash()` there is extracted to a shared `hashSecret()` in `user/common` (or duplicated if the extraction touches too much — planner's call, both are two lines).
- **Rationale**: the server must not be able to read a session secret back; a DB leak must not hand out live sessions. 256 bits makes a lookup-by-hash safe without a salt.
- **Alternatives**: plaintext like share links (rejected: share links are chat-only grants; a session is the account); bcrypt (rejected: no lookup by hash possible, and needless cost per refresh).

### R2. Cookie transport

- **Decision**: `ranch_session`, `HttpOnly`, `SameSite=Lax`, `Path=/auth`, `Secure` from `SESSION_COOKIE_SECURE` (default `true`; `.env.example` sets `false`), `Max-Age` = idle window, re-set on every refresh. Parsed with `cookie-parser` (new dependency, wired in `api/src/main.ts`). Consoles send `withCredentials: true` on the axios instance (currently absent in both, `app/slices/setup/api/plugins/api.ts`, `admin/slices/setup/api/plugins/apiBaseUrl.ts`).
- **Rationale**: `Path=/auth` keeps the cookie off every non-auth request, including the bridle `/api/agent/*` routes and the per-agent CORS branch. `Lax` works because every deployed console shares the site `cleanslice.org` with `api.ranch.cleanslice.org` (`k8s/deploy/30-api.yaml:53-54, 161`) and dev is all `localhost` (ports differ, site is the same). `NODE_ENV` is `dev` in the cluster (`30-api.yaml:44-45`), so `Secure` cannot be derived from it — hence the explicit flag. CORS already answers `credentials: true` on both branches (`api/src/main.ts:73, 98`).
- **Alternatives**: `SameSite=None` as in skyhunter (rejected: unnecessary here and weaker); `Path=/` (rejected: cookie would ride on every request for nothing); `trust proxy` + `req.secure` (rejected: adds proxy config for what one env var does).

### R3. Access-token lifetime, claims, and who is affected

- **Decision**: `JWT_EXPIRES_IN` default `7d` becomes `15m` in `auth.module.ts`, `init.module.ts`, `.env.example`, `k8s/deploy/30-api.yaml:66-67`. Payload gains `sid?: string` (`auth.types.ts`). `AuthDto` gains `expiresIn: number` (seconds) so consoles never parse the JWT.
- **Rationale**: only `issueToken` and the init duplicate inherit the default (API audit §9); agent service (`365d`), embed (`15m`/`7d` cap), extension (`30d`) and browserless (`15m`) tokens all pass explicit `expiresIn` and keep working. `sid` is informational (logs, future revocation) and **not** required by any guard, so agent tokens without it keep passing.
- **Alternatives**: client-side `exp` decoding (rejected: an extra helper in two consoles and clock-skew bugs; `expiresIn` from the server is authoritative).

### R4. Machine-readable 401s

- **Decision**: `AuthErrorCodes` in `auth.types.ts` (`TOKEN_MISSING`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_MISSING`, `SESSION_EXPIRED`, `SESSION_INVALID`) and a helper `unauthorized(code)` returning `new UnauthorizedException({ code, message })`, following the `ShareLinkErrorCodes` object-body precedent (`shareLink.types.ts:57-65`). `TokenExpiredError` is detected by `err.name === 'TokenExpiredError'` (no direct `jsonwebtoken` import; it is only transitive via `@nestjs/jwt`). Applied in `JwtAuthGuard`, `BridleChatAuthGuard`, and the bridle `/message` requester resolution; the WS handler maps the same distinction onto `bridle_error.code` (`TOKEN_EXPIRED` new, `INVALID_TOKEN` kept). Swagger documents the codes in the `@ApiUnauthorizedResponse` description, as the share codes do.
- **Rationale**: FR-007/SC-007; the existing guard specs assert on `message` (`bridleChatAuth.guard.spec.ts:96-99`) and must be updated to assert on `code`.
- **Alternatives**: a custom exception filter (rejected: none exists; an object body already does the job).

### R5. Bridle `/message` routes stop downgrading a bad bearer

- **Decision**: in `BridleController.resolveRequester` (`bridle.controller.ts:166-188`) a bearer that fails verification is fatal **unless share headers were also offered** — the exact rule `BridleChatAuthGuard` already applies (`bridleChatAuth.guard.ts:80-82`). No bearer and no share headers stays anonymous. Same rule in `requireChannelAccess`.
- **Rationale**: FR-008. Embed widgets on public agents send no console bearer for anonymous visitors, so they are unaffected; an embed widget with an *expired embed token* now gets a 401 it can act on (re-mint) instead of a silent identity change, which is the correct signal.
- **WS handshake**: the public-agent silent downgrade in `bridleClientWs.handler.ts:148-154` is **kept** for tokens that fail (embed SDK compatibility — the widget has no refresh path yet), but the non-public branch rejects with `TOKEN_EXPIRED` / `INVALID_TOKEN` so the admin console can react. Recorded as a follow-up for the embed SDK.

### R6. Refresh and logout endpoints

- **Decision**: `POST /auth/refresh` (no body; cookie) returns `AuthDto { accessToken, expiresIn, user }`; `POST /auth/logout` (cookie) returns `LogoutResultDto { revoked: boolean }`, always 200, always clears the cookie. Refresh returns the same DTO as login so the consoles have one code path for "I now hold a token", and boot needs **one** request instead of refresh + `/auth/me`.
- **Rationale**: FR-002, FR-004, SC-003. No session rotation on refresh (section 3.2).
- **Alternatives**: `GET /auth/refresh` (rejected: state-changing, and `GET` with cookies invites CSRF-shaped caching); 204 logout (rejected: the envelope interceptor expects a body).

### R7. Housekeeping without a scheduler

- **Decision**: on every login, delete that user's rows with `absoluteExpiresAt < now` or `revokedAt < now - 30d`. No cron.
- **Rationale**: bounded per user, zero infrastructure; the table cannot grow past (users x sessions in 30 days).

### R8. Console token storage and request plumbing

- **Decision**: the access token lives **in memory only** (Pinia); the `access_token` cookie is removed from both consoles (`app/slices/user/auth/stores/auth.ts:19-23`, `admin/slices/user/auth/stores/auth.ts:14-18`). A **request** interceptor on the shared axios instance attaches `Authorization` from the store on every attempt (replacing `handleApiAuthentication`'s global `setConfig` in app and the per-request `document.cookie` regex in admin, `apiBaseUrl.ts:23-34`), and skips requests that carry `X-Share-Token` so the share page's explicit `Authorization: null` stays untouched (`app/slices/bridle/data/bridle.gateway.ts:42-51`).
- **Rationale**: FR-006 — a retried request, an XHR upload and the socket all read the current value, never a captured one; removing the JS-readable cookie removes the last long-lived credential from page-readable storage. Both consoles are `ssr: false`, so nothing needs the cookie for hydration; boot asks `/auth/refresh` instead.
- **Alternatives**: keep the cookie with a 15-minute `maxAge` (rejected: still JS-readable, and boot must call refresh anyway).

### R9. Boot, proactive renewal, dedup (ported from skyhunter)

- **Decision**: `init()`/`hydrate()` call `/auth/refresh` first; success gives token + user from the same response; `SESSION_*` means logged out silently (no dialog: nobody was in the middle of anything). After every token acquisition arm `setTimeout(refresh, expiresIn*1000 - 60_000)`; `visibilitychange` to visible refreshes if inside the buffer, else re-arms; one module-scope in-flight promise shared by timer, visibility handler and the 401 path; a network failure during refresh keeps the current token and re-arms a short retry. Explicit logout clears the timer and discards a pending result.
- **Rationale**: FR-005; the skyhunter store (`E:/code/sh/skyhunter/app/slices/user/auth/stores/auth.ts`) is the reference, minus its "cookie present means authenticated" shortcut.

### R10. Reactive path: 401, refresh, retry once

- **Decision**: the axios **response** interceptor (app `plugins/api.ts:17-49`, admin `apiBaseUrl.ts:41-58`) handles `401` outside `/auth/*` and outside the share page: on `TOKEN_EXPIRED` **or** `TOKEN_INVALID` with no `_retried` mark it awaits `auth.refresh()` and re-issues the original config once with the new header. If the refresh fails it calls `auth.endSession(code)`. `TOKEN_MISSING` keeps today's logged-out redirect. Admin's raw `fetch`/XHR calls in the bridle store and provider (`stores/bridle.ts:224-249, 258-305`, `Provider.vue:216-219`) go through a small `authedFetch()` helper in `user/auth` that applies the same once-retry rule.
- **Refinement of FR-007**: `TOKEN_INVALID` also gets one refresh attempt, because a rotated `JWT_SECRET` invalidates the access token while the session is still live (spec Story 2 scenario 3). The session-ended state is reached only when *refresh* fails. Spec FR-007 is reworded accordingly.

### R11. The session-ended state

- **Decision**: an **in-place dialog**, not a redirect. Each console gets `SessionEndedProvider` in its `user/auth` slice, mounted once in the default layout, driven by `auth.sessionEnded`. It shows product copy and the existing login form (`app/slices/user/auth/components/auth/common/Form.vue`; admin's `authLogin` form); success applies the new token, clears the flag, and leaves the page exactly as it was (composer draft, conversation, scroll). The interceptor sets the flag at most once (idempotent), so concurrent failures produce one dialog (FR-009). App has no dialog primitive (`app/slices/setup/theme/components/ui/` has only `badge/`), so the overlay is hand-rolled like the restart overlay (`agent/chat/Provider.vue:284-323`); admin can use its `reka-ui` `AlertDialog` primitives (`admin/slices/common/components/confirm/Dialog.vue`).
- **Rationale**: FR-009/FR-010 with no draft persistence and no `redirect` plumbing (admin has none, `authLogin/Provider.vue:11`). The cold-start `/login` page is unchanged.
- **Alternatives**: redirect with `?redirect=` (rejected: loses the composer draft and needs admin redirect support); toast (rejected: `vue-sonner` is not even mounted in `app/`).
- **Copy** (app, via `en.json` + `i18n:sync`): `account.session_ended_title` "Your session has ended", `account.session_ended_body` "Sign in to continue where you left off." Admin is English-only.

### R12. Admin socket

- **Decision**: `connect()` in `admin/slices/bridle/stores/bridle.ts:436-449` passes `auth` as a **function** (`auth: (cb) => cb({ token: useAuthStore().accessToken, agentId, capabilities })`) so every socket.io reconnect uses the current token; before `socket.connect()` and in `reset()` (`Provider.vue:440-449`) it awaits `auth.ensureFresh()` when inside the buffer; a `bridle_error` listener handles `TOKEN_EXPIRED` / `INVALID_TOKEN`: refresh once, `socket.connect()`, else `endSession`. The `token` prop is removed from `BridleProvider` (`Provider.vue:16-51`) and its two callers (`agent/chat/Tab.vue:119-133`, `rancher/Provider.vue:355-362`); store actions that took `token` read the auth store.
- **Rationale**: FR-011, SC-005. `socket.io-client ^4.8` supports function-valued `auth`.

### R13. Migration of already-signed-in people

- **Decision**: nothing special. An old 7-day JWT in the removed cookie is simply not read any more; boot calls `/auth/refresh`, gets `SESSION_MISSING`, and the person signs in once. Agent runtimes hold 365-day service tokens without `sid` and are untouched.

### R14. Tests

- **Decision**: API uses Jest specs colocated with hand-rolled stubs (`bridleChatAuth.guard.spec.ts:26-55` pattern): `session.service.spec.ts` (create/refresh/revoke/prune/live rules), `auth.service.spec.ts` (new: refresh/logout, cookie value never returned in the body), `jwtAuth.guard.spec.ts` (new: the three codes), `bridleChatAuth.guard.spec.ts` + `bridle.controller.spec.ts` updated (bearer-fails-without-share is a 401 code), `bridleClientWs.handler.spec.ts` updated (`TOKEN_EXPIRED`). Consoles have no test runner (`app`/`admin` `test` scripts are echo stubs); verification = `typecheck` + `i18n:check` + the quickstart.
