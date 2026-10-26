# Data model: CLEAN-175

No database change. Everything below is a claim in a signed token, a rule on a
request, or a pinned list in a test.

## Auth token payload (`IAuthTokenPayload`)

| Field | Console login | Agent service | Embed (new) |
|---|---|---|---|
| `sub` | user id | `agent:<agentId>` | integrator-chosen, validated (see below) |
| `email` | user email | `agent-<id>@ranch.local` | optional, may be `''` |
| `roles` | `[user.role]` | `[Agent]` or `[Owner]` | `[]`, or `[User]`; `Owner`/`Admin` only with `embed:mint-admin` |
| `sid` | session id | absent | absent |
| `typ` | absent | absent | `'embed'` |

Rules:

- `typ === 'embed'` is set only by `AuthService.mintEmbedToken`.
- `JwtAuthGuard` and `A2aCardGuard` refuse a payload with `typ === 'embed'`
  (401 `TOKEN_INVALID`). The chat verifiers (`BridleChatAuthGuard`,
  `BridleController.resolveRequester`, `bridleClientWs.handler`) accept it.
- Nothing else reads `typ`; a token without it behaves exactly as today.

## Embed subject (`EmbedTokenDto.sub`)

- Pattern: `^(?!admin$)(?!anon-)(?!share-)(?!http-)[A-Za-z0-9_-]{1,128}$`.
- Must not equal an existing user id (`IUserGateway.findById(sub)` is null).
- Becomes the chat `clientId`, the transcript channel and the session file name
  `data/sessions/bridle:<sub>.jsonl` on the runtime.

## Chat channel ownership

A channel name has exactly one namespace, decided by prefix:

| Prefix | Minted by | Owner for transcript read/delete/archive |
|---|---|---|
| `share-` | share-link service | the visitor with the matching share headers, or any JWT caller (unchanged) |
| `anon-` | WebSocket handshake | nobody; open as today (unchanged) |
| `http-` | HTTP fire-and-forget fallback | nobody; open as today (unchanged) |
| `admin` | `clientIdFromJwtPayload` for Owner/Admin | JWT callers whose `clientId` is `admin` |
| anything else | JWT `sub` (console user id or embed subject) | JWT caller with `clientId === channel`, or a JWT caller with `clientId === 'admin'` |

Refusal: 403 `{ code: 'CHANNEL_FORBIDDEN' }`, identical whether the channel
exists or not; evaluated before any file is read.

## Public route allowlist

A map `controller file (relative to api/src) → number of @Public() decorators`
kept in `publicRoutes.spec.ts`. The test fails in both directions (an added
exemption and a removed one). The expected contents are listed in
`research.md` R0 and pinned by the implementation task.

Classification rule for a route under the global guard:

| Route authenticates by | Marking |
|---|---|
| user JWT (`JwtAuthGuard`, optionally `RolesGuard`) | nothing to add |
| API key `rk_` (`ApiKeyGuard` + `ScopesGuard`) | `@Public()` on the route |
| runtime key `x-bridle-api-key` (`BridleApiKeyGuard`) | `@Public()` on the route or class |
| peer credential `ap_` (`A2aCardGuard`, `A2aPeerGuard`) | `@Public()` on the route |
| extension token / open link / share token verified by hand | `@Public()` on the route |
| nothing, must work before login (health, init, login, register, refresh, logout) | `@Public()` on the route |
| chat surface (`bridle.controller.ts`, mixed JWT / share / anonymous) | `@Public()` on the class; handlers decide |
