# Data Model: Agent Events and Failure Notifications

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Four new tables, all in `api/src/slices/agent/event/agentEvent.prisma`, one
additive migration. One existing table (`ApiKey`) gains nothing: a scope is a
string in its `scopes` array.

## AgentEvent

One report that something happened to an agent (spec: *Event*).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid, PK | returned to the sender |
| `agentId` | uuid?, FK → `Agent`, `onDelete: SetNull` | `null` when the id matched no agent, or the agent was deleted since |
| `agentRef` | string | the id exactly as the sender gave it (FR-008) |
| `agentName` | string? | the agent's name when the event arrived — survives deletion |
| `status` | string | `failed` \| `unreachable` \| `recovered`. Outside senders may send `failed`, `recovered`; `unreachable` is Ranch's own |
| `reason` | string? | as received, ≤ 2000 chars (FR-005, FR-032) |
| `witness` | string | `ranch` \| `external` (FR-034) |
| `apiKeyId` | string? | the key that posted it; **no FK** — revoking a key deletes its row and must not touch history |
| `senderName` | string | the key's name at the time, or `Ranch` |
| `tool` | string? | the body's `source`, ≤ 100 chars — extra detail, never identity |
| `ranchStatus` | string? | what Ranch held for the agent when the event arrived (FR-015) |
| `outcome` | string | see below |
| `incidentId` | uuid?, FK → `AgentIncident`, `onDelete: SetNull` | |
| `occurredAt` | timestamp | the sender's `datetime`, else `receivedAt` (FR-006) |
| `receivedAt` | timestamp, default now | ordering key |
| `dedupeKey` | string?, **unique** | research D12 |

Indexes: `(receivedAt desc)`, `(agentId, receivedAt desc)`,
`(apiKeyId, receivedAt)` for the flood count (D8), `(incidentId)`.

**`outcome`** — what the event did, decided once on arrival:

| Value | Meaning | Notifies |
|-------|---------|----------|
| `opened` | opened an incident | yes |
| `joined` | joined an open incident | no (FR-018) |
| `suppressed_stopped` | outside event, Ranch holds the agent as stopped (FR-036) | no |
| `suppressed_starting` | outside event, Ranch holds the agent as pending or deploying (FR-036) | no |
| `unmatched` | no agent with that id (FR-008) | no |
| `evidence` | a `recovered` event (FR-020) | no |

**Validation (outside events)**: `agentId` — non-empty string ≤ 100;
`status` ∈ {`failed`, `recovered`}; `datetime` — ISO 8601 with offset,
optional; `reason` ≤ 2000; `source` ≤ 100; `eventId` ≤ 200. Unknown fields are
dropped (global `whitelist`).

## AgentIncident

One stretch of trouble for one agent (spec: *Incident*).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid, PK | |
| `agentId` | uuid?, FK → `Agent`, `onDelete: SetNull` | |
| `agentName` | string | at opening |
| `openKey` | string?, **unique** | the agent id while open, `NULL` when closed — at most one open incident per agent (D4) |
| `status` | string | the first failure's status: `failed` \| `unreachable` |
| `reason` | string? | the first failure's reason |
| `ranchWitnessed` | boolean | true once any event of the incident has `witness = ranch` |
| `openedAt` | timestamp | `occurredAt` of the opening event, never later than its `receivedAt` |
| `lastFailureAt` | timestamp | `receivedAt` of the newest failure event; a new one resets the quiet period |
| `upSince` | timestamp? | when Ranch last saw the agent turn `running`; cleared by a new failure |
| `closedAt` | timestamp? | |
| `resolution` | string? | `recovered` \| `unconfirmed` \| `stopped` \| `deleted` |

Indexes: `(agentId, openedAt desc)`, `(closedAt)`.

### State transitions

```text
                failure event, agent running/unreachable/failed, none open
   (none) ────────────────────────────────────────────────────────────► OPEN
                                                                         │ ▲
                       failure event → lastFailureAt = now, upSince = ∅  │ │
                       Ranch sees running → upSince = now                └─┘

   OPEN ── agent running AND now − max(lastFailureAt, upSince) ≥ 10 min ─► CLOSED
            resolution = ranchWitnessed ? recovered : unconfirmed            notify
   OPEN ── agent stopped ───────────────────────────────────────────────► CLOSED (stopped), silent
   OPEN ── agent deleted ───────────────────────────────────────────────► CLOSED (deleted), silent
```

Closed is final: a failure after closing opens a new incident.

Downtime shown on closing = `(upSince ?? lastFailureAt) − openedAt`; shown only
for `recovered`.

## AgentNotification

One message about an incident, with its delivery (spec: *Notification*).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid, PK | |
| `incidentId` | uuid, FK → `AgentIncident`, `onDelete: Cascade` | |
| `kind` | string | `opened` \| `closed` |
| `payload` | json | what the message says, fixed at the moment it was queued: agent name, status, reason, times, witnesses, Ranch's view, resolution, downtime. **No secret, no agent configuration** (FR-016) |
| `status` | string | `pending` \| `sent` \| `failed` \| `skipped` (no destination set) |
| `attempts` | int, default 0 | |
| `nextAttemptAt` | timestamp | schedule in research D7 |
| `lockedUntil` | timestamp? | a replica's claim on the row |
| `lastError` | string? | Slack's status and body, cut to 300 chars — never the address |
| `sentAt` | timestamp? | |
| `createdAt` | timestamp, default now | |

Unique: `(incidentId, kind)` — an incident has at most one opening and one
closing message, whatever races.
Index: `(status, nextAttemptAt)`.

A test message is sent directly and is not a row here.

## AgentEventDestination

Where the team is told (spec: *Notification destination*). One row.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string, PK | constant `slack` — one destination per install |
| `kind` | string | `slack` |
| `webhookUrl` | string | **secret.** Read only by `SlackWebhookNotifier`; never in a DTO, a log line or a tool result |
| `hint` | string | last 4 characters, for "which one is this" |
| `updatedBy` | string | user id |
| `updatedAt` | timestamp | |
| `lastDeliveryAt` | timestamp? | |
| `lastDeliveryOk` | boolean? | |
| `lastDeliveryError` | string? | |

Validation: `webhookUrl` must be `https`, host exactly `hooks.slack.com`, path
starting `/services/` (D9).

## ApiKey (existing)

New scope value `events:write` in `ApiKeyScopeTypes` and `ALL_API_KEY_SCOPES`.
No column, no migration. The API mapper's allow-list
(`api/src/slices/user/apiKey/data/apiKey.mapper.ts`) is built from
`ALL_API_KEY_SCOPES`, so it follows the enum; the admin console's mapper has
its own list and must be given the value, or it drops the scope silently.

## Agent (existing)

Read only. No new column. `status` and `statusReason` remain written solely by
the agent slice (FR-011).

## Console store shape (`admin/slices/agent/event/stores/agentEvent.ts`)

One store, entities once each (`docs/state.md`):

- `events: Map<id, IAgentEvent>`, `incidents: Map<id, IAgentIncident>`,
  `destination: INotificationDestination | null`.
- Order is kept as id lists per view — `latestIds`, `byAgentIds[agentId]` —
  never as a second copy of the records.
- `fetchLatest()`, `fetchMore()`, `fetchForAgent(agentId)` upsert by id; the
  5-second refresh calls `fetchLatest()` / `fetchForAgent()` and upserts the
  same records.
- `watch()` / `unwatch()` count subscribers so one timer runs, as
  `agentStatus` does for its stream; the timer pauses while the tab is hidden.
- `saveDestination(url)`, `removeDestination()`, `sendTest()` replace
  `destination` with what the server answers — which never contains the
  address.
