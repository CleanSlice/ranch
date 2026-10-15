# Data Model: Slack Bot Transport

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

No new table. Three existing tables of
`api/src/slices/agent/event/agentEvent.prisma` change, in one additive
migration with a backfill.

## AgentEventDestination (changed)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `kind` | string | values `webhook` \| `bot` | today's `slack` → `webhook` in the migration |
| `webhookUrl` | string? | now nullable | set only for `webhook` |
| `botToken` | string? | **new** | **secret**; set only for `bot`; read only by `getDestination()` for the notifier |
| `channelId` | string? | **new** | not a secret; returned in the view |
| `hint` | string | unchanged | last four characters of the secret that is set |

Validation (research D9): `webhook` — as today; `bot` — token
`^xoxb-[A-Za-z0-9-]+$`, channel `^[CG][A-Z0-9]{8,}$`. Saving a kind sets the
other kind's secret to `NULL` (FR-006).

## AgentIncident (changed)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `number` | int, unique, autoincrement | **new** | "#12"; backfilled in `openedAt` order (D8) |
| `transport` | string? | **new** | `webhook` \| `bot` \| `NULL`, the destination's kind when the incident opened (D5) |
| `slackChannel` | string? | **new** | the root's channel, set by the first bot delivery |
| `slackTs` | string? | **new** | the root's `ts`; set ⇒ the root exists, never post another |
| `slackReaction` | string? | **new** | the one reaction the bot has on the root (`red_circle`, `large_green_circle`, `white_check_mark`, `black_square_for_stop`) |
| `notificationSeq` | int, default 0 | **new** | next `seq` for this incident's outbox rows (D4) |
| `lastJoinedNotifiedAt` | timestamp? | **new** | when the last "Failed again" reply was queued (D7) |
| `rootStale` | boolean, default false | **new** | a report was swallowed by the minute rule; the sweep rewrites the root |

Indexes: `(number)` unique; `(rootStale)` partial on `true` is unnecessary at
this size — the sweep already reads every open incident.

### Root state, derived (never stored)

| Incident | Root reads | Emoji / reaction |
|----------|-----------|------------------|
| open, `upSince` null or < `lastFailureAt` | `down since <openedAt> · <reason> · <n> reports` | 🔴 `red_circle` |
| open, `upSince` > `lastFailureAt` | `up, watching since <upSince> · <reason> · <n> reports` | 🟢 `large_green_circle` |
| closed `recovered` | `resolved <closedAt> · downtime <upAt − openedAt> · <n> reports` | ✅ `white_check_mark` |
| closed `unconfirmed` | `quiet since <lastFailureAt>, unconfirmed · <n> reports` | 🟢 `large_green_circle` |
| closed `stopped` | `stopped by owner <closedAt> · <n> reports` | ⏹ `black_square_for_stop` |
| closed `deleted` | `deleted <closedAt> · <n> reports` | ⏹ `black_square_for_stop` |

"<n> reports" is omitted while `eventCount = 1`.

## AgentNotification (changed)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `kind` | string | values `opened` \| `joined` \| `running` \| `closed` | |
| `seq` | int | **new** | position inside the incident; delivered in order (D4) |
| `payload` | json | unchanged shape per kind, two new kinds | see below |

Unique: `(incidentId, seq)` replaces `(incidentId, kind)`. Existing rows get
`seq` from their kind in the migration (`opened` → 0, `closed` → 1).
Index `(status, nextAttemptAt)` unchanged.

### Payloads

- `opened` — as today (`IOpenedNotificationPayload`).
- `joined` — `{ kind, agentId, agentName, status, reason, occurredAt, witness, senderName, tool, ranchStatus, eventCount }`: the joining report as received, plus the count at that moment.
- `running` — `{ kind, agentId, agentName, at }`.
- `closed` — as today (`IClosedNotificationPayload`) plus `eventCount`; for `stopped` / `deleted` it is now queued on the bot transport (reply + rewrite, no channel message) and still `null` on the webhook.

### Who queues what

| Moment | Write | Queues (bot) | Queues (webhook) |
|--------|-------|--------------|------------------|
| first failure | `openIncident` | `opened` (seq 0) | `opened` |
| later failure | `touchIncidentFailure` | `joined`, if ≥ 60 s since the last; else `rootStale = true` | nothing |
| Ranch sees running | `setIncidentUpSince` | `running`, once per up-turn (only when `upSince` was null) | nothing |
| sweep: quiet 10 min | `closeIncident` | `closed` | `closed` |
| sweep: stopped / deleted | `closeIncident` | `closed` (silent kind: reply + rewrite only) | nothing |

## Console store (`admin/slices/agent/event/stores/agentEvent.ts`)

Unchanged shape. `INotificationDestination` gains `channelId: string | null`
and `kind: 'webhook' | 'bot' | null`; `saveDestination(input)` takes the
save body of [contracts/console-api.md](contracts/console-api.md).
`IAgentIncident` gains `number`.
