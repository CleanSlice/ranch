# Implementation Plan: Files Import — Whole Workspace or Selected Files

**Branch**: `feat/CLEAN-192-files-import-modes` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md) | **Ticket**: [CLEAN-192](https://dreamvention.atlassian.net/browse/CLEAN-192)

**Input**: Feature specification from `specs/024-files-import-modes/spec.md`

## Summary

The Files tab's Import dialog gets a mode switch. **Whole workspace** is the
CLEAN-112 zip flow, untouched. **Selected files** takes a few plain files,
matches each by exact file name anywhere in the workspace (API rule, shared
with the agent tool), lets the operator settle ambiguous names before any
upload, then stages the files as a server-built zip so the existing
plan → apply pipeline, result, restart hint, Sync marking and proposal card
are reused as-is. Two new API routes (`resolve`, `stage-files`), one new limit,
one optional parameter on `validate`, one optional guard on `apply`, an
extended `import_agent_files` tool, and one reworked dialog. No Prisma change.

## Technical Context

**Language/Version**: TypeScript 5 on Bun (API: NestJS 11 + Prisma 6 + PostgreSQL; admin: Nuxt 4 / Vue 3.5 / Pinia / Tailwind / shadcn-vue on reka-ui).

**Primary Dependencies**: existing `archiver` (build the files stage), `unzipper` (read it back), `multer` via `@nestjs/platform-express` (`FilesInterceptor`), `zod` (tool params), `@aws-sdk/client-s3`. No new dependency anywhere.

**Storage**: S3 only — the existing `imports/<agentId>/<importId>.zip` stage with two new metadata fields (`kind`, `expected`). PostgreSQL untouched (proposals keep `op: 'import'`).

**Testing**: API — jest run directly (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file`), typecheck via `cd api && bun run build` (no `tsc` bin). Admin — `bun test slices` for pure utils, `npx nuxt typecheck` (revert regenerated SDK files after). Manual scenarios in [quickstart.md](./quickstart.md).

**Target Platform**: Linux containers on k3s; single API process (hub/chat/MCP in memory — the `running` set stays per-process as today).

**Project Type**: Web application — `api/` (NestJS slices) + `admin/` (Nuxt). `app/` has no files capability; nothing to touch there beyond a `build:api` regen check.

**Performance Goals**: `resolve` under 1 s for a 2,000-file workspace (one S3 list, in-memory map by basename); preview of 3 files / 1 MB within 3 s, apply within 10 s (SC-003); the archive flow keeps CLEAN-112's numbers (SC-004).

**Constraints**: zero writes before confirm (FR-006); one rule for name matching, in the API (constitution VII, SC-005); every limit from `file.limits.ts` and echoed by `/files/limits`; OpenAPI-generated SDK only; admin English-only; client state per `docs/state.md`; the tool keeps `topic` / `title` / `template` / `destructive` and the confirm-by-proposal convention; no commits without `CLEAN-192`.

**Scale/Scope**: up to 20 files × 25 MB per selected-files import; 2 new routes + 1 field on an existing one; 1 new domain file + 2 optional parameters; 1 tool extended; 1 dialog reworked, 1 store extended, 1 small util; ~6 spec files touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How the plan satisfies it |
|---|---|---|
| I. The slice is the unit | PASS | Everything lands in `api/src/slices/agent/file` and `admin/slices/agent/file`; the tool reads attachments through `IBridleAttachmentGateway`, the bridle slice's public surface, as today. |
| II. Twin consoles | PASS | `agent/file` has no twin (`app/slices/agent` has no `file`); `bridle` is untouched because the tool keeps `op: 'import'` and the set card is unchanged. The PR says so in words. |
| III. Secrets stay behind `api/` | PASS | No credential introduced; S3 access stays in `IFileGateway`. |
| IV. One entity, one store | PASS | Resolve rows and chosen targets are dialog-local request state, not an entity; the file list stays in `agentFile`; `applyImport` already refetches and reloads tabs. `importMode` is UI state in the slice store. |
| V. Console is a window, chat is the hands | PASS | The new capability is backed by the extended `import_agent_files` (contracts/tools.md): same services, `destructive: true`, confirm-by-proposal, operator-gated, `stripSecrets`. |
| VI. English is the source | PASS | Admin only, English-only strings; no `app` copy. |
| VII. A rule stays a rule | PASS | Name matching is a deterministic function (exact basename, `sessions/` excluded, operator decides ties); no model judgment anywhere. |
| Generated code is generated | PASS | `generate:swagger` → `build:api` in admin (and app, to prove nothing breaks); gateway maps DTO → domain. |
| Tracker / surface marking | PASS | CLEAN-192 `[ADMIN][API]`, labels `admin`, `api`; branch `feat/CLEAN-192-files-import-modes` from `origin/main` `70b2a262`. |
| Quality gates | PLANNED | Commands above named in the PR; thresholds (20 files, 25 MB, `sessions/` exclusion) carry their reasons in research.md R4/R5. |

**Post-design re-check (after Phase 1)**: no violations. The one judgment call —
reusing the zip stage for plain files instead of a second stage format — is a
simplification, not a rule breach; its two side effects (wrapper stripping,
ETag guard) are handled explicitly (research R2) and tested.

## Project Structure

### Documentation (this feature)

```text
specs/024-files-import-modes/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0: R1–R10
├── data-model.md        # Phase 1: resolve row, target, stage meta, limits, store shape
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── files-import.openapi.yaml   # resolve, stage-files, limits delta, apply note
│   └── tools.md                    # import_agent_files delta
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
api/src/slices/agent/file/
├── domain/
│   ├── file.limits.ts                 # + IMPORT_MAX_FILES, importMaxFiles
│   ├── import.types.ts                # + IResolveRow, IImportTarget, stage meta kind/expected
│   ├── selectedFiles.ts               # NEW: resolveSelectedFiles(), validateTargets(), buildFilesZip()
│   ├── selectedFiles.spec.ts          # NEW
│   ├── workspaceArchive.service.ts    # validate(zip, { stripWrapper }), apply(…, guard)
│   ├── workspaceArchive.service.spec.ts
│   ├── fileProposal.service.ts        # applySet honours kind: 'files'
│   └── index.ts                       # exports
├── dtos/
│   ├── importResolve.dto.ts           # NEW: request/response
│   ├── importStageFiles.dto.ts        # NEW: targets/targetFolder form fields
│   ├── fileLimits.dto.ts              # + importMaxFiles
│   └── index.ts
├── fileImport.controller.ts           # + resolve, + stage-files; apply refuses replace on files stage
├── fileImport.controller.spec.ts
├── file.tool.ts                       # import_agent_files: attachmentIds/targetFolder/targets, needs_choice
└── file.tool.spec.ts

admin/slices/agent/file/
├── components/agentFile/
│   ├── ImportDialog.vue               # mode tabs, selected-files branch (resolve → targets → preview)
│   └── Provider.vue                   # passes activeFolder to the dialog
├── domain/agentFile.types.ts          # + IResolveRow, IImportTarget, importMaxFiles
├── domain/agentFile.gateway.ts        # + resolveImportFiles, stageImportFiles
├── domain/agentFile.service.ts
├── data/agentFile.gateway.ts          # resolve via SDK, stage-files via XHR multipart
├── data/agentFile.mapper.ts           # toResolveRows, toLimits(+importMaxFiles)
├── stores/agentFile.ts                # importMode, resolveImportFiles, stageImportFiles
├── utils/importTargets.ts             # NEW: row label / settled / confirmable rules
└── utils/importTargets.test.ts        # NEW

docs/agent-tools.md                    # one line under import_agent_files (plain files)
```

**Structure Decision**: two existing slices extended in place. The API keeps
one controller for import (`fileImport.controller.ts`) and one archive
service; the matching rule and the zip builder for plain files live in a new
domain file so the controller and the tool import the same functions.

## Phase 0 — Research

Done: [research.md](./research.md). No `NEEDS CLARIFICATION` remained in the
Technical Context; the ten decisions are the pipeline reuse (R2), the
two-call resolve/stage flow (R3), the limit (R4), the exact matching rule
(R5), the tool extension (R6), the mode memory (R7) and the dialog shape (R8).

## Phase 1 — Design

Done: [data-model.md](./data-model.md), [contracts/](./contracts/),
[quickstart.md](./quickstart.md). Spec amended in one edge case (target
folder deleted meanwhile) to match storage semantics.

## Implementation outline (for `/speckit-tasks`)

1. **API domain**: `IMPORT_MAX_FILES`; `selectedFiles.ts` with
   `resolveSelectedFiles` (pure, over `listWithEtags` output),
   `validateTargets` (unique / candidate / `<folder>/<name>` rule + `safeEntryPath`),
   `buildFilesZip` (archiver → Buffer); `validate(zip, { stripWrapper })`;
   `apply(agentId, entries, plan, guard?)`; stage meta `kind` / `expected`.
   Specs first.
2. **API routes**: `POST …/import/resolve`, `POST …/import/stage-files`
   (`FilesInterceptor`, `targets` JSON field, `targetFolder`), `apply`
   refuses `replace` on a files stage; `loadStage` passes `stripWrapper`
   from the meta; `FileLimitsDto.importMaxFiles`. Controller spec.
3. **API tool**: `import_agent_files` routing, `needs_choice`, stage with
   `kind: 'files'`, description/title/template update; `applySet` honours
   the files stage. Tool spec. `docs/agent-tools.md` line.
4. **SDK regen**: `cd api && bun run generate:swagger`; `cd admin && bun run
   build:api`; `cd app && bun run build:api` (prove clean, nothing else).
5. **Admin data/domain/store**: types, gateway (SDK resolve, XHR
   stage-files with progress), mapper, service, store (`importMode`,
   `resolveImportFiles`, `stageImportFiles`); `importTargets.ts` util + test.
6. **Admin dialog**: tabs, selected-files branch with target table and
   choosers, zip-in-files-mode offer, non-zip-in-workspace-mode refusal,
   limits from the store, shared result/restart steps; `Provider.vue` passes
   `activeFolder`.
7. **Gates & delivery**: jest, `bun run build` (api), `bun test slices` +
   `npx nuxt typecheck` (admin, revert SDK noise), quickstart scenarios 1–4,
   PR with the twin-console sentence and commands run, CLEAN-192 → In Testing.

## Complexity Tracking

No constitution violations to justify.
