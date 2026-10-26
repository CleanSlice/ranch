# Feature Specification: Embed chat tokens scoped to the chat, transcripts only for their owner

**Feature Branch**: `fix/CLEAN-175-embed-token-scope` (spec directory `022-embed-token-hardening`)

**Created**: 2026-10-26

**Status**: Draft

**Ticket**: [CLEAN-175](https://dreamvention.atlassian.net/browse/CLEAN-175)

**Input**: User description: "Изучи папку внутри E:\code\dream\cleanslice\ranch\task\augeo_v1.1-dev-fix, посмотри что это, содержится ли там фикс или это задача которую нужно реализовать, в чем проблема и создай таску, работаем с этим, изначально дело в безопастности и токенах, возможно это с ролями связано, не уверен, нужно мне понять изначально, помоги с этим, чтобы я смог принимать решения"

## Background

Augeo embeds the Ranch chat widget on their website and wants the agent to know
which signed-in Augeo user (their WSLID) is talking. The agreed design is that
Augeo's own server asks the platform for a short-lived, signed **embed token**
for that user, renders it into the page, and the chat hub trusts the token
instead of anything the browser claims. The demo package and the internal
handoff of 2026-10-26 (outside this repository, in `task/augeo_v1.1-dev-fix`)
describe that design and the problems that block it.

The handoff is not a fix. It is a list of verified findings about the platform,
re-checked against this repository on 2026-10-26:

1. **The platform does not require a credential by default.** Only some areas of
   the API ask for one; the settings, model, knowledge and several other areas
   never do. On the public production instance, a request with no credential at
   all returns the settings list, including the platform's vendor keys, in
   clear text. The customer fork closed this in August 2026 by requiring a
   credential everywhere except an explicit, test-pinned list of public routes;
   that change never reached this repository, and an older upstream attempt from
   July 2026 was left unmerged.
2. **An embed token is indistinguishable from a console login.** Wherever a
   credential *is* required, the embed token satisfies it. So a visitor who
   lifts the token out of Augeo's page can read platform settings, keys and
   configuration, exactly like a logged-in operator.
3. **Any chat transcript can be read, deleted or archived by anyone** who knows
   the channel name. Only share-link channels are protected. Anonymous channels
   were random and hard to guess; a WSLID channel is a known identifier, so
   another person's conversation becomes readable and erasable.
4. **The identity an integrator mints is not validated.** It becomes the channel
   name and part of a file path, so a reserved name (the admin conversation) or
   a path-like value is accepted.
5. **The agent never sees the verified identity.** The model only sees text the
   browser supplies, so a page can claim any WSLID and the agent repeats it.
   Not a leak by itself; it becomes one the moment a tool looks up personal
   data by WSLID.

Finding 1 is wider than the Augeo integration and is the most severe. Finding 2
is only dangerous because of finding 1 and because the settings area hands out
secrets (tracked separately as CLEAN-141). Findings 3 and 4 are specific to
identified chat users and block the Augeo rollout on their own.

## Scope

**In scope (this feature):**

- Requiring a credential on every platform route by default, with an explicit
  list of public exceptions that a test pins. **Decided 2026-10-26: ships in
  this ticket as its first step**, in the same shape the customer fork already
  carries, so the next catch-up merge is trivial.
- Making embed tokens a **chat-only credential**: accepted by the chat
  (connecting, sending messages, attachments, the visitor's own transcript) and
  refused everywhere else.
- Transcript read, delete and archive only for the conversation's owner or a
  platform admin.
- Validating the identity an integrator mints.

**Out of scope (tracked elsewhere or later):**

- Masking secret setting values for logged-in operators: CLEAN-141.
- Putting the verified identity into the agent's context so it can answer
  "who am I" from the token and ignore identity claims in page-supplied text
  (finding 5). **Decided 2026-10-26: a follow-up ticket** (it touches the agent
  runtime in another repository). Augeo is not told "identification works"
  until that follow-up lands.
- Refreshing an expired embed token on reconnect in the widget SDK (today the
  visitor silently continues anonymously; a one-hour token lifetime is the
  agreed workaround).
- Operational follow-ups from the handoff: revoking the demo key minted on the
  development instance, issuing one key per environment to Augeo, confirming
  the production agent and its allowed origins.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nobody reads platform data without a credential (Priority: P1)

A platform operator expects that a caller with no credential at all gets
nothing from the API except the handful of routes that must work before login
(health, first-owner setup, login, the public chat surface, share links, and
the machine routes that authenticate with their own key).

**Why this priority**: Today the production instance returns vendor keys to an
anonymous request. Every other finding is a smaller case of this one.

**Independent Test**: Call the settings, model, knowledge and agent listing
routes with no credential and see them refused; call health and login and see
them still work; confirm the console still logs in, refreshes and logs out.

**Acceptance Scenarios**:

1. **Given** no credential, **When** the settings, models, knowledge or agents
   list is requested, **Then** the request is refused as unauthenticated and no
   data is returned.
2. **Given** no credential, **When** health, first-owner setup, login, token
   refresh or logout is called, **Then** it behaves exactly as before.
3. **Given** a machine caller with a valid API key (embed-token minting, agent
   event ingest, runtime routes), **When** it calls its route, **Then** the key
   is what is checked and the call succeeds; without the key it is refused.
4. **Given** the list of public routes, **When** a developer adds a new public
   route without updating the pinned list, **Then** the test suite fails and
   names the file.
5. **Given** a logged-in operator, **When** they use the admin or app console,
   **Then** nothing changes for them.

---

### User Story 2 - An embed token only opens the chat (Priority: P1)

An Augeo visitor holds an embed token (they can always read it out of the page).
With it they can chat as themselves. They cannot read platform settings, keys,
knowledge, models, agents or anything else an operator sees.

**Why this priority**: As soon as Augeo renders a token into every page, the
token is in the hands of every Augeo user. It must be worth nothing outside the
chat.

**Independent Test**: Mint an embed token for a test user; connect to the chat
and send a message (works); request the settings, models, knowledge and agent
listings with the same token (refused); log in to the console with a real
account (works as before).

**Acceptance Scenarios**:

1. **Given** a valid embed token, **When** the visitor connects to the chat,
   sends a message, uploads an attachment or reads their own transcript,
   **Then** it works and the conversation is keyed to the identity in the token.
2. **Given** the same embed token, **When** any non-chat platform route is
   requested (settings, models, knowledge, agents, users, the agent tool
   endpoint, and so on), **Then** the request is refused as unauthenticated,
   with the same answer an anonymous caller gets.
3. **Given** a console login token, **When** the same routes are requested,
   **Then** they work exactly as today.
4. **Given** a long-lived agent service token, **When** the runtime calls its
   routes, **Then** nothing changes.
5. **Given** an embed token minted with an admin-capable key, **When** it is
   presented outside the chat, **Then** it is refused like any other embed
   token. **Decided 2026-10-26**: admin embed tokens are chat-only too; the
   admin-capable key still lets a private page run a permanent admin widget
   (admin conversation, admin view of transcripts), but the token opens nothing
   outside the chat.

---

### User Story 3 - A conversation belongs to its owner (Priority: P2)

An identified visitor's transcript can be read, deleted or archived only by that
visitor (presenting their own token) or by a platform admin. Another visitor,
or someone with no credential, gets a refusal and cannot tell whether the
channel exists.

**Why this priority**: WSLIDs are known identifiers. Without this, any Augeo
user can read and erase any other Augeo user's conversation.

**Independent Test**: Create a conversation for test user A; request its
transcript with no credential (refused), with user B's token (refused), with
user A's token (returned), as an admin (returned); repeat for delete and
archive.

**Acceptance Scenarios**:

1. **Given** an identified visitor's conversation, **When** its transcript is
   requested with no credential, **Then** access is refused.
2. **Given** the same conversation, **When** another identified visitor
   requests it, **Then** access is refused with the same answer as for a channel
   that does not exist.
3. **Given** the same conversation, **When** its owner requests, deletes or
   archives it, **Then** the operation succeeds.
4. **Given** the same conversation, **When** an admin requests it from the
   console, **Then** it is returned, as today.
5. **Given** a share-link conversation, **When** the visitor presents their
   share credentials, **Then** today's rule applies unchanged.
6. **Given** an anonymous conversation, **When** it is requested, **Then**
   today's behaviour applies unchanged (anonymous channels stay random and are
   not part of this change).

---

### User Story 4 - A minted identity is well-formed (Priority: P3)

An integrator minting an embed token can only name a visitor with a plain
identifier: letters, digits, dash and underscore, up to a sensible length. The
reserved admin conversation name and the anonymous and share-link prefixes are
refused, as is anything path-like.

**Why this priority**: Only key holders can mint, so this is defence in depth,
but a mistake or a compromised key must not land a visitor in the admin
conversation or outside the session storage.

**Independent Test**: Mint with `admin`, `../x`, `anon-1`, `share-x`, an
empty value and a 200-character value (all refused with a validation error);
mint with `wslid-A1234567` (accepted).

**Acceptance Scenarios**:

1. **Given** a valid key, **When** the identity is `admin`, starts with `anon-`
   or `share-`, contains `/`, `\` or `..`, or exceeds the length limit, **Then**
   minting is refused as a validation error that names the field.
2. **Given** a valid key, **When** the identity matches the allowed pattern,
   **Then** the token is minted as today.

---

### Edge Cases

- An embed token that expires while the chat is open: the widget reconnects,
  the hub treats the token as invalid, and on a public agent the visitor
  silently continues anonymously with an empty history. Unchanged by this
  feature; documented so Augeo keeps the one-hour lifetime.
- An embed token presented to the chat's machine-to-machine surface (the
  endpoints the agent runtime uses with its own token): refused like any other
  non-chat route.
- A caller presents an embed token to the transcript of the admin conversation:
  refused; only admins see it.
- A console login token presented to the transcript of a visitor channel: the
  console is where admins read any channel, so an admin token is accepted; a
  non-admin console user's token is accepted only for their own channel.
- A request for a transcript of a channel that does not exist, with no
  credential: the same refusal as for a channel that does exist, so the route
  cannot be used to probe which WSLIDs have talked to the agent.
- The customer fork already requires a credential by default with its own
  pinned list. The change here must take the same shape so the next catch-up
  merge into the fork is a no-op rather than a conflict.
- Existing integrations that call non-chat routes with an embed token today:
  none are known in this repository or the fork. If one appears, it must move
  to a console or API-key credential.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every platform route MUST require a credential unless it is on an
  explicit list of public exceptions; the list MUST be pinned by an automated
  test that fails when a route is made public without updating it. *(Subject to
  the scope clarification above.)*
- **FR-002**: The public exceptions MUST be limited to what works before login
  or authenticates by its own key: health, first-owner setup, credential
  exchange (login, register, refresh, logout), the public chat surface the
  widget uses, share-link resolution, the signed file link, the OAuth callback,
  and the machine routes that check an API key or the runtime key.
- **FR-003**: An embed token MUST be distinguishable from a console or service
  token, and MUST be accepted only by the chat surface: connecting, sending
  messages, attachments, and the visitor's own transcript.
- **FR-004**: Any route outside that surface MUST refuse an embed token with the
  same answer it gives an anonymous caller.
- **FR-005**: Console login, refresh and logout, and long-lived agent service
  tokens, MUST behave exactly as before.
- **FR-006**: Transcript read, delete and archive for an identified visitor's
  channel MUST be allowed only to that visitor (presenting their own token) or
  to a platform admin; everyone else MUST be refused with one answer regardless
  of whether the channel exists.
- **FR-007**: Share-link channels MUST keep today's rule; anonymous channels
  MUST keep today's behaviour.
- **FR-008**: The identity an integrator mints MUST be validated: letters,
  digits, dash and underscore only, at most 128 characters, never the reserved
  admin name, never the anonymous or share-link prefixes; anything else MUST be
  refused as a validation error naming the field.
- **FR-009**: The pinned list of public routes and the chat-surface list MUST
  match the customer fork's shape closely enough that the next catch-up merge
  carries no behavioural difference.
- **FR-010**: Refusals MUST NOT reveal the token, the channel's existence, or
  any setting value in logs or responses.

### Key Entities

- **Embed token**: a short-lived credential minted by an integrator's server for
  one visitor; carries the visitor identity and a marker that it is chat-only.
- **Public route list**: the enumerated set of routes reachable without a
  credential, maintained deliberately and pinned by a test.
- **Chat channel / transcript**: one visitor's conversation with one agent,
  keyed by the visitor identity; has an owner (identified visitor, share
  visitor, anonymous) that decides who may read, delete or archive it.
- **Visitor identity (subject)**: the identifier an integrator mints; must be a
  plain token that can never collide with reserved channel names.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the production instance, 100% of non-public routes refuse a
  request with no credential; the four routes probed on 2026-10-26 (settings,
  models, knowledge, agents) go from 200 to refused.
- **SC-002**: With a freshly minted embed token, 0 non-chat routes return data;
  the chat flow (connect, message, attachment, own transcript) succeeds 100% of
  the time it succeeded before.
- **SC-003**: With a known WSLID channel, an anonymous or foreign request for
  its transcript is refused 100% of the time; the owner's and an admin's
  succeed.
- **SC-004**: All six malformed identities in User Story 4 are refused; the
  well-formed one is accepted.
- **SC-005**: The admin and app consoles pass their existing checks with no
  change to user-visible behaviour; no console flow needs a new login step.
- **SC-006**: The next catch-up merge into the customer fork needs no manual
  reconciliation of the public route list or guard wiring.
- **SC-007**: The handoff's verification script (section 8 of the internal
  document) passes on the development instance after the fork's catch-up.

## Assumptions

- Tokens minted for Augeo use a one-hour lifetime and are re-minted per page
  render; refresh on reconnect is not needed for v1.
- Anonymous channels remain randomly named and reachable as today; closing them
  is a separate decision.
- The settings area keeps returning values to logged-in operators until
  CLEAN-141 masks them; this feature only removes the anonymous and embed-token
  paths to them.
- The agent runtime lives in another repository; nothing here changes what the
  runtime receives.
- No existing integration relies on an embed token outside the chat.
- The customer fork's public-route list is the reference shape; routes added
  upstream since July 2026 are classified the same way the fork classified them.
- The development demo key minted for the handoff is revoked and re-issued
  operationally once this lands; it is not part of this change.
