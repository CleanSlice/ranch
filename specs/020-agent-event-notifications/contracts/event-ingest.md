# Contract: Reporting an Agent Event to Ranch

**Audience**: whoever wires a sender — DevOps. This is the contract behind
FR-031; at implementation it is published as `docs/operations/agent-events.md`
and shown on the console's *Settings → Notifications* page.

**Covers**: FR-001 – FR-012, FR-034, FR-036.

## The request

```http
POST {RANCH_API_URL}/agent-events
Authorization: Bearer rk_…
Content-Type: application/json
```

```json
{
  "agentId": "3f6c1e0a-7b1d-4c58-9a51-0d8a2c6f4e11",
  "status": "failed",
  "datetime": "2026-10-06T21:14:03Z",
  "reason": "CrashLoopBackOff: back-off 5m0s restarting failed container",
  "source": "kwatch",
  "eventId": "agent-3f6c1e0a-…-1759785243"
}
```

| Field | Required | Type | Meaning |
|-------|----------|------|---------|
| `agentId` | yes | string, ≤ 100 | The Ranch agent's id. On the pod it is the label `ranch/agent-id`; the pod is named `agent-<agentId>` and lives in namespace `agents`. |
| `status` | yes | `failed` \| `recovered` | What happened. Anything else is refused. |
| `datetime` | no | ISO 8601 with offset | When it happened. Left out → the time Ranch received it. |
| `reason` | no | string, ≤ 2000 | The cause in the sender's own words. Shown as sent. |
| `source` | no | string, ≤ 100 | The tool that noticed (`kwatch`, `robusta`, a script's name). Detail only — **who sent it is taken from the key**, not from this field. |
| `eventId` | no | string, ≤ 200 | The sender's own id for this event. Makes a retry safe: the same `eventId` from the same key is stored once. |

Unknown fields are ignored. The body limit is 2 MB; a real event is a few
hundred bytes.

## The credential

An API key created in the admin console (*API keys → Create*) with the single
scope **`events:write`**. It is shown once. It can post events and nothing
else: every other route answers `403`. One key per sender — the key's name is
what Ranch shows as the sender, and revoking it stops that sender alone.

## The answers

Any `2xx` means "Ranch has it — do not retry".

| Status | Body | When |
|--------|------|------|
| `201` | `{ "success": true, "data": { "id", "outcome", "incidentId", "duplicate": false } }` | Stored. |
| `200` | same, with `"duplicate": true` and the first event's `id` | Ranch already has this event (same `eventId`, or same `agentId` + `status` + `datetime`, from the same key). |
| `400` | `{ "statusCode": 400, "message": ["status must be one of the following values: failed, recovered"], "error": "Bad Request" }` | A required field is missing or a value is not accepted. Do not retry. |
| `401` | `{ "statusCode": 401, "message": "Missing API key" \| "Invalid or expired API key" }` | No key, a wrong one, a revoked one. Do not retry. |
| `403` | `{ "statusCode": 403, "message": "Insufficient API key scope" }` | The key lacks `events:write`. Do not retry. |
| `413` | — | Body over 2 MB. |
| `429` | `{ "statusCode": 429, "message": "Too many events from this key — at most 60 a minute" }`, header `Retry-After: <seconds>` | More than 60 events in a minute from this key. Retry after the header's delay. |
| `5xx` / no answer | — | Ranch is down or restarting. Retry with back-off — and see *When Ranch is down*. |

`outcome` tells the sender what the event did:

| `outcome` | Meaning |
|-----------|---------|
| `opened` | Opened an incident; the team is being notified. |
| `joined` | An incident for this agent is already open; stored, no second message. |
| `suppressed_stopped` | A person stopped this agent on purpose; stored, nobody notified. |
| `suppressed_starting` | The agent is being started or restarted right now; stored, nobody notified. If the start fails, Ranch reports it itself within 5 minutes. |
| `unmatched` | No agent with this id; stored, nobody notified. |
| `evidence` | A `recovered` event; stored. |

## What Ranch does with it

- **It never changes the agent's status.** Ranch's own watch stays the only
  source of that (FR-011). The event is a second witness.
- **One message per incident.** The first `failed` for an agent notifies the
  team; later ones for the same agent are stored silently until the incident
  closes.
- **`recovered` is optional.** An incident closes when Ranch itself has seen
  the agent running for 10 minutes with no further `failed`. A sender that
  only ever sends `failed` is a complete sender.
- **Repeats are welcome.** A sender that re-fires every few minutes while the
  agent is down keeps the incident open and costs nothing.

## Examples

A failure, from a shell:

```bash
curl -sS -X POST "$RANCH_API_URL/agent-events" \
  -H "Authorization: Bearer $RANCH_EVENTS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"3f6c1e0a-7b1d-4c58-9a51-0d8a2c6f4e11","status":"failed","datetime":"2026-10-06T21:14:03Z","reason":"OOMKilled","source":"manual"}'
```

The minimum that is accepted:

```json
{ "agentId": "3f6c1e0a-7b1d-4c58-9a51-0d8a2c6f4e11", "status": "failed" }
```

## What the sender needs to be able to do

1. Call an HTTPS address with `POST`.
2. Set one header (`Authorization`).
3. Write a JSON body with at least two fields, one of them read from a pod
   label.

Tools that fit as they are: **kubernetes-event-exporter** (its webhook
receiver takes custom `headers` and a templated `layout` for the body, and
routes by event reason), Argo Events (an HTTP trigger with a templated
payload), a `CronJob` with `kubectl` and `curl`. To be checked before
choosing: kwatch and Robusta — whether their webhook lets the operator write
the body. A tool that posts only its own fixed format (Alertmanager's webhook
is one) needs a small relay in between.

A sender inside the cluster can skip the public address and call the service
directly: `http://ranch-api.platform.svc:3000/agent-events`.

**Argo CD cannot be this sender.** It knows the applications it deploys —
the Ranch API, the consoles — and not the agents, which Ranch starts itself.

## When Ranch is down

This address is part of the Ranch API. If the API is down, the request fails
and no notification can be sent by Ranch. "The Ranch platform is degraded"
must reach the chat by a path that does not pass through Ranch — Argo CD's
own notifications writing to the same Slack channel, or an outside check of
`GET {RANCH_API_URL}/health`.

## Tests (API)

- `agentEvent.ingest.controller.spec.ts`: no key → 401; key without the scope
  → 403; `admin`-scope key → 201 (wildcard, as everywhere); missing `agentId`
  / `status` → 400 naming the field; unknown `status` → 400 listing the
  accepted ones; unknown agent → 201 `unmatched`; duplicate `eventId` → 200
  `duplicate: true`, one row; 61st event in a minute → 429 with `Retry-After`.
- An `events:write`-only key against `GET /agents` (JWT route) and
  `POST /auth/embed/token` (other scope) → refused (SC-006).
