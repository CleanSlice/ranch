# Tasks: Agent tool parity (CLEAN-109)

**Input**: Design documents from `specs/016-agent-tool-parity/` — plan.md, spec.md, research.md, data-model.md, contracts/{tool-metadata.md, agent-tools.openapi.yaml, tools.md}, quickstart.md

**Tests**: Required by the spec (FR-007: every new tool has tests; FR-004: secret-leak scan). Test tasks are included and are part of each tool task, not optional.

**Organization**: Foundational work first (metadata, validation, helpers), then the catalogue and Tools panel (US2) so every tool added afterwards is visible and testable from the chat, then the tools topic by topic (US1), then the rule (US3), then polish. This deviates from strict P1-first ordering on purpose (user request in the plan): US2 is small and turns US1 into something a person can verify by clicking.

**Commands** (from plan.md):
- API tests: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>` — never `bun run test` (kills a running dev API).
- Swagger + admin SDK: `cd api && bun run generate:swagger && cd ../admin && bun run build:api`.
- Admin: `cd admin && bun test slices` and `npx nuxt typecheck` (not `bun run typecheck`; revert regenerated SDK files if it touched them).
- Commit after each phase checkpoint with `CLEAN-109` in the subject; post a checkpoint comment on the Jira issue after phases 2, 3, each topic group of 4, 5 and 6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1 parity tools · US2 Tools panel · US3 the rule

## Path Conventions

Web app: `api/src/slices/<slice>/…` (NestJS, CleanSlice) and `admin/slices/<slice>/…` (Nuxt, CleanSlice). Specs beside the file they test (`*.spec.ts`).

---

## Phase 1: Setup

**Purpose**: Nothing to scaffold; the branch and Jira issue exist. One check that the tree builds before touching it.

- [X] T001 Confirm the API boots and the current tool set is intact: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/mcp src/slices/agent/peer src/slices/reins/knowledge/knowledge.tool.spec.ts` is green; note the 59 tool names from `contracts/tools.md` as the baseline

---

## Phase 2: Foundational — metadata, validation, helpers, annotate existing tools

**Purpose**: The `@Tool` contract every later task relies on. The API must boot at the end of this phase with all 59 existing tools annotated.

**⚠️ CRITICAL**: No tool or panel work starts before T010 is green.

- [X] T002 Add `ToolTopics` const (15 keys with `title` and `order` per contracts/tool-metadata.md) and the `ToolTopic` type in `api/src/slices/mcp/decorators/topics.ts`; export from `api/src/slices/mcp/decorators/index.ts`
- [X] T003 Extend `ToolOptions`/`ToolMetadata` with `topic`, `title`, `template`, `destructive?` in `api/src/slices/mcp/decorators/tool.decorator.ts` (parameters default stays `z.object({})`)
- [X] T004 Add `validateToolMetadata()` to `api/src/slices/mcp/services/mcp-registry.service.ts`, called at the end of `onApplicationBootstrap`: throws with the tool name for a missing/invalid `topic`, empty `title` (>60 chars), empty `template` (>200 chars, must contain `«` unless the JSON schema has no properties), or `destructive` without a boolean `confirm` property in `zodToJsonSchema(parameters)`
- [X] T005 Add validation cases to `api/src/slices/mcp/services/mcp-registry.service.spec.ts`: one fake provider per missing field, one destructive-without-confirm, one valid; assert throw messages name the tool
- [X] T006 [P] Create `api/src/slices/mcp/tooling.ts` exporting `ToolResult`, `ok`, `err`, `callerAgentId`, `callerIsOperator`, `requireOperator(req)` (ForbiddenException: "… requires the Ranch operator role. Ask the operator to do it in the console."), `requireAgent(req)`, `confirmed(args, what)` (returns `err('This will <what>. Ask the person to confirm, then call again with confirm: true.')` unless `args.confirm === true`), `stripSecrets(obj, keys)`; then make `api/src/slices/agent/peer/toolSupport.ts` re-export `ok/err/callerAgentId/callerIsOperator/ToolResult` from it (keep `withRefusalAdvice`, hints and peer helpers there)
- [X] T007 [P] Spec for the helpers in `api/src/slices/mcp/tooling.spec.ts`: `confirmed` refuses without confirm, `requireOperator` accepts Owner and refuses Agent, `stripSecrets` removes nested keys
- [X] T008 Annotate the 24 tools in `api/src/slices/rancher/rancher.tool.ts` with `topic/title/template` per contracts/tools.md (agents, agent_workspace, templates, skills, llm, settings, chats_usage), mark `redeploy_skill_agents` destructive with a `confirm` param + `confirmed()`, and replace `requireOwner` with `requireOperator` from `#/mcp/tooling` (keep behaviour; update `rancher.tool.spec.ts` if it exists, else add a minimal spec covering the operator refusal and the confirm refusal)
- [X] T009 [P] Annotate the remaining existing tool files with `topic/title/template` (and `destructive` + `confirm` where contracts/tools.md marks ⚠): `api/src/slices/agent/peer/peerAdmin.tool.ts`, `peerSelf.tool.ts`, `askAgent.tool.ts` (peers); `api/src/slices/reins/knowledge/knowledge.tool.ts` (knowledge); `api/src/slices/bridle/attachment.tool.ts` (attachments); `api/src/slices/browser/browser.tool.ts` (browser; close/reset destructive); `api/src/slices/paddock/scenario/scenario.tool.ts` and `evaluation.tool.ts` (paddock; delete/abort destructive). Extend their specs for the new confirm refusals (`peerAdmin.tool.spec.ts`, `peerSelf.tool.spec.ts`; add minimal specs for browser and paddock tools if none exist)
- [X] T010 Run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/mcp src/slices/rancher src/slices/agent/peer src/slices/reins/knowledge src/slices/bridle/attachment.tool.spec.ts src/slices/browser src/slices/paddock` green, then boot the API once (`cd api && bun run start:dev` or the project's dev command) and confirm no validation error in the log; commit `feat(mcp): tool metadata, topics and startup validation (CLEAN-109)`

**Checkpoint**: Jira comment — metadata contract in place, 59 tools annotated, API refuses unannotated tools.

---

## Phase 3: User Story 2 — See what the agent can do, and try it in one click (Priority: P1)

**Goal**: `GET /agents/:id/tools` returns the live per-agent catalogue with `inPod` flags; the admin chat has a Tools button, sheet with accordions, search, one-click template insertion, and "after restart" markers.

**Independent Test**: quickstart.md §3, §4, §5 — the endpoint returns topic groups for the Rancher agent and fewer for a plain agent; the sheet opens, filters, inserts a template with the first «…» selected, and marks a tool added after pod start.

### API — snapshot and catalogue

- [X] T011 [P] [US2] Create `api/src/slices/agent/toolCatalog/toolCatalog.prisma` with model `AgentToolListing { agentId @id, agent relation onDelete Cascade, toolNames Json, listedAt DateTime @default(now()) }`; add the back-relation `toolListing AgentToolListing?` to `api/src/slices/agent/agent/agent.prisma`
- [X] T012 [P] [US2] Write `api/prisma/migrations/20260922120000_agent_tool_listing/migration.sql` (CREATE TABLE + FK + comment header like `20260914120000_agent_peer_delegation`); run `cd api && bunx prisma generate` (not `bun run test`) and confirm the client compiles
- [X] T013 [P] [US2] Add `api/src/slices/mcp/interfaces/tool-listing-recorder.interface.ts`: `TOOL_LISTING_RECORDER` injection token and `IToolListingRecorder { record(agentId: string, toolNames: string[]): Promise<void> }`; export from `interfaces/index.ts`
- [X] T014 [US2] Create `api/src/slices/mcp/services/tool-catalog.service.ts` with `listFor(principal: IAuthTokenPayload): Promise<IListedTool[]>` (`{ name, description, inputSchema, metadata }`) — move the per-tool resolve → `isListedForRequest` → `describeForRequest` → fallback loop out of `McpToolsHandler.registerHandlers` into it (build a request-like `{ user: principal }` for the hooks); register it as a provider in `api/src/slices/mcp/mcp.module.ts`
- [X] T015 [US2] Refactor `api/src/slices/mcp/services/handlers/mcp-tools.handler.ts` to call `ToolCatalogService.listFor(httpRequest.user)` for `tools/list`, and after listing, when `callerAgentId(httpRequest)` is set, resolve `TOOL_LISTING_RECORDER` via `moduleRef.get(…, { strict: false })` in a try/catch and call `record(agentId, names)` without awaiting the result (log on failure); keep the `tools/call` path unchanged
- [X] T016 [US2] Extend `api/src/slices/mcp/services/handlers/mcp-tools.handler.spec.ts`: listing still honours conditional/dynamic hooks; recorder is called with the agent id and names for an agent token and not for a person token; a throwing recorder does not break `tools/list`. Add `api/src/slices/mcp/services/tool-catalog.service.spec.ts` for `listFor` with operator vs agent principals
- [X] T017 [US2] Create `api/src/slices/agent/toolCatalog/data/toolListing.gateway.ts` (Prisma upsert + `findByAgent`) implementing `IToolListingRecorder`, `domain/toolCatalog.types.ts` (mirror data-model.md §3), `domain/toolCatalog.service.ts` (`forAgent(agentId)`: agent → principal `{ sub: 'agent:<id>', roles: agent.isAdmin ? [Owner] : [Agent], email: '' }` matching `issueAgentServiceToken` in `api/src/slices/user/auth/domain/auth.service.ts` → `ToolCatalogService.listFor` → group by `ToolTopics` order → `inPod` per data-model.md → external groups from `AgentMcpResolver.resolveForAgent` minus built-in ids with `afterRestart` from `detectMcpConfigDrift`; never include `url`/`authValue`)
- [X] T018 [US2] Create `api/src/slices/agent/toolCatalog/dto/agentToolCatalog.dto.ts` (Swagger-decorated per contracts/agent-tools.openapi.yaml), `toolCatalog.controller.ts` (`GET agents/:id/tools`, `@Roles(Owner, Admin)`, 404 on unknown agent, 403 for `sub` starting with `agent:`), `toolCatalog.module.ts` (provides the gateway under `TOOL_LISTING_RECORDER` and exports it; imports AgentModule, McpServerModule, McpModule pieces as needed); register the module in `api/src/app.module.ts`
- [X] T019 [US2] Spec `api/src/slices/agent/toolCatalog/domain/toolCatalog.service.spec.ts`: `inPod` matrix (no pod → null; pod + no snapshot → false; pod + snapshot → includes), topic ordering, empty topics dropped, external group has no url/authValue, admin vs plain agent principal; controller spec for 403 on agent token
- [X] T020 [US2] Regenerate: `cd api && bun run generate:swagger && cd ../admin && bun run build:api`; confirm `AgentsService.getAgentTools` (or the generated name) exists in `admin/slices/setup/api/data/repositories/api/`; commit `feat(api): per-agent tool catalogue endpoint and listing snapshot (CLEAN-109)`

### Admin — slice, primitive, composer

- [X] T021 [P] [US2] Add the accordion primitive from shadcn-vue on reka-ui in `admin/slices/setup/theme/components/ui/accordion/{Accordion,AccordionItem,AccordionTrigger,AccordionContent}.vue` + `index.ts`, styled like the existing `sheet/` files
- [X] T022 [P] [US2] Create the slice skeleton `admin/slices/agent/toolCatalog/{nuxt.config.ts,index.d.ts}` following `admin/slices/agent/agent/` (auto-registered by `admin/registerSlices.ts`), plus `domain/toolCatalog.types.ts` (`IAgentToolCatalog`, `IAgentToolGroup`, `IAgentToolEntry`), `domain/toolCatalog.gateway.ts` (interface), `domain/toolCatalog.service.ts`
- [X] T023 [US2] Create `admin/slices/agent/toolCatalog/data/toolCatalog.mapper.ts` (DTO → domain, defensive like `agent.mapper.ts`) and `data/toolCatalog.gateway.ts` extending `BaseGateway` and calling the generated SDK method (depends on T020, T022)
- [X] T024 [US2] Create `admin/slices/agent/toolCatalog/stores/toolCatalog.ts` per data-model.md §4: `catalogs` by agent id, `byAgent`, `fetch` (upserts, returns the stored record), `upsert`, per-agent `ui { query, expanded }` with `setQuery`, `toggleGroup`, `setExpanded`
- [X] T025 [P] [US2] Create pure utils `admin/slices/agent/toolCatalog/utils/insertTemplate.ts` (`insertTemplate`, `hasPlaceholder`, `firstPlaceholderRange`) and `utils/filterCatalog.ts` (`filterCatalog(catalog, query)` → groups with matching tools, match on title/name/description, case-insensitive) with specs `insertTemplate.spec.ts` and `filterCatalog.spec.ts` runnable by `bun test slices`
- [X] T026 [US2] Create `admin/slices/agent/toolCatalog/components/toolCatalog/{Sheet.vue,Group.vue,Row.vue,Empty.vue}`: `Sheet` takes `agentId` + `open` v-model, emits `pick(template)`; renders `store.byAgent(agentId)` with `useAsyncData` only for pending/error/refresh; search `Input` bound to `store.ui[agentId].query`; accordions bound to `expanded` (all matching groups expanded while a query is set); `Row` shows title, `name` in `text-xs font-mono text-muted-foreground`, description, a `destructive` badge, and when `inPod === false` a muted "after restart" tag; `Group` header shows "after restart" with a Restart button calling `useAgentStore().restart(agentId)` (disabled while restarting) when `afterRestart`; external groups render name + description + "tools are provided by this server"; `Empty` covers no results / load error with Retry; keyboard: rows are `<button>`s; phone width: `SheetContent` `side="right"` full-width under `sm`
- [X] T027 [US2] Change `admin/slices/bridle/components/bridle/Input.vue`: add a `Wrench` button (tooltip "Tools", `aria-label`) between the paperclip and the textarea, `toolsOpen` ref, mount `ToolCatalogSheet` with `agentId`, handle `pick` via `insertTemplate(input.value, selectionStart, template)` → set `input.value`, close the sheet, `nextTick` focus + `setSelectionRange` on the first «…»; add a `hasPlaceholder(input)` computed that adds `ring-1 ring-amber-500/50` to the textarea; do not change send behaviour
- [X] T028 [US2] Re-fetch on restart: in `Sheet.vue` watch `useAgentStore().byId(agentId)?.status` and call `store.fetch(agentId)` when it returns to running after a restart; verify the marker clears (quickstart §4–5)
- [X] T029 [US2] `cd admin && bun test slices && npx nuxt typecheck` clean (revert SDK files if typecheck regenerated them); walk quickstart §5 on the Rancher page and on `/agents/<id>?tab=chat`; commit `feat(admin): Tools panel in the chat composer (CLEAN-109)`

**Checkpoint**: Jira comment — Tools panel live; every tool added from here on appears in it.

---

## Phase 4: User Story 1 — The Rancher agent can do what the console can (Priority: P1)

**Goal**: The 93 new tools from contracts/tools.md, each in its slice, reusing the controller's services, gated per audience, destructive ones behind `confirm`, each with a spec (listed/not listed, happy path, not-found, confirm refusal).

**Independent Test**: quickstart §2 green for every `*.tool.spec.ts`; quickstart §6 prompts succeed from the Rancher chat; a plain agent is refused operator tools.

**Per-topic task shape** (applies to every task below unless it says otherwise): create the tool file with the tools named in contracts/tools.md for that topic, `isListedForRequest → callerIsOperator` for **O** tools, register the class in the slice module's `providers`, add module imports for the gateways the controller uses, write the spec beside it, run it, commit `feat(<slice>): <topic> agent tools (CLEAN-109)`, and post a Jira checkpoint after every fourth topic.

- [X] T030 [P] [US1] Agents: `api/src/slices/agent/agent/agentAdmin.tool.ts` + `agentAdmin.tool.spec.ts` — `stop_agent` ⚠, `start_agent`, `delete_agent` ⚠ (`wipeS3?: boolean`), `get_agent_status`, `get_agent_env` (mask secret-looking values the way `GET :id/env` does), `list_agent_mcps` (strip `authValue`/`url`, include drift), `get_cluster_capacity`; backing `AgentDeployService`, `IAgentGateway`, `AgentStatusService`, `IPodGateway`, `AgentMcpResolver`, `detectMcpConfigDrift`; register in `agent.module.ts`
- [X] T031 [P] [US1] Agent logs: `get_agent_logs` (tail `lines` default 100) in `api/src/slices/log/log.tool.ts` + spec, backing the same gateway `log.controller.ts` uses; register in `log.module.ts`
- [X] T032 [P] [US1] Workspace files: `api/src/slices/agent/file/file.tool.ts` + spec — `delete_agent_file` ⚠, `sync_agent_files`, `export_agent_files` (returns the API path `/agents/<id>/files/export` and says the person downloads it from the console); backing `IFileGateway`, `SyncGuardService`, `IBridleGateway` as `file.controller.ts`; register in `file.module.ts`
- [X] T033 [P] [US1] Secrets: `api/src/slices/agent/secret/secret.tool.ts` + spec — `list_agent_secrets` (names only), `set_agent_secret`, `delete_agent_secret` ⚠, `replace_agent_secrets` ⚠; results never contain values; backing `ISecretGateway` + `IAgentGateway`; register in `secret.module.ts`
- [X] T034 [P] [US1] Channels + share link: `api/src/slices/agent/agentChannel/agentChannel.tool.ts` (`get_agent_channels`, `set_agent_channels`) and `api/src/slices/agent/shareLink/shareLink.tool.ts` (`get_share_link`, `create_share_link`, `regenerate_share_link` ⚠, `revoke_share_link` ⚠) + specs; backing `IAgentChannelGateway`, `ShareLinkService`; register in their modules
- [X] T035 [P] [US1] Templates: `api/src/slices/agent/template/templateAdmin.tool.ts` + spec — `create_template`, `delete_template` ⚠, `set_template_mcps`, `restart_template_agents` ⚠; backing `ITemplateGateway`, `AgentDeployService` (as `restart-by-template`); register in `template.module.ts`
- [X] T036 [P] [US1] Template install/export: `api/src/slices/agent/templateInstall/templateInstall.tool.ts` + spec — `preview_template_install_from_git`, `install_template_from_git`, `export_template` (download path); backing `TemplateInstallService`, `TemplateExportService`; register in `templateInstall.module.ts`
- [X] T037 [P] [US1] Skills: `api/src/slices/skill/skill.tool.ts` + spec — `get_skill`, `create_skill`, `delete_skill` ⚠, `import_skill_from_url`, `search_skills`, `import_skill`; backing `ISkillGateway`, `GithubSearch` exactly as `skill.controller.ts`; register in `skill.module.ts`
- [X] T038 [P] [US1] LLM credentials: `api/src/slices/llm/llm.tool.ts` + spec — `get_llm`, `create_llm`, `update_llm`, `delete_llm` ⚠, `health_check_llm`, `list_llm_models`, `llm_usage`; strip `apiKey`/key fields from every result; backing `ILlmGateway`, `ILlmHealthGateway`, the models catalogue used by `GET llms/models`, `IUsageGateway` for usage; register in `llm.module.ts` (import `UsageModule`)
- [X] T039 [P] [US1] MCP servers: `api/src/slices/mcpServer/mcpServer.tool.ts` + spec — `list_mcp_servers`, `get_mcp_server`, `register_mcp_server`, `update_mcp_server` (built-in rows: only `enabled`/`description`, same rule as the controller), `delete_mcp_server` ⚠ (built-ins refused with the controller's message), `start_mcp_oauth` (returns the URL to open); strip `authValue`; backing `IMcpServerGateway`, `McpOauthService`; register in `mcpServer.module.ts`
- [X] T040 [P] [US1] Knowledge bases: `api/src/slices/reins/knowledge/knowledgeAdmin.tool.ts` + spec — `list_knowledges`, `get_knowledge`, `create_knowledge`, `update_knowledge`, `delete_knowledge` ⚠, `index_knowledge`, `get_knowledge_overview`, `list_knowledge_graph_labels`, `get_knowledge_status`; backing `KnowledgeService`, `IKnowledgeConfigGateway`, `ILightragClient`, `ILlmGateway` as `knowledge.controller.ts`; register in `knowledge.module.ts` (leave `knowledge.tool.ts` untouched)
- [X] T041 [P] [US1] Knowledge sources: `api/src/slices/reins/source/source.tool.ts` + spec — `list_knowledge_sources`, `add_knowledge_source` (kind url|text), `add_knowledge_sources_from_sitemap`, `reindex_knowledge_source`, `extract_knowledge_source`, `delete_knowledge_source` ⚠, `list_knowledge_imports`; backing `SourceService`; register in `source.module.ts`
- [X] T042 [US1] Settings: add `api/src/slices/setting/domain/settingCatalog.ts` (`SETTING_CATALOG` compiled from `admin/slices/setting/pages/settings/*.vue` and `components/setting/nav/Menu.vue`, with `restartRequired` where the page says so), create `api/src/slices/setting/setting.tool.ts` + spec — `get_setting`, `delete_setting` ⚠ — and make `list_settings`/`upsert_setting` in `rancher.tool.ts` implement `IDynamicallyDescribedTool` appending the catalogue (group · name · meaning) to their descriptions; unknown key on `upsert_setting` still allowed but the result names the nearest catalogued key; register in `setting.module.ts`
- [X] T043 [P] [US1] Paddock additions: `generate_paddock_scenarios` in `api/src/slices/paddock/scenario/scenario.tool.ts` (backing `IPaddockScenarioGeneratorGateway`) and `get_paddock_evaluation_logs`, `get_paddock_evaluation_scenario_result`, `get_paddock_evaluation_trace` in `api/src/slices/paddock/evaluation/evaluation.tool.ts` (backing `PaddockEvaluationService`); extend both specs
- [X] T044 [P] [US1] Users: `api/src/slices/user/user/user.tool.ts` + spec — `list_users`, `get_user`, `create_user`, `update_user`, `set_user_role` ⚠ (Owner only, as the controller), `delete_user` ⚠; never return password hashes; backing `IUserGateway`; register in `user.module.ts`
- [X] T045 [P] [US1] API keys: `api/src/slices/user/apiKey/apiKey.tool.ts` + spec — `list_api_keys` (prefix/metadata only), `create_api_key` (returns the key once; description says to hand it to the person verbatim and never repeat it — research R6), `revoke_api_key` ⚠; backing `IApiKeyGateway`, `ApiKeyService`; register in `apiKey.module.ts`
- [X] T046 [P] [US1] Chats: `api/src/slices/chat/chat.tool.ts` + spec — `list_chats` (optional agent filter), `get_chat`, `get_chat_messages` (last N), `sync_chats`, `summarize_chat`, `export_chat` (download path); backing `IChatGateway`, `TranscriptReaderService`, `ChatSyncService`, `ChatInsightService`; register in `chat.module.ts`
- [X] T047 [P] [US1] Usage: `api/src/slices/usage/usage.tool.ts` + spec — `get_usage_overview`; backing `IUsageGateway` as `GET usage/overview`; register in `usage.module.ts` (move nothing: `agent_usage` stays in `rancher.tool.ts` under `chats_usage`)
- [X] T048 [P] [US1] Integrations: `api/src/slices/integration/integration.tool.ts` + spec — `list_integration_catalogue`, `list_integration_accounts` (secrets stripped), `create_integration_account`, `request_integration_login`, `delete_integration_account` ⚠; audience **A** with the same `userId`-must-match-caller convention as `browser.tool.ts`; backing `IntegrationService`; register in `integration.module.ts`
- [X] T049 [P] [US1] Platform: `api/src/slices/upgrade/upgrade.tool.ts` (`get_upgrade_status`, `run_upgrade` ⚠; backing `UpgradeService`) and `get_rancher_status` added to `api/src/slices/rancher/rancher.tool.ts` (backing `RancherService`) + specs; register in `upgrade.module.ts`
- [X] T050 [US1] Cross-cutting secrets scan `api/src/slices/mcp/tool-secrets.spec.ts`: for each secret-taking tool (`create_llm`, `update_llm`, `register_mcp_server`, `update_mcp_server`, `set_agent_secret`, `replace_agent_secrets`, `create_user`, `create_integration_account`) call it with a sentinel string through mocked gateways and assert the sentinel is absent from `content[].text`; assert `create_api_key` is the only tool whose result contains the sentinel key
- [X] T051 [US1] Full API run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest` green; boot the API and check the log shows no metadata validation error; `GET /agents/<rancher>/tools` shows every topic from contracts/tools.md with the expected counts (quickstart §3); run quickstart §6 prompts; commit any fixes `fix(api): … (CLEAN-109)`

**Checkpoint**: Jira comment — parity reached: 93 new tools, 152 total, all in the panel; secrets scan green.

---

## Phase 5: User Story 3 — The rule that keeps parity (Priority: P2)

**Goal**: The rule is stated where people and coding agents read, survives `graft init`, and the PR template carries the check.

**Independent Test**: quickstart §8; a fresh coding-agent session asked "I added a console feature, what else must I ship?" answers "agent tools with tests".

- [X] T052 [P] [US3] Write `docs/agent-tools.md`: the rule, definition of done (tests + tools + topic/title/template + audience gating + confirm on destructive + no secrets out), file layout (`<slice>/<name>.tool.ts` + spec, provider in the slice module), how to pick a topic, template conventions, the reference module `api/src/slices/agent/peer/` and `contracts/tool-metadata.md` summary, how to see a tool in the panel and why "after restart" appears, the reviewer's one-line check
- [X] T053 [P] [US3] Add an "Agent tools" section to `CLAUDE.md` after the client-state paragraph: five lines stating the rule and linking `docs/agent-tools.md`, in the same voice as the i18n and state paragraphs
- [X] T054 [P] [US3] Create `scripts/ensure-agent-tools-rule.mjs` (idempotent: inserts the fenced `<!-- ranch:agent-tools:start/end -->` pointer block into `.claude/skills/graft/SKILL.md` and `.cursor/rules/graft.mdc` if missing) and run it; add the invocation to `make init` (or the `Makefile` target that runs after clone) and mention it in `docs/agent-tools.md`
- [X] T055 [P] [US3] Create `.github/PULL_REQUEST_TEMPLATE.md` with the standard sections used in recent PRs (summary, ticket link, test plan) plus the checklist line "console capability added → agent tool added, with tests (docs/agent-tools.md)"
- [X] T056 [US3] Add one paragraph to `README.md` after "Peers and A2A" pointing at the Tools panel and `docs/agent-tools.md`; commit `docs: agent tools rule, graft pointers and PR template (CLEAN-109)`

**Checkpoint**: Jira comment — rule documented in CLAUDE.md, docs, graft pointers, PR template.

---

## Phase 6: Polish & Cross-Cutting

- [X] T057 [P] Review every new tool description for the confirm sentence on ⚠ tools and for "next move" wording in refusals; fix wording inconsistencies across `api/src/slices/**/*.tool.ts`
- [X] T058 [P] Review templates in the panel for readability (no ids, «…» placeholders only, ≤ 200 chars) by opening the sheet and reading every topic; fix in the tool files
- [X] T059 Run `cd admin && npx nuxt typecheck` and `bun test slices`; run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest`; run `cd api && bun run lint` if defined
- [ ] T060 (needs a running stack — left for review) Walk quickstart.md §1–§8 end to end on the local stack; record any deviation in `specs/016-agent-tool-parity/quickstart.md` notes
- [X] T061 Open the GitHub PR into `main` (`gh pr create`) titled `feat: agent tool parity, Tools panel and the tools-per-module rule (CLEAN-109)` with the PR template filled, link it on CLEAN-109, move the issue to In Review (transition "In Testing" if that is the board's review column)

---

## Dependencies & Execution Order

- **Phase 2 blocks everything**: T002 → T003 → T004 → T005; T006/T007 parallel with T004; T008/T009 after T003+T006; T010 gates Phase 3+.
- **Phase 3 (US2)**: API tasks T011–T020 first (T011/T012/T013 parallel; T014 → T015 → T016; T017 after T012+T014; T018 after T017; T019 after T018; T020 last). Admin T021/T022/T025 parallel and may start during the API work; T023 needs T020+T022; T024 after T022; T026 after T021+T023+T024+T025; T027 after T025+T026; T028 after T026; T029 last.
- **Phase 4 (US1)**: every topic task T030–T049 is independent of the others (different slices/files) and depends only on Phase 2. T042 touches `rancher.tool.ts` and T049 touches it too — run those two sequentially. T050 after all topic tasks; T051 last.
- **Phase 5 (US3)**: independent of Phase 4 in code; ordered after it so the doc describes what exists. T052–T055 parallel; T056 last.
- **Phase 6**: after Phases 4 and 5.

## Parallel Example: Phase 4

```text
# After T010, launch up to four topic tasks at once (different slices, no shared files):
Task: T030 agents (api/src/slices/agent/agent/agentAdmin.tool.ts)
Task: T037 skills (api/src/slices/skill/skill.tool.ts)
Task: T039 MCP servers (api/src/slices/mcpServer/mcpServer.tool.ts)
Task: T040 knowledge bases (api/src/slices/reins/knowledge/knowledgeAdmin.tool.ts)
# Then the next four, and so on; T042 and T049 not together.
```

## Implementation Strategy

1. **Foundation** (Phase 2): the contract and validation; API boots with annotated tools. Commit.
2. **Visible first** (Phase 3): the catalogue endpoint and the Tools panel. From here every new tool is verifiable by eye. Commit, Jira checkpoint.
3. **Parity in topic batches** (Phase 4): four topics per checkpoint; each topic is one commit with its spec. The MVP for US1 is the first batch (agents, skills, MCP servers, knowledge bases), which already unlocks quickstart §6 prompts 1 and 2.
4. **Rule** (Phase 5), then **polish and PR** (Phase 6).

## Notes

- Never rename an existing tool (spec Decision 3).
- Never run `bun run test` in `api/` with a dev API running.
- Every commit subject carries `CLEAN-109`; no push to `main`.
- Jira comments: after T010, T029, every fourth topic in Phase 4, T051, T056, and T061 (PR link).
