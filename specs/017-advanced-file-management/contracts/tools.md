# Contract: agent tools for workspace files (CLEAN-112)

All tools live on `FileTool` (`api/src/slices/agent/file/file.tool.ts`), topic `ToolTopics.AgentWorkspace`, listed for operators only (`isListedForRequest` → `callerIsOperator`). They call the same services the controller calls (`IFileGateway`, `WorkspaceArchiveService`, `FileProposalService`). Results pass through `stripSecrets`. Existing `delete_agent_file`, `sync_agent_files`, `export_agent_files` are unchanged.

## Confirm convention (write / create / import)

1. First call, no `confirm` → the tool **creates a proposal**, publishes the card to the active turn, and returns:
   ```json
   { "ok": true, "proposalId": "…", "status": "pending",
     "summary": { "path": "agent.config.json", "additions": 1, "deletions": 1 },
     "next": "Show the person the change and wait. Call again with confirm: true and this proposalId only after they accept in the chat or press Apply on the card." }
   ```
2. Confirming call: `confirm: true` **and** `proposalId` → applies exactly that proposal; returns its final state (`applied` with `restartRequired`, or `stale` / `refused` with the reason). `confirm: true` without `proposalId`, or with an id that is not pending / belongs to another agent, is refused with `err(...)` and writes nothing.
3. If the person already pressed **Apply** on the card, the confirming call returns `applied` (idempotent), so the agent can always close the loop.

## Tools

| name | title | template | parameters | destructive |
|---|---|---|---|---|
| `list_agent_files` | List workspace files | List the files of the agent «name» | `agentId`, `prefix?` | no |
| `read_agent_file` | Read a workspace file | Read «path» from the agent «name» | `agentId`, `path`, `offset?`, `limit?` (≤ `MAX_RANGE_BYTES`) | no |
| `write_agent_file` | Change a workspace file | Change «path» of the agent «name»: «what to change» | `agentId`, `path`, `content`, `confirm?`, `proposalId?` | yes (`confirm`) |
| `create_agent_file` | Create a workspace file | Create «path» in the agent «name» | `agentId`, `path`, `content?`, `confirm?`, `proposalId?` | yes (`confirm`) |
| `import_agent_files` | Import a workspace archive | Import the archive «attachment or link» into the agent «name» | `agentId`, `attachmentId?` \| `url?`, `mode?` (`merge`), `includeSessions?`, `confirm?`, `proposalId?` | yes (`confirm`) |

### Descriptions (what the model reads)

- `list_agent_files`: "Files stored for an agent (path, size, kind, editable, updated). Use `prefix` to narrow (`skills/`). Binary files can be listed and exported, not read."
- `read_agent_file`: "Reads a text file in slices of up to 512 KB; the result carries `nextOffset` when more remains. Binary files are refused — offer export instead."
- `write_agent_file`: "Replaces the content of a text file. The first call only proposes: the person sees a diff card and must accept. Files larger than 1 MiB cannot be written this way — tell the person to use the Files tab. Invalid JSON for a `.json` path is refused before proposing. Changes apply to the running agent after a restart."
- `create_agent_file`: as write, plus "refused when the path already exists".
- `import_agent_files`: "Imports a zip with the workspace layout (root files, data/, memory/, skills/, workspace/). Give either the chat attachment id the person uploaded or an https link. The first call stages and previews (added / changed / removed / skipped); the person must accept. `mode: replace` also deletes files not in the archive and needs its own explicit acceptance. Chat attachments are limited to 10 MB; larger archives go through the Import button in the Files tab or a link."

### Refusals (all `err`, nothing written)

- caller is not an operator → not listed at all
- unknown agent → "no agent «id»"
- path traversal / absolute → "path must be relative to the workspace"
- binary target for read/write → "«path» is not a text file"
- over `MAX_EDIT_BYTES` → "…is too large to write from the chat (limit 1 MiB)"
- `.json` content that does not parse → "invalid JSON at line L col C"
- `confirm` without a pending `proposalId` → "no pending proposal to confirm"
- import source neither attachment nor https url; url resolves to a private address; archive refused by validation (message names the entry/limit)
- `mode: replace` without the person's separate acceptance → the proposal is created with `mode: replace`, and the card's Apply shows the removal count and requires the second acknowledgement

## Spec (jest, `file.tool.spec.ts`)

For each new tool: unlisted for a non-operator request; happy path through the real service with a mocked gateway; write/create/import — first call returns `pending` + id and performs no `save`/`putObject`; confirming call with the right id applies; confirming with a wrong/missing id refuses; `stale` when the ETag moved between propose and confirm. Metadata (topic/title/template/destructive+confirm) boots under `McpRegistryService.validateToolMetadata`.

## Tools panel

All five appear under "Agent workspace" in the chat's Tools shelf with their templates. `docs/agent-tools.md` checklist applies; the PR lists the Files-tab capabilities and the tool that backs each one (the local file picker is the one console-only action, and `import_agent_files`'s description says so).
