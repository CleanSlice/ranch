# Sessions and authentication

## Console sessions (`app` + `admin`)

Signing in to either console establishes two credentials with different jobs:

- a **session** — an opaque `rs_…` secret the API stores hashed in the
  `Session` table and hands to the browser as an httpOnly cookie
  `ranch_session` scoped to `Path=/auth` (so it never rides on ordinary
  requests). It has a sliding inactivity window (`SESSION_IDLE_DAYS`, 7) and a
  hard ceiling (`SESSION_ABSOLUTE_DAYS`, 30); `Secure` follows
  `SESSION_COOKIE_SECURE` (true in the cluster, false for plain-http dev);
- a short-lived **access token** — the JWT the console attaches as
  `Authorization: Bearer` (`JWT_EXPIRES_IN`, 15 minutes), kept in memory only.

Each console also keeps a note of its own in `localStorage` (`ranch.session`),
set when a session is applied and cleared when the token is dropped for good.
It holds no secret; it only tells the console on boot that `/auth/refresh` is
worth asking, so an anonymous visit makes no refresh call and collects no 401
(CLEAN-178). It has to live on the console's origin: the API's host is not the
console's host, so a cookie the API sets is not readable there (CLEAN-182).

`POST /auth/refresh` (no body, cookie in) renews the access token from the
session alone — it works after the token has expired — and slides the
inactivity window. `POST /auth/logout` revokes the session and clears the
cookie. The consoles renew proactively a minute before expiry, when a hidden
tab becomes visible, and once more reactively when a request comes back 401,
then retry that request once; when the session itself cannot be renewed they
show a single in-place "Your session has ended" dialog with the login form,
leaving the page and any unsent message intact.

Every 401 carries a machine-readable `code`:

| `code` | Meaning | Console behaviour |
|---|---|---|
| `TOKEN_MISSING` | no bearer | logged out |
| `TOKEN_EXPIRED` | bearer `exp` passed | refresh, retry once |
| `TOKEN_INVALID` | bad signature / unusable subject | refresh once, then session ended |
| `SESSION_MISSING` / `SESSION_EXPIRED` / `SESSION_INVALID` | from `/auth/refresh` | session ended (silently logged out on boot) |

The bridle chat routes reject a failing bearer the same way instead of quietly
treating the caller as an anonymous visitor; a request with **no** credentials
still gets the anonymous throwaway channel, and share-link headers still win
over a dead console token. Agent service, embed and browser-extension tokens
set their own lifetimes and are unaffected. Contract and rationale:
[`specs/012-jwt-token-refresh/contracts/session-api.md`](../../specs/012-jwt-token-refresh/contracts/session-api.md).

## Authentication surface (`api`)

Every route requires a bearer JWT unless it is marked `@Public()`.
`JwtAuthGuard` is registered as a global guard in `api/src/app.module.ts`, and
`api/src/slices/user/auth/guards/publicRoutes.spec.ts` pins the exact set of
`@Public()` routes per controller: adding or removing one fails the test until
the list is updated and the PR says why that caller cannot hold a token.
`@Public()` lifts the JWT requirement alone — routes that authenticate with an
API key (`rk_…`), the runtime key (`x-bridle-api-key`), an A2A peer credential
(`ap_…`), a share token or a signed open link keep their own guard.

Three kinds of JWT exist, told apart by their claims:

| Token | Minted by | Opens |
|---|---|---|
| console login (`sid`) | `/auth/login`, `/auth/refresh` | everything its role allows |
| agent service (`sub: agent:<id>`) | the agent runtime bootstrap | the agent's own routes |
| embed (`typ: embed`) | `POST /auth/embed/token` with an `embed:mint` key | the chat only: `/ws/client`, `/api/agent/*` |

An embed token is rendered into a customer's page and read by every visitor of
that page, so the platform guards refuse it with `401 TOKEN_INVALID` whatever
roles it carries; inside the chat it still maps to its `sub` (or to the `admin`
conversation for `embed:mint-admin` keys). Its `sub` is validated on mint:
letters, digits, dash and underscore, at most 128 characters, never `admin`,
never prefixed `anon-`, `share-` or `http-`, never an existing user id.

Transcript routes (`GET`/`DELETE /api/agent/:id/transcript`, `POST
…/transcript/archive`) decide per channel: `share-…` answers to that visitor
or a console user, `anon-…`/`http-…` stay open (random ids the hub mints for
credential-less visitors), and a channel named by a JWT `sub` answers only to a
bearer with that `sub` or to an admin — `403 CHANNEL_FORBIDDEN` otherwise, the
same whether the channel exists or not. Background and decisions:
[`specs/022-embed-token-hardening/`](../../specs/022-embed-token-hardening/) (CLEAN-175).
