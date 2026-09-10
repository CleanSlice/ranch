# Tasks: Agent-to-agent (A2A) — agent cards, peer agents, and delegation you can see (CLEAN-74)

**Input**: Design documents from `specs/013-a2a-agent-peers/`

**Prerequisites**: plan.md, spec.md, research.md (§1 audit with file refs, §3 decisions R1–R12), data-model.md, contracts/a2a-api.md, quickstart.md

**Tests**: API tests are included (plan: "tests for every new server path"; Jest, colocated `*.spec.ts`, hand-rolled stubs — `knowledge.tool.spec.ts:31-92` and `shareLink.controller.spec.ts:59-195` patterns). Admin has no test runner; verification is `cd admin && bun run build:api && bun run typecheck` plus quickstart.

**Organization**: Grouped by user story. US1 (card + A2A server), US2 (peers in admin), US3 (delegation) and US4 (visible step) are all P1 and together are the demo; US5 (loop/depth + audit) and US6 (demo walkthrough) are P2. Foundational work carries the Prisma models, the A2A types, the MCP listing filter, the bridle sync service and the hub's active-turn tracking because more than one story reads each of them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 … US6 from spec.md
- File paths are repo-relative; API = `api/src/…`, console = `admin/slices/…`

## Path Conventions

- New API slice: `api/src/slices/agent/peer/{peer.prisma, delegation.prisma, peer.module.ts, domain/, data/, dtos/, guards/, peer.controller.ts, a2a.controller.ts, askAgent.tool.ts}` — layout of `api/src/slices/agent/shareLink/`
- Touched API slices: `api/src/slices/mcp/{interfaces/, services/handlers/mcp-tools.handler.ts}`, `api/src/slices/bridle/{domain/, data/bridle.gateway.ts, bridle.controller.ts, bridle.module.ts}`, `api/src/slices/setting/domain/infraConfig.gateway.ts`, `api/src/slices/agent/agent/agent.prisma`, `api/src/app.module.ts`
- New admin slice: `admin/slices/agent/peer/{nuxt.config.ts, index.d.ts, plugins/di.ts, domain/, data/, stores/peer.ts, components/peer/}` — layout of `admin/slices/agent/agentChannel/`
- Touched admin: `admin/slices/agent/agent/components/agent/workspace/{sections.ts, Canvas.vue}`, `admin/slices/agent/agent/composables/useAgentSectionCounts.ts`, `admin/slices/bridle/{stores/bridle.ts, components/bridle/Provider.vue, components/bridle/DelegationStep.vue}`
- Path aliases in API: `#/agent/peer/domain`, `#mcp`; tool import `import { Tool } from '#mcp'`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Env, constants, slice skeleton and the protocol types so every later task has a home.

- [ ] T001 Append to `api/.env.example` with one-line comments: `API_PUBLIC_URL=http://localhost:3333` (URL other agents use to reach this API; falls back to `ranch_api_url`), `A2A_SYNC_TIMEOUT_MS=120000`, `A2A_MAX_CHAIN=3`; mirror `API_PUBLIC_URL` into the env block of `k8s/deploy/30-api.yaml` next to `JWT_EXPIRES_IN`
- [ ] T002 [P] Create the slice skeleton `api/src/slices/agent/peer/` with `domain/index.ts` barrel, `domain/peer.types.ts` holding: `PEER_TOKEN_PREFIX = 'ap_'`, `PEER_TOKEN_BYTES = 32`, `PEER_TOKEN_RE = /^ap_[A-Za-z0-9_-]{43}$/`, `PeerErrorCodes = { Self: 'PEER_SELF', Exists: 'PEER_EXISTS', NotFound: 'PEER_NOT_FOUND', CardUnreachable: 'PEER_CARD_UNREACHABLE', Unauthorized: 'A2A_UNAUTHORIZED' } as const`, `DelegationStatus = 'waiting' | 'answered' | 'failed' | 'rejected'`, `DelegationErrorCodes = { NotRunning: 'PEER_NOT_RUNNING', Timeout: 'PEER_TIMEOUT', RejectedLoop: 'PEER_REJECTED_LOOP', RejectedDepth: 'PEER_REJECTED_DEPTH', Unauthorized: 'PEER_UNAUTHORIZED', Unreachable: 'PEER_UNREACHABLE', Error: 'PEER_ERROR' } as const`, `IAgentPeerData { id, agentId, peerAgentId, token, cardSnapshot: AgentCard, cardUrl, cardReadAt: string, createdAt: string, updatedAt: string }`, `IAgentDelegationData` (every column of data-model §2 with ISO-string dates), `IMatchedSkill { id, name }`; plus an empty `peer.module.ts` shaped like `api/src/slices/agent/shareLink/shareLink.module.ts:21-33` (`forwardRef(() => AgentModule)`)
- [ ] T003 [P] Write `api/src/slices/agent/peer/domain/a2a.types.ts` from research §2 / contracts §1–2 (A2A 1.0 names, no `kind` on parts): `A2A_VERSION = '1.0'`, `A2A_VERSION_HEADER = 'A2A-Version'`, `AgentInterface`, `AgentCapabilities`, `AgentSkill`, `AgentCard`, `A2aPart = { text: string; metadata?; mediaType? } | { raw: string; … } | { url: string; … } | { data: unknown; … }`, `A2aMessage { messageId, role: 'ROLE_USER' | 'ROLE_AGENT', parts, contextId?, taskId?, metadata?, extensions?, referenceTaskIds? }`, `A2aTaskState` string-literal union of the nine `TASK_STATE_*` values, `A2aTaskStatus { state, message?, timestamp }`, `A2aArtifact { artifactId, parts, name?, description?, metadata? }`, `A2aTask { id, contextId, status, artifacts, history, metadata }`, `SendMessageParams { message, configuration?: { acceptedOutputModes?, historyLength?, returnImmediately? }, metadata?, tenant? }`, `SendMessageResult = { task: A2aTask } | { message: A2aMessage }`, `GetTaskParams { id, historyLength? }`, `JsonRpcRequest { jsonrpc: '2.0', id, method, params? }`, `JsonRpcResponse`, `A2aErrorCodes = { ParseError: -32700, InvalidRequest: -32600, MethodNotFound: -32601, InvalidParams: -32602, Internal: -32603, TaskNotFound: -32001, TaskNotCancelable: -32002, PushNotSupported: -32003, Unsupported: -32004, ContentTypeNotSupported: -32005, InvalidAgentResponse: -32006, VersionNotSupported: -32009 } as const`, `RanchTaskMetadata { chain: string[]; reason?: string; rejection?: 'loop' | 'depth'; failure?: 'not_running' | 'timeout'; durationMs? }` and helpers `textOfParts(parts): string` (joins `text` parts with `\n\n`), `hasNonTextPart(parts): boolean`; export from `domain/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence, the four touch points outside the new slice, and the tool-listing filter. Every story reads at least one of these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Add Prisma fragments (depends on T002): `api/src/slices/agent/peer/peer.prisma` — `import { Agent } from "../agent/agent"` and `model AgentPeer { id String @id @default(uuid()); agentId String; agent Agent @relation("AgentPeerCaller", fields: [agentId], references: [id], onDelete: Cascade); peerAgentId String; peerAgent Agent @relation("AgentPeerTarget", fields: [peerAgentId], references: [id], onDelete: Cascade); token String @unique; cardSnapshot Json; cardUrl String; cardReadAt DateTime; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; delegations AgentDelegation[]; @@unique([agentId, peerAgentId]); @@index([agentId]); @@index([peerAgentId]) }`; `api/src/slices/agent/peer/delegation.prisma` — `import { Agent } from "../agent/agent"`, `import { AgentPeer } from "./peer"` and `model AgentDelegation { id String @id @default(uuid()); agentId String; agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade); peerId String?; peer AgentPeer? @relation(fields: [peerId], references: [id], onDelete: SetNull); peerAgentId String; peerName String; contextId String; turnId String?; clientId String?; task String; reason String; matchedSkills Json @default("[]"); status String @default("waiting"); errorCode String?; excerpt String?; startedAt DateTime @default(now()); finishedAt DateTime?; durationMs Int?; @@index([agentId, startedAt]) }`; in `api/src/slices/agent/agent/agent.prisma` add `import { AgentPeer } from "../peer/peer"`, `import { AgentDelegation } from "../peer/delegation"` and the back-relations `peers AgentPeer[] @relation("AgentPeerCaller")`, `peerOf AgentPeer[] @relation("AgentPeerTarget")`, `delegations AgentDelegation[]`
- [ ] T005 Run `cd api && bun run migrate`, rename the generated folder to `api/prisma/migrations/20260910120000_agent_peer_delegation/`, prepend `-- Additive: new tables AgentPeer (directed peer connection + pair credential + card snapshot) and AgentDelegation (audit row per delegated task). Safe on an existing database.`, confirm `bun run generate` succeeds (depends on T004)
- [ ] T006 [P] Add `getApiPublicUrl(): Promise<string>` to `api/src/slices/setting/domain/infraConfig.gateway.ts` and its implementation, following the existing getters' precedence (settings group `infrastructure` name `api_public_url` → env `API_PUBLIC_URL` → the `ranch_api_url` integration value the workflow gateway reads at `api/src/slices/workflow/data/argo-workflow.gateway.ts:195` → `http://localhost:3333`), trailing slash stripped; extend the existing infraConfig spec (or add `infraConfig.gateway.spec.ts`) with the three-level precedence for this key
- [ ] T007 [P] Add `api/src/slices/mcp/interfaces/conditional-listing.interface.ts`: `interface IConditionallyListedTool { isListedForRequest(httpRequest: Request): Promise<boolean> }` + duck-typed `isConditionallyListed(obj): obj is IConditionallyListedTool` (mirror of `dynamic-description.interface.ts:15-25`); export from `api/src/slices/mcp/index.ts` next to `IDynamicallyDescribedTool`
- [ ] T008 Update `api/src/slices/mcp/services/handlers/mcp-tools.handler.ts` (depends on T007): in the `tools/list` handler (`:31-69`) resolve each provider instance and skip the tool when `isConditionallyListed(instance) && !(await instance.isListedForRequest(httpRequest))` (a throw counts as listed, logged at debug like the description fallback at `:54-60`); in the `tools/call` handler (`:107-112`) run the same check before invoking and return `{ content: [{ type: 'text', text: 'Tool "<name>" is not available to this caller.' }], isError: true }` when unlisted
- [ ] T009 Write `api/src/slices/mcp/services/handlers/mcp-tools.handler.spec.ts` (new; construct the handler with a stubbed registry/module-ref in the style of `mcp-registry.service.spec.ts:16-35`): a tool whose `isListedForRequest` resolves `false` is absent from `tools/list` and its `tools/call` returns `isError`; a tool without the method is listed as before; a throwing `isListedForRequest` keeps the tool listed (depends on T008)
- [ ] T010 [P] Extend `api/src/slices/bridle/domain/bridle.types.ts`: on `IBridleThinkingStep` (`:124-133`) add `kind?: 'delegation'` and `delegation?: IBridleDelegationStep` where `IBridleDelegationStep { delegationId: string; peerAgentId: string; peerName: string; matchedSkills: { id: string; name: string }[]; reason: string; task: string; status: 'waiting' | 'answered' | 'failed' | 'rejected'; startedAt: number; durationMs?: number; excerpt?: string }`; add `IActiveTurn { clientId: string; turnId: string; ts: number }`; make the `thinking` member of `IBridleOutgoingEvent` (`:105-119`) carry `turnId`, `step?`, `done?` so API-side emitters need no cast
- [ ] T011 Add `abstract findActiveTurn(agentId: string): IActiveTurn | null` to `api/src/slices/bridle/domain/bridle.gateway.ts` (doc: "most recent turn that has emitted a thinking step and not yet its terminal `done`; null when unknown") and implement in `api/src/slices/bridle/data/bridle.gateway.ts`: a `Map<string, IActiveTurn>` keyed `${agentId} ${clientId}`; in `handleAgentEvent` (`:236-244`) when `data.type === 'thinking'` set the entry on a step event and delete it on `done: true`; delete in `unregisterClient` (`:58`); `findActiveTurn` returns the entry with the greatest `ts` for that agent (depends on T010)
- [ ] T012 Extend `api/src/slices/bridle/data/bridle.gateway.spec.ts` (or create it beside the gateway if absent): `findActiveTurn` is null before any thinking event, set after a step event, updated to the newest of two clients, cleared by `done: true`, cleared by `unregisterClient` (depends on T011)
- [ ] T013 Create `api/src/slices/bridle/domain/bridleSync.service.ts` with `@Injectable() BridleSyncService` over `IBridleGateway`: `sendAndAwait(input: { agentId: string; clientId: string; text: string; parts?: BridlePart[]; attachments?; capabilities?: string[]; isAdmin?: boolean; timeoutMs?: number }): Promise<{ text: string; messageId: string; ts: number; timedOut: boolean }>` — the register-with-private-socket-id / resolve-on-`message`-or-`stream_end` / accumulate-`stream` / timeout / unregister logic lifted verbatim from `api/src/slices/bridle/bridle.controller.ts:341-379` (default timeout 120 000 from env `A2A_SYNC_TIMEOUT_MS` is **not** read here — the caller passes it); `timedOut: true` and `text = chunks.join('')` on timeout; `registerClient` receives the caller's `capabilities` (default `[]`) so a peer conversation never declares `thinking`; export from `domain/index.ts`; provide and export it in `api/src/slices/bridle/bridle.module.ts`
- [ ] T014 Refactor `api/src/slices/bridle/bridle.controller.ts:335-402` (`sendMessageSync`) to call `BridleSyncService.sendAndAwait` with `capabilities: ['streaming']` and map `timedOut` to today's `'Timeout: no response from agent'` text so the HTTP behaviour is byte-identical; keep attachment expansion before the call (depends on T013)
- [ ] T015 Write `api/src/slices/bridle/domain/bridleSync.service.spec.ts` with a hub stub that captures the registered callback: resolves on `message` with `{ text, messageId, ts }`; resolves on `stream_end` with the joined `stream` chunks; times out → `timedOut: true`, callback unregistered with the private socket id; `capabilities` passed through to `registerClient` (depends on T013); run `cd api && bun run test -- bridle.controller` to confirm the existing controller spec still passes after T014
- [ ] T016 Register `PeerModule` in `api/src/app.module.ts` imports next to `ShareLinkModule` and make `peer.module.ts` import `forwardRef(() => AgentModule)`, `TemplateModule`, `SkillModule`, `KnowledgeModule`, `BridleModule`, `SettingModule`; if `SkillModule`/`KnowledgeModule` do not export `ISkillGateway`/`IKnowledgeGateway` yet, add the export in their module files (`api/src/slices/skill/skill.module.ts`, `api/src/slices/reins/knowledge/knowledge.module.ts`) — verify with `cd api && bunx tsc --noEmit` (depends on T002, T005)

**Checkpoint**: `cd api && bun run test -- mcp-tools bridleSync bridle.gateway bridle.controller infraConfig` green; migration applied; app boots with an empty `PeerModule`.

---

## Phase 3: User Story 1 — Every agent has a card that says what it can do (Priority: P1) 🎯 MVP

**Goal**: Build the A2A 1.0 card from agent + template + skills + knowledge bases; serve it at the well-known path behind a credential; answer `SendMessage`/`GetTask` on the JSON-RPC endpoint by running a synchronous bridle conversation.

**Independent Test**: quickstart §3 first block (own card via REST, 401 without credential, card at the well-known path with an owner JWT) and the `SendMessage` curl with B running (completed), stopped (failed at once), and a 3-element chain (rejected).

### Card

- [ ] T017 [P] [US1] Implement `AgentCardService` in `api/src/slices/agent/peer/domain/agentCard.service.ts` over `IAgentGateway`, `ITemplateGateway`, `ISkillGateway`, `IKnowledgeGateway`, `IInfraConfigGateway`: `build(agentId): Promise<AgentCard>` exactly per data-model §3 (`description` fallback chain, `version`, `supportedInterfaces[0] = { url: `${apiPublicUrl}/a2a/agents/${id}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }`, capabilities all false, `text/plain` modes, `skill:*` from `skillGateway.findByIds(template.skillIds)`, `knowledge:*` from `findExistingByIds(agent.knowledgeIds.length ? agent.knowledgeIds : template.defaultKnowledgeIds)`, `securitySchemes.peerBearer`, `securityRequirements`, `provider`); throws `NotFoundException` for an unknown agent; a `cardUrlFor(agentId)` helper returning `${apiPublicUrl}/a2a/agents/${id}/.well-known/agent-card.json`
- [ ] T018 [P] [US1] Write `api/src/slices/agent/peer/domain/agentCard.service.spec.ts` with object-literal gateway stubs: two template skills → two `skill:*` entries with `name = title`, `description = description ?? title`, `tags: ['skill']`; agent `knowledgeIds` non-empty wins over template defaults; missing knowledge ids dropped; empty skills allowed; description falls back to template then to `Ranch agent «name»`; URL absolute and trailing-slash-free; `JSON.stringify(card)` contains no `peer` key; `cardUrlFor` shape (depends on T017)

### A2A server

- [ ] T019 [P] [US1] Implement `A2aTaskStore` in `api/src/slices/agent/peer/domain/a2aTask.store.ts`: `put(task)`, `get(id): A2aTask | null`, TTL `10 * 60_000` ms (constant `A2A_TASK_TTL_MS`), lazy sweep on `get` + `setInterval(60_000).unref()` started in `onModuleInit`, cleared in `onModuleDestroy`
- [ ] T020 [P] [US1] Implement `A2aCardGuard` in `api/src/slices/agent/peer/guards/a2aCard.guard.ts` (pattern `api/src/slices/bridle/guards/bridleChatAuth.guard.ts:58-108`): reads `Authorization: Bearer`; if it matches `PEER_TOKEN_RE` → `IPeerGateway.findByToken`, allow only when `row.peerAgentId === req.params.agentId` and set `req.peer = { peerId: row.id, callerAgentId: row.agentId }`; else `JwtService.verify` and allow only `Owner|Admin` roles (`hasAtLeastRole` from `api/src/slices/user/auth/guards/roles.guard.ts`); any failure → `UnauthorizedException({ code: 'A2A_UNAUTHORIZED', message })`; and `A2aPeerGuard` in `guards/a2aPeer.guard.ts` — same but **only** the `ap_` branch
- [ ] T021 [P] [US1] Write `api/src/slices/agent/peer/guards/a2aCard.guard.spec.ts` and `a2aPeer.guard.spec.ts` (stub pattern `bridleChatAuth.guard.spec.ts:26-55`): no header → 401 `A2A_UNAUTHORIZED`; `ap_` scoped to another agent → 401; `ap_` scoped to `:agentId` → allowed with `req.peer` set; owner JWT → allowed on the card guard, refused on the peer guard; user-role JWT → refused on both (depends on T020)
- [ ] T022 [US1] Implement `A2aServerService` in `api/src/slices/agent/peer/domain/a2a.server.service.ts` over `IBridleGateway`, `BridleSyncService`, `IAgentGateway`, `A2aTaskStore`, `ConfigService`: `sendMessage(agentId, callerAgentId, params: SendMessageParams): Promise<A2aTask>` applying contracts §2.1 in order — `returnImmediately` → throw `A2aRpcError(Unsupported)`; non-text part → `A2aRpcError(ContentTypeNotSupported)`; chain rules **as a pluggable `checkChain(chain, agentId)` that this task implements as a no-op returning null** (US5 fills it); `!isAgentConnected(agentId)` → task `TASK_STATE_FAILED` with status message `peer not running`, `metadata.ranch.failure = 'not_running'` (no hub send); else `sendAndAwait({ agentId, clientId: `peer:${callerAgentId}:${contextId}`, text: textOfParts(parts), capabilities: [], timeoutMs: A2A_SYNC_TIMEOUT_MS })` → `timedOut` → `TASK_STATE_FAILED` `timed out after <s>s` `failure = 'timeout'`; reply → `TASK_STATE_COMPLETED` with one artifact `{ artifactId: 'reply', name: 'reply', parts: [{ text }] }`; every task carries `id = randomUUID()`, `contextId` (given or `ctx-<uuid>`), `status.timestamp` ISO, `history: []`, `metadata.ranch = { chain: [...inbound, agentId], durationMs }`; stores the task; `getTask(id)` → task or `A2aRpcError(TaskNotFound)`; define `class A2aRpcError extends Error { constructor(public code: number, message: string, public data?: unknown) }` in `domain/a2a.types.ts` (depends on T003, T013, T019)
- [ ] T023 [US1] Write `api/src/slices/agent/peer/domain/a2a.server.service.spec.ts` with hub/sync/task-store stubs: `returnImmediately` → `-32004`; `{ raw }` part → `-32005`; offline agent → failed `not_running` and `sendAndAwait` never called; timeout → failed `timeout`; reply → completed, artifact text equals the reply, `clientId` is `peer:<caller>:<ctx>`, `capabilities` empty; `contextId` minted when absent and preserved when given; `chain` extended with the agent id; `getTask` unknown → `-32001` (depends on T022)
- [ ] T024 [US1] Implement `A2aController` in `api/src/slices/agent/peer/a2a.controller.ts` (`@Controller('a2a/agents')`, `@ApiTags('a2a')`, `@ApiExcludeController()` so the SDK does not generate it): `GET :agentId/.well-known/agent-card.json` under `@UseGuards(A2aCardGuard)` returning the raw card; `POST :agentId` under `@UseGuards(A2aPeerGuard)` that (a) checks `A2A-Version` header equals `'1.0'` else JSON-RPC error `-32009`, (b) validates the envelope (`jsonrpc === '2.0'`, string `method`) else `-32600`, (c) dispatches `SendMessage` → `{ result: { task } }`, `GetTask` → `{ result: { task } }`, `CancelTask` → `-32002` if known else `-32001`, every other known A2A method name → `-32004`, unknown → `-32601`, (d) maps `A2aRpcError` to `{ jsonrpc, id, error: { code, message, data } }` and any other throw to `-32603`; **bypass the response envelope** for both routes — check how `api/src/slices/setup/error/response.interceptor.ts:16-19` decides to wrap and add a `@RawResponse()` metadata decorator it honours (or reuse an existing skip mechanism if one is found there) (depends on T017, T020, T022)
- [ ] T025 [US1] Write `api/src/slices/agent/peer/a2a.controller.spec.ts` (`new A2aController(stubs)` + `Reflector` guard-metadata assertions as in `shareLink.controller.spec.ts:21-26`): card route guarded by `A2aCardGuard`, JSON-RPC route by `A2aPeerGuard`; missing/other `A2A-Version` → `-32009`; `SendMessage` returns `{ result: { task } }` unwrapped; `GetTask` unknown → `-32001`; `SendStreamingMessage` → `-32004`; unknown method → `-32601`; an unexpected throw → `-32603`; the raw-response marker is present on both routes (depends on T024)
- [ ] T026 [US1] Wire `peer.module.ts` providers/controllers for this story: `AgentCardService`, `A2aTaskStore`, `A2aServerService`, `A2aCardGuard`, `A2aPeerGuard`, `A2aController`, plus a temporary in-memory `IPeerGateway` stub is **not** allowed — instead implement `IPeerGateway.findByToken` now via T030's gateway if US2 runs first, otherwise mark the card guard's `ap_` branch as depending on T030 and verify the owner-JWT path with quickstart §3 lines 1–4 (depends on T016, T024)

**Checkpoint**: quickstart §3 — own card via `GET /agents/:id/card` is deferred to US2 (REST controller); the well-known card answers 401 without a credential and 200 with an owner JWT; `SendMessage` with an owner JWT is 401 (peer credential only).

---

## Phase 4: User Story 2 — Connect a peer: hand agent A the card of agent B (Priority: P1)

**Goal**: Directed peer connections managed in the admin console: candidates, card preview, connect (mints the credential and reads the card over HTTP), refresh, remove, own-card view.

**Independent Test**: quickstart §3 second block (connect, directed list, self refused, duplicate 409) and the admin Peers tab: add B to A, see skills and read-at, B's tab shows nothing, refresh updates the snapshot, remove clears the list and the credential stops working.

### API

- [ ] T027 [P] [US2] Define `abstract class IPeerGateway` in `api/src/slices/agent/peer/domain/peer.gateway.ts`: `listByAgent(agentId): Promise<IAgentPeerData[]>`, `findById(id)`, `findByPair(agentId, peerAgentId)`, `findByToken(token)`, `create(input: { agentId, peerAgentId, token, cardSnapshot, cardUrl, cardReadAt })`, `updateSnapshot(id, { cardSnapshot, cardUrl, cardReadAt })`, `delete(id)`; and `abstract class IDelegationGateway` in `domain/delegation.gateway.ts`: `create(input)`, `finish(id, { status, errorCode?, excerpt?, finishedAt, durationMs })`, `listRecent(agentId, limit)`; export both from `domain/index.ts`
- [ ] T028 [P] [US2] Implement `PeerMapper` (`data/peer.mapper.ts`) and `DelegationMapper` (`data/delegation.mapper.ts`) — Prisma record → domain data with ISO strings, the only files importing `@prisma/client` types (pattern `shareLink.mapper.ts`)
- [ ] T029 [US2] Implement `PeerGateway extends IPeerGateway` in `api/src/slices/agent/peer/data/peer.gateway.ts` and `DelegationGateway` in `data/delegation.gateway.ts` over `PrismaService` (`prisma.agentPeer.*`, `prisma.agentDelegation.*`), `listByAgent` ordered by `createdAt asc`, `listRecent` ordered by `startedAt desc` with `take: limit` (depends on T027, T028)
- [ ] T030 [US2] Write `api/src/slices/agent/peer/data/peer.gateway.spec.ts` with a `makePrismaStub()` (pattern `shareLink.gateway.spec.ts:7-70`) enforcing `@unique token` and `@@unique([agentId, peerAgentId])` (throw `{ code: 'P2002' }`): create/findByPair/findByToken round-trips, `updateSnapshot` changes only the three fields, `delete`; and `data/delegation.gateway.spec.ts`: `finish` sets status/finishedAt/durationMs, `listRecent` newest first and limited (depends on T029)
- [ ] T031 [US2] Implement `A2aClient` (card half) in `api/src/slices/agent/peer/domain/a2a.client.ts`: `fetchCard(cardUrl, token): Promise<AgentCard>` using global `fetch` with `Authorization: Bearer <token>`, `Accept: application/json`, a 10 s `AbortSignal.timeout`; non-2xx → `PeerCardUnreachableError(status, bodyExcerpt)`; malformed JSON or missing `name`/`skills`/`supportedInterfaces` → same error with reason; network error → same; define the error class in `domain/peer.types.ts`
- [ ] T032 [US2] Implement `PeerService` in `api/src/slices/agent/peer/domain/peer.service.ts` over `IPeerGateway`, `IAgentGateway`, `AgentCardService`, `A2aClient`: `list(agentId)` → peers joined with the live peer agent (`peerName`, `peerStatus`, `peerExists`); `candidates(agentId)` → every other agent `{ id, name, status, connected }`; `ownCard(agentId)` → `AgentCardService.build`; `connect(agentId, peerAgentId)` → refuse self (`BadRequestException({ code: PEER_SELF })`), unknown peer agent (`NotFoundException({ code: PEER_NOT_FOUND })`), duplicate (`ConflictException({ code: PEER_EXISTS })`); mint `ap_` + `randomBytes(32).toString('base64url')` (pattern `shareLink.service.ts:152`); **create the row first** (so the credential exists), then `fetchCard(cardUrlFor(peerAgentId), token)`; on failure delete the row and throw `BadGatewayException({ code: PEER_CARD_UNREACHABLE, message })`; on success `updateSnapshot`; `refresh(agentId, peerId)` → fetch with the row's token, keep the old snapshot and rethrow `502` on failure; `remove(agentId, peerId)` → 404 if the row's `agentId` differs; the returned data never includes `token` (strip in a `toPublic()` helper) (depends on T017, T027, T031)
- [ ] T033 [US2] Write `api/src/slices/agent/peer/domain/peer.service.spec.ts` with in-memory gateway stubs and a `fetchCard` jest.fn: token format `^ap_[A-Za-z0-9_-]{43}$`; self → `PEER_SELF`; duplicate → `PEER_EXISTS`; connect with a failing card fetch leaves **no** row and throws `PEER_CARD_UNREACHABLE`; connect success stores the snapshot and `cardReadAt`; refresh failure keeps the old snapshot; remove on a foreign row → 404; `list` output has no `token` key; `candidates` excludes the agent itself and marks connected ones (depends on T032); also write `domain/a2a.client.spec.ts` with a mocked `global.fetch`: 200 JSON → card; 401 → unreachable with status; timeout/abort → unreachable
- [ ] T034 [P] [US2] Create DTOs in `api/src/slices/agent/peer/dtos/`: `agentCard.dto.ts` (`AgentCardDto` mirroring `AgentCard` with `@ApiProperty` — nested `AgentSkillDto`, `AgentInterfaceDto`, `AgentCapabilitiesDto`), `agentPeer.dto.ts` (`AgentPeerDto { id, agentId, peerAgentId, peerName, peerStatus, peerExists, card: AgentCardDto, cardUrl, cardReadAt, createdAt }`), `agentPeerCandidate.dto.ts` (`{ id, name, status, connected }`), `connectPeer.dto.ts` (`@IsUUID() peerAgentId`), `agentDelegation.dto.ts` (`{ id, peerAgentId, peerName, task, reason, status, errorCode, excerpt, startedAt, finishedAt, durationMs }`), `listDelegations.query.dto.ts` (`@IsOptional() @IsInt() @Min(1) @Max(100) limit = 20`), `index.ts`
- [ ] T035 [US2] Implement `PeerController` in `api/src/slices/agent/peer/peer.controller.ts` (`@Controller('agents/:agentId')`, `@ApiTags('peers')`, `@ApiBearerAuth()`, class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Owner, Admin)`): `GET peers` `listAgentPeers`, `GET peers/candidates` `listAgentPeerCandidates`, `GET card` `getAgentCard`, `POST peers` `connectAgentPeer` (201), `POST peers/:peerId/refresh` `refreshAgentPeer`, `DELETE peers/:peerId` `removeAgentPeer` (204), `GET delegations` `listAgentDelegations` (reads `IDelegationGateway.listRecent`; returns `[]` until US5 writes rows) — `@ApiOperation({ operationId })` and `@ApiOkResponse({ type })` on each (pattern `shareLink.controller.ts:76-84`) (depends on T032, T034)
- [ ] T036 [US2] Write `api/src/slices/agent/peer/peer.controller.spec.ts` (`new PeerController(serviceStub)` + `Reflector` metadata: guards, roles, HTTP codes on every route; `ConnectPeerDto` validated via `plainToInstance` + `validate`; a "poisoned" service stub carrying `token` proves no DTO leaks it — pattern `shareLink.controller.spec.ts:243-259`) (depends on T035)
- [ ] T037 [US2] Complete `peer.module.ts` providers (`PeerMapper`, `DelegationMapper`, `{ provide: IPeerGateway, useClass: PeerGateway }`, `{ provide: IDelegationGateway, useClass: DelegationGateway }`, `A2aClient`, `PeerService`) and controllers (`PeerController`); then regenerate: `cd api && bun run build && bun run generate:swagger`, `cd admin && bun run build:api` — confirm the seven `operationId`s appear in `admin/slices/setup/api/data/repositories/api/sdk.gen.ts` (depends on T029, T035)

### Admin

- [ ] T038 [P] [US2] Create the admin slice skeleton `admin/slices/agent/peer/`: `nuxt.config.ts` (alias `'#peer'`, `imports.dirs: ['<dir>/stores']`, i18n module + empty `i18n/locales/en.json` — copy of `admin/slices/agent/agentChannel/nuxt.config.ts`), `index.d.ts` declaring `$peerService: PeerService` on `NuxtApp`, `domain/peer.types.ts` (`IAgentPeer`, `IAgentPeerCandidate`, `IAgentCard`, `IAgentSkill`, `IAgentDelegation` — plain interfaces mirroring the DTOs), `domain/index.ts`
- [ ] T039 [US2] Implement `admin/slices/agent/peer/data/peer.gateway.ts` (`extends BaseGateway`, generated `PeersService` from `#api/data`, every call inside `this.execute` + `unwrapEnvelope` — pattern `admin/slices/agent/agent/data/agent.gateway.ts:50-55`): `list(agentId)`, `candidates(agentId)`, `card(agentId)`, `connect(agentId, peerAgentId)`, `refresh(agentId, peerId)`, `remove(agentId, peerId)`, `delegations(agentId, limit)`; `domain/peer.service.ts` pass-through; `plugins/di.ts` providing `$peerService` (pattern `admin/slices/agent/agent/plugins/di.ts:11-28`) (depends on T037, T038)
- [ ] T040 [US2] Implement Pinia store `admin/slices/agent/peer/stores/peer.ts` (`defineStore('peer', () => …)` setup style, `createServiceGetter<PeerService>('$peerService')`): state keyed by agent id — `peers`, `candidates`, `ownCard`, `delegations`, `loading`, `error: string | null`; actions `load(agentId)` (peers + own card, `Promise.allSettled`), `loadCandidates(agentId)`, `previewCard(peerAgentId)` (calls `card(peerAgentId)`), `connect(agentId, peerAgentId)`, `refresh(agentId, peerId)`, `remove(agentId, peerId)`, `loadDelegations(agentId)`; `connect`/`refresh`/`remove` call `useAgentStore().markPendingRestart()` on success (pattern `agentChannel/components/agentChannel/Provider.vue:132-167`); errors become inline strings from the API `message` (depends on T039)
- [ ] T041 [P] [US2] Create `admin/slices/agent/peer/components/peer/CardView.vue`: props `{ card: IAgentCard; compact?: boolean }` — name, description, a `Badge variant="outline"` per skill with the description in `title`, tags rendered as a muted suffix (`skill` / `knowledge`), the interface URL in a `font-mono text-xs` line; "No skills advertised" line when `skills` is empty (pattern `overview/KnowledgeCard.vue`)
- [ ] T042 [P] [US2] Create `admin/slices/agent/peer/components/peer/Row.vue`: props `{ peer: IAgentPeer; busy?: boolean }`, emits `refresh`, `remove` — name (link to `/agents/<peerAgentId>`), status pill using `AGENT_STATUS_VARIANT` from `admin/slices/agent/agent/utils/agentFormat.ts`, skill badges (first 4 + "+n"), `cardReadAt` via the existing `TimeAgo` component (`admin/slices/common/components/date/TimeAgo.vue`), a `DropdownMenu` with Refresh card / Remove; when two peers in the list share an identical `description` show an amber "indistinguishable from «X»" note (spec edge case) — the comparison is done by the parent and passed as `warning?: string`
- [ ] T043 [US2] Create `admin/slices/agent/peer/components/peer/Picker.vue`: props `{ agentId: string }`, emits `connected` — loads candidates via the store; a filter `Input` when > 6 candidates; rows with name + status + "connected" badge (disabled when connected or when `id === agentId`); selecting a row calls `previewCard` and shows `CardView` below with **Connect** / **Cancel** buttons; connect error inline; on success emits `connected` (depends on T040, T041)
- [ ] T044 [US2] Create `admin/slices/agent/peer/components/peer/Tab.vue`: props `{ agent: IAgentData }`; sections in a `flex flex-col gap-6`: (1) `Card` "Agent card" with `CardView :card="ownCard"` and a one-line explainer "What other agents read about this agent. Built from its name, description, template skills and knowledge bases."; (2) `Card` "Peers" with an **Add peer** button toggling `Picker`, the `Row` list (Skeleton while loading, dashed empty state "No peers yet. Connect another agent's card to let this agent delegate tasks to it."), a `ConfirmDialog` (`admin/slices/common/components/confirm/Dialog.vue`) on remove, and the note "Changes apply after the agent restarts." when `agentStore.pendingRestart` is set; (3) placeholder `Delegations` section rendered only when the store has rows (component arrives in US5); `onMounted` → `store.load(agent.id)` (depends on T040, T042, T043)
- [ ] T045 [US2] Register the tab: add `{ value: 'peers', title: 'Peers', desc: 'Other agents this one can delegate to', countKey: 'peers', primary: true }` after `knowledge` in `admin/slices/agent/agent/components/agent/workspace/sections.ts` `AGENT_TABS`, extend `SectionCountKey` with `'peers'`; add the `v-else-if="tab === 'peers'"` branch mounting `<PeerTab :agent="agent" />` in `workspace/Canvas.vue:56-116`; add a `peers` loader (`peerStore.list(agent.id).length`) to `admin/slices/agent/agent/composables/useAgentSectionCounts.ts:46-75` under the same `allSettled`/`catch(() => null)` shape (depends on T044)
- [ ] T046 [US2] `cd admin && bun run build:api && bun run typecheck`; then run quickstart §3 second block and the admin part of the US2 independent test locally (depends on T045)

**Checkpoint**: A can hold B's card; B's tab is empty; refresh/remove work; the credential stops working after remove (the well-known card returns 401 for the old `ap_`).

---

## Phase 5: User Story 3 — Agent A delegates to peer B and answers with the result (Priority: P1)

**Goal**: The `ask_agent` MCP tool, listed only for agents with peers, whose description lists the peers' snapshot skills; it runs a delegation over HTTP to the peer's JSON-RPC endpoint and returns the reply or an explicit failure the model cannot mistake for an answer.

**Independent Test**: spec Story 3 — B with a knowledge base, connected to A; ask A about the topic → A answers with the fact and names B; stop B → A says B could not be reached.

- [ ] T047 [US3] Implement the message half of `A2aClient` in `api/src/slices/agent/peer/domain/a2a.client.ts`: `sendMessage(interfaceUrl, token, params: SendMessageParams, timeoutMs): Promise<A2aTask>` — POST JSON-RPC `{ jsonrpc: '2.0', id: <uuid>, method: 'SendMessage', params }` with `Authorization: Bearer`, `A2A-Version: 1.0`, `Content-Type: application/json`, `AbortSignal.timeout(timeoutMs + 5_000)`; HTTP 401/403 → `DelegationError(Unauthorized)`; other non-2xx or network/abort → `DelegationError(Unreachable, detail)`; JSON-RPC `error` → `DelegationError(Error, error.message)`; result without `task` → `DelegationError(Error, 'peer returned a message, not a task')`; define `class DelegationError extends Error { constructor(public code: DelegationErrorCode, message) }` in `peer.types.ts` (depends on T031)
- [ ] T048 [US3] Extend `api/src/slices/agent/peer/domain/a2a.client.spec.ts` with a mocked `global.fetch` for `sendMessage`: sends the three headers and the envelope; 401 → `PEER_UNAUTHORIZED`; 500 → `PEER_UNREACHABLE`; JSON-RPC error → `PEER_ERROR` with the message; `{ result: { task } }` → the task (depends on T047)
- [ ] T049 [US3] Implement `DelegationService` in `api/src/slices/agent/peer/domain/delegation.service.ts` over `IPeerGateway`, `IDelegationGateway`, `A2aClient`, `IBridleGateway`, `ConfigService`: `run(input: { callerAgentId; peer: string; task: string; reason: string; contextId?: string; inboundChain: string[] }): Promise<IDelegationOutcome>` — resolve the peer among `listByAgent(callerAgentId)` by id or case-insensitive `cardSnapshot.name` (no match → outcome `{ kind: 'no_match', peers }`); compute `matchedSkills` = snapshot skills whose `name` or `description` shares a word (≥ 4 letters, case-insensitive) with `reason`+`task`, capped at 3, falling back to the first skill; `contextId = input.contextId ?? 'ctx-' + uuid`; **create the delegation row (`waiting`)**; call the step emitter hook `onStart(row, matchedSkills)` (no-op until US4); `sendMessage(snapshot.supportedInterfaces[0].url, row.token, { message: { messageId: uuid, role: 'ROLE_USER', parts: [{ text: task }], contextId, metadata: { ranch: { chain: [...inboundChain, callerAgentId], reason } } }, configuration: { acceptedOutputModes: ['text/plain'], returnImmediately: false } }, timeoutMs)`; map the returned task: `TASK_STATE_COMPLETED` → `answered` with `text = textOfParts(artifacts[0].parts)` and `excerpt = text.slice(0, 300)`; `TASK_STATE_REJECTED` → `rejected` with `errorCode` from `metadata.ranch.rejection` (`loop` → `PEER_REJECTED_LOOP`, `depth` → `PEER_REJECTED_DEPTH`) and `excerpt = status.message text`; `TASK_STATE_FAILED` → `failed` with `errorCode` from `metadata.ranch.failure` (`not_running` → `PEER_NOT_RUNNING`, `timeout` → `PEER_TIMEOUT`, else `PEER_ERROR`); a thrown `DelegationError` → `failed` with its code; **finish the row exactly once**; call `onFinish(row)`; return `{ kind: 'done', status, text?, errorCode?, excerpt, peerName, contextId, durationMs }`; `inboundChain` is resolved by the caller (T051) (depends on T027, T047)
- [ ] T050 [US3] Write `api/src/slices/agent/peer/domain/delegation.service.spec.ts`: peer matched by id and by name (case-insensitive); no match → `no_match` with the peer names; row created `waiting` **before** `sendMessage` is invoked (assert call order with a shared array); completed → `answered`, excerpt ≤ 300 chars, row finished with `durationMs`; rejected loop/depth → codes; failed not_running/timeout → codes; thrown `DelegationError` → `failed` with its code and the row still finished; `chain` sent = `[...inbound, caller]`; `contextId` reused when given (depends on T049)
- [ ] T051 [US3] Implement `AskAgentTool` in `api/src/slices/agent/peer/askAgent.tool.ts` (`@Injectable`, implements `IDynamicallyDescribedTool` and `IConditionallyListedTool`): `extractAgentId(req)` (copy of `knowledge.tool.ts:169-175`); `isListedForRequest` → agent principal with ≥ 1 peer; `describeForRequest` → contracts §4 dynamic text built from `listByAgent` snapshots (name, peer id, description, `Skills: name (description); …`), `null` when no peers; `@Tool({ name: 'ask_agent', description: <static text from contracts §4>, parameters: z.object({ peer, task, reason, context_id }) })` method `ask(args, _ctx, req)` — non-agent → `err('ask_agent can only be called by an agent runtime.')`; validate `args` with the zod schema (`safeParse`, first issue message on failure); `inboundChain`: read from the caller's **own** in-flight delegation context — a `Map<agentId, string[]>` on `A2aServerService` set for the duration of `sendAndAwait` (`enterChain(agentId, chain)` / `exitChain`), `[]` when absent; call `DelegationService.run`; render results exactly as contracts §4 (success text with name, `context_id`, seconds; `isError` texts for failed/rejected/no_match, each ending with the "do not guess on its behalf" instruction); register the tool in `peer.module.ts` providers (depends on T008, T022, T049)
- [ ] T052 [US3] Write `api/src/slices/agent/peer/askAgent.tool.spec.ts` (harness pattern `knowledge.tool.spec.ts:31-92`, request `{ user: { sub: 'agent:a' } }`): not listed / listed by peer count; `describeForRequest` lists two peers with skills and returns `null` for none; a user principal → `isError`; missing `reason` → `isError` with the zod message; `answered` → text contains reply, name, `context_id`; `failed` `PEER_NOT_RUNNING` → `isError` text contains "peer not running" and "do not guess"; `rejected` → "refused the task"; `no_match` → lists the peers; `inboundChain` forwarded when the caller is mid-delegation (depends on T051)
- [ ] T053 [US3] Add `enterChain/exitChain` bookkeeping to `A2aServerService.sendMessage` around `sendAndAwait` (try/finally) and cover it in `a2a.server.service.spec.ts`; then run `cd api && bun run test -- peer agentCard a2a askAgent` and the spec Story 3 independent test locally with two agents (restart A after connecting B — research R7) (depends on T022, T051)

**Checkpoint**: A answers a topic-X question with B's fact and names B; with B stopped, A says it could not reach B. No visible step yet — that is US4.

---

## Phase 6: User Story 4 — The person watching sees the delegation happen (Priority: P1)

**Goal**: A structured delegation step in the caller's thinking timeline, pushed at start and at finish with the same id, rendered with a dedicated layout in the admin chat and as a plain step elsewhere.

**Independent Test**: spec Story 4 — trigger a delegation while watching A's admin chat: "Asking «B»" with skill badges, reason, task and a running timer appears before the answer, then turns into "Answered by «B»" with duration and excerpt; a failed delegation ends as "Could not reach «B»" with the cause; the collapsed block re-expands with the step intact.

- [ ] T054 [P] [US4] Implement `api/src/slices/agent/peer/domain/delegationStep.ts`: `buildDelegationStep(row: IAgentDelegationData, matchedSkills, phase: 'start' | 'finish'): IBridleThinkingStep` — `id: 'delegation:' + row.id`; `label` `Asking «name»` / `Answered by «name»` / `Could not reach «name»` / `«name» refused the task`; `state` `active`/`done`; `kind: 'delegation'`; `delegation` per data-model §5 (`startedAt` epoch ms, `durationMs`, `excerpt`); `detail` markdown per contracts §5 (`**Peer:** … — skills`, `**Why:**`, `**Task:**`, `**Status:** waiting…` or `answered in 3.1s` + excerpt or `failed: cause`); a `causeText(errorCode)` map to product wording (`peer not running`, `timed out after Ns`, `would loop`, `too deep`, `not authorised`, `could not be reached`, `error`)
- [ ] T055 [P] [US4] Write `api/src/slices/agent/peer/domain/delegationStep.spec.ts`: ids stable across phases; labels per status; `state` active on start and done on finish; `detail` contains peer, why, task and, on finish, the excerpt or cause; `kind`/`delegation` present (depends on T054)
- [ ] T056 [US4] Wire the emitter into `DelegationService` (`domain/delegation.service.ts`): on `run`, `const turn = hub.findActiveTurn(callerAgentId)`; store `turnId`/`clientId` on the row when known; `onStart` → `hub.sendToClient(turn.clientId, callerAgentId, { type: 'thinking', clientId: turn.clientId, turnId: turn.turnId, ts: Date.now(), step: buildDelegationStep(row, skills, 'start') })`; `onFinish` → same with `'finish'`; when `turn` is null push nothing and log at debug `no active turn for <agentId>, delegation step not shown`; never send `done: true` (depends on T049, T054)
- [ ] T057 [US4] Extend `api/src/slices/agent/peer/domain/delegation.service.spec.ts`: with an active turn two `sendToClient` calls with the same `step.id`, first `active`/`waiting`, second `done`/final status, `turnId` and `clientId` from `findActiveTurn` and persisted on the row; with no active turn zero calls and the delegation still completes; no call carries `done: true` (depends on T056)
- [ ] T058 [P] [US4] Mirror the type in `admin/slices/bridle/stores/bridle.ts:64-69`: add `kind?: 'delegation'` and `delegation?: IBridleDelegationStep` (same fields as T010) to `IBridleThinkingStep`; no store logic change (steps already replace by id at `:580-585`)
- [ ] T059 [US4] Create `admin/slices/bridle/components/bridle/DelegationStep.vue`: props `{ step: IBridleThinkingStep }` (with `step.delegation` required by a guard in the parent); layout — a peer icon (`IconUsers` from `@tabler/icons-vue`) + `label`; a row of `Badge variant="outline"` for `matchedSkills`; "Why: <reason>" in `text-muted-foreground`; the task in a `border-l-2 pl-3 italic` quote; a status pill (`waiting` amber + shimmer, `answered` green, `failed`/`rejected` red) with elapsed time — while `waiting`, a `useIntervalFn(…, 250)` (`@vueuse/core`) ticks `Date.now() - startedAt` formatted `s.s s`; after, `durationMs`; the `excerpt` (answered) or cause (failed/rejected) as a final line; respects `prefers-reduced-motion` like the existing shimmer (depends on T058)
- [ ] T060 [US4] In `admin/slices/bridle/components/bridle/Provider.vue:574-604` render `<BridleDelegationStep v-if="s.kind === 'delegation' && s.delegation" :step="s" />` in place of the label/detail row for that step, keeping the existing row for every other step; ensure the block-level "is thinking…" shimmer and collapse behaviour are untouched; `cd admin && bun run typecheck` (depends on T059)
- [ ] T061 [US4] Run the spec Story 4 independent test locally (quickstart §4 steps 4–7) and record on the ticket whether the runtime emitted a step before `ask_agent` ran (research §4 risk); if the step never appears although the delegation succeeded, note the `_meta.turnId` follow-up on the ticket (depends on T056, T060)

**Checkpoint**: The demo's visible half works end to end in the admin chat; generic surfaces show "Asking «B»" with the markdown detail.

---

## Phase 7: User Story 5 — Delegation cannot run away (Priority: P2)

**Goal**: Loop and depth refusal on the receiving side of every hop, and the audit trail readable in the admin console.

**Independent Test**: spec Story 5 — A→B and B→A connected; B's attempt to call A back is refused with "would loop" and B answers alone; a chain beyond 3 hops is refused with "too deep"; A's Peers tab lists the delegations with peer, time, duration and outcome.

- [ ] T062 [US5] Implement `checkChain(chain: string[], agentId: string): { rejection: 'loop' | 'depth'; message: string } | null` in `api/src/slices/agent/peer/domain/a2a.server.service.ts` (replacing the US1 no-op): `chain.includes(agentId)` → `loop`, `would loop: <agent name> is already in the chain`; `chain.length >= A2A_MAX_CHAIN` (env, default 3) → `depth`, `too deep: chain limit is <n> hops`; on rejection build a task `TASK_STATE_REJECTED` with `status.message = { messageId, role: 'ROLE_AGENT', parts: [{ text }] }`, `metadata.ranch.rejection`, no artifacts, **before** the `isAgentConnected` check and without touching the hub (depends on T022)
- [ ] T063 [US5] Extend `api/src/slices/agent/peer/domain/a2a.server.service.spec.ts`: chain containing the agent → rejected `loop`, `sendAndAwait` not called; chain of 3 → rejected `depth`; chain of 2 → proceeds; `A2A_MAX_CHAIN=1` respected; the rejection message names the agent (depends on T062)
- [ ] T064 [P] [US5] Create `admin/slices/agent/peer/components/peer/Delegations.vue`: props `{ agentId: string }`; loads `store.loadDelegations(agentId)` on mount and exposes a **Refresh** button; `Table` with columns Peer (link), Task (truncated with `title`), Outcome (status pill + `errorCode` in product wording via a small map), Started (`TimeAgo`), Duration (`s.s s`); dashed empty state "No delegations yet."; mount it as section (3) of `components/peer/Tab.vue` unconditionally (depends on T040, T044)
- [ ] T065 [US5] `cd admin && bun run typecheck`; run quickstart §6 (loop, live) and check A's and B's Recent delegations show the `answered` and `rejected` rows (depends on T062, T064)

**Checkpoint**: Loops and depth are refused server-side; the audit list is visible.

---

## Phase 8: User Story 6 — The demo: two agents, one card, one question (Priority: P2)

**Goal**: A repeatable five-minute walkthrough, verified locally and once in-cluster.

**Independent Test**: quickstart §4 followed step by step on a fresh installation without improvisation; §5 once on the dev cluster.

- [ ] T066 [US6] Run quickstart §4 steps 1–9 end to end locally; fix anything that needs improvisation (copy, empty states, restart hint timing) in the files it points to; record timings for SC-001 and SC-003 on the ticket
- [ ] T067 [US6] Run quickstart §5 on the dev cluster: set `API_PUBLIC_URL` (or the `infrastructure/api_public_url` setting) to the in-cluster API URL, repeat §4 steps 3–5, confirm the card URL is reachable from the API pod and the delegation completes; note the result on the ticket (depends on T066)
- [ ] T068 [P] [US6] Add a short "Peers and A2A" section to `README.md` under the agent slices list (`api/src/slices/agent/peer` — what a card is, how to connect a peer, the restart-to-apply note, the `API_PUBLIC_URL` variable) and list the env vars in `docs/operations/` if an env reference exists there

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T069 [P] Lint and format: `cd api && bun run lint && bun run format`; confirm `cd api && bun run test` is fully green (not only the filtered runs) and `cd admin && bun run typecheck` passes
- [ ] T070 [P] Security pass on the new surface: `token` absent from every DTO and log line (grep `token` in `api/src/slices/agent/peer`); the A2A JSON-RPC route rejects console JWTs; `A2aCardGuard` refuses `User`-role JWTs; peer credential compared with a constant-time check where a lookup by unique column is not already used; `fetch` targets only the stored `cardUrl`/interface URL (no user-supplied URLs reach `fetch` in this feature)
- [ ] T071 Post the closing ticket comment on CLEAN-74 (what shipped, restart-to-apply limitation, the R8 runtime-step finding from T061), open the PR into `main` with the ticket link, quickstart results, and the attribution footer; move the ticket to In Review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T002 and T003 in parallel with T001
- **Foundational (Phase 2)**: T004→T005 (Prisma) and T016 gate the new slice; T006–T015 are four independent threads (infra URL / MCP filter / thinking types + active turn / sync service) — **blocks all stories**
- **US1 (Phase 3)**: after Phase 2. The card guard's `ap_` branch needs `IPeerGateway.findByToken` (T027–T029 from US2); build T027–T029 first if US1 must be fully testable before US2
- **US2 (Phase 4)**: after Phase 2 and T017 (card service) — the admin half (T038–T046) after T037's SDK regen
- **US3 (Phase 5)**: after US1 (A2A server) and US2 (peers + client card half)
- **US4 (Phase 6)**: after US3 (delegation service) and T010/T011 (types, active turn); admin half (T058–T060) can be built in parallel with T054–T057
- **US5 (Phase 7)**: T062–T063 after US1; T064–T065 after US2 + US3
- **US6 (Phase 8)**: after US1–US5
- **Polish (Phase 9)**: last

### Parallel Opportunities

- Phase 2: T006 ∥ T007→T008→T009 ∥ T010→T011→T012 ∥ T013→T014→T015
- US1: T017/T018 ∥ T019 ∥ T020/T021, then T022→T023→T024→T025
- US2: T027/T028 ∥ T034; T031 ∥ T029; admin T038 ∥ T041 ∥ T042 while the API half lands
- US4: T054/T055 ∥ T058→T059
- US5: T062/T063 ∥ T064

---

## Parallel Example: Foundational

```bash
# Four independent threads after the migration (T005) lands:
Task: "T006 getApiPublicUrl in api/src/slices/setting/domain/infraConfig.gateway.ts"
Task: "T007–T009 IConditionallyListedTool + mcp-tools.handler filter + spec"
Task: "T010–T012 thinking step fields + findActiveTurn in the bridle gateway + spec"
Task: "T013–T015 BridleSyncService extraction + controller refactor + spec"
```

## Parallel Example: User Story 2 (admin half while the API half lands)

```bash
Task: "T038 admin slice skeleton admin/slices/agent/peer/"
Task: "T041 CardView.vue"
Task: "T042 Row.vue"
# then, once T037 regenerated the SDK:
Task: "T039 gateway + service + di → T040 store → T043 Picker → T044 Tab → T045 register tab"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 + US4 — the demo)

1. Phase 1 + Phase 2 (foundations, all four threads)
2. US1 (card + A2A server) — verify with curl
3. US2 (peers, admin tab) — verify in the console
4. US3 (delegation) — A answers with B's fact
5. US4 (visible step) — the part the user singled out
6. **STOP and VALIDATE**: quickstart §4 locally

### Incremental Delivery

- After US1: any A2A-aware client with an owner JWT can read a Ranch agent's card
- After US2: operators can connect peers and see cards; credentials work end to end
- After US3: delegation works, visible only in the reply text
- After US4: delegation visible in the thinking timeline (demo-ready)
- After US5: safe to connect more than a demo pair
- After US6: walkthrough verified locally and in-cluster; PR

---

## Notes

- Restart-to-apply (research R7): after connecting or removing a peer, restart the caller before testing the tool; the Peers tab shows the existing restart banner
- Never log or return `AgentPeer.token`; DTO specs carry the "poisoned stub" check for it
- The A2A routes bypass the `{ success, data }` envelope; every other new route uses it
- `admin/` copy is raw English; no `en.json` keys for this feature
- Commit per phase with `feat(peer): … (CLEAN-74)` / `feat(admin): … (CLEAN-74)`; ticket comments at each checkpoint (large task)
