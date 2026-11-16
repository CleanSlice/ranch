# Research: Request limits for agents

Decisions taken before design, each with the reason and what was turned down.
File references are to this repository at `origin/main` 19c593a4 and to
`CleanSlice/bridle` at 9f94514 (0.15.1).

## R1. Where the check runs

**Decision**: inside `BridleGateway.sendToAgent`
(`api/src/slices/bridle/data/bridle.gateway.ts:327`), after the duplicate
check and after the offline check, immediately before `agentSend(...)`. The
hub asks a limiter that the `agent/limit` slice exports; it does not count
anything itself.

**Rationale**: every relayed request passes this function — the socket handler
(`bridleClientWs.handler.ts:446`), both HTTP routes
(`bridle.controller.ts:409`, `bridleSync.service.ts:136`) and inbound A2A
(`a2a.server.service.ts:144`). One check, no path to forget. The order gives
the spec's rules for free: a repeat of an accepted message returns
`duplicate` before it is counted (FR-016), an offline agent returns
`AGENT_OFFLINE` before it is counted (FR-017).

**Alternatives considered**: a Nest guard or interceptor on the routes —
misses the socket; `@nestjs/throttler` — counts per route and per IP, has no
notion of an agent, and its storage is fixed-window; a check in each of the
three callers — three places to drift.

## R2. Who is exempt, as a rule

**Decision**: `IBridleSendOptions` gets `source: 'visitor' | 'operator' |
'peer'`, default `'visitor'`. Callers set it from what they already verified:

- socket handler and HTTP `resolveRequester`: `'operator'` when the JWT carries
  the `Owner` or `Admin` role (the same test `clientIdFromJwtPayload` uses,
  `chatIdentity.ts:93`), otherwise `'visitor'`;
- `A2aServerService.sendMessage`: `'peer'`.

Only `'visitor'` is checked and counted. The other two are recorded as exempt
traffic for the load view.

**Rationale**: a lookup on a verified role, not a guess (constitution VII). The
default is the counted one, so a new caller that forgets the option is limited
rather than exempt. "Operator" is the identity, not the console: an Owner who
opens the app console, or an admin embed token (`embed:mint-admin`), is exempt
too — they are the same person the spec exempts so that they can test and fix.

**Alternatives considered**: exempt by `clientId === 'admin'` — a string that an
embed `sub` could be made to equal was the subject of CLEAN-175; exempt by
socket origin (the admin console's) — spoofable outside a browser.

## R3. Counting: an exact log per configured window

**Decision**: per agent with limits, one in-memory ascending array of the
timestamps of accepted visitor requests, kept for the longest configured
window. For a window `W` with limit `L`: `used = count(ts > now − W)` by
binary search; the request is refused when `used >= L` for any configured
window; otherwise the timestamp is appended.

**Rationale**: it is the only scheme that makes SC-001 literally true — never
more than `L` in *any* span of `W` (FR-012) — and gives an exact wait (R4).
Memory is bounded by the limit itself: a window cannot hold more accepted
requests than its limit, so the array never exceeds the largest limit (8 bytes
each; a day limit of 100 000 is 0.8 MB). Agents without limits keep no log at
all, so an uncapped agent under flood cannot grow memory.

**Alternatives considered**: fixed windows (reset on the clock) — allows 2×L
around the boundary, which FR-012 forbids; sliding-window *counter*
(weighted previous bucket) — approximate, can let L+ε through; token bucket —
a different promise ("average rate") than the one the operator typed
("N per minute"), and its wait is not the one a person can be told.

## R4. The wait that is reported

**Decision**: for each full window, the wait is
`ts[used − L] + W − now` — the moment the oldest request that has to leave has
left. The refusal carries the **maximum** over all full windows, as
`retryAfterMs`, plus the name of the window that set it. HTTP rounds up to
whole seconds.

**Rationale**: the maximum is what FR-020 asks for — never a countdown that
ends in another refusal of the sender's own making. Rounding up keeps the
promise "never shorter than the real wait"; the error is under one second,
inside SC-003's two.

A duration, not a timestamp, travels on the wire: nothing in any client
compares its clock with the server's today, and a visitor's clock can be wrong
(edge case in the spec). Clients anchor the duration to a monotonic clock on
arrival (R9).

## R5. Surviving a restart

**Decision**: accepted, refused and exempt requests are also added to a
per-agent, per-minute row (`AgentLoadMinute`, see data-model). Pending
increments are flushed every 10 s and in `onModuleDestroy`. On boot, and
whenever an agent's limits are created or changed, the log is rebuilt from the
rows inside the longest window, placing each minute's count at the **end** of
its minute.

**Rationale**: one table serves three needs — restart survival (FR-019), the
last-hour chart, and the 30-day peaks — instead of a store per need. Placing a
rebuilt minute at its end can only over-count, never under-count, so a restart
never hands out extra allowance; the cost is a wait overstated by up to 60 s
for requests accepted before the restart, once. A crash loses at most 10 s of
counts, inside SC-010's "last minute".

10 s is the cadence `ApiInstanceService` already uses for its heartbeat
(`apiInstance.service.ts`), so this adds a write pattern the database already
sees, not a new one.

**Alternatives considered**: persist every request — a write per chat message
on the hot path for a counter; Redis — no Redis anywhere in the stack
(`api/package.json`, `docker-compose.yml`), and one API copy does not need it;
no persistence — fails FR-019, and every deploy would reset the day.

## R6. Where limits are stored

**Decision**: a separate one-to-one model `AgentLimit`, in a new sub-slice
`api/src/slices/agent/limit/`. Not columns on `Agent`.

**Rationale**: the full `Agent` record travels to anonymous subscribers of the
status stream today (CLEAN-225) and to every reader of `AgentDto`. FR-051
forbids limit values there. A separate model cannot leak by default, whichever
order CLEAN-225 and this feature ship in. It is also the slice rule: limits
bring their own domain, data, routes and tool.

**Alternatives considered**: `Agent.config` JSON — untyped, already exposed,
and not regenerated into the SDK; columns on `Agent` — leak on day one.

## R7. Satisfying "public needs limits" in one save

**Decision**: `UpdateAgentDto` and `CreateAgentDto` accept an optional
`limits` object. `AgentService` applies the rule in one transaction: when the
request **sets** `isPublic: true`, or sets `limits`, the resulting agent must
not be public with no limit. A request that touches neither is never refused,
so renaming a legacy public agent keeps working (spec case 8). `PUT
/agents/:id/limits` exists for limits alone and applies the same rule.

The "Show on landing page" checkbox leaves the agent form
(`admin/.../item/Form.vue:283`); the "Visibility & embed" card becomes the one
place that edits public/private, origins and limits, and saves them together.
New agents are created private.

**Rationale**: FR-010. Two saves would mean either a public agent without
limits for a moment or limits on an agent that is not public yet with an error
in between.

## R8. Telling the operator: polling, not a stream

**Decision**: `GET /agents/:id/load` (Owner/Admin) returns the whole live
picture; the admin view polls it every 3 s while it is mounted and the tab is
visible. `GET /agents/limits` returns the per-agent summary for the list
marks, polled every 15 s on the list.

**Rationale**: `EventSource` cannot send an `Authorization` header — which is
exactly why the status stream is public (`agent.controller.ts:163`) and how
CLEAN-225 came about. Load figures must not repeat that. The read is an
in-memory lookup in a single process; 3 s leaves a margin under SC-006's 5 s
for one slow response; 15 s on the list because a mark that is a few seconds
late costs nothing. Polling stops on `visibilitychange` (FR-046).

**Alternatives considered**: SSE over `fetch` with a header — a hand-written
client outside the generated SDK, and buffering proxies in front of the API
have bitten the status stream before; riding on the status stream — public.

## R9. Telling the person: the ack, one new event, one fallback line

**Decision** (contract in `contracts/bridle-protocol.md`):

1. `BridleSendAck` gains `{ status: 'rejected', code: 'RATE_LIMITED',
   retryAfterMs, window }`. Clients that send a `clientMessageId` (both
   consoles today) get it through the existing acknowledgement.
2. A new hub → browser event `agent_limit` `{ limited, retryAfterMs?, window? }`
   to every socket of the agent: on connect when an hour or day window is
   full, when one becomes full, and when a change makes room early (limits
   raised or removed). It is what puts the notice up before a person sends
   (FR-028) and takes it down early (FR-029). Natural expiry needs no event:
   the client is already counting down.
3. A sender without an ack (widget ≤ 0.15, old bundles) gets what it gets for
   an offline agent today: a synthetic `message` — "This agent has reached its
   message limit. Try again in about N minutes." It ends their typing state
   and is a readable line (FR-035). Durations only, in words, English.

A full **minute** window is never pushed (FR-028): it would flicker for
readers.

Clients store `limitedUntil = performance.now() + retryAfterMs` and derive the
display from it, recomputing on `visibilitychange`, so a background tab or a
wrong wall clock cannot distort it (FR-023). The time of day for long waits is
`Date.now() + remaining` formatted by the console's format module.

**Alternatives considered**: `bridle_error` — every client treats it as fatal
and disconnects or shows the red banner; `message_error` — no structured
fields; a per-conversation event — the allowance is the agent's, so the state
is the agent's.

## R10. HTTP refusal and the "remaining" header

**Decision**: `429 Too Many Requests`, header `Retry-After: <seconds>`, body
`{ code: 'RATE_LIMITED', retryAfterSec, window }`, from both routes; the sync
route answers before it starts waiting. On success, `X-RateLimit-Remaining`
and `X-RateLimit-Reset` are added **only when the caller presented a
credential**.

**Rationale**: FR-043 and FR-044 against FR-051. An anonymous caller reading
"remaining: 12" learns the limit and the load, which the spec forbids; a
credentialed integration is the one that can pace itself. The spec's FR-044
was tightened to say so.

## R11. Client state

**Decision**: the limit state is an entity of the `bridle` store in each
console, keyed by `agentId` (`limits[agentId] = { until, window }`), written by
both the ack and the `agent_limit` event, read by the notice component by id.
A refused send rolls the optimistic bubble back through the store and returns
text and attachments to the composer. In admin, limits and load are a new
`agentLimit` store in the `agent` slice (upsert on fetch, `patch()` with
rollback on save), fed by the two polls.

**Rationale**: `docs/state.md` and constitution IV: one entity, one store; the
component renders by id; `useAsyncData` only for loading state.

## R12. Twin consoles

The `bridle` slice exists in both consoles and both are touched, differently
and on purpose:

| | app | admin |
|---|---|---|
| `RATE_LIMITED` ack | notice, roll back, keep text | should never arrive (operators are exempt); handled as a named failure reason so an unknown code cannot crash the store |
| `agent_limit` event | notice before sending | the operator's line (FR-031) |
| Countdown, notice component | yes | no |
| Limits form, load view | read-only "limits on" in the sheet (FR-050) | yes |

The landing chat (`app/.../landing/hero/Stage.vue`) and the share page
(`app/.../share/page/Provider.vue`) are in `app`; whether they reuse the chat
Provider's composer or have their own is checked per file in tasks — each one
that sends must show the notice.

## R13. Widget

**Decision** (in `CleanSlice/bridle`, release 0.16.0):

- `client.send()` mints a `clientMessageId` and passes an ack callback; a new
  client event `limit`; `agent_limit` listened to.
- The widget stops clearing the draft and adding the bubble before the ack
  says accepted, or rolls both back; all five send paths (button, Enter,
  suggestion, form submit, outbox flush) check the limit state (FR-027).
- A notice above the composer; two label options with a `{time}` placeholder
  (`limitLabel`, `limitRetryLabel`), following the existing `*Label` /
  `data-*-label` pattern; a `limit` custom-element event and an `onLimit`
  callback (FR-036).
- **Consequence to handle**: sending a `clientMessageId` makes the hub treat
  the widget as ack-capable, so it stops sending the synthetic "Agent is not
  connected" reply (`bridle.gateway.ts:361`). The new widget must render
  `AGENT_OFFLINE` from the ack itself.
- The Nuxt layer client (`nuxt/stores/bridle.ts`) gets the same change; the
  reference hub types and `docs/PROTOCOL.md` document the new frames.
- `sdk/latest.js` is rebuilt by the DigitalOcean static site, not by npm
  publishing, and is at 0.13.3. The release is not delivered until that site
  is redeployed and the address serves 0.16.0 (FR-037). It carries 0.14 and
  0.15 with it, so the embedding check in quickstart runs against the
  deployed address, not only a local build.

## R14. Charts

**Decision**: the last-hour chart uses `@unovis/vue` through the shadcn chart
wrappers already in `admin/slices/setup/theme/components/ui/chart/` (a
dependency since earlier work, unused so far). Window meters are plain
progress bars. No chart dependency is added to `app`.

## R15. Agent tools

**Decision**: two tools in `api/src/slices/agent/limit/agentLimit.tool.ts`,
audience Owner/Admin: `get_agent_limits` (limits + the same load snapshot as
the console) and `set_agent_limits` (same validation and the same public
rule). `set_agent_limits` carries `confirm` when any value is raised or
removed (FR-054). Results contain numbers only. Read `docs/agent-tools.md`
before writing them; the API refuses to boot a tool without `topic` / `title`
/ `template`.

## R16. More than one API copy

The limiter is per process. With two copies each would grant the full
allowance. This is the same class of problem CLEAN-140 guards against
(`ApiInstanceService.liveCount()`); the limiter logs a warning when
`liveCount() > 1` and the load snapshot carries `apiReplicas` so the view can
say the figures are partial. Making counting shared is part of the
multi-replica project, not this one.

## R17. Proving it in a browser without waiting an hour

**Decision**: playwright-core scripts under
`specs/030-agent-request-limits/e2e/`, on the helpers of
`specs/026-app-console-redesign/e2e/lib.mjs`, against the local stack
(Postgres in Docker, built API, both consoles in dev) — FR-038.

- A **fake agent** script registers on the hub like a runtime and answers
  every message, so the tests do not depend on a model or a pod.
- **Minute** scenarios use real time with small limits: one test waits out a
  real window (≤ 60 s), the rest need only the refusal.
- **Hour and day** scenarios use R5 as the lever: the seed writes
  `AgentLoadMinute` rows so that the window is already full and frees up
  after a known interval, then the API is started and rebuilds from them. This
  exercises restart survival for real and needs no test-only switch in the
  product.
- **"Tomorrow after"** uses Playwright's page clock to put the browser at
  23:00 with a seeded wait of a few hours.

Total run budget: under 10 minutes (FR-040).

**Alternatives considered**: a test-only clock in the API — a production code
path that exists for tests; mocking the socket in the browser — not what
FR-038 asks for.
