# Implementation Plan: Profile statistics dashboard

**Branch**: `feat/CLEAN-258-profile-stats-dashboard` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Ticket**: [CLEAN-258](https://dreamvention.atlassian.net/browse/CLEAN-258)

**Input**: Feature specification from `/specs/038-profile-stats-dashboard/spec.md`

## Summary

The profile page gets a Statistics tab: a person's own conversations for 7,
30 or 90 days, and for an owner or administrator the installation. The
prototype in `reference/` is the visual reference. Behind it is the part that
has to last: how the numbers are gathered.

The design rests on one distinction. A fact that already exists as a durable
row with a time (a rating, a citation, a hand-over, an incident, a day of
spend) is read where it is, by an indexed range, and never copied. A fact
that nothing keeps by time is recorded: messages per conversation per hour,
and limit refusals per day. That is two new tables, not a second copy of
everything.

1. **Recording**: `session_activity` already increments a conversation's
   lifetime totals once per event. The same transaction now adds one to that
   conversation's hour. The hour inherits the existing dedup, so the two
   cannot disagree.
2. **Repair and history**: one *settle pass* reads a conversation's
   transcript after it has been quiet for an hour and raises its hours to
   what the transcript shows, never lowering. It is the upgrade backfill, the
   recovery after a restart and the way a later figure gets its past.
3. **Reading**: a new `stats` slice holds a registry of figures. Each figure
   names the public read method of the slice that owns its fact and the first
   day it is complete from. Two routes assemble a period view from it; two
   agent tools return the same.
4. **Summaries, version 2**: a main question, a three-state outcome, and
   topics chosen from a vocabulary so one subject is one label; closed
   conversations become eligible. Two model judgments, named and calibrated.
5. **The page**: components in the existing `profile` slice, inline SVG from
   pure layout functions, one Pinia store of period views, tab, period and
   scope in the address.

## Technical Context

**Language/Version**: TypeScript 5.x. API on Node 22 (NestJS 11), app console on Nuxt 4 compatibility mode (Vue 3, `ssr: false`).

**Primary Dependencies**: NestJS, Prisma 6 with `prisma-import` (one `.prisma` file per slice), class-validator, zod for tool parameters (api); Nuxt, Pinia, Tailwind 4, `reka-ui`, `@vueuse/core`, `@hey-api/openapi-ts` generated SDK, `@nuxtjs/i18n` (app). No new dependency in either.

**Storage**: PostgreSQL. New tables `ChatActivityHour`, `AgentLoadDay`, `ChatTopic`, `StatFigure`; additive columns on `ChatSession` and `Usage`; `Usage` loses its relation to `Agent`; four indexes. One migration per PR that needs one. Transcripts stay in S3 and are read only by the settle pass and the summary batch, never by a page view.

**Testing**: api: jest (`*.spec.ts`), run directly on the touched paths, the whole suite once before each PR. app: `bun test slices/profile slices/common`, `npx nuxt typecheck`. Repo: `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts`. Browser: Playwright at 390 px and 1440 px, three roles, two languages. Scripts for seeding, replay and timing in `specs/038-profile-stats-dashboard/e2e/`.

**Target Platform**: evergreen desktop and mobile browsers; the API in the cluster as one process, which is why timers are plain intervals guarded against overlap and nothing here depends on an in-memory count surviving a restart.

**Project Type**: web application: `api/` plus the `app/` console. `admin/` is read for the twin check and for FR-037 and not changed.

**Performance Goals**: figures on screen within 2 s for a person with 5 000 conversations in an installation with 1 000 000, within 20% of the time at 10 000 (SC-002). A message on the page within 5 minutes (SC-003). No measurable cost to sending a message (SC-011).

**Constraints**: a page view never reads a transcript or counts conversations (FR-024). No message text in any statistics table (FR-033). A person's figures are never reachable by anyone else, by any role (FR-020). The installation scope is filtered by reach, totals included (FR-021). Nothing new in `runtimeConfig.public`. English is the copy source.

**Scale/Scope**: one new API slice and changes in five existing ones (`chat`, `usage`, `agent/limit`, `agent/peer`, `agent/event`); about twenty components, one store and seven pure modules in one app slice; two routes, two tools, three migrations across four pull requests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|-----------|--------|
| I. The slice is the unit | API: new slice `stats` (routes, period arithmetic, figure registry, tools, `StatFigure`). Each fact stays with its owner, which adds a read method to its existing public gateway: `chat` (activity, outcomes, topics, ratings, citations), `usage` (spend), `agent/limit` (refusals by day), `agent/peer` (hand-overs), `agent/event` (incidents). `stats` reads no table but its own. App: everything in the existing `profile` slice. Two sideways imports, both of surfaces their slices export for the purpose: `#agent/utils/panelView` (`panelLocation`, as in CLEAN-248) and `useFormat()` from `common`. |
| II. Twin consoles | Affected console: **app**. `profile` exists in app only. `common` is a twin and is touched in app only: new formatters in `app/slices/common/utils/format.ts` and `useFormat()`. Admin's format module is a different file, fixed to English, and admin has no statistics page, so it needs none of them. `chat`, `agent`, `bridle`, `setup`, `share`, `user`: not touched in either console beyond the regenerated SDK under `setup`, which carries additive fields admin does not use. Re-checked by grep at implementation and stated in each PR. |
| III. Secrets stay behind `api/` | No new credential. Summaries keep using the Anthropic credential the batch already picks. The calibration reads production through the existing read-only account from `.env.project`; its export stays out of the repo. Nothing added to `runtimeConfig.public`. |
| IV. One entity, one store | One new entity in the console, the period view, kept once in `profileStats` by `scope:period`. Blocks render from it by props. The selected topic and agent are view state of a block, not entities. The store is cleared on an account change. |
| V. Console is a window, chat is the hands | The page is in the app console; the rule is written for the admin console, and FR-038 asks for the same anyway. Two read tools in the slice, `get_my_stats` (`person`) and `get_installation_stats` (`admin`), each with topic, title, template and effect, each calling the service its route calls, each in `toolReach.spec.ts`. No destructive capability, so no `confirm`. |
| VI. English is the source | All copy in `app/slices/profile/i18n/locales/en.json` under `stats.*`; `bun run i18n:sync` writes `ru`. The prototype's Russian wording is the reference for meaning, not a source file. Numbers, dates, plurals and relative times through the format module and i18n. Topic labels are data: written once per console language by the summary call, shown as received. |
| VII. A rule stays a rule | Everything on the page is arithmetic over rows, except two judgments made by the summary call: which topic, and how the conversation ended. Each has its question, its answers including "none", its threshold with what happens below it, and a calibration on 100 of our own conversations with targets: [contracts/summary-judgments.md](./contracts/summary-judgments.md). Story 3 does not merge before the calibration has a result. `sentiment` and `language`, judged by the same call since before this principle, are cited there as debt and not built on. |

**Quality gate 4, numbers a reviewer would otherwise take on trust**: one hour quiet, 100 transcripts per run, 5 minutes between runs, 180 days of backfill ([research.md](./research.md) R2); hourly rows and the half-hour-zone limit (R3); 400 days of retention (spec FR-030); 60 topics shown to the model, 120 characters of question, two topics per conversation ([contracts/summary-judgments.md](./contracts/summary-judgments.md)); 60 seconds before the store refetches ([contracts/ui.md](./contracts/ui.md)); the five calendar levels and the 14% / 16% label thresholds, taken from the prototype (same file).

**Gate result**: pass. No waiver; Complexity Tracking is empty.

**Post-design re-check (after Phase 1)**: unchanged. The design added one slice, named above, and no dependency. Three statements of the spec were made more exact by the research and are corrected in the same change: FR-024 (records by time, including event rows read in place), FR-029 (UTC days for the whole installation scope, not for spend alone), and an assumption about zones with a half-hour offset.

## Project Structure

### Documentation (this feature)

```text
specs/038-profile-stats-dashboard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md                  # two routes, two tools, changed routes
│   ├── collection.md           # recording, the settle pass, the figure registry
│   ├── summary-judgments.md    # Principle VII: topic and outcome
│   └── ui.md                   # address, blocks, states, store
├── reference/profile-stats-prototype.html
├── checklists/requirements.md
├── e2e/                        # seed-history, seed-volume, replay (written with the PRs)
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/stats/                       # NEW slice
├── stats.module.ts
├── stats.prisma                            # StatFigure
├── myStats.controller.ts (+ .spec.ts)      # GET /me/stats
├── installationStats.controller.ts (+ .spec.ts)   # GET /stats/installation
├── stats.tool.ts (+ .spec.ts)              # get_my_stats, get_installation_stats
├── dtos/                                   # query + response DTOs
├── domain/
│   ├── period.ts (+ .spec.ts)              # periods, local days from hour rows, zone validation
│   ├── modelAttribution.ts (+ .spec.ts)    # messages × the day's models
│   ├── figure.types.ts, figureRegistry.ts  # definition shape, boot-time StatFigure rows, notes
│   ├── figures/*.ts                        # one file per figure
│   ├── personalStats.service.ts (+ .spec.ts)
│   ├── installationStats.service.ts (+ .spec.ts)
│   └── statFigure.gateway.ts
└── data/statFigure.gateway.ts, statFigure.mapper.ts

api/src/slices/chat/
├── chatActivity.prisma                     # NEW ChatActivityHour
├── chatTopic.prisma                        # NEW ChatTopic
├── chat.prisma                             # ChatSession: outcome, question, topicIds, insightVersion, activityRebuiltAt, index; ChatFeedback indexes
├── chatMessageSource.prisma                # index (clientId, createdAt)
├── data/chat.gateway.ts                    # recordActivity writes the hour in the same transaction; read methods
├── data/chatActivity.gateway.ts            # NEW: raise, prune, reads by person and by agent
├── data/chatTopic.gateway.ts               # NEW
├── domain/chatActivity.service.ts (+ .spec.ts)    # NEW: the settle pass and the daily prune
├── domain/activityBuckets.ts (+ .spec.ts)  # NEW: transcript messages → hours (pure)
├── domain/chatInsight.service.ts           # prompt v2, parse, vocabulary, archived eligible, version
├── domain/chatInsight.prompt.ts (+ .spec.ts)      # NEW: prompt and parser moved out, pure
├── domain/chat.gateway.ts, chat.types.ts   # new abstract methods and types
├── dtos/chatSession.dto.ts                 # + outcome, question, topics
├── chat.tool.ts                            # result carries the new fields
└── chat.module.ts                          # exports the read surface

api/src/slices/usage/
├── usage.prisma                            # relation removed, agentName added
├── data/usage.gateway.ts, usage.mapper.ts  # name written on report
├── domain/model-pricing.ts                 # + hasPrice
├── domain/usage-rollup.ts                  # names from the row first
└── usage.tool.ts                           # one sentence in the description

api/src/slices/agent/limit/
├── agentLimit.prisma                       # NEW AgentLoadDay
├── data/agentLimit.gateway.ts              # day incremented with the minute; rebuild; prune; read by range
└── domain/agentLimit.service.ts            # boot rebuild, prune both

api/src/slices/agent/peer/
├── delegation.prisma                       # index (clientId, startedAt)
└── domain/delegation.gateway.ts, data/…    # counts for one person in a range

api/src/slices/agent/event/
└── domain/agentEvent.gateway.ts, data/…    # incidents opened in a range or still open

api/src/slices/user/auth/guards/agentRoutes.spec.ts   # the two routes in the inventory
api/src/slices/mcp/toolReach.spec.ts                  # the two tools
api/src/app.module.ts                                 # StatsModule
api/prisma/migrations/<ts>_stats_collection/          # PR 1
api/prisma/migrations/<ts>_stats_read_indexes/        # PR 2
api/prisma/migrations/<ts>_chat_summary_v2/           # PR 3
api/scripts/summary-calibration.ts                    # PR 3, T-CAL
api/swagger-spec.json                                 # regenerated

app/slices/setup/api/data/repositories/api/*.gen.ts   # regenerated
admin/slices/setup/api/...                            # regenerated where the spec diff reaches it

app/slices/profile/
├── pages/profile.vue                       # the bar, the scope line, the two tabs
├── components/profile/stats/
│   ├── Provider.vue                        # loads the view, picks blocks and states
│   ├── Board.vue  Activity.vue  Calendar.vue  Agents.vue  Orbit.vue
│   ├── Topics.vue  Outcome.vue  OpenQuestions.vue  SummariesOff.vue
│   ├── Help.vue  Models.vue  Empty.vue
│   ├── InstallationBoard.vue  Daily.vue  AgentsByCost.vue
│   ├── Health.vue  Quality.vue  Channels.vue
│   └── Card.vue  Segmented.vue  StackBar.vue  Tip.vue  TableToggle.vue
├── stores/profileStats.ts (+ .test.ts)
├── domain/stats.gateway.ts, stats.types.ts
├── data/stats.gateway.ts, stats.mapper.ts
├── utils/statsView.ts  calendarGrid.ts  intensity.ts  delta.ts
│        orbitLayout.ts  stackSegments.ts  axisScale.ts   (each + .test.ts)
├── assets/stats.css                        # chart colour tokens
└── i18n/locales/en.json (+ generated ru.json)

app/slices/common/
├── utils/format.ts (+ format.test.ts)      # compact number, money, short weekday and month, time zone
└── composables/useFormat.ts

specs/038-profile-stats-dashboard/e2e/      # seed-history.mjs, seed-volume.mjs, replay.mjs
package.json                                # version bump in each PR
```

**Structure Decision**: one new API slice, `stats`, because the feature has a
subject of its own (periods, figures, their completeness) that belongs to
none of the slices whose facts it reads. In the app console no new slice: the
statistics are the profile's.

## Delivery

Four pull requests into `main`, in this order. Each is releasable alone,
bumps the root version so a release is tagged, and is merged by whoever
opened it once CI is green, with the `Release Platform` run watched to its
tag. PR 2, the page a person sees, is CLEAN-258 itself. PRs 1, 3 and 4 each
get their own `CLEAN-` ticket linked to CLEAN-258, created when the work
starts, so every ticket closes when its own PR has shipped. The documents in
this directory are committed with PR 1.

| PR | Contains | Spec | Proved by |
|----|----------|------|-----------|
| 1. Collection | `ChatActivityHour` and the live write; the settle pass and prune; `AgentLoadDay`; `Usage` outlives its agent, `agentName`, `hasPrice`; `stats` slice skeleton with the registry and `StatFigure`. No route, no UI | Story 2 | quickstart 1 |
| 2. Personal statistics | read methods and indexes; `GET /me/stats` without the summary blocks; the Statistics tab with the scoreboard, activity, agents, help and models; `get_my_stats`; formatters | Stories 1, 5 | quickstart 2, 5, 7, 8 |
| 3. Summaries v2 | prompt, parser, vocabulary, `ChatTopic`, the new `ChatSession` columns, archived eligible, re-summarising version 1; calibration; topics, outcomes and open questions in the route and on the page | Story 3 | quickstart 3, 6, 8 |
| 4. Installation view | `GET /stats/installation`; the scope switch and its six blocks; `get_installation_stats` | Story 4 | quickstart 4, 5, 8 |

Collection goes first and alone: from the day it is deployed the hours are
exact, so every day it runs before the page exists is a day of history the
page opens with. PR 3 needs PR 2 for the page. PR 4 can be built beside
PR 2 and PR 3 but merges after PR 3: its "where people are unhappy" block
reads the outcome column PR 3 adds.

**Between PR 2 and PR 3** the route answers without `summaries`, `topics`,
`outcome` and `openQuestions`. The page then shows the scoreboard's fourth
tile as a dash captioned "not counted yet" and leaves blocks 4 to 6 out, with
no card: the "summaries are off" card would be untrue on an installation
where they are on. PR 3 adds the fields and removes that one condition.

**Rollout notes**
- No new environment variable is required. `STATS_SETTLE_INTERVAL_SEC` and
  `STATS_SETTLE_BATCH` exist for an operator who needs to slow the pass or
  stop it; neither manifest set changes.
- The migrations are additive, apart from dropping the foreign key of
  `Usage.agentId`, which removes a constraint and no data.
- After PR 3, version 1 summaries are replaced inside the batch's existing
  cap of 25 per run, so model spend per run does not rise; it continues for
  longer. On an installation with 10 000 summarised conversations in 180 days
  that is about four days at the 900 s interval.
- The Mazda fork takes each PR with its next `chore/catch-up-upstream-N`
  merge. Nothing here is fork-specific. The fork's CI is dormant, so the
  gates are run locally there.

## Complexity Tracking

No violation to justify.
