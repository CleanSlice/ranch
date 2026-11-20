# Contract: sign-ins and chat identities

## 1. A sign-in belongs to a console

Header on every console request: `X-Ranch-Console: admin` or `app`. Set once
in each console's API client plugin. The hub handshake already states the
console (`auth.surface`) and needs nothing new.

| Route | With the header | Without, or with another value |
|---|---|---|
| `POST /auth/login`, `POST /auth/register`, `POST /setup/init` | session created with that `surface`; cookie `ranch_session_<surface>` set | the access token alone: a session with no surface, no cookie set, nothing any console can renew. This is the script that signs in for a token, as the settings pages describe |
| `POST /auth/refresh` | reads only `ranch_session_<surface>`; the session must be live and of that surface, else 401 `SESSION_INVALID` | 401 `SESSION_INVALID` |
| `POST /auth/logout` | revokes the session behind `ranch_session_<surface>` and clears that cookie only | 200 `{ revoked: false }` |

- Cookie options are today's: `httpOnly`, `sameSite: lax`, `path: /auth`,
  host-only, `secure` by configuration.
- The cookie `ranch_session` is cleared on every response of the three
  routes above when the request carried it. It is never read.
- A `Session` row with no `surface` is never renewed: one from before the
  migration, or one no console made.
- CORS: the header is added to the allowed request headers wherever a list
  is stated.
- Everything that ends all sessions of an account is unchanged and covers
  both surfaces.

Console side, both consoles, same code in each `user/auth` slice:

- the header constant lives next to the API client plugin;
- a `SESSION_INVALID` on the first refresh after the upgrade leads to the
  existing "session ended" state, not to an error;
- nothing else changes in the stores: `accountScope.client.ts` already
  resets on a change of account id.

## 2. Chat identity of a console person

Decided at the hub handshake and on each HTTP chat route. "Console token" is
a token that carries a session id (`IConsoleSession`), which an embed token
never does:

| Who | `clientId` | `isAdmin` |
|---|---|---|
| The Owner, console token | `admin` | true |
| An Admin, console token | their user id | true |
| A User, console token | their user id | false |
| Embed token with administrator roles | its `sub` | true |
| Embed token otherwise | its `sub` | false |
| Share visitor, anonymous | as today | false |

- `admin` is given to nobody else: `clientIdFromJwtPayload` gives it to a
  token that carries Owner and is not an embed token. `mintEmbedToken`
  already refuses a `sub` that is an account id or a reserved id.
- `isAdmin` travels to the runtime as `admin: true` on the message
  ([handover.md](./handover.md) §2).

## 3. Reading a conversation

`GET /api/agent/:agentId/transcript?channel=…` and the other routes that
take a channel:

| Requester | May read |
|---|---|
| any identity | their own channel (the default when none is given) |
| `isAdmin` and manages the agent | any channel of that agent |
| share visitor | their own share channel, as today |
| anybody holding the name | an open (`anon-`, `http-`) channel, as today |

An Admin asking for `channel=admin` of an agent they manage reads the
Owner's conversation with it; of the Ranch assistant they read nothing,
since only the Owner manages it. This is the supervision rule of FR-035.

`GET /chats`, the routes under it and the chat tools (`list_chats`,
`get_chat`, `get_chat_messages`, `sync_chats`, …) stay Owner and Admin and
are scoped by reach, less the agents only the Owner manages: an Admin lists
and opens no conversation of the Ranch admin agent, with the answer of a
chat that does not exist. The session DTO gains:

- `person`: `{ name, role }` for a conversation whose id is an account's,
  and for `admin` the Owner; `name` is null once the account is gone;
- `peer`: `{ name }` for a conversation named `peer:…`, the name set only
  when the caller reaches the asking agent, null otherwise.

## 4. Console changes

| Console | File | Change |
|---|---|---|
| admin | `slices/bridle/stores/bridle.ts`, `components/bridle/Provider.vue` | the channel is the viewer's own (`utils/ownChannel.ts`: `admin` for the Owner, the user id otherwise), not the literal `admin`. Known before the socket's `welcome`, which the transcript load cannot wait for |
| admin | `slices/chat/utils/chatList.ts` | kinds `person` (by name, with the role for an administrator) and `peer` (the agent's name, or `Colleague`); the id of a `peer` conversation is never shown |
| app | `slices/bridle/stores/bridle.ts` | already takes its channel from `welcome`; verified, no change expected |
| both | `slices/setup/api/plugins/*` | `X-Ranch-Console` |

## 5. Tests that pin it

- `session.service.spec.ts`, `auth.controller.spec.ts`: the table of §1,
  including the other surface's cookie value under this surface's name.
- `chatIdentity.spec.ts`: the table of §2.
- `bridle.controller.spec.ts`: the table of §3.
- Browser, `e2e/consoles.mjs`: two accounts, two consoles, one profile,
  through a renewal, a reload and a sign-out.
- Browser, `e2e/conversations.mjs`: the Owner and an Admin on one agent at
  once; a message of one during the other's turn.
