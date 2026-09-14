# Implementation Plan: Agent-to-agent (A2A) — agent cards, peer agents, and delegation you can see

**Branch**: `feat/CLEAN-74-a2a-agent-peers` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-a2a-agent-peers/spec.md` | **Jira**: [CLEAN-74](https://dreamvention.atlassian.net/browse/CLEAN-74)

## Summary

Give every Ranch agent an **A2A 1.0 agent card** (derived from name, description, template skills and bound knowledge bases; served at `/a2a/agents/:id/.well-known/agent-card.json` behind a credential) and a **JSON-RPC endpoint** (`SendMessage`, `GetTask`) that turns an inbound task into a synchronous bridle conversation on that agent. Let an operator **connect peers** in the admin console (new `Peers` tab: own card, candidate picker with card preview, list with refresh/remove, recent delegations); each connection is a directed `AgentPeer` row holding a card snapshot and a pair-scoped `ap_` credential. Let the agent **delegate** through one new MCP tool, `ask_agent`, served by the API's existing MCP runtime with a per-request description listing its peers, listed only for agents that have peers, calling the peer over HTTP at the snapshot URL with a `chain` for loop/depth refusal. Make the delegation **visible**: the hub learns the active turn from the thinking stream it already relays, and the tool pushes a structured `delegation` thinking step (peer, matched skills, reason, task, status, elapsed, excerpt) that the admin chat renders with a dedicated layout and every other surface renders as a plain step. Every delegation is an `AgentDelegation` audit row. Decisions R1–R12 in [research.md](./research.md) §3.

## Technical Context

**Language/Version**: TypeScript — NestJS 10 API on Bun (Jest tests, Express 5, `@modelcontextprotocol/sdk` server already mounted at `POST /mcp/mcp`, socket.io hub); Nuxt 4 / Vue 3 SPA (`ssr: false`) for `admin`

**Primary Dependencies**: NestJS + Prisma (`prisma-import` per-slice fragments), class-validator/Swagger DTOs, zod (tool schemas), the bridle hub (`IBridleGateway`), the MCP registry (`@Tool`, `IDynamicallyDescribedTool`). **No new package**: A2A 1.0 types are hand-written from the proto (R1); HTTP client is global `fetch`. Console: Pinia store → service → gateway → `@hey-api/client-axios` SDK (`build:api`), shadcn-vue kit (no Dialog/Command — hand-built on reka-ui like `ConfirmDialog`), `socket.io-client` for the thinking stream

**Storage**: PostgreSQL via Prisma — two new tables `AgentPeer`, `AgentDelegation` (one additive migration `20260914120000_agent_peer_delegation`), two back-relations on `Agent`; A2A tasks in memory (10 min TTL); the card is derived on every read

**Testing**: API — Jest, colocated `*.spec.ts`, hand-rolled stubs (`cd api && bun run test -- peer agentCard a2a askAgent bridleSync bridle.gateway mcp-tools`); admin has no runner — verification = `bun run build:api && bun run typecheck`, then [quickstart.md](./quickstart.md) §3–6 by hand (local, then once in-cluster)

**Target Platform**: Linux API in k8s (single replica — required already by the stateful MCP transport) behind `api.ranch.cleanslice.org`; admin console SPA; agent pods on the same cluster reach the API at `ranch_api_url`

**Project Type**: Web application — monorepo slices `api` + `admin` (the `app` console is untouched)

**Performance Goals**: connecting a peer = one card fetch over HTTP (< 1 s); a delegation adds one HTTP round-trip on top of the peer's own reply time; the thinking step is pushed within the same tick as the tool call (< 1 s to the browser, SC-003); `tools/list` gains one indexed query per listing (peers of the caller)

**Constraints**: the runtime image does not change (FR-018) — everything reaches the agent through the tool channel it already uses; tools are listed once per pod session, so peer changes apply on restart (R7, surfaced by `markPendingRestart`); the sync reply limit stays 120 s; the card never lists peers (FR-019); the credential is never returned by a DTO; the API is the presenter of the pair credential, hence plaintext storage like `sl_` (R4); `admin/` copy is raw English; no A2A streaming, push notifications, or attachments forwarded to peers in this feature

**Scale/Scope**: tens of agents, a handful of peers each; delegations bounded by chat volume; chain depth ≤ 3

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific gates. Applied baseline: CleanSlice layering (controller → domain service → abstract gateway; Prisma types only in mappers; DTOs never leak into domain), one new slice per concern (`agent/peer` owns peers, cards, A2A, the tool and the delegation record — one concern: "agents talking to agents"), targeted improvements to code the feature must touch (extract the sync wait into a service; per-request tool listing filter honoured only by the new tool), no speculative abstractions (no streaming, no push, no task persistence, no cross-installation URL entry, no cancel), tests for every new server path. **PASS** pre-Phase-0 and post-Phase-1.

## Project Structure

### Documentation (this feature)

```text
specs/013-a2a-agent-peers/
├── plan.md              # This file
├── research.md          # §1 audit with file refs, §2 A2A 1.0 as published, §3 decisions R1–R12, §4 risks
├── data-model.md        # AgentPeer, AgentDelegation, derived AgentCard, in-memory task, delegation step fields
├── quickstart.md        # unit tests, migration/regen, curl checks, the demo walkthrough, in-cluster check
├── contracts/
│   └── a2a-api.md       # card JSON, JSON-RPC SendMessage/GetTask + rules, peers REST, ask_agent tool, thinking step, config
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/
├── .env.example                                   # + API_PUBLIC_URL, A2A_SYNC_TIMEOUT_MS, A2A_MAX_CHAIN
├── prisma/migrations/20260914120000_agent_peer_delegation/migration.sql   # additive: AgentPeer, AgentDelegation
└── src/
    ├── app.module.ts                              # + PeerModule
    └── slices/
        ├── agent/peer/                            # NEW slice — peers, cards, A2A, ask_agent, delegations
        │   ├── peer.prisma                        # model AgentPeer
        │   ├── delegation.prisma                  # model AgentDelegation
        │   ├── peer.module.ts                     # providers: services, gateways, tool, guards; imports Agent/Template/Skill/Knowledge/Bridle/Setting modules (forwardRef where cyclic)
        │   ├── domain/
        │   │   ├── a2a.types.ts                   # AgentCard, AgentSkill, Task, TaskState, Message, Part, JSON-RPC envelope/error codes (A2A 1.0 names)
        │   │   ├── peer.types.ts                  # IAgentPeerData, IAgentDelegationData, PeerErrorCodes, DelegationStatus, DelegationErrorCodes
        │   │   ├── peer.gateway.ts                # abstract IPeerGateway (list/find/create/updateSnapshot/delete, findByToken, candidates)
        │   │   ├── delegation.gateway.ts          # abstract IDelegationGateway (create, finish, listRecent)
        │   │   ├── agentCard.service.ts (+spec)   # build(agentId) — data-model §3
        │   │   ├── peer.service.ts (+spec)        # connect (mint ap_, fetch card via A2aClient, store), refresh, remove, list, candidates
        │   │   ├── a2a.client.ts (+spec)          # fetch card / SendMessage over HTTP with bearer + A2A-Version; maps HTTP/JSON-RPC failures to DelegationErrorCodes
        │   │   ├── a2a.server.service.ts (+spec)  # SendMessage/GetTask handling: chain rules, isAgentConnected pre-check, BridleSyncService, task mapping
        │   │   ├── a2aTask.store.ts               # in-memory tasks, TTL
        │   │   ├── delegation.service.ts (+spec)  # run(callerId, args, inboundChain): row waiting → step active → client call → row final → step done
        │   │   ├── delegationStep.ts              # builds label/detail/delegation fields for the thinking step
        │   │   └── index.ts
        │   ├── data/
        │   │   ├── peer.gateway.ts (+spec)        # Prisma impl + peer.mapper.ts
        │   │   └── delegation.gateway.ts (+spec)  # Prisma impl + delegation.mapper.ts
        │   ├── guards/
        │   │   ├── a2aCard.guard.ts (+spec)       # console Owner/Admin JWT OR ap_ scoped to :agentId
        │   │   └── a2aPeer.guard.ts (+spec)       # ap_ scoped to :agentId only; sets req.peer = { callerAgentId, peerId }
        │   ├── dtos/                              # agentPeer.dto, agentPeerCandidate.dto, agentCard.dto, connectPeer.dto, agentDelegation.dto, index
        │   ├── peer.controller.ts (+spec)         # /agents/:agentId/peers*, /agents/:agentId/card, /agents/:agentId/delegations (Owner/Admin)
        │   ├── a2a.controller.ts (+spec)          # GET /a2a/agents/:agentId/.well-known/agent-card.json, POST /a2a/agents/:agentId (raw bodies, no envelope)
        │   └── askAgent.tool.ts (+spec)           # @Tool ask_agent; describeForRequest; isListedForRequest; delegates to DelegationService
        ├── agent/agent/agent.prisma               # + peers / peerOf relations
        ├── mcp/
        │   ├── interfaces/conditional-listing.interface.ts   # NEW IConditionallyListedTool + isConditionallyListed()
        │   └── services/handlers/mcp-tools.handler.ts (+spec) # tools/list filters by isListedForRequest; tools/call refuses unlisted
        ├── bridle/
        │   ├── domain/bridle.types.ts             # IBridleThinkingStep + kind?/delegation?; IBridleOutgoingEvent thinking fields typed
        │   ├── domain/bridle.gateway.ts           # + findActiveTurn(agentId)
        │   ├── data/bridle.gateway.ts (+spec)     # active-turn map maintained from thinking events / unregisterClient
        │   ├── domain/bridleSync.service.ts (+spec)   # NEW sendAndAwait({agentId, clientId, text, parts, capabilities, timeoutMs})
        │   ├── bridle.controller.ts               # message/sync delegates to BridleSyncService (behaviour unchanged)
        │   └── bridle.module.ts                   # provides/exports BridleSyncService
        └── setting/domain/infraConfig.gateway.ts  # + getApiPublicUrl() (settings → API_PUBLIC_URL → ranch_api_url)

admin/
└── slices/
    ├── agent/peer/                                # NEW admin slice (same shape as agent/agentChannel)
    │   ├── nuxt.config.ts                         # alias '#peer', stores dir
    │   ├── index.d.ts, plugins/di.ts              # $peerService
    │   ├── domain/{peer.types.ts, peer.service.ts, index.ts}
    │   ├── data/{peer.gateway.ts, index.ts}       # generated SDK: listAgentPeers, listAgentPeerCandidates, getAgentCard, connectAgentPeer, refreshAgentPeer, removeAgentPeer, listAgentDelegations
    │   ├── stores/peer.ts                         # per-agent peers, candidates, own card, delegations; connect/refresh/remove → agentStore.markPendingRestart()
    │   └── components/peer/
    │       ├── Tab.vue                            # sections: own card, peers list, add-peer flow, recent delegations
    │       ├── CardView.vue                       # name/description/skills badges/address — used for own card and picker preview
    │       ├── Picker.vue                         # candidate list (filter input + rows), selects one → preview → Connect
    │       ├── Row.vue                            # peer row: name, status, skills badges, read-at, refresh/remove
    │       └── Delegations.vue                    # recent delegations table
    ├── agent/agent/components/agent/workspace/
    │   ├── sections.ts                            # + { value: 'peers', title: 'Peers', countKey: 'peers', primary: true }
    │   └── Canvas.vue                             # + v-else-if="tab === 'peers'" → <PeerTab :agent />
    ├── agent/agent/composables/useAgentSectionCounts.ts   # + peers count
    └── bridle/
        ├── stores/bridle.ts                       # IBridleThinkingStep mirror + kind/delegation
        ├── components/bridle/DelegationStep.vue   # NEW dedicated layout with live elapsed timer
        └── components/bridle/Provider.vue         # renders DelegationStep when step.kind === 'delegation', else today's row
```

**Structure Decision**: one new API slice `agent/peer` holds everything that is "agents talking to agents" (peers, cards, the A2A surface, the tool, the audit row) so the feature can be read in one place and removed in one place; the three touch points outside it (MCP listing filter, bridle active-turn + sync service, infra config URL) are each a small, testable extension of code that already exists. On the console, a sibling slice `agent/peer` mirrors the API slice and plugs into the agent workspace by one tab entry and one canvas branch, following `agentChannel`; the delegation rendering lives in the bridle slice next to the thinking timeline it extends.

## Build order (for `/speckit-tasks`)

1. **Foundations** — Prisma fragments + migration; `a2a.types.ts`; `getApiPublicUrl`; `IConditionallyListedTool` + handler filter; `BridleSyncService` extraction (controller unchanged); `findActiveTurn` in the hub; thinking step fields. Each with its spec. Nothing user-visible yet; `bun run test` green.
2. **Card + A2A server** (User Story 1) — `AgentCardService`, guards, `A2aController` (card + JSON-RPC), `A2aServerService`, task store. Verifiable with curl (quickstart §3).
3. **Peers** (User Story 2) — gateways, `PeerService`, `A2aClient.fetchCard`, `PeerController`, DTOs, swagger regen, admin slice + tab + picker + card view.
4. **Delegation** (User Stories 3, 5) — `A2aClient.sendMessage`, `DelegationService`, `askAgent.tool.ts`, delegation rows + endpoint, chain rules live end to end.
5. **Visible step** (User Story 4) — `delegationStep.ts` push, admin `DelegationStep.vue`, Provider branch, Recent delegations panel.
6. **Demo + cluster** (User Story 6) — quickstart §4–6, ticket comment with results, PR.

## Complexity Tracking

No constitution violations to justify. Two deliberate touches outside the new slice are recorded here so they are not mistaken for scope creep: the MCP per-request listing filter (needed for FR-017, applied to the new tool only) and the extraction of the bridle sync wait into a service (needed because the A2A server must wait for a reply without being an HTTP controller).
