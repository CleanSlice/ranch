# Contract: authentication surface after CLEAN-175

## Any route not on the public allowlist

| Caller | Before | After |
|---|---|---|
| No `Authorization` header | 200 on the 18 unguarded controllers, 401 elsewhere | 401 `{ code: 'TOKEN_MISSING' }` everywhere |
| Console login JWT | 200 | 200 (unchanged) |
| Agent service JWT (`sub: agent:<id>`) | 200 where allowed | 200 where allowed (unchanged) |
| Embed JWT (`typ: 'embed'`), any roles | 200 | 401 `{ code: 'TOKEN_INVALID' }` |
| Expired or forged JWT | 401 `TOKEN_EXPIRED` / `TOKEN_INVALID` | unchanged |

The 401 body keeps the existing shape `{ statusCode, code, message }` from
`unauthorized()` in `auth.types.ts`. No new error code is introduced for the
embed case; the server log line says `embed token outside chat` with the `sub`
and the route, never the token.

## Routes on the public allowlist

Unchanged behaviour. Their own guard (API key, runtime key, peer credential,
extension token, share token, open link) still authenticates; `@Public()` only
removes the JWT requirement. Health, init, login, register, refresh, logout keep
working with no credential.

## Chat surface (`/api/agent/*`, `/ws/client`)

Unchanged for console users, share visitors and anonymous visitors. Embed
tokens (plain or admin) keep being accepted here; this is the only surface
where they are.

## MCP endpoints (`/mcp/*`)

Guarded by the same `JwtAuthGuard` class; embed tokens are refused with the
same 401 as above.
