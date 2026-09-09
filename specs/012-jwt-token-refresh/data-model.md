# Data model: session + short access token (CLEAN-72)

Decisions behind this shape: [research.md](./research.md) §3.2 and R1–R4.

## Session (new table)

`api/src/slices/user/session/session.prisma`, composed by `prisma-import` like every slice model. Follows the `ApiKey` precedent: **no Prisma relation to `User`** (the repo declares none; `userId` is "FK by convention", `apiKey.prisma:9`), secret stored as an unsalted SHA-256 hex hash like `ApiKey.keyHash`.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Also the `sid` claim in the access token. |
| `userId` | `String` | `@@index`. Owner of the session. No FK; a refresh re-reads the user and refuses when it is gone or `disabled`. |
| `secretHash` | `String @unique` | SHA-256 hex of the cookie value `rs_` + 32 random bytes base64url (≈256 bits). Plaintext is never stored or logged. |
| `expiresAt` | `DateTime` | **Sliding** inactivity deadline. Set to `now + SESSION_IDLE_DAYS` on create and on every successful refresh. `@@index` (cleanup). |
| `absoluteExpiresAt` | `DateTime` | `createdAt + SESSION_ABSOLUTE_DAYS`. Never moved. |
| `lastSeenAt` | `DateTime @default(now())` | Touched on every refresh. Diagnostic only. |
| `revokedAt` | `DateTime?` | `null` ⇒ live. Set by logout (and by any future "sign out everywhere"). |
| `userAgent` | `String?` | First 256 chars of the `User-Agent` at creation. Diagnostic only. |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

A session is **live** iff `revokedAt IS NULL AND expiresAt > now AND absoluteExpiresAt > now`.

Migration: `api/prisma/migrations/20260908120000_user_session/migration.sql` — additive (new table, two indexes, one unique), safe on an existing database.

### Lifecycle

```
login / register / setup-init ──▶ live ──refresh──▶ live (expiresAt slid, lastSeenAt touched)
                                   │
                                   ├──logout──────────────▶ revoked   (revokedAt = now)
                                   ├──expiresAt passes────▶ expired   (idle)
                                   └──absoluteExpiresAt───▶ expired   (absolute)
```

| Action | Precondition | Effect |
|---|---|---|
| create | user exists and is not `disabled` | insert; cookie set with the plaintext secret |
| refresh | cookie present, hash matches a live row, user exists and not `disabled` | `expiresAt = now + idle`, `lastSeenAt = now`; cookie re-set (same secret, new `Max-Age`); new access token with `sid = id` |
| refresh | no cookie | 401 `SESSION_MISSING` |
| refresh | hash unknown, or user gone/disabled | 401 `SESSION_INVALID` |
| refresh | row found but expired (either deadline) or revoked | 401 `SESSION_EXPIRED` |
| logout | cookie present and row found | `revokedAt = now`; cookie cleared |
| logout | no cookie / unknown | no-op; cookie cleared; 200 |
| prune | on login for that user | delete rows with `absoluteExpiresAt < now` or `revokedAt < now − 30d` (bounded housekeeping; no cron) |

No secret rotation on refresh (research §3.2): tabs sharing the cookie must not race.

## Access token (existing JWT, two changes)

`IAuthTokenPayload` (`api/src/slices/user/auth/domain/auth.types.ts`) gains one optional claim:

| Claim | Type | Set by |
|---|---|---|
| `sub` | `string` | unchanged |
| `email` | `string` | unchanged |
| `roles` | `UserRoleTypes[]` | unchanged |
| `sid` | `string?` | **new** — `Session.id` for console tokens issued by login / register / setup-init / refresh. Absent on agent service tokens, embed tokens, extension tokens. |

Default lifetime `JWT_EXPIRES_IN` moves from `7d` to `15m` (`.env.example`, `k8s/deploy/30-api.yaml`). Only the two console issuers inherit the default (`auth.service.ts:117-127`, `init.service.ts:47-56`); every other minter passes an explicit `expiresIn` and is unaffected (research §1.1, API audit §9).

`sid` is **not** checked per request — the guard stays stateless; revocation lands at the next refresh (≤ 15 min). If instant revocation is ever required, the guard is the one place to add a lookup.

## Cookie

| Attribute | Value | Why |
|---|---|---|
| name | `ranch_session` | distinct from the consoles' own cookies |
| value | `rs_…` plaintext secret | hashed at rest |
| `HttpOnly` | yes | console code never reads it |
| `Secure` | `SESSION_COOKIE_SECURE` (default `true`; `.env.example` sets `false` for plain-http local dev) | `NODE_ENV` is `dev` even in the cluster (`30-api.yaml:44-45`), so it cannot drive this |
| `SameSite` | `Lax` | consoles and API share the site `cleanslice.org`; local dev is `localhost` |
| `Path` | `/auth` | the cookie is only ever needed by `/auth/refresh` and `/auth/logout`; it stays off every other request |
| `Max-Age` | `SESSION_IDLE_DAYS` in seconds, re-set on every refresh | mirrors the sliding deadline |

`/setup/init` sets the same cookie with `Path=/auth` (a `Set-Cookie` may name any path).

## Rejection reasons (new constant set)

`api/src/slices/user/auth/domain/auth.types.ts`:

| Code | Emitted by | Client action |
|---|---|---|
| `TOKEN_MISSING` | `JwtAuthGuard`, `BridleChatAuthGuard`, bridle `/message` routes when nothing usable is offered | treat as logged out |
| `TOKEN_EXPIRED` | same, when `verify` throws `TokenExpiredError` | refresh, retry once |
| `TOKEN_INVALID` | same, any other `verify` failure | session-ended state |
| `SESSION_MISSING` | `/auth/refresh` | logged out (boot) / session-ended (in use) |
| `SESSION_EXPIRED` | `/auth/refresh` | session-ended |
| `SESSION_INVALID` | `/auth/refresh` | session-ended |

Wire shape (Nest `UnauthorizedException` with an object body, serialised as-is): `{ "code": "TOKEN_EXPIRED", "message": "Access token expired" }` with HTTP status 401. The WS handler's `bridle_error` uses the same codes (`TOKEN_EXPIRED` added; `INVALID_TOKEN` kept for compatibility with the embed SDK).

## Console-side state (no persistence beyond memory)

| Item | app | admin |
|---|---|---|
| access token | Pinia `auth` store, memory only (the `access_token` cookie is dropped; boot always refreshes) | same |
| refresh timer | module-scope `setTimeout` at `exp − 60 s` | same |
| in-flight refresh | module-scope `Promise \| null` | same |
| session-ended | `auth.sessionEnded: boolean` + the reason code; the page is not left | same |
| return-to-place | not needed: the session-ended state is an in-place dialog, so page, chat and composer draft survive | same |
