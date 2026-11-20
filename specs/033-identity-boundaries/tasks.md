# Tasks: Identity boundaries in chat and consoles

**Input**: Design documents from `specs/033-identity-boundaries/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (colleagues, handover, identity), quickstart.md, a2a-access-analysis.md

**Tests**: included. The contracts name the specs that pin each rule, and the plan makes the scenarios of quickstart.md a condition of done.

**Organization**: by user story, in the delivery order of plan.md: the
runtime first (it is released first), then Part A (Stories 2, 3, 1, 4, 6, 7,
9), Part B (Story 5), Part C (Story 8).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story of spec.md the task serves

## Path Conventions

- `api/`, `admin/`, `app/`, `docs/` are in this repository.
- `runtime:` prefixes a path in the `CleanSlice/runtime` repository (its own
  branch and PR, ticket CLEAN-236).
- Commands: [quickstart.md](./quickstart.md). In `api/` run jest directly,
  never `bun run test` with a dev API up. Never run Prettier or ESLint `--fix`
  over `admin/` or `app/`.
- "The rule" is `peerAccess` ([contracts/colleagues.md](./contracts/colleagues.md) §1).
  A hidden connection is always answered with the text and status of a
  missing one.

---

## Phase 1: Setup

**Purpose**: branches, generated code, a baseline

- [X] T001 Confirm branch `fix/CLEAN-236-identity-boundaries` is on up-to-date `origin/main`; commit the spec folder `specs/033-identity-boundaries/` and `.specify/feature.json` as the first commit (`docs(spec): identity boundaries (CLEAN-236)`)
- [X] T002 [P] Ask where the working clone of `CleanSlice/runtime` lives (it is no longer at `../runtime`); create branch `fix/CLEAN-236-identity-boundaries` there from up-to-date `origin/main`; record the baseline of `bun test` and `bun run build`
- [X] T003 [P] In `api/` run `bun run generate`, `bun run build`, `bun run generate:swagger`; in `admin/` and `app/` run `bun run build:api`; confirm a clean tree afterwards
- [ ] T004 [P] Record the baseline of `NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/peer src/slices/bridle src/slices/user/session src/slices/user/auth src/slices/mcp` in `api/`, and of `bun test slices` in `admin/` and `app/` (known local noise: date-format tests)

---

## Phase 2: Foundational

**Purpose**: the runtime release, the migration, the rule module and the fourth party kind. Everything after this depends on it.

### Runtime (own PR, released before Ranch: research R14)

- [X] T005 [P] runtime: read `admin` and `handover` off a hub message in `src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts` (`readHandover`, next to `readActing`) and add `admin?: boolean`, `handover?: { token: string }` to `Message` in `src/slices/setup/channel/domain/channel.types.ts`
- [X] T006 [P] runtime: add the kind `{ kind: "peer"; token: string }` to `IActor` in `src/slices/setup/mcp/domain/actor.ts`; `actorOf` returns it when the source has a hand-over, ahead of every rule but an actor resolved earlier; `actorLabel` prints `peer`; extend `actor.spec.ts` with the table of contracts/handover.md §3
- [X] T007 runtime: add a pure `turnIsAdmin(msg, senderIsConfiguredAdmin, selfStarted)` to `src/slices/runtime/runtime/domain/turnOrigin.ts` (`msg.admin === true` or a configured admin id, never for a message with `handover`) with cases in `turnOrigin.spec.ts`; use it in `src/slices/runtime/runtime/domain/runtime.service.ts` where `isAdmin` is computed today
- [X] T008 runtime: add a pure `gateFor(msg, { isAdmin, isAllowed })` in a new `src/slices/bot/bot/domain/gate.ts` (returns `colleague` for a message with `handover`, else `admin`, `allowed` or `denied`) with `gate.spec.ts` (no test covers `BotService` today); in `src/slices/bot/bot/domain/bot.service.ts` a `colleague` turn skips the access-code approval, the slash commands and the access check and registers no pending visitor, and the admin auto-approve reads `turnIsAdmin` of T007
- [X] T009 runtime: in `src/slices/setup/mcp/data/mcp.gateway.ts` add `_meta["ranch/turn"] = { client: <msg.from> }` to tool calls of a turn that came over the bridle channel, for Ranch servers only; key the catalogue cache of a peer actor by its token; cover in `src/slices/setup/mcp/data/mcp.gateway.actor.spec.ts`
- [X] T010 runtime: make a delegated worker inherit the peer actor in `src/slices/runtime/loop/domain/delegate.service.ts` (case in `delegate.service.spec.ts`); confirm the hand-over token goes to Ranch MCP servers only (same test that pins it for the acting token)
- [ ] T011 runtime: `bun test` and `bun run build` green; open the PR into `main` with CLEAN-236 in the title, stating that the change is inert against Ranch ≤ 0.3.90

### API

- [X] T012 Add to `api/src/slices/agent/peer/peer.prisma`: `createdById`, `openToVisitors`, `openedById`, `openedAt`, `ownerUserId`, `needsReview`; to `api/src/slices/agent/peer/delegation.prisma`: `forUserId`; to `api/src/slices/user/session/session.prisma`: `surface` (data-model.md)
- [X] T013 Create the migration `api/prisma/migrations/<ts>_identity_boundaries/migration.sql` with `bun run generate` then `npx prisma migrate dev --create-only`: the columns of T012, the backfill of data-model.md, the check constraint, and the two partial unique indexes that replace the one on `(agentId, cardUrl)`
- [X] T014 [P] Carry the new columns through `api/src/slices/agent/peer/domain/peer.types.ts`, `data/peer.mapper.ts`, `domain/peer.gateway.ts`, `data/peer.gateway.ts` (create with `createdById` and `ownerUserId`, `setVisitors`, `findByCardUrl` taking the owner); extend `data/peer.gateway.spec.ts`
- [X] T015 [P] Write `api/src/slices/agent/peer/domain/peerAccess.spec.ts` with the seven rows of contracts/colleagues.md §1, for a person, a guest, a trusted party and a peer party with and without `forUserId`; see it fail
- [X] T016 Implement `api/src/slices/agent/peer/domain/peerAccess.ts`: pure `visibility(row, facts)` and `serves(row, facts)`, and an injectable `PeerAccessService` that gathers the facts (reach through `AgentAccessService`, manage through `AgentPermissionService`, the account of a peer party's `forUserId` read from the database); export it from `domain/index.ts` and provide it in `peer.module.ts`
- [X] T017 [P] Add `{ kind: 'peer'; chain: string[]; connectionId: string; forUserId?: string }` to `ICallerParty` in `api/src/slices/user/auth/domain/auth.types.ts`; in `api/src/slices/mcp/tooling.ts` give it a guest's level, admit it to the `everyone` and `agent` audiences only, refuse it in `requirePerson`; extend `tooling.spec.ts`
- [X] T018 [P] Write `api/src/slices/agent/peer/domain/handover.spec.ts` (mint, verify, wrong audience, wrong connection, expired, not a hand-over token) and implement `domain/handover.ts` with the shape of contracts/handover.md §1, signing with the service acting tokens use

**Checkpoint**: migration applies on a copy of a database with connections; `peerAccess.spec.ts` green; nothing calls the rule yet.

---

## Phase 3: User Story 2 - A connection exists for a person only when they reach the colleague (P1) 🎯 MVP

**Goal**: whoever manages A and does not reach B sees no trace of B and cannot change the connection.

**Independent test**: `e2e/hidden.mjs`: the Admin denied B against A's colleagues, history, roster, a question only B answers, remove and re-read by id, the fleet map and B's public card.

- [X] T019 [P] [US2] In `api/src/slices/agent/peer/peer.controller.spec.ts` add: `GET peers` omits a hidden connection with no gap or count; `DELETE` and `refresh` of a hidden connection answer as a missing id; `GET delegations` omits hand-overs to a hidden colleague
- [X] T020 [P] [US2] In `api/src/slices/agent/peer/peerAdmin.tool.spec.ts` add the same three cases for `list_agent_peers`, `remove_agent_peer`, `refresh_agent_peer`, `list_agent_delegations`
- [X] T021 [P] [US2] In `api/src/slices/agent/peer/askAgent.tool.spec.ts` add: the roster for a caller who does not reach B has no line for B; naming B is answered "No peer matches" with only the served names; the tool is not listed when no connection serves the caller
- [X] T022 [P] [US2] In `api/src/slices/agent/peer/guards/a2a.guards.spec.ts` add: an Admin console token and the card of an agent they do not manage → the `NotFoundException` of an unknown agent; of one they manage → admitted
- [X] T023 [US2] `PeerService.list`, `remove`, `refresh` in `api/src/slices/agent/peer/domain/peer.service.ts` take the party and apply the rule; `toView` gains `visibility`, `canRemove`, `canSetVisitors` and returns the masked shape of data-model.md for a masked row
- [X] T024 [US2] `api/src/slices/agent/peer/peer.controller.ts`: pass the caller to `list`, `remove`, `refresh`; filter `delegations` by the visibility of each row's connection (data-model.md, AgentDelegation); update `dtos/agentPeer.dto.ts` and `dtos/agentDelegation.dto.ts`
- [X] T025 [US2] `api/src/slices/agent/peer/peerAdmin.tool.ts`: the same for the four tools of T020; `toToolPeer` in `toolSupport.ts` renders a masked row without name, id or address
- [X] T026 [US2] `api/src/slices/agent/peer/askAgent.tool.ts`: `isListedForRequest` and `describeForRequest` keep only connections that serve `callerParty(httpRequest)`; `DelegationService.run` in `domain/delegation.service.ts` takes the party, re-checks `serves` at call time and returns `no_match` with the served names only
- [X] T027 [US2] `api/src/slices/agent/peer/guards/a2a.guards.ts`: a console token passes `A2aCardGuard` only when `AgentPermissionService.manageable` admits its person; otherwise throw the not-found `AgentCardService.build` throws
- [X] T028 [P] [US2] `admin/slices/agent/peer/`: regenerate the SDK types; `stores/peer.ts` and `components/peer/Row.vue` render by `visibility` and hide Remove and Re-read when `canRemove` is false; `components/peer/Delegations.vue` renders a masked row without a name
- [X] T029 [US2] Write `specs/033-identity-boundaries/e2e/lib.mjs`, `seed.mjs` (quickstart.md §2) and `hidden.mjs`; run it green

**Checkpoint**: findings 1, 2, 3, 4, 5 and 7 of a2a-access-analysis.md are closed for an ordinary connection.

---

## Phase 4: User Story 3 - A signed-in person connects only the agents they reach (P1)

**Goal**: one rule about the colleague in the chat, through the assistant and in the console; nobody is named an agent they do not reach.

**Independent test**: `e2e/connect.mjs`.

- [X] T030 [P] [US3] In `api/src/slices/agent/peer/peerSelf.tool.spec.ts` add: the seven tools are listed and callable for a person only (guest, trusted and peer parties get `PERSON_REFUSAL`); `list_ranch_agents` names only reached agents and no total; `connect_my_peer` with a hidden id answers as a missing one; the Ranch assistant rule and the kill switch hold
- [X] T031 [P] [US3] In `api/src/slices/mcp/toolAudience.spec.ts` change the pinned audience of the `peerSelf` tools to `person`; in `peerAdmin.tool.spec.ts` add that a trusted party is refused and that the colleague's end asks reach, not manage
- [X] T032 [US3] `api/src/slices/agent/peer/peerSelf.tool.ts`: `@ToolAudience('person')`; `requireSelf` also requires `callerPerson`; drop `isOwnersAgentForSomebodyElse` in favour of the party rules; rewrite the class comment to say the model is the caller's reach, no longer "whoever talks to it"
- [X] T033 [US3] `PeerService.candidates` and `connect` in `api/src/slices/agent/peer/domain/peer.service.ts` take the party: candidates are the agents the person reaches, `connect` refuses an unreached colleague as not found and records `createdById`
- [X] T034 [US3] `api/src/slices/agent/peer/peer.controller.ts` and `peerAdmin.tool.ts`: replace `permission.manageable` on the colleague's end by the reach check of T033 (candidates, `POST peers`, `connect_agent_peer`, `preview_agent_card`); `peerAdmin` tools require a person
- [X] T035 [P] [US3] `admin/slices/agent/peer/components/peer/Picker.vue`: nothing to change in the markup; confirm it renders the narrower candidate list and the unchanged "not found" refusal
- [X] T036 [US3] Write `specs/033-identity-boundaries/e2e/connect.mjs` (chat through `fakeRuntime.mjs`, the assistant's tools, the console route); run it green

**Checkpoint**: finding 6 closed; the reproduction of 2026-11-19 (a User named 23 agents) names only what the User reaches.

---

## Phase 5: User Story 1 - An anonymous caller uses an agent and configures nothing (P1)

**Goal**: no anonymous entry can list, preview, connect or remove.

**Independent test**: `e2e/anonymous.mjs`. Scenario 5 (an open colleague, shown unnamed) needs Phase 7.

- [X] T037 [P] [US1] In `api/src/slices/mcp/services/handlers/mcp-tools.handler.spec.ts` add: a call that states no actor, a guest and a `trusted` messenger administrator are offered none of the `peerSelf` tools and are refused by name with `PERSON_REFUSAL`, which names no agent and no console
- [X] T038 [US1] Confirm in `api/src/slices/mcp/tooling.ts` that `PERSON_REFUSAL` is the text of FR-009 and that no `peerSelf` hint (`SELF_HINTS` in `peerSelf.tool.ts`) is appended for a party that is not a person
- [X] T039 [US1] Write `specs/033-identity-boundaries/e2e/fakeRuntime.mjs` (an agent socket that calls a named tool with a stated actor and echoes what the hub sent, in a 0.35 and a 0.36 mode) and `anonymous.mjs` for a share visitor, an anonymous visitor of a public agent and an embed visitor; run it green

**Checkpoint**: finding 14 closed; SC-001 holds for every entry but the open-colleague case.

---

## Phase 6: User Story 4 - An outside address is never a way to this Ranch's agents (P1)

**Goal**: this installation's address is refused in every spelling; an outside colleague of somebody who does not manage the agent is their own.

**Independent test**: `e2e/outside.mjs`.

- [X] T040 [P] [US4] In `api/src/slices/agent/peer/domain/peer.service.spec.ts` add: every spelling of SC-004 refused with `PeerErrorCodes.SelfUrl` on preview, import, pasted card and refresh; the refusal is identical for an existing and a missing agent id; a redirect is refused
- [X] T041 [P] [US4] In the same spec add: `connectByUrl` and `connectByCard` by a person who manages A make a shared row; by anybody else a personal row (`ownerUserId`); the same address can be connected by two people and shared, as three rows
- [X] T042 [US4] `PeerService.connectByUrl`, `connectByCard`, `previewByUrl` in `api/src/slices/agent/peer/domain/peer.service.ts` take the party; set `createdById` and `ownerUserId`; make the `SelfUrl` message the same whatever the path names; `refresh` of an outside row re-runs the own-address check (already does: pin it)
- [X] T043 [US4] `api/src/slices/agent/peer/peerSelf.tool.ts` (`import_my_peer_by_address`, `connect_my_peer_from_card`, `preview_agent_card_by_address`) and `peer.controller.ts` / `peerAdmin.tool.ts` pass the party; the reply to a personal connection says it serves only the person who added it
- [X] T044 [US4] The rule already hides a personal row from other callers (T016): confirm in `askAgent.tool.spec.ts` that nothing of its card is in another caller's roster, and in `peer.controller.spec.ts` that a manager of A sees it with `createdBy` and can remove it
- [X] T045 [P] [US4] `admin/slices/agent/peer/components/peer/Row.vue`: a personal outside row shows "Only for <name>" and who added it
- [X] T046 [US4] Write `specs/033-identity-boundaries/e2e/outside.mjs` with a local stub that serves a card and one that redirects; run it green

**Checkpoint**: finding 13 closed.

---

## Phase 7: User Story 6 - Opening a colleague to visitors (P2)

**Goal**: the one way a colleague serves people who do not reach it, decided by somebody who manages both agents, shown unnamed.

**Independent test**: `e2e/visitors.mjs`.

- [X] T047 [P] [US6] In `api/src/slices/agent/peer/peer.controller.spec.ts` and `peerAdmin.tool.spec.ts` add the cases of `PUT peers/:peerId/visitors` and `set_agent_peer_visitors`: manages only A → 404; no `confirm` → `PEER_VISITORS_NEEDS_CONFIRM`; outside row → 404; success sets `openedById`, `openedAt` and clears `needsReview`
- [X] T048 [P] [US6] In `api/src/slices/agent/peer/domain/delegationStep.spec.ts` and `askAgent.tool.spec.ts` add the masked forms of contracts/colleagues.md §5: roster line `Colleague N` with the connection id and skills and no description; reply `Reply from a colleague`; step label and detail without a name; structured `delegation` without name or agent id
- [X] T049 [US6] `PeerService.setVisitors` in `api/src/slices/agent/peer/domain/peer.service.ts` (manage on both ends through `AgentPermissionService`, Ranch rows only); route `PUT peers/:peerId/visitors` with `dtos/peerVisitors.dto.ts` in `peer.controller.ts`; pin it in `api/src/slices/agent/agent/guards/agentManage.guard.spec.ts` (48 routes)
- [X] T050 [US6] Tool `set_agent_peer_visitors` in `api/src/slices/agent/peer/peerAdmin.tool.ts` with topic, title, template, `destructive` and `confirm` (contracts/colleagues.md §4); add it to `toolAudience.spec.ts` and `tool-metadata.spec.ts`
- [X] T051 [US6] Masked rendering: `describePeer` in `askAgent.tool.ts`, the reply text in `ask`, `buildDelegationStep` in `domain/delegationStep.ts`, and `matchPeer` resolving a masked row by connection id only
- [X] T052 [P] [US6] `admin/slices/agent/peer/`: a "Open to visitors" switch on a Ranch row, enabled by `canSetVisitors`, with an alert dialog that states what it opens; the masked row ("A colleague outside your access, open to visitors"); the "needs review" badge; `stores/peer.ts` `setVisitors` through `patch()` with a rollback; `data/peer.gateway.ts` and `domain/peer.service.ts`
- [X] T053 [US6] Write `specs/033-identity-boundaries/e2e/visitors.mjs` (API and the admin page at 390 px and 1440 px); add scenario 5 of Story 1 to `anonymous.mjs`; run both green

**Checkpoint**: FR-014 to FR-017 hold; the chain case of Story 6 scenario 6 is completed by Phase 8.

---

## Phase 8: User Story 7 - A handed-over question is a colleague's, not a visitor's (P2)

**Goal**: the token travels with the question; B knows a colleague is asking; every hop asks about the same person; the step goes to the turn that asked.

**Independent test**: `e2e/handover.mjs`. Needs the runtime of T005 to T011 for the real gate; the fake runtime proves the API side in both versions.

- [X] T054 [P] [US7] In `api/src/slices/agent/peer/domain/a2a.server.service.spec.ts` add: a message with no valid pass over a Ranch connection is rejected; the chain is read from the token; two questions served at once keep their own chains and both loop and depth refusals still fire; the hub message carries `handover` and the client id `peer:<connection id>:<ctx>`
- [X] T055 [P] [US7] In `api/src/slices/mcp/services/handlers/mcp-tools.handler.spec.ts` add the party table of contracts/handover.md §4 (a valid peer actor, wrong audience, expired → guest); in `askAgent.tool.spec.ts` add that a peer party is served a colleague only when `forUserId` reaches it or the connection is open
- [X] T056 [P] [US7] In `api/src/slices/agent/peer/domain/delegation.service.spec.ts` add: the step is pushed to the turn of `ranch/turn.client` and to nobody when that client has no running turn; with no hint and two running turns no step is pushed; the row records that client and `forUserId`
- [X] T057 [US7] `DelegationService.run` in `api/src/slices/agent/peer/domain/delegation.service.ts`: mint the token (T018) with `for` from the party and `chain` from the party's chain plus the caller, put it in `metadata.ranch.pass`; write `forUserId`; take the turn from `findActiveTurn(agentId, client)`
- [X] T058 [US7] `api/src/slices/bridle/data/bridle.gateway.ts` and `domain/bridle.gateway.ts`: `findActiveTurn(agentId, clientId?)`; the message to a runtime carries `handover` when given; `api/src/slices/bridle/domain/bridleSync.service.ts` passes it through
- [X] T059 [US7] `A2aServerService.sendMessage` in `api/src/slices/agent/peer/domain/a2a.server.service.ts`: verify the pass against the agent in the path and the connection of the pair credential, check loop and depth on its chain, send with `peerClientId(connectionId, ctx)` and the token; keep the per-agent slot only as the fallback for a call that names no chain; `peer.types.ts` `peerClientId` takes the connection id
- [X] T060 [US7] `api/src/slices/mcp/services/handlers/mcp-tools.handler.ts`: resolve `{ kind: 'peer', token }` into the peer party (verify with `aud` = the calling agent), read `_meta["ranch/turn"].client` onto the request for `ask_agent` alone; `askAgent.tool.ts` passes the party's chain instead of `a2aServer.currentChain`
- [X] T061 [US7] `api/src/slices/agent/peer/domain/a2aTask.store.ts` and `a2a.controller.ts`: a task records its connection and `GetTask` answers `TaskNotFound` to any other (FR-027); extend `a2a.controller.spec.ts`
- [X] T062 [US7] Chat list: `api/src/slices/chat/` list DTO gains `peer: { name? }` for a conversation named `peer:…`, the name only when the caller reaches the asking agent (resolved through the connection id); `admin/slices/chat/utils/chatList.ts` gains the kind `peer`, label `Colleague`, and never prints the id; extend `chatList.test.ts`
- [X] T063 [US7] Write `specs/033-identity-boundaries/e2e/handover.mjs` (fake runtime in both modes: token present and carried, token absent → only open connections; a question telling B to rewire itself; two questions at once; the chain A→B→C closed and open); run it green

**Checkpoint**: findings 9, 10, 11, 12, 15 and 17 closed.

---

## Phase 9: User Story 9 - A connection says who made it (P3)

**Goal**: every colleague is traceable; a person removes what they made.

**Independent test**: `e2e/record.mjs`.

- [X] T064 [P] [US9] In `api/src/slices/agent/peer/domain/peer.service.spec.ts` add: `createdBy` is `{ id, name }`, null with "predates the record" for a row without it, and "account removed" when the account is gone; a person who made a connection removes it without managing A; a User is refused the Owner's
- [X] T065 [US9] `toView` in `api/src/slices/agent/peer/domain/peer.service.ts` resolves `createdBy` and `openedBy` names through the user slice's public gateway; `remove` admits the maker (rule of contracts/colleagues.md §2); `remove_my_peer` in `peerSelf.tool.ts` uses it and keeps `confirm`
- [X] T066 [P] [US9] `admin/slices/agent/peer/components/peer/Row.vue`: "Connected by <name> on <date>" through `#common/utils/format`, "Predates the record" otherwise; the same in the result of `list_agent_peers` and `list_my_peers` (`toToolPeer` in `toolSupport.ts`)
- [X] T067 [US9] Write `specs/033-identity-boundaries/e2e/record.mjs`; run it green

---

## Phase 10: User Story 5 - Every administrator has their own conversation with an agent (P1)

**Goal**: the Owner keeps the shared conversation, each Admin gets their own, a message never joins another person's turn.

**Independent test**: `e2e/conversations.mjs`.

- [X] T068 [P] [US5] In `api/src/slices/bridle/domain/chatIdentity.spec.ts` replace the cases of `clientIdFromJwtPayload` by the table of contracts/identity.md §2 (Owner console token → `admin`; Admin console token → own id, `isAdmin`; embed token with administrator roles → `sub`, `isAdmin`; embed token whose `sub` is an account id or reserved → unusable)
- [X] T069 [P] [US5] In `api/src/slices/bridle/bridle.controller.spec.ts` add the table of contracts/identity.md §3: own channel by default; another channel only with `isAdmin` and manage; an Admin and `channel=admin` of the Ranch assistant → refused; `limitSourceOf` is `operator` for an Admin whose id is not `admin`
- [X] T070 [P] [US5] In `api/src/slices/user/auth/domain/auth.service.spec.ts` add: `mintEmbedToken` refuses a `sub` that is an existing account id or a reserved id with `EMBED_SUB_RESERVED`
- [X] T071 [US5] `api/src/slices/bridle/domain/chatIdentity.ts`: the identity takes the console session into account (`admin` only for a console token of the Owner; the user id for an Admin); the comment above `RESERVED_CLIENT_IDS` and `clientIdFromJwtPayload` rewritten; an account-id check for embed tokens through a function the handlers supply
- [X] T072 [US5] `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`, `bridleAgentWs.handler.ts` and `bridle.controller.ts` (`resolveRequester`, `requireChannelAccess`, `limitSourceOf`, the three `channel ?? 'admin'` defaults, lines of research R8): `isAdmin` from the identity, channel access by the manage rule, own channel as the default
- [X] T073 [US5] `api/src/slices/bridle/data/bridle.gateway.ts`: the message to a runtime carries `admin: true` when the registered client is an administrator (socket and `sendAndAwait` paths)
- [X] T074 [US5] `api/src/slices/chat/myChat.controller.ts` `ownExternalId` (Owner → `admin`, anybody else → `sub`) and `chat.controller.ts` line 198 (sources attached as the caller); the chat list DTO gains `user: { name }` for an account's conversation and for `admin` the Owner's name; extend `myChat.controller.spec.ts`
- [X] T075 [US5] `api/src/slices/user/auth/domain/auth.service.ts` `mintEmbedToken`: the refusal of T070
- [X] T076 [P] [US5] `admin/slices/bridle/stores/bridle.ts` and `components/bridle/Provider.vue`: the channel is the id the hub's `welcome` gave (as `app/slices/bridle/stores/bridle.ts` already does with `hubClientIds`), no literal `admin`; account-scoped storage keys keep working for both ids
- [X] T077 [P] [US5] `admin/slices/chat/utils/chatList.ts` and `chatList.test.ts`: `admin` shows the Owner's name, an account id shows the person's name from the DTO
- [X] T078 [US5] Twin check for `bridle` and `chat` in `app/`: grep `'admin'` and `ownExternalId` in `app/slices/bridle` and `app/slices/chat`, confirm nothing names the shared id, and note the result for the PR
- [X] T079 [US5] Write `specs/033-identity-boundaries/e2e/conversations.mjs` (Owner and Admin in two browser contexts on one agent; a message of one during the other's turn through the fake runtime, which reports the `from` and `admin` it received; the Owner finds the seeded old conversation, the Admin an empty one); run it green

**Checkpoint**: FR-030 to FR-035 hold; with runtime 0.35 an Admin is a signed-in visitor to an agent, never more.

---

## Phase 11: User Story 8 - Each console keeps its own sign-in (P2)

**Goal**: a sign-in belongs to the console it was made in.

**Independent test**: `e2e/consoles.mjs`.

- [X] T080 [P] [US8] In `api/src/slices/user/session/domain/session.service.spec.ts` and `api/src/slices/user/auth/auth.controller.spec.ts` add the table of contracts/identity.md §1: cookie name per console; refresh with the other console's cookie value under this console's name → `SESSION_INVALID`; no header → no session, login 400 `CONSOLE_REQUIRED`; a row with no surface is not renewable; logout clears one cookie; the old `ranch_session` is cleared when seen and never read
- [X] T081 [US8] `api/src/slices/user/session/`: `surface` through `domain/session.types.ts` (cookie name per surface, the header name, `SESSION_SURFACES`), `domain/session.service.ts` (`create`, `refresh` and `revoke` take the surface), `data/session.mapper.ts`, `data/session.gateway.ts`
- [X] T082 [US8] `api/src/slices/user/auth/auth.controller.ts` and `domain/auth.service.ts`: read `X-Ranch-Console` on login, register, refresh and logout; `applySession` sets that console's cookie and clears the old one; `sessionCookieOf(req, surface)`; add the header to the CORS allowed headers in `api/src/main.ts` if a list is stated there
- [X] T083 [P] [US8] `admin/slices/setup/api/plugins/apiBaseUrl.ts`: send `X-Ranch-Console: admin` on every request (constant next to the plugin)
- [X] T084 [P] [US8] `app/slices/setup/api/plugins/api.ts`: send `X-Ranch-Console: app` (same constant name, twin of T083)
- [X] T085 [US8] Twin check for `user/auth` in both consoles: confirm the refresh, login and logout calls go through the configured client (no raw `fetch` without the header), that `SESSION_INVALID` on the first refresh leads to the existing session-ended state, and that `accountScope.client.ts` needs no change; note the result for the PR
- [X] T086 [US8] Write `specs/033-identity-boundaries/e2e/consoles.mjs`: one browser profile, app as a User and admin as the Owner, a forced renewal in each, a reload, a sign-out of one; a session row without a surface ends with the session-ended state; run it green at 390 px and 1440 px

**Checkpoint**: FR-036 to FR-040 hold on one host.

---

## Phase 12: Polish and release

- [ ] T087 [P] `docs/agent-tools.md`: the `peer` party in the table of parties, the changed audiences of the colleague tools, `set_agent_peer_visitors` in the table of tool classes
- [ ] T088 [P] `docs/guides/a2a.md` (who sees and uses a connection, open to visitors, a colleague's question, outside colleagues) and `docs/guides/auth.md` (a sign-in per console, the header, chat identities)
- [ ] T089 [P] `.specify/memory/constitution.md` and `CLAUDE.md`: no rule changes; confirm both still agree with `docs/agent-tools.md` after T087 and say so in the PR
- [X] T090 Write `specs/033-identity-boundaries/e2e/all.mjs`; run every scenario of quickstart.md §4 and every command of §3; fix what fails
- [ ] T091 Regenerate `api/swagger-spec.json` and both console SDKs; `npx nuxt typecheck` in `admin/` and `app/`; `bun run locale:check`, `i18n:check`, `test:scripts` at the root
- [ ] T092 Bump the root `package.json` version; open the Ranch PR into `main` with CLEAN-236, stating which console was checked for each twin slice (T078, T085) and the release order; put the PR link on the ticket
- [ ] T093 Release: merge the runtime PR, tag the runtime release, restart the agents; then merge the Ranch PR and watch `Release Platform`; run quickstart.md §5 on the live installation and report each line

---

## Dependencies

```text
Phase 1 → Phase 2 (runtime T005–T011 ∥ API T012–T018)
Phase 2 → US2 (Phase 3) → US3 (Phase 4) → US1 (Phase 5)
                        → US4 (Phase 6)
                        → US6 (Phase 7) → US7 (Phase 8)
                        → US9 (Phase 9)        (needs T033 and T042 for createdById)
Phase 2 → US5 (Phase 10)   independent of Part A, except T062/T074 share the chat list DTO
Phase 1 → US8 (Phase 11)   independent of everything else but T012/T013
all → Phase 12
```

- US2 is the base of Part A: US3, US4, US6 and US9 change the same service and tool files and build on its signatures.
- US7 needs US6 for the open case and the runtime PR for the real gate.
- US5 and US8 touch other slices and can be built by somebody else at the same time as Part A.

## Parallel examples

- Phase 2: T005, T006 (runtime) with T014, T015, T017, T018 (API).
- Phase 3: the four spec tasks T019 to T022 together, then T023 to T027 in order (one service, its callers), T028 alongside.
- Phases 10 and 11 alongside Phases 3 to 9: T068 to T070 and T080 together; T083 and T084 together.
- Phase 12: T087, T088, T089 together.

## Implementation strategy

1. **MVP**: Phases 1 to 3. The rule module with lists, history, roster,
   removal and the card closes the scenario the user raised (an Admin who
   manages A and does not reach B) and five of the seventeen findings.
2. Phases 4 and 5 close what was reproduced on the live installation (a User
   named every agent) and the anonymous entries. Part A is then safe to ship
   even without visitors and hand-over, at the cost that a public agent's
   colleagues stop serving visitors until Phase 7, except connections the
   migration left open.
3. Phases 6 to 9 complete Part A.
4. Phases 10 and 11 are separate PRs if that reads better in review; both
   need the same migration.
5. The runtime is merged and released before any Ranch PR of this ticket.

## Summary

| Phase | Story | Tasks |
|---|---|---|
| 1 Setup | | T001–T004 (4) |
| 2 Foundational | | T005–T018 (14) |
| 3 | US2 | T019–T029 (11) |
| 4 | US3 | T030–T036 (7) |
| 5 | US1 | T037–T039 (3) |
| 6 | US4 | T040–T046 (7) |
| 7 | US6 | T047–T053 (7) |
| 8 | US7 | T054–T063 (10) |
| 9 | US9 | T064–T067 (4) |
| 10 | US5 | T068–T079 (12) |
| 11 | US8 | T080–T086 (7) |
| 12 Polish | | T087–T093 (7) |
| | | **93** |
