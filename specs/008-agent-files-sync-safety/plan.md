# Implementation Plan: Agent Files — Visible Copy Model & Safe Sync

**Branch**: `feat/CLEAN-50-agent-files-sync-safety` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Jira**: CLEAN-50 (parent) → CLEAN-52 (P1 sync guard, in progress), CLEAN-53 (P2 visibility), CLEAN-54 (P3 rancher honesty); CLEAN-51 (toolset extension, separate follow-up)

**Input**: Feature specification from `/specs/008-agent-files-sync-safety/spec.md`

## Summary

Sync currently pushes the pod's delta (mtime+size manifest) over S3 and deletes pod-side orphans without ever checking S3 freshness — concurrent edits (SOUL.md case) are silently lost. Fix in three phases matching subtasks: (P1/CLEAN-52) platform records `lastPullAt`/`lastSyncAt` markers and the sync endpoint returns 409 with an at-risk file list requiring explicit confirmation; (P2/CLEAN-53) Files tab explains the S3-vs-pod copy model for running agents and shows per-file freshness; (P3/CLEAN-54) rancher SOUL.md constrained to its real abilities + `write_agent_file` result surfaces the restart requirement. No runtime-repo changes; delta semantics preserved.

## Technical Context

**Language/Version**: TypeScript (api: NestJS-style slices; admin: Nuxt 3 / Vue 3), Bun as package manager/runtime tooling

**Primary Dependencies**: Prisma (api ORM), AWS SDK S3 (`ListObjectsV2`/`LastModified`), Socket.IO (bridle hub ↔ agent pods), openapi-ts (generated admin client), `useConfirmStore` modal (admin)

**Storage**: Postgres via Prisma (`Agent` model gains `lastPullAt`, `lastSyncAt`); S3 as the shared file store (no changes to object layout)

**Testing**: api — jest (`bun run test`); admin — no test runner (manual validation per [quickstart.md](./quickstart.md))

**Target Platform**: Linux server (api), browser (admin console); agent pods untouched

**Project Type**: web service + admin SPA (monorepo slices)

**Performance Goals**: conflict check adds ≤1 S3 list call on the sync path; zero extra calls on file browsing

**Constraints**: no runtime-repo release; pod clock excluded from comparisons (Q2); admin UI English-only; legacy agents (null markers) must behave exactly as today

**Scale/Scope**: ~3 api slices touched (agent/file, agent/agent, bridle) + 1 admin slice (agent/file) + rancher SOUL.md; dozens of agents per installation — per-agent S3 list is cheap

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no ratified project principles. Gate passes vacuously. Applied repo rules instead: Jira CLEAN cycle (branch/commits/PR carry CLEAN-50), admin English-only i18n policy, OpenAPI regeneration flow for DTO changes. **Post-design re-check (2026-08-31): pass** — no violations introduced; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-agent-files-sync-safety/
├── plan.md              # This file
├── research.md          # Phase 0 — verified sync mechanics, decisions R1-R7
├── data-model.md        # Phase 1 — Agent marker fields, baseline/atRisk derivation
├── quickstart.md        # Phase 1 — unit + E2E validation scenarios
├── contracts/
│   └── sync-api.md      # Phase 1 — sync 409 contract, agent DTO, UI/rancher contracts
└── tasks.md             # Phase 2 (/speckit-tasks — not created yet)
```

### Source Code (repository root)

```text
api/src/slices/
├── agent/agent/
│   ├── agent.prisma            # + lastPullAt, lastSyncAt (migration: agent-sync-markers)
│   ├── data/agent.gateway.ts   # + marker update methods
│   └── domain/agentStatus.service.ts  # 'connected' event → set lastPullAt
├── agent/file/
│   ├── file.controller.ts      # sync endpoint: confirm body, 409 at-risk response
│   ├── domain/…                # baseline + at-risk computation (new service logic, jest specs)
│   └── data/file.gateway.ts    # reuse list/LastModified (no change expected)
├── bridle/data/bridle.gateway.ts  # handleSyncResponse → set lastSyncAt
└── rancher/rancher.tool.ts     # write_agent_file result += restart reminder

admin/slices/agent/file/
├── components/agentFile/Provider.vue  # running-agent banner, 409 → confirm flow, per-file updatedAt
└── data/agentFile.gateway.ts          # sync(confirm?) passthrough

rancher/.agent/SOUL.md          # honesty constraints (P3) + propagation step for deployed rancher

api swagger + admin generated client   # regenerate after DTO changes
```

**Structure Decision**: follow the existing slice layout; all changes land in already-owning slices (agent/file owns the sync contract, bridle owns socket moments, agent/agent owns persistence). No new slices, no shared abstractions.

## Phase progression

- **Phase 0** ([research.md](./research.md)): done — sync mechanics verified in runtime repo, markers/margin design (R2), single-endpoint 409 flow (R3), UI/rancher hooks (R4-R6). All Technical Context unknowns resolved; spec US1-scenario-4 adjusted to at-risk semantics (false positives acceptable, silent loss not).
- **Phase 1** ([data-model.md](./data-model.md), [contracts/sync-api.md](./contracts/sync-api.md), [quickstart.md](./quickstart.md)): done — additive Prisma fields, derived baseline/atRisk, endpoint contract, validation guide.
- **Phase 2**: `/speckit-tasks` — expected to group tasks by subtask: CLEAN-52 (migration → markers → guard → UI confirm) → CLEAN-53 (banner + timestamps) → CLEAN-54 (SOUL.md + tool result + propagation).

## Risks & mitigations

- **False positives right after boot** (S3 edits within the 60s pull margin) — cosmetic; wording says "may be overwritten".
- **AWS-vs-API clock skew** — NTP-level; affects warning accuracy only, never data (guard errs toward warning).
- **SOUL.md propagation** — deployed rancher agents hold the old prompt; tasks must include the reseed/update step (R6), else P3 ships dark.
- **Legacy agents** — null markers skip the check by design; first restart activates the guard.

## Complexity Tracking

*No constitution violations — table intentionally empty.*
