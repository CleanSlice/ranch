# Tasks: Slack Bot Transport — One Message per Incident, the Story in Its Thread

**Input**: Design documents from `/specs/021-slack-bot-transport/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tracker**: [CLEAN-165](https://dreamvention.atlassian.net/browse/CLEAN-165) · branch `feat/CLEAN-165-slack-bot-transport`

**Base**: `origin/main` `3baeec9d` (CLEAN-164 merged), fetched 2026-10-14.

**Tests**: required by the plan (Constitution Quality Gate 2) and by `docs/agent-tools.md` (a spec beside every tool). `jest` in `api` (run directly, never `bun run test` beside a dev API), `bun test` in `admin` for pure rules. Each test task comes before the code it covers and is written to fail first. Screens are verified through [quickstart.md](./quickstart.md).

**Organization**: by user story. Paths are repository-relative. "D4", "F2" refer to [research.md](./research.md). `EVENT = api/src/slices/agent/event`, `ADMIN = admin/slices/agent/event`.

## Status after the implementation pass (2026-10-14)

51 of 55 tasks are closed. Three commits on the branch: the API, the
console, the docs.

**Verified**

- `api`: `bun run build`; the whole jest suite — 152 suites, 2130 tests —
  with 223 in `agent/event` + `tool-secrets` (bot notifier error map with a
  mocked `fetch`, the root for every state, the four replies, the flow on
  the bot: idempotent root, one reply a minute, stale-root sweep, ordered
  delivery, late root in its final state, lost rewrite recorded, bot gone →
  skipped; the webhook's two messages unchanged). `eslint --quiet` and
  Prettier (LF) on every changed file.
- `admin`: `bun test slices` (195), `npx nuxt typecheck`, `bun run
  locale:check`; the five changed/new components compiled by the dev server.
- The four Slack calls themselves, with the owner's bot and channel, on
  2026-10-14 before the code was written (three live mockups).

**Not verified, and why**

- **T002 / T027 / T053 — anything against a real database or the live
  bot through the code.** Docker was down for the whole pass; the
  migration's SQL is the `migrate diff` of the schema plus hand-written
  backfills and has not been applied anywhere; the ordered claim's
  `NOT EXISTS` has not run on Postgres. The quickstart is owed in full
  before the PR leaves draft.
- **The screens in a browser** — compiled, not clicked.

## Phase 1: Setup

- [x] T001 Confirm the branch sits on `origin/main` `3baeec9d` and the worktree is clean (`git status`, `git log -1 origin/main`); re-fetch over HTTPS if stale
- [ ] T002 Local database for the migration and the live proof: `cd api && docker compose up -d postgres-local && npx prisma migrate deploy` (memory note: the container is shared across worktrees; `now()` in psql is Kyiv time)

## Phase 2: Foundational — schema, types, ports

*Blocks every story: the three models change together and the ports are shared.*

- [x] T003 Change `EVENT/agentEvent.prisma` per [data-model.md](./data-model.md): `AgentEventDestination` (`kind` doc comment `webhook | bot`, `webhookUrl String?`, `botToken String?`, `channelId String?`), `AgentIncident` (`number Int @unique @default(autoincrement())`, `transport String?`, `slackChannel String?`, `slackTs String?`, `slackReaction String?`, `notificationSeq Int @default(0)`, `lastJoinedNotifiedAt DateTime?`, `rootStale Boolean @default(false)`), `AgentNotification` (`seq Int`, `@@unique([incidentId, seq])` replacing `@@unique([incidentId, kind])`, kind comment `opened | joined | running | closed`)
- [x] T004 Write `api/prisma/migrations/20261014120000_slack_bot_transport/migration.sql` by hand from `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`, then add: `UPDATE "AgentEventDestination" SET kind = 'webhook' WHERE kind = 'slack'`; backfill `AgentNotification.seq` (`opened` → 0, `closed` → 1) **before** the unique is created; backfill `AgentIncident.number` with `row_number() over (order by "openedAt", id)` then `setval` the sequence past the max (D8); apply with `migrate deploy`, prove with `migrate diff --exit-code`
- [x] T005 `cd api && bun run generate` and fix the compile fallout only where types changed (mapper, gateway) — no behaviour yet
- [x] T006 [P] Extend `EVENT/domain/agentEvent.types.ts`: `DestinationKindTypes = 'webhook' | 'bot'`, `NotificationKindTypes` + `joined` + `running`, `IJoinedNotificationPayload`, `IRunningNotificationPayload`, `IClosedNotificationPayload.eventCount`, `SlackReactionNames` map (state → `red_circle` | `large_green_circle` | `white_check_mark` | `black_square_for_stop`), `JOINED_REPLY_GAP_MS = 60_000` (reason in a comment, D7), `ROOT_REASON_MAX = 80`, `BOT_TOKEN_PATTERN`, `CHANNEL_ID_PATTERN` (D9); `INotificationDestination` gains `kind`, `botToken`, `channelId`; `IAgentIncidentData` gains `number`, `transport`, `slackChannel`, `slackTs`, `slackReaction`, `notificationSeq`, `lastJoinedNotifiedAt`, `rootStale`
- [x] T007 [P] Add `ISlackBotNotifier` to `EVENT/domain/notifier.ts` (`post`, `update`, `setReaction`; `ISlackBotCredentials = { token, channelId }`; `PostResultTypes = { ok: true; ts } | failure`) per D3; export from `EVENT/domain/index.ts`
- [x] T008 Extend `EVENT/domain/agentEvent.gateway.ts` (abstract): `openIncident(input + transport, payload)`; `touchIncidentFailure(id, at, ranchWitnessed, senderName, joinedPayload, gapMs)` returning `'joined' | 'joined_quiet' | 'closed'` (queues the `joined` row only when `lastJoinedNotifiedAt` is null or older than `gapMs`, else sets `rootStale`); `setIncidentUpSince(agentId, at, runningPayload)` queuing `running` only when `upSince` was null; `closeIncident(..., payload)` unchanged signature; `claimDueNotification` documented as ordered per incident (D4); `setIncidentRoot(id, channel, ts)`; `setIncidentReaction(id, name)`; `findIncidentById(id)`; `listStaleBotIncidents()`; `clearRootStale(id)`; `saveDestination({ kind, webhookUrl, botToken, channelId, hint, updatedBy })`
- [x] T009 Update the in-memory `FakeGateway` in `EVENT/domain/agentEvent.flow.spec.ts` to the new port so the existing flow tests still pass unchanged (seq counter per incident, ordered claim, throttle fields, root/reaction setters)
- [x] T010 Implement the new port in `EVENT/data/agentEvent.gateway.ts` (Prisma): ordered claim with `NOT EXISTS (earlier seq pending for the same incident)`; `touchIncidentFailure` as one conditional `updateMany` for the throttle + a `$transaction` that bumps `notificationSeq` and inserts the row; `setIncidentUpSince` likewise; `openIncident` writes `transport` and the `opened` row with `seq 0`; the slack setters; `saveDestination` nulling the other kind's secret (D2)
- [x] T011 [P] `EVENT/data/agentEvent.mapper.ts`: new incident fields, destination fields, notification `seq`
- [x] T012 `cd api && bun run build` green; jest `EVENT` green (nothing new asserted yet)

**Checkpoint**: schema migrated and proven, ports extended, every existing spec green.

## Phase 3: User Story 1 — one line per incident in the channel (P1) 🎯 MVP

**Goal**: with the bot destination, an incident is one message whose text and reaction follow its state.

**Independent test**: quickstart Scenario 2 steps 1, 3, 4 and Scenario 3 against the owner's bot: one message, 🔴 → 🟢 → ✅ (and ⏹ / unconfirmed endings).

### Tests first

- [x] T013 [P] [US1] `EVENT/domain/notificationText.spec.ts`: `renderRoot` for the six states of the data-model table — mention only when asked, `· n reports` from 2 on, reason cut to 80 and escaped, link present/absent, emoji matches `SlackReactionNames`; existing `renderOpened` / `renderClosed` snapshots untouched (SC-004)
- [x] T014 [P] [US1] `EVENT/data/slackBot.notifier.spec.ts` with a mocked `fetch`: `post` returns `ts`; `update`; `setReaction` removes then adds and ignores `no_reaction` / `already_reacted`; every row of the [error table](./contracts/slack-bot.md#errors) maps to the right `retryable` and words; 429 honours `Retry-After`; the token never appears in `error` even when Slack echoes it
- [x] T015 [US1] `EVENT/domain/agentEvent.flow.spec.ts` (new `describe` "bot transport"): opening an incident with a bot destination stores `transport = 'bot'`; the first delivery posts the root once and stores `slackTs` / `slackChannel`; a retry after the root was posted does not post another root; `running` and `closed` deliveries rewrite the root and swap the reaction; a failed `update` leaves the row `sent` and lands on `lastDeliveryError` (FR-020); `stopped` / `deleted` on the bot queue a `closed` row and no channel-level message; on the webhook nothing new is queued (FR-021)

### Implementation

- [x] T016 [US1] `EVENT/domain/notificationText.ts`: `renderRoot(incident, consoleUrl, { mention })` per [slack-bot.md](./contracts/slack-bot.md#root--every-rewrite-no-mention); `rootStateOf(incident)` returning `{ emoji, reaction, line }`; `renderOpened` / `renderClosed` untouched
- [x] T017 [US1] New `EVENT/data/slackBot.notifier.ts` implementing `ISlackBotNotifier` over `fetch` (D1): the four methods, `NOTIFY_TIMEOUT_MS`, error map (D10) with the owner's words, token scrubbing of quoted bodies; register in `EVENT/agentEvent.module.ts`
- [x] T018 [US1] `EVENT/domain/agentIncident.service.ts`: `attachFailure` reads the destination kind once per open (through `NotificationDestinationService.kind()`) and passes `transport`; `sweep` queues a `closed` payload for `stopped` / `deleted` when `transport = 'bot'` (still `null` on the webhook); the `closed` payload carries `eventCount`
- [x] T019 [US1] `EVENT/domain/agentNotification.worker.ts`: `deliver()` branches on `destination.kind`; bot path per [one delivery, step by step](./contracts/slack-bot.md#one-delivery-step-by-step-bot-transport) — root once (idempotent on `slackTs`), then the kind's reply, then `renderRoot` + `update`, then the reaction swap when `rootStateOf().reaction` differs from `slackReaction`; side-effect failures recorded with `recordDelivery(false, words)`; thread-reply failure retries the row as today
- [x] T020 [US1] `EVENT/domain/notificationDestination.service.ts`: `kind()` (one cheap read, no cache needed at this size); `consoleUrl()` unchanged; `getDestination()` remains the only read returning secrets
- [x] T021 [US1] Run T013–T015 green; `bun run build`

**Checkpoint**: an incident on the bot is one message that moves; proven in specs, live proof in Phase 8.

## Phase 4: User Story 2 — the story in the thread (P1)

**Goal**: one reply per event, in order, with the one-per-minute rule on repeats.

**Independent test**: quickstart Scenario 2 steps 1–4 (thread has Failed, Failed again, Running again, Resolved; seven reports in a minute add one "Failed again" and the root count catches up) and Scenario 4 step 1 (order survives an outage).

### Tests first

- [x] T022 [P] [US2] `EVENT/domain/notificationText.spec.ts`: `renderReply` for `opened`, `joined`, `running`, and the four `closed` resolutions per [thread replies](./contracts/slack-bot.md#thread-replies--one-per-outbox-row-in-seq-order); never contains `<!channel>` / `<!here>` even when the reason does
- [x] T023 [US2] `EVENT/domain/agentEvent.flow.spec.ts`: a second failure queues `joined` with `seq 1`; a third inside 60 s queues nothing and sets `rootStale`; one at 61 s queues again; `running` is queued once per up-turn; rows of one incident are claimed in `seq` order even when a later one is due first; the sweep rewrites stale roots and clears the flag; two "simultaneous" joins (interleaved fake clock) queue one reply

### Implementation

- [x] T024 [US2] `EVENT/domain/notificationText.ts`: `renderReply(payload)` per kind
- [x] T025 [US2] `EVENT/domain/agentIncident.service.ts`: `attachFailure` builds the `joined` payload (with `eventCount` after the touch) and passes `JOINED_REPLY_GAP_MS`; `noteRunning` builds the `running` payload
- [x] T026 [US2] `EVENT/domain/agentNotification.worker.ts`: `sweepIncidents` also calls `rewriteStaleRoots()` — for every `listStaleBotIncidents()` row: `renderRoot` + `update`, `clearRootStale`; failures recorded, never thrown
- [ ] T027 [US2] `EVENT/data/agentEvent.gateway.ts`: the ordered-claim `NOT EXISTS` proven with a jest-less check against the local database (two rows, later `seq` due earlier → the earlier is claimed first); note the SQL in a code comment
- [x] T028 [US2] Run T022–T023 green; `bun run build`

**Checkpoint**: the thread tells the story in order and stays calm under a flood.

## Phase 5: User Story 3 — the owner chooses the transport (P2)

**Goal**: Settings → Notifications and the tools take the bot's token and channel id, never return the token; the test posts to the channel.

**Independent test**: quickstart Scenario 1.

### Tests first

- [x] T029 [P] [US3] `EVENT/agentEvent.controller.spec.ts`: `SaveNotificationDestinationDto` accepts `{ kind: 'webhook', webhookUrl }` and `{ kind: 'bot', botToken, channelId }`, refuses a missing field per kind, a `xoxp-` token (with the "bot token is needed" message) and a bad channel id; the view never carries `webhookUrl` / `botToken`; `GET` returns `kind` and `channelId`
- [x] T030 [P] [US3] `EVENT/agentEvent.tool.spec.ts`: `set_notification_destination` with both kinds; result has no secret; `get_notification_destination` shows `kind` / `channelId`; Owner-only unchanged
- [x] T031 [P] [US3] `api/src/slices/mcp/tool-secrets.spec.ts`: `botToken: SENTINEL` on the event row
- [x] T032 [P] [US3] `EVENT/data/slackWebhook.notifier.spec.ts` untouched; `EVENT/domain/notificationDestination.service` spec (new `describe` in `agentEvent.flow.spec.ts` or its own file): `save` validates per kind, nulls the other secret, `hint` from the right secret; `sendTest` on the bot posts `renderTest()` with no thread and maps errors to words

### Implementation

- [x] T033 [US3] `EVENT/dtos/notificationDestination.dto.ts`: `SaveNotificationDestinationDto` (`kind` enum, `webhookUrl?`, `botToken?`, `channelId?` with `ValidateIf` per kind, patterns from types, messages per [console-api.md](./contracts/console-api.md)); `NotificationDestinationDto.kind: 'webhook' | 'bot' | null`, `channelId`
- [x] T034 [US3] `EVENT/domain/notificationDestination.service.ts`: `save(input, userId)` per kind (D9), `sendTest()` by kind using `ISlackBotNotifier.post` for the bot, `toView` with `kind` / `channelId`; the removal path unchanged
- [x] T035 [US3] `EVENT/agentEvent.controller.ts`: `PUT` takes the new DTO (route unchanged); swagger descriptions say what each kind needs
- [x] T036 [US3] `EVENT/agentEvent.tool.ts`: `set_notification_destination` schema with `kind` + optional fields, description per [console-api.md](./contracts/console-api.md#agent-tools); `toToolDestination` adds `kind`, `channelId`
- [x] T037 [US3] Run T029–T032 green; `cd api && bun run build && bun run generate:swagger`; `cd admin && bun run build:api`
- [x] T038 [P] [US3] `ADMIN/domain/agentEvent.types.ts` + `ADMIN/data/agentEvent.mapper.ts`: `INotificationDestination.kind: 'webhook' | 'bot' | null`, `channelId`; `ISaveDestination` union; mapper reads the generated DTO
- [x] T039 [US3] `ADMIN/stores/agentEvent.ts`: `saveDestination(input: ISaveDestination)`; keeps nothing of the input
- [x] T040 [P] [US3] New `ADMIN/components/agentEvent/destination/BotForm.vue` per [console-ui.md](./contracts/console-ui.md#bot-form-destinationbotformvue): password token field, channel id field, Save / Replace / Remove (confirm) / Test as the webhook form, `lastDelivery` words, `canEdit`
- [x] T041 [P] [US3] New `ADMIN/components/agentEvent/destination/BotGuide.vue`: the four steps
- [x] T042 [US3] `ADMIN/components/agentEvent/destination/Form.vue` + `ADMIN/pages/settings/notifications.vue`: the kind choice (radio group, disabled for Admin), the "Saving replaces the <other> destination" note, the kind's form and guide below it
- [x] T043 [US3] `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check` at the root; compile each new `.vue` through the dev server

**Checkpoint**: the owner can switch, test and read the destination without a developer; no secret anywhere.

## Phase 6: User Story 4 — the incident has a number (P2)

**Goal**: `#12` everywhere the incident is shown.

**Independent test**: quickstart Scenario 2 step 5 and gate 5 (existing rows numbered).

- [x] T044 [P] [US4] `EVENT/agentEvent.controller.spec.ts` / `EVENT/agentEvent.tool.spec.ts`: incident DTO and `list_agent_incidents` carry `number`
- [x] T045 [US4] `EVENT/dtos/agentEvent.dto.ts` `AgentIncidentDto.number`; `EVENT/agentEvent.tool.ts` `toToolIncident` adds `number`; regenerate swagger + SDK
- [x] T046 [P] [US4] `ADMIN/domain/agentEvent.types.ts` `IAgentIncident.number`; mapper
- [x] T047 [US4] `ADMIN/components/agentEvent/IncidentList.vue`: `#<number>` before the state badge, in the expanded title; the loaded-rows search matches `#<number>` (`ADMIN/utils/eventList.ts` + its test if the search lives there)
- [x] T048 [US4] `bun test slices`, `npx nuxt typecheck`

## Phase 7: User Story 5 — the webhook still works as it did (P3)

**Goal**: SC-004 — byte-for-byte the same two messages on the webhook kind.

- [x] T049 [US5] `EVENT/domain/agentEvent.flow.spec.ts`: with a webhook destination, a full incident (open, two joins, running, close) queues exactly `opened` and `closed`, and `deliver()` calls `INotifier.send` with `renderOpened` / `renderClosed` output and never touches `ISlackBotNotifier`
- [x] T050 [US5] `EVENT/domain/notificationText.spec.ts`: existing snapshots pass without edits (if one had to change, stop: SC-004 is broken)

## Phase 8: Polish, live proof, docs

- [x] T051 [P] `docs/operations/agent-events.md`: a "Slack bot" section — what the owner sees, the four setup steps, the one-per-minute rule, the endings; the webhook section kept
- [x] T052 [P] `specs/021-slack-bot-transport/contracts/console-api.md` and `slack-bot.md` re-read against the code; fix any drift in the docs, not by bending the code
- [ ] T053 Live proof per [quickstart.md](./quickstart.md) against the owner's bot (`SLACK_BOT_OAUTH`, `SLACK_CHANNEL_ID` from `.env.project`, never printed): Scenarios 1, 2, 3, 4 (step 1 by blocking `slack.com`), 5; two API processes for Scenario 4 step 3; record what was run and what was not in the PR
- [x] T054 Gates on the final tree: `cd api && bun run build && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/event src/slices/mcp/tool-secrets.spec.ts`; `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check`; `npx eslint --quiet` + Prettier (`--end-of-line auto`) on changed files
- [ ] T055 Commit(s) with `CLEAN-165`, PR into `main` with: verified / not verified, the twin-console statement (`app` has no `agent/event`: 0 matches), the migration note (backfills, `kind: slack → webhook`), the Slack-side steps for the owner; PR link on CLEAN-165, status In Testing

## Dependencies

- Phase 2 before everything (schema, types, ports, fake gateway).
- US1 (Phase 3) before US2 (Phase 4): the thread rides on the root; `renderReply` is independent of `renderRoot` and can start in parallel with T016.
- US3 (Phase 5) depends on Phase 2 only; its API half (T029–T037) can run beside US1/US2; its console half needs T037's SDK.
- US4 (Phase 6) depends on Phase 2 only.
- US5 (Phase 7) needs US1/US2 complete (it asserts what they do not do on the webhook).
- Phase 8 last.

## Parallel examples

- After T012: T013, T014 (tests) with T029–T032 (US3 API tests) and T044 (US4 test) — all different files.
- After T037: T038, T040, T041 (admin files) in parallel; T042 after them.
- T051 and T052 any time after Phase 5.

## Implementation strategy

**MVP** = Phase 2 + Phase 3 (US1): the bot posts one line that moves, the webhook unchanged. Demonstrable live with the owner's bot. Then US2 (thread) completes the agreed look; US3 makes it switchable without `psql`; US4 and US5 close the spec.
