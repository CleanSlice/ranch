# Agent events: reporting a failure to Ranch

Applies to whoever wires a sender in the cluster (DevOps) and to the owner who
sets up where the team is told. The feature is CLEAN-139; its rules are in
`specs/020-agent-event-notifications/`.

## What this is

Ranch watches the agents it starts and marks one `failed` or `unreachable`
when its own watch sees that. It also takes reports from outside: a tool in
the cluster posts a short JSON when an agent's pod goes down. Either way the
team gets one message in Slack when the trouble starts and one when it is
over, and the admin console keeps the record (**Events** in the sidebar, and
the **Events** section of each agent).

An event from outside is a second witness. **It never changes an agent's
status** — Ranch's own watch stays the only source of that.

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
  "source": "kubernetes-event-exporter",
  "eventId": "3f6c1e0a-crashloop-20261006T211403Z"
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `agentId` | yes | The Ranch agent's id. On the pod: the label `ranch/agent-id`. The pod is named `agent-<agentId>` and lives in namespace `agents`. |
| `status` | yes | `failed` or `recovered`. Anything else is refused. |
| `datetime` | no | When it happened, ISO 8601 with an offset. Left out: the time Ranch received it. |
| `reason` | no | The cause in the cluster's own words, up to 2000 characters. Shown as sent. |
| `source` | no | The tool that noticed, up to 100 characters. Detail only — who sent the event is taken from the key. |
| `eventId` | no | Your own id for the event, up to 200 characters. With it a retry is safe: the same `eventId` from the same key is stored once. |

The minimum is `{ "agentId": "…", "status": "failed" }`. Unknown fields are
ignored.

From inside the cluster the service can be called directly, without the public
address: `http://ranch-api.platform.svc:3000/agent-events`.

## The key

An API key with the single scope **`events:write`**, created in the admin
console (**API keys → Create API key**) by an owner or an admin. It is shown
once. It can post events and nothing else — every other route refuses it. Use
one key per sender: the key's name is what Ranch shows as the sender, and
revoking it stops that sender alone. Keep it in a cluster Secret; never in a
manifest in git.

## The answers

Any `2xx` means "Ranch has it — do not retry".

| Status | When | Retry |
|--------|------|-------|
| `201` | Stored. Body: `{ "success": true, "data": { "id", "outcome", "incidentId", "duplicate": false } }` | no |
| `200` | Ranch already had this event (`"duplicate": true`): the same `eventId`, or the same `agentId` + `status` + `datetime`, from the same key. | no |
| `400` | A required field is missing or a value is not accepted. `message` names the field. | no — fix the body |
| `401` | No key, a wrong one, a revoked one. | no — fix the key |
| `403` | The key lacks `events:write`. | no |
| `429` | More than 60 events in a minute from this key. `Retry-After` says how many seconds to wait. | yes, after the delay |
| `5xx` / no answer | Ranch is down or restarting. | yes, with back-off |

`outcome` says what the event did:

| `outcome` | Meaning |
|-----------|---------|
| `opened` | Opened an incident; the team is being notified. |
| `joined` | An incident for this agent is already open; stored, no second message. |
| `suppressed_stopped` | A person stopped this agent on purpose; stored, nobody notified. |
| `suppressed_starting` | The agent is being started or restarted right now; stored, nobody notified. |
| `unmatched` | No agent with this id; stored, nobody notified. |
| `evidence` | A `recovered` event; stored. |

## What to send, and what not to bother with

- **`failed` alone is a complete sender.** An incident closes by itself when
  Ranch has seen the agent running for 10 minutes with no further `failed`.
  `recovered` is optional and is kept as evidence.
- **Repeats are harmless.** The first `failed` for an agent notifies the team;
  later ones are stored quietly while the incident is open. A sender may fire
  on every restart of a crash-looping pod.
- **Do not filter restarts.** When a person restarts or stops an agent, Ranch
  knows, and an event about the old pod dying notifies nobody. If the start
  then really fails, Ranch reports it itself within 5 minutes.
- **The limit is 60 events a minute per key.**

## Which tool

The sender needs to do three things: call an HTTPS address with `POST`, set an
`Authorization` header, and write a JSON body with a field read from a pod
label.

- **kubernetes-event-exporter** fits as it is: its webhook receiver takes
  custom `headers` and a templated `layout` for the body, and routes by event
  reason.
- **Argo Events** fits: an HTTP trigger with a templated payload.
- A **`CronJob`** with `kubectl` and `curl` fits and is the simplest.
- **kwatch**, **Robusta**: check first whether their webhook lets you write
  the body. If the format is fixed, a small relay is needed in between.
- **Alertmanager's** webhook posts only its own format — a relay is needed.
- **Argo CD cannot be this sender.** It knows the applications it deploys —
  the Ranch API, the consoles — and not the agents, which Ranch starts itself.

## Checking it by hand

```bash
curl -sS -X POST "$RANCH_API_URL/agent-events" \
  -H "Authorization: Bearer $RANCH_EVENTS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<an agent id>","status":"failed","reason":"manual check","source":"curl"}'
```

For a running agent the answer is `201` with `"outcome": "opened"`, a message
appears in Slack that says the sender reported a failure while Ranch sees the
agent running, and ten quiet minutes later a second message closes it.

## When Ranch itself is down

This address is part of the Ranch API. If the API is down the request fails,
and Ranch can notify nobody. "The Ranch platform is degraded" has to reach
the chat by a path that does not pass through Ranch:

- Argo CD notifications (`on-health-degraded`, `on-sync-failed` for the Ranch
  applications) writing to the same Slack channel directly;
- a check of `GET {RANCH_API_URL}/health` from outside the cluster.

## For the owner: where the team is told

**Settings → Notifications** in the admin console.

1. In Slack: <https://api.slack.com/apps> → **Create New App** → **From
   scratch** → **Incoming Webhooks** → **Activate** → **Add New Webhook to
   Workspace** → pick the channel.
2. Paste the address (`https://hooks.slack.com/services/…`) into the page and
   save. Only a Slack incoming webhook is accepted. The address is a secret:
   it is stored and never shown again — to change it, replace it.
3. Press **Send a test** and see the message arrive.

The API pod needs outbound HTTPS to `hooks.slack.com`. For messages to link
to the agent, the API deployment needs `ADMIN_URL` set to the admin console's
address.

With no destination set, events are still recorded and shown in the console;
the Events page says that nobody outside it is being notified.

## Before switching notifications on

Watch a few running agents in the console for two minutes. None may flip to
*unreachable* and back. If any does, the API is running as more than one
replica while the hub that tracks agent connections is per process — fix that
first, or every flip becomes an incident.
