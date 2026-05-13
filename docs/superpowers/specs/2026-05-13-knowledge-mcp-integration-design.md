# Knowledge MCP Integration Design

**Date:** 2026-05-13
**Status:** Draft
**Branch:** `feat/reins-lightrag`

## Goal

Wire knowledge bases (reins) to agents at runtime via MCP. Today `Template.defaultKnowledgeIds` is purely declarative: admin picks bases in UI, but the agent pod never learns about them. Result: knowledge integration only works if a skill author hardcodes a knowledge ID into the agent's prompt/skill.

After this change: admin picks knowledge bases on a template (or per-agent override), and the agent automatically gets a `query_knowledge` MCP tool exposing exactly those bases. No skill changes, no hardcoded IDs.

## Non-goals

- RAG auto-injection into every prompt. The LLM decides when to call the tool, same pattern as any other MCP tool.
- Cross-tenant knowledge sharing. An agent only sees bases bound to its template or to itself.
- Knowledge reindexing or LightRAG infra changes. Reins is treated as-is.

## Architecture

```
Admin                                              Agent runtime
─────                                              ─────────────
template.defaultKnowledgeIds   ┐
agent.knowledgeIds (override)  ├─►  workflow gateway
                               │    resolves effective ids
                               │    if non-empty + reins enabled,
                               │    append "mcp-knowledge" to
                               │    mcpServersB64
                               │
                                  ┌──────────────────┐
                                  │  agent pod env   │
                                  │  MCP_SERVERS_B64 │
                                  └────────┬─────────┘
                                           ▼
                                   MCP discovery + connect
                                           ▼
                                   ┌──────────────────────┐
                                   │ mcp-knowledge server │
                                   │ (built-in, on Ranch) │
                                   │                      │
                                   │ Tool: query_knowledge│
                                   │   (knowledge_id,     │
                                   │    query)            │
                                   │                      │
                                   │ Auth: bearer JWT     │
                                   │  → agent_id → check  │
                                   │     allowed ids      │
                                   └──────────┬───────────┘
                                              ▼
                                   KnowledgeService.query
                                   (existing, reins slice)
                                              ▼
                                   LightRAG
```

Effective knowledge ids resolution mirrors the LLM credential pattern:

```ts
const effectiveIds = agent.knowledgeIds.length > 0
  ? agent.knowledgeIds
  : template.defaultKnowledgeIds;
```

## Data model

Add `knowledgeIds` to Agent. No foreign key on Knowledge (matches `Template.defaultKnowledgeIds`). Stale ids get filtered at deploy and at query time.

```prisma
// api/src/slices/agent/agent/agent.prisma
model Agent {
  // ... existing fields
  knowledgeIds  String[]  @default([])
}
```

One Prisma `auto` migration: `ALTER TABLE "Agent" ADD COLUMN "knowledgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[]`.

DTO/mapper/gateway updates follow the same shape as `defaultKnowledgeIds` on Template:
- `IAgentData.knowledgeIds: string[]`
- `ICreateAgentData.knowledgeIds?: string[]`
- `IUpdateAgentData.knowledgeIds?: string[]`
- `CreateAgentDto` and `UpdateAgentDto` add `@IsArray @IsString({ each: true }) @IsOptional` field
- `AgentMapper.toEntity` and `toCreate` pass through the value (default `[]`)
- `AgentGateway.update` spreads `...(data.knowledgeIds !== undefined && { knowledgeIds: data.knowledgeIds })`

## MCP architecture: single endpoint reality

Ranch's MCP infrastructure is a single `McpModule.forRoot()` registration mounted at `mcp/mcp` (and `mcp/sse`, `mcp/messages`). All `@Tool`-decorated providers register globally in one registry. There is no per-caller `list_tools` filtering today.

This means: a `McpServer` DB entry's `url` field is descriptive, not a routing target. Both `mcp-ranch` and a new `mcp-knowledge` entry would point to the same `http://api:3001/mcp/mcp` endpoint and surface the same set of tools to whoever connects.

Implication: attaching `mcp-knowledge` to a regular template exposes that template's agents to ALL globally-registered tools, including rancher admin tools (`list_agents`, `restart_agent`, `write_agent_file`, ...). Today this works only by discipline: regular templates do not attach `mcp-ranch`, so they never connect to MCP at all.

We need to close this gap before the knowledge MCP can ship. See "Tool-level authorization" below.

## MCP server: mcp-knowledge

A new built-in `McpServer` row, parallel to `mcp-ranch`. Seeded by the existing `mcpServer.seeder.ts`.

```ts
// api/src/slices/mcpServer/domain/mcpServer.seeder.ts
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';

const builtIns = [
  // ... existing entries (RANCH_MCP_ID)
  {
    id: KNOWLEDGE_MCP_ID,
    name: 'Knowledge',
    description: 'Query knowledge bases bound to this agent.',
    url: 'http://api:3001/mcp/mcp',
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: '${RANCH_API_TOKEN}',
    enabled: true,
    builtIn: true,
  },
];
```

The DB entry is mostly metadata. The agent runtime deduplicates by url, so attaching both `mcp-ranch` and `mcp-knowledge` to a template results in a single MCP connection. The reason to keep both entries is admin UX: the user sees `Knowledge` as a distinct capability when looking at a template's attached servers (or auto-injected ones).

Authentication uses the existing `RANCH_API_TOKEN` JWT pattern (same as the rancher MCP).

## Tool-level authorization

Today only KnowledgeTool's per-call check exists in this design. We also need to gate rancher admin tools so they refuse callers without `Owner` role, regardless of whether mcp-ranch or mcp-knowledge brought them to the endpoint.

Add a small helper plus role check at the top of every rancher.tool method:

```ts
// api/src/slices/rancher/rancher.tool.ts
private requireOwner(ctx: AgentContext): void {
  if (!ctx.roles?.includes(UserRoleTypes.Owner)) {
    throw new ForbiddenException('This tool requires platform admin role.');
  }
}

@Tool({ name: 'list_agents', ... })
async listAgents(_: {}, ctx: AgentContext) {
  this.requireOwner(ctx);
  // ... existing impl
}
```

`AgentContext.roles` is parsed from the bearer JWT; admin agents get `[Owner]`, regular agents get `[Agent]`. `KnowledgeTool` does NOT require Owner - it only requires that the calling agent has the requested knowledge_id in its allowed list.

This still leaks tool names to non-Owner agents (they see `list_agents` in the tool list and learn it exists). That is acceptable for v1. A follow-up could add per-caller `list_tools` filtering via MCP module metadata, but it is non-trivial and out of scope.

## Knowledge tool

New file under the reins slice. Lives next to `KnowledgeService` because it composes reins functionality and the reins/extraction plan already groups knowledge-related code there.

```ts
// api/src/slices/reins/knowledge/knowledge.tool.ts
@Injectable()
export class KnowledgeTool {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeGateway: IKnowledgeGateway,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
  ) {}

  @Tool({
    name: 'query_knowledge',
    description: 'Query a knowledge base. Bases bound to this agent are listed in tool context.',
    parameters: z.object({
      knowledge_id: z.string().describe('Knowledge base id'),
      query: z.string().describe('Natural-language search query'),
    }),
  })
  async query(
    { knowledge_id, query }: { knowledge_id: string; query: string },
    ctx: AgentContext,
  ) {
    const allowedIds = await this.resolveAllowedIds(ctx.agentId);
    if (!allowedIds.includes(knowledge_id)) {
      return err(`Knowledge ${knowledge_id} not bound to this agent.`);
    }
    const result = await this.knowledgeService.query(knowledge_id, query);
    return ok(result);
  }

  private async resolveAllowedIds(agentId: string): Promise<string[]> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return [];
    if (agent.knowledgeIds.length > 0) return agent.knowledgeIds;
    const template = await this.templateGateway.findById(agent.templateId);
    return template?.defaultKnowledgeIds ?? [];
  }
}
```

Caller identity (`ctx.agentId`) comes from the MCP request's bearer JWT, which is the per-agent service token issued by `AuthService.issueAgentServiceToken`. The existing MCP middleware extracts and verifies this.

### Tool description: static for v1

For the first iteration the tool description is static (single string). LLM passes a `knowledge_id` and the tool authorizes server-side.

To let the LLM pick a base by meaning rather than id, a follow-up change can make `list_tools` per-caller, fetching the agent's bound bases and embedding their `name`/`description` into the tool description. Out of scope for v1 to keep the change small.

### Module wiring

```ts
// api/src/slices/reins/knowledge/knowledge.module.ts
@Module({
  providers: [
    KnowledgeService,
    KnowledgeTool,                                                    // new
    { provide: IKnowledgeGateway, useClass: KnowledgeGateway },
  ],
  exports: [IKnowledgeGateway, KnowledgeService, KnowledgeTool],     // export tool
})
```

The MCP wiring layer (existing in Ranch) picks up `@Tool`-decorated providers from the module and exposes them at the configured route.

## Workflow auto-injection

`argo-workflow.gateway.ts` already builds `mcpServers` from `template.mcpServers`. After that, append the built-in knowledge MCP if relevant.

```ts
// inside submitAgentWorkflow, after existing mcpServers resolution
const effectiveKnowledgeIds = agent.knowledgeIds.length > 0
  ? agent.knowledgeIds
  : template.defaultKnowledgeIds;

if (effectiveKnowledgeIds.length > 0) {
  const existing = await this.knowledgeGateway.findExistingByIds(effectiveKnowledgeIds);
  const isEnabled = await this.knowledgeConfig.isEnabled();

  if (existing.length > 0 && isEnabled) {
    const knowledgeMcp = await this.mcpServerGateway.findById(KNOWLEDGE_MCP_ID);
    if (knowledgeMcp && !mcpServers.some(m => m.id === KNOWLEDGE_MCP_ID)) {
      mcpServers.push(knowledgeMcp);
    }
  }
}
```

New gateway method:

```ts
// IKnowledgeGateway
abstract findExistingByIds(ids: string[]): Promise<IKnowledgeData[]>;
```

Implementation: `prisma.knowledge.findMany({ where: { id: { in: ids } } })`. Used to drop ids referring to deleted bases.

The injection is idempotent: if admin manually attached `mcp-knowledge` to the template via the UI, the duplicate-guard skips re-adding.

## Admin UI

### Agent form (`admin/slices/agent/agent/components/agent/Form.vue`)

Add a section "Knowledge bases (override)" below the LLM credential picker. Reuse the chip-style picker already used in `templateEdit/Provider.vue`.

States:
- Empty array → "Inherits from template" placeholder
- Non-empty → explicit per-agent list, with a "Clear override" button to reset to inheritance

Submit updates `agent.knowledgeIds` via existing `agentStore.update`.

### Agent detail page

In the existing "Overview" tab, add a "Knowledges" sub-section showing the effective list (resolved server-side, returned in `IAgentData` if we extend the DTO with `effectiveKnowledgeIds`, OR resolved client-side from `agent.knowledgeIds` plus `template.defaultKnowledgeIds`).

Per-row badge: `from template` vs `agent override`. Empty state: "No knowledge bases bound."

### Template detail

No changes. The existing knowledge picker in template form continues to manage `defaultKnowledgeIds`.

## Restart semantics

MCP server list is built at deploy time and baked into `MCP_SERVERS_B64`. Changes to `knowledgeIds` (template or agent) require an agent restart to take effect. Two existing flows cover this:

- Template detail page already has "Restart all agents using this template"
- Agent detail page already has per-agent "Restart"

No new automation. Admin decides when to roll out.

## Failure modes

| Scenario | Behavior |
|---|---|
| reins disabled | MCP not injected; agent never sees the tool |
| effective ids empty | MCP not injected |
| all ids stale (bases deleted) | MCP not injected after filtering |
| Some ids stale | MCP injected with only existing ids; stale ids silently dropped |
| LightRAG unhealthy at query time | Tool returns `{ error: 'Knowledge service unavailable' }`; other tools keep working |
| Agent calls with id not in allowed set | Tool returns `{ error: 'Knowledge ${id} not bound to this agent' }` |
| Base deleted between deploy and query | Same as previous - server-side check returns `not bound` |

## Open questions

None for v1. Per-caller dynamic tool description (so LLM picks by base name without knowing ids) is a possible follow-up.

## File-by-file change summary

**API (NestJS):**
- `api/src/slices/agent/agent/agent.prisma` - add `knowledgeIds String[]`
- `api/src/slices/agent/agent/domain/agent.types.ts` - add field to all three interfaces
- `api/src/slices/agent/agent/data/agent.mapper.ts` - pass through field
- `api/src/slices/agent/agent/data/agent.gateway.ts` - update spread in `update`
- `api/src/slices/agent/agent/dtos/agent.dto.ts`, `createAgent.dto.ts`, `updateAgent.dto.ts` - add field
- `api/src/slices/mcpServer/domain/mcpServer.seeder.ts` - seed `KNOWLEDGE_MCP_ID`
- `api/src/slices/reins/knowledge/knowledge.tool.ts` - new file
- `api/src/slices/reins/knowledge/knowledge.module.ts` - register tool, depend on AgentModule + TemplateModule
- `api/src/slices/reins/knowledge/domain/knowledge.gateway.ts` and `data/knowledge.gateway.ts` - add `findExistingByIds`
- `api/src/slices/rancher/rancher.tool.ts` - add `requireOwner` guard at top of every method
- `api/src/slices/workflow/data/argo-workflow.gateway.ts` - inject knowledge MCP
- new Prisma migration

**Admin (Nuxt):**
- `admin/slices/agent/agent/components/agent/Form.vue` - add picker
- `admin/slices/agent/agent/stores/agent.ts` - add `knowledgeIds` field to types
- `admin/slices/agent/agent/components/agent/Provider.vue` - render effective list with origin badge
- regenerated `setup/api/data/repositories/api/*.gen.ts`
