# Contract: `?tab=` on `/agents/:id` (admin)

The only externally visible interface this feature touches. Links with these values are
pasted into Jira tickets, chats and browser bookmarks, so the meaning of every existing
value is frozen.

## Values

| `?tab=` | Before (specs/006) | After (this feature) |
|---------|--------------------|----------------------|
| *(absent)* | Chat | Chat — unchanged |
| `chat` | Chat; normalised away on mount | unchanged |
| `overview` | Overview tab | Settings › Overview section |
| `knowledge` | Knowledge tab | Settings › Knowledge section |
| `a2a` | A2A tab | Settings › A2A section |
| `peers` | alias → `a2a` | unchanged alias |
| `files` | Files tab | Settings › Files section |
| `channels` | Channels tab | Settings › Channels section |
| `logs` | Logs tab (full width) | Settings › Logs section (full width) |
| `secrets` | More › Secrets | Settings › Secrets section |
| `env` | More › Environment | Settings › Environment section |
| `chats` | More › Chats | Settings › Chats section |
| `paddock` | More › Paddock | Settings › Paddock section |
| `settings` | *(unknown → Chat)* | **new** — the Settings hub |
| any other | Chat | unchanged |

## Rules

- Values are byte-identical to today's; no value is renamed or removed.
- `settings` is the only addition. Old consoles that do not know it fall back to Chat,
  which is the existing rule for unknown values.
- Writing: Chat strips the parameter; every other value is written verbatim with
  `router.replace` (no history entry per tab switch).
- Other query parameters on the route are preserved on every write (existing
  `...route.query` spread).

## Test surface

`admin/slices/agent/agent/utils/sections.test.ts` asserts the table above through
`toAgentTab`, `workspaceTabOf` and `sectionOf`.
