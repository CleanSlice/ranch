# Knowledge MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire knowledge bases to agents at runtime via a built-in `mcp-knowledge` MCP server, so agents bound to a template (or override) with `knowledgeIds` get a working `query_knowledge` tool automatically.

**Architecture:** Add `Agent.knowledgeIds` (override on top of `template.defaultKnowledgeIds`). A new `KnowledgeTool` registers under the global MCP registry, auto-extracts caller agentId from bearer JWT, and authorizes against the effective allowed list. A new seeded `mcp-knowledge` McpServer entry gets auto-injected into the agent's `mcpServersB64` by the workflow gateway when relevant. A `requireOwner` guard hardens rancher admin tools so the broader tool exposure does not leak privileged operations.

**Tech Stack:** NestJS 11, Prisma 6, Zod, Vue 3 / Nuxt 3, Pinia.

**Reference spec:** `docs/superpowers/specs/2026-05-13-knowledge-mcp-integration-design.md`

**Conventions:**
- Ranch has no test suite. Verify each task manually (curl, admin UI, agent runtime logs).
- Commit messages: `<type>(<scope>): <subject>`. No `Co-Authored-By`.
- No em dashes (U+2014) or en dashes (U+2013) in code or docs. Plain hyphens, commas, colons.
- Strong TypeScript: no `any`, no `as` outside boundary cases. Type guards where needed.
- Vue: no leading meta comments, no imports of Nuxt auto-imports.

---

## Task 1: Add `Agent.knowledgeIds` field

**Files:**
- Modify: `api/src/slices/agent/agent/agent.prisma`
- Modify: `api/src/slices/agent/agent/domain/agent.types.ts`
- Modify: `api/src/slices/agent/agent/dtos/createAgent.dto.ts`
- Modify: `api/src/slices/agent/agent/dtos/updateAgent.dto.ts`
- Modify: `api/src/slices/agent/agent/dtos/agent.dto.ts`
- Modify: `api/src/slices/agent/agent/data/agent.mapper.ts`
- Modify: `api/src/slices/agent/agent/data/agent.gateway.ts`
- New (auto-generated): `api/prisma/migrations/<timestamp>_auto/migration.sql`

- [ ] **Step 1: Add field to Prisma model**

In `api/src/slices/agent/agent/agent.prisma`, add to `model Agent` after `allowedOrigins`:

```prisma
  knowledgeIds   String[]       @default([])
```

- [ ] **Step 2: Generate Prisma client and migration**

```bash
cd api && bun run migrate
```

Expected: New migration file created under `api/prisma/migrations/<timestamp>_auto/`. SQL should be `ALTER TABLE "Agent" ADD COLUMN "knowledgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];`. Prisma client regenerated.

- [ ] **Step 3: Add field to domain types**

In `api/src/slices/agent/agent/domain/agent.types.ts`, add `knowledgeIds` to all three interfaces:

```ts
export interface IAgentData {
  // ... existing fields
  knowledgeIds: string[];
}

export interface ICreateAgentData {
  // ... existing fields
  knowledgeIds?: string[];
}

export interface IUpdateAgentData {
  // ... existing fields
  knowledgeIds?: string[];
}
```

- [ ] **Step 4: Add field to DTOs**

In `api/src/slices/agent/agent/dtos/createAgent.dto.ts`, add after `allowedOrigins`:

```ts
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeIds?: string[];
```

In `api/src/slices/agent/agent/dtos/updateAgent.dto.ts`, same field.

In `api/src/slices/agent/agent/dtos/agent.dto.ts`, add to the response DTO (required, default empty):

```ts
  @ApiProperty({ type: [String] })
  knowledgeIds: string[];
```

- [ ] **Step 5: Map field in mapper**

In `api/src/slices/agent/agent/data/agent.mapper.ts`:

`toEntity`: add `knowledgeIds: record.knowledgeIds,`
`toCreate`: add `knowledgeIds: data.knowledgeIds ?? [],`

- [ ] **Step 6: Spread field in gateway update**

In `api/src/slices/agent/agent/data/agent.gateway.ts`, inside the `update` method's `data:` object, add (mirroring the existing `allowedOrigins` pattern):

```ts
        ...(data.knowledgeIds !== undefined && {
          knowledgeIds: data.knowledgeIds,
        }),
```

- [ ] **Step 7: Verify typecheck and migration applied**

```bash
cd api && bunx tsc --noEmit
```

Expected: no new errors related to `knowledgeIds`. (Pre-existing errors from previous merge may remain.)

Verify the migration applied:

```bash
cd api && dotenv -e .env.dev -- npx prisma db execute --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name='Agent' AND column_name='knowledgeIds';"
```

Expected: 1 row returned.

- [ ] **Step 8: Commit**

```bash
git add api/src/slices/agent/agent/ api/prisma/migrations/
git commit -m "feat(agent): add knowledgeIds override field"
```

---

## Task 2: Add `findExistingByIds` to KnowledgeGateway

**Files:**
- Modify: `api/src/slices/reins/knowledge/domain/knowledge.gateway.ts`
- Modify: `api/src/slices/reins/knowledge/data/knowledge.gateway.ts`

- [ ] **Step 1: Declare abstract method**

In `api/src/slices/reins/knowledge/domain/knowledge.gateway.ts`, add an abstract method to `IKnowledgeGateway`:

```ts
  abstract findExistingByIds(ids: string[]): Promise<IKnowledgeData[]>;
```

(Place it near the other read methods such as `findById`.)

- [ ] **Step 2: Implement in data gateway**

In `api/src/slices/reins/knowledge/data/knowledge.gateway.ts`, add the method to `KnowledgeGateway`:

```ts
  async findExistingByIds(ids: string[]): Promise<IKnowledgeData[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.knowledge.findMany({
      where: { id: { in: ids } },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd api && bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/slices/reins/knowledge/
git commit -m "feat(reins): add findExistingByIds to knowledge gateway"
```

---

## Task 3: Apply JwtAuthGuard to MCP routes

The MCP module currently has no guards, so `req.user` is never populated. We need it populated so tools can authorize by caller. The agent runtime already sends `Authorization: Bearer ${RANCH_API_TOKEN}` (per the seeded MCP entry's `authType: 'bearer'`), so this should not break the existing rancher template.

**Files:**
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Pass JwtAuthGuard to McpModule.forRoot**

In `api/src/app.module.ts`, update the `McpModule.forRoot(...)` call. Add a `guards` array containing `JwtAuthGuard`. The guard must be imported.

Add import at top:

```ts
import { JwtAuthGuard } from './slices/user/auth/guards';
```

Update the call:

```ts
    McpModule.forRoot({
      name: 'ranch',
      version: '1.0.0',
      sseEndpoint: 'mcp/sse',
      messagesEndpoint: 'mcp/messages',
      mcpEndpoint: 'mcp/mcp',
      guards: [JwtAuthGuard],
    }),
```

- [ ] **Step 2: Confirm AuthModule provides JwtAuthGuard globally**

`JwtAuthGuard` depends on `JwtService` and `Reflector`. Verify by reading `api/src/slices/user/auth/auth.module.ts` that:
- `JwtModule.register(...)` is imported with the same secret used to sign agent tokens
- `AuthModule` exports `JwtAuthGuard` (it does, per current code)

No code change expected here — just a verification read. If the guard is not exported, add it to the `exports:` array.

- [ ] **Step 3: Start dev API and verify rancher MCP still works**

```bash
cd api && bun run dev
```

In another terminal, with a valid Owner JWT in `$TOKEN`:

```bash
curl -sS -X POST http://localhost:3000/mcp/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -40
```

Expected: 200 OK with a list of tools including `list_agents`, `list_templates`, etc.

Then verify auth is enforced:

```bash
curl -sS -X POST http://localhost:3000/mcp/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: 401 Unauthorized.

- [ ] **Step 4: Commit**

```bash
git add api/src/app.module.ts
git commit -m "feat(mcp): require JWT auth on built-in MCP endpoints"
```

---

## Task 4: Create KnowledgeTool

**Files:**
- New: `api/src/slices/reins/knowledge/knowledge.tool.ts`

- [ ] **Step 1: Create the tool file**

Create `api/src/slices/reins/knowledge/knowledge.tool.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { KnowledgeService } from './domain/knowledge.service';

const ok = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text:
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const err = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

@Injectable()
export class KnowledgeTool {
  private readonly logger = new Logger(KnowledgeTool.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
  ) {}

  @Tool({
    name: 'query_knowledge',
    description:
      'Query a knowledge base bound to this agent. Bases are configured per-template (defaultKnowledgeIds) or per-agent (knowledgeIds override). The caller must pass a knowledge_id from its allowed list.',
    parameters: z.object({
      knowledge_id: z
        .string()
        .describe('Knowledge base id, e.g. knowledge-abc123'),
      query: z.string().describe('Natural-language search query.'),
    }),
  })
  async query(
    { knowledge_id, query }: { knowledge_id: string; query: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    const callerAgentId = this.extractAgentId(httpRequest);
    if (!callerAgentId) {
      return err('query_knowledge can only be called by an agent runtime.');
    }

    const allowedIds = await this.resolveAllowedIds(callerAgentId);
    if (!allowedIds.includes(knowledge_id)) {
      return err(`Knowledge ${knowledge_id} not bound to this agent.`);
    }

    try {
      const result = await this.knowledgeService.query(knowledge_id, query);
      return ok(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Knowledge query failed';
      this.logger.warn(
        `query_knowledge failed for agent=${callerAgentId} knowledge=${knowledge_id}: ${message}`,
      );
      return err(message);
    }
  }

  private extractAgentId(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): string | null {
    const sub = httpRequest.user?.sub ?? '';
    if (!sub.startsWith('agent:')) return null;
    return sub.slice('agent:'.length);
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

- [ ] **Step 2: Typecheck**

```bash
cd api && bunx tsc --noEmit
```

Expected: errors about missing module exports (KnowledgeTool not registered yet) or about unresolved DI. Will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add api/src/slices/reins/knowledge/knowledge.tool.ts
git commit -m "feat(reins): KnowledgeTool with caller-scoped authz"
```

---

## Task 5: Wire KnowledgeTool in KnowledgeModule

**Files:**
- Modify: `api/src/slices/reins/knowledge/knowledge.module.ts`

- [ ] **Step 1: Inspect current module structure**

Read `api/src/slices/reins/knowledge/knowledge.module.ts`. It currently provides `KnowledgeService`, `IKnowledgeGateway`. It needs to also provide `KnowledgeTool`, and import the modules that supply `IAgentGateway` and `ITemplateGateway`.

- [ ] **Step 2: Add imports and provider**

At the top of `api/src/slices/reins/knowledge/knowledge.module.ts`:

```ts
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { KnowledgeTool } from './knowledge.tool';
```

In the `@Module({ ... })` decorator:

```ts
  imports: [
    // ... existing imports
    AgentModule,
    TemplateModule,
  ],
  providers: [
    // ... existing providers
    KnowledgeTool,
  ],
```

Do NOT export `KnowledgeTool` — it is consumed only via the global MCP registry, not by other Nest providers.

- [ ] **Step 3: Verify AgentModule and TemplateModule export their gateways**

Read the two module files to confirm `IAgentGateway` is in `AgentModule.exports` and `ITemplateGateway` in `TemplateModule.exports`. Both should already be true (rancher uses them). If not, add them.

- [ ] **Step 4: Typecheck**

```bash
cd api && bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Boot the dev API and verify tool is registered**

```bash
cd api && bun run dev
```

In another terminal:

```bash
curl -sS -X POST http://localhost:3000/mcp/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep query_knowledge
```

Expected: `query_knowledge` appears in the tool list.

- [ ] **Step 6: Commit**

```bash
git add api/src/slices/reins/knowledge/knowledge.module.ts
git commit -m "feat(reins): register KnowledgeTool with AgentModule + TemplateModule deps"
```

---

## Task 6: Seed the `mcp-knowledge` built-in McpServer

**Files:**
- Modify: `api/src/slices/mcpServer/domain/mcpServer.seeder.ts`

- [ ] **Step 1: Add KNOWLEDGE_MCP_ID constant and seed call**

In `api/src/slices/mcpServer/domain/mcpServer.seeder.ts`, after `RANCH_MCP_ID`:

```ts
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';
```

In the `onApplicationBootstrap` method, after the existing Ranch MCP seed block, add an analogous block for the knowledge MCP. Read the existing block first to mirror its structure precisely (in-cluster URL, fallback to env var, idempotent guard via `findById`).

The seeded record:

```ts
{
  id: KNOWLEDGE_MCP_ID,
  name: 'Knowledge',
  description:
    "Built-in MCP server hosted by this Ranch's own API. Exposes query_knowledge for the knowledge bases bound to this agent. Auth uses the agent's RANCH_API_TOKEN.",
  url: this.config.get<string>('RANCH_MCP_URL') ?? 'http://api:3001/mcp/mcp',
  transport: 'streamableHttp',
  authType: 'bearer',
  authValue: '${RANCH_API_TOKEN}',
  enabled: true,
  builtIn: true,
}
```

Use the same URL as `mcp-ranch` (single endpoint reality, the DB entry is metadata for the admin UX). The agent runtime deduplicates by URL.

- [ ] **Step 2: Typecheck and boot**

```bash
cd api && bunx tsc --noEmit && bun run dev
```

Expected: log line "Seeded built-in Knowledge MCP server at http://...".

- [ ] **Step 3: Verify in DB**

```bash
cd api && dotenv -e .env.dev -- npx prisma db execute --stdin <<< "SELECT id, name, \"builtIn\" FROM \"McpServer\" WHERE id IN ('mcp-ranch','mcp-knowledge');"
```

Expected: 2 rows.

- [ ] **Step 4: Commit**

```bash
git add api/src/slices/mcpServer/domain/mcpServer.seeder.ts
git commit -m "feat(mcpServer): seed built-in mcp-knowledge entry"
```

---

## Task 7: Harden rancher.tool with `requireOwner` guard

Tools registered globally in the MCP registry are now visible to every JWT-authenticated caller. Without this hardening, a regular agent that gets `mcp-knowledge` attached could call `list_agents` and similar admin operations.

**Files:**
- Modify: `api/src/slices/rancher/rancher.tool.ts`

- [ ] **Step 1: Add `requireOwner` helper and import**

At the top of `api/src/slices/rancher/rancher.tool.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { UserRoleTypes } from '#/user/user/domain';
```

Inside the `RancherTool` class, add a private helper:

```ts
  private requireOwner(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): void {
    const roles = httpRequest.user?.roles ?? [];
    if (!roles.includes(UserRoleTypes.Owner)) {
      throw new ForbiddenException(
        'This tool requires platform admin role.',
      );
    }
  }
```

- [ ] **Step 2: Apply guard to every @Tool method**

For each `@Tool`-decorated method in `RancherTool`, change its signature to accept `(args, context, httpRequest)` and call `this.requireOwner(httpRequest)` at the top.

Example (listAgents, currently zero-args):

```ts
  @Tool({ /* ... unchanged */ })
  async listAgents(
    _: {},
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const items = await this.agents.findAll();
    return ok(items);
  }
```

Example with args (getAgent):

```ts
  @Tool({ /* ... unchanged */ })
  async getAgent(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    this.requireOwner(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return ok({ error: `Agent ${id} not found` });
    return ok(agent);
  }
```

Repeat for every `@Tool` in the file. Do not modify the `@Tool` decorator arguments — only the method signature and the first line of each method body.

- [ ] **Step 3: Typecheck**

```bash
cd api && bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Verify with rancher template's agent**

The rancher template's agent JWT has `roles: [Owner]`. Boot dev API, restart the rancher agent, and confirm in its logs that tool calls like `list_agents` still succeed.

Quick smoke from CLI with an Owner token:

```bash
curl -sS -X POST http://localhost:3000/mcp/mcp \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}' | head -30
```

Expected: returns a JSON list (not a ForbiddenException).

With a regular Agent token:

```bash
curl -sS -X POST http://localhost:3000/mcp/mcp \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}' | head -30
```

Expected: error response containing `This tool requires platform admin role.`

- [ ] **Step 5: Commit**

```bash
git add api/src/slices/rancher/rancher.tool.ts
git commit -m "feat(rancher): gate rancher tools behind Owner role"
```

---

## Task 8: Auto-inject mcp-knowledge in workflow gateway

**Files:**
- Modify: `api/src/slices/workflow/domain/IWorkflowGateway.ts`
- Modify: `api/src/slices/workflow/domain/workflow.service.ts`
- Modify: `api/src/slices/workflow/data/argo-workflow.gateway.ts`
- Modify: `api/src/slices/workflow/workflow.module.ts`

- [ ] **Step 1: Extend ISubmitWorkflowData with knowledgeIds**

In `api/src/slices/workflow/domain/IWorkflowGateway.ts`, add `knowledgeIds: string[]` to `ISubmitWorkflowData`. Final shape:

```ts
export interface ISubmitWorkflowData {
  agentId: string;
  agentName: string;
  templateId: string;
  llmCredentialId: string | null;
  image: string;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isAdmin: boolean;
  knowledgeIds: string[];
  ranchApiToken: string;
}
```

- [ ] **Step 2: Pass agent.knowledgeIds from WorkflowService**

In `api/src/slices/workflow/domain/workflow.service.ts`, inside `submitAgentWorkflow`, add the new field to the payload passed to `workflowGateway.submit`:

```ts
return this.workflowGateway.submit({
  agentId: agent.id,
  agentName: agent.name,
  templateId: agent.templateId,
  llmCredentialId: agent.llmCredentialId,
  image,
  config: agent.config,
  resources: agent.resources,
  isAdmin: agent.isAdmin,
  knowledgeIds: agent.knowledgeIds,
  ranchApiToken,
});
```

- [ ] **Step 3: Add dependencies to ArgoWorkflowGateway**

In `api/src/slices/workflow/data/argo-workflow.gateway.ts`, the constructor already has `templateGateway` and `mcpServerGateway`. Add only the two new deps:

```ts
constructor(
  private infraConfig: IInfraConfigGateway,
  private settingGateway: ISettingGateway,
  private llmGateway: ILlmGateway,
  private templateGateway: ITemplateGateway,
  private mcpServerGateway: IMcpServerGateway,
  private knowledgeGateway: IKnowledgeGateway,
  private knowledgeConfig: IKnowledgeConfigGateway,
) {
  super();
}
```

Add imports at the top:

```ts
import { IKnowledgeGateway } from '#/reins/knowledge/domain';
import { IKnowledgeConfigGateway } from '#/reins/config/domain';
import { KNOWLEDGE_MCP_ID } from '#/mcpServer/domain/mcpServer.seeder';
```

- [ ] **Step 4: Update WorkflowModule with new imports**

In `api/src/slices/workflow/workflow.module.ts`, add to `imports:`:

```ts
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { KnowledgeConfigModule } from '#/reins/config/knowledgeConfig.module';
```

```ts
  imports: [
    // ... existing
    KnowledgeModule,
    KnowledgeConfigModule,
  ],
```

(`McpServerModule` is already imported, since `mcpServerGateway` is already used by this gateway.)

- [ ] **Step 5: Compute effective ids and append mcp-knowledge**

Inside the gateway, refactor `resolveMcpServers` to take the new context and append the knowledge MCP when relevant. Replace the current method body:

```ts
private async resolveMcpServers(
  templateId: string,
  effectiveKnowledgeIds: string[],
  ranchApiToken: string,
): Promise<unknown[]> {
  const template = await this.templateGateway.findById(templateId);
  const baseServers =
    template && template.mcpServerIds.length > 0
      ? await this.mcpServerGateway.findByIds(template.mcpServerIds)
      : [];

  const enabledServers = baseServers.filter((m) => m.enabled);

  const shouldInjectKnowledge = await this.shouldInjectKnowledge(
    effectiveKnowledgeIds,
    enabledServers,
  );
  if (shouldInjectKnowledge) {
    const knowledgeMcp =
      await this.mcpServerGateway.findById(KNOWLEDGE_MCP_ID);
    if (knowledgeMcp && knowledgeMcp.enabled) {
      enabledServers.push(knowledgeMcp);
    }
  }

  return enabledServers.map((m) => this.toRuntimeConfig(m, ranchApiToken));
}

private async shouldInjectKnowledge(
  effectiveKnowledgeIds: string[],
  alreadyAttached: IMcpServerData[],
): Promise<boolean> {
  if (effectiveKnowledgeIds.length === 0) return false;
  if (alreadyAttached.some((m) => m.id === KNOWLEDGE_MCP_ID)) return false;
  const isEnabled = await this.knowledgeConfig.isEnabled();
  if (!isEnabled) return false;
  const existing =
    await this.knowledgeGateway.findExistingByIds(effectiveKnowledgeIds);
  return existing.length > 0;
}
```

Update the single call site of `resolveMcpServers` in this file to compute the effective list and pass it in. Find the line that looks like:

```ts
const mcpServers = await this.resolveMcpServers(data.templateId, data.ranchApiToken);
```

Replace with:

```ts
const template = await this.templateGateway.findById(data.templateId);
const effectiveKnowledgeIds =
  data.knowledgeIds.length > 0
    ? data.knowledgeIds
    : (template?.defaultKnowledgeIds ?? []);
const mcpServers = await this.resolveMcpServers(
  data.templateId,
  effectiveKnowledgeIds,
  data.ranchApiToken,
);
```

(The duplicate `templateGateway.findById` is acceptable for v1 since `resolveMcpServers` will also call it. If performance becomes a concern, refactor to pass the template object once.)

- [ ] **Step 6: Typecheck**

```bash
cd api && bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Manual verification**

Boot dev. Create a knowledge base and attach its id to a non-rancher template's `defaultKnowledgeIds`. Deploy a fresh agent on that template. Inspect the submitted Argo workflow parameters:

```bash
kubectl -n argo get workflow -o yaml | grep -A2 mcp-servers-b64
```

Decode the base64 value and confirm it contains the `mcp-knowledge` entry. Then with `defaultKnowledgeIds` cleared, redeploy and confirm `mcp-knowledge` is absent.

- [ ] **Step 8: Commit**

```bash
git add api/src/slices/workflow/
git commit -m "feat(workflow): auto-inject mcp-knowledge for agents with bound bases"
```

---

## Task 9: Regenerate admin SDK and update Agent store types

**Files:**
- Modify: `admin/slices/setup/api/data/repositories/api/*.gen.ts` (auto-generated)
- Modify: `admin/slices/agent/agent/stores/agent.ts`

- [ ] **Step 1: Regenerate swagger and SDK**

```bash
cd api && bun run generate:swagger
cd ../admin && bun run build:api
```

Expected: `admin/slices/setup/api/data/repositories/api/types.gen.ts`, `schemas.gen.ts`, `sdk.gen.ts` updated with `knowledgeIds` on Agent-related DTOs.

- [ ] **Step 2: Add field to admin agent store interfaces**

In `admin/slices/agent/agent/stores/agent.ts`, find `IAgentData`, `ICreateAgentData`, `IUpdateAgentData` interfaces and add:

```ts
  knowledgeIds: string[];   // IAgentData
  knowledgeIds?: string[];  // ICreateAgentData and IUpdateAgentData
```

Match the pattern already used for `allowedOrigins`.

- [ ] **Step 3: Typecheck admin**

```bash
cd admin && bunx vue-tsc --noEmit
```

Expected: no new errors related to `knowledgeIds`. Pre-existing typecheck noise from prior merge may remain.

- [ ] **Step 4: Commit**

```bash
git add admin/slices/setup/api/data/repositories/api/*.gen.ts admin/slices/agent/agent/stores/agent.ts
git commit -m "chore(admin): regenerate SDK and surface Agent.knowledgeIds"
```

---

## Task 10: Admin Agent form - knowledge picker

**Files:**
- Modify: `admin/slices/agent/agent/components/agent/Form.vue`
- Modify: `admin/slices/agent/agent/components/agent/Provider.vue` (form-side, if it owns the submit payload)
- Modify: `admin/slices/agent/agent/components/agentEdit/Provider.vue` (if the edit path is separate)

- [ ] **Step 1: Inspect existing knowledge picker pattern in Template form**

Read `admin/slices/agent/template/components/template/Form.vue`. Note how it renders the knowledge checkbox list (the loop over `knowledges`, the toggle handlers, the `form.defaultKnowledgeIds` array, the empty/disabled states).

- [ ] **Step 2: Add knowledgeIds to Agent form state**

In `admin/slices/agent/agent/components/agent/Form.vue`, mirror the template form pattern. Add to the form's reactive state:

```ts
const form = reactive({
  // ... existing fields
  knowledgeIds: [...(props.initialValues?.knowledgeIds ?? [])] as string[],
});
```

Update the submit handler (`emit('submit', { ... })` or similar) to include `knowledgeIds: [...form.knowledgeIds]`.

If the form receives `props.initialValues`, ensure `knowledgeIds` is in the typed interface:

```ts
interface AgentFormValues {
  // ... existing
  knowledgeIds?: string[];
}
```

- [ ] **Step 3: Fetch knowledges in the form's parent provider**

In the Provider that wraps the form (`Provider.vue` or `agentEdit/Provider.vue`), if knowledges are not already fetched, add:

```ts
const knowledgeStore = useKnowledgeStore();
const { data: knowledges } = await useAsyncData('agent-form-knowledges', () =>
  knowledgeStore.fetchAll(),
);
```

Pass `knowledges` down to the form as a prop, mirroring how it is passed into the Template form.

- [ ] **Step 4: Render the picker UI**

In `Form.vue`, in the template, add a new section labelled "Knowledge bases (override)" placed under the LLM credential picker. Render a list of checkboxes (one per knowledge base) bound to `form.knowledgeIds`. Above the list, render a hint: `Leave empty to inherit from template.`

Mirror the markup style from the template form. Each row shows the base name plus its description.

If `!knowledgeStore.enabled`, render the disabled-state message used elsewhere (see existing knowledge-related forms).

- [ ] **Step 5: Manual UI verification**

```bash
cd admin && bun run dev
```

Open `http://localhost:3001/agents/<id>/edit`. Confirm the new "Knowledge bases (override)" section appears, knowledge names load, toggling and saving persists `agent.knowledgeIds` (verify in DB).

Test inheritance: clear the override, save, verify the agent's effective knowledges become the template's `defaultKnowledgeIds`.

- [ ] **Step 6: Commit**

```bash
git add admin/slices/agent/agent/components/agent/
git commit -m "feat(admin/agent): knowledge bases override picker on edit form"
```

---

## Task 11: Admin Agent detail - effective knowledges section

**Files:**
- Modify: `admin/slices/agent/agent/components/agent/Provider.vue` (or wherever the agent overview tab is rendered)

- [ ] **Step 1: Locate the agent detail layout**

Find the file rendering the agent's overview tab. Look for an existing section like "Linked skills" or "MCP servers" - the new section will sit nearby.

- [ ] **Step 2: Compute the effective list**

In the script setup of the chosen file:

```ts
const effectiveKnowledges = computed(() => {
  if (!agent.value || !template.value) {
    return { ids: [] as string[], source: 'none' as const };
  }
  if (agent.value.knowledgeIds.length > 0) {
    return {
      ids: agent.value.knowledgeIds,
      source: 'agent-override' as const,
    };
  }
  return {
    ids: template.value.defaultKnowledgeIds,
    source: 'from-template' as const,
  };
});

const effectiveKnowledgesResolved = computed(() => {
  const idSet = new Set(effectiveKnowledges.value.ids);
  return (knowledges.value ?? []).filter((k) => idSet.has(k.id));
});
```

`agent`, `template`, `knowledges` should already be available via existing `useAsyncData` calls or stores. Fetch if missing (mirror Template detail's pattern).

- [ ] **Step 3: Render the section**

```vue
<Card>
  <CardHeader>
    <CardTitle>Knowledge bases</CardTitle>
    <CardDescription>
      Bases this agent can query via the query_knowledge tool.
      <span v-if="effectiveKnowledges.source === 'agent-override'">
        Source: per-agent override.
      </span>
      <span v-else-if="effectiveKnowledges.source === 'from-template'">
        Source: inherited from template.
      </span>
      <span v-else>No bases bound.</span>
    </CardDescription>
  </CardHeader>
  <CardContent>
    <ul
      v-if="effectiveKnowledgesResolved.length"
      class="flex flex-wrap gap-2"
    >
      <li v-for="k in effectiveKnowledgesResolved" :key="k.id">
        <Badge variant="outline">{{ k.name }}</Badge>
      </li>
    </ul>
    <p v-else class="text-sm text-muted-foreground">None bound.</p>
  </CardContent>
</Card>
```

- [ ] **Step 4: Manual UI verification**

Open `http://localhost:3001/agents/<id>`. Verify the "Knowledge bases" section renders with the correct list and source label. Test all three states (no bases, inherited, overridden) by toggling `agent.knowledgeIds` and `template.defaultKnowledgeIds`.

- [ ] **Step 5: Commit**

```bash
git add admin/slices/agent/agent/components/
git commit -m "feat(admin/agent): show effective knowledge bases on detail page"
```

---

## Final verification

After all tasks, end-to-end check:

- [ ] Create a knowledge base via admin UI, add a source, index it.
- [ ] Attach the knowledge id to a non-rancher template's `defaultKnowledgeIds`.
- [ ] Deploy a fresh agent on that template.
- [ ] In the agent's runtime logs, confirm it connects to `mcp-knowledge` and registers the `query_knowledge` tool.
- [ ] Trigger an agent interaction that should invoke knowledge lookup. Verify in the api logs that `query_knowledge` is called with the correct id and that the answer flows back.
- [ ] On the same agent, set `agent.knowledgeIds` to a different (also indexed) base. Restart the agent. Verify the override takes effect (the runtime now only sees the override base).
- [ ] Verify a regular agent cannot call rancher admin tools - either through the tool list (visible but blocked) or through a direct curl with an Agent-scoped JWT.
