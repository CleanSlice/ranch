# Research: Advanced Agent File Management (CLEAN-112)

Phase 0 output. Every unknown from the plan's Technical Context is settled here as a decision with rationale and the alternatives that lost. File references are to the current tree (`origin/main` at `733e755`).

## R1. Where the "preview" cut lives, and what stays

**Finding**: two independent caps in `api/src/slices/agent/file/data/file.gateway.ts`. `read()` refuses objects over `MAX_BYTES` (1 MiB); `readRange()` serves slices of `DEFAULT_RANGE_BYTES` (256 KB) up to `MAX_RANGE_BYTES` (512 KB) with `nextOffset`/`hasMore`. The console (`admin/slices/agent/file/components/agentFile/Viewer.vue`) shows the first slice, a manual **Load more** button, and blocks editing while `hasMore`.

**Decision**: keep slice reads as the only read path for the console and the tools (drop the console's use of the whole-file `read()`; it stays for internal callers such as the transcript reader). The viewer auto-fetches the next slice from an end-of-content sentinel (IntersectionObserver) and keeps a `loaded/total` indicator. Editing unlocks only when `hasMore === false` and `totalSize ≤ MAX_EDIT_BYTES` (1 MiB, the current `MAX_BYTES`). A new `MAX_VIEW_BYTES` (25 MB) bounds what the viewer will stream at all; above it the file is download / open-full only.

**Multi-byte safety (FR-009)**: the API trims a trailing partial UTF-8 sequence from each slice and sets `nextOffset` to the trimmed length, so the browser never sees a broken character and never has to stitch. Cheaper and safer than client-side healing. `readRange` today decodes with `transformToString('utf-8')`, which replaces a split sequence with U+FFFD; the fix is to inspect the last ≤3 bytes before decoding.

**Alternatives**: client-side healing (rejected: two implementations, admin and tools), raising the slice to 1 MiB (rejected: first paint slower, no gain once scroll-loading exists).

## R2. Text vs binary, and the editable set

**Decision**: the API classifies each node on `list` and `content`: `kind: 'text' | 'binary'` and `editable: boolean`. Classification = extension allowlist (`TEXT_EXTENSIONS`, one exported constant in the file slice, default list in the spec's Assumptions) with a sniff fallback for unknown or missing extensions (first 8 KB of the object: no NUL byte and valid UTF-8 → text). `editable = kind === 'text' && size ≤ MAX_EDIT_BYTES`. `assertWritableExt` becomes `assertWritable(path, kind)` using the same constant; `contentType()` gains a map for the recognised formats. The console and the tools never carry their own list: they read `kind`/`editable` off the node.

**Rationale**: one source of truth (spec FR-002, FR-030), and the sniff keeps `Makefile`-style files editable without an ever-growing list.

**Alternatives**: mime detection library (rejected: adds a dependency for a problem the extension list plus a NUL check solves); client-side classification (rejected: drifts from the API's write guard).

## R3. "Open full" delivery

**Finding**: storage is configured through settings (`s3_bucket`, `s3_endpoint`, optional static keys, IRSA otherwise; `file.gateway.ts` `connect()`). The endpoint may be an in-cluster MinIO the browser cannot reach, and a pre-signed URL would also need bucket CORS and the `@aws-sdk/s3-request-presigner` dependency.

**Decision**: the API streams the object. `POST /agents/:id/files/open-link` mints a short-lived token (JWT via the existing `@nestjs/jwt`, claims `{ agentId, path, kind }`, `exp` = now + `OPEN_LINK_TTL_SEC`, default 900) and returns `{ url, expiresAt }`; `GET /agents/:id/files/raw?token=…` (no cookie/bearer needed, token is the credential) verifies it, HEADs the object, and pipes the S3 body with `Content-Type: text/plain; charset=utf-8` + `Content-Disposition: inline` for text, or the stored content type + `attachment` for binary. Works for any S3 backend, no CORS, no new dependency, and the link is useless after expiry or for any other path.

**Alternatives**: pre-signed S3 URL (rejected for reachability/CORS; can be added later behind the same `open-link` contract), reusing the authenticated `content` endpoint (rejected: it returns JSON slices, not a raw document).

## R4. Import: parsing, staging, planning, applying

**Finding**: `unzipper` is already a dependency and used by `api/src/slices/agent/templateInstall/data/archive.gateway.ts` (extract to disk, template-shaped). Uploads use multer's `FileInterceptor` (`templateInstall.controller.ts`). `exportZip()` writes entries at the workspace root with no wrapping folder. The json body limit in `main.ts` is 2 MB, irrelevant for multipart.

**Decision**: a new `WorkspaceArchiveService` in the file slice, memory-based (`unzipper.Open.buffer`), does validation and planning; nothing is extracted to disk.

- **Staging**: an uploaded archive is stored once at `imports/<agentId>/<importId>.zip` (bucket root, outside every agent prefix) with metadata `{ agentId, size, entries, createdAt, source }`. Preview and apply both take `importId`, so a 100 MB archive is uploaded once, and the agent tool can stage from a chat attachment or a URL into the same place. Stages expire: apply deletes them; a sweep removes stages older than `IMPORT_STAGE_TTL_MIN` (60).
- **Validation (whole-archive refusal)**: entry path traversal / absolute / drive letter, symlink (unix mode in `externalFileAttributes`), case-duplicate paths, limits `IMPORT_MAX_ARCHIVE_BYTES` 100 MB, `IMPORT_MAX_ENTRIES` 2000, `IMPORT_MAX_FILE_BYTES` 25 MB, zip bombs (uncompressed total ≤ 500 MB). A single wrapping top-level folder is stripped when every entry shares it. Encrypted archives are refused (unzipper reports the flag).
- **Plan**: list the agent prefix once (existing `list()`), then classify every entry: `add` (no object), `change` (object exists and MD5 of the entry ≠ S3 ETag, which is MD5 for non-multipart uploads; multipart ETags are treated as "unknown → change"), `unchanged`, `skip` (`sessions/` unless `includeSessions`). In `replace` mode, every existing key absent from the archive is `remove` (again minus `sessions/` unless included). Counts, total size, and the entry list (capped at `IMPORT_PLAN_LIST_ROWS` 500 with `more: n`) make the `ImportPlan`.
- **Apply**: writes via `putObject` sequentially with a small concurrency (4), records per-file outcome, deletes `remove` keys with `DeleteObjects` in batches, and returns `ImportResult { written, failed, removed, skipped }`. A failure stops nothing else; the result names the failed paths, and re-running the preview classifies the leftovers as `add`/`change` again (FR-016). One import per agent at a time (in-memory lock keyed by agentId, 409 otherwise).
- **After import**: nothing extra is needed for the CLEAN-50 guard: new objects carry a fresh `LastModified`, so `SyncGuardService.assess` flags them as newer than the agent's last pull. The console marks `pendingRestart` (existing localStorage helper) and offers Restart now / Later via the existing `POST /agents/:id/restart`.

**Alternatives**: reusing `ArchiveGateway.extractZip` (rejected: disk extraction and template semantics; we need a plan, not files), streaming the archive twice (preview then apply) (rejected: double upload), a DB table for stages (rejected: S3 metadata is enough and needs no migration).

## R5. Agent tools and the confirm-gated write

**Finding**: `file.tool.ts` has `delete_agent_file`, `sync_agent_files`, `export_agent_files` (topic `AgentWorkspace`), operator-gated with `requireOperator` / `confirmed()` from `api/src/slices/mcp/tooling.ts`. There is no list/read/write. Tools receive `httpRequest.user`, and `callerAgentId()` identifies the chatting agent (Rancher).

**Decision**: five new `@Tool` methods on `FileTool`, all `ToolTopics.AgentWorkspace`, operator audience (`isListedForRequest` already restricts the class):

| Tool | Args | Backing |
|---|---|---|
| `list_agent_files` | `agentId`, `prefix?` | `IFileGateway.list` + classification |
| `read_agent_file` | `agentId`, `path`, `offset?`, `limit?` | `readRange` (same slice caps) |
| `write_agent_file` | `agentId`, `path`, `content`, `confirm?`, `proposalId?` | `FileProposalService.propose` / `.apply` |
| `create_agent_file` | `agentId`, `path`, `content?`, `confirm?`, `proposalId?` | same, with `createOnly` |
| `import_agent_files` | `agentId`, `attachmentId? \| url?`, `mode?` (`merge`), `includeSessions?`, `confirm?`, `proposalId?` | `WorkspaceArchiveService.stage` → `FileProposalService.proposeImport` / `.apply` |

Write/create/import follow the existing convention with one refinement: the first call (no `confirm`) **creates a proposal** and returns `{ proposalId, status: 'pending', summary }` plus the sentence that the person must confirm in the chat; the confirming call carries `confirm: true` **and** the `proposalId`, and applies exactly that proposal. This is the "confirmation for one change does not cover another" rule (spec 3.2) made mechanical. The console's Apply button hits the same service, so the two paths cannot drift.

Attachment source: `IBridleAttachmentGateway.fetch(callerAgentId, attachmentId)` (attachments are scoped to the chat agent). URL source: https only, 30 s timeout, `IMPORT_MAX_ARCHIVE_BYTES` cap, private/loopback address ranges refused (SSRF).

**Alternatives**: writing directly on the first call when the change is "small" (rejected: FR-018, zero writes before approval), a separate `propose_*` tool family (rejected: doubles the catalogue; the same tool with `proposalId` reads naturally in the Tools panel).

## R6. Carrying the card to the consoles, without a runtime change

**Finding**: CLEAN-74 already lets the API inject its own step into a live turn: `IBridleGateway.findActiveTurn(agentId)` returns the `{ clientId, turnId }` of the person watching, and `delegation.service.ts` `publish()` calls `hub.sendToClient(clientId, agentId, { type: 'thinking', … })`. The admin bridle store listens for `message`, `stream`, `stream_end`, `thinking`, `debug`, `typing`, `user_message`, … and the app store mirrors it. Chat history on reload comes from the runtime's transcript (`GET /api/agent/:id/transcript`, read from `data/sessions/bridle:<channel>.jsonl`), which contains `tool_call`/`tool_result` events.

**Decision**: the card is an API-published event; the runtime image is untouched (the user's "probably extend the runtime?" is answered: not for this). Two new hub → client events, added to `IBridleOutgoingEvent` and the two stores:

- `proposal` — the full card payload (see contracts/bridle-events.md), sent to the active turn's client when `write_agent_file` / `create_agent_file` / `import_agent_files` create a proposal. No active turn (a tool call outside a chat turn) → no live event; the card still shows on reload.
- `proposal_update` — `{ proposalId, status, actedAt, actedBy }`, broadcast to every client of that chat agent when the status changes (Apply / Skip / stale / refused), so both consoles and other tabs flip the card together. Needs one small gateway addition, `sendToAgentClients(agentId, data)`, next to `sendToClient`.

**Reload**: proposals persist in a Prisma table (`FileChangeProposal`, see data-model.md) keyed by the chat agent and channel. The transcript endpoint response gains `proposals: FileChangeProposalDto[]` for the requested channel and window (by `createdAt` within the page's time range), and the stores merge them into the conversation by timestamp after the assistant message that carries the matching `tool_call`. Rendering a proposal as its own agent-side bubble (not inside the assistant's text bubble) keeps the transcript untouched and matches the mock closely enough.

**Apply / Skip from the console**: `POST /agents/:id/files/proposals/:pid/apply|skip`. After a successful Apply the console sends, through its normal composer path, the user message "Applied change to `<path>`" (the mock's green user bubble), so the agent's next turn can say "saved, restart now?". The API does not fabricate user messages. The **Restart now / Later** choice is rendered by the card in its `applied` state (console-side, existing restart action), not by the agent's prose, so it works even if the agent answers differently.

**Edit before applying**: `?tab=files&proposal=<id>` on the agent page. The Files tab reads the query, fetches the proposal's content (`GET …/proposals/:pid/content`), opens the file in the editor with that content as an unsaved draft, and shows a "from proposal … / compare" strip. Saving the draft calls the normal save **and** marks the proposal `applied` (with `actedVia: 'editor'`); Discard leaves it pending.

**Alternatives**: a new `BridlePart` inside the assistant message (rejected: needs the runtime to fold tool results into message parts, and the LLM's text arrives after the tool call anyway), a thinking-step `kind: 'proposal'` (rejected: thinking blocks collapse when the turn ends; a card must stay actionable), polling proposals from the console (rejected: `proposal_update` is one line on the existing socket).

## R7. Diff computation and the limits that keep the browser alive

**Decision**: diffs are computed server-side in `FileProposalService` with the `diff` package (jsdiff, MIT, no native code) on line granularity with 3 lines of context, at proposal time, once:

- `proposedBytes > DIFF_COMPARE_MAX_BYTES` (1 MiB) or base is binary → no diff at all: `diffStatus: 'too_large' | 'binary'`, counts unknown, card shows size only and "download both".
- Otherwise counts (`additions`, `deletions`, `changedLines`) are always computed and stored.
- `inlineDiff` (unified hunks, capped text) is stored only when `changedLines ≤ DIFF_INLINE_MAX_LINES` (200) **and** `proposedBytes ≤ DIFF_INLINE_MAX_BYTES` (100 KB); otherwise `null` and the card shows the summary with **View diff in Files**.
- Set proposals (imports) never carry per-file diffs; the card shows counts and up to `PROPOSAL_LIST_ROWS` (50) file rows, "and N more". Per-row "view diff" fetches `GET …/proposals/:pid/diff?path=` lazily, computed on demand from the staged archive entry and the current object, same caps.
- The Files-tab comparison uses the editor's built-in side-by-side diff on base + proposed content; it is opened only from a card action, only for files under `DIFF_COMPARE_MAX_BYTES`.

Base version: the proposal stores the S3 `ETag` of the target at proposal time (`null` for a new file). Apply HEADs the object and refuses with `stale` when the ETag differs (or when a `createOnly` target now exists). Proposed content lives in S3 under `proposals/<id>/<path>` (not in the DB row): content is up to 1 MiB and the row stays light; a set proposal points at its `importId` stage.

**Alternatives**: client-side diff (rejected: two consoles, and the cap must be enforced where the content is), storing content in Postgres (rejected: bloats a hot table; S3 already holds the base).

## R8. Editor component

**Decision**: Monaco (`monaco-editor`), as the design proposes, loaded lazily and only on the Files tab: a `useMonaco()` composable does `await import('monaco-editor')` inside `<ClientOnly>`, registers the ESM workers through Vite's `?worker` imports (json, ts, css, html, editorWorker), and the Files tab mounts `AgentFileEditor.vue` (read-only → editable flip, `onDidChangeCursorPosition` for Ln/Col, JSON diagnostics from the json worker for the validity badge, `Ctrl/⌘+S` bound to save) and `AgentFileDiff.vue` (`createDiffEditor`, side-by-side, read-only). Languages registered: json, markdown, typescript, javascript, python, shell, yaml, html, css, sql, xml, ini, plaintext. Auto-loaded slices are appended with `model.applyEdits` at the end while the viewport is preserved; Monaco virtualises rendering, so a 25 MB model stays scrollable.

**Cost**: ~3 MB of JS in its own chunk, fetched once per session on first Files-tab visit; nothing on other pages. Bundle check is a review item.

**Alternatives**: CodeMirror 6 (smaller, but no built-in diff editor or JSON worker; the user asked for Monaco), the current `<textarea>` (rejected by the spec's editor requirements).

## R9. Explorer: selection, bulk actions, tabs, new file, filter

**Decision**:

- **Bulk download**: `POST /agents/:id/files/export` with `{ paths?: string[] }` → the existing `exportZip` gains an optional path/prefix filter. `GET …/export` stays for the whole workspace.
- **Bulk delete**: `DELETE /agents/:id/files` gains a body `{ paths: string[], confirm?: boolean }`; the service loops the existing per-path delete and refuses (409 with counts) when the selection would empty the workspace unless `confirm` is set (mirrors the Sync "don't wipe everything" guard).
- **New file**: `PUT /agents/:id/files/content?path=` gains `createOnly: true` → 409 if the object exists; the console prompts for a relative path and validates the extension against `kind === 'text'` rules via a `GET …/files/classify?path=` helper or simply by trying the save (chosen: try the save; the API is the authority).
- **Filter**: client-side over the loaded list (hundreds of files; fine to a few thousand).
- **Tabs + drafts**: live in the `agentFile` Pinia store (`openTabs[agentId]`, `drafts[agentId][path]`), so switching agent tabs or re-mounting keeps them; `beforeunload` warns when any draft is dirty. Modified column uses `updatedAt` already on `IFileNode`.
- **Header pill** replaces the full-width banner using the same `lastPullAt` / `lastSyncAt` data the banner uses now.

## R10. Twin console and i18n

**Decision**: the Files tab is admin-only (no twin); the `bridle` slice is twin: `ProposalCard.vue` lands in `admin/slices/bridle/components/bridle/` and `app/slices/bridle/components/bridle/chat/`, and both stores get the `proposal` / `proposal_update` handlers and the transcript merge. App strings go through `app/slices/bridle/i18n/en.json` + `bun run i18n:sync`. In the app console the card is read-only (no Apply/Skip/Edit): the write tools are operator-only, so a proposal can only originate from an operator chat, and the app has no Files tab to edit in. The PR states this explicitly per the twin rule.

## R11. Testing approach

- API (jest, run directly, never `bun run test`): `workspaceArchive.service.spec.ts` (validation refusals, wrapper stripping, plan classification, limits), `fileProposal.service.spec.ts` (diff caps, state machine, stale detection), `file.controller` raw-token spec, `file.tool.spec.ts` extended for the five tools (unlisted for non-operators, proposal on first call, apply on confirm with id, refusal on mismatched id), `readRange` UTF-8 trim spec, bridle store-less unit for the `proposal` event routing.
- Admin: `bun test slices` for pure utils (tree filter, tab/draft reducers, proposal merge-by-timestamp); `npx nuxt typecheck` (revert generated SDK files after).
- App: same for the transcript merge util; i18n sync check.
- Manual: quickstart.md scenarios.

## R12. Migration and configuration

- One Prisma model, `FileChangeProposal`, in `api/src/slices/agent/file/file.prisma` (merged by `prisma-import`), migration `api/prisma/migrations/<ts>_file_change_proposal/`.
- Every limit is a named export in `api/src/slices/agent/file/domain/file.limits.ts`, overridable by env (`RANCH_FILES_*`) and echoed to the console in `GET /agents/:id/files/limits` so the UI never hardcodes them (FR-030).
- New API dependency: `diff` (+ `@types/diff`). New admin dependency: `monaco-editor`. No app dependency.
- No runtime image change; no template changes.
