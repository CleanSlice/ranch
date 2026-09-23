# Research: Agent tool parity (CLEAN-109)

Date: 2026-09-22. Every item below resolves a question the plan depended on. Facts were read from the code on this branch (graft + source), not assumed.

## R1 — Where tool metadata lives and how to make it mandatory

**Decision**: Extend `ToolOptions` / `ToolMetadata` in `api/src/slices/mcp/decorators/tool.decorator.ts` with `topic: ToolTopic`, `title: string`, `template: string`, `destructive?: boolean`. Add `validateToolMetadata()` to `McpRegistryService.onApplicationBootstrap` (after `discoverTools`) that throws `Error('Tool "<name>" is missing <field>')` for any tool without `topic`, `title` or `template`, and for any `destructive` tool whose Zod parameters lack a required boolean `confirm`. A thrown error at bootstrap fails the API start, which is the enforcement FR-005 asks for.

**Rationale**: The decorator is the single entry point for every tool (59 today, all in the API), and the registry already walks them at boot. Failing fast at startup is cheaper and more reliable than a lint rule or a review checklist.

**Alternatives considered**: ESLint rule on `@Tool({` calls (misses dynamic construction, needs a plugin); a test that snapshots the registry (would pass locally and fail only when someone remembers to run it).

## R2 — Topics: how many and which

**Decision**: A `ToolTopics` const in `api/src/slices/mcp/decorators/topics.ts` with 14 topics, each with a stable key, a display title and a sort order (see contracts/tool-metadata.md). Topics mirror console sections; small sections merge as the spec allows: *Users & API keys*, *Chats & usage*, *Browser & integrations*. Agents split into *Agents* (lifecycle, config, status) and *Agent workspace* (files, secrets, channels, share link) so neither accordion exceeds ~15 rows.

**Rationale**: The accordion is only useful when a topic fits on one screen. Fourteen topics × ≤ 16 tools is scannable; one "Agents" topic with 30 rows is not.

**Alternatives considered**: derive topic from the tool name prefix (breaks for `agent_usage`, `browser_session_*`, `query_attachment`); one topic per slice (too many, and slices are an implementation detail the panel should not show).

## R3 — How the console gets "the list this agent would see"

**Decision**: Extract the per-tool resolution loop from `McpToolsHandler.registerHandlers` (resolve provider → `isListedForRequest` → `describeForRequest` → static fallback) into `ToolCatalogService.listFor(principal)` in the mcp slice, where `principal` is the `IAuthTokenPayload`-shaped object that `JwtAuthGuard` puts on `httpRequest.user`. The handler wraps the real request; the new endpoint builds a synthetic one: `{ sub: 'agent:<id>', roles: agent.isAdmin ? [Owner] : [Agent], email: '' }` — the same shape `issueAgentServiceToken` in `user/auth/domain/auth.service.ts` mints for runtimes (verify the exact role assignment there when implementing; `toolSupport.ts` documents "admin agents hold Owner, plain agents hold Agent").

**Rationale**: The listing hooks take an `express.Request` today and read only `.user`; a synthetic request with the same `user` yields exactly what the pod would see, including dynamic descriptions (e.g. `query_knowledge` listing bound bases). One implementation, two callers, no drift.

**Alternatives considered**: a static catalogue in the admin (rejected in the spec's Decision 2); calling the MCP endpoint from the API to itself with a minted token (needless HTTP hop, session-id dance).

## R4 — Knowing whether the running pod already has a tool

**Decision**: New Prisma model `AgentToolListing { agentId String @id, toolNames Json, listedAt DateTime }` in a new `agent/toolCatalog` slice. `McpToolsHandler` after computing the list calls an optional `IToolListingRecorder.record(agentId, names)` (token resolved with `moduleRef.get(TOKEN, { strict: false })`, no-op when absent) when `callerAgentId(httpRequest)` is set. The catalogue endpoint computes `inPod` per tool: no pod → `null`; pod but no snapshot → `false`; else `toolNames.includes(name)`. A restart makes the pod list again, which overwrites the snapshot and clears the flags.

**Rationale**: Precise per-tool truth with one small table and one write per pod boot. The existing MCP-server drift (`detectMcpConfigDrift`, compares server row `updatedAt` to pod start) cannot see a change inside the built-in server's tool set, since tools are code, not rows. Persisting to the DB (not memory) survives API restarts, which are exactly when new tools appear.

**Alternatives considered**: bump the built-in Ranch server row's `updatedAt` on boot when a hash of the tool catalogue changed, so the existing drift banner fires (rejected: whole-group marking only, and it would flag every agent after every API deploy even when nothing they can use changed); in-memory map (lost on API restart, the common case).

## R5 — Destructive tools and confirmation

**Decision**: Every tool that deletes, revokes, replaces wholesale, changes a role, or runs an upgrade declares `destructive: true` and a `confirm: z.boolean()` parameter described as "Set true only after the person confirmed in the chat." A shared `confirmed(args, what)` helper in `mcp/tooling.ts` returns `err('This will <what>. Ask the person to confirm, then call again with confirm: true.')` when `confirm !== true`. The tool description ends with the same sentence, so the model reads the rule before calling.

**Rationale**: The API cannot see the chat; the argument is the only server-side proof that the model went through a confirmation step. The registry validation (R1) guarantees no destructive tool forgets the parameter.

**Alternatives considered**: a chat-level confirmation UI (out of scope per spec); description-only (no server-side check; a model that skips the text deletes).

## R6 — Secrets in and out

**Decision**: Tools that accept a secret (`create_llm`, `update_llm`, `register_mcp_server`, `update_mcp_server`, `set_agent_secret`, `replace_agent_secrets`, `create_user` password, `create_integration_account` secret) take it as a parameter and return metadata only; listings return names/ids/metadata with secret fields stripped in the tool (never rely on the gateway to omit them). One exception, mirroring the console: `create_api_key` returns the plaintext key once in its result, because the key exists nowhere else afterwards; its description says so and tells the model to hand it to the person verbatim and not repeat it. A cross-cutting spec (`api/src/slices/mcp/tool-secrets.spec.ts`) calls every secret-taking tool with a sentinel string and asserts it does not appear in the result.

**Rationale**: FR-004 with the one place where the product's own behaviour requires returning a secret.

**Alternatives considered**: making `create_api_key` console-only (breaks parity for a common ask); returning a masked key (useless to the person).

## R7 — Where the settings tool learns the keys

**Decision**: A `SETTING_CATALOG` constant in `api/src/slices/setting/domain/settingCatalog.ts`: `{ group, name, valueType, description, restartRequired }[]` compiled from the admin settings pages (`admin/slices/setting/pages/settings/*.vue` and `components/setting/nav/Menu.vue`: organization, agents, auth, github, bridle, knowledge, rancher, mcp, storage, secrets). `list_settings` and `upsert_setting` implement `IDynamicallyDescribedTool` and append the catalogue (group · name · meaning) to their description; `get_setting` / `delete_setting` are added. Unknown group/name on upsert is still allowed (the console allows it), but the tool result names the nearest catalogued key.

**Rationale**: FR-006. The catalogue is the smallest thing that makes "change the organisation name" work without the model guessing `organization.name`.

**Alternatives considered**: reading the keys from the admin at runtime (wrong direction of dependency); a DB table of setting definitions (over-engineering for ~25 keys).

## R8 — Admin UI primitives

**Decision**: Use the theme's `Sheet` (side panel, works at phone width, focus-trapped, Esc closes) for the panel; add an `accordion` primitive under `admin/slices/setup/theme/components/ui/accordion/` generated the shadcn-vue way on `reka-ui` (already a dependency: `reka-ui ^2.9.6`); `Input` for search; `Tooltip` on the button; `Skeleton` while loading. Icon: `Wrench` from lucide.

**Rationale**: The theme has sheet, tooltip, input, scroll-area and skeleton but no accordion or popover; reka-ui ships an accessible Accordion, so adding the shadcn wrapper is a 60-line file, not a dependency.

**Alternatives considered**: `<details>` elements (no keyboard-consistent behaviour, no animation, inconsistent styling); dropdown-menu (not scrollable, no search).

## R9 — Inserting the template at the cursor

**Decision**: The Tools button and sheet live inside `admin/slices/bridle/components/bridle/Input.vue`, which already owns `input` (the draft) and `textareaRef`. `pick(template)`: read the native textarea (`textareaRef.value?.$el`), splice the template at `selectionStart` (prefix with a space if the draft is non-empty and does not end with whitespace), set `input.value`, then on `nextTick` focus and `setSelectionRange` on the first `«…»`. A pure `insertTemplate(draft, cursor, template)` util returns `{ text, selectionStart, selectionEnd }` and is unit-tested with `bun test`. Remaining placeholders are highlighted by a small `hasPlaceholder` computed that adds an outline class to the textarea (spec edge case).

**Rationale**: No prop drilling through `Provider.vue`; the composer is the only component that should touch the draft.

**Alternatives considered**: emitting `insert` from Provider down to Input (adds an event hop and a second owner of the draft); a contenteditable composer (out of scope).

## R10 — Admin state and data flow

**Decision**: New slice `admin/slices/agent/toolCatalog/` with the standard CleanSlice layout: `data/` gateway over the generated SDK (`AgentsService.getAgentTools` after regen) + mapper to `IAgentToolCatalog`; `domain/` types + gateway interface + service; `stores/toolCatalog.ts` holding `catalogs: Record<agentId, IAgentToolCatalog>`, `byAgent(id)`, `fetch(id)` (upserts), and UI state per agent (`query`, `expanded: string[]`) so reopening the sheet restores the accordion; `components/toolCatalog/Sheet.vue` renders `store.byAgent(agentId)` and uses `useAsyncData` for `pending`/`error`/`refresh` only. Restart goes through `useAgentStore().restart(id)`.

**Rationale**: `docs/state.md` verbatim. The catalogue is an entity keyed by agent; two open chats must not share it (the bridle store learned this in CLEAN-102).

**Alternatives considered**: fetching inside the sheet with `useFetch` and rendering `data` (forbidden by the state rules).

## R11 — Where the rule lives so graft does not erase it

**Decision**: `docs/agent-tools.md` is canonical (rule, definition of done, file layout, metadata, gating, confirm, secrets, tests, reference module = `agent/peer`). `CLAUDE.md` gets an "Agent tools" section (five lines + link). `.claude/skills/graft/SKILL.md` and `.cursor/rules/graft.mdc` get a fenced block:

```
<!-- ranch:agent-tools:start -->
Project rule: a module is not done until the agent has tools for what it does — see docs/agent-tools.md.
<!-- ranch:agent-tools:end -->
```

plus `scripts/ensure-agent-tools-rule.mjs` that re-inserts the block if missing (idempotent; run by `make init` / documented in the doc). `.github/PULL_REQUEST_TEMPLATE.md` is created with the checklist line "console capability added → agent tool added, with tests" (none exists today).

**Rationale**: `graft init` rewrote the skill file on this very branch; a pointer that can be re-applied mechanically survives that. Keeping the rule short in graft files and long in `docs/` matches how the repo already treats `docs/state.md` and `docs/i18n.md`.

**Alternatives considered**: editing only `CLAUDE.md` (the ticket asks for graft explicitly); a `graft` custom-section feature (none in `graft --help`).

## R12 — Testing approach

**Decision**: Follow `agent/peer/peerAdmin.tool.spec.ts`: construct the tool with `jest.Mocked` gateways, build requests with `{ user: { sub, roles } }`, assert (a) listed for operator / not for plain agent, (b) happy path calls the gateway with the mapped arguments and returns `ok(...)`, (c) not-found and refusal come back as `isError` text that names the next move, (d) destructive tools refuse without `confirm`. Registry validation gets its own spec with a fake provider missing each field. The catalogue service gets a spec for the `inPod` matrix and external-server grouping. Admin utils get `bun test` specs. Run jest directly, never `bun run test`.

**Rationale**: The peer tools are the model the spec names; their tests are the most complete in the repo.

**Alternatives considered**: e2e through the MCP endpoint (slower, and the handler already has its own spec).

## Facts gathered (for tasks)

- MCP endpoint: `McpModule.forRoot({ mcpEndpoint: 'mcp/mcp', guards: [JwtAuthGuard], streamableHttp: { statelessMode: false } })` in `api/src/app.module.ts`.
- Caller helpers: `callerAgentId`, `callerIsOperator`, `ok`, `err`, `withRefusalAdvice` in `api/src/slices/agent/peer/toolSupport.ts`; `RancherTool.requireOwner` duplicates the operator check with a different message.
- Built-in MCP servers and ids: `mcp-ranch`, `mcp-knowledge`, `mcp-documents`, `mcp-cleanslice` in `api/src/slices/mcpServer/domain/mcpServer.seeder.ts`; `AgentMcpResolver.resolveForAgent` returns template servers + built-ins; `GET /agents/:id/mcps` and `GET /agents/:id/mcp-status` already exist.
- Pod start time comes from `IPodGateway.list()` (`startedAt`), as used in `getMcpStatus`.
- Controllers' injected services (the "backing" column in contracts/tools.md) were read from each controller's constructor.
- Admin restart: `admin/slices/agent/agent/stores/agent.ts` → `restart(id)`; pending-restart state lives in the same store (`isPendingRestart`, `markPendingRestart`).
- Admin has no unit tests today (`bun test slices` finds none); `*.spec.ts` next to a util is the convention to start.
- Prisma: per-slice `*.prisma` merged into `api/prisma/schema.prisma`; migrations are hand-written SQL under `api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/`.
