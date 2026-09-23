# Tasks: Advanced Agent File Management (CLEAN-112)

**Input**: Design documents from `specs/017-advanced-file-management/` — plan.md, spec.md, research.md, data-model.md, contracts/{files.openapi.yaml, tools.md, bridle-events.md}, quickstart.md

**Tests**: The spec does not ask for TDD, but two repository rules make tests part of the deliverable: every agent tool ships with its `*.tool.spec.ts` (`docs/agent-tools.md`) and pure utils in the consoles get a `*.test.ts` beside them. Service specs listed in research R11 are folded into the task that creates the service, never a separate optional task.

**Organization**: Setup → foundational API changes (classification, slice safety, save rules, limits) → US1 (editor + large files + open full) → US2 (import) → US3 (tools **and** the proposal core they need) → US4 (cards in both consoles) → US5 (explorer) → polish. US3 sits before US4 because the card is only ever produced by a tool; US4 renders what US3 persists.

**Commands** (from plan.md and memory):
- API tests: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>` — never `bun run test` (re-runs `prisma generate`, kills a running dev API on Windows).
- Prisma: `cd api && bunx prisma migrate dev --name <name>` then `bunx prisma generate` with the dev API stopped.
- Swagger + SDKs: `cd api && bun run generate:swagger && cd ../admin && bun run build:api && cd ../app && bun run build:api`.
- Consoles: `bun test slices`, `npx nuxt typecheck` (not `bun run typecheck`; revert regenerated SDK files if it touched them). App strings: edit `en.json`, run `bun run i18n:sync`.
- Commit at each phase checkpoint with `CLEAN-112` in the subject; post a checkpoint comment on CLEAN-112 after phases 2, 3, 4, 5, 6, 7 (large task: what landed, what's next).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1 any text file + large files · US2 import from the Files tab · US3 tools through the chat · US4 change cards · US5 explorer

## Path Conventions

Web app, CleanSlice layout: `api/src/slices/agent/file/…` (NestJS), `api/src/slices/bridle/…`, `admin/slices/agent/file/…` and `admin/slices/bridle/…` (Nuxt 4), `app/slices/bridle/…` (Nuxt 4, twin). Specs beside the file they test.

---

## Phase 1: Setup

**Purpose**: dependencies and the one module every later task reads limits from.

- [X] T001 Add `diff` + `@types/diff` to `api/package.json` and `monaco-editor` to `admin/package.json` (`bun add` in each), commit the lockfiles; no app dependency
- [X] T002 [P] Create `api/src/slices/agent/file/domain/file.limits.ts` exporting every limit from data-model.md §9 (`MAX_EDIT_BYTES`, `MAX_VIEW_BYTES`, `RANGE_BYTES`, `MAX_RANGE_BYTES`, `OPEN_LINK_TTL_SEC`, `IMPORT_*`, `DIFF_*`, `PROPOSAL_LIST_ROWS`) with env overrides `RANCH_FILES_<NAME>` parsed once at module load, plus `fileLimitsDto()` returning the camelCase shape of contracts/files.openapi.yaml `FileLimits`; replace the literals in `api/src/slices/agent/file/data/file.gateway.ts` (`MAX_BYTES`, `MAX_RANGE_BYTES`, `DEFAULT_RANGE_BYTES`) and `file.controller.ts` (`256 * 1024`) with imports
- [X] T003 [P] Baseline: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file src/slices/bridle` is green before any change; record failing/flaky names, if any, in the Jira start comment

---

## Phase 2: Foundational — classification, slice safety, save rules, limits route

**Purpose**: the API facts every console and tool task depends on: `kind`/`editable` on nodes, slices that never split a character, saves for any text kind with `createOnly` / `ifUnmodifiedSince`, bulk delete/export bodies, and `GET …/files/limits`.

**⚠️ CRITICAL**: no story work starts before T009 (SDK regenerated) is done.

- [X] T004 Create `api/src/slices/agent/file/domain/fileKind.ts` (+ `fileKind.spec.ts`): `TEXT_EXTENSIONS` (the list from spec Assumptions), `kindFromPath(path)` → `'text' | 'binary' | 'unknown'`, `sniffKind(head: Buffer)` (NUL byte → binary; invalid UTF-8 → binary; else text), `isEditable(kind, size)` using `MAX_EDIT_BYTES`; spec covers extension hits, extension-less `Makefile` sniff, NUL → binary, invalid UTF-8 → binary
- [X] T005 Extend `IFileNode` with `kind: 'text' | 'binary'` and `editable: boolean` in `api/src/slices/agent/file/domain/file.types.ts`; add `kind`/`editable` to `api/src/slices/agent/file/dtos/fileNode.dto.ts` and `fileContent.dto.ts`/`fileChunk.dto.ts` (`kind` on chunks so the viewer knows before the first byte)
- [X] T006 In `api/src/slices/agent/file/data/file.gateway.ts`: `list()` classifies each key via `kindFromPath`, and for `'unknown'` fetches the first 8 KB (`Range: bytes=0-8191`) and sniffs; `readRange()` trims a trailing partial UTF-8 sequence before decoding and sets `nextOffset`/`size` to the trimmed length, and refuses `kind === 'binary'` with 400 "not a text file"; replace `assertWritableExt` with `assertWritable(path, size)` = text kind + `size ≤ MAX_EDIT_BYTES`; extend `contentType()` for the recognised formats; add `readRange` trim cases to a new `api/src/slices/agent/file/data/file.gateway.readRange.spec.ts` (2-, 3-, 4-byte sequences cut at each position; ASCII unaffected)
- [X] T007 Save rules in `api/src/slices/agent/file/file.controller.ts` + `dtos/saveFile.dto.ts`: body gains `createOnly?: boolean` (409 when the object exists) and `ifUnmodifiedSince?: string` (412 when S3 `LastModified` is newer); `.json` paths are parsed server-side and refused with `400 "invalid JSON at line L col C"`; `IFileGateway.save` gains an options object `{ createOnly?, ifUnmodifiedSince? }` implemented with `HeadObject` in `file.gateway.ts`; `api/src/slices/agent/file/domain/file.gateway.ts` abstract updated
- [X] T008 Bulk bodies and limits route in `api/src/slices/agent/file/file.controller.ts`: `DELETE /agents/:id/files` accepts a JSON body `{ paths: string[], confirm?: boolean }` (`dtos/deleteFiles.dto.ts` request DTO; loops the existing delete/deletePrefix; 409 with `{ wouldRemove, total }` when the selection empties the workspace and `confirm` is not set); `POST /agents/:id/files/export` with `{ paths?: string[] }` → `exportZip(agentId, paths?)` filtering keys by exact path or folder prefix in `file.gateway.ts`; `GET /agents/:id/files/limits` → `FileLimitsDto` (`dtos/fileLimits.dto.ts`) from `fileLimitsDto()`
- [X] T009 Regenerate: `cd api && bun run generate:swagger && cd ../admin && bun run build:api && cd ../app && bun run build:api`; update `admin/slices/agent/file/domain/agentFile.types.ts` (`kind`, `editable`, `IFileLimits`), `data/agentFile.mapper.ts`, `domain/agentFile.gateway.ts` + `data/agentFile.gateway.ts` + `domain/agentFile.service.ts` (`limits()`, `save(agentId, path, content, { createOnly, ifUnmodifiedSince })`, `remove(agentId, paths[], confirm)`, `exportZip(agentId, paths?)`)
- [X] T010 Extend `admin/slices/agent/file/stores/agentFile.ts` per data-model.md §10: `limits` (fetched once per session), `loaded[agentId][path] = { content, totalSize, nextOffset, hasMore, kind, updatedAt }` with `fetchContent` upserting and a new `fetchMore(agentId, path)` appending the next slice, `drafts[agentId][path] = { content, baseUpdatedAt }`, `openTabs[agentId]`, `activePath[agentId]`, `selection[agentId]`; keep the pending-restart helpers; components keep rendering by `agentId` + `path`

**Checkpoint**: API green, SDKs regenerated, admin typechecks with the old components still mounted. Jira comment #1.

---

## Phase 3: User Story 1 — Open and edit any text file, large files included (Priority: P1) 🎯 MVP

**Goal**: any text format opens in Monaco with highlighting and line numbers and saves; a multi-MB file fills on scroll with no button; **Open full** opens the raw file in a new tab; binary files get download/open only; JSON validity is live and enforced on save.

**Independent Test**: quickstart.md Scenario 1 (Python script editable and saved; 3 MB log streams to the end and is view-only; Open full works and expires; `.png` has no editor; invalid JSON cannot be saved).

- [X] T011 [P] [US1] Create `api/src/slices/agent/file/domain/openLink.service.ts` (+ `openLink.service.spec.ts`): `mint(agentId, path, kind)` → `{ token, expiresAt }` signed with `JwtService` (claims `sub: 'open-link'`, `agentId`, `path`, `kind`, `exp = now + OPEN_LINK_TTL_SEC`), `verify(token)` → claims or `UnauthorizedException`; spec: round-trip, expired token rejected, tampered path rejected; register `JwtModule` (existing secret source) in `api/src/slices/agent/file/file.module.ts`
- [X] T012 [US1] Routes in `api/src/slices/agent/file/file.controller.ts`: `POST /agents/:id/files/open-link` `{ path }` → `{ url, expiresAt }` (`dtos/openLink.dto.ts`; url = API public base + `/agents/:id/files/raw?token=`), and `GET /agents/:id/files/raw?token=` marked public (no `JwtAuthGuard`), verifying the token, `HeadObject` for size/type, streaming the S3 body via a new `IFileGateway.streamRaw(agentId, path)` in `file.gateway.ts`, with `Content-Type: text/plain; charset=utf-8` + `Content-Disposition: inline` for text and stored type + `attachment; filename=` for binary; 404 with a plain-text body when the object is gone
- [X] T013 [P] [US1] Create `admin/slices/agent/file/composables/useMonaco.ts`: client-only lazy `import('monaco-editor')`, `MonacoEnvironment.getWorker` wired to Vite `?worker` imports (editor, json, ts, css, html), language-by-extension map (json, markdown, typescript, javascript, python, shell, yaml, html, css, sql, xml, ini, plaintext), a cached promise so the chunk loads once; add any `vite.optimizeDeps`/`worker.format` entry needed in `admin/nuxt.config.ts`
- [X] T014 [US1] Rewrite `admin/slices/agent/file/components/agentFile/Editor.vue` on Monaco inside `<ClientOnly>`: props `agentId`, `path`; renders `store.loaded[...]` content, `readOnly` until `hasMore === false && editable`; JSON badge from the json worker markers (`Valid JSON ✓` / `Invalid JSON`); status bar `Ln, Col` (`onDidChangeCursorPosition`), format label, size, `Unsaved changes · applies on next restart` / `Saved`, **Discard** and **Save** (`Ctrl/⌘+S` via `addCommand`), save disabled while invalid JSON; a draft edit writes `store.drafts` (not the loaded slice)
- [X] T015 [US1] Auto-load in `Editor.vue` + `stores/agentFile.ts`: on `onDidScrollChange` when the viewport is within two screens of the model end and `hasMore`, call `store.fetchMore` and append with `model.applyEdits` at the end while keeping `scrollTop`; header indicator `loaded X of Y` (formatted bytes) until complete; refuse to open files with `totalSize > limits.maxViewBytes` (show the too-large panel from T016 instead); remove the **Load more** button path and `loadMore()` from `Provider.vue`
- [X] T016 [US1] In `admin/slices/agent/file/components/agentFile/Provider.vue`: binary or over-`maxViewBytes` selection renders a panel (name, size, date, **Download** via `exportZip(agentId, [path])`, **Open full**) and explains "cannot be edited in place"; text files over `maxEditBytes` show the editor read-only with the note "too large to edit here — download or open full"; **Open full** calls `service.openLink(agentId, path)` then `window.open(url, '_blank', 'noopener')` (add `openLink` to `domain/agentFile.gateway.ts`, `data/agentFile.gateway.ts`, `domain/agentFile.service.ts`)
- [X] T017 [US1] Save conflicts in `Provider.vue` + `stores/agentFile.ts`: `save` sends `ifUnmodifiedSince = loaded.updatedAt`; on 412 show a dialog "changed since you opened it" with **Reload** (refetch, keep draft in a diff-free side note) and **Overwrite** (resend without the header); on 409/400 show the API message; after a successful save refresh the node's `size`/`updatedAt` in `filesByAgent` and keep the CLEAN-50 "agent copy is newer" banner logic untouched
- [ ] T018 [US1] Run quickstart.md Scenario 1 end to end; `cd admin && npx nuxt typecheck` clean; confirm the Monaco chunk is requested only when the Files tab mounts (network tab on the Overview tab shows no `monaco` chunk)

**Checkpoint**: US1 demoable on its own. Commit `feat(files): any text file, streamed large files, open full (CLEAN-112)`. Jira comment #2.

---

## Phase 4: User Story 2 — Import a whole workspace from an archive (Priority: P1)

**Goal**: **Import** on the Files tab stages a zip once, shows an add/change/remove/skip plan before any write, applies in Merge (default) or Replace (double-acknowledged), reports the result and offers Restart now / Later.

**Independent Test**: quickstart.md Scenario 2 (export B → import into C merge → tree equals B ∪ C; replace → equals archive; traversal and entry-limit archives refused; Sync guard lists imported files).

- [X] T019 [P] [US2] Create `api/src/slices/agent/file/domain/workspaceArchive.service.ts` (+ `workspaceArchive.service.spec.ts`): `validate(zip: Buffer)` with `unzipper.Open.buffer` → entries or a `BadRequestException` naming the entry/limit (traversal, absolute, drive letter, symlink via unix mode in `externalFileAttributes`, case-duplicate paths, encrypted flag, `IMPORT_MAX_*` limits incl. uncompressed total); `stripWrapper(entries)` when every entry shares one top-level folder; `plan(agentId, entries, { mode, includeSessions })` → `ImportPlan` (add/change/unchanged/remove/skip using MD5 vs S3 ETag, multipart ETag → change + warning, `sessions/` skipped unless included, list capped at `IMPORT_PLAN_LIST_ROWS`); `apply(agentId, importId, plan)` → `ImportResult` (writes with concurrency 4 through `IFileGateway.putObjectRaw`, batch deletes, per-file failures collected, never throws mid-way); spec covers each refusal, wrapper stripping, every classification, replace removals, a failing put recorded not thrown
- [X] T020 [US2] Stage storage in `api/src/slices/agent/file/data/file.gateway.ts` + `domain/file.gateway.ts`: `putStage(agentId, importId, zip, meta)` / `getStage(agentId, importId)` / `deleteStage` under `imports/<agentId>/<importId>.zip` with S3 metadata (`agentId`, `source`, `size`, `entries`, `createdAt`), `sweepStages(olderThanMin)` listing `imports/` and deleting expired objects; `putObjectRaw(agentId, path, bytes: Buffer, contentType)` for binary entries (existing `putObject` is text-only)
- [X] T021 [US2] Create `api/src/slices/agent/file/fileImport.controller.ts` + DTOs (`dtos/importPlan.dto.ts`, `dtos/importResult.dto.ts`, `dtos/importApply.dto.ts`): `POST /agents/:id/files/import/stage` (`FileInterceptor('archive')` with `limits.fileSize = IMPORT_MAX_ARCHIVE_BYTES`, 413 on overflow) → validate → putStage → plan(merge) → `ImportPlanDto`; `GET …/import/:importId/plan?mode&includeSessions`; `POST …/import/:importId/apply` `{ mode, includeSessions, confirmRemove }` (409 when `mode=replace && counts.remove > 0 && !confirmRemove`; per-agent in-memory lock → 409 "import already running"; deletes the stage on success; `restartRequired = agent running`); sweep expired stages at the start of every stage call; register the controller and service in `file.module.ts`; add a controller spec for the 409 paths in `fileImport.controller.spec.ts`
- [X] T022 [US2] Regenerate swagger + admin SDK; add `stageImport(agentId, file)`, `planImport(agentId, importId, opts)`, `applyImport(agentId, importId, body)` to `admin/slices/agent/file/domain/agentFile.gateway.ts`, `data/agentFile.gateway.ts`, `data/agentFile.mapper.ts`, `domain/agentFile.service.ts`, `domain/agentFile.types.ts` (`IImportPlan`, `IImportResult`)
- [X] T023 [US2] Create `admin/slices/agent/file/components/agentFile/ImportDialog.vue`: file picker (client-side size check against `limits.importMaxArchiveBytes` before upload), upload with progress → plan table (counts chips, `wrapperStripped` note, warnings, entry rows with action badges, "and N more"), mode toggle Merge/Replace and "include sessions/" checkbox re-planning via `planImport`, **Import** button; Replace with `counts.remove > 0` opens a second confirmation naming the count; result view (written / removed / skipped / failed list) and, when `restartRequired`, **Restart now** (`useAgentStore().restart(id)`) / **Later** (`markPendingRestart`); errors show the API message verbatim
- [X] T024 [US2] Wire **Import** into `Provider.vue`'s header actions next to Download; after a successful apply refetch `store.fetchList(agentId)` and the agent row (so the CLEAN-50 banner/pill recomputes); close open tabs whose paths were removed
- [ ] T025 [US2] Run quickstart.md Scenario 2 including the Sync-guard check (imported files listed as at risk on the next Sync); jest for `workspaceArchive` and `fileImport` green

**Checkpoint**: both P1 stories shippable. Commit `feat(files): import a workspace archive with a plan first (CLEAN-112)`. Jira comment #3.

---

## Phase 5: User Story 3 — Ask the agent to import or change files from the chat (Priority: P2)

**Goal**: Rancher can list, read, write, create and import workspace files; every write is a persisted **proposal** applied only on a confirmation that names it; the proposal core (model, service, events, transcript) built here is what US4 renders.

**Independent Test**: quickstart.md Scenario 3 via tool results and storage (list/read return data; write returns `pending` + id and writes nothing; confirm with the id writes; attachment import stages and applies; 15 MB attachment refused by the composer).

- [X] T026 [US3] Add `FileChangeProposal` to a new `api/src/slices/agent/file/file.prisma` per data-model.md §7 (fields, enums as strings, indexes `(chatAgentId, channel, createdAt)` and `(agentId, path, status)`); include it where the slice prisma files are merged (`prisma-import` config); stop the dev API, `cd api && bunx prisma migrate dev --name file_change_proposal && bunx prisma generate`
- [X] T027 [US3] Create `api/src/slices/agent/file/data/fileProposal.repository.ts` (+ domain abstract `domain/fileProposal.repository.ts`): `create`, `findById`, `listForChat(chatAgentId, channel, { since, until, includePending })`, `transition(id, from: 'pending', to, patch)` as a conditional `updateMany` returning whether it won, `markSiblingsStale(agentId, path, exceptId)`; provider in `file.module.ts`
- [X] T028 [P] [US3] Bridle transport per contracts/bridle-events.md: add `IBridleProposalEvent` and `IBridleProposalUpdateEvent` and extend `IBridleOutgoingEvent['type']` in `api/src/slices/bridle/domain/bridle.types.ts`; add `abstract sendToAgentClients(agentId: string, data: unknown): void` to `api/src/slices/bridle/domain/bridle.gateway.ts` and implement it in `api/src/slices/bridle/data/bridle.gateway.ts` (every registered client of that agent that declared the `'proposals'` capability; `sendToClient` for `proposal` also checks the capability); accept `'proposals'` in the handshake capabilities in `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`; spec in `bridle.gateway.spec.ts` for fan-out and capability gating
- [X] T029 [US3] Create `api/src/slices/agent/file/domain/fileProposal.service.ts` (+ `fileProposal.service.spec.ts`): `propose({ agentId, chatAgentId, path, content, op: 'write'|'create', actor })` — refuses binary/over-`MAX_EDIT_BYTES`/invalid JSON, HEADs the target for `baseEtag` (create: must be absent), stores content at `proposals/<id>/content` (gateway `putProposalContent`/`getProposalContent`/`deleteProposalContent` in `file.gateway.ts`), computes counts + `inlineDiff` with `diff.structuredPatch` under the `DIFF_*` caps (`diffStatus` `ok | too_large | binary`), `firstChangedLine`, resolves `findActiveTurn(chatAgentId)` → `channel`/`clientId`/`turnId`, saves the row, publishes `proposal`; `proposeImport({ agentId, chatAgentId, importId, plan, mode, includeSessions })` → `kind: 'set'`, `summary` (counts + first `PROPOSAL_LIST_ROWS` rows + `more`); `apply(id, { actor, via, content? })` — conditional transition, ETag re-check → `stale`, write via `IFileGateway.save`/`WorkspaceArchiveService.apply`, `markSiblingsStale`, `restartRequired`, publishes `proposal_update`, returns the row; `skip(id, actor)`; `diffFor(id, path?)` on demand under `DIFF_COMPARE_MAX_BYTES`; `toDto(row, names)`; spec: caps at exactly 200 lines / 100 KB / 1 MiB boundaries, state machine incl. double apply and stale, no S3 write on propose, event published only with an active turn
- [X] T030 [US3] Create `api/src/slices/agent/file/fileProposal.controller.ts` + `dtos/fileChangeProposal.dto.ts`: `GET /agents/:id/files/proposals?chatAgentId&channel&since&until`, `GET …/proposals/:pid`, `GET …/proposals/:pid/content` (text/plain), `GET …/proposals/:pid/diff?path` (text/x-diff, 413 over cap), `POST …/proposals/:pid/apply` `{ via, content? }` (200 with the final row; 409 with the row when not pending), `POST …/proposals/:pid/skip`; operator guard as the rest of the slice; register in `file.module.ts`
- [X] T031 [US3] Transcript enrichment in `api/src/slices/bridle/bridle.controller.ts` (`GET :agentId/transcript`): after paging, load `proposals` via `FileProposalRepository.listForChat(agentId, channel, { since: oldest ts on the page, until: newest ts, includePending: true })` and add `proposals: FileChangeProposalDto[]` to `TranscriptResponseDto` (`dtos/`); bridle module imports the file module's repository (or a small `FileProposalQuery` provider exported from `file.module.ts` to avoid a cycle); extend `bridle.controller.spec.ts`
- [X] T032 [US3] Tools `list_agent_files` and `read_agent_file` in `api/src/slices/agent/file/file.tool.ts` per contracts/tools.md (topic `AgentWorkspace`, title, template, zod params, `stripSecrets` on results, `read` refuses binary and caps `limit` at `MAX_RANGE_BYTES`); extend `file.tool.spec.ts` (unlisted for non-operators, prefix filtering, slice `nextOffset`, binary refusal)
- [X] T033 [US3] Tools `write_agent_file` and `create_agent_file` in `file.tool.ts` (destructive, `confirm` param): first call → `FileProposalService.propose` and the `pending` result with `next` text from contracts/tools.md; `confirm: true` + `proposalId` → `apply(id, { actor: 'agent:<callerAgentId>', via: 'tool' })`; `confirm` without a pending id, or an id for another agent → `err`; spec cases: propose performs no save, confirm applies, wrong id refuses, stale returned when the ETag moved, metadata boots under `McpRegistryService.validateToolMetadata`
- [X] T034 [US3] Tool `import_agent_files` in `file.tool.ts`: source `attachmentId` → `IBridleAttachmentGateway.fetch(callerAgentId, attachmentId)` (inject the gateway; caller = chat agent, not target) or `url` (https only, DNS-resolved address not loopback/private/link-local, 30 s timeout, `IMPORT_MAX_ARCHIVE_BYTES` cap while streaming) → `WorkspaceArchiveService.validate` + `putStage` + `plan` → `FileProposalService.proposeImport`; confirm path applies through `FileProposalService.apply`; `mode: 'replace'` allowed only with `confirm` and the card's second acknowledgement (the tool's confirming call must also pass `confirmRemove: true`); spec: attachment scoping by caller agent, private URL refused, oversize refused, pending → applied
- [ ] T035 [US3] Regenerate swagger + admin and app SDKs; boot the API and confirm the five tools appear under "Agent workspace" in the Rancher chat's Tools shelf with their templates; `npx jest src/slices/agent/file src/slices/bridle` green
- [ ] T036 [US3] Run quickstart.md Scenario 3 steps 1–2 and 4, and step 3 up to "card" (verify via the tool's returned `proposalId`, `GET …/proposals/:pid`, and storage after confirm)

**Checkpoint**: the chat is the hands; proposals persist and are applied only on named confirmation. Commit `feat(files): agent tools with confirm-by-proposal (CLEAN-112)`. Jira comment #4.

---

## Phase 6: User Story 4 — See and approve a file change as a card in the chat (Priority: P2)

**Goal**: proposals render as cards in the admin **and** app chats with bounded diffs; Apply / Edit before applying / Skip work from the admin card; state updates flow to every open tab; reload shows final states.

**Independent Test**: quickstart.md Scenario 4 (one-line diff card → Apply writes and the composer posts the follow-up; 600-line rewrite shows summary + View diff; 2 MB write shows too-large; stale on concurrent edit; Edit before applying opens a draft; reload keeps states; app renders read-only).

- [ ] T037 [P] [US4] Create `admin/slices/agent/file/stores/fileProposal.ts` per data-model.md §10 (`byId`, `byChat`, `upsert`, `patch`, `apply(id, via, content?)` optimistic with rollback, `skip(id)`, `fetch(id)`, `content(id)`, `diff(id, path?)`) backed by new methods in `domain/agentFile.gateway.ts`, `data/agentFile.gateway.ts`, `data/agentFile.mapper.ts`, `domain/agentFile.service.ts`, `domain/agentFile.types.ts` (`IFileChangeProposal`)
- [ ] T038 [P] [US4] Admin bridle store `admin/slices/bridle/stores/bridle.ts`: add `'proposals'` to handshake `capabilities`; `socket.on('proposal')` → `fileProposal.upsert` + insert a `{ kind: 'proposal', proposalId, ts }` bubble into the conversation at `ts`; `socket.on('proposal_update')` → `fileProposal.patch` (fetch on unknown id); transcript page merge inserts `proposals` as bubbles by `createdAt` through a pure util `admin/slices/bridle/utils/proposalMerge.ts` (+ `proposalMerge.test.ts`: ordering, dedupe on re-page, pending always kept)
- [ ] T039 [US4] Create `admin/slices/bridle/components/bridle/ProposalCard.vue` and render it from `admin/slices/bridle/components/bridle/Message.vue` (or the conversation list) for `kind: 'proposal'` bubbles, following contracts/bridle-events.md rendering rules: header (path or "Import into «agent»", `line N`, `+a −d`, **Open in Files** → `?tab=files&path=`), inline hunks with added/removed styling when `inlineDiff`, summary + **View diff in Files** (`?tab=files&proposal=<id>&compare=1`) otherwise, set rows + "and N more"; actions when `pending`: **Apply** (Replace with removals → second acknowledgement naming the count; on success send `Applied change to <path>` / `Applied import into <agent>` through the composer's send path), **Edit before applying** (`?tab=files&proposal=<id>`), **Skip**; final states `Applied · HH:MM` + `applies on next restart` + **Restart now** (`useAgentStore().restart`) / **Later** (`markPendingRestart`), `Skipped`, `stale` and `refused` texts
- [ ] T040 [US4] Files-tab proposal flow in `admin/slices/agent/file/components/agentFile/Provider.vue` + new `DiffView.vue`: on `?proposal=<id>` fetch the proposal and its content, open the path as a tab whose draft is the proposed content with a strip "From a chat proposal · Compare · Discard", Save calls `fileProposal.apply(id, 'editor', draft)` instead of the plain save (card flips to applied via `proposal_update`), Discard leaves it pending; with `&compare=1` (or the strip's Compare) mount `DiffView.vue` (Monaco `createDiffEditor`, read-only, base = fully loaded current content ≤ `diffCompareMaxBytes`, proposed = proposal content; above the cap show "too large to compare — download both" with two download links); clear the query params after handling
- [ ] T041 [P] [US4] App bridle store `app/slices/bridle/stores/bridle.ts`: `'proposals'` capability, `proposal` / `proposal_update` handlers (read-only upsert/patch in a local `proposals` map, no apply/skip), transcript merge through `app/slices/bridle/utils/proposalMerge.ts` (+ `proposalMerge.test.ts`, same cases as admin)
- [ ] T042 [P] [US4] Create `app/slices/bridle/components/bridle/chat/ProposalCard.vue` (read-only: header, hunks/summary/rows, final-state line; no buttons) rendered from `app/slices/bridle/components/bridle/chat/Message.vue`; strings added to `app/slices/bridle/i18n/locales/en.json` and generated with `cd app && bun run i18n:sync`; templates use the injected `$t`
- [ ] T043 [US4] Run quickstart.md Scenario 4 (all 8 steps) in admin and step 3 in app; `bun test slices` and `npx nuxt typecheck` green in both consoles

**Checkpoint**: the mock's chat flow works end to end in both consoles. Commit `feat(bridle): file change cards with bounded diffs (CLEAN-112)` (PR text: bridle touched in admin and app; Files tab admin-only). Jira comment #5.

---

## Phase 7: User Story 5 — Work the explorer like a small IDE (Priority: P3)

**Goal**: filter, size/modified columns, checkboxes with a bulk panel (Download / Delete / Clear), tabs with an unsaved dot, New file, header chips and the "Agent copy is newer — Sync now" pill.

**Independent Test**: quickstart.md Scenario 5 (filter and restore; bulk download of two files; bulk delete with count; empty-workspace refusal; three tabs with one dirty; New file created, duplicate 409, traversal refused; pill replaces the banner).

- [ ] T044 [P] [US5] Create `admin/slices/agent/file/utils/fileTree.ts` (+ `fileTree.test.ts`): `buildTree(nodes)` (moved from `Tree.vue`), `filterTree(tree, query)` keeping matching files and their ancestors, `folderTotals(tree)` (count, bytes), `selectionWithin(tree, path)` for folder checkboxes; then `admin/slices/agent/file/components/agentFile/Explorer.vue` + `ExplorerRow.vue` replacing `Tree.vue`/`TreeNode.vue`: filter input (`⌘P` hint), columns NAME / SIZE / MODIFIED (`updatedAt`, "Today"/date), folder rows with counts, checkboxes (folder = its files), dirty dot on rows with a draft, expansion state preserved across filter changes, explicit empty state
- [ ] T045 [P] [US5] Create `admin/slices/agent/file/utils/tabs.ts` (+ `tabs.test.ts`: open/close/activate/reorder, close-with-draft rule) and `admin/slices/agent/file/components/agentFile/Tabs.vue` (tab per open path, dirty dot, close `×` prompting keep/discard when dirty); `beforeunload` warning in `Provider.vue` while any draft is dirty; switching tabs keeps drafts (from the store)
- [ ] T046 [US5] Bulk panel in `Explorer.vue` + `Provider.vue`: "N selected · Download · Delete · Clear"; **Download** → `service.exportZip(agentId, paths)` → blob download named `agent-<id>-selection.zip`; **Delete** → confirmation naming the count (and the existing `skills/` note) → `service.remove(agentId, paths)`; on 409 `{ wouldRemove, total }` show the empty-workspace acknowledgement and resend with `confirm: true`; refetch list, close deleted tabs, clear selection
- [ ] T047 [US5] Create `admin/slices/agent/file/components/agentFile/NewFileDialog.vue`: relative path input (client check: no leading `/`, no `..` segments, non-empty), creates via `service.save(agentId, path, '', { createOnly: true })`, 409 → "already exists", 400 → API message (non-text kind); on success upsert the node, open it as the active tab
- [ ] T048 [US5] Header in `Provider.vue` per the mock: title, path chip `agents/<id>/`, `N files · total size`, actions **Import** / **Download** / **New file**; replace the full-width "stored copy vs running agent" banner with the pill `● Agent copy is newer (HH:MM) · Sync now` using the same `lastPullAt`/`lastSyncAt` inputs and the existing `onSync` flow (keep the pending-restart banner); delete `Viewer.vue`, `Tree.vue`, `TreeNode.vue` once nothing imports them; keep `sections.ts` tab description accurate
- [ ] T049 [US5] Run quickstart.md Scenario 5; `bun test slices` and `npx nuxt typecheck` green

**Checkpoint**: the Files tab matches the design. Commit `feat(files): explorer with selection, tabs and new file (CLEAN-112)`. Jira comment #6.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T050 [P] Add the five tools to the inventory/table in `docs/agent-tools.md` (topic `agent_workspace`) and note the confirm-by-`proposalId` refinement of the confirm convention there; mention the console-only file picker exception
- [ ] T051 [P] Bundle check: `cd admin && bun run build`, inspect `admin/.output/public/_nuxt/` and confirm `monaco-editor` lands in its own chunk imported only from `admin/slices/agent/file/composables/useMonaco.ts`; record the chunk size in the PR
- [ ] T052 Full verification: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file src/slices/bridle src/slices/mcp`; `cd admin && bun test slices && npx nuxt typecheck`; `cd app && bun test slices && npx nuxt typecheck && bun run i18n:sync` (no diff after sync); revert any regenerated SDK noise
- [ ] T053 Run every quickstart.md scenario once more on a clean environment and tick them in the Jira comment
- [ ] T054 Open the PR into `main` with `CLEAN-112` in the title, the twin-console statement (bridle: admin + app; Files tab: admin only, no twin), the tools-per-module checklist from `docs/agent-tools.md`, the Monaco chunk size, and the limits table; put the PR URL on CLEAN-112 and move it to In Testing (transition 51)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → everything else. T009 (regenerated SDKs) gates every console task.
- **US1 (Phase 3)** and **US2 (Phase 4)** are independent of each other after Phase 2; both are P1.
- **US3 (Phase 5)** needs Phase 2 and, for `import_agent_files`, T019–T020 from US2 (the archive service and stages). Its proposal core (T026–T031) is a prerequisite for US4.
- **US4 (Phase 6)** needs Phase 5 (T026–T031 at minimum) and, for View diff / Edit before applying, T013–T014 from US1 (Monaco editor).
- **US5 (Phase 7)** needs Phase 2 and T010; it can run in parallel with Phases 5–6 (different files) but touches `Provider.vue`, which US1/US2/US4 also edit, so land it after them or rebase carefully.
- **Polish (Phase 8)** after all desired stories.

### Story completion order

`US1 → US2 → US3 → US4 → US5` for a single developer. MVP = Phase 1 + 2 + 3.

### Parallel Opportunities

- Phase 1: T002 ∥ T003 (after T001).
- Phase 3: T011 ∥ T013 first, then T012 and T014–T017 in order.
- Phase 4: T019 ∥ (T020) then T021 → T022 → T023 → T024.
- Phase 5: T028 ∥ T026→T027; T032 ∥ T033 once T029 exists; T034 after T033.
- Phase 6: T037 ∥ T038 ∥ T041 ∥ T042 (four files, no overlap), then T039 → T040.
- Phase 7: T044 ∥ T045, then T046 → T047 → T048.
- Phase 8: T050 ∥ T051.

---

## Parallel Example: User Story 4

```bash
# Four independent files, launch together:
Task: "Create admin fileProposal store in admin/slices/agent/file/stores/fileProposal.ts"          # T037
Task: "Admin bridle store handlers + proposalMerge util in admin/slices/bridle/…"                  # T038
Task: "App bridle store handlers + proposalMerge util in app/slices/bridle/…"                      # T041
Task: "App read-only ProposalCard + en.json in app/slices/bridle/components/bridle/chat/…"         # T042
# Then, in order:
Task: "Admin ProposalCard.vue + Message.vue wiring"                                                # T039
Task: "Files-tab ?proposal= flow + DiffView.vue"                                                   # T040
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 (deps, limits) and Phase 2 (classification, slice safety, save rules, SDK).
2. Phase 3: Monaco editor, auto-load, Open full, binary panel, save conflicts.
3. **Stop and validate** with quickstart Scenario 1; demo. This alone answers the two original complaints (read-only scripts, manual preview cut).

### Incremental Delivery

- + US2 → import works from the Files tab (Scenario 2).
- + US3 → tools and the proposal core; agent can do everything the tab can (Scenario 3 via storage).
- + US4 → cards in both consoles; the mock's chat flow (Scenario 4).
- + US5 → explorer polish (Scenario 5).
- Each phase ends with a commit carrying `CLEAN-112` and a Jira checkpoint comment.

### Notes

- Every limit comes from `file.limits.ts` / `GET …/files/limits`; no literal caps in components or tools.
- The agent runtime image is never touched; if a task seems to need it, the design is wrong — re-read research R6.
- `Provider.vue` is the contention point across US1, US2, US4, US5: keep each edit to its own region (header actions, selection panel, proposal strip) and rebase between phases.
