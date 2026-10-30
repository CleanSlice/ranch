# Contract: agent tool delta for selected-files import (CLEAN-192)

Base: `specs/017-advanced-file-management/contracts/tools.md`. One tool
changes; no tool is added. `FileTool` (`api/src/slices/agent/file/file.tool.ts`),
topic `ToolTopics.AgentWorkspace`, operators only, results through
`stripSecrets`, confirm-by-proposal convention unchanged.

## `import_agent_files` (extended)

| field | before | after |
|---|---|---|
| title | Import a workspace archive | Import files into a workspace |
| template | Import the archive «attachment or link» into the agent «name» | Import «attachment(s) or link» into the agent «name» |
| parameters | `agentId`, `attachmentId?` \| `url?`, `mode?`, `includeSessions?`, `confirm?`, `proposalId?`, `confirmRemove?` | + `attachmentIds?: string[]`, `targetFolder?: string`, `targets?: { name, path }[]` |
| destructive | yes (`confirm`) | unchanged |

### Routing

- `attachmentIds` given, **or** `attachmentId` whose stored body does not
  start with the zip signature → **selected-files** path.
- otherwise (a zip attachment or `url`) → the CLEAN-112 archive path, unchanged.
- `mode: replace` with the selected-files path → `err("Selected files never
  remove anything; use a workspace archive for replace.")`.

### Selected-files path

1. Fetch each attachment (scoped to the chat agent, as today); refuse an
   unknown id, more than `importMaxFiles`, or a body over
   `importMaxFileBytes`.
2. `resolveSelectedFiles(names, targetFolder)`.
3. If a row is `ambiguous` and `targets` does not give it a path → return
   ```json
   { "ok": true, "status": "needs_choice",
     "needsChoice": [{ "name": "SKILL.md", "candidates": ["skills/a/SKILL.md", "skills/b/SKILL.md"] }],
     "next": "Ask the person which file to replace (or to add it as new in «folder»), then call again with targets." }
   ```
   No proposal, no stage, nothing written.
4. Otherwise stage (`kind: 'files'`, `expected` ETags) and `proposeImport`
   → the same pending result and set card as an archive import:
   `plan.counts`, `plan.totalBytes`, `sample` rows. `confirm: true` +
   `proposalId` applies through `FileProposalService.apply` → `applySet`,
   which honours the files stage (no wrapper strip, ETag guard, merge only).

### Description addition (what the model reads)

"Plain files work too: give `attachmentIds` (one or more non-zip
attachments). Each is matched by its exact file name anywhere in the
workspace: one match → it replaces that file; none → it is added in
`targetFolder` (root by default); several → the result lists the candidates
under `needsChoice` and you must ask the person, then call again with
`targets: [{ name, path }]`. Selected files never delete anything."

### Refusals (all `err`, nothing written)

- not an operator → tool not listed
- unknown agent / unknown attachment
- a name with a path separator; two attachments with the same name
- over `importMaxFiles` or `importMaxFileBytes`
- a `targets` path that is not the unique match, a candidate, or
  `<targetFolder>/<name>` for that name
- `mode: replace` on the selected-files path

## Spec (jest, `file.tool.spec.ts`)

- plain attachment → selected-files path; the staged meta has
  `kind: 'files'`; the result is `pending` with a proposal id and no
  `putObjectRaw` call.
- two attachments named `SKILL.md` → `err` duplicate, no stage.
- ambiguous name without `targets` → `needs_choice`, no proposal row.
- ambiguous name with a valid `targets` entry → pending proposal; with an
  invalid path → `err`.
- `confirm: true` on that proposal → applied, `restartRequired` reflects the
  agent status; a row whose ETag moved is in `failed` with
  `changed since previewed`.
- metadata still boots under `McpRegistryService.validateToolMetadata`.

## Tools panel

The template reads "Import «attachment(s) or link» into the agent «name»";
`docs/agent-tools.md` checklist applies. The PR lists the new console
capability (selected-files import) and names this tool as its backing.
