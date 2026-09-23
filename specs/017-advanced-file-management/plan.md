# Implementation Plan: Advanced Agent File Management

**Branch**: `feat/CLEAN-112-advanced-file-management` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-advanced-file-management/spec.md`

**Tracker**: [CLEAN-112](https://dreamvention.atlassian.net/browse/CLEAN-112) `[ADMIN][APP]`

## Summary

Turn the agent Files tab into a small IDE (any text format editable, large files streamed on scroll, raw "Open full" link, Monaco editor with JSON validation, explorer with filter / selection / bulk actions / tabs / New file), add whole-workspace import in two flows (Import button and `import_agent_files` tool) with a preview before any write, give the Ranch agent list / read / write / create / import tools, and render an agent's proposed file change as a card in the chat with **Apply / Edit before applying / Skip** and hard caps on what is ever diffed inline.

Technical approach in one paragraph. The API stays the authority for everything: it classifies files as text/binary (`kind`, `editable` on every node), keeps slice reads and trims split UTF-8 at slice ends, streams a raw object for a short-lived JWT "open link", stages an uploaded/fetched archive once in S3 and computes an `ImportPlan` from it, and turns every write-through-chat into a persisted `FileChangeProposal` whose diff (via `diff`) is computed once and capped (inline ≤ 200 lines / 100 KB, no diff ≥ 1 MiB, sets never inline). Cards reach the consoles the way CLEAN-74 delegation steps do: the API publishes a `proposal` event into the active turn and a `proposal_update` broadcast on state change, and the transcript endpoint returns proposals for reload, so **no agent runtime change** is needed. The admin Files tab gets Monaco (lazy, client-only) and an extended `agentFile` store (tabs, drafts, selection); the twin `bridle` slice in admin and app gets `ProposalCard.vue` (read-only in app). All limits live in one `file.limits.ts` and are exposed by `GET /agents/:id/files/limits`.

## Technical Context

**Language/Version**: TypeScript 5 on Bun (API: NestJS 11 + Prisma 6 + PostgreSQL; consoles: Nuxt 4 / Vue 3.5 / Pinia / Tailwind / shadcn-vue 2.8 on reka-ui; socket.io for bridle)

**Primary Dependencies**: existing `@aws-sdk/client-s3`, `unzipper`, `archiver`, `multer`, `@nestjs/jwt`, `zod`, `@modelcontextprotocol/sdk`; **new**: `diff` + `@types/diff` (API), `monaco-editor` (admin). No new app dependency.

**Storage**: S3-compatible bucket (agent prefixes `agents/<id>/`; new platform prefixes `imports/<agentId>/<importId>.zip` and `proposals/<id>/content`); PostgreSQL via Prisma — one new model `FileChangeProposal` (`api/src/slices/agent/file/file.prisma`, merged by `prisma-import`; migration under `api/prisma/migrations/`).

**Testing**: API — jest run directly (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run test`). Admin/app — `bun test slices` for pure utils, `npx nuxt typecheck` (revert regenerated SDK files after). Manual scenarios in quickstart.md.

**Target Platform**: Linux containers on k3s (API + both consoles); S3 may be in-cluster MinIO (drives the "API streams raw files" decision, research R3). Agent pods untouched.

**Project Type**: Web application — `api/` (NestJS, CleanSlice slices) + `admin/` (Nuxt) + `app/` (Nuxt, twin `bridle` slice only).

**Performance Goals**: first slice of any file on screen < 1 s; a 5 MB file scrollable end to end without a manual action and without blocking the main thread > 1 s (Monaco virtualisation + 256 KB appends); import preview of 200 files / 5 MB < 5 s and apply < 30 s; a 2,000-file set card renders < 2 s (counts + 50 rows only); Monaco chunk loaded only on the Files tab.

**Constraints**: zero writes before Apply/confirm (FR-018/SC-005); every inline diff bounded (FR-022/023); one configurable value per limit (FR-030); OpenAPI-generated SDK only; client state per `docs/state.md`; admin English-only, app strings via `en.json` + `bun run i18n:sync`; tools per `docs/agent-tools.md` (topic/title/template, `confirm` on destructive, spec, no secrets); no runtime image change; no commits without `CLEAN-112`.

**Scale/Scope**: workspaces of ~200 files / few MB today, archives up to 100 MB / 2,000 entries; 12 new or changed API routes, 5 new tools, 1 Prisma model, 2 bridle events, ~10 new admin components + 1 new store, 1 app component + store handlers.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template; the repository's standing rules are the gate.

| Gate (source) | Status | How the plan satisfies it |
|---|---|---|
| Jira first, branch from `origin/main`, `CLEAN-<n>` in every commit (`CLAUDE.md`) | PASS | CLEAN-112 in progress; branch `feat/CLEAN-112-advanced-file-management` from `733e755` |
| OpenAPI: regenerate, never hand-write DTO types (`CLAUDE.md`) | PASS | new routes → `generate:swagger` → `build:api` in admin and app; gateways map DTO → domain |
| Client state: entity lives once in its store, fetches upsert, pushes patch, `useAsyncData` for loading only (`docs/state.md`) | PASS | `agentFile` store extended (tabs/drafts/selection keyed by agent); new `fileProposal` store shared by bridle and Files tab; `proposal_update` patches with optimistic Apply + rollback |
| Twin consoles: touching `bridle` means both, and the PR says which and why (`CLAUDE.md`) | PASS | `ProposalCard` + store handlers + transcript merge in admin **and** app; Files tab is admin-only (no twin exists — stated in PR) |
| i18n: `en.json` per slice is the source, `i18n:sync` generates `ru` (`docs/i18n.md`) | PASS | app card strings in `app/slices/bridle/i18n/en.json`; admin English-only |
| Agent tools: a console capability ships its tool with topic/title/template, confirm on destructive, spec, no secrets (`docs/agent-tools.md`) | PASS | five tools in `file.tool.ts` (contracts/tools.md); local file picker is the documented console-only exception, named in `import_agent_files`'s description |
| Tools reuse the controller's services, never re-implement rules | PASS | tools inject `IFileGateway`, `WorkspaceArchiveService`, `FileProposalService` — the same the controller uses; console Apply and tool confirm hit `FileProposalService.apply` |
| No data loss paths (CLEAN-50/56 protections) | PASS | import only writes after a plan; `replace` double-acknowledged; imported objects are newer than the agent's pull, so `SyncGuardService` warns on Sync; save carries `ifUnmodifiedSince` |

Post-design re-check (after Phase 1): no violations. One new platform-owned S3 prefix pair (`imports/`, `proposals/`) outside agent prefixes is a design choice, not a rule breach; documented in data-model.md.

## Project Structure

### Documentation (this feature)

```text
specs/017-advanced-file-management/
├── plan.md              # This file
├── spec.md              # Feature spec (5 stories, FR-001…FR-031)
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: FileNode+, ImportStage/Plan/Result, FileChangeProposal, limits, stores
├── quickstart.md        # Phase 1: automated checks + 5 manual scenarios
├── contracts/
│   ├── files.openapi.yaml   # routes: limits, content(createOnly/ifUnmodifiedSince), open-link, raw, export(paths), delete(paths), import/stage|plan|apply, proposals/*
│   ├── tools.md             # list/read/write/create/import tools + confirm convention
│   └── bridle-events.md     # proposal / proposal_update, rendering rules, transcript merge
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
api/src/slices/agent/file/
├── file.prisma                          # NEW: FileChangeProposal
├── file.controller.ts                   # + limits, open-link, raw, export(POST), delete(body), content(createOnly/ifUnmodifiedSince)
├── fileImport.controller.ts             # NEW: import/stage (multipart), import/:id/plan, import/:id/apply
├── fileProposal.controller.ts           # NEW: proposals list/get/content/diff/apply/skip
├── file.tool.ts (+ .spec.ts)            # + list_agent_files, read_agent_file, write_agent_file, create_agent_file, import_agent_files
├── file.module.ts                       # providers + JwtModule for open links
├── domain/
│   ├── file.types.ts                    # IFileNode.kind/editable, ImportPlan, ImportResult, IFileChangeProposal
│   ├── file.limits.ts                   # NEW: every limit, env-overridable
│   ├── fileKind.ts (+ .spec.ts)         # NEW: TEXT_EXTENSIONS, classify(path, head)
│   ├── workspaceArchive.service.ts (+ .spec.ts)   # NEW: validate, stripWrapper, plan, apply
│   ├── fileProposal.service.ts (+ .spec.ts)       # NEW: propose/proposeImport, diff+caps, apply/skip, stale, publish
│   ├── openLink.service.ts (+ .spec.ts)           # NEW: mint/verify JWT
│   ├── syncGuard.service.ts             # unchanged (imports are "newer" by LastModified)
│   └── transcriptReader.service.ts      # unchanged
├── data/
│   ├── file.gateway.ts                  # readRange UTF-8 trim, list classification, putObject for any text kind, exportZip(paths), stage/proposal prefixes, streamRaw
│   └── fileProposal.repository.ts       # NEW: Prisma access
└── dtos/                                # FileNodeDto+, FileLimitsDto, OpenLinkDto, ImportPlanDto, ImportResultDto, FileChangeProposalDto, …

api/src/slices/bridle/
├── domain/bridle.types.ts               # IBridleProposalEvent, IBridleProposalUpdateEvent; 'proposals' capability
├── domain/bridle.gateway.ts             # + sendToAgentClients(agentId, data)
├── data/bridle.gateway.ts               # implementation
├── handlers/bridleClientWs.handler.ts   # capability gating for the two events
└── bridle.controller.ts                 # transcript response + proposals

admin/slices/agent/file/
├── stores/agentFile.ts                  # + limits, openTabs, activePath, drafts, selection, loaded slices; proposal-aware save
├── stores/fileProposal.ts               # NEW (shared with bridle)
├── domain/agentFile.{types,gateway,service}.ts   # + open link, import stage/plan/apply, export(paths), delete(paths), proposals
├── data/agentFile.{gateway,mapper}.ts   # generated SDK calls
├── composables/useMonaco.ts             # NEW: lazy client-only loader + workers
└── components/agentFile/
    ├── Provider.vue                     # layout: header pill, explorer, tabs, editor, status bar; ?proposal= handling
    ├── Explorer.vue / ExplorerRow.vue   # NEW: filter, checkboxes, size/modified, bulk panel
    ├── Tabs.vue                         # NEW
    ├── Editor.vue                       # Monaco, auto-load slices, JSON badge, Ln/Col, Save/Discard
    ├── DiffView.vue                     # NEW: side-by-side (proposal compare)
    ├── ImportDialog.vue                 # NEW: pick → plan → mode → confirm → result
    ├── NewFileDialog.vue                # NEW
    └── Viewer.vue / Tree.vue / TreeNode.vue   # removed or folded into Explorer/Editor

admin/slices/bridle/
├── stores/bridle.ts                     # 'proposal' / 'proposal_update' handlers, transcript merge, capability
└── components/bridle/ProposalCard.vue   # NEW (+ Message.vue slot)

app/slices/bridle/
├── stores/bridle.ts                     # same handlers, read-only
├── components/bridle/chat/ProposalCard.vue   # NEW, read-only
└── i18n/en.json (+ generated ru.json)

docs/agent-tools.md                      # inventory row for the five tools (if the doc keeps one)
```

**Structure Decision**: web application with the existing CleanSlice layout. All file logic stays in the `agent/file` slice (two new controllers keep `file.controller.ts` readable); bridle only learns two hub → client events; the admin Files tab is rebuilt inside its existing slice; the app console receives the twin half of `bridle` only.

## Phase 0 — Research (complete)

See [research.md](./research.md): R1 preview cut and slice safety, R2 text/binary classification, R3 open link via API stream, R4 import staging/plan/apply, R5 tools and the confirm-with-proposalId convention, R6 API-published cards (no runtime change), R7 diff caps, R8 Monaco, R9 explorer endpoints, R10 twin/i18n, R11 tests, R12 migration/config. No `NEEDS CLARIFICATION` remains.

## Phase 1 — Design (complete)

- [data-model.md](./data-model.md): extended `FileNode`, slice rule, open-link token, import stage/plan/result, `FileChangeProposal` with state machine, event payloads, limits table, store shapes.
- [contracts/files.openapi.yaml](./contracts/files.openapi.yaml): every new or changed route with status codes.
- [contracts/tools.md](./contracts/tools.md): the five tools, descriptions, refusals, spec expectations.
- [contracts/bridle-events.md](./contracts/bridle-events.md): `proposal`, `proposal_update`, rendering rules per state, transcript merge, capability flag, console follow-up message.
- [quickstart.md](./quickstart.md): automated checks and five manual scenarios mapped to the user stories.

## Delivery order (input for /speckit-tasks)

1. **Foundation (API)**: `file.limits.ts`, `fileKind.ts`, `IFileNode.kind/editable`, `readRange` trim, `assertWritable` by kind, `content` `createOnly`/`ifUnmodifiedSince`, `limits` route, swagger regen. *Unblocks US1 and US5 in the console.*
2. **US1 console**: Monaco composable, Editor with auto-load + JSON badge, open-link + raw route, Explorer basics (binary state, Open full, Download).
3. **US2 API + console**: `WorkspaceArchiveService`, import controller, ImportDialog, restart hint, Sync-guard check.
4. **Proposals (API)**: Prisma model + migration, `FileProposalService` (diff caps, states), proposal controller, bridle events + `sendToAgentClients`, transcript `proposals`.
5. **US3 tools**: five tools + spec + Tools panel check; import from attachment/URL.
6. **US4 consoles**: `fileProposal` store, `ProposalCard` admin (actions) and app (read-only), transcript merge, `?proposal=` edit flow, DiffView, i18n sync.
7. **US5 explorer**: filter, selection + bulk export/delete, tabs/drafts, New file, header pill.
8. **Wrap-up**: docs/agent-tools.md inventory, quickstart pass, PR with twin-console statement, Jira checkpoints (large task: one comment per numbered step).

## Risks and mitigations

- **Monaco bundle / SSR**: client-only dynamic import, workers via `?worker`; verify `nuxt build` output chunk and that other tabs do not load it.
- **Multipart ETags** make `change` detection pessimistic: documented in plan warnings; harmless (extra writes, no loss).
- **Active turn absent** when a tool proposes: card appears on reload only; contract says so. Verify with a tool call issued from the Tools panel template.
- **In-cluster S3 reachability**: avoided by streaming through the API (R3); throughput for 25 MB files acceptable at console scale.
- **Concurrency on Apply** (card and tool confirm racing): conditional update on `status = pending`; second caller receives the final row.
- **Attachment scope**: `import_agent_files` fetches the attachment by the *chat* agent id (Rancher), not the target; covered by a tool spec case.

## Complexity Tracking

No constitution violations to justify. Two design choices worth naming: (1) two extra controllers in the file slice instead of one large one (readability; same module); (2) a Prisma table for proposals rather than S3 metadata (needs indexed queries by chat/channel/time for the transcript merge and a conditional update for Apply).
