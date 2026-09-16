# Implementation Plan: A2A v2 — external agents and delegation that fires

**Branch**: `feat/CLEAN-95-a2a-protocol-upgrade` (spec dir `014-a2a-protocol-upgrade`) | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-a2a-protocol-upgrade/spec.md`

## Summary

Three moves on the existing CLEAN-74 A2A surface. (1) The delegation policy the model
actually follows: the `ask_agent` tool description gains the "never say I don't know
while a plausible peer is untried" rule (FR-011) — the tool description is the only
lever this repo owns over the model's behaviour, and production shows zero delegations
ever. (2) External peers: `AgentPeer` learns an `external` origin — imported by card
URL with an optional outbound credential, replace-on-reimport by canonical URL, same
feed and same visible step. (3) Operational honesty: the API records which peer set the
running pod last received over MCP, the A2A tab shows **armed / pending restart**, and
the restart banner gets a one-click Restart now. The tab itself is renamed A2A
(label only, key stays `peers`).

## Technical Context

**Language/Version**: TypeScript 5.x end to end — NestJS 10 API (`api/`), Nuxt 3 / Vue 3
admin console (`admin/`), bun as runtime and package manager

**Primary Dependencies**: Prisma (PostgreSQL), zod (tool schema), reka-ui + Tailwind
(admin), existing MCP server slice (`api/src/slices/mcp`), existing A2A client/server
(`api/src/slices/agent/peer`)

**Storage**: PostgreSQL — additive migration on `AgentPeer` (nullable `peerAgentId`,
`origin`, `outboundToken`, nullable inbound `token`) plus peer-serve tracking on `Agent`

**Testing**: jest unit specs colocated in the api slice (`bun run test`), `nuxt
typecheck` for admin, manual quickstart for live scenarios (local + production)

**Target Platform**: existing k8s deployment; no new services, no new images

**Project Type**: web console + API monorepo (admin/ + api/; app/ untouched)

**Performance Goals**: unchanged from CLEAN-74 — delegation step visible ≤ 1 s,
connection-refused class failures surfaced < 5 s (SC-006)

**Constraints**: A2A protocol 1.0 only; restart-to-apply stays (decided Q3); **no
runtime-repo changes** — the model-facing lever is the MCP tool description served by
this API; credentials write-only (poisoned-stub tests extend to `outboundToken`)

**Scale/Scope**: single-digit peers per agent, feed capped at 20 rows; 4 admin
components touched, 1 tab label, ~6 api files + 2 new columns

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template — no project-specific gates
exist. Applied house rules instead: additive-only migration, `{ success, data }`
envelope for console routes (A2A routes stay bare per CLEAN-74), secrets never returned
by any DTO, admin stays English-only. No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/014-a2a-protocol-upgrade/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R7
├── data-model.md        # Phase 1 — AgentPeer/Agent changes, DTO shapes
├── quickstart.md        # Phase 1 — validation guide (local mock + production)
├── contracts/
│   └── peers-v2-api.md  # Phase 1 — extended connect, peers state, error codes
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
api/
├── prisma/schema.prisma                          # AgentPeer + Agent columns (R1, R4)
└── src/slices/agent/peer/
    ├── askAgent.tool.ts                          # FR-011 policy text (R3)
    ├── peer.controller.ts                        # connect-by-URL, peers state (R2, R4)
    ├── dtos/connectPeer.dto.ts                   # one-of peerAgentId | url (+token)
    ├── dtos/agentPeer.dto.ts                     # origin, external marker
    ├── domain/peer.service.ts                    # import/replace/self-URL refusal (R2)
    ├── domain/a2a.client.ts                      # optional bearer for external (R6)
    ├── domain/delegation.service.ts              # outbound credential pick (R6)
    └── data/peer.mapper.ts                       # origin mapping

api/src/slices/mcp/services/handlers/
    └── mcp-tools.handler.ts                      # (unchanged) — serve hook lives in
                                                  # AskAgentTool.describeForRequest (R4)

admin/slices/agent/agent/components/agent/workspace/
    └── sections.ts                               # tab title 'Peers' → 'A2A' (R5)

admin/slices/agent/peer/
    ├── components/peer/Tab.vue                   # armed/pending line, Restart now
    ├── components/peer/Picker.vue                # "By URL" import path + credential
    ├── components/peer/Row.vue                   # external origin badge
    ├── components/peer/Delegations.vue           # external marker in feed rows
    ├── stores/peer.ts                            # importByUrl, peersState
    ├── domain/peer.types.ts                      # origin field, state types
    └── data/peer.gateway.ts                      # new endpoints
```

**Structure Decision**: everything lands in the two slices CLEAN-74 created
(`api/src/slices/agent/peer`, `admin/slices/agent/peer`) plus one tab-label line in the
agent workspace section registry. No new slices, no runtime-repo work.

## Complexity Tracking

No constitution violations — table intentionally empty.
