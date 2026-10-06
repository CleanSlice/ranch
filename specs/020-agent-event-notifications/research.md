# Research: Agent Events and Failure Notifications

**Feature**: [spec.md](spec.md) | **Date**: 2026-10-06 | **Ticket**: CLEAN-139

Everything below was read in the code on `origin/main` at `02c1154b`
(fetched 2026-10-06). The "who can send / which channel" research is in the
spec's *Background*; this file covers what the code makes true and the
decisions that follow.

## Findings

### F1. Where an agent's status is written

One gateway method writes `failed`, `unreachable`, `running` and `stopped`:
`AgentGateway.updateStatus` (`api/src/slices/agent/agent/data/agent.gateway.ts:91`).
It has five callers:

| Caller | Writes | When |
|--------|--------|------|
| `AgentStatusService.writeStatus` (`domain/agentStatus.service.ts:215`) | `failed`, `unreachable`, `running` | pod watch, 30 s drift sweep, bridle connect |
| `AgentController.syncStatus` (`agent.controller.ts:115`) | `failed` | someone opens the agent and its deploy workflow has failed |
| `AgentDeployService.deploy` (`domain/agentDeploy.service.ts:168`, `:230`) | `failed` | template missing, workflow submit failed |
| `AgentDeployService.stopAgent` (`:141`) | `stopped` | a person stops the agent |

`deploying` is written by `markDeployStarted`, not by `updateStatus`.

Only the first caller tells anyone (`statusWrites$` → the SSE stream). The
other three change the row silently, so a subscriber to `statusWrites$` would
miss them. **The gateway is the only place that sees every transition.**

### F2. A failure that is not one is already filtered out

`reconcileDbStatus` skips a `Failed` pod that is being deleted
(`podStatus.terminating`) and one that predates the current deploy
(`DeployTracker.isStale`); the sweep skips a pod-less agent inside the 5-minute
deploy grace (`DEPLOY_GRACE_MS`, `domain/deployGrace.ts:8`). `stopAgent` marks
the tracker before it cancels anything. So a transition **to `failed` or
`unreachable` is, by construction, something the product already believes is a
real failure** — CLEAN-106 paid for that. A stop writes `stopped`, a restart
writes `deploying`; neither is a failure transition.

An outside sender has none of this. It sees a pod die during a restart exactly
as it sees one crash.

### F3. The API is written for one replica and deployed, on paper, as several

- `k8s/platform/api/deployment.yaml` says `replicas: 2`; `hpa.yaml` says 2–5.
- `k8s/deploy/30-api.yaml` says `replicas: 1`.
- `api/src/app.module.ts:106`: "Safe while ranch-api is a single replica".
- The bridle hub's presence map is in memory, per process
  (`bridle/data/bridle.gateway.ts`, `isAgentConnected`). With two replicas the
  one that does not hold an agent's socket sees "pod running, hub absent" and
  after 60 s writes `unreachable`; the other writes `running` back.
- Every replica runs its own pod watch and its own sweep, and the guard before
  a `failed` write is read-then-write (`if (agent.status !== 'failed')`), so
  two replicas can both write the same transition.

What production actually runs is not knowable from the repository. Two things
follow: this feature must be correct at any replica count on its own account,
and an install whose statuses flap today would turn each flap into an
incident. See D3, D6 and the pre-flight check in [quickstart.md](quickstart.md).

### F4. Credentials: a scoped API key already exists

`api/src/slices/user/apiKey/`: keys are `rk_<random>`, stored as a SHA-256
hash, shown once, carry `scopes: string[]`, `lastUsedAt`, `expiresAt` and a
`name`. `ApiKeyGuard` + `ScopesGuard` + `@Scopes(...)` gate a route by scope
(`auth.controller.ts:143`, the embed-token route, is the one user today). The
`admin` scope is a wildcard. Revoking is deleting the row.

Scopes are spelled out in more places than one: the API enum
(`domain/apiKey.types.ts`), the tool's description (`apiKey.tool.ts:30`), the
mapper's allow-list (`data/apiKey.mapper.ts:42`, which **drops unknown scopes
silently**), and three places in the admin console
(`admin/slices/user/apiKey/domain/apiKey.types.ts`,
`components/apiKey/CreateDialog.vue` `SCOPE_OPTIONS`,
`data/apiKey.mapper.ts`).

### F5. Settings hand secrets back

`GET /settings` returns every row's value as stored. `secret: true` in
`settingCatalog.ts` only stops an agent tool echoing it; the console receives
`github_pat` in plain text and puts it in a password field. This is debt, not
a pattern to copy: the spec requires the destination's secret to be hidden
wherever it is shown after saving (FR-029).

### F6. There is no authenticated live stream to copy

The one SSE stream, `GET /agents/status/stream`, is `@Public()` because
`EventSource` cannot send an `Authorization` header
(`agent.controller.ts:164`). Every authenticated console call goes through
`authedFetch`. There is no shared bus between replicas — no Redis, no
`LISTEN/NOTIFY`, no raw SQL anywhere in `api/src`.

### F7. House patterns this feature reuses

- **Background work** is a `setInterval` in an `OnModuleInit` service with a
  `running` flag and `timer.unref()` (`reins/knowledge/domain/indexReconcile.service.ts`,
  `chat/domain/chatSync.service.ts`). "Ranch has no scheduler facility."
- **Outbound HTTP** is `fetch` with `AbortSignal.timeout`
  (`agent/peer/domain/a2a.client.ts`).
- **Answers** are wrapped as `{ success: true, data }` by `ResponseInterceptor`;
  errors are Nest's `{ statusCode, message, error }`. Validation is global:
  `whitelist: true, forbidNonWhitelisted: false` — unknown fields are dropped,
  not refused.
- **Migrations** are hand-reviewed additive SQL under `api/prisma/migrations/`,
  models live in the slice as `<name>.prisma` and are merged by `prisma-import`.
- **The console's own address** is known to the API as `ADMIN_URL` /
  `ADMIN_BASE_URL` (`agent/shareLink/shareLink.tool.ts:57`,
  `mcpServer/oauth/domain/mcpOauth.service.ts:154`). It is not set in the
  checked-in manifests.
- **Agent pods** are named `agent-<agentId>`, live in namespace `agents`, and
  carry the label `ranch/agent-id=<agentId>`
  (`workflow/data/agent-workflow.manifest.ts:64,93`).

## Decisions

### D1. One new API sub-slice: `api/src/slices/agent/event/`

**Decision**: events, incidents, notifications and the destination live in
one sub-slice of `agent`, beside `peer` and `shareLink`. It depends on the
agent slice (to look an agent up and to hear status transitions) and on the
API-key guards. Nothing in `agent/agent` depends on it.

**Rationale**: an event is about an agent and means nothing without one
(FR-012). One direction of dependency keeps `AgentModule` free of a cycle it
already has too many of (`forwardRef` with bridle).

**Alternatives**: a top-level `notification` slice for the Slack half —
rejected for now: there is one destination and one thing that notifies. When
Telegram or a second kind of notification arrives, `INotifier` (D9) is the
seam to lift out.

### D2. The endpoint: `POST /agent-events`, API key with scope `events:write`

**Decision**: one route, guarded by `ApiKeyGuard` + `ScopesGuard` +
`@Scopes(ApiKeyScopeTypes.EventsWrite)`. Body: `agentId`, `status`, optional
`datetime`, `reason`, `source`, `eventId`. Full contract:
[contracts/event-ingest.md](contracts/event-ingest.md).

**Rationale**: the request names the body (`agentid`, `status`, `datetime`) and
F4 is a ready, tested, least-privilege credential: a key with only
`events:write` is refused by every other route (FR-003), is shown once, can be
revoked, and records when it was last used (FR-028) — the console page and the
agent tools for it already exist. The sender's identity is the key's name
(FR-034), not a field of the body.

**Alternatives**: the bridle shared key (`x-bridle-api-key`) — one secret for
every runtime, no name, no revocation without restarting all agents. A new
credential table — a second copy of F4.

### D3. Ranch's own failures are heard at the gateway, as true transitions

**Decision**: a small domain port in the agent slice, `AgentStatusChanges`
(`emit`, `changes$`). `AgentGateway.updateStatus` detects a real transition
atomically — `updateMany({ where: { id, NOT: { status } }, data })`, and only
when that matches no row does it fall back to today's plain `update` — and
emits `{ agentId, status, reason, at }` only when the status actually
changed. The event slice subscribes and records a Ranch-witness event for
`failed` and `unreachable`.

**Rationale**: F1 — the gateway is the only place all five callers pass
through, so no call site can be forgotten, now or later. F3 — with several
replicas both may write `failed`; the conditional update lets exactly one of
them see a change, so one failure makes one event with no lock and no raw SQL.
The second statement keeps today's behaviour for a same-status write (a
refreshed reason, a workflow id).

**Alternatives**: subscribing to `statusWrites$` — misses three of five
callers (F1). Emitting at each call site — correct today, wrong the day
someone adds a sixth. A database trigger — invisible to the next reader and
unlike anything else in the repository.

### D4. Incidents: at most one open per agent, enforced by the database

**Decision**: `AgentIncident.openKey` is a nullable unique column holding the
agent id while the incident is open and `NULL` once closed. Opening is an
insert; a unique violation means another event got there first, and the event
joins that incident instead. Closing is `updateMany({ where: { id, openKey:
{ not: null } } })`, and only the replica whose update matched enqueues the
closing notification.

**Rationale**: FR-018 and FR-021 are "one notification per incident" under
concurrency — two senders, or two replicas, reporting the same failure in the
same second. A unique constraint is the only arbiter all replicas share (F6).
A nullable unique column gives "one open per agent" in plain Prisma; Postgres
allows any number of `NULL`s.

**Alternatives**: a partial unique index — needs hand SQL that `prisma migrate
dev` would then try to drop. An advisory lock — raw SQL, none in the codebase.
An in-memory map — wrong at two replicas, empty after a restart.

### D5. An incident closes by one rule, checked on a timer

**Decision**: every 30 s a sweep looks at each open incident and its agent:

| Agent as Ranch holds it | Outcome |
|-------------------------|---------|
| `running`, and 10 minutes have passed since the last failure event and since it came up | close, resolution `recovered` if Ranch itself witnessed the failure, else `unconfirmed`; notify |
| `stopped` | close, resolution `stopped`; no notification |
| deleted | close, resolution `deleted`; no notification |
| anything else | stays open |

A failure event joining an open incident resets the 10 minutes. An outside
`recovered` event is stored and changes nothing.

**Rationale**: closing on the first `running` announces recoveries that do
not hold — a crash-looping container is `Running` and `Ready` for a few
seconds of every cycle, and `reconcileDbStatus` promotes it each time. Ten
minutes is the cluster's own definition of stable: Kubernetes resets a
container's crash back-off only after it has run that long. One rule also
closes the case nothing else would: an outside sender reports a failure Ranch
never saw and never reports a recovery — without this the incident stays open
for ever and FR-018 silences every later, real failure of that agent.
30 s matches the existing drift sweep, so the worst-case delay of a closing
message is the same half-minute the status itself can lag.

**Alternatives**: close on an outside `recovered` — makes closing depend on a
sender nobody has chosen yet being configured to send it. Close at once and
re-open quietly on a new failure — the chat would say "back" while the agent
is down. A manual "resolve" button — still needed never, given the rule;
left out.

### D6. An outside event opens an incident only when Ranch is not mid-change

**Decision**: an outside `failed` event opens (or joins) an incident when
Ranch holds the agent as `running`, `unreachable` or `failed`. When Ranch
holds it as `stopped`, `pending` or `deploying`, the event is stored with the
outcome `suppressed_stopped` / `suppressed_starting` and notifies nobody.

**Rationale**: F2 — an outside sender reports the old pod of every restart as
a failure. Ranch's own startup timeout (5 minutes) still catches a start that
really fails, and that transition opens the incident (D3). The independence
the request is after is kept where it matters: an agent Ranch believes is
`running` and an outside sender says is down is exactly the disagreement that
notifies.

**Alternatives**: notify on everything and let people learn to ignore it —
that is how a channel gets muted. Ask the sender to filter restarts — it
cannot know which pod deletions Ranch asked for.

### D7. Notifications go through an outbox table, not straight to Slack

**Decision**: opening or closing an incident inserts an `AgentNotification`
row (`pending`) in the same transaction. A worker in every replica ticks every
5 s, claims a due row by a conditional update (`lockedUntil`), sends it, and
records the outcome. Attempts fall at 0 s, 10 s, 30 s, 2 min, 5 min, 15 min
and 30 min after creation when each is made on time; after a failed attempt
the worker waits the gap to the next slot, counted from that attempt, so a
message that comes due late (the API was away) does not fire its retries back
to back — found by a failing test during implementation. Then `failed` —
"not delivered" in the console. A `429`
waits for Slack's `Retry-After`. A `400`, `403`, `404` or `410` is permanent:
the address is wrong or revoked, and retrying cannot fix it. Each attempt
times out after 5 s.

**Rationale**: FR-007 and FR-022 — the sender's answer must not wait for
Slack, and an event must survive Slack being down. The schedule spans about
53 minutes: long enough for the outages Slack actually has, short enough that
an alarm is not delivered as news the next morning (the spec's "destination
down for an hour" case). 5 s keeps SC-001 (a message within 60 s) with room
to spare. The claim makes two replicas send one message.

**Alternatives**: send inline — couples the sender's answer to Slack and
loses the message on a restart. An in-process queue — lost on a restart, and
doubled at two replicas.

### D8. The flood limit is counted in the database

**Decision**: before storing, count this key's events of the last 60 s
(`@@index([apiKeyId, receivedAt])`); at 60 or more, answer `429` with
`Retry-After`. Refused events are not stored.

**Rationale**: FR-010. An in-memory counter is per replica, so the real limit
would be 60 times the replica count and would reset on every deploy. The
count is one indexed query on a path that takes at most one request a second
per sender.

**Amended during implementation** (security review of the first commit): a
count followed by an insert is not atomic, and a burst of parallel requests
could all read "none so far" and all pass — far more than "occasionally 61".
A second gate was put in front: a per-key sliding window in the process, taken
synchronously before anything is awaited, so one replica can never accept more
than 60 a minute from a key whatever the concurrency. The database count stays
for what a process cannot see — the other replicas. Worst case is now the
limit times the replica count; the usual case is the limit.

**Alternatives**: `@nestjs/throttler` — a new dependency whose default store
is in memory (same flaw).

### D9. Slack through an incoming webhook, behind `INotifier`

**Decision**: `INotifier.send(message)` with one implementation,
`SlackWebhookNotifier`: `POST` of `{ text, blocks }` to the stored address.
The address must be `https://hooks.slack.com/services/…`; anything else is
refused on save. Sender-supplied text is escaped (`&`, `<`, `>`) and cut to
what a Slack block holds; times use Slack's `<!date^…>` so each reader sees
their own time zone, with an ISO fallback.

**Rationale**: an incoming webhook needs no bot, no SDK and no OAuth — one
secret address (spec, *Where should the notification go?*). Pinning the host
keeps an owner-entered URL from turning the API into a tool for calling
arbitrary internal addresses. Escaping is what stops a sender's `reason` from
becoming `<!channel>` or a disguised link, while still showing the text as
received (FR-032). The interface is the seam for Telegram.

**Alternatives**: the Slack Web API with a bot token — more setup for nothing
this feature needs. A generic "any webhook URL" field — the SSRF above.

### D10. The destination has its own table and its own routes

**Decision**: `AgentEventDestination` (one row), reached only through
`/agent-events/destination`. `GET` answers whether one is set, a hint (the
last four characters), who set it and when, and the outcome of the last
delivery — never the address. `PUT`, `DELETE` and `POST …/test` are for the
owner.

**Rationale**: F5 — a `Setting` row would be handed back to every console
that loads `/settings`. FR-029 is not met by a password field.

**Alternatives**: a `Setting` with `secret: true` — the leak in F5. Masking
secrets in `GET /settings` for everyone — right, and a different ticket: it
changes five existing pages.

### D11. The console list refreshes by asking, not by a stream

**Decision**: while the events page or an agent's events section is open and
the tab is visible, the store asks for the newest page every 5 s through
`authedFetch` and upserts by id. No SSE.

**Rationale**: F6 — the only stream is public because it cannot carry a
token, and events must not be public (FR-026). And with no bus between
replicas, a stream on one replica would have to poll the database to learn of
an event accepted on another: polling with a socket around it. "Within a few
seconds" (User Story 5) is met at 5 s. `docs/state.md` treats a poll as one
more push that patches the same record.

**Alternatives**: SSE with a token in the query string — a bearer token in
URLs and access logs. A websocket namespace — a second authenticated socket
path for a list a handful of people look at.

### D12. Duplicates are recognised by a key the database enforces

**Decision**: `AgentEvent.dedupeKey`, unique and nullable. For an outside
event it is `<apiKeyId>:<eventId>` when the sender gives an `eventId`,
otherwise `<apiKeyId>:<agentId>:<status>:<datetime>` when it gives a
`datetime`, otherwise `NULL`. A duplicate answers `200` with the first
event's id and `duplicate: true` — a success, because for the sender it is
one.

**Rationale**: FR-009 — senders retry. Without `eventId` or `datetime` two
identical bodies are indistinguishable from two failures, so they are two
events; the contract says so.

### D13. Agent tools

**Decision**: `agentEvent.tool.ts` (operator audience): `list_agent_events`,
`list_agent_incidents` (topic `agents`); `get_notification_destination`,
`set_notification_destination`, `send_test_notification`, and
`remove_notification_destination` with `confirm` (topic `settings`). The
`events:write` scope is added to `create_api_key`'s schema and description.
`set_notification_destination` joins `mcp/tool-secrets.spec.ts`.

**Rationale**: Constitution V and `docs/agent-tools.md` — every console
capability here gets its tool, calling the same service as the controller.

### D14. Console: a new sub-slice, one section on the agent page

**Decision**: `admin/slices/agent/event/` owns the events page (`/events`,
sidebar *Main*), the store, and the settings page `/settings/notifications`
(its file sits in this slice; `setting`'s menu gets one entry). The agent page
gets an `events` section (`sections.ts`, `Canvas.vue`). The API-key dialog
learns the new scope. `formatSpan` — "16 min", "2 h 5 min" — is added to
`#common/utils/format`.

**Rationale**: Constitution I and IV. `formatDuration` in
`chat/utils/transcript.ts` formats a tool call's milliseconds; reaching into
another slice for it would be the sideways reach the constitution names, and
an incident's length is a different unit.

**Twin consoles**: three of the touched admin slices have twins — `agent`,
`user`, `common`. `app/slices/agent` has no section list (its workspace is
`Provider`, `Rail`, `RailItem`); `app/slices/user` has no API-key screen;
`app` has no use for `formatSpan`. Events are an operator's concern (spec,
*Assumptions*), so `app` needs nothing. The PR says so in words.

### D15. The link in a notification

**Decision**: the message links to `<ADMIN_URL>/agents/<id>?tab=events`
using `ADMIN_URL ?? ADMIN_BASE_URL`, the way `shareLink.tool.ts` reads it.
When neither is set the message goes without a link and
`GET /agent-events/destination` reports `consoleLinks: false`, which the
settings page shows as a warning.

**Rationale**: FR-015 asks for the link; F7 — the variable exists but is not
in the checked-in manifests. A wrong guess at the console's address is worse
than no link.

### D16. Retention

**Decision**: an hourly pass of the same worker deletes events received more
than 90 days ago and closed incidents (with their notifications) closed more
than 90 days ago. Open incidents are never deleted.

**Rationale**: FR-033. `deleteMany` is idempotent, so every replica may run it.

## Risks

- **R1. Status flapping at more than one replica (F3).** Not caused by this
  feature, but made visible by it: one false `unreachable` incident per agent,
  open for as long as the flapping lasts. The pre-flight check in
  [quickstart.md](quickstart.md) is to watch the status of a few agents for
  two minutes before a destination is set. If production runs more than one
  API replica, that is a bug to fix first, in its own ticket.
- **R2. A fleet-wide failure sends a message per agent.** A lost node or an
  API start that finds every pod gone opens one incident per agent — 22
  messages on production today. Slack accepts about one a second per webhook
  and the worker honours `429`. A digest ("9 agents failed") is the remedy if
  it proves noisy; out of scope.
- **R3. `updateStatus` is the most carefully guarded write in the API.** D3
  changes how it writes, not what. Its existing specs must pass untouched and
  a new one covers "same status → no emission, reason still refreshed".
- **R4. The sender is not chosen.** The contract is plain HTTP on purpose. A
  tool that cannot set a header or shape a JSON body (Alertmanager's fixed
  format) cannot use it without a relay; the spec excludes it from v1.
