# Data model: Request limits for agents

## Stored

### AgentLimit (new, `api/src/slices/agent/limit/agentLimit.prisma`)

One row per agent that has limits. No row means limits are off.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | String, primary key, FK → `Agent.id`, cascade delete | one-to-one |
| `perMinute` | Int? | null = this window is not limited |
| `perHour` | Int? | |
| `perDay` | Int? | |
| `updatedById` | String? | the user who last changed it; null when changed by a tool call without a user |
| `createdAt` / `updatedAt` | DateTime | |

Validation (domain function, shared by the routes and the tool):

- each value is a whole number from 1 to 1 000 000;
- at least one value is set, otherwise the row is deleted ("limits off");
- where two are set, the longer window's value is not lower than the shorter
  one's (`perMinute ≤ perHour ≤ perDay`); equal is allowed;
- the agent must not end up `isPublic = true` with no row — refused with
  `PUBLIC_AGENT_NEEDS_LIMITS`.

The upper bound is a sanity cap, not a product decision: it keeps the
in-memory log (research R3) under 8 MB per agent.

### AgentLoadMinute (new, same slice)

Counts per agent per minute. Written for every agent that receives traffic,
with or without limits.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | String, FK → `Agent.id`, cascade delete | |
| `minute` | DateTime | start of the minute, UTC |
| `accepted` | Int | visitor requests handed to the agent |
| `refused` | Int | visitor requests refused for a limit |
| `refusedByMinute` / `refusedByHour` / `refusedByDay` | Int | which window caused the refusal (the one that set the wait) |
| `exempt` | Int | operator and agent-to-agent requests, not counted toward limits |

Primary key `(agentId, minute)`; index on `minute` for pruning. Rows exist
only for minutes with traffic. Rows older than 30 days are deleted once a day.
No message content, no identity of any sender (FR-052).

### Agent (unchanged)

No new column. `isPublic` and `allowedOrigins` stay where they are.

## In memory (single API process)

### Per-agent counter, held by `AgentLimitService`

| Field | Meaning |
|-------|---------|
| `limits` | cached copy of the `AgentLimit` row, or null |
| `log` | ascending timestamps (ms) of accepted visitor requests inside the longest configured window; empty when `limits` is null |
| `pending` | increments of the current minutes not yet flushed to `AgentLoadMinute` |
| `lastRefusedAt` | for the load view |
| `pushedUntil` | the `retryAfter` last announced by `agent_limit`, to send the event once per fill and to know there is something to clear |

Transitions:

- **boot** → load all `AgentLimit` rows; for each, rebuild `log` from
  `AgentLoadMinute` rows inside the longest window, each minute's `accepted`
  placed at the end of that minute.
- **limits created or changed** → flush `pending`, rebuild `log` the same way,
  re-evaluate; emit `agent_limit` (full → not full, or the reverse).
- **limits removed** → drop `log`; emit `agent_limit { limited: false }` if one
  was announced.
- **request, source `visitor`** → trim `log`; if any window is full: bump
  `refused*`, return the wait; else append, bump `accepted`; if an hour or day
  window just became full, emit `agent_limit { limited: true, ... }`.
- **request, source `operator` or `peer`** → bump `exempt` only.
- **every 10 s and on shutdown** → flush `pending` (upsert with increment).
- **agent deleted** → drop the counter (rows go by cascade).

### In progress

Not stored: derived on read from the hub's conversations for the agent whose
turn is open (`isTurnOpen`, `bridle.gateway.ts:521`).

## Read models

### Load snapshot (`GET /agents/:id/load`, tool `get_agent_limits`)

```text
limits:      { perMinute, perHour, perDay } | null
isPublic:    boolean
needsLimits: boolean            # public and limits == null
windows:     [ { window: 'minute'|'hour'|'day', used, limit|null, retryAfterSec|null } ] x3
inFlight:    number
series:      [ { minute, accepted, refused, exempt } ] x60   # oldest first, gaps filled with zeros
refused:     { lastHour, lastAt|null, byWindow: { minute, hour, day } }
peaks:       { minute, hour, day }   # highest rolling totals of accepted in the last 30 days
apiReplicas: number             # >1 means the figures are partial (research R16)
```

`used` for windows with no limit is computed from `AgentLoadMinute` plus
`pending` (minute precision), since no log is kept for them.

### Limits summary (`GET /agents/limits`, list marks)

```text
[ { agentId, enabled, atLimit, needsLimits } ]
```

### Limits flag (`GET /agents/:id/limits/enabled`, any signed-in role)

```text
{ enabled: boolean }
```

## Client state

### app — `bridle` store

`limits: Record<agentId, { until: number, window: 'minute'|'hour'|'day' }>`
where `until` is on the `performance.now()` scale. Written by the
`RATE_LIMITED` ack and the `agent_limit` event; an entry is removed when
`until` passes or `agent_limit { limited: false }` arrives.

### admin — `bridle` store

`visitorLimits: Record<agentId, { until, window }>` — same shape, drives the
operator's line only.

### admin — new `agentLimit` store (`agent` slice)

`byAgent: Record<agentId, { enabled, atLimit, needsLimits, limits?, load? }>`.
`fetchSummary()` and `fetchLoad(agentId)` upsert; `save(agentId, limits)` goes
through `patch()` with a rollback.
