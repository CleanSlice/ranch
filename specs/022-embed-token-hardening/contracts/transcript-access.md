# Contract: transcript routes after CLEAN-175

Routes: `GET /api/agent/:agentId/transcript?channel=…`,
`DELETE /api/agent/:agentId/transcript?channel=…`,
`POST /api/agent/:agentId/transcript/archive?channel=…`.
All three stay reachable without a JWT at the guard level (the controller is
`@Public()`); the handler decides per channel.

| Channel | Caller | Result |
|---|---|---|
| `share-<v>` | that visitor's share headers, or any valid JWT | 200 (unchanged) |
| `share-<v>` | other visitor, or no credential | 403 `SHARE_LINK_INVALID` (unchanged) |
| `anon-…`, `http-…` | anyone | 200 (unchanged) |
| `admin` | JWT whose chat identity is `admin` (Owner/Admin roles, console or admin embed) | 200 |
| `admin` | any other caller | 403 `CHANNEL_FORBIDDEN` |
| `<sub>` (embed subject or console user id) | JWT with `sub` equal to the channel | 200 |
| `<sub>` | JWT whose chat identity is `admin` | 200 |
| `<sub>` | other JWT, share visitor, or no credential | 403 `CHANNEL_FORBIDDEN` |
| any non-existent channel outside `share-`/`anon-`/`http-` | unauthorised caller | 403 `CHANNEL_FORBIDDEN` (same as existing) |
| any non-existent channel | authorised caller | GET: empty page; DELETE/archive: as today |

403 body: `{ statusCode: 403, code: 'CHANNEL_FORBIDDEN', message: … }`,
mirroring the share routes' `{ code }` shape so the consoles and the SDK treat
it the same way. The check happens before the transcript file is opened.

Behaviour of the Bridle widget: with a token it already sends the bearer on
transcript fetch and archive, so an identified visitor keeps their history;
without a token it uses an `anon-…` channel and is unaffected.
