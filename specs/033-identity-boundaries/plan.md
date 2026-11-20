# Implementation Plan: Identity boundaries in chat and consoles

**Branch**: `fix/CLEAN-236-identity-boundaries` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/033-identity-boundaries/spec.md`

**Ticket**: [CLEAN-236](https://dreamvention.atlassian.net/browse/CLEAN-236) `[API][ADMIN][APP][RUNTIME]`. Also changes `CleanSlice/runtime` (branch of the same name there).

## Summary

Three boundaries that specs/032 left open, closed in three parts that can be
reviewed and released apart.

**Part A, colleagues.** A connection between two agents is treated as a
setting of the asking agent, so reach on the colleague is asked in one place
out of nine. One pure module (`peerAccess`) now says what a connection is to
a viewer (`full`, `masked`, `hidden`) and whether it serves a caller, and
every route, tool and listing asks it: a connection to a Ranch colleague
exists for a person only when they reach the colleague. It serves people who
do not, and callers with nobody behind them, only when somebody who manages
both agents marked it open to visitors, and then the colleague is shown
unnamed. The agent's own colleague tools move from "any caller" to "a
signed-in person", the public card asks the manage rule, and each connection
records who made it.

A question handed from one agent to another carries a signed hand-over token,
as a person's message carries an acting token. The receiving runtime learns
the turn is a colleague's: no visitor gate, no tools that configure it. The
token holds the chain and the person it was started for, so the loop rule
stops living in one slot per agent and every hop asks about the same
person's reach, without their power travelling along.

**Part B, conversations.** The Owner keeps the conversation every
administrator shared, under the id it has; every Admin gets their own id, as
a User has. Nothing is moved. "Is an administrator" stops being read off the
id: the hub states it on the message and the runtime reads that. A message
joins a running task by conversation, so a unique id per person closes the
join with no change to the router.

**Part C, sign-ins.** A session records the console it was made in, each
console has its own cookie and names itself in a header, and a sign-in of one
is not renewable by the other. Existing sign-ins end once.

Browser and HTTP scenarios against a running local stack are a condition of
done ([quickstart.md](./quickstart.md)).

## Technical Context

**Language/Version**: TypeScript 5.x everywhere. API on NestJS 11 + Prisma 6
(`api/`), consoles on Nuxt 4 / Vue 3.5 / Pinia (`admin/`, `app/`), runtime on
Bun (`CleanSlice/runtime`, v0.35.0 today).

**Primary Dependencies**: no new dependency. `@nestjs/jwt` signs the
hand-over token with the key acting tokens use. shadcn-vue pieces already in
`admin/slices/setup/theme/components/ui/` (switch, badge, alert-dialog,
tooltip).

**Storage**: PostgreSQL through Prisma. Three models change, none is added
([data-model.md](./data-model.md)). One migration with a two-statement
backfill. No object-storage or session-file migration (research R7).

**Testing**: API `jest` run directly
(`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run
test` with a dev API up), `npx eslint --quiet <touched files>`, `bun run
build` as the typecheck. Consoles: `bun test slices`, `npx nuxt typecheck`;
root `bun run locale:check`, `i18n:check`, `test:scripts`. Runtime: `bun
test`, `bun run build`. Scenarios: playwright-core and plain HTTP scripts
under `specs/033-identity-boundaries/e2e/`, one entry `all.mjs`, browser ones
at 390 px and 1440 px.

**Target Platform**: the three projects of this repository, the runtime
image, and the local stack of `specs/026-app-console-redesign/quickstart.md`.

**Project Type**: web service + two web consoles (monorepo, slices) + agent
runtime (separate repository).

**Performance Goals**: `ask_agent` is listed and described once per caller
per minute at most (the runtime's catalogue cache) and costs one access-list
read on top of today's peer read. A hand-over costs one token signature and
one verification. No cache is added on the API.

**Constraints**: a hidden connection answers byte for byte as a missing one,
on every route and tool (FR-001). Each side of the API and runtime pair must
work with the previous version of the other, and no mixed state may give a
caller more than this spec allows (FR-041,
[contracts/handover.md](./contracts/handover.md) §5). The main installation
has no internal connection today, forks may (FR-029). Single API process
(CLEAN-140): the hub's map of running turns is authoritative. App strings go
through `en.json` + `i18n:sync`; admin stays English.

**Scale/Scope**: tens of agents, a handful of connections per agent. API:
`agent/peer` (rule module, service, three tool files, two controllers,
guard, delegation, A2A server), `bridle` (identity, controller, both socket
handlers, gateway), `user/session`, `user/auth`, `chat` (list DTO, own-chat
id), `mcp` (party kind, handler). Admin: `agent/peer`, `bridle`, `chat`,
`setup/api`. App: `setup/api`, a check of `user/auth` and `bridle`. Runtime:
`setup/mcp`, `setup/channel`, `bot/bot`, `runtime/runtime`. Nine scenario
scripts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | The rule, the token and every colleague route and tool stay in `api/src/slices/agent/peer/`; other slices get `PeerAccess` only through that slice's exports. The chat identity stays in `bridle`, the sign-in in `user/session` and `user/auth`. The party kind is added where parties are defined (`user/auth/domain/auth.types.ts`, `mcp/tooling.ts`). Nothing new in `common`. |
| II. Twin consoles | Pass, both touched | `setup`: the console header in both API client plugins, same constant name, different value. `user`: both `auth` slices checked; the stores already reset on a change of account id and already show the session-ended state, so the header is the only change, and the PR says so. `bridle`: admin takes its channel from the hub's `welcome` instead of a literal; app already does, verified. `chat`: admin list labels change; app shows a person only their own chat and has no list of other people's, checked. `agent`: the colleague UI exists in admin only (`admin/slices/agent/peer`); app has no peer slice and gets none. `share`, `common`: checked, nothing to change. |
| III. Secrets stay behind `api/` | Pass | No new credential. The hand-over token is signed with the existing JWT secret, never stored or logged, and reaches only the agent it is addressed to. Masked rows and tool results carry no address, id or credential. |
| IV. One entity, one store | Pass | The admin `peer` store keeps one row per connection; the visitors switch and removal go through `patch()` with a rollback. No second copy of a connection in a component. |
| V. The console is a window, the chat is the hands | Pass | The one new console capability, opening a connection to visitors, has `set_agent_peer_visitors` (audience `manage-agent`, `confirm`, topic, title, template, spec). Who connected a colleague and the visitors mark are in the results of the existing list tools. `docs/agent-tools.md` gains the `peer` party and the changed audiences in the same PR. |
| VI. English is the source | Pass | No new string in `app`. Admin strings are English literals. Refusals from the server are shown as received. |
| VII. A rule stays a rule | Pass | Visibility and serving are a lookup table (`peerAccess`). Masking drops the name and the description by rule; nothing decides whether a description "gives the agent away" (research R2). No model call. |

**Additional constraints**: DTOs are generated into both SDKs. Every branch,
commit and PR carries CLEAN-236, in both repositories. The surface marking is
honest: the API, both consoles and the runtime change.

**Quality gate 4, values a reviewer would otherwise take on trust**:

| Value | Where | Why |
|-------|-------|-----|
| hand-over token lives the A2A timeout + 60 s | API | it must outlive the one turn it is for, and nothing else; the slack covers the runtime's last tool call |
| a call with no hand-over token is a chain started for nobody | API | fail closed: an agent on runtime 0.35 is served only by connections open to visitors |
| a masked colleague has skills and no description | API | the asking model cannot choose without skills; the default description contains the name (research R2) |
| a roster may be up to 60 s stale | runtime | the existing catalogue cache; the call itself is checked, so a stale name cannot be used |
| the step is hidden when the turn cannot be told and two are running | hub | showing it to the newest turn is the leak being fixed; a missing step loses nothing |
| existing connections are opened to visitors by the migration | API | they serve everybody today; a fork's public agent must not go quiet (FR-029). They are marked for review |
| no default console | API | a request that does not say which console it is has no sign-in; a default would be the shared cookie again |
| the Owner keeps the id `admin` | hub | one Owner, no transfer of ownership in the product; it makes "the chats stay with the Owner" true with nothing moved (research R7) |
| old cookie cleared, never read | API | it cannot be attributed to a console (FR-040) |

**Post-design re-check (after Phase 1)**: no principle is waived. One thing
was added by the design and is inside the principles: a fourth party kind.
It is defined once, next to the three that exist, and `docs/agent-tools.md`
is the place that says what it may do.

## Project Structure

### Documentation (this feature)

```text
specs/033-identity-boundaries/
├── spec.md
├── a2a-access-analysis.md   # the findings this plan answers
├── plan.md                  # this file
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/
│   ├── colleagues.md        # the rule, routes, tools, what the agent is told
│   ├── handover.md          # the token, hub to runtime, mixed versions
│   └── identity.md          # sign-ins and chat identities
├── checklists/requirements.md
├── e2e/                     # written with the tasks
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/
├── agent/peer/
│   ├── peer.prisma, delegation.prisma          # new columns
│   ├── domain/peerAccess.ts (+ .spec)          # NEW: visibility, serves
│   ├── domain/handover.ts (+ .spec)            # NEW: mint and verify the token
│   ├── domain/peer.service.ts                  # connect/remove/refresh by the rule; createdById; visitors
│   ├── domain/delegation.service.ts            # serves at call time; token; turn that asked; masked step
│   ├── domain/delegationStep.ts                # masked label and detail
│   ├── domain/a2a.server.service.ts            # verify pass, chain from token, no per-agent slot
│   ├── domain/a2aTask.store.ts                 # task bound to its connection
│   ├── guards/a2a.guards.ts                    # card: manage rule for a console token
│   ├── peer.controller.ts                      # filtered lists, reach on the colleague, PUT visitors
│   ├── peerSelf.tool.ts                        # audience person
│   ├── peerAdmin.tool.ts                       # a person required; set_agent_peer_visitors
│   ├── askAgent.tool.ts                        # roster and call per caller
│   └── dtos/                                   # view fields, visitors body
├── bridle/
│   ├── domain/chatIdentity.ts                  # Owner → admin, Admin → own id; embed sub rule
│   ├── bridle.controller.ts                    # isAdmin from the requester; channel access by manage
│   ├── handlers/bridleClientWs.handler.ts      # identity at the handshake
│   ├── handlers/bridleAgentWs.handler.ts       # isAdmin from the registered client
│   └── data/bridle.gateway.ts                  # admin flag and handover on the message; findActiveTurn by client
├── user/session/                               # surface on the row; cookie per surface
├── user/auth/                                  # console header on login/register/refresh/logout; embed sub check; party kind
├── chat/                                       # list DTO: user and peer names; own-chat id
└── mcp/                                        # peer party in tooling.ts and the tools handler

admin/slices/
├── agent/peer/                                 # rows: who connected, visitors switch, masked row, review mark
├── bridle/                                     # channel from welcome
├── chat/utils/chatList.ts                      # names; kind Colleague
└── setup/api/plugins/apiBaseUrl.ts             # X-Ranch-Console: admin

app/slices/
└── setup/api/plugins/api.ts                    # X-Ranch-Console: app

docs/agent-tools.md                             # parties, audiences
docs/guides/a2a.md, docs/guides/auth.md         # who sees and uses a connection, visitors; a sign-in per console

(CleanSlice/runtime)
src/slices/
├── setup/mcp/domain/actor.ts                   # peer kind
├── setup/mcp/data/mcp.gateway.ts               # ranch/turn on tool calls
├── setup/channel/                              # admin and handover read off the hub message
├── bot/bot/domain/bot.service.ts               # a colleague's turn skips the gate and the commands
└── runtime/runtime/                            # isAdmin from the message flag
```

**Structure Decision**: the existing slices, no new one. `agent/peer` grows
two domain files. The runtime change is its own PR in its own repository,
released first.

## Phases of delivery

Each ends green on its own tests and can ship alone.

1. **Runtime** (`CleanSlice/runtime`): the peer actor, the gate skip, the
   admin flag, `ranch/turn`. Inert until the API sends the new fields.
   Release 0.36.0, restart agents.
2. **Part A, the rule**: `peerAccess`, the migration, lists, history, card
   guard, removal, connect, tool audiences, `ask_agent` per caller. Closes
   findings 1 to 7 and 14.
3. **Part A, visitors and hand-over**: the visitors mark with its route,
   tool and console switch; the token; the chain; the step to the turn that
   asked; a colleague's conversation name. Closes 8 (as far as R15 goes), 9,
   10, 11, 12, 15, 17.
4. **Part A, outside colleagues**: personal and shared, the record of who
   connected. Closes 13.
5. **Part B, conversations**: chat identity, the operator flag, channel
   access, console labels.
6. **Part C, sign-ins**: surface, cookies, header, both consoles.
7. **Scenarios and docs**: `e2e/`, `docs/agent-tools.md`,
   `docs/guides/a2a.md`, `docs/guides/auth.md`, version bump of the root
   `package.json`.

## Risks

| Risk | Answer |
|---|---|
| A fork has connections made from the chat by anybody | The migration keeps them working and marks every one for the Owner's review (R13) |
| An agent on runtime 0.35 after the Ranch release | Table in contracts/handover.md §5: it loses, it never gains. Restart is the fix |
| Conversations of colleagues stored before the upgrade keep the asking agent's id in their name | Not migrated (R11). None on the main installation; stated in the release notes |
| An integrator mints embed tokens with account ids as `sub` on purpose | Refused from now on (R9); the release notes say so. No such use is known |
| Everybody is signed out once | Intended (FR-040); the consoles show the session-ended state |

## Complexity Tracking

No violation to justify.
