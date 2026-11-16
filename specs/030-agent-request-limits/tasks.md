---
description: "Task list for request limits for agents (CLEAN-224)"
---

# Tasks: Request limits for agents

**Input**: design documents in `specs/030-agent-request-limits/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md, contracts/

**Tests**: required. FR-038 to FR-042 make automated tests, including browser
tests run against a live local stack, a condition of done.

**Ticket**: every commit carries `(CLEAN-224)`. Comment on the ticket at each
checkpoint below, in a few sentences.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 caps, US2 notice, US3 load view, US4 integration, US5 Ranch agent tools

## House rules that apply to every task

- Read before writing: `docs/state.md` (stores), `docs/i18n.md` (app strings),
  `docs/agent-tools.md` (tools), `specs/030-agent-request-limits/contracts/*`.
- API tests: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.
  Never `bun run test` while a dev API runs. Lint only touched files:
  `npx eslint --quiet <files>`. `bun run build` is the typecheck.
- Consoles: `bun test slices`, `npx nuxt typecheck` (not `bun run typecheck`,
  it regenerates the SDK). No Prettier or ESLint over `admin/` or `app/`;
  patch surgically.
- Generated SDK files are regenerated (`bun run build:api`), never edited. If
  the regen carries unrelated types, keep only what this feature needs.
- App strings: add to `en.json`, run `bun run i18n:sync`, never hand-write
  `ru.json` first. Dates and numbers through `useFormat()`.
- Do not touch `.specify/feature.json`.

---

## Phase 1: Setup

**Purpose**: a worktree that builds, and the skeleton of the new slice.

- [X] T001 Prepare the worktree: `bun install` at the root, `cd api && bun run generate && bun run build`, `cd admin && npx nuxt prepare`, `cd app && npx nuxt prepare`; confirm `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/bridle` is green before any change
- [X] T002 Create the sub-slice skeleton `api/src/slices/agent/limit/` with `agentLimit.module.ts`, empty `domain/`, `data/`, `dtos/` and an `index.ts`, modelled on `api/src/slices/agent/shareLink/`; register the module where `ShareLinkModule` is registered
- [X] T003 [P] Create `specs/030-agent-request-limits/e2e/` with `shots/.gitkeep` and a `lib.mjs` that re-exports the helpers of `specs/026-app-console-redesign/e2e/lib.mjs` and adds `check(ok, msg)` / exit-code handling used by every script here

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the models, the counting, and the one check in the hub. Nothing
user-visible yet; with no `AgentLimit` rows the platform behaves exactly as
before (FR-002).

### Tests first

- [X] T004 [P] Write `api/src/slices/agent/limit/domain/slidingLog.spec.ts`: count inside a window; admit under the limit; refuse at the limit; never more than L in any span of W under a burst of 10×L (SC-001); wait = `ts[used − L] + W − now`; maximum wait across several full windows and the window that set it; rebuild from per-minute counts places each count at the end of its minute and never under-counts
- [X] T005 [P] Write `api/src/slices/agent/limit/domain/agentLimit.rules.spec.ts`: whole numbers 1..1 000 000 only (`LIMIT_OUT_OF_RANGE`); `perMinute ≤ perHour ≤ perDay` where set, equal allowed (`LIMIT_WINDOWS_CONTRADICT`); all null means "off"; public + off refused (`PUBLIC_AGENT_NEEDS_LIMITS`); a request that sets neither `isPublic` nor `limits` is never refused, even for a public agent with no limits
- [X] T006 [P] Write `api/src/slices/agent/limit/domain/agentLimit.service.spec.ts` with a fake clock and a fake gateway: visitor requests are admitted and counted; the request after the limit is refused with the wait and is not counted (FR-015); `operator` and `peer` are never refused and are counted as exempt only (FR-014); an agent with no limits is never refused but its minute counts are recorded; pending counts flush every 10 s and on destroy; boot rebuilds the log from stored minutes (FR-019); changing limits keeps usage and takes effect on the next request (FR-018); removing limits drops the log
- [X] T007 [P] Extend `api/src/slices/bridle/data/bridle.gateway.spec.ts`: with a limiter that refuses, `sendToAgent` returns `{ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs, window }`, does not call the agent's `send`, does not emit `user_message`; a duplicate `clientMessageId` still returns `accepted, duplicate` without asking the limiter (FR-016); an offline agent returns `AGENT_OFFLINE` without asking the limiter (FR-017); a sender without `withAck` receives the fallback `message` line of `contracts/bridle-protocol.md` §3; `source: 'operator'` and `'peer'` are passed through and never refused

### Implementation

- [X] T008 Write `api/src/slices/agent/limit/agentLimit.prisma` with `AgentLimit` and `AgentLoadMinute` exactly as in `data-model.md`, add the back-relations to `api/src/slices/agent/agent/agent.prisma`, run `cd api && bun run generate`, and create the additive migration `api/prisma/migrations/<timestamp>_agent_limits/` (when no database is up, produce the SQL with `npx prisma migrate diff --from-schema-datamodel <before> --to-schema-datamodel prisma/schema.prisma --script`)
- [X] T009 [P] Write `api/src/slices/agent/limit/domain/agentLimit.types.ts`: `LimitWindow`, `IAgentLimits`, `RequestSource = 'visitor' | 'operator' | 'peer'`, `LimitDecision` (admitted | refused with `retryAfterMs` and `window`), `IAgentLoadSnapshot`, `IAgentLimitSummary`, and the three refusal codes
- [X] T010 [P] Implement `api/src/slices/agent/limit/domain/slidingLog.ts` as pure functions (trim, count, admit, wait, rebuild) until T004 passes
- [X] T011 [P] Implement `api/src/slices/agent/limit/domain/agentLimit.rules.ts` until T005 passes
- [X] T012 Write the abstract `api/src/slices/agent/limit/domain/agentLimit.gateway.ts` and its Prisma implementation `api/src/slices/agent/limit/data/agentLimit.gateway.ts` + `agentLimit.mapper.ts`: find all limits, find one, upsert, delete, increment minute rows (upsert with increment), read minute rows in a range, prune rows older than 30 days
- [X] T013 Implement `api/src/slices/agent/limit/domain/agentLimit.service.ts` until T006 passes: per-agent counters, `check(agentId, source)`, 10 s flush timer (`unref`), `onModuleInit` rebuild, `onModuleDestroy` flush, daily prune, a warning when `ApiInstanceService.liveCount() > 1` (research R16); export it from the slice `index.ts` as the only thing other slices use
- [X] T014 Extend `api/src/slices/bridle/domain/bridle.types.ts`: the `RATE_LIMITED` variant on `BridleSendAck` and `BridleSendResult`, `source` on `IBridleSendOptions`, the `agent_limit` event type, as in `contracts/bridle-protocol.md`
- [X] T015 Put the check into `sendToAgent` in `api/src/slices/bridle/data/bridle.gateway.ts`, after the duplicate and offline checks and before `agentSend`, with the fallback line for senders without `withAck`; inject the limiter through `api/src/slices/bridle/bridle.module.ts`; T007 passes
- [X] T016 Set `source` at the three callers: `api/src/slices/bridle/handlers/bridleClientWs.handler.ts` (operator when the socket's verified JWT has `Owner` or `Admin`; store that fact in `client.data` at handshake), `api/src/slices/bridle/bridle.controller.ts` `resolveRequester` (same rule) for both message routes and `api/src/slices/bridle/domain/bridleSync.service.ts`, and `api/src/slices/agent/peer/domain/a2a.server.service.ts` (`'peer'`); add one assertion per caller to its existing spec
- [X] T017 Run the foundational gate: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/limit src/slices/bridle src/slices/agent/peer`, `npx eslint --quiet` on touched files, `bun run build`

**Checkpoint**: counting works and is invisible. Comment on CLEAN-224.

---

## Phase 3: User Story 1 — An operator caps a public agent (P1) 🎯 MVP

**Goal**: limits can be set in "Visibility & embed", a public agent cannot be
saved without one, and the agent stops taking requests above them.

**Independent test**: 3 per minute on a public agent; the fourth message in a
minute never reaches the agent.

### Tests first

- [X] T018 [P] [US1] Write `api/src/slices/agent/limit/agentLimit.controller.spec.ts`: `GET /agents/limits`, `GET` and `PUT /agents/:id/limits` are Owner/Admin only; `GET /agents/:id/limits/enabled` answers any signed-in role with `{ enabled }` and nothing else; `PUT` with all nulls switches off; the three refusal codes come back as 400 with `code`
- [X] T019 [P] [US1] Extend `api/src/slices/agent/agent/agent.controller.spec.ts`: `PUT /agents/:id` with `isPublic: true` and no limits → `PUBLIC_AGENT_NEEDS_LIMITS`, agent stays private; with `limits` in the same body → saved together; public → private keeps limits; renaming a public agent that has no limits succeeds; `POST /agents` with `isPublic: true` needs `limits`
- [X] T020 [P] [US1] Extend `api/src/slices/user/auth/guards/publicRoutes.spec.ts` (or a sibling spec) to pin that `AgentDto`, `GET /agents/public` and the status stream payload carry no limit, usage or at-limit field (FR-051), and that the public-route counts are unchanged
- [X] T021 [P] [US1] Write `admin/slices/agent/agent/stores/agentLimit.test.ts`: summary fetch upserts by agent id; `save` patches optimistically and rolls back on a refusal, exposing the refusal `code`

### Implementation

- [X] T022 [US1] Write the DTOs in `api/src/slices/agent/limit/dtos/` (`agentLimits.dto.ts`, `setAgentLimits.dto.ts`, `agentLimitSummary.dto.ts`, `agentLimitsEnabled.dto.ts`) and add optional `limits` to `api/src/slices/agent/agent/dtos/updateAgent.dto.ts` and `createAgent.dto.ts`
- [X] T023 [US1] Add to `agentLimit.service.ts` the write path `setLimits(agentId, limits, userId)` and `applyWithAgentUpdate(agentId, { isPublic?, limits? })` that validates with the rules, writes in one transaction with the agent update, rebuilds the counter and re-evaluates; implement `api/src/slices/agent/limit/agentLimit.controller.ts`; T018 passes
- [X] T024 [US1] Call `applyWithAgentUpdate` from `update` and `create` in `api/src/slices/agent/agent/agent.controller.ts` so the rule and the agent write are one transaction; T019 and T020 pass
- [X] T025 [US1] Regenerate: `cd api && bun run build && bun run generate:swagger`, `cd admin && bun run build:api`, `cd app && bun run build:api`; commit only the generated changes that belong to this feature
- [X] T026 [P] [US1] Write `admin/slices/agent/agent/data/agentLimit.gateway.ts` + `agentLimit.mapper.ts` over the generated SDK (the hey-api client never throws: check `res.error`), and export them from `admin/slices/agent/agent/data/index.ts`
- [X] T027 [US1] Write the store `admin/slices/agent/agent/stores/agentLimit.ts` per `data-model.md` (`byAgent`, `fetchSummary`, `fetchLimits`, `save` through `patch()` with rollback); T021 passes
- [X] T028 [US1] Rework `admin/slices/agent/agent/components/agent/visibility/Provider.vue`: a Public / Private switch, the origins editor and three limit fields under one Save that sends `isPublic`, `allowedOrigins` and `limits` in one `PUT /agents/:id`; refusal codes shown next to the field they concern; the "what limits do not cover" line (FR-049); the share-link warning (FR-007); the "public without limits" state for legacy agents (FR-006); all `data-*` hooks of `contracts/chat-notice.md`
- [X] T029 [US1] Remove the "Show on landing page" checkbox and its origins field from `admin/slices/agent/agent/components/agent/item/Form.vue` and the fields it sent from `create/Provider.vue` and `edit/Provider.vue`; new agents are created private; point the removed spot at the "Visibility & embed" card
- [X] T030 [P] [US1] Show "limits on / off" on the read-only visibility line of `app/slices/agent/components/agent/workspace/Sheet.vue` from `GET /agents/:id/limits/enabled`, held in `app/slices/agent/stores/agent.ts` by agent id; strings in `app/slices/agent/i18n/locales/en.json` then `bun run i18n:sync` (FR-050)
- [X] T031 [US1] Write `specs/030-agent-request-limits/e2e/seed.mjs` (the six agents of `quickstart.md` §2, limits, backdated `AgentLoadMinute` rows, a share link, an Owner and a User login; idempotent; run from `api/` with `NODE_PATH` at the root `node_modules`) and `specs/030-agent-request-limits/e2e/fakeAgent.mjs` (registers on the hub for each seeded agent the way a runtime does, answers every message with a short text, logs what it received so tests can assert "never reached the agent")
- [X] T032 [US1] Write `specs/030-agent-request-limits/e2e/settings.mjs`: private → public with empty limits refused in one save; with a limit saved; switching limits off on a public agent refused; contradictory windows refused; `limits-legacy` shows "public without limits" and can still be renamed; share warning on `limits-share`; and the core of the story — after saving 3 per minute, four sends from the landing page, `fakeAgent` saw exactly three
- [X] T033 [US1] Gate: API jest + eslint + build; `cd admin && bun test slices && npx nuxt typecheck`; `cd app && bun test slices && npx nuxt typecheck && bun run locale:check`

**Checkpoint**: the protection works end to end; a limited person still sees the fallback line only. Comment on CLEAN-224.

---

## Phase 4: User Story 2 — A person chatting is told when they can write again (P1)

**Goal**: the notice of spec.md *The notice in the chat* on the landing chat,
the share page and the app console chat; the operator's line in admin.

**Independent test**: 1 per minute; the second message from the landing chat
shows the notice with a countdown, keeps the text, and goes with one press
when the countdown ends.

### Tests first

- [X] T034 [P] [US2] Write `app/slices/bridle/utils/limitTime.test.ts`: remaining ms → `{ kind: 'countdown', text: 'm:ss' }` under an hour (0:42, 12:05, rounds up, never 0:00 while waiting); `{ kind: 'clock' }` at an hour or more; `{ kind: 'tomorrow' }` when the end falls on the next local day; `ready` at zero
- [X] T035 [P] [US2] Extend the app store tests (new `app/slices/bridle/stores/bridle.limit.test.ts` or the existing store test file): a `RATE_LIMITED` ack removes the optimistic message, returns text and attachments to the draft, opens no typing state and sets `limits[agentId]`; `agent_limit { limited: true }` sets it without a send; `{ limited: false }` clears it; a second refusal replaces `until`; sending while limited does not reach the gateway
- [X] T036 [P] [US2] Extend `admin/slices/bridle/utils/delivery.test.ts` (and a store test if one exists): `agent_limit` sets and clears `visitorLimits[agentId]`; a `RATE_LIMITED` ack maps to a named failure reason and does not throw
- [X] T037 [P] [US2] Extend `api/src/slices/bridle/data/bridle.gateway.spec.ts` and the handler spec: `agent_limit { limited: true }` goes to every socket of the agent when an hour or day window fills and to a socket that connects while one is full, right after `welcome`; never for a minute window; `{ limited: false }` when limits are raised or removed and nothing is full; not sent on natural expiry

### Implementation — API

- [X] T038 [US2] Emit `agent_limit` from the hub: `agentLimit.service.ts` exposes `stateFor(agentId)` and an `onChange` hook; `api/src/slices/bridle/data/bridle.gateway.ts` gets `broadcastToAgentClients(agentId, event)`; `api/src/slices/bridle/handlers/bridleClientWs.handler.ts` sends the state after `welcome`; update the event list in the handler's header comment; T037 passes

### Implementation — app console

- [X] T039 [P] [US2] Implement `app/slices/bridle/utils/limitTime.ts` until T034 passes (pure; no `Intl`, no `toLocale*`)
- [X] T040 [US2] Extend `app/slices/bridle/domain/bridle.types.ts` and `app/slices/bridle/data/bridle.gateway.ts` with the `RATE_LIMITED` ack variant and the `agent_limit` listener (`onAgentLimit`)
- [X] T041 [US2] Extend `app/slices/bridle/stores/bridle.ts`: `limits` by agent id on the `performance.now()` scale, the rollback of a refused send, the guard in every send entry point (message, suggestion, form submit, queued/outbox resend); T035 passes
- [X] T042 [P] [US2] Write `app/slices/bridle/composables/useLimitCountdown.ts`: from `limits[agentId].until`, a reactive remaining value ticking once a second, recomputed on `visibilitychange`, `ready` for 2 s after zero, cleaned up on unmount
- [ ] T043 [P] [US2] Add the six keys of `contracts/chat-notice.md` to `app/slices/bridle/i18n/locales/en.json` and run `bun run i18n:sync` (if `CLAUDE_API_KEY` answers 401, use `CLAUDE_API_KEY_2` from `.env.project`); check the Russian reads «У этого агента достигнут лимит сообщений.» / «Попробуйте через {time}.»
- [X] T044 [US2] Write `app/slices/bridle/components/bridle/chat/LimitNotice.vue` per `contracts/chat-notice.md`: two lines, clock icon, information colour, shrinking line hidden under reduced motion, `role="status"` with the ticking time `aria-hidden` and a non-ticking alternative, all `data-limit-*` hooks, two lines at phone width, time of day through `useFormat()`
- [X] T045 [US2] Mount it in `app/slices/bridle/components/bridle/chat/Provider.vue` attached to the composer, and in `app/slices/bridle/components/bridle/chat/Input.vue`: the textarea stays editable; Send, suggestion chips and form submit get `aria-disabled` + `aria-describedby`; Enter while waiting triggers the nudge and sends nothing; the refused text and attachments are back in the field; no error strip and no "Not delivered" line for this refusal
- [X] T046 [US2] Verify, without editing unless something sends on its own: `app/slices/common/components/landing/hero/Stage.vue`, `app/slices/share/components/share/page/Provider.vue` and `app/slices/agent/components/agent/chat/Provider.vue` all render `<BridleChatProvider>` and have no second send path; note the result for the PR's twin-console statement

### Implementation — admin console

- [X] T047 [US2] Extend `admin/slices/bridle/stores/bridle.ts`: listen to `agent_limit` into `visitorLimits` by agent id; map a `RATE_LIMITED` ack to a named reason in `admin/slices/bridle/utils/delivery.ts`; T036 passes
- [X] T048 [US2] Show the operator's line in `admin/slices/bridle/components/bridle/Provider.vue` above the input while `visitorLimits[agentId]` is set, with the link to the agent's "Visibility & embed" card and the `data-visitor-limit-line` hook (FR-031)

### Browser tests

- [X] T049 [US2] Write `specs/030-agent-request-limits/e2e/notice.mjs` on the landing chat with `limits-minute`: refused send shows the notice with both lines and a time; nothing added to the conversation; no typing dots; text still in the field and editable; Send `aria-disabled` and described; Enter sets `data-limit-nudge` and `fakeAgent` receives nothing; conversation still scrolls; reload and a second tab show a remaining wait, not a fresh allowance; state reaches `ready`, nothing is sent by itself, one press delivers; fill the window from a second context right at expiry and assert the notice returns with a new time and the same words; screenshot each state into `shots/`
- [X] T050 [P] [US2] Write `specs/030-agent-request-limits/e2e/notice-app.mjs`: the same core in the app console chat as a signed-in User, once in English and once in Russian (assert the Russian sentences); and as the Owner in the app console, not limited
- [X] T051 [P] [US2] Write `specs/030-agent-request-limits/e2e/notice-share.mjs`: the same core on the share page of `limits-share` after limits are set on it
- [X] T052 [P] [US2] Write `specs/030-agent-request-limits/e2e/notice-long.mjs`: `limits-hour` — the notice is there on opening before any typing, and leaves without a reload when the Owner raises the limit through the API; opening `limits-minute` while only its minute window is full shows no notice; `limits-day` — "Try again after HH:MM" with no ticking; with the page clock set to 23:00, "tomorrow after"; a phone-width viewport keeps the notice to two lines with the composer in view
- [X] T053 [P] [US2] Write `specs/030-agent-request-limits/e2e/operator.mjs`: admin chat with `limits-hour` at its limit — the Owner's message is answered, the operator's line is visible and its link opens the card
- [ ] T054 [US2] Gate: API jest + eslint + build; both consoles `bun test slices` + `npx nuxt typecheck`; `cd app && bun run locale:check`; run T049–T053 against the local stack (Docker up, `quickstart.md` §2) and fix until green

**Checkpoint**: both P1 stories work in a browser. Comment on CLEAN-224 with the screenshots.

---

## Phase 5: User Story 3 — An operator watches the load live (P2)

**Goal**: meters, in-progress count, last-hour chart, refusals and peaks on the
agent page; marks in the agent list.

**Independent test**: open the agent page, send a burst from another browser,
see meters and chart change within seconds.

### Tests first

- [X] T055 [P] [US3] Extend `agentLimit.service.spec.ts`: the snapshot's three windows (`used`, `limit`, `retryAfterSec`), 60-point series with zero-filled gaps, refused totals by window and `lastAt`, exempt traffic, 30-day peaks as highest rolling minute / hour / day, `needsLimits`, `apiReplicas`; an agent with limits off gets `used` from minute rows plus pending
- [X] T056 [P] [US3] Extend `agentLimit.controller.spec.ts`: `GET /agents/:id/load` is Owner/Admin only and returns the snapshot DTO; `GET /agents/limits` carries `atLimit` and `needsLimits`

### Implementation

- [X] T057 [US3] Implement `snapshot(agentId)` and `summary()` in `agentLimit.service.ts`, with "in progress" read from the hub through a small read-only method added to `api/src/slices/bridle/domain/bridle.gateway.ts` / `data/bridle.gateway.ts` (count of the agent's conversations whose turn is open); add `agentLoad.dto.ts`; add the route; T055 and T056 pass; regenerate swagger and both SDKs
- [X] T058 [US3] Extend `admin/slices/agent/agent/stores/agentLimit.ts` with `fetchLoad(agentId)` and two pollers (3 s for the open agent, 15 s for the summary) that stop on unmount and on `visibilitychange` hidden (FR-046); extend its test
- [X] T059 [P] [US3] Write `admin/slices/agent/agent/components/agent/load/Meters.vue`: one meter per window with used / limit, "room again in …" when full, no ceiling when not limited, in-progress count, exempt traffic marked "not counted", the partial-figures note when `apiReplicas > 1`; hooks from `contracts/chat-notice.md`; times through `#common/utils/format`
- [X] T060 [P] [US3] Write `admin/slices/agent/agent/components/agent/load/Chart.vue` with the existing `@unovis/vue` wrappers in `admin/slices/setup/theme/components/ui/chart/`: 60 one-minute bars, accepted and refused stacked, a line at the per-minute limit when one is set, bars carry `data-minute` / `data-accepted` / `data-refused`
- [X] T061 [US3] Write `admin/slices/agent/agent/components/agent/load/Provider.vue` (renders by agent id from the store, starts and stops the poll) and mount it on the agent page next to the usage card in `admin/slices/agent/agent/components/agent/overview/Tab.vue`; show the 30-day peaks next to the limit fields in `visibility/Provider.vue` (`data-limit-peak`, FR-047)
- [X] T062 [US3] Add the "at limit" and "public without limits" marks, each with a text label, to the admin agent list and rail rows (find the row components with `grep -rn "data-agent-id" admin/slices/agent`), fed by the summary poll (FR-048)
- [X] T063 [US3] Write `specs/030-agent-request-limits/e2e/load.mjs`: with the agent page open, a burst from a second context moves `data-used` and the last chart bar within 5 s with no reload; refused count rises and shows a time; in-progress goes above zero while `fakeAgent` delays an answer; `limits-off` shows load with no ceiling and nothing refused; the list shows both marks; record the day figure, restart the API, and assert it is not lower (FR-019, SC-010)
- [X] T064 [US3] Gate: API jest + eslint + build; `cd admin && bun test slices && npx nuxt typecheck`; run `load.mjs`

**Checkpoint**: the operator can choose limits from evidence. Comment on CLEAN-224.

---

## Phase 6: User Story 4 — An integration is refused in a way it can act on (P3)

**Goal**: 429 with the wait from both message routes; remaining allowance for
credentialed callers only.

**Independent test**: with the limit full, both routes answer at once with 429
and `Retry-After`.

- [X] T065 [P] [US4] Extend `api/src/slices/bridle/bridle.controller.spec.ts` and `api/src/slices/bridle/domain/bridleSync.service.spec.ts`: a limited request to `/message` and `/message/sync` → 429, `Retry-After` in whole seconds rounded up, body `{ code, retryAfterSec, window }`; the sync route does not start waiting; an accepted request from a credentialed caller carries `X-RateLimit-Remaining` and `X-RateLimit-Reset`; an anonymous one carries neither
- [X] T066 [US4] Implement it in `api/src/slices/bridle/bridle.controller.ts` and `api/src/slices/bridle/domain/bridleSync.service.ts` (map the hub's `RATE_LIMITED` result to an `HttpException` 429 with the header; add `remainingFor(agentId)` to `agentLimit.service.ts` for the tightest window); document the 429 on both routes' `@ApiResponse`; T065 passes; regenerate swagger and both SDKs
- [X] T067 [US4] Write `specs/030-agent-request-limits/e2e/http.mjs`: against the running API, fill `limits-minute`, then assert 429 + `Retry-After` on both routes in under 1 s; assert the headers with an Owner token and their absence without one

---

## Phase 7: User Story 5 — The Ranch agent manages limits from the chat (P3)

**Goal**: `get_agent_limits` and `set_agent_limits`.

**Independent test**: ask the Ranch agent for an agent's limits and load, change
one, see it in the console.

- [X] T068 [P] [US5] Write `api/src/slices/agent/limit/agentLimit.tool.spec.ts`, modelled on `api/src/slices/agent/shareLink/shareLink.tool.spec.ts`: both tools carry `topic`, `title`, `template` and the Owner/Admin audience; `get_agent_limits` returns limits, the three windows, in-progress, refused in the last hour and peaks, and no identity of anyone; `set_agent_limits` applies the same rules and refusal codes as the route; it asks for `confirm` when any value is raised or removed and not when limits are first set or only tightened
- [X] T069 [US5] Read `docs/agent-tools.md`, then implement `api/src/slices/agent/limit/agentLimit.tool.ts` and register it in `agentLimit.module.ts`; T068 passes; the API boots (`bun run build && PORT=3399 node dist/main` starts without a tool-metadata refusal)
- [X] T070 [US5] Add the two tools to the capability list in `docs/agent-tools.md` and run the checklist at the end of that doc against them

---

## Phase 8: Widget (`CleanSlice/bridle`, separate branch and PR, same ticket)

**Purpose**: the fourth chat surface of User Story 2 (FR-021, FR-035, FR-036,
FR-037). Work in `E:/code/dream/cleanslice/bridle` on a branch
`feat/CLEAN-224-limit-notice` from an up-to-date `main`.

- [X] T071 [US2] Extend `sdk/test/fakeSocket.ts` with ack support and write the failing cases in `sdk/test/client.test.ts` and `sdk/test/widget.test.ts`: `send()` carries a `clientMessageId` and an ack; a `RATE_LIMITED` ack fires `limit` and not `error`; `agent_limit` is listened to; the draft and attachments survive a refusal and no bubble or typing state stays; button, Enter, suggestion, form submit and outbox flush send nothing while limited and a refused form is not marked submitted; the notice renders both labels with `{time}` replaced and leaves at zero; `AGENT_OFFLINE` from the ack renders the "Agent is not connected" line the hub no longer sends
- [X] T072 [US2] Implement in `sdk/src/client.ts`, `sdk/src/types.ts`, `sdk/src/index.ts` and `sdk/src/BridleChat.ce.vue`: the ack path, the `limit` client event, the notice above the composer (calm style, countdown on a monotonic deadline, cleaned up on unmount; "New chat" does not clear the wait), `limitLabel` / `limitRetryLabel` options with `data-*` attributes, the `limit` custom-element event and `onLimit`, the guards on all five send paths, and `sendMessage()` / headless `send()` while limited as in `contracts/bridle-protocol.md` §5; `npm test` green
- [X] T073 [P] [US2] Give the Nuxt layer the same behaviour in `nuxt/stores/bridle.ts` and `nuxt/components/bridle/Provider.vue` (ack, rollback, `disabled` on `Input.vue` while limited, a notice line)
- [X] T074 [P] [US2] Document the frames: `nestjs/domain/bridle.types.ts` and the event list in `nestjs/handlers/bridleClientWs.handler.ts`, `docs/PROTOCOL.md`, `docs/docs/protocol/websocket.md`, the embed pages under `docs/docs/embed/` (new options, the `limit` event), `sdk/README.md`
- [ ] T075 [US2] Bump `sdk/package.json` and its lockfile to 0.16.0, add 0.15.1 and 0.16.0 to `sdk/CHANGELOG.md`, `npm run build`, and run the browser check of `quickstart.md` §5 on `example/` against the local API and the local bundle: third message shows the notice, text kept, host `limit` event fires, message goes after the wait; then the old-widget check against `v0.13.3.js` (fallback line, typing dots stop)
- [ ] T076 [US2] Open the PR in `CleanSlice/bridle`, link CLEAN-224; after merge confirm npm has 0.16.0, **ask the user before triggering the DigitalOcean site deploy** (it also ships 0.14 and 0.15 to every embedding site), then confirm `https://bridle.cleanslice.org/sdk/latest.js` reports `Bridle.version === '0.16.0'` and rerun the example-page check against it

---

## Phase 9: Polish and delivery

- [X] T077 Write `specs/030-agent-request-limits/e2e/all.mjs`: seed, (re)start the API and `fakeAgent`, run every script in the order of `quickstart.md` §4, re-seed where a script would inherit a full window, print one summary, exit non-zero on any `FAIL`, total under 10 minutes (FR-040)
- [X] T078 [P] Write the operator-facing note `docs/operations/agent-limits.md`: what a limit counts, what it does not cover (operators, agent-to-agent, Telegram, scheduled runs), how the day figure survives a restart, that counting assumes one API copy, and the pointer to CLEAN-225 / CLEAN-226
- [ ] T079 [P] Check the constitution's twin-console statement in words for the PR body: which console got what in `agent` and `bridle`, that admin's `share` slice sends nothing to an agent and needed no change, that `common`, `chat`, `setup`, `user` were grepped for `sendToAgent` / `RATE_LIMITED` / `agent_limit` and needed nothing
- [ ] T080 Full gate on the finished build, with Docker up: every command of `quickstart.md` §3, then `node specs/030-agent-request-limits/e2e/all.mjs`; keep the output and the screenshots for the PR (FR-041: written but not run does not count)
- [ ] T081 Walk through `quickstart.md` §6 by hand once, including the Ranch agent step
- [ ] T082 Bump the version in the root `package.json` (no bump, no tag, no release), commit `feat(agent): request limits with a live load view and a wait notice in chat (CLEAN-224)`, push over HTTPS, open the PR into `main` with the commands run, the e2e result and the twin-console statement; put the PR URL on CLEAN-224 and move it to In Testing
- [ ] T083 When CI is green, merge as the DREAM account (`gh api user` first), watch `Release Platform`, check the tag exists, then move CLEAN-224 to Done with the tag in a comment — unless T076 is still open, in which case say so in the comment and keep the ticket open until `sdk/latest.js` serves 0.16.0

---

## Dependencies

```text
Phase 1 ─▶ Phase 2 ─▶ US1 (Phase 3) ─▶ US2 (Phase 4) ─┬─▶ Phase 9
                          │                            │
                          ├─▶ US3 (Phase 5) ───────────┤
                          ├─▶ US4 (Phase 6) ───────────┤
                          └─▶ US5 (Phase 7) ───────────┘
                    Phase 2 + T038 ─▶ Widget (Phase 8) ─▶ T083
```

- **US1** needs only Phase 2. It delivers the seed and the fake agent (T031) that every later browser test uses.
- **US2** needs US1's routes (to set limits in tests) and T031.
- **US3, US4, US5** each need US1 and nothing from each other or from US2.
- **Widget** needs the protocol as built in Phase 2 and T038; it can run alongside Phases 5–7.
- T080 needs everything in this repository; T083's final close needs T076.

## Parallel opportunities

- Phase 2 tests T004–T007 together; then T009, T010, T011 together.
- US1: T018–T021 together; T026 and T030 alongside T028–T029.
- US2: T034–T037 together; T039, T042, T043 together; T050–T053 together once T049's helpers exist.
- US3: T059 and T060 together.
- After US1: US3, US4, US5 and the widget can be four parallel tracks — different slices and, for the widget, a different repository.

Example for US2's test-first batch:

```text
T034  app/slices/bridle/utils/limitTime.test.ts
T035  app/slices/bridle/stores/bridle.limit.test.ts
T036  admin/slices/bridle/utils/delivery.test.ts
T037  api/src/slices/bridle/data/bridle.gateway.spec.ts
```

## Implementation strategy

**MVP = Phases 1–4** (US1 + US2). Both are P1 and neither is shippable alone:
limits without the notice read as a broken chat, and the notice has nothing to
show without limits. With limits off by default, each phase can merge on its
own without changing anything for existing agents.

Then, in any order: US3 (what makes the numbers defensible), US4, US5. The
widget ships from its own repository; limits are announced to customers only
after `sdk/latest.js` serves 0.16.0.

Ticket comments at the five checkpoints above and at the PR.

## Task counts

| Phase | Tasks |
|-------|-------|
| 1 Setup | 3 |
| 2 Foundational | 14 |
| 3 US1 caps | 16 |
| 4 US2 notice (consoles) | 21 |
| 5 US3 load view | 10 |
| 6 US4 integration | 3 |
| 7 US5 Ranch agent tools | 3 |
| 8 Widget (US2, other repository) | 6 |
| 9 Polish and delivery | 7 |
| **Total** | **83** |
