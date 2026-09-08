# Contract: session API (CLEAN-72)

All 2xx bodies are wrapped by the API's standard envelope `{ success, data }`; shapes below are the `data` payload. 401 bodies are **not** wrapped (raw Nest exception body). DTOs carry `@ApiProperty` so `bun run generate:swagger` then `cd app && bun run build:api` / `cd admin && bun run build:api` regenerate `AuthService.authControllerRefresh` / `authControllerLogout` in both SDKs. Model and cookie attributes: [data-model.md](../data-model.md).

## `AuthController` (`@Controller('auth')`, no global prefix)

| Method | Path | Guard | Request | Response `data` | Errors |
|---|---|---|---|---|---|
| `POST` | `/auth/login` | none | `LoginDto` | `AuthDto` + **`Set-Cookie: ranch_session`** | 401 bad credentials (unchanged), 403 disabled |
| `POST` | `/auth/register` | none | `RegisterDto` | `AuthDto` + `Set-Cookie` | unchanged |
| `POST` | `/auth/refresh` | none (cookie) | no body; `Cookie: ranch_session=rs_…`; `withCredentials` | `AuthDto` + `Set-Cookie` (same secret, new `Max-Age`) | 401 `SESSION_MISSING` / `SESSION_EXPIRED` / `SESSION_INVALID` |
| `POST` | `/auth/logout` | none (cookie) | no body; cookie optional | `LogoutResultDto` + `Set-Cookie` clearing | never 401; 200 even without a cookie |
| `GET` | `/auth/me` | `JwtAuthGuard` | bearer | `UserDto` | 401 with a code (below) |
| `POST` | `/setup/init` | none | `CreateOwnerDto` | `AuthDto` + `Set-Cookie` | unchanged |

`AuthDto` (one new field)

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "user": { "id": "…", "name": "…", "email": "…", "role": "Owner", "status": "active" }
}
```

`expiresIn` is the access-token lifetime in **seconds** at issue time. The session secret is never in a body.

`LogoutResultDto`

```json
{ "revoked": true }
```

`revoked` is `false` when no live session matched the cookie (already gone); the cookie is cleared either way.

### Access-token claims

```json
{ "sub": "user-…", "email": "…", "roles": ["Owner"], "sid": "<Session.id>", "iat": 0, "exp": 0 }
```

`sid` is present on console tokens only. Guards do not require it.

## 401 body (every guarded route)

```json
{ "code": "TOKEN_EXPIRED", "message": "Access token expired" }
```

(Nest serialises the object passed to `UnauthorizedException` as-is; the HTTP status is 401 and there is no `statusCode` field in the body.)

| `code` | Meaning | Console behaviour |
|---|---|---|
| `TOKEN_MISSING` | no `Authorization: Bearer` | logged out |
| `TOKEN_EXPIRED` | signature fine, `exp` passed | refresh, retry once |
| `TOKEN_INVALID` | any other verification failure | refresh once (secret rotation), then session-ended |
| `SESSION_MISSING` | `/auth/refresh` without the cookie | boot: logged out; in use: session-ended |
| `SESSION_EXPIRED` | idle or absolute deadline passed, or revoked | session-ended |
| `SESSION_INVALID` | unknown hash, or user gone / disabled | session-ended |

Swagger: `@ApiUnauthorizedResponse({ description })` lists the codes in prose, as the share-link 403s do.

## Bridle chat routes (`/api/agent/:agentId/…`)

| Situation | `POST /message`, `POST /message/sync` | attachment routes (`BridleChatAuthGuard`) |
|---|---|---|
| valid bearer | `kind: 'jwt'` (unchanged) | unchanged |
| bearer fails, **no** share headers | **401 `TOKEN_EXPIRED` / `TOKEN_INVALID`** (was: silent anonymous) | 401 with code (was: message string only) |
| bearer fails, share headers offered | share branch decides (403 codes, unchanged) | unchanged |
| no bearer, no share headers | anonymous `http-…` / `sync-…` (unchanged) | 401 `TOKEN_MISSING` |

## WebSocket `/ws/client` handshake

`bridle_error` payload `{ code, agentId, origin }` before disconnect:

| `code` | When |
|---|---|
| `TOKEN_EXPIRED` | **new** — token present, `exp` passed, agent not public |
| `INVALID_TOKEN` | token present, any other failure, agent not public (unchanged name) |
| `MISSING_TOKEN`, `MISSING_AGENT_ID`, `ORIGIN_NOT_ALLOWED` | unchanged |

Public agents keep the silent anonymous downgrade for a failing token (embed SDK compatibility; follow-up).

## Cookie

`Set-Cookie: ranch_session=rs_…; Path=/auth; Max-Age=604800; HttpOnly; SameSite=Lax[; Secure]`

Clearing: same attributes with `Max-Age=0`. `Secure` follows `SESSION_COOKIE_SECURE`.

## Environment

| Variable | Default | Where set |
|---|---|---|
| `JWT_EXPIRES_IN` | `15m` (was `7d`) | `.env.example`, `k8s/deploy/30-api.yaml` |
| `SESSION_IDLE_DAYS` | `7` | same |
| `SESSION_ABSOLUTE_DAYS` | `30` | same |
| `SESSION_COOKIE_SECURE` | `true` in code; `.env.example` sets `false` | same |

## Console-side contract (both consoles)

| Piece | Behaviour |
|---|---|
| axios instance | `withCredentials: true`; request interceptor sets `Authorization` from the auth store unless the request carries `X-Share-Token` |
| response interceptor | 401 + `TOKEN_EXPIRED`/`TOKEN_INVALID` + not `/auth/*` + not share page + not retried → `await auth.refresh()` → retry once; refresh failure → `auth.endSession(code)`; `TOKEN_MISSING` → logged-out redirect |
| auth store | `accessToken` (memory), `expiresAt`, `user`, `sessionEnded`, `sessionEndedCode`; actions `init`/`hydrate`, `login`, `refresh` (deduped), `ensureFresh` (refresh if within 60 s of expiry), `endSession`, `logout` (calls `/auth/logout`, clears timer) |
| `SessionEndedProvider` | mounted once in the default layout; visible while `sessionEnded`; contains the login form; success clears the flag in place |
| admin socket | `auth` as a function reading the store; `ensureFresh()` before connect; `bridle_error` `TOKEN_EXPIRED`/`INVALID_TOKEN` → refresh + `connect()` once, then `endSession` |
