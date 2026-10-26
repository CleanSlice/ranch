# Contract: `POST /auth/embed/token` after CLEAN-175

Auth: `Authorization: Bearer rk_…` with scope `embed:mint` (unchanged).
Route stays `@Public()` so the API key, not a JWT, is what is checked.

## Request

```json
{ "sub": "wslid-A1234567", "email": "optional", "roles": ["User"], "expiresIn": "1h" }
```

`sub` rules (new):

| Value | Result |
|---|---|
| `wslid-A1234567`, `user_42`, 128 chars of `[A-Za-z0-9_-]` | 200 |
| `""`, 129+ chars | 400 |
| `admin` | 400 |
| `anon-1`, `share-x`, `http-y` | 400 |
| `../x`, `a/b`, `a\b`, `agent:x`, `a b` | 400 |
| equal to an existing user's id | 400 |

400 body is the standard class-validator response (`message` is an array
naming `sub`), except the user-id collision which is a `BadRequestException`
with message `sub must not be an existing user id`. Neither body echoes which
user ids exist beyond the one the caller already supplied.

`roles`, `expiresIn`, the `Owner`/`Admin` stripping without
`embed:mint-admin`, and the 7-day cap with it: unchanged.

## Response

```json
{ "token": "<jwt>", "expiresAt": "2026-10-26T13:00:00.000Z" }
```

The token payload now carries `typ: "embed"` next to `sub`, `email`, `roles`,
`iat`, `exp`. Integrators do not read the payload; nothing else in the response
changes. The OpenAPI schema of the DTO gains the pattern and max length only.
