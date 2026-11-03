# Data model: Files Import — Whole Workspace or Selected Files (CLEAN-192)

Extends `specs/017-advanced-file-management/data-model.md` §4–§6 and §9.
Nothing new is persisted in PostgreSQL; the only new stored shape is a field
on the import stage's S3 metadata. All types live in
`api/src/slices/agent/file/domain/import.types.ts` and are mirrored into the
admin domain by the OpenAPI SDK + mapper.

## 1. Resolve row (computed, not stored)

One per selected file name, returned by `POST /agents/:id/files/import/resolve`
and produced by `resolveSelectedFiles()`.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | The dropped file's name, as given |
| `match` | `'unique' \| 'none' \| 'ambiguous'` | How many workspace files carry this name (0 / 1 / 2+), `sessions/` excluded |
| `path` | string \| null | `unique`: the matched path. `none`: `<targetFolder>/<name>`. `ambiguous`: null until chosen |
| `candidates` | string[] | `ambiguous` only: the matching paths, sorted; empty otherwise |
| `size` | number \| null | Size of the matched file (`unique`), for the preview row |

Validation: a name with `/`, `\` or a control character, or a duplicate name
in the same request, refuses the whole request (400 names it). The target
folder must pass `safeEntryPath`; empty means root.

## 2. Selected-files target (request, not stored)

Sent to `POST /agents/:id/files/import/stage-files` as the `targets` JSON
field alongside the multipart `files[]`.

| Field | Type | Rule |
|---|---|---|
| `name` | string | Must equal exactly one uploaded file's name |
| `path` | string | Must be the unique match, one of the candidates, or `<targetFolder>/<name>` for that name (re-resolved server-side); must pass `safeEntryPath` |

`targetFolder` travels as a plain form field so the server can re-resolve.
A target that fails the rule refuses the whole request.

## 3. Import stage meta (extended)

`IImportStageMeta` (S3 metadata on `imports/<agentId>/<importId>.zip`) gains:

| Field | Type | Meaning |
|---|---|---|
| `kind` | `'archive' \| 'files'` | Default `'archive'` when absent (stages created before this feature). `'files'` stages are validated with `stripWrapper: false` and never applied in `replace` mode |
| `expected` | `Record<string, string \| null>` | `'files'` only: path → ETag the plan was built against (`null` = did not exist). Passed to `apply` as the guard |

Stored as JSON in the existing metadata header; the archive path writes
`kind: 'archive'` from now on and no `expected`.

## 4. Import plan (unchanged shape, reused)

`IImportPlan` is returned by `stage-files` exactly as by `stage`:
`mode: 'merge'`, `includeSessions: false`, `wrapperStripped: null`, counts,
`totalBytes`, `entries` (one per selected file, action `add` / `change` /
`unchanged`), `more: 0`, `warnings`. The dialog labels `change` as
**replace**; the API vocabulary stays `change` so the card and the archive
preview keep one set of labels.

## 5. Import result (unchanged shape, one new reason)

`IImportResult.failed[].reason` gains the value `changed since previewed`
for rows refused by the ETag guard. `written` / `skipped` / `removed`
(always 0 for a files stage) are unchanged.

## 6. Limits (one new value)

| Constant | Env | Default | Echoed as |
|---|---|---|---|
| `IMPORT_MAX_FILES` | `RANCH_FILES_IMPORT_MAX_FILES` | 20 | `importMaxFiles` |

Per-file size and total reuse `IMPORT_MAX_FILE_BYTES` and
`IMPORT_MAX_UNCOMPRESSED_BYTES`. `IFileLimits` and `FileLimitsDto` gain the
one field; the admin mapper `toLimits` reads it.

## 7. Proposal (unchanged)

The tool creates the same set proposal as today: `kind: 'set'`,
`op: 'import'`, `importId` of a `'files'` stage, `mode: 'merge'`,
`summary.rows` from the plan. `applySet` loads the stage and, because the
meta says `'files'`, validates without wrapper stripping and applies with
the guard. No Prisma change, no migration.

## 8. Admin store shape (`docs/state.md`)

`agentFile` store, additive:

| State / action | Type | Purpose |
|---|---|---|
| `importMode` | `'workspace' \| 'files'` | Last chosen mode this console session; default `'workspace'` |
| `resolveImportFiles(agentId, names, targetFolder)` | → `IResolveRow[]` | Calls `resolve`; no entity state, the rows live in the dialog |
| `stageImportFiles(agentId, files, targets, targetFolder, onProgress)` | → `IImportPlan` | XHR multipart upload with progress, like `stageImport` |
| `applyImport` | unchanged | Already refetches the list, forgets stale slices, reloads tabs without drafts, marks a pending restart |

Dialog-local state (not in the store): the selected `File[]`, the resolve
rows with the operator's choices, the derived `targets`. A row is settled
when it has a path; the import is confirmable when every row is settled and
at least one plan entry is not `unchanged`.

## 9. State machine of the dialog (selected-files branch)

```text
pick ──drop/choose──▶ resolving ──rows──▶ targets ──all settled──▶ uploading
  ▲                                            │                         │
  └──────── error / cancel ────────────────────┘                    plan (IImportPlan)
                                                                         │ confirm
                                                                      applying
                                                                         │
                                                                       result ──(restartRequired)──▶ Restart now / Later
```

The whole-workspace branch keeps its CLEAN-112 machine
(`pick → uploading → plan → applying → result`). The mode switch is enabled
only in `pick`.
