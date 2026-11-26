# Tasks: Profile statistics dashboard

**Input**: Design documents from `/specs/038-profile-stats-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/collection.md, contracts/summary-judgments.md, contracts/ui.md, quickstart.md

**Tickets and pull requests**: four PRs into `main` (plan.md, *Delivery*). PR 2, the page, is CLEAN-258. PRs 1, 3 and 4 each get a ticket of their own, linked to CLEAN-258 and created by the first task of their phase. Every commit carries the ticket of its PR. The documents in this directory are committed with PR 1.

**Tests**: included. The contracts name the cases, and the constitution's quality gate asks for the commands that were run.

**Running tests**: a checkpoint names the affected tests, never the whole suite: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path or slice>`, `cd app && bun test slices/<slice>`. Never `bun run test` while a dev API is up. The whole suite runs once per PR, in that PR's ship task; CI runs everything on every pull request.

**Browser checks**: every UI phase ends with a Playwright check at 390 px and at 1440 px, as the roles the phase names, in English and in Russian, with console errors and failed requests read, compared with `reference/profile-stats-prototype.html`. Screenshots go to the scratchpad, never into the repo; the result goes on the ticket in one line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an unfinished task
- **[Story]**: US1 my statistics at a glance · US2 collection · US3 topics, outcomes, open questions · US4 the installation · US5 how agents helped, which models answer

Phases follow the delivery order, not the story numbers: US2 (collection) comes before US1 because US1 cannot be true without it, and US5 ships in the same PR as US1.

## Path Conventions

Paths are relative to the repository root. `admin/` and `app/` files are patched by hand: no Prettier or ESLint run over them. `api/` is formatted by its own tooling; `bun run lint` there rewrites unrelated files, so check touched files with `cd api && npx eslint --quiet <files>` and restore anything outside the change before staging. Generated SDK files are restored with `git show HEAD:<path> > <path>` and the wanted hunks re-applied. `.specify/feature.json` is never staged: restore it to `main`'s value before the first commit.

---

## Phase 1: Setup

- [X] T001 Baseline in this worktree: `bun install`, `cd api && bun run generate && bun run build`, `cd app && npx nuxt prepare`; then `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/chat src/slices/usage src/slices/agent/limit`, `cd app && bun test slices/profile slices/common`, `cd app && npx nuxt typecheck`, and from the root `bun run locale:check && bun run i18n:check && bun run test:scripts`. Record what already fails before this work in the first ticket comment
- [X] T002 Create the Jira ticket for PR 1, `[API] Statistics collection: activity by the hour, refusals by day, spend that outlives its agent` (project CLEAN, assigned through `/rest/api/3/myself`, linked to CLEAN-258 with `Relates`), move it to In Progress, and create the branch `feat/CLEAN-<n>-stats-collection` from `origin/main` with the uncommitted `specs/038-profile-stats-dashboard/` carried over. Restore `.specify/feature.json` with `git show origin/main:.specify/feature.json > .specify/feature.json`
- [X] T003 [P] Write `specs/038-profile-stats-dashboard/e2e/replay.mjs`: connects to the agent socket of the local API as a scripted agent and sends a fixed set of `session_activity` events (two conversations, user and assistant roles, timestamps across three UTC hours, stable `eventId`s); `--twice` sends each event twice in a row, as a retry would (the runtime itself never retries and the hub refuses only an immediate repeat: contracts/collection.md section 2); `--concurrent` sends two different events for one conversation at once; prints per conversation the lifetime totals and the sum of its `ChatActivityHour` rows. Takes the API's environment plus `E2E_API`; refuses to run when the database name does not contain `e2e`
- [X] T004 [P] Write `specs/038-profile-stats-dashboard/e2e/seed-history.mjs`: for `--user <id>` and `--days <n>` creates real conversations with three agents through the scripted runtime (`specs/035-tool-reconnect-chat-queue/evidence/runtime.mjs`) with transcripts in MinIO whose message timestamps are spread over the days, some closed with New chat, plus two ratings, three citations and one hand-over; prints as JSON the figures of `GET /me/stats` it expects for 7, 30 and 90 days in `Europe/Kyiv` and in `America/Los_Angeles`, computed from what it wrote and not from the API. `--clean` removes what it made; same refusal as T003

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the `stats` slice exists, knows what a period is in any time zone, and has a registry a figure can be added to.

- [X] T005 [P] Write `api/src/slices/stats/domain/period.spec.ts` for the rules of contracts/collection.md section 7: `personalRange(period, zone, now)` for 7, 30, 90 in `Europe/Kyiv`, `America/Los_Angeles` and `UTC`, including a `now` on each of the two DST change days; `installationRange(period, now)` in UTC days; `previousFrom` is exactly one period earlier; `resolveZone` returns the zone for a valid IANA name and `UTC` for `''`, `'Mars/Olympus'` and a 200-character string; `localDay(hour, zone)` assigns an hour row at 22:00 UTC to the next day in Kyiv and the same day in Los Angeles; `bucketByDay(rows, zone, days)` returns exactly `days` entries, oldest first, zero-filled. Must fail before T006
- [X] T006 Write `api/src/slices/stats/domain/period.ts` with `PERIODS = [7, 30, 90] as const`, `resolveZone`, `personalRange`, `installationRange`, `localDay`, `bucketByDay`, `weekdayOf` (Monday = 0). Pure, no Nest imports; zone arithmetic through `Intl.DateTimeFormat(...).formatToParts`, no new dependency (depends on T005)
- [X] T007 [P] Write `api/src/slices/stats/stats.prisma` with model `StatFigure` exactly as in data-model.md
- [X] T008 [P] Write `api/src/slices/stats/domain/figure.types.ts` (`IFigureDefinition` with `key`, `scopes`, `firstRecord()`, optional `rebuild` name; `IFigureNote { figure, completeSince }`) and `api/src/slices/stats/domain/statFigure.gateway.ts` (abstract `findAll()`, `createIfAbsent(key, completeSince)`)
- [X] T009 [P] Write `api/src/slices/stats/domain/figureRegistry.spec.ts`: at boot a figure with no row gets one with `firstRecord() ?? now`; a figure with a row is left alone, whatever `firstRecord()` now returns; `notesFor(keys, from)` returns a note only for a figure whose `completeSince` is later than `from`; two figures with the same key refuse to register. Must fail before T010
- [X] T010 Write `api/src/slices/stats/domain/figureRegistry.ts` (`FigureRegistry`: `register`, `onApplicationBootstrap` writing missing rows, `notesFor`), `api/src/slices/stats/data/statFigure.gateway.ts` and `statFigure.mapper.ts`, `api/src/slices/stats/stats.module.ts` providing them, and import `StatsModule` in `api/src/app.module.ts` (depends on T007, T008, T009)

**Checkpoint**: `cd api && bun run generate && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/stats && bun run build` is green; the API boots with an empty registry.

---

## Phase 3: User Story 2 — numbers that stay true as the installation grows (P1) · PR 1

**Goal**: every message is counted once in its hour, the past is filled from transcripts, refusals are kept by day, spend survives its agent. No route and no UI.

**Independent Test**: quickstart section 1.

### Tests for User Story 2

- [X] T011 [P] [US2] Write `api/src/slices/chat/domain/activityBuckets.spec.ts`: messages of both roles across three hours give three rows with the right counts; other roles are ignored; an empty list gives no rows; a message exactly on the hour belongs to the hour it starts; input order does not matter. Must fail before T019
- [X] T012 [P] [US2] Extend `api/src/slices/chat/data/chat.gateway.spec.ts` for contracts/collection.md section 2: a new event increments the lifetime totals and the hour row in one transaction; a repeated `eventId` changes neither; the first event of a new conversation creates the conversation and its hour row with `agentId`, `channel`, `externalUserId` copied; a unique-key race on the hour row is retried once and counted; when the hour write throws, the lifetime increment is rolled back and the error reaches the caller. Must fail before T021
- [X] T013 [P] [US2] Write `api/src/slices/chat/domain/chatActivity.service.spec.ts` for section 3: picks only conversations quiet for 60 minutes, active within 180 days, with `activityRebuiltAt` null or older than `lastMessageAt`, newest first, at most the batch; raises an hour that is lower, leaves an equal or higher one, creates a missing one; a second run changes nothing; a shorter transcript lowers nothing; an unreadable transcript leaves `activityRebuiltAt` untouched and reports once after three failures in a row; a run that finds the previous one going is skipped; `STATS_SETTLE_INTERVAL_SEC=0` starts no timer; the prune removes rows older than 400 days only. Must fail before T022
- [X] T014 [P] [US2] Extend `api/src/slices/agent/limit/domain/agentLimit.service.spec.ts` for section 4: a flush adds the same deltas to the minute row and to the day row of that minute's UTC day; a minute at 23:59 and one at 00:00 land in two days; at boot a day of the last 30 with minute rows and no day row is set to their sum, and a day that already has a row is left alone; the daily prune removes minutes older than 30 days and days older than 400. Must fail before T023
- [X] T015 [P] [US2] Write `api/src/slices/usage/domain/usage-rollup.spec.ts` and extend `api/src/slices/usage/usage.controller.spec.ts`: a report stores the agent's current name with each row; `resolveAgentNames` takes the name from the row when the agent no longer exists and never shows a bare id when a name was stored; `hasPrice` is true for a model in the price list and false for one outside it; `costUsd` is unchanged for both. Must fail before T024

### Schema for User Story 2

- [X] T016 [P] [US2] Write `api/src/slices/chat/chatActivity.prisma` with model `ChatActivityHour` as in data-model.md, and in `api/src/slices/chat/chat.prisma` add `activityRebuiltAt DateTime?`, the relation field for the hours and `@@index([lastMessageAt])` to `ChatSession`
- [X] T017 [P] [US2] Add model `AgentLoadDay` to `api/src/slices/agent/limit/agentLimit.prisma` as in data-model.md, with the comment saying why it exists beside the minute rows
- [X] T018 [P] [US2] In `api/src/slices/usage/usage.prisma` remove the `agent` relation, keep `agentId String`, add `agentName String?`, with a comment giving the reason (FR-031) and the precedent (`ChatMessageSource.knowledgeId`); remove `usages Usage[]` and the import from `api/src/slices/agent/agent/agent.prisma`
- [X] T019 [US2] Create `api/prisma/migrations/<timestamp>_stats_collection/migration.sql` with `cd api && bun run generate` followed by `prisma migrate dev --create-only --name stats_collection` against the local database: the three new tables (`ChatActivityHour`, `AgentLoadDay`, `StatFigure`), the two `ChatSession` changes, the dropped foreign key of `Usage.agentId`, the new column, and by hand `UPDATE "Usage" u SET "agentName" = a."name" FROM "Agent" a WHERE a."id" = u."agentId"`. Read the SQL: nothing is dropped except that one constraint (depends on T007, T016, T017, T018)

### Implementation for User Story 2

- [X] T020 [US2] Write `api/src/slices/chat/domain/activityBuckets.ts`: `bucketByHour(messages)` returning `{ hour, userMessages, agentMessages }[]` for roles `user` and `assistant` (pure) (depends on T011)
- [X] T021 [US2] In `api/src/slices/chat/data/chat.gateway.ts` make `recordActivity` one transaction: the lifetime increment as today; if and only if it applied, or the conversation was just created by this event, upsert `(sessionId, floor(ts to the hour))` adding 1 to `userMessages` or `agentMessages`, retrying once on a unique-key race. Keep the handler in `api/src/slices/bridle/handlers/bridleAgentWs.handler.ts` untouched: it already does not wait and logs a failure (depends on T012, T019)
- [X] T022 [US2] Write `api/src/slices/chat/domain/chatActivity.gateway.ts` (abstract: `findUnsettled(gate)`, `raise(sessionId, copy, rows)`, `markSettled(sessionId, at)`, `pruneBefore(date)`), `api/src/slices/chat/data/chatActivity.gateway.ts`, and `api/src/slices/chat/domain/chatActivity.service.ts`: the settle pass and the daily prune on intervals as `ChatInsightService` does it, `STATS_SETTLE_INTERVAL_SEC` (default 300, `0` off) and `STATS_SETTLE_BATCH` (default 100) read once at init, the transcript read with the options `ChatSyncService.buildReconcileInput` uses, failures reported through `captureBackgroundError(err, 'chat.activity')`. Each constant carries its reason from research R2 in a comment. Register both in `api/src/slices/chat/chat.module.ts` and export the gateway (depends on T013, T020, T021)
- [X] T023 [US2] In `api/src/slices/agent/limit/data/agentLimit.gateway.ts` add the day upsert to the flush transaction, `rebuildMissingDays(sinceDay)`, `pruneDaysBefore(date)` and `findDays(agentIds, from, to)`; declare them in `api/src/slices/agent/limit/domain/agentLimit.gateway.ts`; in `api/src/slices/agent/limit/domain/agentLimit.service.ts` call the rebuild once at init and prune days with the minutes, `DAY_RETENTION_MS` beside `RETENTION_MS` with its reason (depends on T014, T019)
- [X] T024 [US2] In `api/src/slices/usage/data/usage.gateway.ts` and `usage.mapper.ts` write `agentName` on report (the name read once per report through `IAgentGateway`); in `api/src/slices/usage/domain/usage-rollup.ts` let `resolveAgentNames` prefer the row's name; add `hasPrice(model)` to `api/src/slices/usage/domain/model-pricing.ts`; in `api/src/slices/usage/usage.tool.ts` replace "a deleted agent shows its id as the name" with what is now true (depends on T015, T019)
- [X] T025 [P] [US2] Write the first three figure definitions in `api/src/slices/stats/domain/figures/`: `activity.ts` (`firstRecord`: none, so recording starts now; `rebuild: 'chat.settle'`), `refusals.ts` (`firstRecord`: the earliest `AgentLoadDay`), `spend.ts` (`firstRecord`: the earliest `Usage.date`), each calling a `firstRecordAt()` added to the owning slice's public gateway; register them in `api/src/slices/stats/stats.module.ts`
- [X] T026 [P] [US2] Read `docs/operations/error-tracking.md`: if the areas passed to `captureBackgroundError` are enumerated in `sentry.rules.ts`, add `chat.activity` to `api/src/slices/setup/sentry/sentry.rules.ts` and copy the file byte for byte to `admin/slices/setup/sentry/` and `app/slices/setup/sentry/` in the same commit; if they are free text, change nothing and say so in the PR
- [X] T027 [P] [US2] Write `docs/statistics.md` from contracts/collection.md: the two kinds of figure, the live write and its invariant, the settle pass with its numbers and their reasons, the registry, and the three steps of adding a figure. Add one paragraph **Statistics (`api`)** to `CLAUDE.md` pointing to it, in the form of the neighbouring paragraphs, and the matching line to `.specify/memory/constitution.md` only if a principle's wording is affected (it is not expected to be)
- [X] T028 [US2] Checkpoint: `cd api && bun run generate && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/stats src/slices/chat src/slices/usage src/slices/agent/limit && npx eslint --quiet <touched files> && bun run build`; from the root `bun run test:scripts`
- [X] T029 [US2] Run quickstart section 1, items 1 to 8, on the local stack with T003 and T004; write the outcome of each item under *What was run* at the end of this file
- [ ] T030 [US2] Ship PR 1: whole api suite once (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest`); regenerate `api/swagger-spec.json` and both SDKs only if a DTO changed (none is expected); bump the root `package.json` version; commit as `feat(api): …` and `docs(specs): …` with the ticket of T002, staging explicit paths; open the PR into `main` stating which console was checked for the twin rule and why neither needed a change; put the PR on the ticket and move it to In Testing; when CI is green merge with `gh pr merge <n> --merge` as the DREAM account, watch `Release Platform` to its tag, check the tag exists, move the ticket to Done naming the tag

**Checkpoint**: production counts every message in its hour from the release of PR 1; the settle pass is filling the last 180 days.

---

## Phase 4: User Story 1 — my statistics at a glance (P1) · PR 2 🎯 MVP

**Goal**: the Statistics tab with the scoreboard, the activity calendar and "who you talk to", for 7, 30 and 90 days.

**Independent Test**: quickstart section 2, items 1 to 5 and 7 to 10.

- [ ] T031 [US1] Move CLEAN-258 to In Progress if it is not, comment the start, and bring `feat/CLEAN-258-profile-stats-dashboard` onto `origin/main` after PR 1 has merged (`git rebase --onto origin/main <old base>`; the spec documents are in `main` by then)

### Tests for User Story 1

- [ ] T032 [P] [US1] Write `api/src/slices/stats/domain/personalStats.service.spec.ts` against fake gateways: conversations and messages for the period and the previous one from hour rows; a conversation written in on three days counts once in the period and on each day; agents answered counts agents with `agentMessages > 0`; `reachable` is the reach count; an agent outside reach contributes nothing anywhere; the Owner is read under `admin`, everyone else under their `sub`; 91 calendar days in the viewer's zone ending today; weekdays Monday first; `activeDays`; agents ordered by messages with `lastMessageAt`; no rows at all gives zeros and empty lists; a period starting before the figure's `completeSince` carries a note. Must fail before T037
- [ ] T033 [P] [US1] Write `api/src/slices/stats/myStats.controller.spec.ts`: 401 without a token; a User, an Admin and the Owner each get their own; `period` outside 7, 30, 90 is 400; missing `period` is 30; an unknown `tz` answers with `timeZone: 'UTC'`; no query parameter can change whose figures are returned. Must fail before T038
- [ ] T034 [P] [US1] Write `api/src/slices/stats/stats.tool.spec.ts` for `get_my_stats`: metadata complete; the person comes from `requirePerson`; called with nobody behind it answers "This needs a signed-in person."; the result equals the service's answer. Add both `stats` tools' entries to `api/src/slices/mcp/toolReach.spec.ts` (the second as pending until T088). Must fail before T039
- [ ] T035 [P] [US1] Write the pure-function tests in `app/slices/profile/utils/`: `statsView.test.ts` (every row of the address table in contracts/ui.md, unknown values, `scope=installation` clamped for a User, round trip, defaults omitted), `calendarGrid.test.ts` (13 Monday-first columns from 91 days for a `today` on each weekday, month label rule, dimming outside 7, 30, 90, today's cell), `intensity.test.ts` (0, 1, 2, 3, 4, 5, 50), `delta.test.ts` (rise, fall, same, previous 0), `orbitLayout.test.ts` (1, 3 and 9 agents: ring, no overlap, size by share). Must fail before T042
- [ ] T036 [P] [US1] Write `app/slices/profile/stores/profileStats.test.ts` against a fake gateway: `load` upserts under `scope:period`; a second `load` within 60 seconds does not fetch; after 60 seconds it fetches and the held view stays until the answer; a failed fetch sets the status and keeps a held view; an answer that arrives after `resetForAccount` is dropped. Must fail before T045

### API for User Story 1

- [ ] T037 [US1] Add the read side to `chat`: in `api/src/slices/chat/domain/chatActivity.gateway.ts` and its data twin `findHoursForPerson(externalUserId, channel, from, to, agentScope)`; in `api/src/slices/chat/domain/chat.gateway.ts` and `data/chat.gateway.ts` `findSessionsByIds(ids)` returning id, agentId, `lastMessageAt`; add `@@index([externalUserId, channel, lastMessageAt])` to `ChatSession` in `api/src/slices/chat/chat.prisma`. Then write `api/src/slices/stats/domain/personalStats.service.ts` for the board, activity and agents parts of contracts/api.md, taking agent names and current models through `IAgentGateway`, reach through `AgentAccessService`, days through `period.ts`, notes through the registry (depends on T032)
- [ ] T038 [US1] Write the DTOs in `api/src/slices/stats/dtos/` (`myStatsQuery.dto.ts`, `myStats.dto.ts` with every field documented for swagger) and `api/src/slices/stats/myStats.controller.ts`: `@Controller('me/stats')`, `JwtAuthGuard`, `@Roles(UserRoleTypes.User)` with the comment `me/chats` carries, identity from `clientIdFromJwtPayload` and `sub`, `operationId: 'getMyStats'`. The response omits `summaries`, `topics`, `outcome`, `openQuestions` until Phase 6. Add the route to the inventory in `api/src/slices/user/auth/guards/agentRoutes.spec.ts` or whichever neighbour enumerates it (depends on T033, T037)
- [ ] T039 [US1] Write `get_my_stats` in `api/src/slices/stats/stats.tool.ts` as contracts/api.md states it, calling `PersonalStatsService` (depends on T034, T037)
- [ ] T040 [US1] Create `api/prisma/migrations/<timestamp>_stats_read_indexes/migration.sql`: the `ChatSession` index of T037 and the three of T058, in one migration for this PR (depends on T037, T058)
- [ ] T041 [US1] Regenerate: `cd api && bun run build && bun run generate:swagger`, `cd app && bun run build:api`, `cd admin && bun run build:api`. Keep only the hunks of this feature in `api/swagger-spec.json` and in both consoles' `slices/setup/api/data/repositories/api/*.gen.ts`; restore every other hunk (depends on T038)

### App for User Story 1

- [ ] T042 [P] [US1] Write the pure modules `app/slices/profile/utils/statsView.ts`, `calendarGrid.ts`, `intensity.ts`, `delta.ts`, `orbitLayout.ts` (no Vue imports; the constants taken from the prototype carry a comment saying so) (depends on T035)
- [ ] T043 [P] [US1] Extend `app/slices/common/utils/format.ts` and `app/slices/common/composables/useFormat.ts` with `compact` ("1.2M", "340k"), `money`, `weekdayShort`, `monthShort`, `dayMonth` and `timeZone()`; cases in `app/slices/common/utils/format.test.ts` for `en` and `ru`. `admin/slices/common/utils/format.ts` is a different module and gets nothing: note it for the PR
- [ ] T044 [P] [US1] Write `app/slices/profile/domain/stats.types.ts`, `app/slices/profile/domain/stats.gateway.ts`, `app/slices/profile/data/stats.gateway.ts` and `stats.mapper.ts`: `getMine(period, timeZone)` over the generated `getMyStats`, checking `res.error` (the client does not throw), dates mapped once (depends on T041)
- [ ] T045 [US1] Write `app/slices/profile/stores/profileStats.ts` as contracts/ui.md describes (`views`, `load`, `viewFor`, `statusFor`, `resetForAccount`, `STALE_MS = 60_000` with its reason) and call its reset from the place the other data stores are reset on an account change (`grep -rn "resetForAccount(" app/slices`) (depends on T036, T044)
- [ ] T046 [P] [US1] Write `app/slices/profile/assets/stats.css` with the colour properties of the prototype's `:root` (categorical, status, sequential), scoped to `[data-profile-stats]`, and the block classes that are not expressible as utilities (calendar grid, orbit, entrance animation under `prefers-reduced-motion: no-preference` only); load it from `app/slices/profile/nuxt.config.ts`
- [ ] T047 [P] [US1] Add to `app/slices/profile/i18n/locales/en.json` the keys under `stats.` for: tabs, periods, the "only you" line, scoreboard labels with plurals (`conversation | conversations`, `agent | agents`), the four comparison texts, activity (title, caption, "most often", "days with conversations", less/more, table headers, tooltip lines), agents (title, caption, messages, the orbit's label), the empty card, loading and failure with Retry, the "counted since" note, and the fourth tile's "not counted yet". Run `bun run i18n:sync` from the root and review the Russian against the prototype's wording
- [ ] T048 [P] [US1] Write the shared pieces in `app/slices/profile/components/profile/stats/`: `Card.vue` (title, caption, action slot, note line), `Segmented.vue` (button group with `aria-pressed`; `role="tablist"` variant for the tabs), `Tip.vue` (on `reka-ui`'s tooltip: opens on hover and on focus), `TableToggle.vue`
- [ ] T049 [P] [US1] Write `app/slices/profile/components/profile/stats/Board.vue`: four tiles from `board`, values through `useFormat()`, comparison from `delta.ts`, the fourth tile a dash with "not counted yet" while `summaries` is absent; two by two under 700 px (depends on T042, T047, T048)
- [ ] T050 [P] [US1] Write `app/slices/profile/components/profile/stats/Calendar.vue` and `Activity.vue`: the grid from `calendarGrid.ts`, cells focusable when they have conversations, `Tip` with the date and count, an `aria-label` that says the data is in the table view; the weekday bars with the busiest named in text; the legend; the table view listing the period's days (depends on T042, T047, T048)
- [ ] T051 [P] [US1] Write `app/slices/profile/components/profile/stats/Orbit.vue` and `Agents.vue`: nodes as buttons with labels from `orbitLayout.ts`, the list with initials through `agentInitials`, model, relative time through `useRelativeTime()`, a meter; one shared selection that resets to the first agent when the period changes (depends on T042, T047, T048)
- [ ] T052 [P] [US1] Write `app/slices/profile/components/profile/stats/Empty.vue`: the one card for a person with no conversations in the period or the one before, with the link to `/agents` (depends on T047, T048)
- [ ] T053 [US1] Write `app/slices/profile/components/profile/stats/Provider.vue`: takes `scope` and `period`, loads through the store, chooses between placeholders, the dimmed held view, the failure card with Retry, `Empty` and the blocks in the order of contracts/ui.md; sends `timeZone()` from `useFormat()` (depends on T045, T049, T050, T051, T052)
- [ ] T054 [US1] Change `app/slices/profile/pages/profile.vue`: the bar with the tabs and the period group, the "only you" line, `ProfileStatsProvider` on Statistics and the three existing cards on Account, the view read and written through `statsView.ts` (a correction is a `replace`, a choice is a `push`). The pass column and `useHead` stay as they are (depends on T053)
- [ ] T055 [US1] Checkpoint: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/stats src/slices/chat src/slices/mcp/toolReach.spec.ts && bun run build`; `cd app && bun test slices/profile slices/common && npx nuxt typecheck` (restore regenerated SDK files beyond this feature's hunks); from the root `bun run locale:check && bun run i18n:check`
- [ ] T056 [US1] Browser check as a User and as the Owner at 390 px and 1440 px, English and Russian: quickstart section 2 items 2 to 5 and 8; compare the scoreboard, activity and agents blocks with the prototype; the Account tab against a screenshot of `main`. List differences other than the departures in contracts/ui.md, fix or record them, and put the one-line result on CLEAN-258

**Checkpoint**: a person sees their conversations, messages, agents and activity for three periods; the Account tab is unchanged.

---

## Phase 5: User Story 5 — how agents helped, and who answers (P3) · PR 2

**Goal**: the three help tiles and the model card.

**Independent Test**: quickstart section 2, item 6.

### Tests for User Story 5

- [ ] T057 [P] [US5] Write `api/src/slices/stats/domain/modelAttribution.spec.ts`: one model on a day gets all that day's messages; two models split by their calls and the parts add up to the whole number of messages (largest remainder); a day with no usage row goes to the agent's current model and sets `fallback`; an agent with no current model and no usage contributes to `unknown`; the result is ordered by messages. Extend `api/src/slices/stats/domain/personalStats.service.spec.ts` with help: cited conversations out of the period's total, the two most cited sources with the web as `web`, hand-overs with `answered` and the top peer, ratings up and down by `authorId` = `sub` for the Owner too. Must fail before T059

### Implementation for User Story 5

- [ ] T058 [P] [US5] Add the read methods and their indexes in the owning slices: `countFeedbackByAuthor(authorId, from, to, agentScope)` in `api/src/slices/chat/domain/chat.gateway.ts` and `data/chat.gateway.ts` with `@@index([authorId, createdAt])` and `@@index([createdAt])` on `ChatFeedback` in `api/src/slices/chat/chat.prisma`; `citedForClient(clientId, from, to, agentScope)` in `api/src/slices/chat/domain/chatSource.service.ts` with `@@index([clientId, createdAt])` in `api/src/slices/chat/chatMessageSource.prisma`; `countForClient(clientId, from, to, agentScope)` in `api/src/slices/agent/peer/domain/delegation.gateway.ts` and `data/delegation.gateway.ts` (cases in `data/delegation.gateway.spec.ts`) with `@@index([clientId, startedAt])` in `api/src/slices/agent/peer/delegation.prisma`; `findRange(from, to)` in `api/src/slices/usage/domain/usage.gateway.ts` and `data/usage.gateway.ts`
- [ ] T059 [US5] Write `api/src/slices/stats/domain/modelAttribution.ts` (pure) and the figure definitions `ratings.ts`, `citations.ts`, `handovers.ts` in `api/src/slices/stats/domain/figures/` (`firstRecord`: the earliest row of each source); add `help` and `models` to `PersonalStatsService` and to `api/src/slices/stats/dtos/myStats.dto.ts`; regenerate as in T041 (depends on T057, T058)
- [ ] T060 [P] [US5] Write `app/slices/profile/utils/stackSegments.test.ts` (widths add up, a zero part is left out, a part under the label threshold has no label, one part fills the bar) and then `stackSegments.ts`
- [ ] T061 [P] [US5] Add to `app/slices/profile/i18n/locales/en.json` the keys for the three tiles with their zero sentences, the model card (title, caption, "most often answered by", the fallback line) and run `bun run i18n:sync`
- [ ] T062 [US5] Write `app/slices/profile/components/profile/stats/StackBar.vue` (tall and thin; segments focusable with `Tip`; an `aria-label` that reads the values), `Help.vue` and `Models.vue`; map the new fields in `app/slices/profile/data/stats.mapper.ts`; place both blocks in `Provider.vue` (depends on T059, T060, T061)
- [ ] T063 [P] [US5] Write `specs/038-profile-stats-dashboard/e2e/seed-volume.mjs`: `--conversations <n>` index rows with a year of `ChatActivityHour` rows across 40 agents and 20 000 identities, one `--heavy-user` with 5 000 conversations, inserted in batches; `--clean`; refuses a database whose name lacks `e2e`
- [ ] T064 [US5] Checkpoint and acceptance of PR 2: the commands of T055 plus `src/slices/usage src/slices/agent/peer`; quickstart section 2 in full (items 1, 6, 7, 9, 10 added to what T056 covered), section 5 for `GET /me/stats` at 10 000 and at 1 000 000 conversations with the medians written down, and section 7 (the trial figure on a scratch branch, its diff quoted). Browser check of the two new blocks at both widths in both languages. Write the outcomes under *What was run*
- [ ] T065 [US5] Ship PR 2: whole suites once (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest`, `cd app && bun test slices`), `bun run locale:check && bun run i18n:check && bun run test:scripts`; bump the root `package.json` version; commit with CLEAN-258; open the PR into `main` with the twin statement (app only; `common` touched in app, admin's format module needs nothing; SDK regenerated in both) and the timing numbers; PR on the ticket, In Testing; merge when green as the DREAM account, watch `Release Platform` to its tag, check the tag, move CLEAN-258 to Done naming the tag

**Checkpoint**: PR 2 is released. The page exists for everyone, without the summary blocks.

---

## Phase 6: User Story 3 — what I ask about and how it ends (P2) · PR 3

**Goal**: summaries carry a main question, a three-state outcome and stable topics; the page shows topics, outcomes and open questions, or one honest card when summaries are off.

**Independent Test**: quickstart sections 3 and 6.

- [ ] T066 [US3] Create the Jira ticket for PR 3, `[API][APP] Conversation summaries v2: main question, outcome, stable topics, and their blocks in the profile statistics` (labels `app`; linked to CLEAN-258), In Progress, branch `feat/CLEAN-<n>-chat-summary-v2` from `origin/main`

### Tests for User Story 3

- [ ] T067 [P] [US3] Write `api/src/slices/chat/domain/chatInsight.prompt.spec.ts`: the prompt lists the given vocabulary by key and English label, at most 60, and asks for `question`, `outcome` and `topics` as contracts/summary-judgments.md states; the parser accepts fenced and bare JSON; `outcome` missing, misspelt or a boolean becomes `unknown`; `question` is trimmed, cut at 120 characters, and null when empty; topics keep only `clear` fits, at most two, and only keys that were offered; a proposal is kept only when no existing topic was `clear`, with a slug of lower-case letters and dashes and a label of 1 to 3 words per console language; the version 1 fields (`summary`, `sentiment`, `language`) parse as before. Must fail before T072
- [ ] T068 [P] [US3] Extend `api/src/slices/chat/domain/chatInsight.service.spec.ts`: an archived conversation is summarised once; a version 1 summary active in the last 180 days is eligible again, an older one is not; the vocabulary is read again for every conversation of a batch, so a topic coined by the first is offered to the second; a merged topic is not offered; a proposed key that already exists is reused, not duplicated; `insights` (Json) is still written with English labels; `isEnabled()` is true only with the interval set and an active Anthropic credential. Extend `api/src/slices/chat/data/chat.gateway.spec.ts`: `findEligibleForInsight` with the new conditions; `saveInsights` writes `outcome`, `question`, `topicIds`, `insightVersion = 2`. Must fail before T073
- [ ] T069 [P] [US3] Extend `api/src/slices/stats/domain/personalStats.service.spec.ts`: `summaries` (enabled, summarised, waiting, tooShort: under three messages from the person); `board.resolved`; up to eight topics by count following `mergedIntoId` once, labels by the requested language falling back to `en`; up to four distinct questions per topic, newest first; `outcome` parts add up to the period's conversations; `unknown` is in neither resolved nor open questions; open questions newest first, four, with `more`; with summaries disabled the four parts are empty and `summaries.enabled` is false. Extend `api/src/slices/chat/chat.tool.spec.ts` for `list_chat_topics` and `merge_chat_topics` (metadata; refused for a User behind the Ranch admin agent; `confirm` on the merge; merging a topic into itself or into a merged one is refused). Must fail before T074 and T075

### Schema for User Story 3

- [ ] T070 [P] [US3] Write `api/src/slices/chat/chatTopic.prisma` (`ChatTopic` as in data-model.md) and add `outcome`, `question`, `topicIds`, `insightVersion` to `ChatSession` in `api/src/slices/chat/chat.prisma`
- [ ] T071 [US3] Create `api/prisma/migrations/<timestamp>_chat_summary_v2/migration.sql`: the table, the four columns, and by hand `UPDATE "ChatSession" SET "insightVersion" = 1, "outcome" = CASE WHEN "insights"->>'resolved' = 'true' THEN 'resolved' ELSE 'open' END WHERE "summaryAt" IS NOT NULL` (depends on T070)

### API for User Story 3

- [ ] T072 [US3] Move `buildInsightPrompt` and `parseInsights` from `api/src/slices/chat/domain/chatInsight.service.ts` into `api/src/slices/chat/domain/chatInsight.prompt.ts` and write version 2 there: `INSIGHT_VERSION = 2`, `VOCABULARY_CAP = 60`, `QUESTION_MAX = 120`, `TOPIC_LABEL_LANGUAGES = ['en', 'ru']` with a comment that it must match the app console's locales, each constant with its reason (depends on T067)
- [ ] T073 [US3] Write `api/src/slices/chat/domain/chatTopic.gateway.ts` and `data/chatTopic.gateway.ts` (`vocabulary(cap)` most used first and unmerged, `findOrCreateByKey`, `merge(from, into)`, `findByIds` following `mergedIntoId` once, `listWithCounts`); in `api/src/slices/chat/domain/chatInsight.service.ts` read the vocabulary per conversation, create a proposed topic, keep writing `insights`, add `isEnabled()`; in `data/chat.gateway.ts` change `findEligibleForInsight` (archived allowed; `insightVersion < 2` within 180 days) and `saveInsights`; extend `IChatInsights` and `IChatSessionData` in `api/src/slices/chat/domain/chat.types.ts`; register in `api/src/slices/chat/chat.module.ts` (depends on T068, T071, T072)
- [ ] T074 [US3] Add `outcome`, `question` and `topics` (labels) to `api/src/slices/chat/dtos/chatSession.dto.ts` and to the results of `api/src/slices/chat/chat.tool.ts`; add `list_chat_topics` and `merge_chat_topics` there as contracts/api.md states (depends on T069, T073)
- [ ] T075 [US3] Add to `chat`'s read surface `findOutcomesForSessions(ids)` (outcome, question, topicIds, sentiment and language from `insights`, `userMessageCount`, `summaryAt`); write the figure definitions `outcomes.ts` and `topics.ts` in `api/src/slices/stats/domain/figures/`; add `summaries`, `board.resolved`, `topics`, `outcome`, `openQuestions` and the per-agent `resolved` / `summarised` to `PersonalStatsService` and `api/src/slices/stats/dtos/myStats.dto.ts`, the topic label chosen by `Accept-Language`; regenerate as in T041 (depends on T069, T074)

### Calibration (constitution Principle VII)

- [ ] T076 [P] [US3] Write `api/scripts/summary-calibration.ts`: reads `--sample <dir>` (one transcript file per conversation and `labels.csv` with `chatId, subject, outcome`), runs the version 2 prompt over the sample in file order with a vocabulary that starts empty and grows as the batch's would, using the credential the batch picks from the local database, and prints the eight numbers of contracts/summary-judgments.md plus the prompt version. Writes nothing to the database and nothing into the repo
- [ ] T077 [US3] `T-CAL`: export 100 summarised conversations from our own installation through the read-only account of `.env.project` into a directory outside the repo; ask the product owner to label each with a subject and with resolved, open or cannot tell; run T076. Under 90% same-subject agreement or 80% precision of `open`, revise the prompt in T072 and rerun. Write the date, the sample size, the eight numbers, the prompt version and any changed target with its reason into the Results section of `specs/038-profile-stats-dashboard/contracts/summary-judgments.md`. **PR 3 does not merge before this section has a result** (depends on T072, T076)

### App for User Story 3

- [ ] T078 [P] [US3] Add to `app/slices/profile/i18n/locales/en.json`: topics (title, the coverage caption, resolved / left open legend, the per-topic meta line, the waiting line, the too-short line, "all counted"), outcomes (title, resolved, open, unclear, no summary, the four tone labels), open questions (title, caption, Continue with its tooltip, "N more", none), the summaries-off card in its User and operator wording, the scoreboard's resolved tile with its coverage. Run `bun run i18n:sync`
- [ ] T079 [P] [US3] Write `app/slices/profile/components/profile/stats/Topics.vue`: rows as buttons with the count and a resolved/open pixel bar scaled to the largest topic, the selected topic's questions with agent, relative time and a resolved or open pill that differs in label and not only in colour; selection resets with the period (depends on T078)
- [ ] T080 [P] [US3] Write `app/slices/profile/components/profile/stats/Outcome.vue`: the tall bar with resolved, open, unclear (only above zero) and no summary through `StackBar.vue`, the legend with counts, the four tone counts, the language chips with names through `useFormat().languageName` (depends on T078)
- [ ] T081 [P] [US3] Write `app/slices/profile/components/profile/stats/OpenQuestions.vue` (rows with initials, question, agent, topic, relative time, and Continue as a link built with `panelLocation` from `#agent/utils/panelView` for that conversation) and `SummariesOff.vue` (the one card, text by role) (depends on T078)
- [ ] T082 [US3] Map the new fields in `app/slices/profile/data/stats.mapper.ts` and `domain/stats.types.ts`; in `Provider.vue` place blocks 4 to 6 or `SummariesOff` by `summaries.enabled`, give `Models.vue` the full row when they are off, and remove the "fields absent" condition of PR 2; in `Board.vue` show the resolved share with its coverage or the dash with "summaries are not produced" (depends on T075, T079, T080, T081)
- [ ] T083 [US3] Checkpoint: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/chat src/slices/stats && bun run build`; `cd app && bun test slices/profile && npx nuxt typecheck`; from the root `bun run locale:check && bun run i18n:check`
- [ ] T084 [US3] Run quickstart section 3, items 1 to 8, on the local stack with `CHAT_INSIGHT_INTERVAL_SEC=60`, then with it unset; browser check as a User and as the Owner at both widths in both languages against the prototype's three blocks and its "summaries off" state. Write the outcomes under *What was run* and the one-line result on the ticket
- [ ] T085 [US3] Ship PR 3 as in T065, with the ticket of T066: whole suites once, version bump, commit, PR with the twin statement (app only; admin's chat pages still read `insights` and get additive SDK fields they do not use, checked by grep of `insights` in `admin/slices/chat`) and the calibration numbers, ticket In Testing, merge when green, watch the release to its tag, ticket Done. After the release, read the API log of production for one `insight batch` line to confirm version 2 summaries are being written

**Checkpoint**: PR 3 is released. Topics, outcomes and open questions appear as version 2 summaries are produced.

---

## Phase 7: User Story 4 — the installation, for those who run it (P2) · PR 4

**Goal**: the scope switch and the installation view for owners and administrators.

**Independent Test**: quickstart section 4, and section 5 for the installation route.

- [ ] T086 [US4] Create the Jira ticket for PR 4, `[APP] Profile statistics: the installation view for owners and administrators` (label `app`; linked to CLEAN-258), In Progress, branch `feat/CLEAN-<n>-stats-installation` from `origin/main`. It may be started beside Phase 5 or 6; it merges after PR 3

### Tests for User Story 4

- [ ] T087 [P] [US4] Write `api/src/slices/stats/domain/installationStats.service.spec.ts` against fake gateways: UTC ranges; every figure, totals included, covers only reached agents, for an unlimited caller and for one limited to two; tokens, calls and cost equal `rollUpAcrossAgents` and `costUsd` over the same rows; a model outside the price list is in `unpriced`, its agent has `cost: null`, and the total excludes it; a deleted agent is listed with its stored name and `removed: true` for an unlimited caller and absent for a limited one; people counts distinct identities that wrote, without `internal` and `peer:`; channels map `bridle` to `console`, a `share-` identity to `share`, the rest by name, anything else to `other`; quality per agent with open among summarised and down among rated; incidents opened in the range or still open, newest first; refusals above zero only; `projection30d`; no field holds an identity, a name of a person or a question. Must fail before T090
- [ ] T088 [P] [US4] Write `api/src/slices/stats/installationStats.controller.spec.ts` (401; 403 for a User; an Admin and the Owner answered; bad `period` 400) and extend `api/src/slices/stats/stats.tool.spec.ts` for `get_installation_stats` (metadata; refused as the Ranch admin agent answering a User; reach from the party). Turn its entry in `api/src/slices/mcp/toolReach.spec.ts` from pending to real. Must fail before T091
- [ ] T089 [P] [US4] Write `app/slices/profile/utils/axisScale.test.ts` (top value and steps for maxima of 0, 7, 950, 12 000, 4 300 000; never more than six steps; a flat series) and then `axisScale.ts`

### API for User Story 4

- [ ] T090 [US4] Add the read methods in the owning slices: in `api/src/slices/chat/domain/chatActivity.gateway.ts` and its data twin `summaryForAgents(agentScope, from, to)` returning per agent the distinct conversations, per channel the distinct conversations, and the distinct identities, with `internal` and `peer:` left out in the query; in `chat.gateway` `outcomesByAgent(sessionIdsOrRange, agentScope)` and `feedbackByAgent(from, to, agentScope)`; in `api/src/slices/agent/event/domain/agentEvent.gateway.ts` and `data/agentEvent.gateway.ts` `findIncidentsInRange(from, to, agentScope)`; `findDays` of T023 and `findRange` of T058 are reused. Write the figure definition `incidents.ts`. Then write `api/src/slices/stats/domain/installationStats.service.ts` for contracts/api.md (depends on T087)
- [ ] T091 [US4] Write `api/src/slices/stats/dtos/installationStats.dto.ts`, `api/src/slices/stats/installationStats.controller.ts` (`@Controller('stats/installation')`, `JwtAuthGuard`, `RolesGuard`, `@Roles(Owner, Admin)`, reach from `accessCallerOf(req)`, `operationId: 'getInstallationStats'`), the route in the guard inventory spec, `get_installation_stats` in `api/src/slices/stats/stats.tool.ts`, and one sentence in the description of `get_usage_overview` in `api/src/slices/usage/usage.tool.ts` pointing to it for other periods; regenerate as in T041 (depends on T088, T090)

### App for User Story 4

- [ ] T092 [P] [US4] Add to `app/slices/profile/i18n/locales/en.json`: the scope switch, the three scope lines (only you; the Owner's shared channel; the owner and administrators, with the limited variant and its agent count), the UTC-days line, the installation scoreboard (tokens in and out, model calls, estimated cost, `person | people` in conversations), spend by day (title, caption, table headers, the today-is-provisional line), agents by cost (title, "no price", the projection sentence, the price-list disclaimer), health (open, closed, none, refusals title, the hint, none), quality (title, column headers), channels (title and the five channel names). Run `bun run i18n:sync`
- [ ] T093 [P] [US4] Extend `app/slices/profile/domain/stats.types.ts`, `stats.gateway.ts`, `data/stats.gateway.ts`, `stats.mapper.ts` with `getInstallation(period)` over the generated `getInstallationStats`, and `app/slices/profile/stores/profileStats.ts` with the `installation` scope (cases in `profileStats.test.ts`: a 403 leaves no view and sets the status) (depends on T091)
- [ ] T094 [P] [US4] Write `app/slices/profile/components/profile/stats/InstallationBoard.vue` (tokens through `compact`, calls, cost with "≈", people; comparisons) and `Channels.vue` (the thin bar and legend) (depends on T092)
- [ ] T095 [P] [US4] Write `app/slices/profile/components/profile/stats/Daily.vue`: stacked columns as inline SVG from `axisScale.ts`, a focusable hit area per day with `Tip` listing models and estimated cost, date labels through `useFormat()`, the legend with a dashed "no price" mark, the table view (depends on T089, T092)
- [ ] T096 [P] [US4] Write `app/slices/profile/components/profile/stats/AgentsByCost.vue` (ranked rows with model, bar, cost and share, or the "no price" mark with tokens; a removed agent marked in words; the projection and the disclaimer), `Health.vue` (incidents with a state mark that has an icon and a word, reason as received, relative time, duration; refusals per agent) and `Quality.vue` (the table with the worst value of each column highlighted and named for screen readers) (depends on T092)
- [ ] T097 [US4] In `app/slices/profile/pages/profile.vue` show the scope switch and its line for an Owner or Admin, bound through `statsView.ts`; in `Provider.vue` render the six installation blocks for `scope = installation` with the UTC-days line and the limited-reach line from `reach` (depends on T093, T094, T095, T096)
- [ ] T098 [US4] Checkpoint: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/stats src/slices/chat src/slices/agent/event src/slices/agent/limit src/slices/usage src/slices/mcp/toolReach.spec.ts && bun run build`; `cd app && bun test slices/profile && npx nuxt typecheck`; from the root `bun run locale:check && bun run i18n:check`
- [ ] T099 [US4] Run quickstart section 4, items 1 to 7, and section 5 for `GET /stats/installation` at 10 000 and 1 000 000 conversations. If it misses SC-002, build the per-agent per-day table named in research R9 behind `summaryForAgents`, with its own spec, and measure again. Browser check as the Owner, the limited Admin and a User at both widths in both languages against the prototype's installation view. Write the outcomes and the medians under *What was run*
- [ ] T100 [US4] Ship PR 4 as in T065, with the ticket of T086: whole suites once, version bump, commit, PR with the twin statement and the timing numbers, ticket In Testing, merge when green after PR 3, watch the release to its tag, ticket Done

**Checkpoint**: all five stories are released.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T101 On production, one week after PR 1's release: as the read-only account, read `GET /me/stats?period=7` and compare `board.messages` with the growth of that account's lifetime totals over the same week; read the API log for `chat.activity` reports. Write the result on the ticket of T002; a difference is a defect ticket, not a note
- [ ] T102 [P] Set **Status** in `specs/038-profile-stats-dashboard/spec.md` to Implemented with the four release tags, and bring `docs/statistics.md` up to what was built (figures added in PRs 2 to 4, the step of research R9 if T099 took it)
- [ ] T103 [P] Tell the fork: after the fourth release, note on CLEAN-258 that the Mazda fork receives the feature with its next `chore/catch-up-upstream-N` merge, that no environment variable is needed, and that its CI is dormant so the gates of T030, T065, T085 and T100 are run locally there
- [ ] T104 Sweep: every ticket of this feature (CLEAN-258 and the three of T002, T066, T086) is Done with its release tag in a comment; none is left in In Testing

---

## What was run

*Filled as the phases complete: per quickstart item, the outcome; the timing medians; the calibration numbers by reference to contracts/summary-judgments.md.*

### Phases 1 to 3 (PR 1, CLEAN-261), 2026-11-27

- **T001 baseline**, before any change: `npx jest src/slices/chat src/slices/usage src/slices/agent/limit` 17 suites, 280 tests, green; `bun test slices/profile slices/common` 48 tests, green; `bun run build` green.
- **T002**: ticket CLEAN-261, branch `feat/CLEAN-261-stats-collection`.
- **T004 as built**: `seed-history.mjs` writes the transcripts and, with `--check`, compares `ChatActivityHour` hour by hour with what it wrote. The ratings, citations and the hand-over, and the expected `GET /me/stats` figures, are added to it in Phase 5, where the route that returns them exists.
- **T019 migration**: produced with `prisma migrate diff` from the schema before the change to the schema after it, plus the one hand-written `UPDATE` for `Usage.agentName`. Applied by `prisma migrate deploy` to a new scratch database after the 30-odd migrations before it; `prisma migrate diff --from-url … --exit-code` then reports no difference.
- **T026**: the area passed to `captureBackgroundError` is a free-text tag (`sentry.client.ts`), not a list in `sentry.rules.ts`. Nothing was changed in the three copies of the rules.
- **Found while writing `replay.mjs`**: the runtime reports each message once, with a random id, and drops the report while its socket is down; the hub's dedup is a watermark on the last event, so it refuses an immediate repeat and nothing else. SC-004, the assumptions of the spec and contracts/collection.md section 2 were reworded to claim exactly that. The loss, not the duplicate, is the real failure, and the settle pass is its repair.

- **T028 gates**: `npx eslint --quiet` on the 55 touched API files, clean; `bun run build`, green; whole API suite once, 243 suites and 4083 tests, green; `bun run locale:check` and `bun run i18n:check`, no findings; `bun run test:scripts`, 113 of 113 on the second and third run (the first, cold, run of the session took 18 s instead of half a second and failed 2 that have nothing to do with this change and did not fail again).
- **T029, quickstart section 1**, on a scratch database (`ranch-e2e-258`), the local MinIO and the built API on a side port with the settle pass every 20 s:
  - *1. Counted once*: `replay.mjs`, `--twice` and `--concurrent`, 14 of 14 each. Hours equal the lifetime totals in all three.
  - *2. Settle pass*: `seed-history.mjs --days 120` wrote 120 conversations and 776 messages as files only. Before the pass `--check` failed for every one; after it, 120 of 120 match hour by hour (264 hours).
  - *3. Never lowers*: one conversation's transcript replaced with a compacted one (a summary marker and the last answer), its `activityRebuiltAt` cleared. Settled again; hours and totals unchanged.
  - *4. History on upgrade*: `TRUNCATE "ChatActivityHour"` and every `activityRebuiltAt` cleared. Refilled to match for 119 of 120; the one left is the conversation a probe had written to minutes before, which is not quiet for an hour yet and is rightly not picked. A second full pass over the same data left the table's checksum unchanged.
  - *5. Recording cannot hurt*: by spec only (`chat.gateway.spec.ts`: the hour write throws, the lifetime increment rolls back, the error reaches the caller that logs it). The timing of 50 messages on the branch and on `main` was not measured: the scripted runtime of spec 035 does not report activity, so there is no message path to time locally. It is part of T101.
  - *6. Refusals by day*: the compiled gateway against the scratch database, two flushes with a batch across midnight UTC: day rows equal the sums of their minutes; after deleting the day rows the rebuild wrote 2 and they were equal again; a second rebuild wrote 0. The route that produces refusals was not driven end to end.
  - *7. Spend survives*: usage reported for an agent (rows carry its name), the agent deleted: 0 agent rows, 2 usage rows, and `GET /usage/overview` shows the same tokens, calls and cost under the agent's name as before the delete.
  - *8. Completeness*: three `StatFigure` rows after the first boot; unchanged after a restart.
- **Found on the stack, fixed in this PR**:
  - *A conversation indexed by the reconcile took no live event at all.* `NOT (lastIndexedEventId = x)` is not true in SQL for a row whose watermark is NULL, which is every row the reconcile creates. Totals, preview and `lastMessageAt` stood still until the next reconcile, and such a conversation would have had no hours and would never have come due for the settle pass. The spec's fake compared with `!==` and hid it. Fixed in `incrementActivity`; the fake now compares as SQL does; proved on the scratch database (a doubled live event for a synced conversation is counted once).
  - *Bubbles are not events.* The transcript reader replays a streamed answer as several bubbles; the runtime reports one activity per stored event. The settle pass now reads with a new reader option, `bubbles: false`.
  - *A missing transcript is not an unreadable one.* The pass warned three times, reported and came back to it every hour. It is now settled as it stands.
  - *`llm_usage` had its own copy of the usage roll-up* and would have shown a deleted agent by its id while `GET /llms/:id/usage` showed its name. It imports the shared functions now.
- **Independent review of the diff before merge** (a reviewer agent given the code and not the conclusions): no critical or high finding. Fixed from it, each with specs, 233 tests in the two slices green:
  - *Finding the due conversations walked half a year of them.* "Due" was `activityRebuiltAt IS NULL OR activityRebuiltAt < lastMessageAt`, and no index answers the second half. It is one column now: a live event and a reconcile of a changed file clear the stamp, the pass sets it, the index is `(activityRebuiltAt, lastMessageAt)`. `EXPLAIN` on the scratch database shows an index scan on it.
  - *A burst could lose events.* The transaction per event had Prisma's two seconds to get a connection, where the single statement before it simply waited. It has 15 now.
  - *Hours older than the retention were created and then pruned*, again with every new message of a long conversation. The pass leaves them out.
  - *A usage report for an agent that does not exist was accepted*, since the foreign key that refused it is gone. The route answers 404 and writes nothing.
  - Re-run after the fixes on a second fresh scratch database (`ranch-e2e-258b`, which also applied the edited migration): `replay.mjs` in its three modes 14 of 14, `seed-history.mjs --check` 120 of 120 after the pass, and a live event on a settled conversation makes it due again.
- **Left as it is, from the review**: on the day this is first deployed, if the old and the new pod overlap, what the old pod flushes after the new one has rebuilt today's row is in the minutes and not in the day, so that one day's refusals can read low. Every later deploy has both pods incrementing the day. And a lifetime total can count a message twice when its live report arrives after a reconcile already read it from the file: the price of no longer dropping every live event for such a conversation; the hours are not affected.
- **Not done here**: `GET /agents/:agentId/usage` still answers 404 for a deleted agent (contracts/api.md corrected to say so). If the boot rebuild of `AgentLoadDay` fails, today's row starts from the first flush after boot and stays below the sum of its minutes; earlier days are picked up at the next boot. Noted in the code.

---

## Dependencies

```text
Phase 1 ─▶ Phase 2 ─▶ US2 (Phase 3, PR 1) ─▶ US1 (Phase 4) ─▶ US5 (Phase 5, PR 2) ─▶ US3 (Phase 6, PR 3) ─▶ Polish
                              │                                                            │
                              └──────────────▶ US4 (Phase 7, PR 4) built beside ───────────┘ merges after PR 3
```

- **Phase 2** blocks everything: T005 before T006; T007, T008, T009 before T010.
- **US2** needs Phase 2. Inside it: T016 to T018 before T019; T019 before T021, T023, T024; T020 and T021 before T022. It is released alone.
- **US1** needs US2 released (the hours must exist and `main` must hold the spec documents). Inside it: T037 before T038 and T039; T038 before T041; T041 before T044; T044 before T045; T042 and T047 and T048 before the block components; all of them before T053; T053 before T054. T040 waits for T058, which belongs to US5: the two phases share one migration because they share one PR.
- **US5** needs US1's route, store and provider. It closes PR 2.
- **US3** needs PR 2 released for the page. T077 gates T085.
- **US4** needs US2 released and US1's `period.ts` users, store and provider (PR 2) for the app half; its API half needs only US2. Its quality block reads `outcome`, so it merges after PR 3.

## Parallel opportunities

- Phase 1: T003 and T004.
- Phase 2: T005 with T007, T008, T009.
- US2: T011 to T015 (five spec files) together; then T016, T017, T018 together; after T019, T021, T023 and T024 touch three different slices; T025, T026, T027 beside them.
- US1: T032 to T036 together; then the API line (T037 → T038 → T041) beside the app's pure work (T042, T043, T046, T047, T048); after T045 the four block tasks T049 to T052 together.
- US5: T058 beside T060 and T061; T063 at any time.
- US3: T067, T068, T069 together; T070 beside them; T076 beside the API tasks; T078 first, then T079, T080, T081 together.
- US4: T087, T088, T089 together; after T091, T093 beside T094, T095, T096.

Example for US2:

```text
T011 activityBuckets.spec     ┐
T012 chat.gateway.spec        │
T013 chatActivity.service.spec├─ in parallel, all failing
T014 agentLimit.service.spec  │
T015 usage specs              ┘
T016 │ T017 │ T018  ─▶ T019 migration ─▶ T021 chat │ T023 limit │ T024 usage ─▶ T022 settle pass ─▶ T028 ─▶ T029 ─▶ T030
```

## Implementation strategy

1. **Collection first** (Phases 1 to 3, PR 1). Nothing visible changes, and it is the step with a clock on it: every day it is in production is a day of exact history. If work stops here, nothing is lost and nothing is half-shown.
2. **MVP** (Phases 4 and 5, PR 2). The page a person sees, complete without summaries. Stop and validate with quickstart section 2 before going on.
3. **Summaries** (Phase 6, PR 3). Start T077 early: the labelling is a person's work and is the only task here that waits for someone.
4. **Installation** (Phase 7, PR 4). Its API half can be built as soon as PR 1 is in; it is merged last.
5. **After** (Phase 8). The production comparison a week after PR 1 is the real acceptance of the collection.

A ticket comment after each phase says what landed and what is next.

## Notes

- Tests are written first and must fail before the task they name.
- A checkpoint runs the affected tests only; each PR's ship task runs the whole suites once.
- `app/` and `admin/` are never run through Prettier or ESLint; `api/` never through `bun run lint`.
- Commit after each task or logical group, staging explicit paths; never `git add -A` in a `slices` directory and never `.specify/feature.json`.
- Every number a reviewer would take on trust carries its reason in a comment at the place it is defined (plan.md, *Quality gate 4*).
