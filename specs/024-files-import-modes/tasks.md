# Tasks: Files Import — Whole Workspace or Selected Files (CLEAN-192)

**Input**: Design documents from `specs/024-files-import-modes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The constitution's quality gate requires typecheck and tests to pass for every project touched, and the plan (research R10) names the specs. Each story carries its spec tasks before the code they cover; write the spec, watch it fail, then implement.

**Organization**: Grouped by user story. US1 (selected files) and US2 (the switch, and the archive flow untouched) are both P1; the dialog shell they share is in the foundational phase so either can be finished and demonstrated first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- API: `api/src/slices/agent/file/` (NestJS slice; jest specs next to the code, run with `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`, never `bun run test`)
- Admin: `admin/slices/agent/file/` (Nuxt slice; `bun test slices` for utils, `npx nuxt typecheck`, no Prettier — patch surgically)
- App: untouched except the SDK regen check

---

## Phase 1: Setup

**Purpose**: Branch, ticket and baseline are already in place; this phase pins the starting point and the baseline results so regressions are attributable.

- [X] T001 Confirm the branch `feat/CLEAN-192-files-import-modes` is on `origin/main` `70b2a262` and restore the tracked `.specify/scripts/python/__pycache__/common.cpython-314.pyc` the SpecKit scripts rewrote (`git checkout -- .specify/scripts/python/__pycache__/common.cpython-314.pyc`)
- [X] T002 [P] Run the baseline API gate and record the result in the ticket comment at the end: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file` (note any flake the memory file lists as baseline, if one appears)
- [X] T003 [P] Run the baseline admin gate: `cd admin && bun test slices && npx nuxt typecheck`, then revert the regenerated SDK files (the paths `git status` shows under `admin/`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain rule, the pipeline hooks, the limit, the regenerated SDK and the dialog shell that every story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### API domain

- [X] T004 Add `IMPORT_MAX_FILES` (env `RANCH_FILES_IMPORT_MAX_FILES`, default 20, reason: one screen of preview rows) to `api/src/slices/agent/file/domain/file.limits.ts`, add `importMaxFiles` to `IFileLimits` and `fileLimits()`, and add the `@ApiProperty` field to `api/src/slices/agent/file/dtos/fileLimits.dto.ts`
- [X] T005 [P] Extend `api/src/slices/agent/file/domain/import.types.ts`: `IImportStageMeta.kind?: 'archive' | 'files'` and `expected?: Record<string, string | null>`; new `ResolveMatch = 'unique' | 'none' | 'ambiguous'`, `IResolveRow { name, match, path, candidates, size }`, `IImportTarget { name, path }` (data-model §1–§3); export from `api/src/slices/agent/file/domain/index.ts`
- [X] T006 [P] Write `api/src/slices/agent/file/domain/selectedFiles.spec.ts` (jest) covering: unique / none / ambiguous match; `sessions/` and `data/sessions/` excluded; case-sensitive (`Soul.md` ≠ `SOUL.md` → none); duplicate names refused; name with `/` or `\` or a control char refused; target folder `''` → root path, `skills/x` → `skills/x/<name>`; `validateTargets` accepts the unique match, a candidate, or `<folder>/<name>` and refuses anything else; `buildFilesZip` round-trips through `unzipper` with the given paths intact (including three files under one custom folder)
- [X] T007 Implement `api/src/slices/agent/file/domain/selectedFiles.ts`: `resolveSelectedFiles(names, targetFolder, existing: { path, size, etag }[]): IResolveRow[]` (pure, basename map, candidates sorted), `validateTargets(targets, rows, targetFolder)` (throws `BadRequestException` naming the offender; reuses the path rules — move `safeEntryPath` out of `WorkspaceArchiveService` into an exported helper in this file so both use it), `buildFilesZip(entries: { path, bytes }[]): Promise<Buffer>` with `archiver` (`zlib.level` 6, same as `exportZip`). Make T006 pass
- [X] T008 [P] Extend `api/src/slices/agent/file/domain/workspaceArchive.service.spec.ts`: `validate(zip, { stripWrapper: false })` keeps `notes/a.md` + `notes/b.md` as-is while the default still strips a wrapper; `apply(agentId, entries, plan, guard)` refuses a row whose current ETag differs from `guard[path]` with `reason: 'changed since previewed'` and still writes the others; `guard` with `null` for a path that now exists → refused the same way; no guard → unchanged behaviour
- [X] T009 Change `api/src/slices/agent/file/domain/workspaceArchive.service.ts`: `validate(zip, opts: { stripWrapper?: boolean } = {})` (default `true`), `apply(agentId, entries, plan, guard?: Record<string, string | null>)` comparing `listWithEtags` output against the guard before `putObjectRaw`. Keep every existing spec green. Make T008 pass
- [X] T010 Make `putStage` / `getStage` in `api/src/slices/agent/file/data/file.gateway.ts` carry `kind` and `expected` through the stage's S3 metadata (JSON, as `IImportStageMeta` is stored today); an absent `kind` reads as `'archive'`. Cover it in the controller spec through the mocked gateway (T015) unless an existing gateway spec already exercises `putStage`

### SDK and admin shell

- [X] T011 Regenerate after T004: `cd api && bun run generate:swagger`; `cd admin && bun run build:api`; `cd app && bun run build:api` (app must stay clean; commit app SDK changes only if the generated output legitimately changed)
- [X] T012 Add `importMode: Ref<'workspace' | 'files'>` (default `'workspace'`, not persisted — research R7) and `setImportMode()` to `admin/slices/agent/file/stores/agentFile.ts`; add `importMaxFiles` to `IFileLimits` in `admin/slices/agent/file/domain/agentFile.types.ts` and to `toLimits` in `admin/slices/agent/file/data/agentFile.mapper.ts`
- [X] T013 Rework the shell of `admin/slices/agent/file/components/agentFile/ImportDialog.vue`: a `Tabs` row (from `#theme/components/ui/tabs`) with **Whole workspace** / **Selected files** bound to `store.importMode`, one sentence under each, enabled only while `step === 'pick'`; title "Import" with the mode sentence as the description; the existing archive branch unchanged behind `mode === 'workspace'`; add a `folder?: string | null` prop; `admin/slices/agent/file/components/agentFile/Provider.vue` passes `:folder="activeFolder"` to the dialog (line ~544)

**Checkpoint**: API domain specs green, SDK regenerated, dialog shows two tabs with the archive flow working under the first one.

---

## Phase 3: User Story 1 — Replace or add a few files without building an archive (Priority: P1) 🎯 MVP

**Goal**: Drop two or three plain files, see per-file target and action (replace / add / unchanged), settle ambiguous names, confirm, get the result and restart hint.

**Independent Test**: quickstart Scenario 2 (replace `SOUL.md`, unchanged `HEARTBEAT.md`, add `notes.md`) and Scenario 3 (ambiguous `SKILL.md`, limits, duplicate, changed-since-previewed).

### API routes

- [X] T014 [P] [US1] Write `api/src/slices/agent/file/dtos/importResolve.dto.ts` (`ImportResolveRequestDto { names: string[], targetFolder?: string }` with `@IsArray` / `@ArrayMaxSize(IMPORT_MAX_FILES)` / `@IsString({ each: true })`; `ImportResolveRowDto`; `ImportResolveResponseDto { targetFolder, rows }`) and `api/src/slices/agent/file/dtos/importStageFiles.dto.ts` (`ImportStageFilesDto { targets: string (JSON), targetFolder?: string }`), matching `contracts/files-import.openapi.yaml`; export both from `api/src/slices/agent/file/dtos/index.ts`
- [X] T015 [P] [US1] Extend `api/src/slices/agent/file/fileImport.controller.spec.ts`: `resolve` returns rows from the mocked `listWithEtags` and 404s an unknown agent; `stage-files` refuses a target outside the resolved set (400), duplicate names (400), no files (400), more than `IMPORT_MAX_FILES` (413), and on success calls `putStage` with `kind: 'files'` and an `expected` map and returns a merge plan; `apply` with `mode: 'replace'` on a stage whose meta says `'files'` → 400; `apply` passes `meta.expected` as the guard
- [X] T016 [US1] Add to `api/src/slices/agent/file/fileImport.controller.ts`: `@Post('resolve')` (`operationId: resolveAgentImportFiles`, `refuseAgentWrite`, `assertAgent`, `resolveSelectedFiles` over `listWithEtags`); `@Post('stage-files')` (`operationId: stageAgentImportFiles`, `FilesInterceptor('files', IMPORT_MAX_FILES, { limits: { fileSize: IMPORT_MAX_FILE_BYTES } })`, parse `targets` JSON, re-resolve, `validateTargets`, md5 + `IArchiveEntry[]`, `buildFilesZip`, `putStage` with `{ kind: 'files', expected }`, `plan` with `mode: 'merge'`); in `apply` and `loadStage` read the meta: `'files'` → `validate(zip, { stripWrapper: false })`, refuse `replace` with 400 `Selected files never remove anything`, pass `meta.expected` to `apply`. Swagger decorators per the contract. Make T015 pass
- [X] T017 [US1] Teach `applySet` in `api/src/slices/agent/file/domain/fileProposal.service.ts` the same meta rules (no wrapper strip, refuse replace, guard) so a files stage applied from a card behaves like one applied from the dialog; add one case to `api/src/slices/agent/file/domain/fileProposal.service.spec.ts`
- [X] T018 [US1] Regenerate the SDK again after T016: `cd api && bun run generate:swagger`, `cd admin && bun run build:api`, `cd app && bun run build:api`

### Admin data / domain / store

- [X] T019 [P] [US1] Add `IResolveRow`, `ResolveMatch`, `IImportTarget` to `admin/slices/agent/file/domain/agentFile.types.ts`; add `resolveImportFiles(agentId, names, targetFolder)` and `stageImportFiles(agentId, files: File[], targets, targetFolder, onProgress?)` to `admin/slices/agent/file/domain/agentFile.gateway.ts` and `admin/slices/agent/file/domain/agentFile.service.ts`
- [X] T020 [P] [US1] Write `admin/slices/agent/file/utils/importTargets.test.ts` (bun test): `rowLabel(row)` → "replaces <path>" / "new, <folder or root>" / "choose…"; `settled(row)` true only with a path; `confirmable(plan)` false when every entry is `unchanged`; `isLoneZip(files)` true for exactly one `.zip` (case-insensitive); `overLimits(files, limits)` names the first breach (count, per-file size)
- [X] T021 [US1] Implement `admin/slices/agent/file/utils/importTargets.ts` to make T020 pass (pure functions, no Vue)
- [X] T022 [US1] Implement in `admin/slices/agent/file/data/agentFile.gateway.ts`: `resolveImportFiles` via the generated `FilesService.resolveAgentImportFiles` + `unwrapEnvelope` + a new `toResolveRows` in `admin/slices/agent/file/data/agentFile.mapper.ts`; `stageImportFiles` as an XHR multipart (`files` appended per file, `targets` JSON string, `targetFolder`) with the same progress / error handling as `stageImport` (lines ~195–245), returning `IImportPlan`
- [X] T023 [US1] Add `resolveImportFiles` and `stageImportFiles` pass-throughs to `admin/slices/agent/file/stores/agentFile.ts` next to `stageImport`; `applyImport` stays as is (it already refetches, forgets stale slices, reloads tabs without drafts, marks a pending restart)

### Admin dialog

- [X] T024 [US1] Add the selected-files branch to `admin/slices/agent/file/components/agentFile/ImportDialog.vue`: drop zone accepting multiple files ("Drop files here or click to choose · up to {importMaxFiles} files, {importMaxFileBytes} each", `multiple` on the input); on drop → `overLimits` check → `resolving` (`store.resolveImportFiles(names, folder)`) → `targets` step: a table with name, target (path, "new, <folder>", or a select of candidates + "Add as new in <folder>"), size; **Preview** enabled only when every row is settled → `uploading` with progress → `plan` step reusing the existing plan table but with `change` labelled **replace** and no Merge/Replace or sessions controls → **Import** enabled only when `confirmable(plan)` → `applying` via `store.applyImport(agentId, importId, { mode: 'merge', includeSessions: false })` → the shared `result` step (written / skipped / failed with reasons, restart hint, Restart now / Later)
- [X] T025 [US1] Error surfacing in `admin/slices/agent/file/components/agentFile/ImportDialog.vue`: a 400 from `resolve` / `stage-files` shows its message in the existing error strip and returns to `pick`; a `failed` row with `changed since previewed` is listed under the result like other failures; a folder drop (`item.webkitGetAsEntry()?.isDirectory`) is refused with "Zip the folder and use Whole workspace"

**Checkpoint**: quickstart Scenarios 2 and 3 pass end to end; `npx jest src/slices/agent/file` and `bun test slices` green.

---

## Phase 4: User Story 2 — The whole-workspace import stays exactly as it is (Priority: P1)

**Goal**: The switch defaults sensibly, refuses the wrong kind of drop per mode, offers to switch for a lone zip, and the CLEAN-112 archive flow is proven unchanged.

**Independent Test**: quickstart Scenario 1, plus the CLEAN-112 quickstart Scenario 2 run unchanged through the **Whole workspace** tab.

- [X] T026 [US2] In `admin/slices/agent/file/components/agentFile/ImportDialog.vue`, `workspace` mode: a non-`.zip` drop is refused with "Pick a .zip with the workspace layout, or switch to Selected files for plain files" (replace the existing message at the `stage()` guard); the drop zone copy stays ".zip with the workspace layout"
- [X] T027 [US2] Same file, `files` mode: when `isLoneZip(files)` the dialog shows an inline choice **Switch to Whole workspace** (sets `store.importMode = 'workspace'` and feeds the file to `stage()`) / **Keep as a file** (continues to `resolve`); nothing is uploaded until chosen
- [X] T028 [US2] Same file: `reset()` no longer touches the mode; the dialog opens on `store.importMode` (default `'workspace'`, so a fresh page starts on the archive tab); switching mode while in `pick` clears the error strip and the selected files
- [ ] T029 [US2] Regression: run the archive flow through the **Whole workspace** tab against a local stack per `specs/017-advanced-file-management/quickstart.md` Scenario 2 (Merge, Replace with the double confirmation, refused traversal entry) and confirm the CLEAN-112 cases in `api/src/slices/agent/file/fileImport.controller.spec.ts` and `api/src/slices/agent/file/domain/workspaceArchive.service.spec.ts` are untouched and green; note the outcome in the PR

**Checkpoint**: Scenario 1 passes; the archive flow is the CLEAN-112 behaviour under the first tab.

---

## Phase 5: User Story 3 — Hand the agent a few files from the chat (Priority: P2)

**Goal**: `import_agent_files` accepts plain attachments, applies the same matching, asks on ambiguity, proposes, and applies on confirm.

**Independent Test**: quickstart Scenario 4.

- [X] T030 [P] [US3] Extend `api/src/slices/agent/file/file.tool.spec.ts` per `contracts/tools.md`: a non-zip `attachmentId` routes to the files path (stage meta `kind: 'files'`, pending proposal, no `putObjectRaw`); `attachmentIds` with two `SKILL.md` → `err` duplicate, no stage; ambiguous name without `targets` → `ok` with `status: 'needs_choice'` and `needsChoice[]`, no proposal row; with a valid `targets` entry → pending proposal; with an invalid path → `err`; `mode: 'replace'` on the files path → `err`; `confirm: true` applies and a moved ETag lands in `failed` with `changed since previewed`; metadata still validates under `McpRegistryService.validateToolMetadata`
- [X] T031 [US3] Change `import_agent_files` in `api/src/slices/agent/file/file.tool.ts`: parameters `attachmentIds?: string[]`, `targetFolder?: string`, `targets?: { name, path }[]`; title "Import files into a workspace", template "Import «attachment(s) or link» into the agent «name»", description plus the plain-files sentence from `contracts/tools.md`; routing by `attachmentIds` or by the zip signature `PK\x03\x04` of a single attachment; the files path = fetch attachments (chat-agent scoped, `IMPORT_MAX_FILES` / `IMPORT_MAX_FILE_BYTES`), `resolveSelectedFiles`, `needs_choice` return, `validateTargets`, `buildFilesZip`, `putStage` with `kind: 'files'` + `expected`, `plan` merge, `proposeImport` unchanged. Make T030 pass
- [X] T032 [P] [US3] Add one line under `import_agent_files` in `docs/agent-tools.md` (plain attachments, name matching, `needs_choice`) and walk the checklist at the end of that doc against the change

**Checkpoint**: Scenario 4 passes; the card and Apply / Skip in both consoles are unchanged (no `bridle` file touched).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T033 Run every gate and keep the output for the PR: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file && bun run build`; `cd admin && bun test slices && npx nuxt typecheck` (revert SDK noise); `cd app && bun run build:api` clean
- [ ] T034 Run quickstart Scenarios 1–4 on a local stack (see the memory notes on the local DB run and the single API process) and fix what fails
- [X] T035 Re-read `specs/024-files-import-modes/spec.md` FR-001…FR-014 against the code and tick each one in a short table in the PR description; confirm no literal limit lives outside `api/src/slices/agent/file/domain/file.limits.ts` (grep for `20` and `25 * MB` in `admin/slices/agent/file`)
- [X] T036 Commit in logical groups with Conventional Commits + ticket (`feat(api): selected-files import rule, routes and tool (CLEAN-192)`, `feat(admin): import dialog modes (CLEAN-192)`), push over HTTPS with the `GIT_CONFIG_GLOBAL` recipe from the memory notes, open the PR into `main` with: the twin-console sentence ("Files tab is admin-only; `app/slices/agent` has no `file`, checked"), the commands run, the FR table; put the PR URL on CLEAN-192 and move it to **In Testing** (transition 51)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup; blocks every story. Inside: T004 → T011; T005/T006 → T007; T008 → T009; T010 after T005; T012/T013 after T011
- **US1 (Phase 3)**: after Phase 2. T014/T015 → T016 → T017 → T018 → T019…T025 (T019 ∥ T020; T021 after T020; T022 after T018 + T019; T023 after T022; T024 after T021 + T023; T025 after T024)
- **US2 (Phase 4)**: after Phase 2 for T026/T028; T027 needs US1's `files` branch (T024); T029 any time after T013
- **US3 (Phase 5)**: after Phase 2 (T007, T009, T010) and T017; independent of the admin tasks
- **Polish (Phase 6)**: after every story the PR will claim

### User Story Dependencies

- **US1** depends only on Foundational
- **US2** depends on Foundational; T027 touches the US1 branch of the dialog, so finish T024 first
- **US3** depends on Foundational + T017; it can proceed in parallel with US1's admin work

### Parallel Opportunities

- Phase 1: T002 ∥ T003
- Phase 2: T005 ∥ T006 ∥ T008 (after T004 in the same checkout); T012 ∥ T013 after T011
- US1: T014 ∥ T015; T019 ∥ T020; API tasks (T014–T018) ∥ admin util tasks (T020–T021)
- US3: T030 ∥ T032, both ∥ US1's admin tasks
- Polish: T033 and T034 can run while T035 is written

---

## Parallel Example: User Story 1

```bash
# API contract side, two files, no overlap:
Task: "T014 DTOs in api/src/slices/agent/file/dtos/importResolve.dto.ts and importStageFiles.dto.ts"
Task: "T015 controller spec cases in api/src/slices/agent/file/fileImport.controller.spec.ts"

# Admin side while the API lands:
Task: "T019 types/gateway/service signatures in admin/slices/agent/file/domain/*"
Task: "T020 importTargets.test.ts in admin/slices/agent/file/utils/"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1)

1. Phase 1, Phase 2 (domain rule, pipeline hooks, limit, SDK, dialog shell)
2. Phase 3 (routes, admin data, dialog branch)
3. **STOP and VALIDATE**: quickstart Scenarios 2 and 3; the archive tab still works by construction (unchanged code path)
4. Demo-able: an operator replaces `SOUL.md` without a zip

### Incremental Delivery

1. Foundational → the switch is visible, archive flow unchanged
2. US1 → selected files end to end (MVP)
3. US2 → the per-mode refusals, the lone-zip offer, the regression run
4. US3 → the chat tool, same rule, same card
5. Polish → gates, quickstart, PR, ticket

### Notes

- Never run `bun run test` in `api/` (kills a running dev API); never run Prettier or ESLint over `admin/`
- Revert admin SDK regen noise before committing unless the SDK legitimately changed (it does, in T011 and T018 — commit those)
- The one judgment call in the design (zip stage for plain files) has two side effects, wrapper stripping and the ETag guard; T006/T008 pin both
