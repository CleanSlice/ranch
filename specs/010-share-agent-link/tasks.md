# Tasks: Share an agent by public link (CLEAN-66)

**Input**: Design documents from `specs/010-share-agent-link/`

**Prerequisites**: plan.md, spec.md, research.md (R0–R10), data-model.md, contracts/share-link-api.md, quickstart.md

**Tests**: API tests are included (plan: "tests for every new server path", Jest, colocated `*.spec.ts`, hand-rolled stubs). The console has no test runner; app verification is `bun run typecheck` + `bun run i18n:check` + quickstart.

**Organization**: Grouped by user story. US1 (owner shares) and US2 (visitor chats) are both P1 and together form the MVP; US3 (revoke/regenerate) is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 from spec.md
- File paths are repo-relative; API = `api/src/…`, console = `app/slices/…`

## Path Conventions

- API slice: `api/src/slices/agent/shareLink/{shareLink.prisma, *.module.ts, *.controller.ts, domain/, data/, dtos/}`
- Bridle changes: `api/src/slices/bridle/{bridle.controller.ts, guards/, domain/attachment.service.ts, data/attachment.gateway.ts}`
- Console slice: `app/slices/share/{nuxt.config.ts, pages/, layouts/, components/share/, composables/, data/, domain/, stores/, plugins/, i18n/locales/}`
- Console bridle changes: `app/slices/bridle/{stores/bridle.ts, components/bridle/chat/*.vue, domain/*, data/bridle.gateway.ts}`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold both new slices so every later task has a home; no behaviour yet.

- [X] T001 Create the API slice skeleton `api/src/slices/agent/shareLink/` with `domain/index.ts`, `dtos/index.ts` barrels and an empty `shareLink.module.ts` (imports `AuthModule`, `forwardRef(() => AgentModule)` if `AgentModule` imports bridle; otherwise plain) following `api/src/slices/agent/agentChannel/agentChannel.module.ts`
- [X] T002 [P] Create the console slice skeleton `app/slices/share/` with `nuxt.config.ts` (alias `#share`, `imports.dirs: [stores]`, `modules: ['@nuxtjs/i18n']`, `i18n: { langDir: 'locales', locales: LOCALES }` from `../setup/i18n/locales`), `index.d.ts` declaring `NuxtApp.$shareService`, `plugins/di.ts` (`name: 'share-di'`), and empty `i18n/locales/en.json` `{ "share": {} }` — copy the shape of `app/slices/bridle/nuxt.config.ts`, `index.d.ts`, `plugins/di.ts`
- [X] T003 [P] Add domain constants and types in `api/src/slices/agent/shareLink/domain/shareLink.types.ts`: `SHARE_TOKEN_PREFIX = 'sl_'`, `SHARE_TOKEN_BYTES = 32`, `SHARE_CLIENT_PREFIX = 'share-'`, `SHARE_VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/`, `IShareLinkData { id, agentId, token, revokedAt, rotatedAt, rotationCount, createdBy, updatedBy, createdAt, updatedAt }`, `IShareLinkState` (active/token/timestamps as in data-model.md), `IShareResolved { agentId, agentName, agentStatus }`, `ShareLinkErrorCodes = { LinkInvalid: 'SHARE_LINK_INVALID', VisitorInvalid: 'SHARE_VISITOR_INVALID', NotFound: 'SHARE_LINK_NOT_FOUND' }`; export from `domain/index.ts`
- [X] T004 [P] Add console domain types in `app/slices/share/domain/share.types.ts`: `IShareLinkState`, `IShareResolved`, `IShareContext { token: string; visitorId: string }` (mirror of data-model.md "Owner-side view model") and `domain/index.ts` barrel

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence, token service, module wiring and the console data chain that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Add Prisma model in `api/src/slices/agent/shareLink/shareLink.prisma`: `import { Agent } from "../agent/agent"`; `model AgentShareLink` with fields per data-model.md (`agentId String @unique` + `@relation(fields:[agentId], references:[id], onDelete: Cascade)`, `token String @unique`, `revokedAt DateTime?`, `rotatedAt DateTime?`, `rotationCount Int @default(0)`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt @updatedAt`)
- [X] T006 Add the reverse relation `shareLink AgentShareLink?` to `api/src/slices/agent/agent/agent.prisma` with `import { AgentShareLink } from "../shareLink/shareLink"` (depends on T005)
- [X] T007 Run `cd api && bun run migrate` then rename the generated folder to `api/prisma/migrations/<ts>_agent_share_link/` and add a leading `-- Additive: new table AgentShareLink + FK to Agent (cascade). Safe on an existing database.` comment; confirm `bun run generate` succeeds (depends on T006)
- [X] T008 [P] Define `abstract class IShareLinkGateway` in `api/src/slices/agent/shareLink/domain/shareLink.gateway.ts`: `findByAgent(agentId): Promise<IShareLinkData|null>`, `findByToken(token): Promise<IShareLinkData|null>`, `create(input: { agentId, token, userId })`, `rotate(agentId, token, userId)` (sets token, `revokedAt=null`, `rotatedAt=now`, `rotationCount+1`, `updatedBy`), `revoke(agentId, userId)` (sets `revokedAt=now`, `updatedBy`); export from `domain/index.ts`
- [X] T009 [P] Implement `ShareLinkMapper` in `api/src/slices/agent/shareLink/data/shareLink.mapper.ts` (Prisma record → `IShareLinkData`; ISO strings for dates) following `api/src/slices/agent/agentChannel/data/agentChannel.mapper.ts`
- [X] T010 Implement `ShareLinkGateway extends IShareLinkGateway` in `api/src/slices/agent/shareLink/data/shareLink.gateway.ts` over `PrismaService` (`prisma.agentShareLink.findUnique/create/update`) (depends on T007, T008, T009)
- [X] T011 Write `api/src/slices/agent/shareLink/data/shareLink.gateway.spec.ts` with a `makePrismaStub()` in the style of `api/src/slices/chat/data/chat.gateway.spec.ts`: create → findByAgent/findByToken round-trip; second `create` for the same agent throws `P2002`; `rotate` clears `revokedAt` and increments `rotationCount`; `revoke` sets `revokedAt` (depends on T010)
- [X] T012 Implement `ShareLinkService` in `api/src/slices/agent/shareLink/domain/shareLink.service.ts`: `mint()` = `sl_` + `randomBytes(32).toString('base64url')` (pattern: `api/src/slices/user/apiKey/domain/apiKey.service.ts:11-54`); `getState(agentId)`; `share(agentId, userId)` (no row → create; active → return; revoked → rotate); `regenerate(agentId, userId)` (create if no row, else rotate); `revoke(agentId, userId)` (no-op when no row/already revoked); `resolveForVisitor(token)` → `IShareResolved` via `IAgentGateway.findById` (throws `NotFoundException` with `code: SHARE_LINK_NOT_FOUND` for unknown/revoked/missing agent, identical body); `authorizeChat(token, agentId, visitorId)` → `share-<visitorId>` or throws `ForbiddenException({ code })` for unknown/revoked/agent-mismatch (`SHARE_LINK_INVALID`) and malformed visitor (`SHARE_VISITOR_INVALID`); every agent lookup 404s when the agent does not exist (depends on T008)
- [X] T013 Write `api/src/slices/agent/shareLink/domain/shareLink.service.spec.ts` with a stubbed `IShareLinkGateway` + `IAgentGateway`: token format regex `^sl_[A-Za-z0-9_-]{43}$`; share idempotent while active; share-after-revoke rotates; regenerate always rotates; revoke transitions; `resolveForVisitor` 404 for unknown and revoked with identical payload; `authorizeChat` matrix (valid → `share-abc`, revoked → 403 `SHARE_LINK_INVALID`, other agent → 403 `SHARE_LINK_INVALID`, visitor `"a b"` → 403 `SHARE_VISITOR_INVALID`) (depends on T012)
- [X] T014 Wire `api/src/slices/agent/shareLink/shareLink.module.ts`: providers `ShareLinkMapper`, `ShareLinkService`, `{ provide: IShareLinkGateway, useClass: ShareLinkGateway }`; exports `ShareLinkService`; register `ShareLinkModule` in `api/src/app.module.ts` imports (depends on T010, T012)
- [X] T015 [P] Implement console `ShareGateway extends BaseGateway` in `app/slices/share/data/share.gateway.ts` + `share.mapper.ts` + `data/index.ts` with methods `getLink(agentId)`, `share(agentId)`, `regenerate(agentId)`, `revoke(agentId)`, `resolve(token)` calling the generated SDK (`ShareLinksService.*`, `ShareService.resolveShareLink`) through `unwrapEnvelope` — pattern `app/slices/agent/data/agent.gateway.ts:67-72`; until T023/T029 regenerate the SDK, stub the calls behind the abstract gateway so typecheck passes
- [X] T016 [P] Implement `abstract class IShareGateway` in `app/slices/share/domain/share.gateway.ts` and `ShareService` in `app/slices/share/domain/share.service.ts` (thin pass-through like `app/slices/agent/domain/agent.service.ts`), wire `plugins/di.ts` → `provide: { shareService: new ShareService(new ShareGateway()) }`
- [X] T017 Implement `useShareStore` in `app/slices/share/stores/share.ts` (setup-store, `createServiceGetter<ShareService>('$shareService')`): `links: Record<agentId, IShareLinkState>`, `pending`, `error`, actions `loadLink`, `share`, `regenerate`, `revoke` (each writes `links[agentId]` and computes `url = \`${window.location.origin}/share?token=${token}\``), and `resolved: IShareResolved | null` + `resolve(token)` for the visitor page (depends on T015, T016)
- [X] T018 [P] Add `useShareVisitorId()` in `app/slices/share/composables/useShareVisitorId.ts`: read/mint `localStorage['bridle:share:visitor']` (22 base64url chars from `crypto.getRandomValues`), try/catch around storage like `app/slices/agent/composables/useLastAgent.ts`, always returns a string matching `/^[A-Za-z0-9_-]{1,64}$/`

**Checkpoint**: `cd api && bun run test -- shareLink` green; `cd app && bun run typecheck` green; foundation ready.

---

## Phase 3: User Story 1 — Owner shares an agent with one click (Priority: P1) 🎯 MVP

**Goal**: Share button in the agent chat header creates/returns the link; panel shows the URL with Copy.

**Independent Test**: Log in, open an agent, press Share → panel shows `http://<console>/share?token=sl_…`, Copy puts the full URL on the clipboard, reload → same token (quickstart §3 steps 1–2).

- [X] T019 [P] [US1] Create DTOs in `api/src/slices/agent/shareLink/dtos/shareLink.dto.ts`: `ShareLinkDto { active, token|null, createdAt|null, revokedAt|null, rotatedAt|null, rotationCount }` with `@ApiProperty`, exported from `dtos/index.ts`
- [X] T020 [US1] Implement `ShareLinkController` in `api/src/slices/agent/shareLink/shareLink.controller.ts`: `@ApiTags('share-links') @ApiBearerAuth() @Controller('agents/:agentId/share-link') @UseGuards(JwtAuthGuard)` (no `RolesGuard`, no `@Roles`), `GET` → `getState` (operationId `getAgentShareLink`), `POST` → `share(agentId, req.user.sub)` (operationId `createAgentShareLink`); map `IShareLinkState` → `ShareLinkDto`; register in `shareLink.module.ts` controllers (depends on T019, T014)
- [X] T021 [US1] Write `api/src/slices/agent/shareLink/shareLink.controller.spec.ts` (style: `api/src/slices/chat/myChat.controller.spec.ts`): `POST` returns the same token twice for an active link; unknown agent → 404; `req.user.sub` is passed as `userId` (depends on T020)
- [X] T022 [US1] Regenerate the client: `cd api && bun run build && bun run generate:swagger`, then `cd app && bun run build:api`; replace the stubs from T015 with `ShareLinksService.getAgentShareLink` / `createAgentShareLink` (depends on T020)
- [X] T023 [P] [US1] Add English copy to `app/slices/share/i18n/locales/en.json` under `share.panel.*`: `share` ("Share"), `title` ("Share this agent"), `hint` ("Anyone with the link can chat with this agent without signing in."), `copy` ("Copy link"), `copied` ("Copied"), `not_shared` ("This agent is not shared."), `shared_since` ("Shared {date}"), `close` ("Close"), `error` ("Could not update the share link")
- [X] T024 [US1] Build `<SharePanelProvider :agent-id>` in `app/slices/share/components/share/panel/Provider.vue`: header-style button (`Icon name="share-2"`, classes copied from the Restart button at `app/slices/agent/components/agent/chat/Provider.vue:213-226`), hand-rolled popover (`relative` wrapper, `absolute right-0 top-full mt-2 w-80 rounded-md border bg-card p-3 shadow-md z-30`, close on outside click / Escape), states: not shared → single **Share** action calling `shareStore.share`; shared → read-only URL field + **Copy** with inline `copied` flag reset after 1.5 s (`navigator.clipboard.writeText`, try/catch) — pattern `admin/slices/agent/agent/components/agent/visibility/Provider.vue:109-121`; loads state via `shareStore.loadLink(agentId)` on open; all strings via `$t('share.panel.*')` (depends on T017, T022, T023)
- [X] T025 [US1] Mount `<SharePanelProvider v-if="agent" :agent-id="agent.id" />` in `app/slices/agent/components/agent/chat/Provider.vue` header, before the Restart button, **without** the `canManage` gate; give the header inner `div` `relative` so the popover anchors correctly (depends on T024)
- [X] T026 [US1] Run `bun run i18n:sync` from the repo root, commit `app/slices/share/i18n/locales/{en,ru}.json` and `app/i18n.sync.json`; `bun run i18n:check` must pass (depends on T023, T024)

**Checkpoint**: Owner can share and copy; nothing happens for visitors yet (opening the URL shows the Nuxt 404 until US2).

---

## Phase 4: User Story 2 — Recipient chats with the agent without an account (Priority: P1) 🎯 MVP

**Goal**: `/share?token=…` renders a full-view chat with attachments, no login, stable per-visitor conversation, own attachments only.

**Independent Test**: Open the copied URL in an incognito window → no login, only the chat, message gets a reply, attach an image and a PDF → agent answers, reload → conversation and attachments still there, second browser → separate empty conversation (quickstart §3 steps 3–4, 9–10; §4 negative checks).

### API — visitor resolve + chat identity + attachments

- [X] T027 [P] [US2] Create DTOs in `api/src/slices/agent/shareLink/dtos/shareResolve.dto.ts`: `ShareResolveRequestDto { token: string }` (`@IsString() @Matches(/^sl_[A-Za-z0-9_-]{43}$/)`), `ShareResolvedDto { agentId, agentName, agentStatus }`; export from `dtos/index.ts`
- [X] T028 [US2] Implement `ShareController` in `api/src/slices/agent/shareLink/share.controller.ts`: `@ApiTags('share') @Controller('share')` **unguarded**, `POST resolve` (operationId `resolveShareLink`, `@HttpCode(200)`) → `service.resolveForVisitor(body.token)`; 404 body `{ code: 'SHARE_LINK_NOT_FOUND' }` for both unknown and revoked; register in `shareLink.module.ts` controllers (depends on T027, T014)
- [X] T029 [US2] Add `resolveShareLink` cases to `api/src/slices/agent/shareLink/shareLink.controller.spec.ts`: valid → `{ agentId, agentName, agentStatus }` only (assert no extra keys); revoked and unknown → identical 404 bodies (depends on T028)
- [X] T030 [US2] Extend `resolveClientId` in `api/src/slices/bridle/bridle.controller.ts:98-112`: after the JWT branch returns `null`, read `x-share-token` / `x-share-visitor` headers; if `x-share-token` is present call `shareLinks.authorizeChat(token, agentId, visitor)` (inject `ShareLinkService`; `resolveClientId` becomes `async` and takes `agentId`) and return its clientId — the service throws 403 so there is **no** fallback to `'sync-'+uuid`; update both call sites (`:127`, `:157`); add `ShareLinkModule` to `api/src/slices/bridle/bridle.module.ts` imports (depends on T012, T014)
- [X] T031 [US2] Write `api/src/slices/bridle/bridle.controller.spec.ts` (new file; stub `hub`, `attachments`, `jwt`, `shareLinks` as in `api/src/slices/bridle/handlers/bridleClientWs.handler.spec.ts:27-59`): `message/sync` with valid share headers registers the hub client as `share-<visitor>`; revoked token → 403 `SHARE_LINK_INVALID` and `hub.registerClient` not called; token for another agent → 403; JWT present + share headers → JWT wins; no headers → `sync-` fallback unchanged (depends on T030)
- [X] T032 [P] [US2] Implement `BridleChatAuthGuard` in `api/src/slices/bridle/guards/bridleChatAuth.guard.ts`: try JWT exactly like `api/src/slices/user/auth/guards/jwtAuth.guard.ts` (set `req.user`, `req.chatClientId = isAdmin ? 'admin' : sub`); else if `x-share-token` present → `shareLinks.authorizeChat(token, req.params.agentId, visitor)` → `req.chatClientId`; else `UnauthorizedException('Missing access token')`; register in `bridle.module.ts` providers
- [X] T033 [US2] Write `api/src/slices/bridle/guards/bridleChatAuth.guard.spec.ts`: JWT ok → `chatClientId = sub`; admin roles → `'admin'`; share pair ok → `share-<visitor>`; invalid share → 403 propagated; nothing → 401 (depends on T032)
- [X] T034 [US2] Add `owner` to attachments: extend `IUploadAttachmentInput` and `IStoredAttachment` in `api/src/slices/bridle/domain/bridle.types.ts` with `owner?: string`; `api/src/slices/bridle/data/attachment.gateway.ts` writes `metadata.owner` on upload (`:40-56`) and returns `owner` from `downloadWithMetadata` (`:59-80`); `api/src/slices/bridle/domain/attachment.service.ts` `upload()` passes `owner` through and gains `fetchFor(agentId, attachmentId, requester: { clientId, isShareVisitor })` that returns `null` when `isShareVisitor && stored.owner !== clientId` (depends on T032)
- [X] T035 [US2] Swap guards in `api/src/slices/bridle/bridle.controller.ts`: `@UseGuards(BridleChatAuthGuard)` on `uploadAttachment` (`:248`) and `downloadAttachment` (`:282`); upload passes `owner: req.chatClientId`; download uses `attachments.fetchFor(..., { clientId: req.chatClientId, isShareVisitor: clientId.startsWith('share-') })`; update the two docblocks that say "Requires a bearer token" (depends on T034)
- [X] T036 [US2] Extend `api/src/slices/bridle/domain/attachment.service.spec.ts` and `api/src/slices/bridle/data/attachment.gateway.spec.ts`: upload stores `owner` in metadata; `fetchFor` returns the object for the owner, `null` for a different `share-` requester, the object for a JWT requester regardless of `owner`, and the object for legacy objects without `owner` when the requester is JWT (depends on T034)
- [X] T037 [US2] Regenerate the client again (`cd api && bun run build && bun run generate:swagger && cd ../app && bun run build:api`) so `ShareService.resolveShareLink` exists; update `app/slices/share/data/share.gateway.ts` `resolve()` to use it (depends on T028)

### Console — bridle conversation descriptor + share headers

- [X] T038 [US2] Add `IBridleConversation { key: string; agentId: string; share?: IShareContext }` and `IBridleShareContext` to `app/slices/bridle/domain/bridle.types.ts`; extend `IBridleGateway`/`BridleService` (`app/slices/bridle/domain/bridle.gateway.ts`, `bridle.service.ts`) so `sendMessage`, `uploadAttachment`, `fetchAttachment` take an optional `share?: IBridleShareContext`
- [X] T039 [US2] Update `app/slices/bridle/data/bridle.gateway.ts`: when `share` is given, pass `headers: { 'X-Share-Token': share.token, 'X-Share-Visitor': share.visitorId }` per request — on the SDK call in `sendMessage` (`BridleService.sendMessageSync({ ..., headers })`) and on the two `apiClient.instance` calls (`:41-90`); never touch `client.setConfig` (depends on T038)
- [X] T040 [US2] Refactor `app/slices/bridle/stores/bridle.ts` to key all state by `conversation.key` instead of `agentId`: `hydrate(conv)`, `persist(conv)`, `appendMessage(conv, …)`, `stageFiles(conv, files)`, `upload(conv, localId)`, `retryStaged`, `removeStaged`, `clearStaged(conv)`, `dismissAttachmentError(conv)`, `fetchAttachment(conv, attachmentId)`, `sendMessage(conv, text)`, `reset(conv)`, plus getters `messagesFor(key)`, `isPending(key)`, `errorFor(key)`, `stagedFor(key)`; localStorage key `bridle:conversation:<key>` (unchanged for the console because `key === agentId` there); forward `conv.share` to the service on send/upload/fetch (depends on T038)
- [X] T041 [US2] Thread the descriptor through the components: `app/slices/bridle/components/bridle/chat/Provider.vue` gets prop `conversation?: IBridleConversation` (default `{ key: agentId, agentId }`) and passes it to `BridleChatInput`, `BridleChatMessage` → `BridleChatAttachmentList` (replace `:agent-id` props at `Provider.vue:196, 240`, `Message.vue:49-52`, `AttachmentList.vue:45`); console callers (`app/slices/agent/components/agent/chat/Provider.vue:260-266`, `app/slices/common/components/landing/hero/Provider.vue:81-85`) keep working with the default (depends on T040)
- [X] T042 [US2] Verify the console still works after the refactor: `cd app && bun run typecheck`; manual: `/agents/:id` shows the previously stored conversation for that agent (same localStorage key) and attachments still upload with the JWT (depends on T041)

### Console — share slice page

- [X] T043 [P] [US2] Create `app/slices/share/layouts/blank.vue`: `<div class="h-screen w-screen overflow-hidden bg-background text-foreground"><slot /></div>` — no `LayoutProvider`, no nav
- [X] T044 [P] [US2] Add English copy to `app/slices/share/i18n/locales/en.json` under `share.page.*`: `loading` ("Opening chat…"), `invalid_title` ("This link is invalid or no longer active"), `invalid_hint` ("Ask the person who shared it for a new link."), `unavailable` ("The agent is unavailable right now. Messages will go through once it is back."), `powered_by` ("Shared agent")
- [X] T045 [US2] Create `app/slices/share/pages/share.vue`: `definePageMeta({ layout: 'blank' })`, `const token = computed(() => String(useRoute().query.token ?? ''))`, render `<SharePageProvider :token="token" />`
- [X] T046 [US2] Build `<SharePageProvider :token>` in `app/slices/share/components/share/page/Provider.vue`: on mount `shareStore.resolve(token)` (empty/malformed token → invalid state without a request); states `loading | invalid | ready`; `ready` renders a slim header (agent name + status dot reusing the `statusMeta` idea from `app/slices/agent/components/agent/chat/Provider.vue:78-95`), an `unavailable` banner when `agentStatus !== 'running'`, and `<BridleChatProvider :agent-id :conversation="{ key: \`share:${agentId}:${visitorId}\`, agentId, share: { token, visitorId } }" :show-header="false" />` inside `flex h-full min-h-0 flex-col`; `visitorId` from `useShareVisitorId()`; re-resolve on `visibilitychange → visible` and every 30 s while visible (clear the interval on unmount); a 404 from resolve or a 403 from any chat call flips to `invalid` and the composer is hidden (depends on T017, T018, T037, T041, T043, T044, T045)
- [X] T047 [US2] Guard the console's 401 interceptor for the share page: in `app/slices/setup/api/plugins/api.ts:17-32` skip the `/login` redirect when `useRoute().path === '/share'` (share endpoints answer 403/404, but a stale console cookie on the same browser must not bounce a visitor) (depends on T046)
- [X] T048 [US2] Run `bun run i18n:sync` and `bun run i18n:check`; commit `en.json`, `ru.json`, `app/i18n.sync.json` (depends on T044, T046)

**Checkpoint**: MVP complete — quickstart §3 steps 1–4, 9–10 and §4 pass; `cd api && bun run test -- shareLink bridle.controller bridleChatAuth attachment` green.

---

## Phase 5: User Story 3 — Owner revokes or regenerates the link (Priority: P2)

**Goal**: Revoke and Regenerate in the panel; open visitor pages learn of it within 30 s or on the next message.

**Independent Test**: Share, open the link in a second browser, Revoke → second browser shows "no longer active" within 30 s or on the next send; Regenerate → old link dead, new link works (quickstart §3 steps 5–8).

- [X] T049 [US3] Add `POST regenerate` (operationId `regenerateAgentShareLink`) and `DELETE` (operationId `revokeAgentShareLink`, `@HttpCode(200)`) to `api/src/slices/agent/shareLink/shareLink.controller.ts`, both returning `ShareLinkDto` (depends on T020)
- [X] T050 [US3] Add controller spec cases in `api/src/slices/agent/shareLink/shareLink.controller.spec.ts`: regenerate returns a different token and `rotationCount + 1`; revoke returns `active: false, token: null`; revoke twice is 200 and idempotent; `POST` after revoke returns a new token (depends on T049)
- [X] T051 [US3] Regenerate the client (`cd api && bun run build && bun run generate:swagger && cd ../app && bun run build:api`) and point `app/slices/share/data/share.gateway.ts` `regenerate()` / `revoke()` at `ShareLinksService.regenerateAgentShareLink` / `revokeAgentShareLink` (depends on T049)
- [X] T052 [P] [US3] Add English copy to `app/slices/share/i18n/locales/en.json` under `share.panel.*`: `revoke` ("Revoke"), `revoke_confirm` ("Revoke this link? Anyone using it will lose access immediately."), `revoke_yes` ("Revoke link"), `regenerate` ("Regenerate"), `regenerate_confirm` ("Replace the link? The current one stops working immediately."), `regenerate_yes` ("Replace link"), `cancel` ("Cancel"), `revoked` ("Link revoked")
- [X] T053 [US3] Extend `app/slices/share/components/share/panel/Provider.vue`: in the shared state add **Regenerate** and **Revoke** buttons with an inline two-step confirm (text + Confirm/Cancel row inside the popover, no `window.confirm`), calling `shareStore.regenerate` / `shareStore.revoke`; after revoke the panel returns to the not-shared state; after regenerate the URL field updates and `copied` resets; disable buttons while `pending` (depends on T024, T051, T052)
- [X] T054 [US3] Confirm the visitor page reacts: the 30 s / visibility re-resolve and the 403-on-send handling from T046 flip to `invalid` after Revoke/Regenerate — add the "link is no longer active" copy `share.page.revoked_title` ("This link is no longer active") to `en.json` and use it when a previously `ready` page turns invalid (depends on T046, T052)
- [X] T055 [US3] Run `bun run i18n:sync` and `bun run i18n:check`; commit locale files and `app/i18n.sync.json` (depends on T052, T053, T054)

**Checkpoint**: All three stories work independently; quickstart §3 complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T056 [P] Ensure no share token ever reaches logs: grep `api/src/slices/agent/shareLink` and `api/src/slices/bridle/bridle.controller.ts` for `logger.*token`; log link `id`/`agentId` only
- [X] T057 [P] Swagger hygiene: `ShareController` routes carry `@ApiOperation` descriptions and `@ApiNotFoundResponse`; `BridleController` attachment docblocks and `@ApiOperation` descriptions mention "bearer token or share link headers"; `X-Share-Token` / `X-Share-Visitor` documented with `@ApiHeader` on `message`, `message/sync`, attachment routes
- [X] T058 [P] Mobile pass on `/share` (375 px): header wraps, composer sticks to the bottom, attachments list scrolls inside the chat container (`overflow-x` never on the body)
- [X] T059 Full verification: `cd api && bunx tsc --noEmit && bun run test`, `cd app && bun run build:api && bun run typecheck`, `bun run i18n:check`, then walk quickstart §1–§4 and record results in the Jira checkpoint comment
- [X] T060 Jira + PR: comment on CLEAN-66 with what landed, open the GitHub PR `feat(app): share agent by public link (CLEAN-66)` into `main` with the PR body linking the ticket and the spec folder, put the PR URL on the issue and move it to In Review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001–T004 independent; T003/T004 can run alongside T001/T002.
- **Foundational (Phase 2)**: T005→T006→T007 sequential (schema, relation, migration); T008/T009 parallel; T010 after T007–T009; T012 after T008; T014 after T010+T012; console T015/T016/T018 parallel, T017 after T015+T016. **Blocks all stories.**
- **US1 (Phase 3)**: after Phase 2. T019 first; T020→T021→T022; T023 parallel with the API tasks; T024 after T017+T022+T023; T025 after T024; T026 last.
- **US2 (Phase 4)**: after Phase 2; does **not** need US1 to be finished for the API side, but the E2E test needs a token (create one via `POST /agents/:id/share-link` with curl if US1 UI is not done). API tasks T027–T037 and console bridle refactor T038–T042 can proceed in parallel tracks; T046 joins them.
- **US3 (Phase 5)**: after US1 (panel) and US2 (page reaction). T049→T050→T051; T052 parallel; T053/T054 after T051; T055 last.
- **Polish (Phase 6)**: after all stories.

### Parallel Opportunities

- Phase 2: `T008 ∥ T009`, `T015 ∥ T016 ∥ T018`, and the whole console chain (T015–T018) ∥ the API chain (T005–T014).
- US2: API track (T027–T037) ∥ console bridle track (T038–T042) ∥ page scaffolding (T043, T044, T045).
- US3: T052 ∥ T049–T051.
- Polish: T056 ∥ T057 ∥ T058.

---

## Parallel Example: User Story 2

```bash
# Track A (API):      T027 → T028 → T029; T030 → T031; T032 → T033 → T034 → T035 → T036; T037
# Track B (console):  T038 → T039 → T040 → T041 → T042
# Track C (page):     T043 ∥ T044 ∥ T045
# Join:               T046 → T047 → T048
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 + Phase 2 → `bun run test -- shareLink` green, `app typecheck` green.
2. Phase 3 (US1) → owner can share and copy. Validate quickstart §3 steps 1–2.
3. Phase 4 (US2) → visitor chats with attachments. Validate quickstart §3 steps 3–4, 9–10 and §4.
4. **STOP and VALIDATE** with the Jira checkpoint comment; demo-able.

### Incremental Delivery

- Add Phase 5 (US3) → revoke/regenerate; quickstart §3 steps 5–8.
- Phase 6 → polish, full verification, PR.

### Commit cadence (Conventional Commits + ticket)

- `feat(api): agent share link model, service and owner endpoints (CLEAN-66)` after Phase 2 + T020
- `feat(api): share-token chat identity and visitor attachments (CLEAN-66)` after T037
- `refactor(app): bridle conversation descriptor (CLEAN-66)` after T042
- `feat(app): share panel and /share visitor page (CLEAN-66)` after T048
- `feat(app): revoke and regenerate share links (CLEAN-66)` after T055
- Jira comments: after Phase 2 (start + foundation), after US2 (MVP), after Phase 6 (done + PR).

---

## Notes

- Never log a share token; never put it in `Authorization`; share failures are 403/404, never 401.
- `resolveClientId` must throw on a bad share token — a silent fallback to the anonymous path would let revoked visitors keep chatting.
- The bridle store refactor (T040) must leave console localStorage keys unchanged (`key === agentId`), or users lose their visible history on deploy.
- All console copy goes into `en.json` first; `ru.json` is generated (`docs/i18n.md`).
