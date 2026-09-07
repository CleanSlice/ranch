# Research: Share an agent by public link (CLEAN-66)

All Technical Context unknowns resolved. Code references verified against the current tree (`origin/main` @ efa6b7e).

## R0. How the console chat actually talks to an agent (transport)

- **Finding**: the customer console (`app/`) has **no websocket client**. `app/slices/bridle/stores/bridle.ts:373` → `BridleService.sendMessage` → `POST /api/agent/:agentId/message/sync` (`api/src/slices/bridle/bridle.controller.ts:144-218`, unguarded, 120 s timeout). The socket.io client exists only in `admin/`. History on reload is replayed from `localStorage` (`bridle:conversation:<agentId>`, `bridle.ts:44-90`); the API is never asked for a transcript.
- **Consequence**: the share page reuses the HTTP path. The only server-side gap is identity: without a JWT `resolveClientId()` (`bridle.controller.ts:98-112`) returns `null` and the controller mints `'sync-' + uuid` per request, so every message would start a new agent session. The share token must map to a **stable per-visitor `clientId`**.
- **Decision**: share visitors authenticate every chat request with two headers, `X-Share-Token` (the link secret) and `X-Share-Visitor` (a per-browser id), resolved in `BridleController` into `clientId = share-<visitorId>`. The `/ws/client` websocket handshake is **not** extended in v1 (nothing in `app/` uses it); noted as follow-up for the embed SDK.
- **Alternatives considered**: (a) exchange the share token for a short-lived JWT and reuse all existing JWT paths — rejected: a JWT cannot be killed on Revoke until it expires (breaks FR-006 / the "token dies only on revoke" requirement) and a JWT with a made-up role would open every `JwtAuthGuard`-only route (`me/chats`, attachments) to visitors (FR-014). (b) `Authorization: Bearer sl_…` — rejected: overloads the header that `JwtAuthGuard`/`ApiKeyGuard` already interpret, and the app's axios client sets `Authorization` globally (`app/slices/setup/api/utils/handleApiAuthentication.ts`), which the share page must not touch.

## R1. Token format and storage

- **Decision**: `sl_` + 32 random bytes base64url (≈256 bits, FR-003), minted with `crypto.randomBytes` exactly like `ApiKeyService` (`api/src/slices/user/apiKey/domain/apiKey.service.ts:11-54`). Stored **in plaintext** in a `@unique` column.
- **Rationale**: User Story 1 requires the owner to reopen the panel and see the *same* link, so the plaintext must be recoverable; hashing (the `rk_` key pattern) only works for show-once secrets. The grant is chat-only and revocable; a database leak already exposes agent configs and LLM credentials, so a hashed share token buys nothing material. The spec's Key Entity wording is updated accordingly (see spec Clarifications, design note).
- **Alternatives considered**: hash + show-once (rejected: contradicts US1 acceptance #2); hash + reversible encryption with a server key (rejected: new secret to manage, no threat it defends against here).

## R2. One row per agent, not a history table

- **Decision**: `AgentShareLink` has `@@unique([agentId])`. Revoke sets `revokedAt`; Regenerate (and Share after a revoke) writes a new `token`, clears `revokedAt`, bumps `rotatedAt`/`rotationCount`. A link is active iff `revokedAt IS NULL`.
- **Rationale**: "at most one active link per agent" becomes a database invariant for free; Regenerate is a single `UPDATE`, hence atomic (FR-007). Prisma cannot express a *partial* unique index, so a history table would need raw SQL that `prisma migrate` fights with, or service-level locking. Old tokens are secrets and should not be retained anyway.
- **Alternatives considered**: history table with `revokedAt` + partial unique index (rejected above); enforcing uniqueness in a transaction (rejected: weaker than a constraint, more code).

## R3. Visitor identity and conversation isolation

- **Decision**: the page mints a visitor id once per browser (`localStorage` key `bridle:share:visitor`, 22 base64url chars, validated server-side with the existing `sanitizeAnonId` rule `/^[A-Za-z0-9_-]{1,64}$/`, `bridleClientWs.handler.ts:298-302`). Server `clientId = share-<visitorId>`; the agent runtime therefore writes `data/sessions/bridle:share-<visitorId>.jsonl`, and the chat index (`chatSync.service.ts:206-229`) files it as `channel=bridle`, `externalUserId=share-<visitorId>` — distinguishable by prefix (FR-012) and impossible to collide with a JWT `sub` or `admin`.
- **Client-side isolation**: the bridle store keys conversations by `agentId` only (`bridle.ts:103-111`), so the owner's console chat and a visitor chat in the same browser would share one array. The store gains a **conversation descriptor** `{ key, agentId, share? }`; the console keeps `key = agentId`, the share page uses `key = share:<agentId>:<visitorId>`. Local persistence key becomes `bridle:conversation:<key>`, which leaves existing console data untouched.
- **Alternatives considered**: a separate share-only store and chat UI (rejected: duplicates ~250 lines of Provider/Input logic); server-side transcript replay via `GET /api/agent/:agentId/transcript` (rejected for v1: the endpoint is unauthenticated and takes an arbitrary `channel`, so wiring the share page to it would make that pre-existing hole reachable from a public page — see R8).

## R4. Revocation reaching an open page

- **Decision**: every chat request re-validates the token against the database (no caching), so a revoked link is rejected on the next send with **403 `SHARE_LINK_INVALID`** — never a silent fallback to the anonymous path. The page additionally re-resolves the link (`POST /share/resolve`) on mount, on `visibilitychange → visible`, and every 30 s while visible; a 404 flips the page into the "link is no longer active" state and disables the composer.
- **Rationale**: the console transport is request/response, so there is no socket to cut. In-flight `message/sync` calls (≤120 s) are allowed to finish; a hub-side disconnect would need a new `IBridleGateway.disconnectClients` API for a marginal gain. Spec SC-003 is reworded to this behaviour (rejection on the next message, proactive detection ≤ 30 s).
- **Status code**: 403, not 401 — the app's axios interceptor bounces any client-side 401 outside `/auth/` to `/login` (`app/slices/setup/api/plugins/api.ts:17-32`), which would kick an anonymous visitor into the console login form.
- **Alternatives considered**: hub disconnect via a `disconnect` closure on `IBridleClientData` (deferred; becomes necessary once the websocket path accepts share tokens); shorter poll (rejected: cost without a user-visible gain).

## R5. Visitor-facing agent info and availability

- **Decision**: a slim public endpoint `POST /share/resolve { token }` returns `{ agentId, agentName, agentStatus }` or 404 for unknown/revoked tokens (same body for both, FR-013). `agentStatus` comes from the agent row; CLEAN-55 already demotes `running` → `unreachable` when the runtime is off the hub, so the page can show the "agent unavailable" banner from status alone (FR-015) without the share module depending on the bridle hub.
- **Rationale**: `GET /agents/:id` is already `@Public()` (`agent.controller.ts:195-206`) but returns the full `AgentDto` (config, resources, workflowId, allowedOrigins, …) and calls the workflow service on every hit; the share page must not widen that surface (FR-014). Token in a POST body keeps it out of access logs.
- **Module graph**: `BridleModule → ShareLinkModule` (token validation in `resolveClientId`); `ShareLinkModule` depends only on Prisma + `IAgentGateway` (agent name/status, existence). No `forwardRef`.

## R6. Owner-side API and authorization

- **Decision**: separate controller `ShareLinkController` at `agents/:agentId/share-link` with `@UseGuards(JwtAuthGuard)` and **no `@Roles`** — any authenticated console user (Clarification Q2). Not added to `AgentController`: its class-level `RolesGuard` + `@Roles(Owner, Admin)` habit would over-restrict (`agent.controller.ts:66-69`).
- Endpoints: `GET` (state), `POST` (create-or-return active; creates a fresh token if the row is revoked), `POST regenerate`, `DELETE` (revoke). Idempotent `POST` means the Share button can always call it.
- `createdBy`/`updatedBy` store the JWT `sub` for the owner-side "shared by" line (FR-017).

## R7. Console UI mechanics

- **Share button**: `app/slices/agent/components/agent/chat/Provider.vue:213-226` renders Restart (gated by `canManage`). Share is mounted beside it **without** the `canManage` gate (FR-001 + Q2) as `<SharePanelProvider :agent-id>` from the new share slice, so the agent slice change is one line.
- **Panel**: hand-rolled popover in the existing idiom (the app ships only `Badge` + `Icon`; no Popover/Dialog/Button primitives, no toast — `vue-sonner` is imported in one util but never mounted). Copy feedback = inline `copied` state reset after 1.5 s, the pattern used by the admin visibility panel (`admin/slices/agent/agent/components/agent/visibility/Provider.vue:109-121`). Link built client-side as `${window.location.origin}/share?token=…` (`runtimeConfig.public.apiUrl` is the API origin, not the console's).
- **Share page**: new slice `app/slices/share/` (auto-registered by `app/registerSlices.ts` because it has a `nuxt.config.ts`), `pages/share.vue` with `definePageMeta({ layout: 'blank' })` and a new `layouts/blank.vue` (`h-screen` shell, no `LayoutProvider`, which would render nav, locale select, sign-in and an extra registration-settings request). `/share` is already outside `PROTECTED_PREFIXES` (`auth.global.ts:10`), so no middleware change.
- **Chat reuse**: `<BridleChatProvider>` gains a `conversation` prop (descriptor, R3). Attachments work for visitors (R10); the store forwards the share context to `uploadAttachment` / `fetchAttachment` as well as `sendMessage`.
- **i18n**: new keys under a distinct top-level group `share.*` in `app/slices/share/i18n/locales/en.json` (the `chat.*` group is already split between the agent and bridle slices); `bun run i18n:sync` generates `ru.json` and updates `app/i18n.sync.json`; `bun run i18n:check` gates CI and the image build.

## R10. Attachments for share visitors

- **Finding**: upload and download (`bridle.controller.ts:248, 282`) are the only guarded routes on the bridle controller, both with `JwtAuthGuard`. Storage (`data/attachment.gateway.ts:37-56`) keys objects by `agentId + randomUUID` and carries `name`/`mime` as S3 user metadata; there is **no owner** on an attachment, so today any authenticated user can fetch any attachment by id (ids are unguessable, and only the uploader's transcript knows them).
- **Decision**: replace `JwtAuthGuard` on those two routes with a `BridleChatAuthGuard` that accepts **either** a valid JWT (unchanged behaviour) **or** the share header pair for the path `agentId`, and sets `req.chatClientId`. Uploads stamp the uploader's `clientId` into S3 metadata (`owner`). Downloads by a share visitor are allowed only when `owner === share-<visitor>`; JWT users keep today's behaviour (no owner check) so console and admin history views keep working for files uploaded before this change.
- **Rationale**: the user classed attachments as standard chat functionality (Clarification 2026-09-07). The guard reuses the same `ShareLinkService.authorizeChat` as `resolveClientId`, so revocation applies to file traffic immediately. The owner stamp is one metadata field and one compare; without it a leaked attachment URL plus any valid share link for that agent would serve another visitor's file.
- **Console side**: `BridleChatInput` keeps its attach controls on the share page; the bridle gateway sends `X-Share-Token` / `X-Share-Visitor` on upload/download when the conversation descriptor carries a share context (per-request headers on the axios instance calls at `app/slices/bridle/data/bridle.gateway.ts:41-90`).
- **Alternatives considered**: keep attachments owner-only (rejected by the user); pre-signed S3 URLs for visitors (rejected: new machinery, and `IBridleAttachment.url` is documented as "never an S3 URL").

## R8. Rate limiting and pre-existing exposure (out of scope, flagged)

- No throttler exists anywhere in the API (`@nestjs/throttler` absent). A 256-bit token makes guessing infeasible; message flooding through `message/sync` is a pre-existing property of the unguarded bridle controller and is not made worse by this feature. **Decision**: no limiter in v1.
- Pre-existing: `GET /api/agent/:agentId/transcript?channel=<any>` is unauthenticated and reads any channel's transcript. This feature does not use it and should not; recorded on the Jira issue as a separate hardening item.

## R9. Testing strategy

- API: Jest, hand-rolled stubs, colocated specs (`api/package.json` jest block; patterns in `chat.gateway.spec.ts`, `myChat.controller.spec.ts`). New specs: service (mint format, revoke/regenerate transitions), gateway with the Prisma stub (unique-per-agent upsert), `BridleController.resolveClientId` share branch (valid → `share-<id>`, revoked → 403, agent mismatch → 403, bad visitor id → 403), `ShareLinkController` visitor resolve (404 on revoked).
- App: no test runner exists (`app/package.json:22` echoes). Verification = `bun run build:api` → `nuxt typecheck` + `bun run i18n:check` + the manual quickstart. Standing up vitest is out of scope for this ticket.
