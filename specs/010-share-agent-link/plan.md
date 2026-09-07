# Implementation Plan: Share an agent by public link (chat without an account)

**Branch**: `feat/CLEAN-66-share-agent-link` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-share-agent-link/spec.md` | **Jira**: [CLEAN-66](https://dreamvention.atlassian.net/browse/CLEAN-66)

## Summary

Let a console user share one agent through `/share?token=sl_…`, a link that needs no account, opens a full-view chat, and dies only on Revoke/Regenerate. Backend: new `AgentShareLink` table (one row per agent, plaintext opaque token), owner endpoints under `agents/:agentId/share-link` (any authenticated user), a public `POST /share/resolve`, and a share-token branch in `BridleController.resolveClientId` that maps `X-Share-Token` + `X-Share-Visitor` to a stable `clientId = share-<visitor>` (403 on anything invalid, never anonymous fallback), and a `BridleChatAuthGuard` (JWT **or** share headers) on the attachment routes with an `owner` stamp so visitors can upload and read back only their own files. Frontend (`app`): new `share` slice with a `blank` layout and the `/share` page reusing `BridleChatProvider`, plus a Share panel (Copy / Revoke / Regenerate) mounted beside Restart in the agent chat header. The bridle store gains a conversation descriptor so owner and visitor chats never mix in one browser. Decisions in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript — NestJS 10 API on Bun (Jest tests); Nuxt 4 / Vue 3 SPA (`ssr: false`) customer console

**Primary Dependencies**: NestJS + Prisma (`prisma-import` schema composition), class-validator/Swagger DTOs, socket.io hub (untouched in v1); Nuxt layers per slice, Pinia setup-stores, `@hey-api/openapi-ts` axios SDK, `@nuxtjs/i18n`, Tailwind + lucide `Icon`

**Storage**: PostgreSQL via Prisma — new table `AgentShareLink` (additive migration); visitor id and conversation cache in browser `localStorage`; agent transcripts stay in the runtime's S3 JSONL as today

**Testing**: API — Jest, colocated `*.spec.ts`, hand-rolled stubs (`cd api && bun run test -- shareLink bridle.controller bridleChatAuth attachment`); App — no runner exists, verification = `bun run build:api && bun run typecheck` (app) + `bun run i18n:check` + manual [quickstart](./quickstart.md)

**Target Platform**: Linux API in k8s; console is a browser SPA served from its own origin (CORS already allows it)

**Project Type**: Web application — monorepo slices `api` + `app` (`admin` untouched except that shared sessions appear in its chat list automatically)

**Performance Goals**: Share → copied link ≤ 2 clicks; visitor first reply bound by the agent, not this feature; revocation visible on the next message and within ≤ 30 s on an open page

**Constraints**: token 256-bit, never logged, never in `Authorization`; 403 (not 401) for share failures because the console's axios interceptor redirects 401 → `/login`; share page must not call `handleApiAuthentication` (global client mutation) nor `LayoutProvider`; `admin/` is English-only, `app/` copy goes through `en.json` + `i18n:sync`; `ShareLinkModule` imports `AgentModule` via `forwardRef` (module cycle `Agent → Bridle → ShareLink → Agent`, precedent `FileModule`)

**Scale/Scope**: one link per agent, tens of agents per install; 2 DB lookups per visitor message (link by token, agent by id) — negligible

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific gates. Applied baseline: CleanSlice layering (controllers → domain services → abstract gateways; DTO/Prisma types never leak into domain), one new slice per concern, no speculative abstractions (no hub disconnect API, no throttler, no websocket share auth until needed), tests for every new server path. **PASS** pre-Phase-0 and post-Phase-1.

## Project Structure

### Documentation (this feature)

```text
specs/010-share-agent-link/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R0–R10
├── data-model.md        # Phase 1 — AgentShareLink, visitor identity, state machine
├── quickstart.md        # Phase 1 — validation guide
├── contracts/
│   └── share-link-api.md  # Phase 1 — REST + header + component contracts
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/
├── app.module.ts                                  # + ShareLinkModule
├── slices/agent/agent/agent.prisma                # + `shareLink AgentShareLink?` reverse relation
├── slices/agent/shareLink/                        # NEW slice
│   ├── shareLink.prisma                           # model AgentShareLink (data-model.md)
│   ├── shareLink.module.ts                        # { provide: IShareLinkGateway, useClass: ShareLinkGateway }, imports AgentModule, AuthModule
│   ├── shareLink.controller.ts                    # agents/:agentId/share-link — GET / POST / POST regenerate / DELETE (JwtAuthGuard, no roles)
│   ├── share.controller.ts                        # POST /share/resolve (unguarded, 404 for unknown+revoked)
│   ├── shareLink.controller.spec.ts
│   ├── domain/
│   │   ├── shareLink.types.ts                     # IShareLinkData, IShareResolved, SHARE_TOKEN_PREFIX, CLIENT_ID_PREFIX 'share-'
│   │   ├── shareLink.gateway.ts                   # abstract IShareLinkGateway: findByAgent, findByToken, upsertToken, revoke
│   │   ├── shareLink.service.ts                   # mint(), share(), regenerate(), revoke(), resolveForVisitor(), authorizeChat(token, agentId, visitor)
│   │   ├── shareLink.service.spec.ts
│   │   └── index.ts
│   ├── data/
│   │   ├── shareLink.gateway.ts                   # Prisma impl
│   │   ├── shareLink.gateway.spec.ts              # makePrismaStub() pattern (chat.gateway.spec.ts)
│   │   └── shareLink.mapper.ts
│   └── dtos/{shareLink.dto.ts, shareResolve.dto.ts, index.ts}
├── slices/bridle/
│   ├── bridle.module.ts                           # + imports ShareLinkModule
│   ├── bridle.controller.ts                       # resolveClientId(): share-header branch → 'share-<visitor>' | 403; attachment routes → BridleChatAuthGuard + owner stamp/check
│   ├── guards/bridleChatAuth.guard.ts             # NEW — JWT or share headers → req.chatClientId
│   ├── guards/bridleChatAuth.guard.spec.ts
│   ├── domain/attachment.service.ts               # upload() takes owner; fetch() optional owner check
│   ├── data/attachment.gateway.ts                 # owner in S3 metadata
│   └── bridle.controller.spec.ts                  # NEW — share branch cases
└── prisma/migrations/<ts>_agent_share_link/migration.sql   # additive

app/slices/
├── share/                                         # NEW slice (auto-registered: has nuxt.config.ts)
│   ├── nuxt.config.ts                             # alias #share, imports.dirs stores, i18n
│   ├── index.d.ts                                 # NuxtApp.$shareService
│   ├── plugins/di.ts                              # new ShareService(new ShareGateway())
│   ├── layouts/blank.vue                          # h-screen shell, no LayoutProvider
│   ├── pages/share.vue                            # definePageMeta({ layout: 'blank' }); reads ?token; mounts <SharePageProvider>
│   ├── components/share/
│   │   ├── page/Provider.vue                      # resolve → states: loading | invalid | ready(+unavailable banner); 30 s / visibility re-resolve; <BridleChatProvider :conversation :show-header="false"> (attachments on)
│   │   └── panel/Provider.vue                     # owner popover: Share | Copy / Revoke / Regenerate, inline copied state
│   ├── composables/useShareVisitorId.ts           # localStorage 'bridle:share:visitor'
│   ├── data/{share.gateway.ts, share.mapper.ts, index.ts}
│   ├── domain/{share.gateway.ts, share.service.ts, share.types.ts, index.ts}
│   ├── stores/share.ts                            # per-agent link state for the panel; resolved visitor state for the page
│   └── i18n/locales/{en.json, ru.json}            # share.* keys (ru generated)
├── agent/components/agent/chat/Provider.vue       # + <SharePanelProvider :agent-id="agent.id"> beside Restart (no canManage gate)
├── bridle/
│   ├── components/bridle/chat/Provider.vue        # + prop conversation (descriptor)
│   ├── components/bridle/chat/{Input,AttachmentList}.vue  # take the descriptor instead of a bare agentId
│   ├── stores/bridle.ts                           # keyed by conversation.key; sendMessage / stageFiles / fetchAttachment forward share context
│   ├── domain/bridle.{gateway,service,types}.ts   # optional share context on send, upload, fetch
│   └── data/bridle.gateway.ts                     # per-request headers X-Share-Token / X-Share-Visitor on all three calls
└── setup/api/data/repositories/api/*              # regenerated (ShareLinksService, ShareService)
```

**Structure Decision**: two slices touched per side — API gets one new slice (`agent/shareLink`) plus a surgical change in `bridle` (identity resolution); the console gets one new slice (`share`) plus small, backwards-compatible prop additions in `bridle` and a one-line mount in `agent`. No admin changes.

## Implementation phases (for `/speckit-tasks`)

1. **API data + domain**: prisma model, migration, gateway + mapper + service with specs (mint format, transitions, one-row-per-agent).
2. **API HTTP**: owner controller, visitor resolve controller, DTOs with `operationId`s, module wiring, `app.module.ts`.
3. **API chat identity + attachments**: `resolveClientId` share branch + 403 codes, `BridleChatAuthGuard` on the attachment routes, `owner` metadata stamp/check, `BridleModule` import, guard + controller specs.
4. **Client regen**: `generate:swagger` → `app build:api`.
5. **App bridle refactor**: conversation descriptor threaded through Provider, Input, AttachmentList and the store; share headers on send/upload/fetch (console behaviour unchanged; verify `/agents/:id` still hydrates the old localStorage keys).
6. **App share slice**: layout, page, page provider (states, polling), visitor id composable, gateway/service/store, i18n.
7. **App owner panel**: popover component + mount in agent chat header, i18n, `i18n:sync`.
8. **Verification**: quickstart §1–§4, typecheck, `i18n:check`; Jira checkpoint comments; PR.

## Complexity Tracking

No constitution violations. Deliberate deferrals (not violations): hub-side socket disconnect on revoke, websocket share auth for the embed SDK, rate limiting, server-side transcript replay — each recorded in research.md with the trigger that would bring it back.
