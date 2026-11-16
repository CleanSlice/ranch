# Implementation Plan: Request limits for agents

**Branch**: `feat/CLEAN-224-agent-request-limits` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/030-agent-request-limits/spec.md`

**Ticket**: [CLEAN-224](https://dreamvention.atlassian.net/browse/CLEAN-224) `[API][ADMIN][APP]`, plus a companion change in `CleanSlice/bridle`

## Summary

One allowance per agent, shared by everyone who talks to it: up to three
limits (per minute, hour, day), off by default, required before an agent can
be saved as public. The check sits at the single point every relayed request
passes — `BridleGateway.sendToAgent` — and asks a limiter owned by a new
`agent/limit` slice, which keeps an exact in-memory log per agent and writes
per-minute counts to Postgres so that usage survives a restart and feeds the
operator's live view.

A refused sender is told through the existing send acknowledgement
(`RATE_LIMITED` with the wait); a new `agent_limit` event puts the notice up
before a person sends when an hour or day window is already full; clients that
know neither get a readable line in the conversation. The app console shows a
notice attached to the composer with a countdown and keeps the person's text;
the admin console gets the limit fields in "Visibility & embed", a live load
view, list marks and an operator's line in its chat. The Ranch agent gets two
tools. The widget gets the same notice in its own repository.

Browser tests against a running local stack are a condition of done.

## Technical Context

**Language/Version**: TypeScript 5.x everywhere. API on NestJS 11 + Prisma 6
(`api/`), consoles on Nuxt 4 / Vue 3.5 / Pinia (`admin/`, `app/`). Widget:
Vue 3 custom element built with Vite (`CleanSlice/bridle`, `sdk/`).

**Primary Dependencies**: no new dependency. socket.io acknowledgements
(already used, CLEAN-102); `@unovis/vue` and the shadcn chart wrappers already
in `admin/`; `@tabler/icons-vue` in admin, lucide through `<Icon>` in app.
`@nestjs/throttler` considered and rejected (research R1).

**Storage**: PostgreSQL through Prisma. Two new models in
`api/src/slices/agent/limit/agentLimit.prisma`: `AgentLimit` (one-to-one with
`Agent`) and `AgentLoadMinute` (per agent per minute). Additive migration, no
backfill, no change to `Agent`. Live counters in the memory of the single API
process (CLEAN-140), rebuilt from `AgentLoadMinute` on boot.

**Testing**: API `jest` run directly
(`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run
test` with a dev API up), `npx eslint --quiet <touched files>`, `bun run
build` as the typecheck. Consoles: `bun test slices`, `npx nuxt typecheck`,
`bun run locale:check` in app. Browser: playwright-core scripts under
`specs/030-agent-request-limits/e2e/`, one entry `all.mjs`. Widget: `vitest`
with its fake socket, plus one browser check on `example/`.

**Target Platform**: the three existing projects and the local stack of
`specs/026-app-console-redesign/quickstart.md` (Postgres in Docker, API
`node dist/main` on :3333, app dev on :3000, admin dev on :3001). Widget:
npm + the `sdk/latest.js` address served by the bridle docs site.

**Project Type**: web service + two web consoles (monorepo, slices) + an
embeddable widget in a second repository.

**Performance Goals**: the check adds under 1 ms to a send (a binary search in
an array bounded by the limit); a refusal is returned in the same tick, so
well inside SC-007's 1 s; the load view reflects a request within 5 s
(3 s poll, SC-006).

**Constraints**: single API process — counters are per process (research R16).
No limit value, usage figure or "at limit" mark on any anonymous surface
(FR-051), which is why limits are not columns on `Agent` (CLEAN-225). No
identity of any sender is stored (FR-052). Operators and agent-to-agent
traffic are never refused (FR-014). Limits off must mean zero behaviour change
(FR-002, SC-002). App strings go through `en.json` + `i18n:sync`; admin stays
English; dates and numbers through the format module.

**Scale/Scope**: tens of agents per installation, limits up to 1 000 000 per
window (sanity cap, data-model). Touches 3 API slices (`agent/limit` new,
`agent/agent`, `bridle`, and one line in `agent/peer`), `agent` and `bridle`
in both consoles, `common` (landing) and `share` in app, and `sdk/`, `nuxt/`,
`nestjs/`, `docs/` in the widget repository. About 10 e2e scripts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | New sub-slice `api/src/slices/agent/limit/` owns the models, the limiter, the routes and the tools. `bridle` reaches it only through the limiter it exports (as it already reaches `shareLink`). Consoles: limit settings and load live in `agent`, the notice in `bridle`. Nothing goes to `common` except the landing composer's use of the `bridle` notice. |
| II. Twin consoles | Pass, both touched | `bridle` and `agent` exist in both and both change — see research R12 for what each gets and why they differ. `share` (app) sends through the app's `bridle` slice; admin's `share` slice does not send to an agent and is checked and left alone. The PR states this in words. |
| III. Secrets stay behind `api/` | Pass | No credential introduced. The e2e seed reads the existing local logins from `.env.project`. |
| IV. One entity, one store | Pass | Limit state for the chat: `bridle` store keyed by agent id, written by ack and event, rendered by id. Limits and load for the operator: one new `agentLimit` store in admin's `agent` slice; fetches upsert, the save goes through `patch()` with a rollback. No copy in a component (research R11). |
| V. The console is a window, the chat is the hands | Pass | `get_agent_limits` and `set_agent_limits` in the slice, with `topic` / `title` / `template`, Owner/Admin, `confirm` when a limit is raised or removed, numbers only in results, a spec each (research R15). Making an agent public or private from the chat is **not** added: no tool sets `isPublic` today, and this feature only moves that switch between two places in the console — it adds no capability there. |
| VI. English is the source | Pass | Six keys in `app/slices/bridle/i18n/locales/en.json`, `ru` by `bun run i18n:sync`; the component uses `$t` and `useFormat()`. Admin strings are literals in English. The hub's fallback line is server text, shown as received. |
| VII. A rule stays a rule | Pass | Everything here is a lookup or a calculation: who is exempt (verified role), whether a window is full (count), the wait (arithmetic), whether a save is allowed (three checks). No model call. |

**Additional constraints**: DTOs are generated into both SDKs, never
hand-written. Every branch, commit and PR carries CLEAN-224. Surface marking
`[API][ADMIN][APP]` is honest.

**Quality gate 4 — numbers a reviewer would otherwise take on trust**:

| Value | Where | Why this value |
|-------|-------|----------------|
| 10 s flush of minute counts | API limiter | the cadence `ApiInstanceService` already heartbeats at; bounds loss on a crash to under SC-010's "last minute" |
| 3 s poll of the load view | admin | margin for one slow response under SC-006's 5 s |
| 15 s poll of list marks | admin | a list mark a few seconds late costs nothing; four times fewer requests than the view |
| 30 days of minute rows | API | the window the "highest seen" suggestion is computed over, same as the Usage panel's 30 d |
| 1 000 000 cap per window | API validation | keeps the per-agent log under 8 MB; no real agent is near it |
| 2 s "You can send now" | notice | long enough to read five words, short enough not to sit on the composer |
| hour/day pushed, minute not | protocol | a minute window clears inside a minute; pushing it makes the notice flicker for people who are only reading |
| fallback line rounds up to 10 s / 1 min / 1 h | hub | the old client cannot count down, so the line must stay true while it sits in the conversation |

**Post-design re-check (after Phase 1)**: no new violation. The one judgment
call — the load view polls rather than streams — follows from III/CLEAN-225
(no public route for private figures), not from convenience.

## Project Structure

### Documentation (this feature)

```text
specs/030-agent-request-limits/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── bridle-protocol.md      # ack, agent_limit event, fallback line, widget API
│   ├── http-api.md             # routes, refusal codes, 429, agent tools
│   └── chat-notice.md          # notice states, i18n keys, data-* hooks for e2e
├── checklists/requirements.md
├── e2e/                        # written in implementation
│   ├── seed.mjs  fakeAgent.mjs  all.mjs
│   ├── notice.mjs  notice-app.mjs  notice-share.mjs  notice-long.mjs
│   ├── operator.mjs  settings.mjs  load.mjs  http.mjs
│   └── shots/
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/
├── agent/limit/                          # NEW sub-slice
│   ├── agentLimit.prisma                 # AgentLimit, AgentLoadMinute
│   ├── agentLimit.module.ts
│   ├── agentLimit.controller.ts (+spec)  # /agents/limits, /agents/:id/limits, /load
│   ├── agentLimit.tool.ts (+spec)        # get_agent_limits, set_agent_limits
│   ├── domain/
│   │   ├── agentLimit.types.ts           # windows, decision, snapshot
│   │   ├── agentLimit.rules.ts (+spec)   # validation, PUBLIC_AGENT_NEEDS_LIMITS
│   │   ├── slidingLog.ts (+spec)         # pure: count, admit, wait, rebuild
│   │   ├── agentLimit.service.ts (+spec) # counters, flush, rebuild, snapshot, peaks
│   │   └── agentLimit.gateway.ts         # abstract
│   ├── data/agentLimit.gateway.ts, agentLimit.mapper.ts
│   └── dtos/
├── agent/agent/
│   ├── dtos/createAgent.dto.ts, updateAgent.dto.ts   # optional `limits`
│   └── domain/ (agent service)           # the rule, in one transaction
├── agent/peer/domain/a2a.server.service.ts           # source: 'peer'
├── bridle/
│   ├── domain/bridle.types.ts            # RATE_LIMITED, source, agent_limit
│   ├── data/bridle.gateway.ts (+spec)    # the check, the event, the fallback line
│   ├── handlers/bridleClientWs.handler.ts            # source from role; event on connect
│   ├── bridle.controller.ts (+spec)      # 429, headers, source
│   └── domain/bridleSync.service.ts      # refuse before waiting
└── user/auth/guards/publicRoutes.spec.ts # unchanged counts; add the "no limits on anonymous surfaces" pin

admin/slices/
├── agent/agent/
│   ├── stores/agentLimit.ts (+test)                  # NEW store
│   ├── data/agentLimit.gateway.ts, mapper
│   ├── components/agent/visibility/Provider.vue      # switch + origins + limits, one Save
│   ├── components/agent/item/Form.vue                # checkbox removed
│   ├── components/agent/load/                        # NEW: Meters.vue, Chart.vue, Provider.vue
│   └── list / rail rows                              # at-limit and needs-limits marks
└── bridle/
    ├── stores/bridle.ts                              # agent_limit → visitorLimits; RATE_LIMITED as a named reason
    └── components/bridle/Provider.vue                # the operator's line

app/slices/
├── bridle/
│   ├── domain/bridle.types.ts, data/bridle.gateway.ts
│   ├── stores/bridle.ts (+test)                      # limits[agentId], rollback of a refused send
│   ├── utils/limitTime.ts (+test)                    # pure: remaining → what to show
│   ├── composables/useLimitCountdown.ts              # monotonic deadline, visibilitychange
│   ├── components/bridle/chat/LimitNotice.vue        # NEW
│   ├── components/bridle/chat/Provider.vue, Input.vue   # mount it, block all send paths
│   └── i18n/locales/en.json (ru generated)
│   # landing (common/.../hero/Stage.vue), share (share/.../page/Provider.vue) and the
│   # console chat (agent/.../chat/Provider.vue) all render <BridleChatProvider>, so the
│   # notice reaches all three from this one component; they are verified, not edited
└── agent/components/agent/workspace/Sheet.vue        # read-only "limits on"

docs/                                                 # operator-facing note on limits; agent-tools.md lists the two tools
```

Widget repository (`CleanSlice/bridle`, its own branch and PR, same ticket):

```text
sdk/src/client.ts, BridleChat.ce.vue, types.ts, index.ts
sdk/test/fakeSocket.ts, client.test.ts, widget.test.ts
sdk/package.json (0.16.0), sdk/CHANGELOG.md, sdk/README.md
nuxt/stores/bridle.ts, nuxt/components/bridle/Provider.vue
nestjs/domain/bridle.types.ts, nestjs/handlers/bridleClientWs.handler.ts (types + comment)
docs/PROTOCOL.md, docs/docs/protocol/websocket.md, docs/docs/embed/*.md
```

**Structure Decision**: the existing three projects, by slice. One new API
sub-slice (`agent/limit`), one new admin store, one new app component with its
composable and pure util. The widget change is a separate branch and PR in its
own repository, released as 0.16.0 and followed by a site deploy.

## Delivery order

Each step leaves `main` shippable with limits off.

1. **API core** — models and migration, pure `slidingLog`, rules, limiter
   service with flush and rebuild, the check in the hub, `source` from the
   three callers, ack variant, fallback line, 429. Jest. *Ticket comment.*
2. **API surface** — routes, DTOs with `limits` on agent create/update, load
   snapshot and peaks, `agent_limit` event, tools, swagger regen. Jest.
   *Ticket comment.*
3. **App console** — store, notice, countdown, all send paths on chat,
   landing and share, i18n sync, sheet flag. Unit tests + `notice*.mjs`.
   *Ticket comment.*
4. **Admin console** — `agentLimit` store, card, load view, list marks,
   operator's line. Unit tests + `settings.mjs`, `load.mjs`, `operator.mjs`.
   *Ticket comment.*
5. **Full browser run** — `all.mjs` green on the finished build, screenshots
   on the ticket; PR into `main`; merge; watch `Release Platform`; bump the
   root version or nothing is tagged.
6. **Widget** — branch in `CleanSlice/bridle`, vitest, example-page check, PR,
   npm 0.16.0, site deploy, confirm `sdk/latest.js` serves it. Limits may be
   announced only after this step (FR-037).

Steps 3 and 4 are independent of each other once 2 is in.

## Risks

| Risk | Handling |
|------|----------|
| A send path that bypasses the notice (suggestion chip, form, landing composer with its own send) | each composer file is listed in tasks and has its own assertion in e2e |
| The new widget stops receiving the synthetic "not connected" line once it sends a `clientMessageId` | called out in research R13; a widget test pins `AGENT_OFFLINE` rendering |
| `sdk/latest.js` deploy also ships 0.14 and 0.15 to every embedding site | the example-page check runs against the deployed address before limits are announced |
| A second API copy doubles the allowance | warning + `apiReplicas` in the snapshot (R16); CLEAN-140 keeps prod at one |
| CLEAN-226 (anonymous HTTP routes) is still open | those calls are counted like any visitor's once limits are set; the settings screen does not claim otherwise |
| e2e flakiness from real-time waits | only two real waits in the whole run; everything else asserts the refusal, not the expiry |

## Complexity Tracking

No constitution violation to justify.
