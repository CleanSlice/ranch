# Implementation Plan: Agent access by role

**Branch**: `feat/CLEAN-231-agent-user-access` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/032-agent-user-access/spec.md`

**Tickets**: [CLEAN-232](https://dreamvention.atlassian.net/browse/CLEAN-232) `[API]` (Part A, security, delivered first, also changes `CleanSlice/runtime`) and [CLEAN-231](https://dreamvention.atlassian.net/browse/CLEAN-231) `[ADMIN][APP]` (Part B, the feature)

## Summary

**Part A, CLEAN-232.** Two ways around the roles exist today and both are
closed before anything else. The Ranch assistant acts with the Owner's power
for whoever talks to it: a User can have it delete any agent. And 137 of 252
routes accept any signed-in account whatever its role, including model
credentials with their keys, settings and agent secrets. The fix: the hub
gives the runtime a signed acting token with each message of a signed-in
person; the runtime carries it to every tool call and asks for the tool
catalogue as that person; the API verifies it, reads the person's role from
the database and grants the lesser of the agent's power and theirs. A call
that names nobody is a guest's. `RolesGuard` becomes global and a route that
states no role requires Admin; three specs pin who is let in: public, User,
agent runtime.

Three smaller things come with it. Agents record who created them, and one
rule (`canManage`: Owner, an Admin who reaches the agent, its creator)
replaces role-only checks on managing an agent, so that letting Users create
agents later is one change. The assistant is told the role and console of
the person it is talking to and refuses in one sentence instead of
improvising. And the runtime reconnects when the API has forgotten its MCP
session, which today happens on every API restart.

**Part B, CLEAN-231.**

Every Admin and User account gets an allowed list and a denied list of
agents. They are stored as one row per account and agent, so an agent cannot
be on both. An account reaches an agent when it is not denied and the account
is either not limited or has the agent allowed; the Owner reaches everything.

The rule is enforced in the API, on every route that lists agents or names
one, by a declared scope on the route and a test that refuses an undeclared
one; the live chat channel checks at connect and on each message and is
closed when access is taken away. An unreached agent answers exactly as an
unknown one.

The Owner edits anyone; an Admin edits Users, sees only the agents they reach
themselves, and cannot make a change after which the User reaches something
the Admin does not. The editor is a card on the user page in the admin
console: one row per agent, one choice per row.

Two things from testing in the user console ride along. Pins become personal:
a table of account and agent, two routes open to every role, the
installation-wide column dropped. And an account switch in one browser no
longer shows the previous account's chat: the browser-kept copies are keyed
by account, and both consoles empty their stores when the signed-in id
changes.

Browser tests against a running local stack are a condition of done.

## Technical Context

**Language/Version**: TypeScript 5.x everywhere. API on NestJS 11 + Prisma 6
(`api/`), consoles on Nuxt 4 / Vue 3.5 / Pinia (`admin/`, `app/`).

**Primary Dependencies**: no new dependency. shadcn-vue pieces already in
`admin/slices/setup/theme/components/ui/` (radio-group, badge, scroll-area,
dialog); the existing socket.io hub; `@nestjs/core` `Reflector` for the scope
metadata, as `RolesGuard` uses it.

**Storage**: PostgreSQL through Prisma. Three new models, one dropped column
([data-model.md](./data-model.md)). One migration, no backfill. Browser:
`localStorage` keys renamed to carry the account id.

**Testing**: API `jest` run directly
(`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run
test` with a dev API up), `npx eslint --quiet <touched files>`, `bun run
build` as the typecheck. Consoles: `bun test slices`, `npx nuxt typecheck`;
root `bun run locale:check`, `i18n:check`, `test:scripts`. Browser:
playwright-core scripts under `specs/032-agent-user-access/e2e/`, one entry
`all.mjs`, at 390 px and 1440 px.

**Target Platform**: the three existing projects and the local stack of
`specs/026-app-console-redesign/quickstart.md`.

**Project Type**: web service + two web consoles (monorepo, slices).

**Performance Goals**: one extra indexed query per request that touches an
agent, on a table of at most accounts × agents rows; no cache. An access
change is in force on the next request and open sockets are closed in the
same tick (SC-006's five seconds is the slack for the console to notice).

**Constraints**: single API process (CLEAN-140), so an in-process listener is
enough to close sockets. A refusal for an unreached agent must be byte-for-byte
the "not found" of that route (FR-008). Public, share-link, embed, API-key and
agent-runtime callers must see zero change (FR-011): `publicRoutes.spec.ts`
keeps its counts. Empty lists must mean zero behaviour change (FR-024,
SC-005). Tool calls carry no person (research R6). App strings go through
`en.json` + `i18n:sync`; admin stays English.

**Scale/Scope**: tens of agents and accounts per installation. About 90
routes in 20 controllers gain a scope or a filter
([contracts/enforcement.md](./contracts/enforcement.md)). Two new API
sub-slices (`user/agentAccess`, `agent/pin`), edits in `agent/agent`, `chat`,
`bridle`, `log`, `usage`, `paddock`, `skill`, `browser`. Consoles: `user`,
`agent`, `bridle` in admin; `user`, `agent`, `bridle`, `chat` in app. Seven
e2e scripts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. The slice is the unit | Pass | The lists, the rule, the routes and the tools live in `api/src/slices/user/agentAccess/`; pins in `api/src/slices/agent/pin/`. Other slices reach the rule only through the exported `AgentAccessService`, `AgentAccessGuard` and `@AgentScoped`. Consoles: the editor is `admin/slices/user/agentAccess/`; the account-change reset belongs to `user/auth` and calls a `resetForAccount()` that each store owns. Nothing new in `common`. |
| II. Twin consoles | Pass, both touched | `user`: reset plugin in both; editor in admin only, because app has no user management. `agent`: pin write path in both. `bridle`: account-scoped keys and reset in both; what each keeps differs (app a conversation copy, admin an outbox and debug snapshots) and both are scoped. `chat`: app store reset; admin's chat store holds no state, checked and left alone. `share`, `setup`, `common`: checked, nothing to change (`share:` keys are deliberately accountless). The PR states this in words. |
| III. Secrets stay behind `api/` | Pass | No credential introduced. Tool results carry ids and names only. |
| IV. One entity, one store | Pass | New `agentAccess` store keyed by user id, `upsert` and `patch` with rollback. The admin user store gains `byId` / `upsert` and its three providers render by id (research R11): the summary badge is a new fact on the user and must not live twice. Pins stay a field of the agent record in the agent store. |
| V. The console is a window, the chat is the hands | Pass | `get_user_agent_access` and `set_user_agent_access`, audience `admin`, `confirm` on every change, a spec each. `pin_agent` stays and pins for the person asking. Part A changes what "audience" means for every tool (the party acted for, not the agent's token) and `docs/agent-tools.md` is rewritten to say so in the same PR. |
| VI. English is the source | Pass | Two keys in `app/slices/agent/i18n/locales/en.json`, `ru` by `bun run i18n:sync`. Admin strings are English literals. Server refusal sentences are shown as received. |
| VII. A rule stays a rule | Pass | Reach, the ceiling and the outcome sentence are lookups and set comparisons. No model call. |

**Additional constraints**: DTOs are generated into both SDKs. Every branch,
commit and PR carries CLEAN-231. `[ADMIN][APP]` is honest: both consoles
change what people see; the API work has no ticket of its own.

**Quality gate 4 — values a reviewer would otherwise take on trust**:

| Value | Where | Why |
|-------|-------|-----|
| no cache on the lists | API | one primary-key-prefix query over tens of rows; a cache would need an invalidation path to meet FR-010 |
| 404, not 403, for an unreached agent | API | FR-008: 403 confirms the agent exists |
| check on every inbound socket message | hub | the handshake is the only other check and a socket can stay open for hours |
| search box above six rows | editor | the threshold `BindingPicker` already uses |
| a tool call that names nobody is a guest's | API | fail closed: an old runtime loses management tools until redeployed, instead of keeping Owner power for everyone (R6) |
| no stated role means Admin | API | the admin console is Owner and Admin only and the user console calls none of the unannotated routes (R14) |
| acting token lives 60 minutes | hub | longer than any turn seen so far; a turn that outlives it loses the person's tools and the next message renews it (R6) |
| per-actor catalogue cached 60 s | runtime | one list call per turn at most; a role change shows within a minute, and the API re-checks at call time anyway |
| one retry on a lost MCP session | runtime | a restart loses the session once; a second failure is a real outage (R17) |
| old browser keys deleted, not migrated | consoles | they cannot be attributed to an account, and the server has the transcript |

**Post-design re-check (after Phase 1, and again after the runtime and route
audit of 2026-11-17)**: no violation. Every requirement of the spec is
covered; the two that were deferred in the first draft (FR-027, FR-037) are
delivered by Part A.

## Project Structure

### Documentation (this feature)

```text
specs/032-agent-user-access/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── acting-party.md    # Part A: the actor on a tool call, tool audiences, a role on every route
│   ├── http-api.md        # access and pin routes, refusal codes, agent tools
│   ├── enforcement.md     # every route that names an agent and how it is covered
│   └── console.md         # editor, pins, empty state, account switch, e2e hooks
├── checklists/requirements.md
├── e2e/                   # written in implementation
│   ├── seed.mjs  all.mjs
│   ├── owner-editor.mjs  enforce.mjs  ceiling.mjs  deletion.mjs
│   └── switch.mjs  pins.mjs  http.mjs
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
api/
├── prisma/migrations/<ts>_agent_access_and_pins/migration.sql
└── src/slices/
    ├── user/agentAccess/                 # NEW
    │   ├── agentAccess.prisma
    │   ├── agentAccess.module.ts
    │   ├── agentAccess.controller.ts     # GET/PUT /users/:id/agent-access
    │   ├── agentAccess.tool.ts           # get_/set_user_agent_access
    │   ├── domain/                       # types, gateway, AgentAccessService (reaches, reachableIds, replace, onChanged)
    │   ├── data/                         # gateway, mapper
    │   ├── dtos/
    │   └── guards/                       # agentScoped.decorator.ts, agentAccess.guard.ts, agentScopedRoutes.spec.ts
    ├── user/user/                        # UserDto.agentAccess, cleanup on delete
    ├── agent/pin/                        # NEW: agentPin.prisma, controller, gateway
    ├── agent/agent/                      # list filter, scopes, pinned per caller, creator auto-allow, drop pin_agent
    ├── agent/{agentChannel,toolCatalog,limit,event,file,secret,peer,shareLink}/   # scopes and filters
    ├── chat/                             # filters and child checks
    ├── bridle/                           # handshake, message, HTTP identity paths, close on change
    └── {log,usage,paddock,skill,browser}/ # scopes and filters

admin/slices/
├── user/agentAccess/                     # NEW: store, service, gateway, mapper, components/agentAccess/{Editor,Row,Outcome}.vue
├── user/user/                            # store byId/upsert, list badges, detail page hosts the editor
├── user/auth/plugins/accountScope.client.ts   # NEW
├── agent/agent/                          # useAgentPin → pin routes, resetForAccount
└── bridle/stores/bridle.ts               # scoped outbox and debug keys, resetForAccount

app/slices/
├── user/auth/plugins/accountScope.client.ts   # NEW
├── agent/                                # setPinned → pin routes, pin control for every role, useLastAgent scoped, no-access empty state, i18n keys
├── bridle/stores/bridle.ts               # scoped conversation and seq keys, hydrate after identity, resetForAccount
└── chat/stores/chat.ts                   # resetForAccount

api/src/app.module.ts                     # Part A: RolesGuard global
api/src/slices/mcp/                       # Part A: effectiveCaller, audiences in tools/list, _meta read in the tools handler
api/src/slices/user/auth/guards/          # Part A: default role, userRoutes.spec.ts, agentRoutes.spec.ts
api/src/slices/**/**.tool.ts              # Part A: audience per class; paddock, browser, integration gated
api/src/slices/**/**.controller.ts        # Part A: @Roles(User) / @Roles(Agent) where stated in the contract

docs/agent-tools.md                       # audiences by the party acted for; access tools; personal pin
docs/state.md                             # account change resets stores; keys carry the account
```

`CleanSlice/runtime` (second repository, Part A, own branch and PR under
CLEAN-232):

```text
src/slices/setup/channel/…/bridle/                # carry acting { token, role, surface } from the hub message
src/slices/setup/mcp/data/mcp.gateway.ts          # _meta["ranch/actor"] on list and call; per-actor catalogue; reconnect on a lost session
src/slices/setup/mcp/domain/                      # actorOf(ctx): person | trusted | guest
src/slices/runtime/loop/domain/                   # a delegated worker inherits its parent's actor
src/slices/agent/tool/domain/tool.types.ts        # the actor on ToolContext
src/slices/agent/agent/domain/                    # audience block in the prompt
```

Also in `api/` for Part A: `bridle` mints the acting token
(`BridleGateway.sendToAgent` and the HTTP message routes); `user/auth`
verifies it and refuses it as a bearer; `agent/agent` gains `createdById`,
`AgentPermissionService.canManage` and the migration; the Rancher template's
SOUL text is reordered (R18).

**Structure Decision**: the existing three-project layout plus one change in
the runtime repository. Two new API sub-slices, one new admin sub-slice, no
new top-level slice, nothing added to `common`.

## Delivery order

Each step leaves `main` shippable; the tasks file breaks them down.

**Part A — CLEAN-232, three PRs**

1. **Runtime**: carry the acting token, the actor on list and call, per-actor
   catalogue, reconnect on a lost session, audience block in the prompt,
   specs. Release. Inert against today's API except the reconnect, which
   helps at once.
2. **Ranch, tools**: the hub mints the acting token; `effectiveCaller`;
   audiences in the catalogue and at call time; `createdById` and
   `canManage`; paddock / browser / integration tools gated; the tool spec
   across guest, User, Admin, Owner; Rancher template text;
   `docs/agent-tools.md`. Bump the deployed runtime version in the same PR;
   redeploy the admin agent before release.
3. **Ranch, routes**: the runtime's own calls inventoried and given `Agent`,
   `RolesGuard` global with the Admin default, `User` stated where the
   contract says, `canManage` on the management routes of one agent, the two
   new route specs.

**Part B — CLEAN-231**

4. **Rule and storage**: models, migration, `AgentAccessService`, plugged into
   `effectiveCaller`.
5. **Enforcement**: decorator, guard, the route test, the controllers slice
   by slice, the tools, the hub last. `http.mjs` proves it.
6. **Access routes, ceiling, tools**: controller, `replace`, the two tools.
7. **Editor**: admin store and card, user store repair, list badges.
8. **Account switch**: reset plugin and scoped keys, app then admin.
9. **Pins**: slice, routes, both consoles, `pin_agent` rewritten, docs.
10. **Browser pass and docs**.

Steps 8 and 9 do not depend on 4 to 7.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| A second repository in one plan | The hole is on both sides: the runtime offers the tools, the API honours them | Fixing only the API leaves the model offering what it cannot do; fixing only the runtime leaves the API trusting whatever calls it |
| Debt cited, not fixed: `SSE /agents/status/stream` shows every agent's id and status to anyone | It is `@Public()` and carries no identity | Belongs with CLEAN-175; closing a public route here would break the landing page's status dots without a replacement |

## Decisions taken as defaults, to confirm before tasks

1. **Admins and the assistant.** Through the assistant an Admin gets the
   tools whose console route an Admin may call; Owner-only routes stay
   Owner-only tools. `docs/agent-tools.md` says today that only the Owner is
   an operator, while in practice Admins have had everything. This plan makes
   the tools follow the console.
2. **No actor means guest.** An agent on an old runtime loses management
   tools until redeployed. The alternative, keeping full power when nobody is
   named, keeps the hole open for exactly the agents nobody remembered to
   restart.
3. **No stated role means Admin.** Settings, model credentials and the rest
   stay usable by Admins as in the console today. Tightening any of them to
   Owner-only is a separate decision per screen.
4. **Order.** CLEAN-232 ships first, in three PRs; CLEAN-231 follows.
5. **Trusted parties are stated, not proven.** A scheduled job and a Telegram
   administrator from the agent's own configuration act with the agent's
   power, as today, on the runtime's word. A person is always proven by the
   acting token. Requiring a token there too would mean scheduled jobs of the
   Ranch assistant stop working.
6. **Creator may manage only while they reach the agent.** If the Owner
   denies a creator their own agent, they lose it.
7. **Users creating agents is not built here.** The creator is recorded and
   the rule is in place; opening creation is its own feature.
