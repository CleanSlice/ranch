# Contract: tool metadata, topics, gating, confirmation

This is the contract every tool in `api/src/slices/**/*.tool.ts` follows from CLEAN-109 on. The registry enforces the shape at startup; the rule in `docs/agent-tools.md` explains it for people.

## `@Tool` options

```ts
@Tool({
  name: 'register_mcp_server',                       // snake_case verb_noun; never renamed once shipped
  topic: ToolTopics.McpServers,                      // required
  title: 'Register an MCP server',                   // required, ≤ 60 chars, sentence case, no trailing period
  description: 'Register an external MCP server …',  // what the model reads; ends with the confirm sentence when destructive
  template: 'Register the MCP server at «url» named «name» with «bearer|none» auth',  // required, ≤ 200 chars
  destructive: false,                                // optional; true ⇒ confirm param required
  parameters: z.object({ … }),
})
```

Template conventions: imperative English sentence, placeholders as `«…»` with a short noun inside (`«agent name»`, `«url»`), never an id the person would not know (say `«agent name»`, the tool resolves names to ids or the model calls `list_*` first). One template per tool. A template is a starter, not a form (spec Decision 4).

## Topics (`api/src/slices/mcp/decorators/topics.ts`)

| key | title | order | what belongs |
|---|---|---|---|
| `agents` | Agents | 10 | lifecycle, config, admin flag, status/metrics/env/logs, MCP list, capacity |
| `agent_workspace` | Agent workspace | 20 | files, secrets, channels, share link |
| `templates` | Templates | 30 | templates, their files, skills/MCP bindings, install/export |
| `skills` | Skills | 40 | skills, import, search, redeploy |
| `llm` | LLM credentials | 50 | credentials, health, models, usage per credential |
| `mcp_servers` | MCP servers | 60 | registry of servers, enable/disable, OAuth |
| `knowledge` | Knowledge | 70 | bases, indexing, graph, sources, imports, `query_knowledge` |
| `settings` | Settings | 80 | platform settings |
| `peers` | Peers (A2A) | 90 | operator peer set, self-service set, `ask_agent` |
| `paddock` | Paddock | 100 | scenarios, evaluations |
| `users_keys` | Users & API keys | 110 | users, roles, API keys |
| `chats_usage` | Chats & usage | 120 | chats, transcripts, summaries, usage overview, `agent_usage` |
| `browser` | Browser & integrations | 130 | browser sessions, integration accounts |
| `attachments` | Attachments | 140 | `query_attachment` |
| `platform` | Platform | 150 | upgrade, rancher setup status |

Empty topics are not returned by the catalogue endpoint.

## Gating (who sees and may call)

Three audiences, expressed with the shared helpers in `api/src/slices/mcp/tooling.ts` (moved from `agent/peer/toolSupport.ts`, which re-exports them):

| audience | listing | call guard | helper |
|---|---|---|---|
| Operator (admin agent; token carries `Owner`) | `isListedForRequest → callerIsOperator(req)` | `requireOperator(req)` throws `ForbiddenException('… requires the Ranch operator role. Ask the operator to do it in the console.')` | `requireOperator` |
| Agent self-service (any runtime; `sub = agent:<id>`) | `callerAgentId(req) !== null` (+ feature flag where one exists, e.g. peers self-service setting) | `requireAgent(req)` returns the agent id or throws | `requireAgent` |
| Everyone (any authenticated caller) | always | none | — |

A tool class declares one audience for all its methods (split classes when a slice needs two, as `peerAdmin.tool.ts` / `peerSelf.tool.ts` do). `RancherTool.requireOwner` is replaced by `requireOperator` so refusals read the same everywhere.

## Confirmation (destructive tools)

```ts
parameters: z.object({
  id: z.string(),
  confirm: z.boolean().describe('Set true only after the person confirmed in the chat.'),
})
…
const refusal = confirmed(args, `delete agent «${agent.name}» and its workspace`);
if (refusal) return refusal; // err('This will delete agent «x» and its workspace. Ask the person to confirm, then call again with confirm: true.')
```

`destructive: true` on: delete/remove/revoke anything, replace-all secrets, set user role, run upgrade, stop agent (it interrupts work), regenerate share link (invalidates the old one).

## Secrets

Parameters may carry secrets. Results never do: strip `apiKey`, `authValue`, `password`, `secret`, `token` fields in the tool before `ok(...)`. Exception: `create_api_key` returns the key once (research R6). The cross-cutting spec `api/src/slices/mcp/tool-secrets.spec.ts` enforces this by sentinel.

## Results

Every tool returns `ToolResult` via `ok(value)` / `err(text)`. Errors name the next move ("Nothing was saved. …", "Call list_agents to find the id."). `HttpException`s thrown by domain services are turned into `isError` text by the MCP handler; tools that can hit coded refusals wrap with `withRefusalAdvice`.

## Registration

The tool class is a provider of its slice's module (`providers: [XService, XTool]`); the module imports whatever modules export the gateways the tool needs. Nothing else: `McpRegistryService` discovers every `@Tool` across all modules.

## Tests

`*.tool.spec.ts` beside the tool file. Minimum per tool: listed/not listed by audience; happy path maps arguments and returns `ok`; not-found returns advice; destructive without `confirm` refuses without calling the gateway.
