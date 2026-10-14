# Implementation Plan: Slack Bot Transport — One Message per Incident, the Story in Its Thread

**Branch**: `feat/CLEAN-165-slack-bot-transport` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Ticket**: [CLEAN-165](https://dreamvention.atlassian.net/browse/CLEAN-165)

**Input**: Feature specification from `/specs/021-slack-bot-transport/spec.md`; the shape was settled with the owner over three live mockups in the alerts channel ([contracts/slack-bot.md](contracts/slack-bot.md)).

## Summary

CLEAN-139 tells the team about an agent going down through a Slack incoming
webhook: one message when the incident opens, one when it closes, nothing
that ever changes. The owner wants the channel to read as one line per
incident, with the story in that line's thread and the state as a reaction.
A webhook cannot do any of that; a bot can (research F1). The plan:

1. **A second transport behind a second port.** `SlackBotNotifier` in
   `data/` calls four Web API methods with `fetch` (D1, D3). The destination
   row gets a `kind` and the bot's two fields; the secret rule of CLEAN-139 —
   stored in `AgentEventDestination`, never returned — covers the token (D2).
2. **The outbox says more, in order.** Two new kinds (`joined`, `running`)
   beside `opened` / `closed`, a per-incident sequence so a thread never
   shows "Resolved" above "Failed again", and a sixty-second throttle on
   "Failed again" with the sweep catching the root's count up (D4, D7).
3. **The incident remembers its root.** Transport, channel, `ts` and the
   bot's one reaction live on the incident; every rewrite renders from the
   row, so two replicas cannot leave a stale line (D5, D6).
4. **A number.** `AgentIncident.number`, a sequence, backfilled (D8); shown
   in Slack, the console and the incident tool.
5. **The console.** Settings → Notifications chooses the transport and
   takes the bot's two fields with its own guide; the destination tools take
   the same (D11).

The webhook keeps today's two messages, byte for byte (D12). One migration,
no new table, no new dependency.

## Technical Context

**Language/Version**: TypeScript 5. NestJS 11 in `api`; Vue 3 on Nuxt 4 in `admin`; Bun for scripts and console tests.

**Primary Dependencies**: `api` — NestJS 11, Prisma 6, `class-validator`, global `fetch` with `AbortSignal.timeout`. `admin` — Nuxt 4, Pinia 3, generated SDK (`@hey-api/openapi-ts`), shadcn. Nothing added (D1).

**Storage**: Postgres through Prisma. Changed: `AgentEventDestination`, `AgentIncident`, `AgentNotification` ([data-model.md](data-model.md)). One additive migration with two backfills (`number`, `seq`) and one value rewrite (`kind: slack → webhook`).

**Testing**: `jest` in `api` (run directly: `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`, never `bun run test` beside a running dev API); `bun test slices` in `admin`. Typecheck: `bun run build` in `api`, `npx nuxt typecheck` in `admin`. `bun run locale:check` at the root. Live proof against the owner's bot with `SLACK_BOT_OAUTH` / `SLACK_CHANNEL_ID` from `.env.project` ([quickstart.md](quickstart.md)).

**Target Platform**: the API at any replica count (every "once" is decided by a conditional database write, as in CLEAN-139); the admin console in evergreen browsers.

**Project Type**: web service + web console (monorepo `api/`, `admin/`, `app/`).

**Performance Goals**: root and reaction reflect a change within one outbox tick (5 s) plus Slack (SC-002). A flood of 60 reports a minute costs Slack at most one thread reply a minute and one root rewrite per 30 s sweep (SC-003). The claim query gains one `NOT EXISTS` on a table of tens of rows.

**Constraints**: the sender's answer never waits for Slack (unchanged); no secret in any answer, log line, tool result or stored error (the notifier scrubs the token as the webhook notifier scrubs the address); an incident finishes on the transport it started on; the webhook's output does not change.

**Scale/Scope**: tens of agents, ones to tens of incidents a day; the outbox holds a handful of rows per incident; Slack's edit window and rate limit are the outer bounds (research D10).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | Everything lands in the existing `api/src/slices/agent/event/` and `admin/slices/agent/event/`. No other slice is touched: the agent slice is read through `IAgentGateway` as today; settings navigation already has the entry. |
| II. Twin consoles | Pass | `agent` is a twin slice; its `event` sub-slice exists in `admin` only (CLEAN-139 D14). Re-verified for this plan: `grep -rl 'agentEvent\|agent-events' app/slices` → 0 files. `app` needs nothing; to be restated in the PR. |
| III. Secrets stay behind `api/` | Pass | One new secret, the bot token: entered by the owner, stored in `AgentEventDestination.botToken`, read only by `getDestination()` for `SlackBotNotifier`, never returned (D2), scrubbed from every quoted error. For the local proof it is `SLACK_BOT_OAUTH` in `.env.project`, read by a scratch script, never by a console. The channel id is not a secret. |
| IV. One entity, one store | Pass | The existing `agentEvent` store; `destination` stays what the server answered; `number` is one more field on the incident record ([data-model.md](data-model.md#console-store)). |
| V. Console is a window, chat is the hands | Pass | Every new console capability already has a tool: `set_` / `get_` / `remove_notification_destination` and `send_test_notification` take the kind (D11); `list_agent_incidents` returns `number`. No new tool; `tool-secrets.spec.ts` learns `botToken`. |
| VI. English is the source | Pass (n/a) | `admin` only, English only; times in Slack are Slack's own localisation. |
| VII. A rule stays a rule | Pass | No model call. State → emoji is a table (data-model), throttle is a timestamp compare (D7), order is a sequence (D4), errors are a lookup (D10). |

**Quality Gate 4 — numbers and their reasons**

| Number | Where | Reason |
|--------|-------|--------|
| one "Failed again" reply per 60 s per incident | D7, FR-015 | Slack allows about one post a second per channel; a crash loop reports every 10–20 s. A minute keeps a loop to a few replies and still shows it is going on. |
| root rewrite on the 30 s sweep when stale | D7 | The sweep already exists and already reads every open incident; a stale count is a cosmetic lag, 30 s is the lag a status already has. |
| 5 s per Slack call | D1 | Today's `NOTIFY_TIMEOUT_MS`; the Web API answers in well under a second. |
| reason cut to 80 characters on the root | slack-bot.md | The root is one line; the full cause is in the thread reply. |
| token ≤ 300, `^xoxb-` | D9 | Bot tokens are ~55 characters; the prefix tells a bot token from a user token, which has the wrong permissions. |
| channel id `^[CG][A-Z0-9]{8,}$` | D9 | Slack's public (`C`) and private (`G`) channel id shapes. |

**Post-design re-check**: no violation introduced by Phase 1. Complexity
Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/021-slack-bot-transport/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── slack-bot.md        # calls, messages, delivery steps, error map
│   ├── console-api.md      # DTO changes, incident number, tools
│   └── console-ui.md       # Settings page, guide, Events page
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/agent/event/
├── agentEvent.prisma                      # destination kind/botToken/channelId; incident number/transport/slack*/notificationSeq/lastJoinedNotifiedAt/rootStale; notification seq
├── agentEvent.controller.ts               # PUT destination takes the kind body (no route change)
├── agentEvent.tool.ts                     # set/get destination with kind; incident number
├── dtos/notificationDestination.dto.ts    # SaveNotificationDestinationDto (kind + fields), view gains kind/channelId
├── dtos/agentEvent.dto.ts                 # IncidentDto.number
├── domain/
│   ├── agentEvent.types.ts                # kinds, payloads, reaction names, BOT_* constants
│   ├── notifier.ts                        # + ISlackBotNotifier (post/update/setReaction)
│   ├── notificationText.ts                # + renderRoot, renderReply(kind); renderOpened/Closed untouched
│   ├── agentIncident.service.ts           # transport at open; joined throttle; running row; closed on stopped/deleted for bot
│   ├── agentNotification.worker.ts        # deliver() branches on destination.kind; sweep rewrites stale roots
│   ├── notificationDestination.service.ts # save(kind input), validate per kind, test per kind, error words
│   └── agentEvent.gateway.ts              # new abstract methods (below)
├── data/
│   ├── agentEvent.gateway.ts              # Prisma: ordered claim, conditional joined queue, slack fields, number
│   ├── agentEvent.mapper.ts               # number, slack fields, destination fields
│   ├── slackWebhook.notifier.ts           # untouched
│   └── slackBot.notifier.ts               # NEW: the four calls, error map, token scrubbing
└── *.spec.ts                              # flow (bot path, order, throttle, idempotent root), text (root/replies), notifier (error map), controller (DTO), tool
api/prisma/migrations/<ts>_slack_bot_transport/migration.sql

admin/slices/agent/event/
├── domain/agentEvent.types.ts             # kind union, channelId, number, ISaveDestination
├── data/agentEvent.mapper.ts              # same
├── stores/agentEvent.ts                   # saveDestination(input)
├── components/agentEvent/destination/
│   ├── Form.vue                           # kind choice; delegates to the kind's form
│   ├── BotForm.vue                        # NEW: token + channel id
│   ├── BotGuide.vue                       # NEW: the four steps
│   ├── SenderGuide.vue, TestButton.vue    # as today
├── components/agentEvent/IncidentList.vue # "#number"
└── pages/settings/notifications.vue       # kind choice wired
admin/slices/setup/api/data/repositories/api/  # regenerated SDK
docs/operations/agent-events.md            # a "Slack bot" section for the owner
```

**Structure Decision**: no new slice; the feature is the next step of the
`agent/event` sub-slice on both sides. The one new `data/` file is the bot
notifier; the one new port is its interface.

## Order of work

1. **Schema and migration** — the three models, the backfills, `bun run
   generate`, `migrate diff --exit-code` against a local database.
2. **Text first, with tests** — `renderRoot` for every state, the four reply
   renderers, the existing snapshots untouched (SC-004).
3. **The bot notifier** — four calls, error map, scrubbing; a spec with a
   mocked `fetch` for every row of the error table.
4. **Outbox order and kinds** — gateway: `seq`, ordered claim, conditional
   `joined` queue, `running` queue, slack fields; flow spec with the
   in-memory `FakeGateway` extended.
5. **Worker** — `deliver()` on the bot path (root once, reply, rewrite,
   reaction), the stale-root rewrite on the sweep; flow spec for idempotent
   root and side-effect failures.
6. **Destination** — DTO, validation, save/test per kind, view; controller
   and tool specs; `tool-secrets.spec.ts`.
7. **Number** — mapper, DTO, tool; incident list in the console.
8. **Console** — types, store, kind choice, bot form and guide, SDK regen;
   `bun test slices`, `npx nuxt typecheck`, `locale:check`.
9. **Live proof** — quickstart against the owner's bot and channel from
   `.env.project`; then docs and the PR.

## Open points that are not ours to close

- **Slack's edit window.** A workspace admin can limit how long a message may
  be edited; a very long incident could outlive it. The rewrite is then
  dropped with its error on the destination (D10) and the thread still tells
  the story. If this bites, the follow-up is a fresh root with a link back.
- **CLEAN-166 (code red)** pings from a thread reach only its followers
  (F2); it will post its urgent lines at channel level.

## Complexity Tracking

Empty: no principle is waived.
