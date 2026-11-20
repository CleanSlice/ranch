# Sessions and authentication

## Console sessions (`app` + `admin`)

Signing in to either console establishes two credentials with different jobs:

- a **session** — an opaque `rs_…` secret the API stores hashed in the
  `Session` table and hands to the browser as an httpOnly cookie scoped to
  `Path=/auth` (so it never rides on ordinary requests). The cookie is named
  for the console the sign-in was made in, `ranch_session_admin` or
  `ranch_session_app` (see "A sign-in belongs to its console" below). It has a sliding inactivity window (`SESSION_IDLE_DAYS`, 7) and a
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

### A sign-in belongs to its console

The two consoles are often served from one host, and a cookie belongs to a
host, not to a port or a path prefix. While both used one cookie
`ranch_session`, signing in to one console replaced the other's sign-in, and
each console renewed whatever account was signed in last (CLEAN-236).

- Each console states which one it is on every request:
  `X-Ranch-Console: admin` or `app`, set once in its API client plugin.
- `POST /auth/login`, `/auth/register` and `/setup/init` with that header
  create a session for that console (`Session.surface`) and set
  `ranch_session_<console>`. Without the header they return the access token
  and set no cookie: that is a script signing in for a token, and nothing a
  console can renew.
- `POST /auth/refresh` reads only the named console's cookie and renews only
  a session made for that console: `401 SESSION_INVALID` otherwise, and
  without the header. `POST /auth/logout` ends that console's session alone.
- The old `ranch_session` cookie is never read and is cleared when seen, so
  everybody signs in once more after the upgrade.

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
roles it carries; inside the chat it is its `sub`, also when it was minted
with administrator roles by an `embed:mint-admin` key (it was the `admin`
conversation until CLEAN-236, which is the Owner's own now). Its `sub` is validated on mint:
letters, digits, dash and underscore, at most 128 characters, never `admin`,
never prefixed `anon-`, `share-` or `http-`, never an existing user id.

Transcript routes (`GET`/`DELETE /api/agent/:id/transcript`, `POST
…/transcript/archive`) decide per channel: `share-…` answers to that visitor
or a console user, `anon-…`/`http-…` stay open (random ids the hub mints for
credential-less visitors), and a channel named by a JWT `sub` answers only to a
bearer with that `sub` or to an administrator who manages the agent — `403
CHANNEL_FORBIDDEN` otherwise, the same whether the channel exists or not.

### Who a chat participant is

Every Owner and Admin used to be one participant, the client `admin`: one
conversation per agent for all of them (CLEAN-236). Now:

| Who | Conversation | An administrator to the agent |
|---|---|---|
| the Owner, console | `admin`: the one they all shared, where it was | yes |
| an Admin, console | their own user id | yes |
| a User, console | their own user id | no |
| an embed token | its `sub` | only when minted with administrator roles |
| a share or anonymous visitor | as before | no |

The hub tells the runtime that an administrator is sending (`admin: true` on
the message) where the runtime used to read it off the id. Reading somebody
else's conversation is supervision of the agent: an Owner or Admin who
manages it. So an Admin reads the Owner's conversation with an agent they
manage, and nothing of the Ranch admin agent's, in the chat list included. Background and decisions:
[`specs/022-embed-token-hardening/`](../../specs/022-embed-token-hardening/) (CLEAN-175).
