# Data model: Agent tool parity (CLEAN-109)

## 1. ToolMetadata (in-process, from the `@Tool` decorator)

```ts
interface ToolMetadata {
  name: string;          // technical name, snake_case, unchanged for existing tools
  description: string;   // what the model reads; may be replaced per caller by describeForRequest
  parameters: z.ZodTypeAny;
  topic: ToolTopic;      // one of ToolTopics (see contracts/tool-metadata.md)
  title: string;         // human title for the panel row, e.g. "Register an MCP server"
  template: string;      // starter prompt with «…» placeholders, e.g. "Register the MCP server at «url» named «name»"
  destructive?: boolean; // true ⇒ parameters must include confirm: z.boolean()
}
```

Validation (at API bootstrap, `McpRegistryService`):
- `topic` ∈ `ToolTopics`; `title` non-empty ≤ 60 chars; `template` non-empty ≤ 200 chars and contains at least one `«…»` unless the tool takes no parameters.
- `destructive === true` ⇒ the JSON schema of `parameters` has a `confirm` property of type boolean.
- `name` unique across the registry (already implied by `findTool`).

## 2. AgentToolListing (PostgreSQL, new)

```prisma
// api/src/slices/agent/toolCatalog/toolCatalog.prisma
import { Agent } from "../agent/agent"

// The tool names the API last served to this agent's runtime on tools/list —
// i.e. what the running pod believes it has. Written on every tools/list from
// an agent token (once per pod boot in practice); read by GET /agents/:id/tools
// to mark tools the pod does not yet know about (CLEAN-109).
model AgentToolListing {
  agentId   String   @id
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  toolNames Json     // string[]
  listedAt  DateTime @default(now())
}
```

Migration: `api/prisma/migrations/20260922120000_agent_tool_listing/migration.sql` — additive `CREATE TABLE` + FK, safe on existing databases. `Agent` gets the back-relation `toolListing AgentToolListing?`.

Lifecycle: upsert on each agent-token `tools/list`; deleted with the agent (cascade). Never read by the runtime.

## 3. Agent tool catalogue (API response, `GET /agents/:id/tools`)

```ts
interface AgentToolCatalog {
  agentId: string;
  podStartedAt: string | null;   // ISO; null when no pod runs
  listedAt: string | null;       // ISO of the snapshot; null when the pod never listed
  groups: AgentToolGroup[];      // ordered by ToolTopics order, then external servers
}

interface AgentToolGroup {
  key: string;                   // topic key, or `mcp:<serverId>` for an external server
  title: string;                 // topic title or server name
  kind: 'builtin' | 'external';
  description?: string;          // external servers: the row's description; builtin: none
  afterRestart: boolean;         // builtin: any tool with inPod === false; external: server drift from detectMcpConfigDrift
  tools: AgentToolEntry[];       // external groups: [] (tools are provided by the server itself)
}

interface AgentToolEntry {
  name: string;
  title: string;
  description: string;           // per-caller description (dynamic when the tool provides one)
  template: string;
  destructive: boolean;
  inPod: boolean | null;         // null: no pod; false: pod lacks it; true: pod listed it
}
```

Derivation:
- `tools` = `ToolCatalogService.listFor(principal)` with `principal = { sub: 'agent:<id>', roles: agent.isAdmin ? [Owner] : [Agent] }`.
- `listingState`: `none` when no pod runs; `pending` when there is no snapshot or the snapshot is older than the pod (with 10 s of clock slack) — the running pod has not listed its tools yet; `fresh` otherwise.
- `inPod` = `listingState === 'fresh' ? snapshot.toolNames.includes(name) : null`. A badge is only ever a claim backed by this pod's own listing; right after a restart the sheet shows "loading its tools" and polls instead.
- External groups = `AgentMcpResolver.resolveForAgent(agent)` minus built-in ids (`mcp-ranch`, `mcp-knowledge`, `mcp-documents`, `mcp-cleanslice`); `authValue` and `url` are **not** returned.
- Response is not cached; one DB read (snapshot) + resolver + pod list.

Authorization: `@Roles(Owner, Admin)` — the same audience as `GET /agents/:id/mcp-status`. Agent tokens are refused (they get their list from `tools/list`).

## 4. Admin store (`admin/slices/agent/toolCatalog/stores/toolCatalog.ts`)

```ts
interface IAgentToolCatalog { /* mirror of §3, mapped by ToolCatalogMapper */ }

state: {
  catalogs: Record<string, IAgentToolCatalog>;          // entity, keyed by agentId
  ui: Record<string, { query: string; expanded: string[] }>; // per-agent sheet state, session only
}
getters: byAgent(agentId) → IAgentToolCatalog | undefined
actions:
  fetch(agentId): Promise<IAgentToolCatalog>   // gateway → upsert → return the stored record
  upsert(catalog): IAgentToolCatalog
  setQuery(agentId, q) / toggleGroup(agentId, key) / setExpanded(agentId, keys)
```

Rules: components render `computed(() => store.byAgent(agentId))`; `useAsyncData` supplies only `pending` / `error` / `refresh`. After a restart, the sheet calls `fetch(agentId)` again when the agent's status returns to running (watch on `agentStore.byId(agentId)?.status`).

## 5. Composer insertion (pure util)

```ts
insertTemplate(draft: string, cursor: number, template: string):
  { text: string; selectionStart: number; selectionEnd: number }
```
- Inserts `template` at `cursor`; prefixes a space when `draft.slice(0, cursor)` is non-empty and does not end with whitespace; suffixes a space when the remainder does not start with whitespace.
- `selectionStart/End` bound the first `«…»` in the inserted text, or the end of the insertion when there is none.
- `hasPlaceholder(text)`: `/«[^»]*»/.test(text)`.

## 6. Setting catalogue (constant)

```ts
interface ISettingDefinition {
  group: string; name: string; valueType: 'string' | 'json';
  description: string; restartRequired: boolean;
}
export const SETTING_CATALOG: ISettingDefinition[]  // compiled from admin settings pages
```
Used by `list_settings`/`upsert_setting` dynamic descriptions and `get_setting` validation messages.

## State transitions worth naming

- **Tool present → after restart**: API deploys with a new tool; pod still lists the old snapshot ⇒ `inPod=false`, `afterRestart=true` for its group. Operator restarts ⇒ new pod calls `tools/list` ⇒ snapshot overwritten ⇒ `inPod=true`.
- **Agent stopped**: `podStartedAt=null` ⇒ every `inPod=null`; the sheet shows the list without restart markers and the composer stays disabled as today.
- **Tool removed from the caller's view** (e.g. self-service switched off): it disappears from the catalogue and `tools/call` refuses it with the existing "not available to this caller" text.
