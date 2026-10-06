# Tasks: Agent Events — an Endpoint to Post Failures to, and a Notification When an Agent Goes Down

**Input**: Design documents from `/specs/020-agent-event-notifications/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tracker**: [CLEAN-139](https://dreamvention.atlassian.net/browse/CLEAN-139) · branch `feat/CLEAN-139-agent-event-notifications`

**Base**: `origin/main` `02c1154b`, fetched 2026-10-06. Re-fetch before starting (T001); if `main` has moved, re-read the line references in [research.md](./research.md) F1–F7 before trusting them.

**Tests**: asked for by the plan (Constitution Quality Gate 2) and listed in each contract under "Tests"; `docs/agent-tools.md` requires a spec beside every tool. `jest` in `api`, `bun test` in `admin` for pure rules. Each test task comes before the code it covers and is written to fail first. There is no component-test harness: what a screen shows is verified through [quickstart.md](./quickstart.md).

**Organization**: tasks are grouped by user story. All paths are repository-relative. "D4", "F3", "R1" refer to [research.md](./research.md).

## Status after the first implementation pass (2026-10-06)

Code and specs are in for every phase. 79 of 91 tasks are closed.

**Verified**

- `api`: `bun run build`; jest over `agent/event`, `agent/agent`,
  `user/apiKey` and `mcp` (tool metadata boot check, no-secret-in-results).
- `admin`: `bun test slices` (171), `npx nuxt typecheck`, `bun run
  locale:check`; every new and changed `.vue` compiles in the dev server.
- **Against a real Postgres** (fresh local database, all 51 migrations
  applied, `prisma migrate diff` reports no difference from the schema), with
  **two API processes** on it and a scripted run of the quickstart: Scenario 1
  (every answer of the endpoint, the key refused elsewhere), Scenario 5
  (`suppressed_stopped`, `suppressed_starting`), Scenario 7 (429 with
  `Retry-After`), Scenario 9 (the same failure posted to both processes at
  once, and ten at once: one incident, one opening message), cursor paging,
  roles on the console routes, the destination refusing non-Slack and
  in-cluster addresses. Ranch's own watch marking pod-less agents failed
  produced exactly one event per transition with both processes sweeping;
  a stopped agent's incident closed silently; an incident aged past the quiet
  period closed as `unconfirmed` with exactly one closing message.

**Not verified, and why**

- **Slack delivery** — T042, T053, the Slack half of T046, T088. No webhook
  address was available, so no message was ever sent to Slack: every queued
  notification in the run ended `skipped` (no destination). What the notifier
  does with Slack's answers is covered by specs with a mocked `fetch` only.
- **The screens in a browser** — T070, T078. Nothing was clicked. The dev
  server serves the pages and compiles the components; what they look like
  and how they behave is unseen.
- **The Rancher agent using the tools** — T082. The API validated all 163
  tools at boot; no agent pod was started to call them.
- **The ten-minute close as it happens** — the quiet period was reached by
  ageing a row in the database, not by waiting with a running pod.
- T087 (pre-flight on the target install) is for whoever switches it on.

**Decided while building**

- The incident, event-service and worker specs are one file,
  `domain/agentEvent.flow.spec.ts`, over an in-memory gateway that enforces
  the two constraints the database does. The rules are about state over time;
  a list of expected mock calls would not have caught the retry bug below.
- `decideDisposition` (pure) answers "incident or not"; *opened* vs *joined*
  is the database's answer, in `AgentIncidentService.attachFailure`.
- Retries wait the schedule's gap after each failed attempt instead of
  counting from when the message was queued — a late message would otherwise
  have fired all its retries back to back (research D7, amended).
- After the security review of the first commit: the flood limit got a
  synchronous in-process gate in front of the database count (a burst of
  parallel requests could pass a count-then-insert; research D8, amended), and
  the ingest route answers an unexpected internal error with a plain "try
  again" instead of the error's own text.
- The link to an agent's events is `?tab=events`: the agent page addresses a
  section by `?tab=<value>`.
- The migration SQL was produced by `prisma migrate diff` between the schema
  before and after, then applied with `migrate deploy`.
- No count badge on the agent's Events section
  ([contracts/console-ui.md](./contracts/console-ui.md)).
- The console keeps the merge and timer logic in `utils/eventList.ts`, where
  it is tested; the store is a thin wrapper (the repo has no store tests).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 … US7)

## Conventions that apply to every task

- Run jest directly: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`. Never `bun run test` beside a running dev API.
- `api` typecheck is `cd api && bun run build`. `admin` typecheck is `cd admin && npx nuxt typecheck`.
- DTO types reach `admin` through the generated SDK only (`cd api && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api`). Never hand-write them.
- No secret in a DTO, a log line, a tool result, a notification or a ticket. The Slack address lives only in `AgentEventDestination.webhookUrl`.
- `admin` is English-only. Dates and spans go through `#common/utils/format`; no `toLocale*String` or `Intl.*` in a component.

---

## Phase 1: Setup

**Purpose**: a worktree in which the gates run, and a known-green baseline.

- [X] T001 Fetch `origin/main` (over HTTPS with `GITHUB_TOKEN` if SSH hangs) and rebase `feat/CLEAN-139-agent-event-notifications` if it moved; note the new base commit at the top of this file
- [X] T002 Prepare the worktree: `bun install` at the root, `cd api && bun run generate` (prisma-import + prisma generate), `cd admin && npx nuxt prepare`
- [X] T003 Record the baseline before any change: `cd api && bun run build`, `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/agent src/slices/user/apiKey`, `cd admin && bun test slices && npx nuxt typecheck`, `bun run locale:check` — write down any failure that is already there so it is not blamed on this work

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the scope, the status port and the tables that every story stands on.

**⚠️ CRITICAL**: no user story work begins until this phase is complete. Nothing visible changes in this phase.

### The `events:write` scope — every place a scope is spelled out (F4)

- [X] T004 Add `EventsWrite = 'events:write'` to `ApiKeyScopeTypes` and to `ALL_API_KEY_SCOPES`, with a doc comment "Post agent events via POST /agent-events. Nothing else.", in `api/src/slices/user/apiKey/domain/apiKey.types.ts`
- [X] T005 [P] Create `api/src/slices/user/apiKey/data/apiKey.mapper.spec.ts` (none exists) with two cases: `normalizeScopes(['events:write'])` keeps the scope, and an unknown value is still dropped. `VALID_SCOPES` in `apiKey.mapper.ts` is built from `ALL_API_KEY_SCOPES`, so T004 should make it pass with no change to the mapper — the spec is what stops the scope being dropped silently if that ever changes
- [X] T006 [P] Add "`events:write` — post agent events (`POST /agent-events`) and nothing else" to the `scopeSchema` description in `api/src/slices/user/apiKey/apiKey.tool.ts`, and a case in `api/src/slices/user/apiKey/apiKey.tool.spec.ts` that `create_api_key` accepts the scope
- [X] T007 [P] Add `EventsWrite = 'events:write'` to `admin/slices/user/apiKey/domain/apiKey.types.ts` and to the allow-list in `admin/slices/user/apiKey/data/apiKey.mapper.ts` (it drops unknown scopes silently)
- [X] T008 [P] Add the `SCOPE_OPTIONS` entry — label `events:write`, description "Post agent events — report an agent failure to Ranch via POST /agent-events. Nothing else." — in `admin/slices/user/apiKey/components/apiKey/CreateDialog.vue`

### The status port (D3, R3)

- [X] T009 Create `api/src/slices/agent/agent/domain/agentStatusChanges.ts`: an `@Injectable()` `AgentStatusChanges` with `emit(change)` and `changes$(): Observable<IAgentStatusChange>`, where `IAgentStatusChange = { agentId: string; status: AgentStatusTypes | 'deleted'; reason: string | null; at: Date }`; export it from `api/src/slices/agent/agent/domain/index.ts`
- [X] T010 Create `api/src/slices/agent/agent/data/agent.gateway.spec.ts` (none exists) with a mocked `PrismaService` and these failing cases: (a) `updateStatus` to a different status emits exactly one change with the status and reason; (b) `updateStatus` to the same status emits nothing and still writes `statusReason` / `workflowId`; (c) a second call racing the first (`updateMany` returning `count: 0`) emits nothing; (d) `delete` emits `status: 'deleted'`
- [X] T011 Make T010 pass in `api/src/slices/agent/agent/data/agent.gateway.ts`: `updateStatus` first runs `prisma.agent.updateMany({ where: { id, NOT: { status } }, data })`; on `count === 1` it emits and returns the row via `findUniqueOrThrow`; on `count === 0` it falls back to today's `prisma.agent.update({ where: { id }, data })` unchanged and emits nothing. `delete` emits after the row is gone. Keep the comment block about `statusReason` intact
- [X] T012 Provide and export `AgentStatusChanges` in `api/src/slices/agent/agent/agent.module.ts`; run the whole agent-slice suite (`npx jest src/slices/agent/agent`) — every existing spec must pass untouched

### The tables (data-model.md)

- [X] T013 Create `api/src/slices/agent/event/agentEvent.prisma` with `AgentEvent`, `AgentIncident`, `AgentNotification`, `AgentEventDestination` exactly as in [data-model.md](./data-model.md) — including `dedupeKey` unique, `openKey` unique, `@@unique([incidentId, kind])`, the four `AgentEvent` indexes, `onDelete: SetNull` on both agent relations and no FK on `apiKeyId`; import `Agent` from `"../agent/agent"`
- [X] T014 Add the back-relations `agentEvents AgentEvent[]` and `agentIncidents AgentIncident[]` and the two import lines to `api/src/slices/agent/agent/agent.prisma`
- [X] T015 Generate the migration (`cd api && bun run migrate`), rename its folder to `api/prisma/migrations/<timestamp>_agent_events/`, and open `migration.sql` with the house header comment ("Additive: … (CLEAN-139). Safe on an existing database."); confirm it only creates tables, indexes and foreign keys

### The slice skeleton (D1)

- [X] T016 [P] Create `api/src/slices/agent/event/domain/agentEvent.types.ts`: the status, witness, outcome, resolution and notification-status unions; `IAgentEventData`, `IAgentIncidentData`, `IAgentNotificationData`, `INotificationDestinationView` (no `webhookUrl` in it), `INotificationPayload`; and the constants with their reasons from the plan's Quality Gate 4 table — `FLOOD_LIMIT_PER_MINUTE = 60`, `QUIET_MS = 10 * 60_000`, `INCIDENT_SWEEP_MS = 30_000`, `OUTBOX_TICK_MS = 5_000`, `RETRY_DELAYS_MS = [0, 10_000, 30_000, 120_000, 300_000, 900_000, 1_800_000]`, `NOTIFY_TIMEOUT_MS = 5_000`, `RETENTION_DAYS = 90` — each with a one-line comment giving the reason
- [X] T017 Create the abstract `IAgentEventGateway` in `api/src/slices/agent/event/domain/agentEvent.gateway.ts` (methods are added by the story that needs them), `AgentEventMapper` in `api/src/slices/agent/event/data/agentEvent.mapper.ts`, an empty `AgentEventGateway extends IAgentEventGateway` in `api/src/slices/agent/event/data/agentEvent.gateway.ts`, and `api/src/slices/agent/event/domain/index.ts`
- [X] T018 Create `api/src/slices/agent/event/agentEvent.module.ts` (imports `AgentModule`, `AuthModule`, `ApiKeyModule`, the Prisma module; provides the gateway) and register `AgentEventModule` in `api/src/app.module.ts`; `cd api && bun run build` passes and the API boots

**Checkpoint**: the scope exists end to end, status transitions are announced exactly once, the tables exist. Baseline gates still green.

---

## Phase 3: User Story 1 — DevOps reports an agent failure to Ranch (Priority: P1) 🎯 MVP

**Goal**: `POST /agent-events` accepts an event from a key with `events:write`, stores it, groups it into an incident and answers at once.

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 1 — with a key that has only `events:write`, post one failure for a running agent from a terminal: `201`, `outcome: "opened"`, an `id` and an `incidentId`; the same key is refused everywhere else.

### Tests for User Story 1 ⚠️ write first, watch them fail

- [X] T019 [P] [US1] `api/src/slices/agent/event/domain/outcome.spec.ts`: the pure rule `decideOutcome({ status, agentFound, ranchStatus, hasOpenIncident })` for every row of the outcome table in [data-model.md](./data-model.md) — `recovered` → `evidence`; no agent → `unmatched`; `stopped` → `suppressed_stopped`; `pending` / `deploying` → `suppressed_starting`; `running` / `unreachable` / `failed` → `opened` or `joined`
- [X] T020 [P] [US1] `api/src/slices/agent/event/domain/agentIncident.service.spec.ts` (open and join only): a failure with none open inserts an incident with `openKey = agentId`; a unique violation (`P2002`) on that insert is caught and the event joins the incident already open; a joining failure sets `lastFailureAt = now` and clears `upSince`; `ranchWitnessed` turns true when a Ranch-witness event joins
- [X] T021 [P] [US1] `api/src/slices/agent/event/domain/agentEvent.service.spec.ts`: an outside event stores `witness: 'external'`, `apiKeyId`, `senderName` = the key's name, `tool` = body `source`, `ranchStatus` = the agent's status at arrival, `agentName` snapshot; missing `datetime` → `occurredAt = receivedAt`; `dedupeKey` built per D12 for each of its three cases; a `dedupeKey` collision returns the first event with `duplicate: true` and inserts nothing; 60 events from one key in the last minute → a `429` `HttpException` carrying the retry delay
- [X] T022 [P] [US1] `api/src/slices/agent/event/agentEvent.ingest.controller.spec.ts`: every case under "Tests (API)" in [contracts/event-ingest.md](./contracts/event-ingest.md) — 401 without a key, 403 without the scope, 201 with the `admin` wildcard, 400 naming the missing field, 400 listing the accepted statuses, 201 `unmatched`, 200 `duplicate: true`, 429 with a `Retry-After` header

### Implementation for User Story 1

- [X] T023 [P] [US1] `api/src/slices/agent/event/domain/outcome.ts`: `decideOutcome` as specified by T019 — a pure function, no injection
- [X] T024 [P] [US1] DTOs in `api/src/slices/agent/event/dtos/`: `postAgentEvent.dto.ts` (`agentId` `@IsString @MaxLength(100)`, `status` `@IsIn(['failed','recovered'])`, optional `datetime` `@IsISO8601({ strict: true })`, `reason` `@MaxLength(2000)`, `source` `@MaxLength(100)`, `eventId` `@MaxLength(200)`, each with `@ApiProperty`) and `agentEventAccepted.dto.ts` (`id`, `outcome`, `incidentId`, `duplicate`); `index.ts`
- [X] T025 [US1] Add to `IAgentEventGateway` and implement in `api/src/slices/agent/event/data/agentEvent.gateway.ts`: `createEvent`, `findEventByDedupeKey`, `countEventsByKeySince(apiKeyId, since)`, `findOpenIncident(agentId)`, `openIncident(data)` (lets `P2002` through as a typed "already open" result), `touchIncidentFailure(id, { ranchWitnessed? })`; mapper functions in `data/agentEvent.mapper.ts`
- [X] T026 [US1] `api/src/slices/agent/event/domain/agentIncident.service.ts`: `attachFailure(event)` → `{ incidentId, opened: boolean }` implementing open-or-join per D4 (T020 green). Leave a clearly named seam `onOpened(incident, event)` that does nothing yet — User Story 2 fills it
- [X] T027 [US1] `api/src/slices/agent/event/domain/agentEvent.service.ts`: `acceptExternal(apiKey, dto)` — flood count (D8) → dedupe lookup (D12) → agent lookup through `IAgentGateway.findById` → `decideOutcome` → `attachFailure` when the outcome is `opened` / `joined` → store → answer; never writes the agent (FR-011). T021 green
- [X] T028 [US1] `api/src/slices/agent/event/agentEvent.ingest.controller.ts`: `@Controller('agent-events')`, `@Post()`, `@UseGuards(ApiKeyGuard, ScopesGuard)`, `@Scopes(ApiKeyScopeTypes.EventsWrite)`, `@ApiTags('agent-events')`, `operationId: 'postAgentEvent'`; `201` for a new event, `200` for a duplicate (set the status on the response), `Retry-After` header on `429`. Register in the module. T022 green
- [X] T029 [US1] Run [quickstart.md](./quickstart.md) Scenario 1 against the local stack, including step 5 (the key against another route, SC-006) and Scenario 7 (61 events in a minute)

**Checkpoint**: User Story 1 is demonstrable with `curl`. Events group into incidents; nobody is told yet. Post a checkpoint comment on CLEAN-139.

---

## Phase 4: User Story 2 — The team hears about a failed agent without looking (Priority: P1)

**Goal**: opening an incident sends one Slack message, through an outbox that survives Slack being down.

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 2 steps 3–4 and Scenario 6 — with a destination set (through the route), a failure for a running agent produces one message within 60 s; a dead address leaves the event stored and marked *not delivered*.

### Tests for User Story 2 ⚠️ write first

- [X] T030 [P] [US2] `api/src/slices/agent/event/domain/notificationText.spec.ts`: the opened text in [contracts/console-api.md](./contracts/console-api.md#notification-text) — cause line omitted when there is no reason; "Reported by: «sender» (via «tool»)" vs "Ranch (its own watch)"; "Ranch sees: running — the two disagree" only for an outside event that disagrees; the link omitted when no console URL is given; `&`, `<`, `>` in agent name, reason, sender and tool arrive escaped (`<!channel>` and `<http://x|y>` cannot survive); a 2000-character reason is cut to fit a block; times rendered as `<!date^…|ISO fallback>`
- [X] T031 [P] [US2] `api/src/slices/agent/event/data/slackWebhook.notifier.spec.ts` with a mocked `fetch`: 200 → delivered; 429 → retryable with the `Retry-After` delay; 400 / 403 / 404 / 410 → permanent; a timeout → retryable; the thrown / returned error text never contains the webhook address
- [X] T032 [P] [US2] `api/src/slices/agent/event/domain/agentNotification.worker.spec.ts` (outbox only): a due `pending` row is claimed by conditional update and sent once; a row another replica claimed (`count: 0`) is skipped; a retryable failure schedules the next attempt per `RETRY_DELAYS_MS`; after the last delay the row becomes `failed`; a permanent failure becomes `failed` at once; no destination → `skipped`; the destination's `lastDelivery*` fields are updated either way
- [X] T033 [P] [US2] `api/src/slices/agent/event/agentEvent.controller.spec.ts` (destination routes): `PUT` with a non-Slack URL → 400 with the reason; `PUT` / `DELETE` / `POST …/test` refuse an Admin, allow an Owner; **the `GET` and `PUT` answers contain no `webhookUrl` key at any depth**; `POST …/test` with none set → 409

### Implementation for User Story 2

- [X] T034 [P] [US2] `api/src/slices/agent/event/domain/notifier.ts`: `INotifier` (`send(webhookUrl, message): Promise<{ ok: true } | { ok: false; retryable: boolean; retryAfterMs?: number; error: string }>`) and `INotificationMessage { text: string; blocks: unknown[] }`
- [X] T035 [P] [US2] `api/src/slices/agent/event/domain/notificationText.ts`: pure `renderOpened(payload, consoleUrl | null)` (and a stub `renderClosed` for User Story 4) producing `INotificationMessage`; console link `<consoleUrl>/agents/<id>?tab=events`. T030 green
- [X] T036 [US2] `api/src/slices/agent/event/data/slackWebhook.notifier.ts`: `fetch` with `AbortSignal.timeout(NOTIFY_TIMEOUT_MS)`, classification per D7, error text = status + first 300 characters of the body. T031 green
- [X] T037 [US2] Add to the gateway (`domain/agentEvent.gateway.ts`, `data/agentEvent.gateway.ts`): `getDestination()` (internal, with the address), `getDestinationView()` (without), `saveDestination`, `removeDestination` (marks pending notifications `skipped`), `recordDelivery`, `enqueueNotification(incidentId, kind, payload)` (unique on `(incidentId, kind)` — a second insert is a no-op), `claimDueNotification(now)`, `markNotification(id, result)`
- [X] T038 [US2] `api/src/slices/agent/event/domain/notificationDestination.service.ts`: `view()`, `save(url, userId)` validating `https` + host `hooks.slack.com` + path `/services/` (D9), `remove()`, `sendTest()` (direct send, 5 s, updates `lastDelivery`), `consoleUrl()` reading `ADMIN_URL ?? ADMIN_BASE_URL` through `ConfigService` (D15)
- [X] T039 [US2] Fill the `onOpened` seam in `api/src/slices/agent/event/domain/agentIncident.service.ts`: build the payload (agent name, status, reason, `occurredAt`, witness, sender name, tool, `ranchStatus`) and `enqueueNotification(incident.id, 'opened', payload)` in the same transaction as the incident insert; an `unmatched` or suppressed event never reaches this point
- [X] T040 [US2] `api/src/slices/agent/event/domain/agentNotification.worker.ts`: `OnModuleInit` / `OnModuleDestroy`, a `setInterval(OUTBOX_TICK_MS)` with a `running` flag and `timer.unref()` in the style of `indexReconcile.service.ts`; one tick drains due rows; also expose `kick()` so `enqueue` can trigger a tick at once without waiting 5 s. T032 green
- [X] T041 [US2] `api/src/slices/agent/event/agentEvent.controller.ts` (JWT, `RolesGuard`): `GET /agent-events/destination` (Owner, Admin), `PUT`, `DELETE`, `POST /agent-events/destination/test` (Owner) with DTOs in `dtos/notificationDestination.dto.ts` — the view DTO has `configured`, `kind`, `hint`, `updatedBy`, `updatedAt`, `consoleLinks`, `lastDelivery` and nothing else. Register everything in the module. T033 green
- [ ] T042 [US2] Run [quickstart.md](./quickstart.md) Scenario 2 steps 3–4 (set the destination with `curl` and an owner token) and Scenario 6 against a real Slack test channel; confirm the first message arrives inside 60 s (SC-001) and the sender's answer did not wait for it (SC-002)

**Checkpoint**: an outside failure reaches the team's chat. Incidents never close yet — that is User Story 4.

---

## Phase 5: User Story 3 — A failure Ranch notices itself is announced the same way (Priority: P2)

**Goal**: every transition to `failed` or `unreachable` becomes a Ranch-witness event and flows through the same incident and notification path.

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 4 steps 1–2 — with no outside sender, an agent given a bad image produces one event "Reported by: Ranch" and one Slack message; a stop, a start and a delete produce none.

### Tests for User Story 3 ⚠️ write first

- [X] T043 [P] [US3] Extend `api/src/slices/agent/event/domain/agentEvent.service.spec.ts`: a `changes$` emission with `failed` or `unreachable` stores an event with `witness: 'ranch'`, `senderName: 'Ranch'`, `apiKeyId: null`, the status and the transition's reason, and opens or joins an incident; emissions with `running`, `stopped`, `deploying`, `pending`, `deleted` store **no** event; a Ranch event joining an incident opened by an outside sender sets `ranchWitnessed` and enqueues nothing new (FR-021); a throwing handler does not end the subscription

### Implementation for User Story 3

- [X] T044 [US3] In `api/src/slices/agent/event/domain/agentEvent.service.ts`: `recordRanchFailure(change)` and, in `onModuleInit`, a subscription to `AgentStatusChanges.changes$()` filtered to `failed` / `unreachable`, each emission handled with its own `catch` (an error costs one event, never the stream); unsubscribe in `onModuleDestroy`. T043 green
- [X] T045 [US3] Extend `renderOpened` in `api/src/slices/agent/event/domain/notificationText.ts` and its spec: status `unreachable` reads "Agent unreachable"; a Ranch-witness event has no "Ranch sees" line
- [ ] T046 [US3] Run [quickstart.md](./quickstart.md) Scenario 4 steps 1–2 and step 4 (stop, start, delete → nothing in Slack, SC-010), then Scenario 9 (two API processes on one database, the same failure posted to both → one incident, one message)

**Checkpoint**: notifications work with no outside sender at all.

---

## Phase 6: User Story 4 — One incident, one message (Priority: P2)

**Goal**: an incident closes by the one timed rule, says so once, and never announces a recovery that does not hold.

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 3 and Scenario 5 — twenty failures and ten quiet minutes make exactly two messages; a failure posted during a restart or for a stopped agent makes none.

### Tests for User Story 4 ⚠️ write first

- [X] T047 [P] [US4] Extend `api/src/slices/agent/event/domain/agentIncident.service.spec.ts` (closing), with an injected clock: agent `running` and `max(lastFailureAt, upSince)` 10 minutes old → closed, resolution `recovered` when `ranchWitnessed`, else `unconfirmed`, one `closed` notification enqueued; 9 min 59 s → still open; a failure joining at minute 9 resets the wait; agent `stopped` → closed `stopped`, nothing enqueued (FR-035); agent missing → closed `deleted`, nothing enqueued; agent `failed` / `unreachable` / `deploying` → stays open; a close that loses the race (`updateMany` `count: 0`) enqueues nothing; a `running` transition on the port sets `upSince`
- [X] T048 [P] [US4] Extend `api/src/slices/agent/event/domain/notificationText.spec.ts`: the `recovered` text ("Agent back … Down for «16 min» … up and stable for 10 minutes", downtime = `(upSince ?? lastFailureAt) − openedAt`) and the `unconfirmed` text ("No further reports … Ranch saw the agent running throughout")

### Implementation for User Story 4

- [X] T049 [US4] Add to the gateway (`domain/agentEvent.gateway.ts`, `data/agentEvent.gateway.ts`): `listOpenIncidentsWithAgent()`, `closeIncident(id, resolution, closedAt)` as `updateMany({ where: { id, openKey: { not: null } }, data: { openKey: null, … } })` returning whether this call closed it, `setIncidentUpSince(agentId, at)`
- [X] T050 [US4] In `api/src/slices/agent/event/domain/agentIncident.service.ts`: `sweep(now)` implementing the table in D5, and `noteRunning(agentId, at)`; in `agentEvent.service.ts` route `running` emissions from the port to `noteRunning` (no event stored). T047 green
- [X] T051 [US4] Implement `renderClosed` in `api/src/slices/agent/event/domain/notificationText.ts` for both resolutions. T048 green
- [X] T052 [US4] Add the incident sweep to `api/src/slices/agent/event/domain/agentNotification.worker.ts` on its own `setInterval(INCIDENT_SWEEP_MS)` with its own `running` flag; extend its spec for "sweep runs, an overlapping tick is skipped"
- [ ] T053 [US4] Run [quickstart.md](./quickstart.md) Scenario 3 (exactly two messages, SC-004), Scenario 5 (`suppressed_starting`, `suppressed_stopped`), and Scenario 4 step 3 (fix the image → one "Agent back" message ten minutes after it is running, none for the restart)

**Checkpoint**: User Stories 1–4 — the whole API behaviour — are done. Post a checkpoint comment on CLEAN-139.

---

## Phase 7: User Story 5 — Operators can see what happened, and when (Priority: P2)

**Goal**: an events page and an agent section in the admin console, current within 5 seconds.

**Independent Test**: post three events for two agents; `/events` shows all three, newest first; one agent's *Events* section shows only its own; a fourth event posted while the page is open appears without a reload.

### Tests for User Story 5 ⚠️ write first

- [X] T054 [P] [US5] Extend `api/src/slices/agent/event/agentEvent.controller.spec.ts` (reading): `GET /agent-events` and `GET /agent-incidents` allow Owner and Admin and refuse any other role (FR-026); `agentId` filters; `limit` is capped at 200; `nextCursor` pages without a gap or a repeat when two events share a `receivedAt`; an incident carries `witnesses`, `eventCount` and its `notifications[]`
- [X] T055 [P] [US5] `admin/slices/agent/event/utils/eventTone.test.ts`: every `outcome` in [contracts/console-ui.md](./contracts/console-ui.md) has its label and a tone; an unknown value falls back to the raw value, never blank; delivery state from `notifications[]` → *Notified* / *Retrying (n)* / *Not delivered* / *No destination*
- [X] T056 [P] [US5] `admin/slices/agent/event/stores/agentEvent.test.ts`: a refresh upserts by id and never duplicates; `fetchMore` appends in order; `byAgentIds` holds ids only; two `watch()` calls start one timer and the second `unwatch()` stops it
- [X] T057 [P] [US5] Add `formatSpan` cases beside the format module's existing tests (`admin/slices/common/utils/format.test.ts`): "45 s", "16 min", "2 h 5 min", "3 d 4 h", zero and a negative span

### Implementation for User Story 5

- [X] T058 [US5] Gateway reads in `api/src/slices/agent/event/data/agentEvent.gateway.ts` (+ abstract): `listEvents({ agentId?, limit, before? })` ordered by `receivedAt desc, id desc` with an opaque cursor, `listIncidents({ agentId?, state?, limit, before? })` including witnesses, event count and notifications
- [X] T059 [US5] `GET /agent-events` and `GET /agent-incidents` in `api/src/slices/agent/event/agentEvent.controller.ts` with `AgentEventDto`, `AgentIncidentDto` and the page DTOs in `api/src/slices/agent/event/dtos/` per [contracts/console-api.md](./contracts/console-api.md); explicit `operationId`s. T054 green
- [X] T060 [US5] Regenerate: `cd api && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api`; commit only the generated files under `admin/slices/setup/api/data/repositories/api/`. If `app`'s generated SDK changes as a side effect of its own typecheck, revert it — `app` uses none of these routes
- [X] T061 [P] [US5] `formatSpan(from: Instant, to: Instant): string` in `admin/slices/common/utils/format.ts`. T057 green
- [X] T062 [P] [US5] Slice scaffold `admin/slices/agent/event/`: `nuxt.config.ts` (alias `#agentEvent`, auto-import `stores/`), `domain/{agentEvent.types.ts,agentEvent.gateway.ts,agentEvent.service.ts,index.ts}`, `data/{agentEvent.gateway.ts,agentEvent.mapper.ts,index.ts}` (generated SDK + `unwrapOrThrow`, extending `BaseGateway`), `plugins/di.ts` providing `$agentEventService`
- [X] T063 [P] [US5] `admin/slices/agent/event/utils/eventTone.ts`: the one place that maps `outcome` and delivery state to a label and a tone. T055 green
- [X] T064 [US5] `admin/slices/agent/event/stores/agentEvent.ts` per [data-model.md](./data-model.md#console-store-shape-adminslicesagenteventstoresagenteventts): `events` and `incidents` maps, `latestIds`, `byAgentIds`, `fetchLatest`, `fetchMore`, `fetchForAgent`, `watch` / `unwatch` (5 s, paused while `document.hidden`), using `createServiceGetter`. T056 green
- [X] T065 [P] [US5] `admin/slices/agent/event/components/agentEvent/OutcomeBadge.vue` and `DeliveryBadge.vue` (render from `eventTone.ts`; the delivery error on hover)
- [X] T066 [US5] `admin/slices/agent/event/components/agentEvent/Table.vue`: props `agentId?`; the default `Table*` components with no wrapper; columns time (`formatStamp(occurredAt)`, plus "received …" when it differs by more than a minute), agent (link to `/agents/<id>?tab=events`; `agentRef` marked "Unknown agent" when unmatched), status, cause (monospace, as received, full text on hover), reported by (`senderName` + `tool`), outcome, notification; renders by id from the store
- [X] T067 [US5] `admin/slices/agent/event/components/agentEvent/Provider.vue` and `admin/slices/agent/event/pages/events.vue`: the open-incidents block, `ListToolbar` with `ListSearch` and `ListSegments` (*All* / *Failures* / *Not notified*), the table, *Load more*, the "Nobody outside this console is being notified" banner when no destination is set (link to `/settings/notifications`), `useAsyncData` for `pending` / `error` only, `watch()` on mount and `unwatch()` on unmount
- [X] T068 [US5] `admin/slices/agent/event/plugins/menu.ts`: sidebar item in `MenuGroupTypes.Main`, title "Events", link `events`, an icon and a `sortOrder` that places it after Agents
- [X] T069 [US5] The agent page: add `{ value: 'events', title: 'Events', … }` after `logs` in `SECTIONS` in `admin/slices/agent/agent/components/agent/workspace/sections.ts`, a branch rendering `<AgentEventTable :agent-id="…" />` in `admin/slices/agent/agent/components/agent/workspace/Canvas.vue`, the open-incident count in `admin/slices/agent/agent/composables/useAgentSectionCounts.ts`, and the new section in `admin/slices/agent/agent/utils/sections.test.ts`
- [ ] T070 [US5] `cd admin && bun test slices && npx nuxt typecheck`, `bun run locale:check`; then verify in a browser against the Independent Test above, including a time shown per the console's format and a non-owner, non-admin account refused

**Checkpoint**: the record is visible. Post a checkpoint comment on CLEAN-139.

---

## Phase 8: User Story 6 — The owner sets it up without a developer (Priority: P3)

**Goal**: a settings page that takes the Slack address, never shows it again, sends a test, and tells DevOps what to send.

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 2 steps 1–2 and 4 and Scenario 1 step 1 — on a fresh install, set a destination, send a test and see it arrive in under 5 minutes (SC-009); create a key with **Post agent events** in the dialog, post with it, revoke it, see the next post refused.

- [X] T071 [P] [US6] Add to `admin/slices/agent/event/stores/agentEvent.test.ts`: `saveDestination` / `removeDestination` / `sendTest` replace `destination` with the server's answer; the store never holds the address after a save
- [X] T072 [US6] Destination in the admin slice: gateway and service methods (`getDestination`, `saveDestination`, `removeDestination`, `sendTest`) in `admin/slices/agent/event/data/agentEvent.gateway.ts` and `domain/`, and the store actions in `admin/slices/agent/event/stores/agentEvent.ts`. T071 green
- [X] T073 [P] [US6] `admin/slices/agent/event/components/agentEvent/destination/Form.vue` per [contracts/console-ui.md](./contracts/console-ui.md): not set → a password field, *Save*, three lines on getting the address with a link to Slack's guide; set → "Slack · ends in «hint» · set by «user» «when»", *Replace* (field starts empty), *Remove* behind a confirm dialog; the server's reason inline for a refused address; the `consoleLinks: false` warning; read-only for an Admin
- [X] T074 [P] [US6] `admin/slices/agent/event/components/agentEvent/destination/TestButton.vue`, modelled on `admin/slices/setting/components/setting/github/StatusCheck.vue`: *Send a test* → "Delivered" or the error inline; shows the last delivery's time (`formatStamp`) and outcome
- [X] T075 [P] [US6] `admin/slices/agent/event/components/agentEvent/destination/SenderGuide.vue`: the address (`runtime.public.apiUrl` + `/agent-events`), the minimal body, the `curl` example and the field table from [contracts/event-ingest.md](./contracts/event-ingest.md), a link to `/api-keys` saying which scope to tick (FR-031)
- [X] T076 [US6] `admin/slices/agent/event/pages/settings/notifications.vue` composing the three components inside the settings layout, and one entry in the `items` array of `admin/slices/setting/components/setting/nav/Menu.vue` — "Notifications — where the team is told when an agent goes down", `to: '/settings/notifications'`
- [X] T077 [P] [US6] `docs/operations/agent-events.md`: the sender's guide, taken from [contracts/event-ingest.md](./contracts/event-ingest.md) — the request, the credential, the answers, `outcome`, what Ranch does with an event, where the agent id is on a pod, the in-cluster address, the tools that fit, "when Ranch is down", and the Slack webhook steps for the owner. No real key, address or host in it
- [ ] T078 [US6] `cd admin && bun test slices && npx nuxt typecheck`; then in a browser: the Independent Test above, and the network answer of `GET /agent-events/destination` after a save contains no address (FR-029)

**Checkpoint**: a new install can be set up from the console alone.

---

## Phase 9: User Story 7 — Ask the Ranch agent what happened (Priority: P3)

**Goal**: every console capability of this feature has its tool (Constitution V).

**Independent Test**: [quickstart.md](./quickstart.md) Scenario 8 — the wrench in the Rancher chat lists the six tools under *Agents* and *Settings*; "which agents went down today?" returns the incidents `/events` shows, with no key or address in the answer.

- [X] T079 [P] [US7] `api/src/slices/agent/event/agentEvent.tool.spec.ts`, in the style of `api/src/slices/agent/peer/peerAdmin.tool.spec.ts`, every case under "Tests" in [contracts/agent-tools.md](./contracts/agent-tools.md): listed for the operator only; one happy path per tool asserting the service call and the result; an unknown agent id → "not found — call list_agents"; `remove_notification_destination` without `confirm` → refusal and no service call; no result contains the webhook address
- [X] T080 [P] [US7] Add `set_notification_destination` with the sentinel in `webhookUrl` to `api/src/slices/mcp/tool-secrets.spec.ts`
- [X] T081 [US7] `api/src/slices/agent/event/agentEvent.tool.ts`: `AgentEventTool implements IConditionallyListedTool` (`isListedForRequest → callerIsOperator(req)`, `requireOperator` in every method) with `list_agent_events`, `list_agent_incidents` (topic `ToolTopics.Agents`), `get_notification_destination`, `set_notification_destination`, `send_test_notification`, `remove_notification_destination` (topic `ToolTopics.Settings`; the last `destructive: true` with `confirm`, description ending in `CONFIRM_SENTENCE`) — names, titles and templates exactly as in the contract, each calling the same service the controller calls; register in `agentEvent.module.ts`. T079 and T080 green
- [ ] T082 [US7] Boot the API (it refuses a tool without `topic` / `title` / `template`), restart the Rancher agent, and run [quickstart.md](./quickstart.md) Scenario 8

**Checkpoint**: all seven stories are done.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T083 Retention (D16, FR-033): `deleteEventsBefore(cutoff)` and `deleteClosedIncidentsBefore(cutoff)` in the gateway, an hourly pass in `api/src/slices/agent/event/domain/agentNotification.worker.ts`, and spec cases — rows older than 90 days go, open incidents and newer rows stay
- [X] T084 [P] Secret sweep: grep the diff for `webhookUrl`, `hooks.slack.com` and `rk_` — the address may appear only in `agentEvent.prisma`, the destination service, the notifier, the DTO that receives it and specs with fake values; no `logger.*` call may interpolate it
- [X] T085 [P] Agreement of the rule documents: read `CLAUDE.md`, `.specify/memory/constitution.md`, `docs/agent-tools.md` and `docs/state.md` against what was built; if this feature makes any statement in them wrong, fix both in this PR (Constitution, Additional Constraints) — expected: no change
- [X] T086 Final gates on a clean tree, with the exact commands recorded for the PR: `cd api && bun run build`; `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/event src/slices/agent/agent src/slices/user/apiKey src/slices/mcp/tool-secrets.spec.ts`; `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check`
- [ ] T087 Pre-flight on the target install ([quickstart.md](./quickstart.md), "Statuses are steady", R1): watch three running agents for two minutes; if any flips to *unreachable* and back, do **not** set a destination there — open the replica ticket of T090 first
- [ ] T088 Full [quickstart.md](./quickstart.md) run, Scenarios 1–9 in order, on the local stack with a real Slack test channel; record what was and was not verified
- [X] T089 Commit (`feat(api,admin): agent events endpoint and failure notifications (CLEAN-139)`), push, open the PR into `main` linking CLEAN-139. The description states: the gates run (T086); the twin-console check in words — `agent`, `user` and `common` were touched in `admin`, and `app` needed nothing because it has no section list, no API-key screen and no use of a time span ([contracts/console-ui.md](./contracts/console-ui.md#twin-consoles)); what the quickstart verified; the four open points from [plan.md](./plan.md)
- [X] T090 Follow-up tickets in CLEAN, each with its surface prefix: `[API]` API replica count vs. the per-process bridle hub (F3, R1); `[API][ADMIN]` `GET /settings` returns secret values to the console (F5); `[API]` a digest when many agents fail at once (R2); `[API][ADMIN]` Telegram as a second destination
- [ ] T091 Put the PR URL on CLEAN-139 with a closing comment (what landed, what DevOps still owes: the sender, `ADMIN_URL`, Argo CD → Slack), and move the ticket to In Testing (transition 51)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → everything else.
- **US1 (Phase 3)** needs Phase 2 only.
- **US2 (Phase 4)** needs US1: a notification is about an incident US1 opens (`onOpened` seam, T026 → T039).
- **US3 (Phase 5)** needs US1 (incident path) and T009–T012 (the port). It can be built before US2 — it would then record Ranch events silently — but its Independent Test needs US2's Slack message.
- **US4 (Phase 6)** needs US2 (the outbox, for the closing message) and is easier to verify with US3 (`running` transitions, Ranch-witnessed recoveries).
- **US5 (Phase 7)** needs US1 for data; it shows more once US2 and US4 exist (delivery state, closed incidents) but its API and UI do not depend on them beyond the tables.
- **US6 (Phase 8)** needs US2's destination routes (T041) and US5's slice scaffold and regenerated SDK (T060, T062).
- **US7 (Phase 9)** needs the services of US2 (destination) and US5 (list reads).
- **Polish (Phase 10)** last.

```text
Phase 1 → Phase 2 → US1 ─┬─► US2 ─┬─► US4 ─┐
                         │        ├─► US6 ◄─┤ (needs US5 scaffold)
                         ├─► US3 ─┘         │
                         └─► US5 ───────────┼─► US7 → Polish
```

### Within each story

Tests first and failing; pure rules (`outcome.ts`, `notificationText.ts`, `eventTone.ts`) before the services that call them; gateway before service before controller; API before the SDK regeneration (T060) before any admin code that imports generated types.

### Files that several tasks edit — never in parallel

`api/src/slices/agent/event/data/agentEvent.gateway.ts` and its abstract (T025, T037, T049, T058, T083); `domain/agentIncident.service.ts` (T026, T039, T050); `domain/agentEvent.service.ts` (T027, T044, T050); `domain/agentNotification.worker.ts` (T040, T052, T083); `agentEvent.controller.ts` (T041, T059); `domain/notificationText.ts` (T035, T045, T051); `admin/slices/agent/event/stores/agentEvent.ts` (T064, T072).

## Parallel Opportunities

- **Phase 2**: T005, T006, T007, T008 after T004; T016 alongside T013.
- **US1**: T019–T022 (four spec files) together; then T023 and T024 together.
- **US2**: T030–T033 together; then T034 and T035 together.
- **US4**: T047 and T048 together.
- **US5**: T054–T057 together; after T060, T061, T062 and T063 together; T065 alongside T064.
- **US6**: T073, T074, T075 and T077 together once T072 is in.
- **US7**: T079 and T080 together.
- **Across stories**, with two people: after US1, one takes US2 → US4 (API), the other US5 (API reads, then the console) — they meet only in the gateway file and the controller file, listed above.

### Example: User Story 1

```text
# the four specs, in parallel:
T019 outcome.spec.ts
T020 agentIncident.service.spec.ts
T021 agentEvent.service.spec.ts
T022 agentEvent.ingest.controller.spec.ts

# then, in parallel:
T023 outcome.ts
T024 dtos/

# then in order: T025 gateway → T026 incident service → T027 event service → T028 controller → T029 quickstart
```

## Implementation Strategy

**MVP — User Story 1 (Phases 1–3)**: the endpoint the request asked for, usable by DevOps with a real key and a real contract. It stores and groups; it tells nobody. Worth merging on its own only if DevOps wants the address early — otherwise:

**The first release worth switching on — User Stories 1–4 (through Phase 6)**: the endpoint, Slack, Ranch's own failures and quiet incidents. Without US3 nothing notifies until DevOps installs a sender; without US4 an incident never closes and a crash loop would have been announced as a recovery. Set the destination with `curl` for this release.

**Then** US5 (the record on screen), US6 (set-up from the console, the guide for DevOps), US7 (the tools). US7 is not optional for the PR that adds the console capabilities: `docs/agent-tools.md` requires the tool in the same PR as the screen — if US5 and US6 ship, US7 ships with them.

One PR is the default (the plan's seven steps were written as reviewable commits inside it). If it grows past what one review can hold, split after Phase 6: API first, console and tools second, stacked on the first.

**Checkpoint comments on CLEAN-139**: after Phase 3, Phase 6 and Phase 7.

## Notes

- Total: 91 tasks. Setup 3 · Foundational 15 · US1 11 · US2 13 · US3 4 · US4 7 · US5 17 · US6 8 · US7 4 · Polish 9.
- Requirements → tasks: FR-001–012, 034, 036 → US1; FR-013–016, 022, 023, 027, 029 → US2 (console half of 027–029 → US6); FR-017, 021 → US3; FR-018–020, 035 → US4; FR-024–026, 032 → US5; FR-028, 031 → US6; FR-030 → US7; FR-033 → T083.
- A task that edits `updateStatus` (T011) touches the most carefully guarded write in the API. Its existing specs are the safety net: none may be changed to make it pass.
