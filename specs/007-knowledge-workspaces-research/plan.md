# Implementation Plan: Knowledge base isolation

**Branch**: `feat/CLEAN-48-knowledge-workspaces` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-knowledge-workspaces-research/spec.md`

**Tracker**: [CLEAN-48](https://dreamvention.atlassian.net/browse/CLEAN-48)

**Supporting**: [retrospective.md](./retrospective.md) (current-state audit) ·
[research.md](./research.md) (Phase 0)

## Summary

Make a knowledge base a real isolated area instead of a label on a shared pool.
Each base gets its own LightRAG instance, started with the workspace name
`workspaceOf()` already computes and provisioned through the same Argo path
Ranch already uses to deploy an agent pod. Retrieval, the graph and the entity
list become base-scoped; an agent given one base can neither read nor enumerate
another. A one-time, resumable re-index moves existing content out of the shared
pool, rebuilding every source from Ranch's own storage so the operator supplies
nothing. On top of that, the module stops needing a briefing: the flat list gets
search and paging, agents show what they read, the two settings that have never
been sent anywhere are removed, per-source status starts telling the truth, and
the two named UI defects are fixed at their root.

## Technical Context

**Language/Version**: TypeScript 5.x — NestJS 11 (`api`), Nuxt 4 / Vue 3 (`admin`), Bun + Turborepo

**Primary Dependencies**: Prisma 6, `@kubernetes/client-node` 1.4, Argo Workflows (via HTTP), LightRAG (`ghcr.io/hkuds/lightrag`), `reka-ui` 2.9 / `shadcn-vue` 2.8, Pinia, `@hey-api/openapi-ts`

**Storage**: PostgreSQL for Ranch (Prisma); a separate PostgreSQL (`lightrag-postgres`) shared by every retrieval instance, isolated by a workspace field; S3 for uploaded source files

**Testing**: Jest in `api` (`jest --passWithNoTests`), with manifest-builder and gateway spec precedents; `admin` has no runner — its acceptance is the quickstart

**Target Platform**: Kubernetes (Hetzner), namespaces `agents` (workloads, Argo-provisioned) and `platform` (shared services)

**Project Type**: Web application — NestJS API plus two Nuxt consoles, sliced by CleanSlice conventions

**Performance Goals**: entity picker usable within 1s at any base size (SC-009); one retrieval per bound base per question, none against unbound bases (SC-012)

**Constraints**: the retrieval service fixes its workspace at instance construction and offers no per-request scoping, so isolation is a deployment concern (research R1); a retrieval instance is sized as an agent slot — 100m CPU / 512Mi request, Burstable (research R2); the base ceiling is reported from existing cluster-capacity machinery rather than discovered by failure

**Scale/Scope**: a personal installation — single owner, no tenancy; low tens of bases, low tens of agents; `api` slice `reins` plus touches in `agent`, `workflow` and both consoles

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

`.specify/memory/constitution.md` is an **unfilled template** — every principle
is still a `[PRINCIPLE_N_NAME]` placeholder. The gate therefore evaluates against
the rules this repository actually enforces, from `CLAUDE.md` and
`.cursor/rules/project.mdc`. This substitution is recorded so a later, real
constitution can re-run the gate rather than inherit an unexamined pass.

| Gate | Source | Verdict |
|---|---|---|
| Slice architecture — abstract gateways in `domain/`, concrete in `data/`, DTOs at the edge, `components/*/Provider.vue` in consoles | CleanSlice convention, visible across `api/src/slices` | **Pass** — new work lands as a `reins/instance` sub-slice following the existing `reins/lightrag` shape |
| Delivery cycle — Jira issue, branch, checkpoint comments, PR into `main` | `CLAUDE.md` | **Pass** — CLEAN-48, branch `feat/CLEAN-48-knowledge-workspaces`, checkpoints posted |
| OpenAPI is generated, never hand-written | project card | **Pass** — the contract changes in `contracts/` are expressed as controller/DTO changes, then regenerated into both consoles |
| Secrets live only in `.env.project` and Kubernetes secrets | `CLAUDE.md`, project card | **Pass** — retrieval instances reuse the existing `lightrag-api` secret; no new credential surface |
| i18n — `app` copy is key-driven from `en.json`; `admin` stays English-only | `CLAUDE.md`, `docs/i18n.md` | **Pass** — this feature touches `admin` only; `app` gets no knowledge surface |
| Simplicity — no concept added without a need it alone answers | `CLAUDE.md` ("intuitive, not overloaded"); spec D4 | **Pass with one justified cost**, see Complexity Tracking |

**Post-Phase 1 re-check**: unchanged. The design adds one sub-slice, one manifest
builder and one migration path; it removes two dead settings, two
installation-wide endpoints and one flat list. Net concept count goes down.

## Project Structure

### Documentation (this feature)

```text
specs/007-knowledge-workspaces-research/
├── spec.md               # What must be true (36 FR, 14 SC, 6 stories)
├── retrospective.md      # Current-state audit with file-level evidence
├── plan.md               # This file
├── research.md           # Phase 0 — R1..R10, no unknowns left
├── data-model.md         # Phase 1 — entities, states, migrations
├── quickstart.md         # Phase 1 — runnable validation of the guarantee
├── contracts/            # Phase 1 — API and provisioning contracts
│   ├── knowledge-api.md
│   └── retrieval-instance.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 — created by /speckit-tasks, not here
```

### Source code (repository root)

```text
api/src/slices/
├── reins/
│   ├── knowledge/            # base CRUD, query, graph — endpoints become base-scoped
│   │   ├── knowledge.prisma        # drop entityTypes/relationshipTypes; workspace becomes load-bearing
│   │   ├── knowledge.controller.ts # /knowledges/graph[/labels] -> /knowledges/:id/graph[/labels]
│   │   ├── knowledge.tool.ts       # per-base attribution; description built from bound bases only
│   │   └── domain|data|dtos/
│   ├── source/               # per-source ingestion state and failure reason
│   ├── lightrag/             # client gains a per-instance base URL instead of one shared URL
│   │   └── data/workspace.ts       # unchanged — already the per-base namespace
│   ├── instance/             # NEW sub-slice: lifecycle of a base's retrieval instance
│   │   ├── domain/           # IInstanceGateway, instance.types.ts, instance.service.ts
│   │   └── data/             # argoInstance.gateway.ts, mockInstance.gateway.ts,
│   │                         # routerInstance.gateway.ts, instance.manifest.ts (+ .spec.ts)
│   └── migration/            # NEW: the one-time, resumable re-index off the shared pool
├── workflow/                 # Argo submit path reused; agent manifest untouched
└── agent/
    ├── agent/                # binding stays per base; screen shows what it reads
    └── pod/                  # capacity reporting reused for the base ceiling

admin/slices/
├── reins/
│   ├── pages/knowledges/[id]/index.vue   # NEW — the missing default section
│   ├── pages/knowledges/[id].vue         # active-tab fix via NuxtLink custom slot
│   ├── components/knowledge/graph/       # virtualized, searchable, base-scoped picker
│   ├── components/knowledge/list/        # search + paging instead of a flat list
│   └── components/knowledge/item/Form.vue# dead settings removed
└── agent/agent/components/agent/item/Form.vue  # base picker with context, not a checkbox column

k8s/platform/lightrag/       # shared deployment kept during the transition, removed after
```

**Structure Decision**: the existing CleanSlice layout is kept exactly. Two new
sub-slices under `reins` — `instance` (provisioning and lifecycle) and
`migration` (the one-time re-index) — because both have their own gateway
boundary and neither belongs inside `knowledge` or `source`. The `instance`
sub-slice deliberately mirrors `api/src/slices/workflow`: an abstract gateway, an
Argo implementation, a mock for local development, a router that picks between
them, and a manifest builder with a unit spec.

## Phase sequencing

The order is forced by the spec's priorities and by the fact that the transition
must be reversible until it is finished.

1. **Isolation exists but is not yet load-bearing.** Instance sub-slice, manifest
   builder, provisioning on base creation, per-instance client addressing. The
   shared pool still serves every read. Nothing user-visible changes.
2. **Reads move to the base's instance.** Query, graph and labels become
   base-scoped; the installation-wide endpoints go. This is the point where
   SC-001 and SC-002 become testable, and it is gated on the migration for bases
   that still hold content only in the shared pool.
3. **The migration runs.** Per base, resumable, with per-source state and an
   incomplete-answers notice while it is in flight. The old deployment is removed
   only after the last base is through.
4. **The module stops needing a briefing.** Dead settings removed and contracts
   regenerated, list search and paging, agent-side knowledge view, picker with
   context, honest per-source status.
5. **The two named defects.** Active tab and the missing default section — small,
   independent, and deliverable at any point after step 4's screens settle.

Steps 1–3 are one reversible sequence: until the shared deployment is deleted,
rollback is repointing the client at it.

## Complexity Tracking

> Filled because the Constitution Check's simplicity gate passes only with a cost
> stated out loud.

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| A running retrieval process per knowledge base | Upstream fixes `workspace` at instance construction and exposes no per-request scoping, so isolation cannot be expressed at query time (research R1). The product owner states base-level isolation as a hard requirement. | Grouping several bases behind one process was the earlier D2 and is exactly the leak the product forbids. Post-hoc filtering of results leaves the generated answer already synthesised from foreign content (FR-007). |
| Two new sub-slices (`instance`, `migration`) | Each owns a gateway boundary — provisioning talks to Argo, migration orchestrates re-ingestion with its own resumable state. | Folding either into `knowledge` would put infrastructure lifecycle and a one-off migration inside the CRUD slice, which is what the 2026-05-01 refactor moved away from. |
| Keeping the shared deployment alive during the transition | It is the rollback, and it keeps bases answering while their content is re-processed. | A cutover with no fallback would make an interrupted migration an outage with no way back. |
