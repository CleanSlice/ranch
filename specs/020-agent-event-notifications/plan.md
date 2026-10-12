# Implementation Plan: Agent Events — an Endpoint to Post Failures to, and a Notification When an Agent Goes Down

**Branch**: `feat/CLEAN-139-agent-event-notifications` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

**Ticket**: [CLEAN-139](https://dreamvention.atlassian.net/browse/CLEAN-139)

**Input**: Feature specification from `/specs/020-agent-event-notifications/spec.md`; planning input: "и жду конкретики по тому, что передать девопсу" — the sender's contract is [contracts/event-ingest.md](contracts/event-ingest.md).

## Summary

The team must find out when an agent goes down. Ranch already detects most
failures and tells nobody; an outside sender would be a second witness and
does not exist yet. The plan builds three things and joins them at one point:

1. **An address an outside sender posts to** —
   `POST /agent-events`, authorised by an API key that carries one new scope,
   `events:write`, and can do nothing else
   ([contract](contracts/event-ingest.md)). The key system, its console page
   and its agent tools already exist; they learn one scope.
2. **Ranch's own failures as events.** Every status write passes through one
   gateway method; it starts announcing real transitions, exactly once however
   many API replicas are running (research D3).
3. **One incident per agent, one message when it opens and one when it
   closes.** Events from either witness meet in an incident. "At most one open
   per agent" is a database constraint, not a hope (D4). An incident closes
   when Ranch has seen the agent running for 10 quiet minutes (D5). Messages
   go to Slack through an outbox with retries, so the sender's answer never
   waits for Slack and Slack being down loses nothing (D7).

Around that: a console page of events and a section on the agent's page,
refreshed by asking every 5 seconds (D11); a settings page that takes the
Slack address, never shows it again and sends a test (D10); six agent tools
(D13).

Four new tables, one additive migration, one new API sub-slice, one new admin
sub-slice. No new dependency.

## Technical Context

**Language/Version**: TypeScript 5. NestJS 11 in `api`; Vue 3 single-file components on Nuxt 4 in `admin`; Bun for scripts and console tests.

**Primary Dependencies**: `api` — NestJS 11, Prisma 6, `class-validator`, `zod` for tool schemas, global `fetch` with `AbortSignal.timeout`. `admin` — Nuxt 4, Pinia 3, `@hey-api/openapi-ts` generated SDK, shadcn `Table*` components. Nothing added.

**Storage**: Postgres through Prisma. New: `AgentEvent`, `AgentIncident`, `AgentNotification`, `AgentEventDestination` ([data-model.md](data-model.md)). Existing, read: `Agent`, `ApiKey`.

**Testing**: `jest` in `api` (`*.spec.ts`, run directly: `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`); `bun test slices` in `admin` (`*.test.ts`). Typecheck: `bun run build` in `api`, `npx nuxt typecheck` in `admin`. `bun run locale:check` at the root.

**Target Platform**: the API on Node in the existing Kubernetes deployment, **at any replica count** (research F3); the admin console in current evergreen browsers.

**Project Type**: web service + web console (monorepo: `api/`, `admin/`, `app/`).

**Performance Goals**: sender answered within 2 s at p95 (SC-002) — one indexed count, one agent lookup, one or two inserts. Slack message within 60 s of acceptance at p95 (SC-001) — first attempt at once, worker tick 5 s. Console shows a new event within 5 s.

**Constraints**: correct with 1–5 API replicas and no shared bus — every "exactly once" is decided by the database. The sender's answer never depends on Slack. No secret in any answer, log line, tool result or notification. An outside event never writes an agent's status.

**Scale/Scope**: tens of agents per install (22 on production); events arrive in ones and tens a day, bounded at 60 a minute per key; 90 days of history — thousands of rows, not millions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | New `api/src/slices/agent/event/` and `admin/slices/agent/event/`. Touched: `api` `agent/agent` (gateway emits transitions through a port it owns), `user/apiKey` (one scope); `admin` `agent/agent` (one section), `user/apiKey` (one scope), `setting` (one menu entry), `common` (`formatSpan`). The event slice reads the agent slice through `IAgentGateway` and the new `AgentStatusChanges` port — its public surface; nothing reaches the other way. |
| II. Twin consoles | Pass | Admin slices with twins that are touched: `agent`, `user`, `common`. Checked in `app/`: no section list in `app/slices/agent`, no API-key screen in `app/slices/user`, no use of a time span in `app/slices/common`. `app` needs nothing because events are an operator's concern ([console-ui.md](contracts/console-ui.md#twin-consoles)). To be restated in the PR. |
| III. Secrets stay behind `api/` | Pass | One new secret: the Slack webhook address, entered by the owner, stored in `AgentEventDestination.webhookUrl`, read only by `SlackWebhookNotifier` in `api/`. Not an environment variable — it is per install and set in the console. Never returned by any route (D10), never in `runtimeConfig.public`. `ADMIN_URL` (existing, not secret) supplies the console link. |
| IV. One entity, one store | Pass | One store, `agentEvent`: events and incidents by id, order as id lists; fetches and the 5 s refresh upsert the same records; `useAsyncData` for loading state only ([data-model.md](data-model.md)). |
| V. Console is a window, chat is the hands | Pass | Six tools in the slice with topic, title, template, operator gating, `confirm` on removal, no secret in results, a spec, and an entry in `tool-secrets.spec.ts` ([agent-tools.md](contracts/agent-tools.md)). `create_api_key` learns the scope. |
| VI. English is the source | Pass (n/a) | `admin` only, English only. No `app` strings. Dates and spans go through `#common/utils/format`; `locale:check` enforces it. |
| VII. A rule stays a rule | Pass | No model call. Every decision is a rule: outcome by Ranch status (D6), open by constraint (D4), close by one timed condition (D5), retry by schedule (D7). |

**Quality Gate 4 — numbers and their reasons**

| Number | Where | Reason |
|--------|-------|--------|
| 60 events / minute / key | D8, FR-010 | One a second is far above an honest sender for tens of agents; low enough that a runaway sender cannot fill the record. |
| 10 minutes quiet before closing | D5, FR-019/020 | Kubernetes resets a container's crash back-off only after it has run 10 minutes — the cluster's own line between "restarting" and "stable". |
| 30 s incident sweep | D5 | Same as the existing drift sweep (`DRIFT_INTERVAL_MS`); a closing message lags no more than a status does. |
| 5 s outbox tick, 5 s console refresh | D7, D11 | Keeps SC-001 (60 s) with a wide margin; "within a few seconds" in User Story 5. |
| Retries at 0 s, 10 s, 30 s, 2 min, 5 min, 15 min, 30 min | D7, FR-022 | About 53 minutes in all: covers the outages Slack has; past an hour an alarm is history and the console is the record. |
| 5 s per Slack attempt | D7 | A healthy webhook answers in well under a second; a hung one must not hold a worker tick. |
| 90 days of history | D16, FR-033 | The spec's choice; a common default for operational records. |
| `reason` ≤ 2000, `source` ≤ 100, `eventId` ≤ 200 | contract | A cluster's message for a failed container fits in 2000 characters; a Slack section block holds 3000. |

**Post-design re-check**: no violation introduced by Phase 1. Complexity
Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/020-agent-event-notifications/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── event-ingest.md      # the sender's contract — what DevOps gets
│   ├── console-api.md       # read routes, destination, notification text
│   ├── agent-tools.md
│   └── console-ui.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
api/
├── prisma/migrations/<timestamp>_agent_events/migration.sql      # new, additive
└── src/slices/
    ├── agent/
    │   ├── agent/
    │   │   ├── domain/agentStatusChanges.ts                      # new: the port (emit, changes$)
    │   │   ├── data/agent.gateway.ts                             # updateStatus detects and emits a real transition; delete emits
    │   │   └── agent.module.ts                                   # provides and exports the port
    │   └── event/                                                # new sub-slice
    │       ├── agentEvent.module.ts
    │       ├── agentEvent.prisma
    │       ├── agentEvent.ingest.controller.ts                   # POST /agent-events (API key + scope)
    │       ├── agentEvent.controller.ts                          # GET /agent-events, /agent-incidents, destination routes (JWT)
    │       ├── agentEvent.tool.ts  (+ .spec.ts)
    │       ├── dtos/
    │       ├── domain/
    │       │   ├── agentEvent.types.ts
    │       │   ├── agentEvent.gateway.ts                         # abstract
    │       │   ├── agentEvent.service.ts                         # accept an event, decide its outcome
    │       │   ├── agentIncident.service.ts                      # open / join / close
    │       │   ├── agentNotification.worker.ts                   # outbox tick, incident sweep, retention
    │       │   ├── notifier.ts                                   # INotifier
    │       │   └── notificationText.ts                           # pure: payload → message
    │       └── data/
    │           ├── agentEvent.gateway.ts
    │           ├── agentEvent.mapper.ts
    │           └── slackWebhook.notifier.ts
    ├── user/apiKey/
    │   ├── domain/apiKey.types.ts                                # + EventsWrite
    │   ├── data/apiKey.mapper.spec.ts                            # new: the allow-list (built from the enum) keeps the scope
    │   └── apiKey.tool.ts                                        # scope description
    └── mcp/tool-secrets.spec.ts                                  # + set_notification_destination

admin/slices/
├── agent/
│   ├── event/                                                    # new sub-slice — see contracts/console-ui.md
│   └── agent/
│       ├── components/agent/workspace/{sections.ts,Canvas.vue}   # + "events" section
│       ├── composables/useAgentSectionCounts.ts
│       └── utils/sections.test.ts
├── user/apiKey/{domain/apiKey.types.ts,components/apiKey/CreateDialog.vue,data/apiKey.mapper.ts}
├── setting/components/setting/nav/Menu.vue                       # + one entry
├── common/utils/format.ts                                        # + formatSpan
└── setup/api/data/repositories/api/                              # regenerated, never edited

docs/operations/agent-events.md                                   # new: the sender's guide (FR-031)
```

`app/` — nothing.

**Structure Decision**: one new sub-slice on each side, both under `agent`,
because an event has no meaning without an agent. The API slice depends on
`agent/agent` and on the API-key guards; neither depends on it. The settings
page for the destination is a file of the event slice (Nuxt merges pages
across layers), so `setting` gains a menu entry and no knowledge of events.

## Order of work

Each step leaves the product working and can be reviewed on its own.

1. **Scope and port** — `events:write` in every place a scope is spelled out
   (API enum, mapper, tool, three console files); the `AgentStatusChanges`
   port and the transition-detecting `updateStatus`, with its specs.
   *Nothing visible changes.*
2. **Model and ingest** — migration, gateway, `AgentEventService`,
   `POST /agent-events`. *User Story 1 is demonstrable with `curl`.*
3. **Incidents** — open, join, the sweep that closes; Ranch-witness events
   from the port. *Events group into incidents; still silent.*
4. **Destination and Slack** — the table, its routes, the notifier, the
   outbox worker, the test message. *User Stories 2, 3 and 4.*
5. **Console** — regenerate the SDK; the store, `/events`, the agent section,
   `/settings/notifications`, the scope in the key dialog. *User Stories 5
   and 6.*
6. **Tools and the guide** — `agentEvent.tool.ts`, `tool-secrets.spec.ts`,
   `docs/operations/agent-events.md`. *User Story 7; the checklist in
   `docs/agent-tools.md`.*
7. **Quickstart run** — all nine scenarios, including the two-replica one.

A checkpoint comment on CLEAN-139 after steps 2, 4 and 5.

## Open points that are not ours to close

- **How many API replicas production runs** (research F3, R1). If more than
  one, agent statuses flap today and that needs its own ticket before a
  destination is switched on.
- **Which tool DevOps installs as the sender.** The contract does not depend
  on the answer.
- **`ADMIN_URL` on the API deployment.** Without it notifications carry no
  link (D15).
- **"Ranch is down" → Slack**, from Argo CD directly. Not built here.

## Complexity Tracking

No violation to justify.
