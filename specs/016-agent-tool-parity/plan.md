# Implementation Plan: Agent tool parity

**Branch**: `feat/CLEAN-109-agent-tool-parity` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-agent-tool-parity/spec.md` (all clarifications settled; see its Decisions section)

**Tracker**: [CLEAN-109](https://dreamvention.atlassian.net/browse/CLEAN-109)

## Summary

Restore the "chat is the hands" model: every admin-console capability gets an agent tool, the chat gets a **Tools** shelf that shows the live, per-agent tool list grouped by topic and drops a starter prompt into the composer, and the repo gets a standing rule that a module ships agent tools alongside tests.

Technical approach, in one paragraph. Tools stay what they are today: `@Tool`-decorated methods on NestJS providers, discovered by `McpRegistryService` and served to runtimes from the API's own MCP endpoint (`/mcp/mcp`, `JwtAuthGuard`), filtered per caller through `IConditionallyListedTool` / `IDynamicallyDescribedTool`. Three additions make the feature: (1) the `@Tool` metadata grows `topic`, `title`, `template` and `destructive`, and the registry refuses to boot a tool without them, so the rule is enforced by the API, not by review alone; (2) ~90 new tools land in per-slice `*.tool.ts` files that call the same domain services the controllers call, gated with the existing `callerIsOperator` / `callerAgentId` helpers and a required `confirm: true` on anything destructive; (3) a new read surface, `GET /agents/:id/tools`, runs the same per-caller listing the runtime would get, groups it by topic, marks each tool "present in the running pod" from a per-agent snapshot recorded whenever a pod calls `tools/list`, and appends the agent's external MCP servers as opaque groups. The admin console gets a `toolCatalog` slice (gateway → store → sheet) and a Tools button in the bridle composer that inserts a template at the cursor and selects the first «…».

## Technical Context

**Language/Version**: TypeScript 5 on Bun (API: NestJS 11 + Prisma 6 + PostgreSQL; admin: Nuxt 3 / Vue 3 / Pinia / Tailwind / shadcn-vue on reka-ui 2)

**Primary Dependencies**: `@modelcontextprotocol/sdk` (served by the in-repo `api/src/slices/mcp`), `zod` + `zod-to-json-schema` (tool parameters), `@hey-api/openapi-ts` (admin SDK from `api/swagger-spec.json`), `reka-ui` (accordion, sheet), `lucide-vue-next` (icons)

**Storage**: PostgreSQL via Prisma; one new table `AgentToolListing` (per-agent snapshot of the last `tools/list` served). Schema lives per slice (`api/src/slices/**/*.prisma`, merged by `prisma-import` into `api/prisma/schema.prisma`); migrations under `api/prisma/migrations/<timestamp>_<name>/migration.sql`.

**Testing**: API — jest, run directly (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; **never** `bun run test`, it re-runs `prisma generate` and kills a running dev API on Windows). Admin — `bun test slices` for pure utils (`*.spec.ts` next to the util), `npx nuxt typecheck` for types (note: `bun run typecheck` regenerates the SDK; revert generated files after).

**Target Platform**: Linux containers on k3s (API + admin), agent pods in the `agents` namespace reading tools once at boot.

**Project Type**: Web application — `api/` (NestJS, CleanSlice slices) + `admin/` (Nuxt, CleanSlice slices). `app/` untouched.

**Performance Goals**: Tools panel opens with data in < 500 ms on a warm API (one request, one DB read for the snapshot, one resolver call); `tools/list` for a runtime stays a single pass over the registry (snapshot write is fire-and-forget).

**Constraints**: No agent runtime image change. Admin is English-only. Client state per `docs/state.md` (entity lives once in its Pinia store; components render by id). Secrets never leave the API through a tool result. Existing tool names unchanged (Decision 3). No commits without `CLEAN-109`.

**Scale/Scope**: 59 existing tools gain metadata; ~90 new tools across 17 slices; 1 new API endpoint + 1 table; 1 new admin slice + 1 composer change; 1 canonical doc + rule in `CLAUDE.md` + graft pointers + PR template.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template, so there are no ratified principles to gate on. The project's standing rules act as the gate instead:

| Gate (source) | Status | How the plan satisfies it |
|---|---|---|
| Jira first, branch from `origin/main`, `CLEAN-<n>` in every commit (`CLAUDE.md`) | PASS | CLEAN-109 in progress; branch `feat/CLEAN-109-agent-tool-parity` |
| OpenAPI: never hand-write DTO types the generator emits (`CLAUDE.md`) | PASS | new endpoint → `bun run generate:swagger` → `bun run build:api` in admin; gateway maps DTO → domain type |
| Client state: one entity, one store, render by id (`docs/state.md`) | PASS | `toolCatalog` store keyed by agent id; sheet renders `store.byAgent(id)`; `useAsyncData` only for pending/error |
| Admin English-only, `app` i18n via `en.json` (`docs/i18n.md`) | PASS | admin only; no `app` strings |
| Tools reuse domain services, never re-implement console rules (spec FR-008) | PASS | every tool constructor injects the same gateway/service the controller injects (see contracts/tools.md, "backing" column) |
| Tests for every new tool (spec FR-007) | PASS | one `*.tool.spec.ts` per new tool file, three paths each; secret-leak scan test |
| No secret in tool output (spec FR-004) | PASS with one documented exception | `create_api_key` returns the key once, exactly as the console does (research R6) |

Post-design re-check (after Phase 1): no new violations. The one exception above is recorded in research.md and in the tool's description.

## Project Structure

### Documentation (this feature)

```text
specs/016-agent-tool-parity/
├── plan.md              # This file
├── spec.md              # Feature spec with audit table and Decisions
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: ToolMetadata, AgentToolListing, catalog DTO, admin store
├── quickstart.md        # Phase 1: how to prove it works end-to-end
├── contracts/
│   ├── tool-metadata.md         # @Tool options, topics, startup validation, confirm convention
│   ├── agent-tools.openapi.yaml # GET /agents/{id}/tools
│   └── tools.md                 # the full tool inventory: topic · name · title · template · backing service
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
api/src/slices/
├── mcp/
│   ├── decorators/tool.decorator.ts      # + topic, title, template, destructive (ToolOptions)
│   ├── decorators/topics.ts              # NEW: ToolTopics const + titles + order
│   ├── services/mcp-registry.service.ts  # + validateToolMetadata() at bootstrap (FR-005)
│   ├── services/handlers/mcp-tools.handler.ts  # listing logic extracted to ToolCatalogService; snapshot hook
│   ├── services/tool-catalog.service.ts  # NEW: listFor(principal) — the per-caller list, reused by handler + endpoint
│   ├── tooling.ts                        # NEW: ok/err/requireOperator/requireAgent/confirmed helpers (peer/toolSupport re-exports)
│   └── interfaces/tool-listing-recorder.interface.ts  # NEW: optional IToolListingRecorder token
├── agent/toolCatalog/                    # NEW slice
│   ├── toolCatalog.prisma                # AgentToolListing
│   ├── toolCatalog.controller.ts         # GET /agents/:id/tools
│   ├── toolCatalog.module.ts
│   ├── domain/toolCatalog.service.ts     # groups + inPod flags + external servers
│   ├── domain/toolCatalog.types.ts
│   ├── data/toolListing.gateway.ts       # Prisma upsert/read of the snapshot (implements IToolListingRecorder)
│   └── dto/agentToolCatalog.dto.ts
├── agent/agent/agentAdmin.tool.ts        # NEW: stop/start/delete/status/env/logs/mcps/capacity
├── agent/file/file.tool.ts               # NEW: delete/sync/export
├── agent/secret/secret.tool.ts           # NEW
├── agent/agentChannel/agentChannel.tool.ts  # NEW
├── agent/shareLink/shareLink.tool.ts     # NEW
├── agent/template/templateAdmin.tool.ts  # NEW: create/delete/set_mcps/restart agents
├── agent/templateInstall/templateInstall.tool.ts  # NEW: git preview/install, export path
├── skill/skill.tool.ts                   # NEW: get/create/delete/import url/search/import
├── llm/llm.tool.ts                       # NEW
├── mcpServer/mcpServer.tool.ts           # NEW
├── reins/knowledge/knowledgeAdmin.tool.ts  # NEW (operator set; query_knowledge stays)
├── reins/source/source.tool.ts           # NEW
├── setting/setting.tool.ts               # NEW: get/delete + SETTING_CATALOG; rancher list/upsert gain dynamic description
├── user/user/user.tool.ts                # NEW
├── user/apiKey/apiKey.tool.ts            # NEW
├── chat/chat.tool.ts                     # NEW
├── usage/usage.tool.ts                   # NEW: overview, per-llm
├── log/log.tool.ts                       # NEW: get_agent_logs (or inside agentAdmin.tool.ts — tasks decide)
├── upgrade/upgrade.tool.ts               # NEW
├── integration/integration.tool.ts       # NEW
├── paddock/scenario/scenario.tool.ts     # + generate
├── paddock/evaluation/evaluation.tool.ts # + logs/scenario result/trace
├── rancher/rancher.tool.ts               # metadata only (topics/titles/templates), no behaviour change
├── agent/peer/*.tool.ts, bridle/attachment.tool.ts, browser/browser.tool.ts, reins/knowledge/knowledge.tool.ts  # metadata only
└── **/*.tool.spec.ts                     # one per new tool file + registry validation spec + catalog spec

admin/slices/
├── agent/toolCatalog/                    # NEW slice
│   ├── nuxt.config.ts, index.d.ts
│   ├── domain/toolCatalog.types.ts, toolCatalog.gateway.ts, toolCatalog.service.ts
│   ├── data/toolCatalog.gateway.ts, toolCatalog.mapper.ts
│   ├── stores/toolCatalog.ts             # byAgent(id), fetch(id) upserts, filter/expanded state per agent
│   ├── utils/insertTemplate.ts (+ .spec.ts), filterCatalog.ts (+ .spec.ts)
│   └── components/toolCatalog/Sheet.vue, Group.vue, Row.vue, Empty.vue
├── bridle/components/bridle/Input.vue    # + Tools button, template insertion, placeholder selection
└── setup/theme/components/ui/accordion/  # NEW primitive (shadcn-vue on reka-ui)

docs/agent-tools.md                       # NEW canonical rule + how-to
CLAUDE.md                                 # + "Agent tools" section
.claude/skills/graft/SKILL.md, .cursor/rules/graft.mdc  # + fenced project pointer block
.github/PULL_REQUEST_TEMPLATE.md          # NEW with the parity check line
```

**Structure Decision**: Web application with the existing two CleanSlice projects. New tools live in the slice that owns the capability (this is also what the new rule prescribes), the shared MCP plumbing stays in `api/src/slices/mcp`, and the catalogue read surface is its own small slice under `agent/` because it joins agents, pods, the MCP resolver and the registry. The admin gets one new slice and a surgical change to the composer.

## Phase 0 — Research

Complete: see [research.md](./research.md). All Technical Context unknowns are resolved; no NEEDS CLARIFICATION remains.

## Phase 1 — Design

Complete: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

Design highlights the tasks phase must keep:

1. **Metadata before tools.** The `ToolOptions` extension and registry validation land first; every existing tool file is annotated in the same commit so the API boots. Only then do new tool files start.
2. **One helper module for gating.** `api/src/slices/mcp/tooling.ts` provides `ok`, `err`, `requireOperator(req)`, `requireAgent(req)`, `confirmed(args, what)`; `agent/peer/toolSupport.ts` re-exports the shared ones so nothing there changes behaviour.
3. **Listing logic is shared, not duplicated.** `ToolCatalogService.listFor(principal)` in the mcp slice is the single implementation of "which tools does this caller see, with what description"; `McpToolsHandler` calls it for `tools/list`, the endpoint calls it with a synthetic principal built the same way `issueAgentServiceToken` builds an agent token payload (`sub: agent:<id>`, roles `Owner` for the admin agent, `Agent` otherwise).
4. **Snapshot is a side effect of `tools/list`.** When the caller is an agent runtime, the handler upserts `AgentToolListing { agentId, toolNames, listedAt }` through the optional `IToolListingRecorder` (resolved with `strict: false`, so the mcp slice stays independent). Fire-and-forget; a failed write only logs.
5. **`inPod` semantics** (data-model.md): no pod → `null`; pod and no snapshot → `false` (a pod that predates this feature needs a restart to get anything new); pod and snapshot → `toolNames.includes(name)`.
6. **Admin composer owns insertion.** The Tools button and the sheet mount inside `Input.vue` so the sheet's `pick(template)` can write `input.value` and set the textarea selection on the first «…» without prop drilling. Restart reuses `agentStore.restart(id)` (optimistic patch + rollback already there).
7. **Rule lives in three places, one canonical.** `docs/agent-tools.md` is canonical; `CLAUDE.md` states the rule and links it; graft skill and Cursor rule carry a fenced `<!-- ranch:agent-tools -->` pointer block re-applied by a tiny script if `graft init` overwrites them (research R11).

## Phase 2 — Tasks (preview, not generated here)

`/speckit-tasks` should produce roughly this order, each topic a checkpoint comment on CLEAN-109:

1. Metadata + validation + shared helpers + annotate all 59 existing tools; API boots; registry spec.
2. `AgentToolListing` + recorder hook + `ToolCatalogService` + `GET /agents/:id/tools` + swagger regen + tests.
3. Admin: accordion primitive, `toolCatalog` slice, composer button + insertion + "after restart" + utils specs; typecheck.
4. Tools by topic, one commit each with specs: agents · workspace · templates · skills · LLM · MCP servers · knowledge · sources · settings · users & keys · chats & usage · browser & integrations · paddock · platform.
5. Secret-leak scan test across all tools; quickstart run-through.
6. Docs: `docs/agent-tools.md`, `CLAUDE.md`, graft pointers, PR template; README one-liner.
7. Final: full jest run, admin typecheck, PR into `main`, link on CLEAN-109, In Review.

## Complexity Tracking

No constitution violations to justify. Two deliberate choices that add surface, with the simpler alternative and why it was rejected, are recorded in research.md: the per-agent snapshot table (R4, vs. reusing MCP-server drift) and the synthetic-principal listing (R3, vs. a second static catalogue).
