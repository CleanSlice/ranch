# Quickstart: Proving Agent Events and Notifications Work

**Feature**: [spec.md](spec.md) | **Contracts**: [event-ingest](contracts/event-ingest.md), [console-api](contracts/console-api.md), [console-ui](contracts/console-ui.md), [agent-tools](contracts/agent-tools.md)

A run-through that shows the feature end to end. No implementation here.

## Prerequisites

- Local stack up: `cd api && bun run dev` (Postgres, migration, API on its dev
  port), `cd admin && bun run dev`.
- A fresh worktree first needs `cd api && bun run generate` and
  `cd admin && npx nuxt prepare`.
- An owner account in the admin console.
- A Slack incoming-webhook address for a throwaway channel (see the steps in
  the spec's clarification answer, or Slack's guide). **Never commit it and
  never paste it into a ticket.**
- `export RANCH_API_URL=http://localhost:3333`

## Checks before anything is switched on

1. **Types are generated, not written**:
   `cd api && bun run build && bun run generate:swagger`, then
   `cd admin && bun run build:api`. The SDK has `AgentEventsService`.
2. **Gates**:
   - `cd api && bun run build` (typecheck)
   - `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/event src/slices/agent/agent src/slices/user/apiKey src/slices/mcp/tool-secrets.spec.ts`
     — run jest directly, never `bun run test` beside a running dev API.
   - `cd admin && bun test slices && npx nuxt typecheck`
   - `bun run locale:check` (repo root)
3. **Statuses are steady** (research R1): open the agent list and watch three
   running agents for two minutes. None may flip to *unreachable* and back.
   If any does, stop: the install runs more than one API replica and that is
   to be fixed before a destination is set.

## Scenario 1 — the endpoint (User Story 1)

1. Admin console → *API keys* → *Create* → name `quickstart-sender`, scope
   **Post agent events**. Copy the key: `export RANCH_EVENTS_KEY=rk_…`
2. Pick a running agent's id: `export AGENT=<id>`
3. Post a failure:

   ```bash
   curl -sS -X POST "$RANCH_API_URL/agent-events" \
     -H "Authorization: Bearer $RANCH_EVENTS_KEY" -H "Content-Type: application/json" \
     -d "{\"agentId\":\"$AGENT\",\"status\":\"failed\",\"reason\":\"quickstart\",\"source\":\"curl\"}"
   ```

   **Expect** `201`, `outcome: "opened"`, an `id` and an `incidentId`.
4. The same without the header → `401`. With `"status":"exploded"` → `400`
   naming the accepted statuses. With a made-up `agentId` → `201`,
   `outcome: "unmatched"`.
5. The key against another route:
   `curl -H "Authorization: Bearer $RANCH_EVENTS_KEY" "$RANCH_API_URL/agents/capacity"`
   → refused (SC-006).

## Scenario 2 — the team is told (User Stories 2 and 6)

1. *Settings → Notifications* → paste the Slack address → *Save*. The page
   now shows "Slack · ends in …" and no address.
2. *Send a test* → "Delivered", and a message labelled as a test in the
   channel (SC-009: under 5 minutes from an empty setup).
3. Repeat Scenario 1 step 3 for a **different** running agent.
   **Expect** within 60 s (SC-001) one Slack message: the agent's name, the
   cause `quickstart`, the time, "Reported by: quickstart-sender (via curl)",
   "Ranch sees: running — the two disagree", and a link that opens that
   agent's *Events* section (when `ADMIN_URL` is set).
4. Reload *Settings → Notifications* and inspect the network answer of
   `GET /agent-events/destination`: no address in it (FR-029).

## Scenario 3 — one incident, one message (User Story 4)

1. Post the same failure for that agent 20 times over a minute.
   **Expect** every answer `201` with `outcome: "joined"`; no new Slack
   message; all 20 in the console list.
2. Wait 10 minutes without posting. **Expect** one closing message — "No
   further reports … Ranch saw the agent running throughout" — and the
   incident shown as closed, *unconfirmed*.
3. Count the channel: exactly two messages for that agent (SC-004).

## Scenario 4 — Ranch notices on its own (User Story 3)

1. Create an agent from a template whose image does not exist (or edit an
   agent's image to a bad tag and restart it).
2. **Expect** within the startup window: the agent turns *failed* in the
   list, an event "Reported by: Ranch" with the cluster's cause
   (`ImagePullBackOff` / `ErrImagePull`), and one Slack message.
3. Fix the image and restart. **Expect** no "failed" message for the restart
   itself (SC-010), and — 10 minutes after the agent is running — one "Agent
   back … down for …" message.
4. Stop a healthy agent, start it, delete a scratch agent. **Expect** nothing
   in Slack.

## Scenario 5 — a restart is not a failure (FR-036)

1. Press *Restart* on a running agent and, while it shows *deploying*, post a
   failure for it. **Expect** `outcome: "suppressed_starting"`, the event in
   the console with "Agent was being started", nothing in Slack.
2. Stop an agent and post a failure for it → `suppressed_stopped`.

## Scenario 6 — Slack is down (FR-022, SC-007)

1. *Replace* the destination with a syntactically valid Slack address that
   does not exist (`https://hooks.slack.com/services/T000/B000/invalid`).
2. Post a failure for a running agent. **Expect** `201` at once; in the
   console the event's notification reads *Not delivered* with Slack's answer
   on hover; *Settings → Notifications* shows the last delivery as failed.
3. *Remove* the destination, post another failure for another agent.
   **Expect** *No destination* on the event and the banner on `/events`.

## Scenario 7 — the flood limit (FR-010)

Post 61 events in a loop inside one minute. **Expect** the 61st answered
`429` with a `Retry-After` header, and 60 rows stored.

## Scenario 8 — ask the Ranch agent (User Story 7)

Open the Rancher chat, press the wrench: *Agents* lists "List agent events"
and "List agent incidents"; *Settings* lists the four notification tools.
Ask "which agents went down today?" **Expect** the same incidents as
`/events`, and no key or address anywhere in the answer.

## Scenario 9 — two replicas (research D3, D4, D7)

Run a second API process against the same database on another port. Post the
same failure to both at once (`&` in the shell). **Expect** one incident, one
Slack message, both events stored.

## Cleanup

Revoke `quickstart-sender` in *API keys* (the next post answers `401`),
remove the destination, delete the scratch agent.
