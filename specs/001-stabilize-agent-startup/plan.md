# Implementation Plan: Stabilize Agent Startup Status & Logs

**Branch**: `fix/agent-deploy` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-stabilize-agent-startup/spec.md`

## Summary

During agent start/restart the platform shows misleading signals: a transient `failed` status (~30 s) during every stop → start, a single `deploying` status that hides whether the agent is starting for the first time or restarting, a raw Kubernetes 400 error dump in the log panel while the container is being created, and a red MCP "connect failed" error on every first launch. Root causes are all identified (see [research.md](./research.md)):

1. The 30-second drift sweep marks any pod-less `deploying` agent as `failed` with no grace period for a just-submitted deploy; a secondary race lets `GET /agents/:id` read the phase of the just-cancelled old workflow.
2. No persisted "has ever run" marker exists, so first deploy and restart are structurally indistinguishable.
3. The friendly `[container containercreating]` branch in the log controller never fires because `@kubernetes/client-node` 1.4 throws `ApiException` with a *string* body, while the code expects an object.
4. The seeded CleanSlice MCP URL lacks the `/mcp` path segment; the seeder is create-only, so existing rows keep the broken URL.

Approach: fix status truthfulness server-side (deploy grace window backed by a persisted timestamp, 5-minute definitive-failure timeout, workflow-sync guard), add a server-provided launch context (`initial` / `restart`) plus a `statusReason` for failures, parse the k8s client's string error bodies so the friendly log markers fire, heal the CleanSlice MCP URL (default + bootstrap upsert), and update the admin UI to consume the new fields (distinct first-start vs restart copy, poll-race guard, log level classification fix). No changes to the agent runtime repo are needed.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.2 workspaces (monorepo via turbo); Node runtime in containers

**Primary Dependencies**: `api/` — NestJS 11, Prisma 6, `@kubernetes/client-node` 1.4.0, Argo Workflows (namespace `agents`, submitted via `argo-workflow.gateway.ts`), Socket.IO (bridle chat hub), SSE status stream; `admin/` — Nuxt 3.16, Pinia, generated SDK via `openapi-ts` (`@hey-api/client-axios`), shadcn-nuxt

**Storage**: PostgreSQL via Prisma (`Agent.status` is a plain string column, default `'pending'`); Prisma migration required for new columns

**Testing**: `api/` — Jest (`bun run test`, currently `--passWithNoTests`); `admin/` — no test runner configured; pure `.ts` changes type-checked via `tsc` (no vue-tsc in repo)

**Target Platform**: Kubernetes cluster (k3d locally, managed cluster in prod); admin web UI; agent pods created by a two-step Argo workflow (`cleanup-old` → `run-agent`), pod name deterministic `agent-<agentId>`

**Project Type**: Web application (NestJS API + Nuxt admin) in a monorepo

**Performance Goals**: Status visible as `running` within 10 s of readiness (SC-002; admin polls every 5 s during launches, SSE pod stream is push); drift sweep cadence stays 30 s

**Constraints**: Status vocabulary (`pending`/`deploying`/`running`/`failed`/`stopped`) must not change (clarification 2026-07-30); launch context must be server-derived and survive page reload (FR-003/FR-005); definitive failure = explicit runtime signals OR 5-minute safety timeout (FR-002); real failures must not be suppressed or delayed (FR-009, SC-006); built-in MCP row heal must be idempotent (seeder runs on every API boot); prod deploys happen only on `v*` tag runs

**Scale/Scope**: Tens of agents per cluster; one admin page per agent plus a list page; 3 API slices touched (`agent`, `log`, `mcpServer` + `rancher` tool), 1 admin slice (`agent`), 1 Prisma migration, SDK regeneration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific principles or gates are ratified. No violations possible; gate **PASS** (pre-Phase-0 and re-checked post-Phase-1). General engineering defaults apply: smallest change that satisfies the spec, no status-enum breakage, idempotent bootstrap operations, migrations additive-only.

## Project Structure

### Documentation (this feature)

```text
specs/001-stabilize-agent-startup/
├── plan.md              # This file
├── research.md          # Phase 0 output — root causes + decisions D1–D6
├── data-model.md        # Phase 1 output — Agent columns, status state machine
├── quickstart.md        # Phase 1 output — end-to-end validation scenarios
├── contracts/
│   └── agent-api.md     # Phase 1 output — DTO/endpooint/log-marker contracts
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
api/src/slices/
├── agent/agent/
│   ├── agent.prisma                     # + firstDeployedAt, lastDeployStartedAt, lastLaunchContext, statusReason
│   ├── agent.controller.ts              # syncStatus: skip failure-writes inside deploy grace window
│   ├── domain/
│   │   ├── agent.types.ts               # + LaunchContext type
│   │   ├── agentDeploy.service.ts       # write launch context + deploy timestamp; clear stale workflowId before cancel; statusReason on failure
│   │   └── agentStatus.service.ts       # drift no-pod branch: 5-min grace from lastDeployStartedAt; statusReason on timeout/pod failure
│   ├── data/agent.gateway.ts            # updateStatus extended for new fields
│   └── dtos/                            # agent response fields: launchContext, statusReason, firstDeployedAt
├── log/log.controller.ts                # parse ApiException string body → friendly [container …] marker fires
├── rancher/rancher.tool.ts              # restart_agent: actually call restartAgent() instead of bare status write
└── mcpServer/domain/mcpServer.seeder.ts # default URL …/mcp + idempotent heal of existing built-in row

api/prisma/                              # generated schema + new migration

admin/slices/agent/agent/
├── composables/useAgentLifecycle.ts     # pause poll while mutation in flight; failed handling aligned with definitive-failure semantics
├── components/agent/chat/Tab.vue        # overlay copy: first start vs restart (launchContext-driven)
├── components/agent/logs/Panel.vue      # placeholder copy per launch context
├── utils/agentFormat.ts                 # status labels incl. reason surfacing
├── utils/agentLogs.ts                   # ERROR classifier: prefer explicit level token over substring match
├── data/agent.mapper.ts                 # map launchContext / statusReason / firstDeployedAt
└── domain/agent.types.ts                # extend IAgentData

admin/slices/setup/api/                  # regenerated SDK (openapi-ts) after API DTO changes
```

**Structure Decision**: Existing monorepo layout is kept; all changes land in the `api` and `admin` workspaces listed above. The agent runtime lives in a separate repository and needs no changes (research confirmed the MCP misconfiguration is platform-side).

## Complexity Tracking

No constitution violations — table not required.
