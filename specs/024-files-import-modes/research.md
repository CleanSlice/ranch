# Research: Files Import — Whole Workspace or Selected Files (CLEAN-192)

Phase 0 of the plan. Every unknown from the Technical Context is settled here
with a decision, the reason, and what was rejected. Line references are to the
code as of `origin/main` at `70b2a262`.

## R1 — Where the "match by name" rule lives

**Decision**: in the API, as one pure function in the file slice's domain
(`resolveSelectedFiles(names, targetFolder, existing)` next to
`WorkspaceArchiveService`), exposed by a new `POST
/agents/:id/files/import/resolve` and reused verbatim by the agent tool.

**Rationale**: constitution VII ("a rule stays a rule") and the tools rule that
tools call the same services as the console. The dialog and the chat must give
the same target path for the same file (SC-005); one function guarantees it.
The admin store already holds the file list, so matching in the browser was
tempting, but it would be a second copy of the rule that the tool cannot call.

**Alternatives considered**: client-side matching against the Pinia list
(rejected: duplicated rule, tool cannot share it); matching inside the
stage call only (rejected: the operator must settle ambiguous names before
uploading, see R3).

## R2 — Reuse the stage → plan → apply pipeline, or build a second one

**Decision**: reuse it. The selected files become `IArchiveEntry[]` (path =
resolved target, bytes, md5) and are staged as a zip that the API builds in
memory with `archiver` (already a dependency, used by `exportZip` at
`api/src/slices/agent/file/data/file.gateway.ts:822`). From there
`WorkspaceArchiveService.plan`, `apply`, `FileImportController.apply`,
`FileProposalService.applySet`, `loadStage`, the stage TTL sweep and the
`IImportPlan` / `IImportResult` DTOs all work unchanged. Mode is always
`merge`; `replace` on a files stage answers 400 (FR-010).

**Rationale**: the plan already classifies add / change / unchanged against
S3 ETags, the apply already collects per-file failures, the restart hint and
Sync marking already hang off the result, and the proposal card already
renders a set summary. A second pipeline would copy all of that.

**Two consequences, both handled**:

1. `validate()` strips a single wrapping folder (`wrapperOf`, line ~395).
   Three files all resolved into `notes/` would look like a wrapped archive
   and lose the folder. The stage meta therefore carries `kind: 'files'`, and
   `validate(zip, { stripWrapper: false })` is used for such stages by both
   `loadStage` and `applySet`. One new optional parameter, default `true`.
2. "Changed since previewed" (FR-013) is new behaviour. The files stage meta
   stores the ETag each row was planned against (`expected: Record<path,
   string | null>`); `apply` takes an optional `guard` map and refuses a row
   whose current ETag differs, recording `{ path, reason: 'changed since
   previewed' }` in `failed`. The archive flow passes no guard, so it is
   byte-for-byte unchanged.

**Alternatives considered**: a JSON / multi-object stage format (rejected:
new storage shape, new load path, nothing gained); writing straight from the
multipart request without a stage (rejected: no preview-before-write, and
the tool needs a stage for its proposal).

## R3 — How the operator settles an ambiguous name

**Decision**: two calls from the dialog. First `resolve` with the names and
the target folder (no upload, one S3 list), which returns one row per name:
`unique` with its path, `none` with `<targetFolder>/<name>`, or `ambiguous`
with the candidate paths. The dialog shows the rows at once; ambiguous rows
get a chooser (candidates plus "add as new in <folder>"). Only when every row
has a path does the dialog upload: `stage-files` (multipart `files[]` plus a
`targets` JSON array of `{ name, path }`) returns the usual `IImportPlan`
with the `change` rows the dialog labels **replace**. Then the existing
`apply` with `mode: merge`.

The API re-validates every target in `stage-files`: the path must pass the
archive path rules (`safeEntryPath`) and must be either the unique match,
one of the candidates, or `<targetFolder>/<name>` for that name. Anything
else is 400. This keeps the rule authoritative even though an operator can
already write any path through the editor.

**Rationale**: the operator sees targets before the bytes travel (a cancelled
import costs nothing), and re-targeting never requires rebuilding a stage.

**Alternatives considered**: upload first, ask later (rejected: wasted
upload, stage rebuilt on every change of choice); a single endpoint doing
both (rejected: same problems plus a bigger multipart contract).

## R4 — Limits

**Decision**: one new limit `IMPORT_MAX_FILES` (default 20, env
`RANCH_FILES_IMPORT_MAX_FILES`) in `file.limits.ts`, echoed as
`importMaxFiles` by `GET /agents/:id/files/limits`. Per-file size reuses
`IMPORT_MAX_FILE_BYTES` (25 MB), the total reuses
`IMPORT_MAX_UNCOMPRESSED_BYTES`. The multipart interceptor gets
`FilesInterceptor('files', IMPORT_MAX_FILES, { limits: { fileSize:
IMPORT_MAX_FILE_BYTES } })` so an oversized upload is cut at the edge.

**Rationale**: FR-030 of CLEAN-112: the API is the authority, nothing else
carries a literal, and the dialog refuses from the echoed limits before
uploading (it already does this for the archive size).

## R5 — Matching rules, precisely

- Name = the dropped file's name as the browser gives it; a name containing
  `/` or `\` or a control character is refused (400 names it).
- Two selected files with the same name in one call → 400 "duplicate name".
- Match set = every workspace object whose last path segment equals the
  name, case-sensitive, excluding `RUNTIME_OWNED_PREFIXES` (`sessions/`,
  `data/sessions/`). 0 → `none`, 1 → `unique`, 2+ → `ambiguous` (candidates
  sorted by path).
- Target folder: optional, relative, validated with the same path rules;
  empty means root. Storage has no folders, so a folder whose last file was
  deleted is simply recreated by the added file (spec edge case amended to
  say so).
- A `.zip` dropped in selected-files mode is a dialog-level rule: exactly one
  file whose name ends in `.zip` → the dialog offers to switch modes. The API
  treats a zip handed to `stage-files` as an ordinary file.

## R6 — Agent tool

**Decision**: extend `import_agent_files` rather than add a tool. New
optional parameters `attachmentIds: string[]`, `targetFolder`, and
`targets: { name, path }[]`. Routing: `attachmentIds` present, or a single
`attachmentId` whose body does not start with the zip signature `PK\x03\x04`,
→ selected-files path. The tool runs `resolve`; if any name is ambiguous and
`targets` does not settle it, it returns `ok({ status: 'needs_choice', … })`
with no proposal, and the agent asks the person. Otherwise it stages with
`kind: 'files'` and calls `proposeImport` as today (`op: 'import'`, set
summary), so the chat card, Apply / Skip, and `confirm` are unchanged.

**Rationale**: one tool, one card, one confirm convention; `ProposalOp` is a
plain string column (`file.prisma:22`), but keeping `op: 'import'` means no
migration and no card change. The description gains one sentence about
plain files. Metadata (`topic`, `title`, `template`, `destructive`,
confirm-by-proposal) is already in place.

**Alternatives considered**: a new `import_agent_selected_files` tool
(rejected: a second card and a second confirm path for the same outcome).

## R7 — Mode memory in the dialog

**Decision**: an `importMode` ref in the `agentFile` Pinia store, default
`'workspace'`, not persisted. A page reload starts a new console session.

**Rationale**: the spec asks for "this console session"; the admin console
has no `sessionStorage` helper and `docs/state.md` keeps UI state in the
slice's store. Persisting a preference is a different feature.

## R8 — Dialog composition

**Decision**: one `ImportDialog.vue`, mode switch rendered with the theme's
`Tabs` (`admin/slices/setup/theme/components/ui/tabs`) above the drop zone,
and the selected-files flow as a sibling branch of the existing `step`
machine (`pick → resolving → targets → uploading → plan → applying →
result`). Target folder comes from `Provider.vue`'s existing `activeFolder`
(the folder of the active editor tab, the same rule **New file** uses).

**Rationale**: the result and restart steps are shared; splitting into two
dialogs would duplicate them. Reusing `activeFolder` keeps "selected folder"
meaning the same thing for New file and Import.

## R9 — Twin console

The Files tab (`admin/slices/agent/file`) has no twin: `app/slices/agent` has
no `file` module. The proposal card in `bridle` is unchanged in both
consoles because the tool keeps `op: 'import'`. The PR states this.

## R10 — Tests

- `workspaceArchive.service.spec.ts` (jest): `resolveSelectedFiles` table
  (unique / none / ambiguous / sessions excluded / case), `validate` with
  `stripWrapper: false`, `apply` with a guard map refusing a moved ETag.
- `fileImport.controller.spec.ts`: `resolve` happy path; `stage-files`
  rejects a target outside the resolved set, rejects duplicate names, caps
  files; `apply` with `replace` on a files stage → 400.
- `file.tool.spec.ts`: plain attachment routes to the files path; ambiguous
  name returns `needs_choice` and creates no proposal; with `targets` a
  pending proposal appears and nothing is written.
- Admin: `bun test slices` for a small `importTargets.ts` util (labels and
  confirmability of rows), `npx nuxt typecheck` (regenerated SDK reverted
  afterwards). Manual scenarios in `quickstart.md`.
