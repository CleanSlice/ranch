# Implementation Plan: Agent must not look "running" when its runtime is not connected to the bridle hub

**Branch**: `feat/CLEAN-55-agent-bridle-connectivity` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-agent-bridle-connectivity/spec.md` | **Jira**: [CLEAN-55](https://dreamvention.atlassian.net/browse/CLEAN-55)

## Summary

Surface bridle-hub connectivity in agent status so a healthy pod with a dead runtime can never present as green "running". Backend: new `unreachable` status value driven by the drift sweep (60 s observation window + existing deploy grace), `bridleConnected` boolean in the status snapshot/SSE, reason persistence extended to `unreachable`, and a non-blocking deploy-time warning when `integrations/bridle_url` / `bridle_api_key` are empty. Frontend (admin): distinct badge + reason tooltip for `unreachable`, live `bridleConnected` in the status store, and an actionable chat hint (env preview, `/settings/bridle`, restart note). Full design decisions in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (NestJS 10 API on Bun; Nuxt 3/Vue 3 admin)

**Primary Dependencies**: NestJS + RxJS (status service, SSE), Prisma (agent rows), socket.io (bridle hub `/ws/agent`, chat `/ws/client`), Pinia stores + shadcn-vue Badge/Tooltip (admin), openapi-ts (generated admin client)

**Storage**: PostgreSQL via Prisma — `agent.status` is a plain `String` column (`api/src/slices/agent/agent/agent.prisma:15`), no migration required; `bridleConnected` is deliberately NOT persisted (in-memory hub truth)

**Testing**: Jest (`cd api && bunx jest agentStatus agentDeploy`); typechecks: `cd api && bunx tsc --noEmit`, `cd admin && bun run typecheck`

**Target Platform**: Linux server (API in k8s alongside agent pods deployed via Argo Workflows); admin is a browser SPA

**Project Type**: Web application — monorepo slices `api` + `admin` (CleanSlice architecture; `app` untouched)

**Performance Goals**: detection of "running but not connected" within ≈90 s (60 s grace + 30 s sweep); SSE consumers receive connectivity flips without reload

**Constraints**: hub map is in-process — zero false flags across API restarts/reconnect flaps (grace mandatory); `stopped` semantics and deployTracker stale protection untouched; `GET /agents/status` stays `@Public()` with no secrets; agent slice must not import bridle/workflow data layers (forwardRef on `IBridleGateway` already in place)

**Scale/Scope**: tens of agents per install; 30 s sweep already iterates all agents — one extra Map lookup per agent is negligible

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific gates. Applied baseline: CleanSlice layering respected (domain talks to abstract gateways only), no speculative abstractions, tests for the new reconcile path. **PASS** (pre-Phase-0 and post-Phase-1).

## Project Structure

### Documentation (this feature)

```text
specs/008-agent-bridle-connectivity/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions R1–R8
├── data-model.md        # Phase 1 output — status machine, payload shapes
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   └── agent-status-api.md  # Phase 1 output — HTTP/SSE contract changes
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/slices/
├── agent/agent/
│   ├── agent.prisma                      # comment update only (statusReason semantics)
│   ├── agent.controller.ts               # GET /agents/status, /status/stream — DTO wiring
│   ├── dtos/agentStatus.dto.ts           # + bridleConnected; AgentDto status enum + 'unreachable'
│   ├── data/agent.gateway.ts             # reason persists for failed|unreachable; + setStatusReason()
│   └── domain/
│       ├── agent.types.ts                # AgentStatusTypes + 'unreachable'
│       ├── agent.gateway.ts (interface)  # IAgentGateway + setStatusReason
│       ├── agentStatus.service.ts        # bridleDownSince map, demotion, guard, stream merge
│       ├── agentStatus.service.spec.ts   # NEW — reconcile-path unit tests
│       └── agentDeploy.service.ts        # deploy-time bridle settings check
└── workflow/domain/…                     # checkBridleSettings() on the workflow service

admin/slices/
├── agent/agent/
│   ├── domain/agent.types.ts             # status union + 'unreachable', bridleConnected in status types
│   ├── utils/agentFormat.ts              # AGENT_STATUS_VARIANT + unreachable
│   ├── stores/agentStatus.ts             # bridleConnected per agent, unreachable count
│   ├── data/agentStatus.gateway.ts       # map new SSE payload field
│   ├── components/agent/status/Indicator.vue    # count includes unreachable
│   ├── components/agent/overview/RuntimeCard.vue # reason shown for unreachable too
│   ├── components/agent/workspace/Main.vue       # badge site (:146)
│   └── pages/agents/index.vue            # list badge + tooltip (verify exact site)
└── bridle/components/bridle/Provider.vue # troubleshooting hint (env preview, /settings/bridle, restart)
```

**Structure Decision**: existing CleanSlice monorepo layout; changes confined to `api` (agent + workflow slices) and `admin` (agent + bridle slices). No new modules; `IBridleGateway` abstract interface already exposes everything the status service needs.

## Complexity Tracking

No constitution violations — table not required.
