# Implementation Plan: Rancher & Agent Usage Panel Redesign

**Branch**: `feat/dashboard-agent-costs` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-rancher-usage-panel/spec.md`

## Summary

Declutter the admin Rancher page (drop the five count tiles, keep only the usage block), turn the "Rancher usage · 30d" block into an interactive, reusable **UsagePanel** with three switchable views (total cost across all agents / calls / this-agent cost) and a paginated day-by-day breakdown, and mount that same panel on every agent detail page next to the chat and logs.

Technical approach: add one new API endpoint `GET /usage/overview` that aggregates the existing `Usage` table across all agents (mirroring the roll-up already implemented in `GET /llms/:id/usage`) — **no schema change**. On the admin side, extend the layered `usage` slice (gateway → service → store) with the overview fetch, build a shared `UsagePanel` component in that slice, restructure the Rancher page layout (chat centered, panel right), and add the panel to the agent chat tab side stack (with logs) while replacing the Overview tab's `UsageCard` with the same component.

## Technical Context

**Language/Version**: TypeScript 5.x across the monorepo (Bun 1.2 workspaces, Turbo)

**Primary Dependencies**: API — NestJS 10 + Prisma (PostgreSQL) + @nestjs/swagger; Admin — Nuxt 3 (Vue 3), Pinia, shadcn-nuxt/reka-ui theme components (`#theme/components/ui/*`), Tailwind, @hey-api/openapi-ts generated SDK (`admin/slices/setup/api`)

**Storage**: Existing PostgreSQL `Usage` table (rows keyed `agentId × model × date`); today's live snapshot read from S3 `data/usage.json` per agent (existing mechanism). **No new tables or migrations.**

**Testing**: API — Jest (`cd api && bun run test`); Admin — no test harness (`admin test: no tests yet`); pure-TS changes type-checked via `tsc` (no vue-tsc in repo)

**Target Platform**: Web (admin panel at `admin/`, Nuxt SSR/SPA), API server (NestJS)

**Project Type**: Web application (monorepo: `api/` backend + `admin/` frontend, slice-based architecture on both sides)

**Performance Goals**: Usage panel renders with data in a comparable time to the current tile (single fetch per view); overview aggregation is one indexed DB query over ≤30 days of rows

**Constraints**: Follow the layered slice pattern (domain/data/stores) used by the `usage` slice; SDK is generated — never hand-edit `*.gen.ts`; UI components come from `#theme/components/ui`; labels stay hardcoded English like the existing usage surfaces

**Scale/Scope**: Single-workspace admin tool, tens of agents; 30-day window ⇒ ≤ ~30 × models × agents usage rows per query. Scope: 1 new API endpoint, 1 new shared component, 2 page-layout changes, usage-slice extension, SDK regen

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled placeholder template — no project-specific principles are ratified. Default gates applied instead:

| Gate | Status | Notes |
|------|--------|-------|
| Simplicity — no new projects/services | ✅ PASS | Extends existing `api` and `admin` workspaces only |
| No schema/data migration unless required | ✅ PASS | Aggregate computed from the existing `Usage` table |
| Follow established repo patterns | ✅ PASS | New endpoint mirrors `findForCredential`; admin follows layered slice pattern (memory: slices migrating to layered pattern — `usage` slice already conforms) |
| No hand-editing generated artifacts | ✅ PASS | SDK regenerated via `openapi-ts` (`admin build:api`) |

**Post-Phase-1 re-check**: design introduces no new violations — one endpoint, one shared component, no new dependencies. ✅ PASS

## Project Structure

### Documentation (this feature)

```text
specs/002-rancher-usage-panel/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── api-usage-overview.md   # New endpoint contract
│   └── ui-usage-panel.md       # Shared panel behavior contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
api/src/slices/usage/
├── usage.controller.ts          # MODIFY: add GET /usage/overview
├── domain/usage.types.ts        # MODIFY: add IOverviewUsageResponse
├── domain/usage.gateway.ts      # MODIFY: add findRecentAll(days) abstract
└── data/usage.gateway.ts        # MODIFY: implement findRecentAll(days)

admin/slices/usage/
├── nuxt.config.ts               # (components auto-scanned by Nuxt layer; verify)
├── components/usage/Panel.vue   # NEW: shared UsagePanel (views + pagination)
├── domain/usage.types.ts        # MODIFY: add IOverviewUsage domain type
├── domain/usage.gateway.ts      # MODIFY: add findOverview()
├── domain/usage.service.ts      # MODIFY: add findOverview()
├── data/usage.gateway.ts        # MODIFY: call generated SDK overview op
├── data/usage.mapper.ts         # MODIFY: map overview response defensively
└── stores/usage.ts              # MODIFY: overview cache + fetchOverview()

admin/slices/rancher/components/rancher/
└── Provider.vue                 # MODIFY: drop count tiles; chat centered, UsagePanel right

admin/slices/agent/agent/components/agent/
├── chat/Tab.vue                 # MODIFY: side stack = logs + UsagePanel (both collapsible)
└── overview/UsageCard.vue       # MODIFY: delegate to shared UsagePanel (field parity)

admin/slices/setup/api/data/repositories/api/
└── *.gen.ts                     # REGENERATED: bun run build:api (openapi-ts)
```

**Structure Decision**: Web application monorepo. Backend work stays inside `api/src/slices/usage/` (one endpoint following the existing controller's aggregation pattern). Frontend work is centered on `admin/slices/usage/` — the panel lives in the slice that owns the domain so both the `rancher` and `agent` slices consume it via Nuxt layer auto-import (`<UsagePanel>`), keeping cross-slice coupling limited to component usage, as done today with `AgentLogsPanel`/`BridleProvider`.

## Complexity Tracking

No constitution gate violations — table not required.
