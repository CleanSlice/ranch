# Quickstart validation: CLEAN-72 session renewal + honest expiry

Prerequisites: local stack per `README.md` (`make dev`, or `make dev-api` + `make dev-app` + `make dev-admin`; a running agent pod is needed for real replies). Contracts: [contracts/session-api.md](./contracts/session-api.md); model: [data-model.md](./data-model.md).

To make expiry observable in minutes, run the API with short lifetimes (values are env-driven, no code change):

```bash
# api/.env.dev
JWT_EXPIRES_IN=90s
SESSION_IDLE_DAYS=0.003        # ≈ 4 min  (the service reads a float of days)
SESSION_ABSOLUTE_DAYS=0.01     # ≈ 15 min
SESSION_COOKIE_SECURE=false
```

## 1. Unit tests (fast loop)

```bash
cd api && bun run test -- session auth jwtAuth bridleChatAuth bridle.controller bridleClientWs chatIdentity
```

Expected green: secret is `rs_` + 43 base64url chars and only its SHA-256 is stored; `refresh` slides `expiresAt`, touches `lastSeenAt`, keeps the same secret; refresh on revoked/idle-expired/absolute-expired rows → `SESSION_EXPIRED`; unknown hash or disabled/missing user → `SESSION_INVALID`; no cookie → `SESSION_MISSING`; logout sets `revokedAt` and is idempotent; prune deletes only rows past absolute expiry or revoked > 30 d; `JwtAuthGuard` → `TOKEN_MISSING` / `TOKEN_EXPIRED` / `TOKEN_INVALID` (body has `code`); `BridleChatAuthGuard` same codes, share branch unchanged; `resolveRequester` with a bad bearer and no share headers rejects with a 401 code instead of `anonymous`; WS handler emits `bridle_error { code: 'TOKEN_EXPIRED' }` for an expired token on a non-public agent and still degrades to `anon-…` on a public one; `AuthDto` carries `expiresIn`; the cookie value never appears in any response body.

## 2. Migration, typecheck, client regen

```bash
cd api && bun run migrate            # creates Session (additive)
cd api && bunx tsc --noEmit && bun run build && bun run generate:swagger
cd app   && bun run build:api && bun run typecheck
cd admin && bun run build:api && bun run typecheck
bun run i18n:sync && bun run i18n:check     # repo root; needs CLAUDE_API_KEY in .env.project
```

Expected: `authControllerRefresh` / `authControllerLogout` in both `sdk.gen.ts`; `AuthDto.expiresIn` typed; typecheck passes; `i18n:check` clean for `user/auth` (`account.session_ended_*`).

## 3. API checks with curl

```bash
# login: token + cookie
curl -si -c jar.txt -X POST localhost:3333/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"…"}'
# expect: 200, data.expiresIn = 90, Set-Cookie: ranch_session=rs_…; Path=/auth; HttpOnly; SameSite=Lax (no Secure locally)

# refresh from the cookie alone (no Authorization header)
curl -si -b jar.txt -c jar.txt -X POST localhost:3333/auth/refresh
# expect: 200, a different accessToken, same cookie value, new Max-Age

# refresh without cookie
curl -si -X POST localhost:3333/auth/refresh      # expect 401 {"code":"SESSION_MISSING"}

# guarded route with an expired token (wait > 90 s after login)
curl -si localhost:3333/auth/me -H "Authorization: Bearer $OLD"   # expect 401 {"code":"TOKEN_EXPIRED"}
curl -si localhost:3333/auth/me -H "Authorization: Bearer garbage" # expect 401 {"code":"TOKEN_INVALID"}
curl -si localhost:3333/auth/me                                    # expect 401 {"code":"TOKEN_MISSING"}

# chat route: expired bearer is no longer anonymous
curl -si -X POST localhost:3333/api/agent/<agentId>/message/sync -H "Authorization: Bearer $OLD" \
  -H 'Content-Type: application/json' -d '{"text":"hi"}'          # expect 401 TOKEN_EXPIRED
curl -si -X POST localhost:3333/api/agent/<agentId>/message/sync \
  -H 'Content-Type: application/json' -d '{"text":"hi"}'          # expect 200 (anonymous, unchanged)

# logout revokes; refresh afterwards fails
curl -si -b jar.txt -c jar.txt -X POST localhost:3333/auth/logout  # expect 200 {"revoked":true}, cookie cleared
curl -si -b jar.txt -X POST localhost:3333/auth/refresh            # expect 401 SESSION_MISSING (cookie gone) —
# re-send the old cookie value by hand → expect 401 SESSION_EXPIRED (revoked)
```

## 4. E2E — user console (`http://localhost:3000`)

1. **Boot**: sign in, open an agent chat. Reload the page → still signed in, no login flash (one `POST /auth/refresh` in the network tab, no `/auth/me`). Application → Cookies shows `ranch_session` for `localhost:3333` with HttpOnly, and **no** `access_token` cookie for `localhost:3000`.
2. **Proactive renewal (US1)**: stay on the chat, keep the tab visible. Around 30 s before the 90-s token expiry a `POST /auth/refresh` fires on its own. Send a message after the original expiry moment → reply arrives, no error, no prompt.
3. **Tab return (US1)**: switch to another tab for ~2 min (past token expiry, inside the 4-min idle window), come back → a refresh fires on `visibilitychange`, then send a message → works.
4. **Reactive retry (US1 / FR-007)**: in DevTools, block `/auth/refresh` temporarily so the timer fails once, unblock, then let the token expire and send a message → one 401 `TOKEN_EXPIRED` on `/message/sync`, one `/auth/refresh`, one retried `/message/sync` (200). No red box in the chat.
5. **Session ended (US2)**: leave the tab hidden for > 4 min (idle window), return, type a draft, send → the in-place "Your session has ended" dialog appears exactly once, the page behind it is unchanged, no raw error text anywhere. Sign in inside the dialog → dialog closes, the chat and the draft are still there, send → works.
6. **Secret rotation (US2 scenario 3)**: change `JWT_SECRET` in `api/.env.dev`, restart the API, come back to the open chat and send → 401 `TOKEN_INVALID` → refresh succeeds (session still live) → message sent, nobody logged out.
7. **Logout (FR-004)**: press sign out → `POST /auth/logout`, cookie cleared, `/login`. Sign in again, then in a second browser profile replay the *previous* cookie value against `/auth/refresh` → 401.
8. **Share page (FR-012)**: with a dead console session in the same browser, open a valid `/share?token=…` link → chat works, no dialog, no redirect; the share requests carry no `Authorization` header and no cookie.
9. **Multi-tab**: two tabs on the console; let both sit past token expiry; return to tab A (refresh), then tab B (its own refresh) → both work, neither shows the dialog.

## 5. E2E — admin console (`http://localhost:3001`)

1. Sign in, open an agent workspace with the live chat. Around 30 s before expiry a refresh fires; after the expiry moment kill the socket (DevTools → offline/online, or restart the API) → the socket reconnects and streaming continues; the network tab shows the new token in the `/ws/client` handshake `auth`. No page reload.
2. Let the idle window lapse with the tab hidden, return → the socket is rejected with `bridle_error { code: 'TOKEN_EXPIRED' }`, one refresh attempt fails, the session-ended dialog appears within 10 s instead of an endless "Chat reconnecting…". Sign in inside the dialog → socket connects, chat usable, no reload.
3. Upload an attachment after a renewal → XHR carries the *new* token, upload succeeds. Restart the agent from the chat header after a renewal → `authedFetch` carries the new token.
4. Chats list / any admin page after token expiry → one 401, one refresh, one retry; no bounce to `/login`.

## 6. Negative checks

- `SESSION_COOKIE_SECURE=true` on plain http locally → the browser drops the cookie and boot lands logged out (expected; documents why the flag exists).
- Agent runtime keeps working through all of the above (365-day service token without `sid`): the agent's MCP calls still pass `JwtAuthGuard`.
- Embed token flow (`POST /auth/embed/token`) unchanged: default `15m`, no cookie.
