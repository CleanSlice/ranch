# Contract: Console Routes — Events, Incidents, Destination

**Covers**: FR-013 – FR-029, FR-033, FR-035. Routes for the admin console and,
through the same services, the agent tools
([agent-tools.md](agent-tools.md)).

All routes: `JwtAuthGuard` + `RolesGuard`. Answers are wrapped as
`{ success, data }`. Types reach the console through the generated SDK —
never hand-written.

## Reading

### `GET /agent-events` — Owner, Admin

Query: `agentId?`, `incidentId?` (one incident's reports — its timeline),
`limit?` (default 50, max 200), `before?` (opaque cursor from a previous
answer).

```ts
{
  items: AgentEventDto[];      // newest first, by receivedAt then id
  nextCursor: string | null;
}

AgentEventDto {
  id: string;
  agentId: string | null;
  agentRef: string;
  agentName: string | null;
  status: 'failed' | 'unreachable' | 'recovered';
  reason: string | null;
  witness: 'ranch' | 'external';
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  outcome: 'opened' | 'joined' | 'suppressed_stopped' | 'suppressed_starting' | 'unmatched' | 'evidence';
  incidentId: string | null;
  occurredAt: string;          // ISO
  receivedAt: string;          // ISO
}
```

The console's 5-second refresh is this route without `before`.

### `GET /agent-incidents` — Owner, Admin

Query: `agentId?`, `state?` (`open` | `closed`), `limit?`, `before?`.

```ts
AgentIncidentDto {
  id: string;
  agentId: string | null;
  agentName: string;
  state: 'open' | 'closed';
  status: 'failed' | 'unreachable';
  reason: string | null;
  witnesses: string[];         // sender names, Ranch included
  ranchWitnessed: boolean;
  eventCount: number;
  openedAt: string;
  lastFailureAt: string;
  upSince: string | null;      // set, and state still open → "recovering"
  closedAt: string | null;
  resolution: 'recovered' | 'unconfirmed' | 'stopped' | 'deleted' | null;
  notifications: {
    kind: 'opened' | 'closed';
    status: 'pending' | 'sent' | 'failed' | 'skipped';
    attempts: number;
    sentAt: string | null;
    lastError: string | null;
  }[];
}
```

`notifications[].status` is what the console shows as *notified*, *retrying*,
*not delivered* or *no destination* (FR-022, FR-023).

## The destination

### `GET /agent-events/destination` — Owner, Admin

```ts
{
  configured: boolean;
  kind: 'slack' | null;
  hint: string | null;         // last 4 characters of the address
  updatedBy: string | null;
  updatedAt: string | null;
  consoleLinks: boolean;       // false → ADMIN_URL is not set, messages carry no link
  lastDelivery: { at: string; ok: boolean; error: string | null } | null;
}
```

**The address is never in any answer** (FR-029).

### `PUT /agent-events/destination` — Owner

Body `{ webhookUrl: string }`. `400` unless it is
`https://hooks.slack.com/services/…`. Answers the `GET` shape.

### `DELETE /agent-events/destination` — Owner

`204`. Pending notifications become `skipped`.

### `POST /agent-events/destination/test` — Owner

Sends one message, clearly labelled as a test, straight to the destination
and waits for the result (5 s timeout).

```ts
{ delivered: boolean; error: string | null }
```

`409` when no destination is set. Updates `lastDelivery`.

## Notification text

Fixed at the moment the incident opens or closes; English, like the admin
console. `«…»` is sender-supplied or stored text, escaped for Slack.

**Opened**

```text
🔴 @channel Agent failed: «agent name»   (mentions the whole channel, FR-037)
Cause: «reason»                          (line omitted when there is none)
When: <date in the reader's time zone>
Reported by: «sender name» (via «tool»)  |  Ranch (its own watch)
Ranch sees: «ranchStatus»                (outside events only)
Open in Ranch → <link>                   (omitted when ADMIN_URL is not set)
```

`unreachable` reads "Agent unreachable". When an outside sender says `failed`
and Ranch holds `running`, the "Ranch sees" line is followed by
"— the two disagree" (FR-015).

**Closed, `recovered`**

```text
🟢 Agent back: «agent name»
Down for «16 min» (<from> → <to>), up and stable for 10 minutes.
```

**Closed, `unconfirmed`**

```text
🟢 No further reports: «agent name»
«sender name» reported a failure at <time>. Ranch saw the agent running
throughout, and nothing more has been reported for 10 minutes.
```

`stopped` and `deleted` send nothing (FR-035).

## Tests (API)

- `agentIncident.service.spec.ts` — the state machine in
  [data-model.md](../data-model.md): open, join, reset of the quiet period,
  close by each resolution, no close before 10 minutes, a unique violation on
  opening turns into a join, a lost race on closing enqueues nothing.
- `agentEvent.service.spec.ts` — outcome per Ranch status (D6); Ranch-witness
  event from a transition; no event from a same-status write.
- `agentNotification.worker.spec.ts` — retry schedule, `429` honours
  `Retry-After`, `404` is permanent, a claimed row is not sent twice, no
  destination → `skipped`.
- `slackWebhook.notifier.spec.ts` — `<!channel>` and `<http://x|y>` in a
  reason arrive escaped; a 2000-char reason is cut; the address never appears
  in a thrown error.
- `agentEvent.controller.spec.ts` — roles; the destination answer has no
  `webhookUrl` key at any depth; a non-Slack URL → 400.
- `agent.gateway` spec — a real transition emits once; a same-status write
  emits nothing and still refreshes the reason (research R3).
