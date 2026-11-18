# Tasks: Agent access by role

**Input**: Design documents from `specs/032-agent-user-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (acting-party, http-api, enforcement, console), quickstart.md

**Tests**: included. The plan makes specs and browser checks a condition of done.

**Organization**: by user story, in the delivery order of plan.md: Part A
(CLEAN-232, security, Stories 7, 8, 9, 10) ships first, then Part B
(CLEAN-231, Stories 1, 5, 2, 3, 4, 6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story of spec.md the task serves

## Path Conventions

- `api/`, `admin/`, `app/`, `docs/` are in this repository.
- `runtime:` prefixes a path in the `CleanSlice/runtime` repository (its own
  branch and PR, ticket CLEAN-232).
- Commands: [quickstart.md](./quickstart.md). In `api/` run jest directly,
  never `bun run test` with a dev API up. Never run Prettier or ESLint `--fix`
  over `admin/` or `app/`.

---

## Phase 1: Setup

**Purpose**: branches, generated code, a baseline to compare against

- [X] T001 Create branch `fix/CLEAN-232-acting-party` from up-to-date `origin/main` in this repository for Part A; keep `feat/CLEAN-231-agent-user-access` for Part B and rebase it onto Part A once merged
- [X] T002 [P] Create branch `fix/CLEAN-232-acting-party` from up-to-date `origin/main` in `CleanSlice/runtime`; record the baseline of `bun test` and `bunx tsc --noEmit -p tsconfig.json` (known noise: `telegramFile`, `bridleAttachments.spec.ts`)
- [X] T003 [P] In `api/` run `bun run generate`, `bun run build`, `bun run generate:swagger`; in `admin/` and `app/` run `bun run build:api`; confirm a clean tree afterwards
- [X] T004 [P] Move the route audit script into the repository as `api/scripts/audit-routes.mjs` (prints route, guards, least role per `*.controller.ts`) and save its current output as the baseline in `specs/032-agent-user-access/audit-before.txt`

---

## Phase 2: Foundational (Part A, blocks Stories 7 to 10)

**Purpose**: the acting token and the single answer to "who is this call for"

**⚠️ CRITICAL**: nothing in Part A can be finished before this phase

- [X] T005 Add the acting token to `api/src/slices/user/auth/domain/auth.service.ts`: `mintActingToken({ userId, agentId, sid })` (claims `typ: 'acting'`, `sub`, `aud: 'agent:<id>'`, `sid`, 60 min) and `verifyActingToken(token, bearerSub)` (signature, `typ`, `aud` equals the bearer's `sub`, expiry, session `sid` alive); extend `IAuthTokenPayload` in `api/src/slices/user/auth/domain/auth.types.ts` with `typ: 'acting'` and `aud`
- [X] T006 Refuse `typ: 'acting'` as a bearer in `api/src/slices/user/auth/guards/jwtAuth.guard.ts`, next to the embed refusal
- [X] T007 [P] Spec `api/src/slices/user/auth/domain/actingToken.spec.ts`: valid, forged signature, expired, wrong `aud`, ended session, used as a bearer
- [X] T008 Add `effectiveCaller(req)` to `api/src/slices/mcp/tooling.ts` per the table in contracts/acting-party.md section 2 (person on a console token; agent with `person` / `trusted` / `guest` / absent actor), returning `{ kind, userId?, role?, agentId? }`; rewrite `callerIsOperator` and `requireOperator` on top of it and add `requireAudience(req, audience)`
- [X] T009 Read `params._meta["ranch/actor"]` for `tools/list` and `tools/call` in `api/src/slices/mcp/services/handlers/mcp-tools.handler.ts` and attach it to the request the tool receives (`api/src/slices/mcp/adapters/express-http.adapter.ts`), so `effectiveCaller` can see it
- [X] T010 [P] Spec `api/src/slices/mcp/effectiveCaller.spec.ts` over every row of the table, including "the actor never raises what the token allows" for a role-`Agent` runtime naming the Owner

**Checkpoint**: a tool can ask who it is being called for, and the answer cannot be forged

---

## Phase 3: User Story 7 - The assistant acts with the power of the person asking (Priority: P1) 🎯 MVP

**Goal**: whoever talks to the Ranch assistant gets from it what they could do themselves

**Independent Test**: as a User, ask the assistant to list users, read a setting and delete an agent: each is refused and nothing changes; as the Owner all three work

### Tests for User Story 7

- [X] T011 [P] [US7] Spec `api/src/slices/mcp/toolAudience.spec.ts`: enumerate every registered tool, list and call each as guest, User, Admin and Owner, and assert the audience table of contracts/acting-party.md section 2 (a new tool with no audience fails the spec)
- [X] T012 [P] [US7] `runtime:src/slices/setup/mcp/domain/actor.spec.ts`: the actor chosen for each row of contracts/acting-party.md section 1 (console person with token, internal turn, Telegram admin, share visitor, messenger user, delegated worker)
- [X] T013 [P] [US7] `runtime:src/slices/setup/mcp/data/mcp.gateway.actor.spec.ts`: `_meta["ranch/actor"]` is present on `tools/list` and `tools/call`, the catalogue is cached per actor for 60 s, and a tool absent from the caller's catalogue is not offered to the model

### Implementation for User Story 7

- [X] T014 [US7] Mint the acting token for a signed-in console socket in `api/src/slices/bridle/data/bridle.gateway.ts` (`sendToAgent`, beside `user`): message field `acting: { token, role, surface }`, `surface` derived from the socket origin in `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`; same for a console requester on the HTTP message routes in `api/src/slices/bridle/bridle.controller.ts`
- [X] T015 [P] [US7] `runtime:src/slices/setup/channel/domain/channel.types.ts` and the bridle channel repository under `runtime:src/slices/setup/channel/data/repositories/bridle/`: carry `acting` from the hub message onto `Message`; `runtime:src/slices/agent/tool/domain/tool.types.ts`: add `actor` to `ToolContext`
- [X] T016 [US7] `runtime:src/slices/setup/mcp/domain/actor.ts`: `actorOf(ctx)` returning `person` (with the token) / `trusted` (`internal`, `channel-admin`) / `guest`; wire it where `ToolContext` is built in `runtime:src/slices/runtime/runtime/domain/runtime.service.ts` and inherit it in `runtime:src/slices/runtime/loop/domain/delegate.service.ts`
- [X] T017 [US7] `runtime:src/slices/setup/mcp/data/mcp.gateway.ts`: for the Ranch server send `_meta["ranch/actor"]` on `callTool` and on `listTools`; list per actor with a 60 s cache and expose only that catalogue to the turn (replace the single shared catalogue for this server)
- [X] T018 [US7] Declare an audience on every tool class and enforce it at list and call time: `owner` for `api/src/slices/user/user/user.tool.ts` (role, delete), `api/src/slices/user/apiKey/apiKey.tool.ts`, `api/src/slices/setting/setting.tool.ts`, `api/src/slices/upgrade/upgrade.tool.ts`, event destinations in `api/src/slices/agent/event/agentEvent.tool.ts`; `admin` for the remaining operator tool files; check each against the role of the console route it mirrors
- [X] T019 [P] [US7] Gate the tools that have no gate today as `admin`: `api/src/slices/paddock/evaluation/evaluation.tool.ts`, `api/src/slices/paddock/scenario/scenario.tool.ts`
- [X] T020 [P] [US7] Make `api/src/slices/browser/browser.tool.ts`, `api/src/slices/integration/integration.tool.ts` and `api/src/slices/mcpServer/oauth/mcpOauth.tool.ts` `person` tools: drop the model-supplied `userId` / `subject` argument and take the person from `effectiveCaller`; refuse when there is none
- [X] T021 [US7] Rewrite `docs/agent-tools.md`: audiences are decided by the party acted for; the table of audiences; the acting token; "no actor means guest"; the reviewer checklist gains "which audience, and does the console route agree"
- [ ] T022 [US7] Release `CleanSlice/runtime` (version bump, changelog), then raise the runtime version Ranch deploys (the setting or constant the deploy reads; find it from `api/src/slices/agent/agent/domain/agentDeploy.service.ts`) in the same PR as T014 to T021

**Checkpoint**: Story 7 holds end to end with a redeployed admin agent; an agent on the old runtime has no management tools

---

## Phase 4: User Story 8 - Every route asks for a role (Priority: P1)

**Goal**: a User calling the API directly can do no more than the user console offers

**Independent Test**: with a User's token, call every route; only the list in contracts/acting-party.md section 6 answers

### Tests for User Story 8

- [X] T023 [P] [US8] `api/src/slices/user/auth/guards/userRoutes.spec.ts`: the exact set of routes whose least role is `User`, same shape as `publicRoutes.spec.ts`
- [X] T024 [P] [US8] `api/src/slices/user/auth/guards/agentRoutes.spec.ts`: the exact set of routes that admit the `Agent` role
- [X] T025 [P] [US8] `specs/032-agent-user-access/e2e/routes.mjs`: sign in as a seeded User and call every route from the swagger spec; assert 403 outside the reviewed list and no 5xx

### Implementation for User Story 8

- [X] T026 [US8] Inventory the routes the runtime calls with `RANCH_API_TOKEN` (`runtime:src/slices/runtime/init/data/init.gateway.ts`, `runtime:src/slices/agent/skill/data/skill.gateway.ts`, `runtime:src/slices/bot/usage/data/usage.gateway.ts`, browser login, `agent_status`) and write the list into `specs/032-agent-user-access/contracts/acting-party.md` section 6
- [X] T027 [US8] State `@Roles(..., UserRoleTypes.Agent)` on each route from T026 in its controller under `api/src/slices/`
- [X] T028 [US8] State `@Roles(UserRoleTypes.User)` on the routes of the table in contracts/acting-party.md section 6: `api/src/slices/user/auth/auth.controller.ts` (`me`, session routes), `api/src/slices/agent/agent/agent.controller.ts` (`GET /agents`, `/agents/status`, `/agents/:id`), `api/src/slices/chat/myChat.controller.ts`
- [X] T029 [US8] Make `RolesGuard` global in `api/src/app.module.ts` (after `JwtAuthGuard`) and change `api/src/slices/user/auth/guards/roles.guard.ts` so a route with no `@Roles` requires Admin; skip `@Public()` routes and routes behind `BridleApiKeyGuard`, `ApiKeyGuard` and the peer guards
- [X] T030 [US8] Run `api/scripts/audit-routes.mjs` again, save `specs/032-agent-user-access/audit-after.txt`, and confirm zero routes with "any token"; walk every admin console screen as an Admin for a 403 (`admin/` uses only Owner and Admin)
- [X] T104 [US8] An agent runtime's token is an `Agent` on routes, whatever roles it carries: in `api/src/slices/user/auth/guards/roles.guard.ts` reduce a bearer whose `sub` starts with `agent:` to the `Agent` role, so the Ranch admin agent's Owner power exists only through tools, where the party is checked (found in implementation: an Admin can read `RANCH_API_TOKEN` with the runtime's `exec` tool and call the routes as Owner); keep the MCP endpoint open to every authenticated bearer through the `decorators` option of `McpModule.forRoot` in `api/src/app.module.ts`; spec in `roles.guard.spec.ts`
- [X] T105 [US8] Remove the raw-HTTP fallback from the Rancher template (`rancher/.agent/SOUL.md`, `rancher/.agent/HEARTBEAT.md`, `rancher/.agent/skills/ranch/SKILL.md`): no `RANCH_API_TOKEN` bearer recipes, no "pivot to http"; where a recipe has no tool (knowledge freshness in HEARTBEAT), use the existing knowledge tools or add the missing one in its slice
- [X] T031 [P] [US8] Fix controller specs that assumed "no role": search `api/src/slices/**/*.controller.spec.ts` for the affected controllers and assert the role metadata instead

**Checkpoint**: Stories 7 and 8 close both ways around the roles

---

## Phase 5: User Story 9 - The assistant knows whom it is talking to (Priority: P2)

**Goal**: a plain first-reply refusal for what the person cannot do; a connection that repairs itself

**Independent Test**: as a User ask to delete an agent: one reply, a refusal, no tool attempt; restart the API mid-conversation and the Owner's next request succeeds

### Tests for User Story 9

- [X] T032 [P] [US9] `runtime:src/slices/setup/mcp/data/mcp.gateway.reconnect.spec.ts`: a 404 / `Session not found` drops the client, reconnects and retries once; a second failure returns "Ranch is not reachable right now" with no `next`
- [X] T033 [P] [US9] `runtime:src/slices/agent/agent/domain/audiencePrompt.spec.ts`: the block for User / Admin / Owner in `app` and `admin`, for a guest and for a trusted party

### Implementation for User Story 9

- [X] T034 [US9] `runtime:src/slices/setup/mcp/data/mcp.gateway.ts`: treat a lost session on a static client as recoverable (drop, initialise, retry once) and return the plain unavailable result otherwise
- [X] T035 [US9] `runtime:src/slices/agent/agent/domain/prompts/audience.prompt.ts` and `runtime:src/slices/agent/agent/domain/agent.service.ts`: build the audience block of contracts/acting-party.md section 4 from `acting.role`, `acting.surface` and the actor kind, and add it to the turn's system prompt
- [X] T036 [P] [US9] Move the Rancher template's guidance about the management console and raw API calls inside its admin-only blocks (the template files of the rancher seed under `api/src/slices/rancher/`; keep SOUL within the prompt limit of CLEAN-230)
- [X] T037 [US9] `specs/032-agent-user-access/e2e/assistant.mjs`: with a local runtime on the new version, as a User "delete agent X" gets one refusal and the transcript has no tool call; as the Owner it is carried out after confirmation; restart the API between two Owner requests

**Checkpoint**: the conversation is honest about what the person can do

---

## Phase 6: User Story 10 - An agent remembers who created it (Priority: P3)

**Goal**: creator recorded; one rule for who may manage an agent

**Independent Test**: create an agent in the console and one through the assistant as the same Admin: both show that Admin; `canManage` says yes for a non-Admin creator's own agent and no for another

### Tests for User Story 10

- [X] T038 [P] [US10] `api/src/slices/agent/agent/domain/agentPermission.service.spec.ts`: the three lines of `canManage`, a creator who is a User, a creator denied their own agent, a null creator
- [X] T039 [P] [US10] Extend `api/src/slices/agent/agent/agent.controller.spec.ts` and `api/src/slices/rancher/rancher.tool.spec.ts`: `createdById` comes from the console token and from the acting token, and is null for a trusted actor

### Implementation for User Story 10

- [X] T040 [US10] Add `createdById String?` to `api/src/slices/agent/agent/agent.prisma` and the migration `api/prisma/migrations/<timestamp>_agent_created_by/migration.sql`; thread it through `api/src/slices/agent/agent/domain/agent.types.ts`, `data/agent.mapper.ts`, `data/agent.gateway.ts`
- [X] T041 [US10] Pass the creator into `AgentDeployService.createAgent` (`api/src/slices/agent/agent/domain/agentDeploy.service.ts`) from `POST /agents` in `agent.controller.ts` and from `create_agent` in `api/src/slices/rancher/rancher.tool.ts`
- [X] T042 [US10] `api/src/slices/agent/agent/domain/agentPermission.service.ts`: `canManage(caller, agent)`; until Part B, `reaches` is always true behind an interface Part B will implement
- [X] T043 [US10] Call `canManage` on the management routes of one agent (`PUT` / `DELETE /agents/:id`, restart, stop, start in `agent.controller.ts`; files, secrets, channels, limits, logs controllers) and make the corresponding tools the `manage-agent` audience: listed when the caller may manage at least one agent, checked per agent at call time
- [X] T044 [P] [US10] `AgentDto.createdBy` in `api/src/slices/agent/agent/dtos/agent.dto.ts` (resolved for Owner and Admin, `{ id, name: null }` for a removed account); regenerate both SDKs
- [X] T045 [P] [US10] Show "Created by" on the agent's detail in `admin/slices/agent/agent/components/agent/workspace/Main.vue` (unknown / removed account states); `app` shows nothing new, state that in the PR

**Checkpoint**: Part A complete. Merge order: runtime, Ranch tools (T005 to T022, T032 to T045), Ranch routes (T023 to T031)

---

## Phase 7: Foundational (Part B, blocks Stories 1 to 4)

**Purpose**: the lists and the rule

- [X] T046 Models `UserAgentAccess` and `UserAgentAccessEntry` in `api/src/slices/user/agentAccess/agentAccess.prisma` and `AgentPin` in `api/src/slices/agent/pin/agentPin.prisma` per data-model.md; migration `api/prisma/migrations/<timestamp>_agent_access_and_pins/migration.sql` (create three tables, drop `Agent.pinned`)
- [X] T047 Sub-slice skeleton `api/src/slices/user/agentAccess/`: `agentAccess.module.ts`, `domain/agentAccess.types.ts`, `domain/agentAccess.gateway.ts`, `data/agentAccess.gateway.ts`, `data/agentAccess.mapper.ts`; register the module in `api/src/app.module.ts`
- [X] T048 `api/src/slices/user/agentAccess/domain/agentAccess.service.ts`: `reaches`, `reachableIds`, `assertReaches`, `outcome`, `onChanged(listener)`, `removeUser`; one query by `userId` per call, no cache; plug it into `effectiveCaller` consumers and into the `reaches` interface of T042
- [X] T049 [P] Spec `api/src/slices/user/agentAccess/domain/agentAccess.service.spec.ts`: the rule table of data-model.md, Owner and non-person callers, the four outcomes, `needsReview` after the last allowed entry disappears

**Checkpoint**: the rule exists and is tested; nothing enforces it yet

---

## Phase 8: User Story 1 - The Owner decides which agents an account gets (Priority: P1)

**Goal**: lists per account, edited by the Owner, enforced everywhere

**Independent Test**: as Owner restrict a User; as that User the list, direct links and chat honour the lists

### Tests for User Story 1

- [X] T050 [P] [US1] `api/src/slices/user/agentAccess/guards/agentScopedRoutes.spec.ts`: every route whose path contains `:agentId` or sits under `agents/:id` has `@AgentScoped` or an entry in the exemption list of contracts/enforcement.md
- [X] T051 [P] [US1] `api/src/slices/user/agentAccess/guards/agentAccess.guard.spec.ts`: param, query and body sources; 404 identical to the route's own "not found"; Owner, agent runtime, embed and public callers pass
- [X] T052 [P] [US1] `api/src/slices/user/agentAccess/agentAccess.controller.spec.ts`: roles, `ACCESS_NOT_EDITABLE`, `ACCESS_LISTS_OVERLAP`, `ACCESS_OPEN_NEEDS_CONFIRM`, `ACCESS_CHANGED`, moving an agent between lists
- [X] T053 [P] [US1] `specs/032-agent-user-access/e2e/seed.mjs` (agents A, B, C; an Admin limited to A and B; two Users) and `e2e/http.mjs` (every route of contracts/enforcement.md with the restricted token for a hidden agent)

### Implementation for User Story 1

- [X] T054 [US1] `api/src/slices/user/agentAccess/guards/agentScoped.decorator.ts` and `agentAccess.guard.ts` (mechanism S); export both from the module
- [X] T055 [US1] Apply S / F / A to `api/src/slices/agent/agent/agent.controller.ts` and compute `pinned` per caller there (false until Phase 13 adds the pin gateway)
- [X] T056 [P] [US1] Apply S / F to `api/src/slices/agent/agentChannel/`, `agent/toolCatalog/`, `agent/limit/`, `agent/event/` controllers
- [X] T057 [P] [US1] Apply S at class level to `api/src/slices/agent/file/` (three controllers), `agent/secret/`, `agent/shareLink/`, and S plus F to `agent/peer/` (`peer.controller.ts`, `peerLink.controller.ts`)
- [X] T058 [P] [US1] Apply F / S / A to `api/src/slices/chat/chat.controller.ts` and `chat/myChat.controller.ts`
- [X] T059 [P] [US1] Apply S / F / A to `api/src/slices/log/`, `usage/`, `paddock/evaluation/`, `paddock/scenario/`, `skill/` (`GET /skills/:id/agents`), `browser/browser.extension.controller.ts`
- [X] T060 [US1] Bridle HTTP: check `reaches` for a console person inside `resolveRequester`, `requireChannelAccess` and `BridleChatAuthGuard`, and filter `GET list`, in `api/src/slices/bridle/bridle.controller.ts` and `api/src/slices/bridle/guards/`
- [X] T061 [US1] Bridle socket: check at handshake and on each inbound `message` in `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`; register an `onChanged` listener that disconnects that person's sockets for agents no longer reached (`api/src/slices/bridle/data/bridle.gateway.ts`)
- [X] T062 [US1] `api/src/slices/user/agentAccess/agentAccess.controller.ts` and `dtos/`: `GET` / `PUT /users/:id/agent-access` per contracts/http-api.md; `AgentAccessService.replace` steps 1, 5 and 6 of research R8 (who may edit, confirm before opening, version) in a transaction that locks the account row
- [X] T063 [US1] `UserDto.agentAccess` summary in `api/src/slices/user/user/dtos/user.dto.ts` and the controller; call `removeUser` from the user delete path (`user.controller.ts`, `user.tool.ts`)
- [ ] T064 [US1] Admin sub-slice `admin/slices/user/agentAccess/`: `domain/` types, service and gateway interface, `data/` gateway and mapper over the regenerated SDK (check `res.error`), `stores/agentAccess.ts` keyed by user id with `upsert` and `patch` + rollback, `plugins/di.ts`
- [ ] T065 [US1] Repair `admin/slices/user/user/stores/user.ts` (`byId`, `upsert`, `patch`) and render by id in `components/user/list/Provider.vue`, `item/Provider.vue`, `edit/Provider.vue` (research R11)
- [ ] T066 [US1] Editor `admin/slices/user/agentAccess/components/agentAccess/Editor.vue`, `Row.vue`, `Outcome.vue` per contracts/console.md (three-way choice per row, outcome sentence, review banner, confirm dialog, server refusal shown as received, `data-access-*` hooks); pure helper `admin/slices/user/agentAccess/utils/outcome.ts` with `outcome.test.ts`; host it on `admin/slices/user/user/components/user/item/Provider.vue`
- [ ] T067 [P] [US1] Badges "Restricted" / "Needs review" in `admin/slices/user/user/components/user/list/Provider.vue`
- [ ] T068 [P] [US1] App empty state for an account with no agents: keys `agents.no_access_title`, `agents.no_access_body` in `app/slices/agent/i18n/locales/en.json`, `bun run i18n:sync`, the state in `app/slices/agent/pages/agents/index.vue` with `data-agents-empty="no_access"`
- [ ] T069 [US1] `specs/032-agent-user-access/e2e/owner-editor.mjs`, `enforce.mjs`, `deletion.mjs` at 390 px and 1440 px

**Checkpoint**: an installation with one Owner and Users is fully served

---

## Phase 9: User Story 5 - Nothing carries over between accounts in one browser (Priority: P1)

**Goal**: no frame shows the previous account's data

**Independent Test**: Owner chats, signs out, a User signs in in the same tab: no frame shows the Owner's conversation or last agent

### Tests for User Story 5

- [X] T070 [P] [US5] `app/slices/bridle/utils/storageKeys.test.ts` and `admin/slices/bridle/utils/storageKeys.test.ts`: scoped key builders, `share:` keys untouched, the one-time removal of old unscoped console keys
- [X] T071 [P] [US5] `app/slices/bridle/stores/bridle.reset.test.ts`: after `resetForAccount()` no conversation, hydration mark, history mark, seq or channel survives

### Implementation for User Story 5

- [X] T072 [US5] `app/slices/bridle/utils/storageKeys.ts` and its use in `app/slices/bridle/stores/bridle.ts`: `bridle:conversation:<userId>:<key>`, `bridle:seq:<userId>:<key>`; `hydrate` returns without reading until the signed-in id is known; add `resetForAccount()` (close channels, clear every keyed map)
- [X] T073 [P] [US5] `app/slices/agent/composables/useLastAgent.ts`: key `agent:lastOpened:<userId>`; `app/slices/agent/stores/agent.ts` and `app/slices/chat/stores/chat.ts`: `resetForAccount()`
- [X] T074 [US5] `app/slices/user/auth/plugins/accountScope.client.ts`: watch `auth.user?.id`; on a change to another id or to null call each store's `resetForAccount()`, `clearNuxtData()`, remove old unscoped keys once; when a different account signs in from the session-ended dialog, reset before the dialog closes and navigate to `/agents`
- [X] T075 [P] [US5] Admin twin: `admin/slices/bridle/utils/storageKeys.ts`, scoped `bridle:debug:<userId>:<agentId>` and `bridle:outbox:<userId>:<agentId>:<channel>` in `admin/slices/bridle/stores/bridle.ts`, `resetForAccount()` there and in `admin/slices/agent/agent/stores/agent.ts`, `admin/slices/user/agentAccess/stores/agentAccess.ts`, `admin/slices/user/user/stores/user.ts`
- [X] T076 [US5] `admin/slices/user/auth/plugins/accountScope.client.ts`, same behaviour as T074
- [X] T077 [P] [US5] `docs/state.md`: an account change resets every data store; browser-kept keys that hold content or name an agent carry the account id
- [X] T078 [US5] `specs/032-agent-user-access/e2e/switch.mjs`: record frames from "Sign in" to an idle chat and assert no message id or agent of the previous account appears; reload as the same account restores at once; the session-ended dialog path; at 390 px and 1440 px

**Checkpoint**: Stories 1 and 5 are shippable together or apart

---

## Phase 10: User Story 2 - An Admin hands out agents within their own ceiling (Priority: P2)

**Goal**: delegation that cannot exceed the Admin's own reach

**Independent Test**: an Admin limited to A and B edits a User; no sequence of edits lets the User reach C

### Tests for User Story 2

- [X] T079 [P] [US2] `api/src/slices/user/agentAccess/domain/agentAccess.ceiling.spec.ts`: view filtering, carry-over of entries outside the view, `ACCESS_EXCEEDS_CEILING` on emptying the allowed list and on removing a denial, an id outside the view refused as unknown, two simultaneous edits

### Implementation for User Story 2

- [X] T080 [US2] `AgentAccessService.replace` steps 2, 3 and 4 of research R8 in `api/src/slices/user/agentAccess/domain/agentAccess.service.ts`; `hasEntriesOutsideView` and view-limited `allowed` / `denied` in the `GET` response
- [ ] T081 [US2] Editor for an Admin viewer in `admin/slices/user/agentAccess/components/agentAccess/Editor.vue`: only reached agents as rows, the outside-view note, the "who manages this access" line for accounts the viewer may not edit
- [ ] T082 [US2] `specs/032-agent-user-access/e2e/ceiling.mjs` at both widths, including a hand-made request naming agent C

---

## Phase 11: User Story 3 - The Owner limits an Admin (Priority: P3)

**Goal**: a limited Admin works only with their agents in the management console

**Independent Test**: deny agent C for an Admin; as that Admin C is absent from every screen and refused on direct access

- [X] T083 [US3] Creator auto-allow in `POST /agents` (`api/src/slices/agent/agent/agent.controller.ts` → `AgentAccessService`): a limited Admin's new agent joins their allowed list in the same transaction; spec case in `agentAccess.service.spec.ts`
- [ ] T084 [P] [US3] `POST /agents/restart-by-template/:templateId` restarts only reached agents; `GET /agents/admin/current` answers 404 when the admin agent is not reached (`agent.controller.ts`); admin layout hides the assistant entry on that 404 (`admin/slices/common/components/layout/`). API part done (CLEAN-231); the admin layout is left to the consoles work
- [ ] T085 [US3] Walk the admin console as the seeded limited Admin (agents list, search, pins, usage, events, links, chats) and fix any screen that names or counts an unreached agent; add the walk to `specs/032-agent-user-access/e2e/enforce.mjs`

---

## Phase 12: User Story 4 - The same through the Ranch assistant (Priority: P4)

**Goal**: access is viewed and changed in chat under the console's rules

**Independent Test**: change a User's lists through the assistant; the editor shows the same; a change the ceiling forbids gets the same refusal

- [X] T086 [P] [US4] `api/src/slices/user/agentAccess/agentAccess.tool.spec.ts`: listing and refusal per audience, the dry run without `confirm`, the ceiling for an Admin caller, no secret in results
- [X] T087 [US4] `api/src/slices/user/agentAccess/agentAccess.tool.ts`: `get_user_agent_access`, `set_user_agent_access` (`allow` / `deny` / `clear`, `confirm`), audience `admin`, calling `AgentAccessService.replace` as the effective caller
- [X] T088 [US4] Reach in every agent-naming tool: filter with `reachableIds` and check `reaches` for the effective caller in the tool files listed in research R6 (`rancher.tool.ts`, `agentAdmin.tool.ts`, `agentChannel.tool.ts`, `agentEvent.tool.ts`, `file.tool.ts`, `agentLimit.tool.ts`, `peerAdmin.tool.ts`, `secret.tool.ts`, `shareLink.tool.ts`, `templateAdmin.tool.ts`, `chat.tool.ts`, `log.tool.ts`, `usage.tool.ts`, paddock tools)
- [X] T089 [P] [US4] Spec `api/src/slices/mcp/toolReach.spec.ts`: each tool of T088 run as the limited Admin lists only A and B and answers "not found" for C
- [X] T090 [P] [US4] `docs/agent-tools.md`: the two access tools in the capability matrix

---

## Phase 13: User Story 6 - Everyone pins their own agents (Priority: P3)

**Goal**: pins are personal and open to every role

**Independent Test**: as a User pin an agent; it stays on top after a reload; another account's order is unchanged

- [X] T091 [P] [US6] `api/src/slices/agent/pin/agentPin.controller.spec.ts` and `data/agentPin.gateway.spec.ts`: idempotent pin and unpin, 404 for an unreached agent, 403 for a caller that is not a person
- [X] T092 [US6] Sub-slice `api/src/slices/agent/pin/`: module, gateway, `agentPin.controller.ts` (`PUT` / `DELETE /agents/:id/pin`, `@Roles(User)`, `@AgentScoped('id')`); add both routes to `userRoutes.spec.ts`
- [X] T093 [US6] Remove `pinned` from `api/src/slices/agent/agent/dtos/updateAgent.dto.ts`, the gateway write and the domain update type; compute `AgentDto.pinned` for the caller from the pin gateway; update `agent.gateway.spec.ts` and the status fixture
- [X] T094 [US6] Rewrite `pin_agent` in `api/src/slices/agent/agent/agentAdmin.tool.ts` as a `person` tool that pins for the effective caller; update `agentAdmin.tool.spec.ts` and its row in `docs/agent-tools.md`
- [ ] T095 [P] [US6] App: `setPinned` in `app/slices/agent/stores/agent.ts` calls the pin routes; move the pin control out of the `canManage` block in `app/slices/agent/components/agent/workspace/Sheet.vue` and out of `canCreate` in `Rail.vue`; drop `pinned` from `IAgentUpdateInput`
- [ ] T096 [P] [US6] Admin twin: `admin/slices/agent/agent/composables/useAgentPin.ts` calls the pin routes; drop `pinned` from `IUpdateAgentData`
- [ ] T097 [US6] `specs/032-agent-user-access/e2e/pins.mjs` at both widths, with a second browser context for the other account

---

## Phase 14: Polish & Cross-Cutting

- [ ] T098 [P] `specs/032-agent-user-access/e2e/all.mjs` running every script; screenshots to the scratchpad, never the repository
- [ ] T099 Run every command of quickstart.md section 3 and both e2e entry points; record the output in the PR descriptions
- [ ] T100 [P] Update `CLAUDE.md` and `.specify/memory/constitution.md` together where Principle V's wording ("gated to the right audience") now means the party acted for
- [ ] T101 [P] Twin-console statement for each PR: which of `agent`, `bridle`, `user`, `chat` was changed in which console and why the other needed nothing (`share`, `setup`, `common`: checked, unchanged)
- [ ] T102 Bump the root `package.json` version in each Ranch PR that should produce a release tag; after each merge watch `Release Platform` and confirm the tag exists
- [ ] T103 Ticket hygiene: comment on CLEAN-232 and CLEAN-231 at each checkpoint, link each PR, move to In Testing on PR and to Done with the release tag once shipped

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** → Phases 3, 4, 5, 6 (Part A).
- Phase 3 (US7) needs Phase 2. Phase 4 (US8) needs only Phase 1 and T026; it can be built beside Phase 3 and merges after it.
- Phase 5 (US9) needs T015 to T017. Phase 6 (US10) needs Phase 2; T043 needs T018.
- **Phase 7** needs Part A merged (`effectiveCaller`, `canManage`, the global `RolesGuard`).
- Phase 8 (US1) needs Phase 7. Phases 10, 11, 12 need Phase 8. Phase 12 also needs T018.
- Phase 9 (US5) and Phase 13 (US6) need nothing from Phases 7 to 12 except T055 for T093, and T023 for T092.

### Release order inside Part A

1. Runtime PR (T002, T012, T013, T015 to T017, T032 to T035) → release.
2. Ranch "tools" PR (T005 to T011, T014, T018 to T022, T036 to T045) with the runtime version bump → redeploy the admin agent → release.
3. Ranch "routes" PR (T023 to T031) → release.

### Parallel Opportunities

- T002, T003, T004 after T001.
- T007 and T010 beside their implementations; T011, T012, T013 together.
- T019 and T020 beside T018 (different files).
- T023, T024, T025 together; T031 beside T027 to T029.
- In Phase 8: T056, T057, T058, T059 together after T054; T067 and T068 beside T066.
- Phase 9 and Phase 13 beside Phases 8 to 12, by another person.

## Parallel Example: User Story 1

```text
# after T054 (decorator and guard):
T056  agentChannel, toolCatalog, limit, event controllers
T057  file, secret, shareLink, peer controllers
T058  chat controllers
T059  log, usage, paddock, skill, browser controllers

# while the API side settles:
T064  admin agentAccess sub-slice
T065  admin user store repair
```

## Implementation Strategy

### MVP

Part A alone (Phases 1 to 6) is the first thing to ship: it closes a hole
that is open in production today and changes nothing a person is supposed to
be able to do. Within it, Phases 2 and 3 plus the runtime release are the
minimum that stops a User from acting through the assistant; Phase 4 stops
the direct calls.

### Incremental Delivery

1. Part A, three PRs, each released (see the order above).
2. Phase 9 (account switch) and Phase 13 (pins): small, independent, visible
   to every user.
3. Phases 7 and 8: lists, enforcement and the Owner's editor.
4. Phase 10 (ceiling), Phase 11 (limited Admin), Phase 12 (assistant).

## Notes

- Verify each failing test fails before the implementation, and that each
  `*.spec.ts` for a pinned route set fails when a route is added to the set.
- `i18n:sync` needs a working `CLAUDE_API_KEY` in `.env.project`; do not
  hand-write `ru.json`.
- Starting Docker for the local stack: ask first.
- `.specify/feature.json` is not repointed; name
  `specs/032-agent-user-access` explicitly to SpecKit commands.
