# Tasks: The Ranch assistant for everyone, on the Owner's terms

**Input**: Design documents from `/specs/034-rancher-access/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/tools.md, contracts/ui.md, quickstart.md

**Ticket**: CLEAN-240 — every commit subject ends with `(CLEAN-240)`; branch `feat/CLEAN-240-rancher-access`.

**Tests**: included. `docs/agent-tools.md` requires a spec per tool and the repo's quality gates require the tables in `api/src/slices/mcp/*.spec.ts` to cover every tool. Write each test before the code it covers and watch it fail.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1…US7)

## Path Conventions

`api/src/slices/…` (NestJS), `admin/slices/…` and `app/slices/…` (Nuxt). New API slice: `api/src/slices/user/assistantAccess/`. New admin slice area: `admin/slices/user/assistantAccess/`. New app slice area: `app/slices/user/assistantAccess/`.

---

## Phase 1: Setup

**Purpose**: a workspace that builds, and the slices' empty shells.

- [ ] T001 Prepare the worktree: `bun install`, `cd api && bun run generate && bun run build && bun run generate:swagger`, confirm `cd api && bun run test -- tool-metadata toolAudience toolReach` is green before any change
- [ ] T002 [P] Create the API slice shell `api/src/slices/user/assistantAccess/` (`assistantAccess.module.ts`, `index.ts`, empty `domain/`, `data/`, `dtos/`) and register the module where `AgentAccessModule` is registered
- [ ] T003 [P] Create the admin slice shell `admin/slices/user/assistantAccess/` (`nuxt.config.ts` with alias `#assistantAccess`, `index.d.ts`, `plugins/di.ts`) following `admin/slices/user/agentAccess/`
- [ ] T004 [P] Create the app slice shell `app/slices/user/assistantAccess/` (`nuxt.config.ts`, `index.d.ts`, `plugins/di.ts`, `i18n/locales/en.json` with an empty `assistantAccess` object) following `app/slices/share/`

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the read/write mark on every tool, the stored settings and their resolution, and a catalogue that can ask more than one policy. No behaviour changes for anyone until Phase 3.

### The `effect` mark (research R3)

- [ ] T005 Add failing cases to `api/src/slices/mcp/tool-metadata.spec.ts`: every registered tool has `effect` of `'read'` or `'write'`; no tool is `destructive: true` with `effect: 'read'`; no tool whose name starts with `create_ / set_ / delete_ / update_ / write_ / remove_ / revoke_ / run_ / start_ / stop_ / restart_ / import_ / install_ / replace_ / sync_` is `'read'` unless listed in an in-file `READ_DESPITE_NAME` map with a reason
- [ ] T006 Add required `effect: 'read' | 'write'` to `ToolMetadata` and `ToolOptions` in `api/src/slices/mcp/decorators/tool.decorator.ts`, and make `api/src/slices/mcp/services/mcp-registry.service.ts` refuse to boot a tool without it or with `destructive` + `'read'` (same place and wording style as the `topic`/`title`/`template` refusal)
- [ ] T007 [P] Classify every `@Tool` in `api/src/slices/agent/**/*.tool.ts` (agents, files, secrets, channels, limits, share links, peers, templates, events, pins) with `effect`
- [ ] T008 [P] Classify every `@Tool` in `api/src/slices/reins/**/*.tool.ts`, `api/src/slices/skill/**/*.tool.ts`, `api/src/slices/paddock/**/*.tool.ts` with `effect`
- [ ] T009 [P] Classify every `@Tool` in `api/src/slices/user/**/*.tool.ts`, `api/src/slices/setting/**/*.tool.ts`, `api/src/slices/llm/**/*.tool.ts`, `api/src/slices/mcpServer/**/*.tool.ts`, `api/src/slices/usage/**/*.tool.ts`, `api/src/slices/chat/**/*.tool.ts` with `effect`
- [ ] T010 [P] Classify every `@Tool` in `api/src/slices/rancher/*.tool.ts`, `api/src/slices/browser/*.tool.ts`, `api/src/slices/integration/**/*.tool.ts`, `api/src/slices/bridle/**/*.tool.ts` and any `*.tool.ts` not covered by T007–T009 (`grep -rL "effect:" api/src/slices --include='*.tool.ts'` must come back empty) with `effect`
- [ ] T011 Run `cd api && bun run test -- tool-metadata && bun run build && bun run generate:swagger`; fix until green and the API boots. Commit: `feat(mcp): every tool says whether it reads or writes`

### Settings and resolution (data-model.md)

- [ ] T012 [P] Write `api/src/slices/user/assistantAccess/domain/assistantLevels.spec.ts`: `levelSet('basic')` = every `read` plus every audience `person`; `'standard'` adds `write` in `agents, agent_workspace, knowledge, skills, peers, paddock`; `'full'` = all governed; audiences `everyone` and `agent` are never in any set; a made-up new tool `{ topic: 'skills', effect: 'write' }` lands in Standard and Full only
- [ ] T013 [P] Write `api/src/slices/user/assistantAccess/domain/assistantAccess.service.spec.ts` for resolution: no rows → Admin `{ enabled: true, level: 'full', source: 'role' }`, User `{ enabled: true, level: 'basic', source: 'role' }`; a role row replaces the default; an account row wins over the role row in both directions; Owner and `trusted` are never looked up and get everything; a custom choice drops names no longer in the catalogue and reports catalogue names missing from `known` as `new`
- [ ] T014 Define `AssistantRoleAccess` and `AssistantAccountAccess` in `api/src/slices/user/assistantAccess/assistantAccess.prisma` per data-model.md, run `cd api && bun run generate`, and create the migration `api/prisma/migrations/<timestamp>_assistant_access/migration.sql` with the two tables only (the data migration is T029)
- [ ] T015 [P] Implement `api/src/slices/user/assistantAccess/domain/assistantAccess.types.ts` (`AssistantLevel`, `IAssistantChoice`, `IAssistantSetting`, `IAssistantResolved`, `ASSISTANT_ROLE_DEFAULTS`, `IAbility`, error codes `ABOVE_YOUR_OWN`, `UNKNOWN_ABILITY`, `ASSISTANT_NOT_LISTED`) and `domain/assistantLevels.ts` (`STANDARD_AREAS`, `isGoverned(audience)`, `minRoleOf(audience)`, `levelSet(level, abilities)`) until T012 passes
- [ ] T016 Implement the gateway (`domain/assistantAccess.gateway.ts` abstract class; `data/assistantAccess.gateway.ts`, `data/assistantAccess.mapper.ts`): find/upsert role row, find/upsert/delete account row, list account rows, `removeUser(userId)`; hook `removeUser` into the same place `AgentAccessService.removeUser` is called from
- [ ] T017 Implement in `domain/assistantAccess.service.ts`: `abilities()` (from `McpRegistryService.getTools()`: name, title, area, effect, destructive, minRole, governed), `resolveFor(person)` returning `{ enabled, level, source, names: Set<string> }` memoised per request object, and `resolvedView(...)` producing `Resolved` of contracts/api.md (`offered`, `available`, `matchesLevel`, `version`) — until T013 passes

### A catalogue that asks every policy (research R2)

- [ ] T018 Add failing cases to `api/src/slices/mcp/tooling.spec.ts` (or a new `api/src/slices/mcp/services/tool-catalog.service.spec.ts`): with two registered policies answering `{a,b,c}` and `{b,c,d}` only `b,c` are listed; `null` from one policy leaves the other's set; all `null` → everything; a policy that throws is treated as `null` and logged, as today
- [ ] T019 Make `CallerToolPolicy` a multi-provider in `api/src/slices/mcp/interfaces/caller-tool-policy.interface.ts` (an injection token `CALLER_TOOL_POLICIES` resolved as an array), update `ToolCatalogService.allowedNamesFor` in `api/src/slices/mcp/services/tool-catalog.service.ts` to intersect, register `TemplateToolPolicyService` under the token in `api/src/slices/agent/template/template.module.ts`, and confirm the `tools/call` path uses the same `allowedNamesFor`. Run `cd api && bun run test -- mcp template` green. Commit: `feat(assistantAccess): settings, levels and a catalogue that asks every policy`

**Checkpoint**: API boots, all suites green, nobody's behaviour has changed.

---

## Phase 3: User Story 1 — Limiting an account to some agents no longer takes the assistant away (P1) 🎯 MVP

**Goal**: the assistant's availability is its own switch; it is not a row in the agent lists.

**Independent Test**: an account that reaches every agent gets one ordinary agent marked Allowed; signed in as that account the assistant is still in the menu, opens and answers (quickstart §1). On pre-update data, Denied → off, Allowed → on, hidden-by-list → on (quickstart §6).

### Tests

- [ ] T020 [P] [US1] Add to `api/src/slices/user/agentAccess/domain/agentAccess.service.spec.ts`: a `limited` account whose allowed list does not name the assistant still `reaches(assistantId)` when its switch is on, and does not when it is off; the Owner and non-persons always reach it; `reachableIds().where()` never excludes the assistant when on and always excludes it when off
- [ ] T021 [P] [US1] Add to the same spec: `view()` never returns the assistant's id in `allowed` or `denied`; `change()` naming the assistant's id is refused with `ASSISTANT_NOT_LISTED` and saves nothing
- [ ] T022 [P] [US1] Add to `api/src/slices/mcp/toolReach.spec.ts`: an Admin limited to two ordinary agents, assistant on → `list_agents` returns those two plus the assistant; assistant off → `get_agent` on the assistant's id answers the same "not found" as an unknown id
- [ ] T023 [P] [US1] Write `api/src/slices/user/assistantAccess/assistantAccess.migration.spec.ts` for the pure function of T029: entries `[denied assistant]` → account row `enabled: false`; `[allowed assistant, allowed X]` → no row, entry for X kept; `[allowed X]` with `limited` → no row; every assistant entry removed; `limited` untouched
- [ ] T024 [P] [US1] Add to `admin/slices/user/agentAccess/` a test `utils/assistantRow.test.ts`: the editor's rows never include an agent with `isAdmin`, and a search that matches only the assistant's name yields the "set above" state

### Implementation

- [ ] T025 [US1] Define `IAssistantAvailability` (`assistantId(): Promise<string | null>`, `enabledFor(caller): Promise<boolean>`) in `api/src/slices/user/agentAccess/domain/agentAccess.types.ts`, provide it from `AssistantAccessModule` (backed by `IAgentGateway.findAdmin()` and `resolveFor`), and extend `AgentReach` with an optional `{ id, enabled }` override applied in `has()`, `filter()` and `where()`
- [ ] T026 [US1] Use the override in `AgentAccessService.reachableIds`, `reaches`, `reachesExisting`, `assertReaches` and `accountReachesExisting` in `api/src/slices/user/agentAccess/domain/agentAccess.service.ts` until T020 and T022 pass
- [ ] T027 [US1] In the same service make `view()` drop the assistant's id and `change()` refuse it (`ASSISTANT_NOT_LISTED`, 422 in `agentAccess.controller.ts`; the same refusal text in `set_user_agent_access` of `agentAccess.tool.ts`) until T021 passes
- [ ] T028 [US1] Open `GET /agents/admin/current` to `UserRoleTypes.User` in `api/src/slices/agent/agent/agent.controller.ts` (reach decides; a User gets the reader view through `presentOne`); update its `summary` and the route-table fixture `api/src/slices/user/auth/guards/__fixtures__/routeTable.ts`
- [ ] T029 [US1] Implement the carry-over as a pure function `carryOver(entries, assistantId)` in `api/src/slices/user/assistantAccess/domain/assistantCarryOver.ts` (T023 green) and its SQL twin appended to the T014 migration: insert `AssistantAccountAccess(enabled=false, level=<role default>)` for accounts with a `denied` entry on the agent where `"isAdmin" = true`, then delete every `UserAgentAccessEntry` for that agent
- [ ] T030 [US1] Remove the assistant from the rows of `admin/slices/user/agentAccess/components/agentAccess/Editor.vue` (filter `isAdmin` in the rows source; "The assistant is set above." when the search matches only it) until T024 passes; regenerate both consoles' API clients (`cd admin && bun run build:api`, `cd app && bun run build:api`)

**Checkpoint**: the reported failure is gone. Every non-Owner account has the assistant on with its role's default level. ⚠ Ship together with Phase 4 (see Implementation Strategy).

---

## Phase 4: User Story 2 — The Owner sets what each role gets (P1)

**Goal**: one card on the assistant's page: Admins and Users, each a switch and a level; the grant narrows what the assistant offers.

**Independent Test**: Users on Basic, Admins on Standard. A User asking to restart their own agent is not offered it; an Admin restarts an agent they reach; the Admin's assistant has nothing about creating users (quickstart §2).

### Tests

- [ ] T031 [P] [US2] Write `api/src/slices/user/assistantAccess/domain/assistantToolPolicy.service.spec.ts`: answers `null` when the bearer is not the assistant's token, when the party is the Owner, `trusted` or a `guest`; for a `person` Admin/User through the assistant answers exactly `resolveFor(person).names` plus the never-governed tools (audiences `everyone`, `agent`) plus `get_my_assistant_access`; memoised per request
- [ ] T032 [P] [US2] Write `api/src/slices/mcp/assistantGrant.spec.ts` in the style of `toolReach.spec.ts`: for role ∈ {Admin, User} × level ∈ {basic, standard, full}, the listed tools through the assistant equal `levelSet(level) ∩ audienceAllows(role)`; one named probe per area (e.g. `restart_agent`, `create_user`, `update_template`, `list_knowledges`); a tool not listed is refused at `tools/call` with the catalogue's ordinary unknown-tool answer (SC-006)
- [ ] T033 [P] [US2] Write `api/src/slices/user/assistantAccess/assistantAccess.controller.spec.ts` for `GET /assistant-access` and `PUT /assistant-access/roles/:role`: Owner only (Admin → 403); defaults reported when no rows; `enabled`/`level` saved; stale `version` → 409; `:role = Owner` → 400; `accounts` counts the accounts of that role without an exception
- [ ] T034 [P] [US2] Write `admin/slices/user/assistantAccess/utils/roleChange.test.ts`: `narrows(before, after, catalogue, role)` is true for a lower level and for off, false for a higher level or on; `lossSummary` returns the number of abilities lost within the role's ceiling
- [ ] T035 [P] [US2] Write `admin/slices/user/assistantAccess/stores/assistantAccess.test.ts`: `patchRole` applies optimistically and rolls back on a failed save; a fetch upserts; the catalogue is fetched once

### Implementation

- [ ] T036 [US2] Implement `AssistantToolPolicyService extends CallerToolPolicy` in `api/src/slices/user/assistantAccess/domain/assistantToolPolicy.service.ts` (assistant detected by `callerAgentId(req)` equal to `findAdmin()`'s id; party by `callerParty(req)`), register it under `CALLER_TOOL_POLICIES` in `assistantAccess.module.ts` until T031 and T032 pass
- [ ] T037 [US2] Implement `setRole(editor, role, setting, version)` and `overview(editor)` (roles only; `exceptions: []`, `notice: null` for now) in `domain/assistantAccess.service.ts`, with an audit log line on every write (editor, target, before, after — FR-031)
- [ ] T038 [US2] Implement DTOs in `api/src/slices/user/assistantAccess/dtos/` (`AssistantSettingDto`, `AssistantResolvedDto`, `AssistantOverviewDto`, `AbilityDto`, `AreaDto`, `AssistantCatalogDto`) and the routes `GET /assistant-access`, `PUT /assistant-access/roles/:role`, `GET /assistant-access/catalog` in `assistantAccess.controller.ts` until T033 passes; regenerate swagger and both consoles' API clients
- [ ] T039 [P] [US2] Implement the admin data layer `admin/slices/user/assistantAccess/{domain,data}/` (types, gateway, mapper, service) and the Pinia store `stores/assistantAccess.ts` (`roles`, `catalogue`, `fetchOverview`, `fetchCatalogue`, `patchRole` with rollback per docs/state.md) until T035 passes
- [ ] T040 [P] [US2] Implement `admin/slices/user/assistantAccess/components/assistantAccess/LevelPicker.vue` (segmented Basic | Standard | Full; `levels` prop so Users get two; `disabledAbove` prop; shows `Custom · N of M` when `level === 'custom'`) and `utils/roleChange.ts` until T034 passes
- [ ] T041 [US2] Implement `admin/slices/user/assistantAccess/components/assistantAccess/RoleCard.vue` per contracts/ui.md §A (two rows: switch, `LevelPicker`, accounts count; narrowing asks once with `lossSummary`; widening saves at once; toast with Undo; off greys the row) and mount it on the assistant's page in `admin/slices/rancher/components/rancher/Provider.vue` for the Owner only

**Checkpoint**: US1 + US2 together are the shippable MVP — the failure is fixed and the Owner has the controls for the new defaults.

---

## Phase 5: User Story 3 — One account gets something different (P2)

**Goal**: the assistant block on top of an account's Agent access card; an exception in two clicks, back in one.

**Independent Test**: Admins on Standard; one Admin set to Full, another to off, a third untouched — each gets exactly that (quickstart §3).

### Tests

- [ ] T042 [P] [US3] Add to `assistantAccess.service.spec.ts`: `refuseEdit` — Owner edits any non-Owner; an Admin edits only a User they may edit under specs/032; nobody edits an Owner's or their own; an Admin's write whose resulting set is not a subset of the Admin's own offered set is refused `ABOVE_YOUR_OWN` with the offending names; `reset` deletes the row and is idempotent; an account keeps its row when the role row changes
- [ ] T043 [P] [US3] Add to `assistantAccess.controller.spec.ts`: `GET/PUT/DELETE /users/:id/assistant-access` — the refusals above as 403/422; an account the caller may not see → the same 404 body as an unknown id; `ceiling` present only for an Admin editor; `editable: false` for an Owner target
- [ ] T044 [P] [US3] Write `admin/slices/user/assistantAccess/utils/accountRow.test.ts`: the caption is "Same as all Admins" / "Same as all Users" / "Set for this account" / "The Owner always has everything." / "No assistant yet."; levels above `ceiling` come back disabled

### Implementation

- [ ] T045 [US3] Implement `viewAccount`, `setAccount`, `resetAccount` and `refuseEdit` in `domain/assistantAccess.service.ts` (reuse `refuseAccessEdit` of `agentAccess.service.ts` for who-edits-whom; add the subset rule) until T042 passes
- [ ] T046 [US3] Add the three account routes and their DTOs to `assistantAccess.controller.ts` / `dtos/` until T043 passes; regenerate swagger and the admin API client
- [ ] T047 [US3] Extend the admin store with `accounts: Record<userId, …>`, `fetchAccount`, `patchAccount` (rollback), `resetAccount`; implement `utils/accountRow.ts` until T044 passes
- [ ] T048 [US3] Implement `admin/slices/user/assistantAccess/components/assistantAccess/AccountRow.vue` per contracts/ui.md §B and mount it as the first block of `admin/slices/user/agentAccess/components/agentAccess/Editor.vue`, saving independently of "Save access"

**Checkpoint**: exceptions work from the account page.

---

## Phase 6: User Story 4 — Advanced: area by area, ability by ability (P2)

**Goal**: a sheet with areas (switch + count), abilities as a checklist, search, a filter for abilities that change things, levels as starting points, Custom.

**Independent Test**: from Standard switch "Users & API keys" off and untick "Delete an agent"; an Admin restarts agents, cannot delete one, and is offered nothing about users (quickstart §4).

### Tests

- [ ] T049 [P] [US4] Add to `assistantAccess.service.spec.ts`: a custom `on` list is validated — unknown names → `UNKNOWN_ABILITY`; ungoverned names and names above the target's role ceiling are refused, not stored; saved sorted and deduplicated with `known` = all governed names at save time; `matchesLevel` reported when `on` equals a level's set
- [ ] T050 [P] [US4] Write `admin/slices/user/assistantAccess/utils/advanced.test.ts`: `areaState(area, on)` → `'on' | 'off' | 'mixed'` with `offered`/`available` counts within the role ceiling; toggling a `mixed` area turns it on; `applyLevel(level, catalogue)`; `untickDestructive(on, catalogue)`; `filterAbilities(query, onlyWrites)` keeps area grouping; abilities with `minRole` above the role come back `disabled` with reason `owner_only` / `admins_and_above`; `isNew(name, known)`

### Implementation

- [ ] T051 [US4] Accept `{ level: 'custom', on }` in `setRole` / `setAccount` with the validation of T049; include `on` and `new` in the account and role views when the level is custom
- [ ] T052 [P] [US4] Implement `admin/slices/user/assistantAccess/utils/advanced.ts` until T050 passes
- [ ] T053 [P] [US4] Implement `admin/slices/user/assistantAccess/components/assistantAccess/AreaSwitch.vue` (three states, `role="checkbox"` with `aria-checked="mixed"`, keyboard operable — FR-027)
- [ ] T054 [US4] Implement `admin/slices/user/assistantAccess/components/assistantAccess/Advanced.vue` per contracts/ui.md §C (Sheet from the right; accordion of areas; checklist with `changes` / `deletes` marks and `new` badge; All · None per area; search; "Only the ones that change things"; "Untick everything that deletes"; "Start from" levels with the replace-custom confirmation; "Always on" disclosure; Cancel / Save; focus returns to the trigger)
- [ ] T055 [US4] Wire "Advanced ›" in `RoleCard.vue` and `AccountRow.vue` to `Advanced.vue` (one component, target = role or account), and show `Custom · N of M` in `LevelPicker.vue`

**Checkpoint**: the flexible case works; the common case never opens it.

---

## Phase 7: User Story 5 — One place answers "who has the assistant, and for what" (P3)

**Goal**: the list of accounts that differ from their role, on the assistant's page; the one-time notice after the update.

**Independent Test**: two accounts with their own setting appear with the right level; dropping one from the list returns it to its role (quickstart §3.3).

- [ ] T056 [P] [US5] Add to `assistantAccess.service.spec.ts`: `overview().exceptions` lists every account row with name, email, role, resolved setting, `updatedBy` name and `updatedAt`; an exception whose choice exceeds the account's current role ceiling reports `reducedByRole: true`; `notice.usersManagingAgents` counts Users who created at least one agent while Users are on Basic and the notice is not dismissed
- [ ] T057 [US5] Fill `exceptions` and `notice` in `overview()` and add `DELETE /assistant-access/notice` (dismissal stored as a setting through `api/src/slices/setting`) until T056 passes; regenerate the admin API client
- [ ] T058 [US5] Add the "Different for these accounts" list (Open · Reset; "Everyone follows their role." when empty; "reduced to the Users' ceiling" mark) and the one-time notice with "Raise Users to Standard" / "Dismiss" to `RoleCard.vue`, backed by `exceptions` and `notice` in the store

---

## Phase 8: User Story 6 — The same through the assistant (P3)

**Goal**: every console capability of this feature has a tool, with the same rules.

**Independent Test**: as the Owner in chat, change a role's level and one account's setting; the console shows both (quickstart §5).

- [ ] T059 [P] [US6] Write `api/src/slices/user/assistantAccess/assistantAccess.tool.spec.ts`: listed / not listed per audience for the five tools; `set_assistant_role_access` and `set_user_assistant_access` without `confirm` on a narrowing change answer who loses what (accounts, abilities per area) and save nothing; with `confirm` they save; a widening change needs no `confirm`; an Admin gets the route's refusals (Owner target, self, Admin target, above their own); results name no ability of other accounts beyond the target
- [ ] T060 [US6] Implement `get_assistant_access` (`owner`, read), `set_assistant_role_access` (`owner`, write, destructive), `get_user_assistant_access` (`admin`, read), `set_user_assistant_access` (`admin`, write, destructive), `reset_user_assistant_access` (`admin`, write) in `api/src/slices/user/assistantAccess/assistantAccess.tool.ts` per contracts/tools.md, topic `users_keys`, party from `callerParty(httpRequest)`, until T059 passes
- [ ] T061 [US6] Add the five tools to the tables in `api/src/slices/mcp/toolAudience.spec.ts` and `api/src/slices/mcp/tool-secrets.spec.ts`, and to the audience table in `docs/agent-tools.md`

---

## Phase 9: User Story 7 — A person can see why the assistant will not do something (P3)

**Goal**: the assistant says "not included for you, the Owner decides"; the console shows the person's level.

**Independent Test**: as an Admin on Basic, ask the assistant to create an agent; the answer says it is not included for this account and that the Owner decides (quickstart §2.2).

- [ ] T062 [P] [US7] Add to `assistantAccess.tool.spec.ts`: `get_my_assistant_access` is listed for a person at every level, including a custom choice with nothing on, and is never in a grant's removable set; it returns the caller's level, the areas with `offered`/`available`, and the titles of abilities their role has and their setting leaves out; it names no other account and nobody who set it
- [ ] T063 [P] [US7] Add to `assistantAccess.controller.spec.ts`: `GET /me/assistant-access` for any signed-in person returns the same shape as the tool, `enabled: false` with empty areas when off, everything for the Owner
- [ ] T064 [US7] Implement `myAccess(person)` in the service, the `get_my_assistant_access` tool (`person`, read; description tells the model to call it before saying it cannot do something) and the `GET /me/assistant-access` route until T062 and T063 pass; regenerate both consoles' API clients
- [ ] T065 [US7] Add one paragraph to the assistant's instructions in the Rancher template under `api/src/slices/rancher/` (the file the template's system prompt is built from; keep within the size limits `rancherTemplate.spec.ts` enforces): when asked for something it has no ability for, call `get_my_assistant_access`, say it is not included for this person and that the Owner decides, never describe what others have
- [ ] T066 [P] [US7] Implement `admin/slices/user/assistantAccess/components/assistantAccess/Badge.vue` per contracts/ui.md §D (level badge with a popover of areas and "The Owner decides what the assistant can do for you.") and mount it in the assistant's chat header in `admin/slices/rancher/components/rancher/Provider.vue` for non-Owners
- [ ] T067 [P] [US7] In `app`: implement `app/slices/user/assistantAccess/{domain,data,stores}/` for `GET /me/assistant-access` (one store, fetched when the account changes, reset in `app/slices/user/auth/plugins/accountScope.client.ts`), a `components/assistantAccess/Badge.vue` shown on the assistant in `app/slices/agent/components/agent/workspace/Sheet.vue`, copy in `app/slices/user/assistantAccess/i18n/locales/en.json`, then `bun run i18n:sync` (docs/i18n.md; if the key is refused, write `ru.json` and run the sync again so it adopts it)

---

## Phase 10: Polish & cross-cutting

- [ ] T068 [P] Update `docs/agent-tools.md`: the `effect` field in "The `@Tool` metadata" and the review checklist; a section "The assistant's grant" (what it narrows, what it never governs, where the policy lives); the new tools in the reach and audience tables
- [ ] T069 [P] Update the Agent-tools line in `CLAUDE.md` and principle V in `.specify/memory/constitution.md` to name `effect` among the required metadata (both in the same commit, per the constitution's governance rule); update the `<!-- ranch:agent-tools -->` block of `.claude/skills/graft/SKILL.md` if it is tracked
- [ ] T070 [P] Twin-console check: grep `assistantAccess`, `isAdmin`, `adminReach` in `admin/slices` and `app/slices`; record for the PR which console needed what and why `app` edits nothing
- [ ] T071 Run from the repo root `bun run typecheck && bun run locale:check && bun run i18n:check && bun run test:scripts`, then `cd api && bun run test`, `cd admin && bun run test`, `cd app && bun run test`; report any failure with its output
- [ ] T072 Run quickstart.md §1–§7 on a local stack (API from the worktree, both consoles); screenshot card A, block B and sheet C for the PR; note anything not exercised
- [ ] T073 Bump the root `package.json` version above the highest `v*` tag, open the PR into `main` (what changed for Admins and Users on update, the twin-console note, the screenshots), link it on CLEAN-240

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → stories.
- Inside Phase 2: T005 → T006 → T007–T010 (parallel) → T011; T012/T013 → T014 → T015 → T016 → T017; T018 → T019. The three groups are independent of each other.
- **US1 (3)** needs T017 (resolution) for the switch.
- **US2 (4)** needs T017 and T019. Independent of US1 in code; shipped together with it.
- **US3 (5)** needs US2 (the role an account differs from; `LevelPicker`, the store).
- **US4 (6)** needs US2; its account entry point needs US3.
- **US5 (7)** needs US3 (there must be exceptions to list).
- **US6 (8)** needs US2 and US3 (the service methods the tools call); the custom `on` argument needs US4's T051.
- **US7 (9)** needs US2 (the grant). Independent of US3–US6.
- **Polish (10)** last.

### Story completion order

```
Phase 2 ─┬─▶ US1 ─┐
         └─▶ US2 ─┴─▶ (ship MVP) ─┬─▶ US3 ─┬─▶ US4
                                  │        └─▶ US5
                                  ├─▶ US7
                                  └─▶ US6 (after US3, US4)
```

### Parallel opportunities

- T002, T003, T004.
- T007, T008, T009, T010 — four people or four agents, disjoint files.
- T012 and T013; then the `effect` group, the settings group and the catalogue group side by side.
- All test tasks of one story marked [P].
- After the MVP: US3 and US7 in parallel; then US4 and US5 in parallel.

## Parallel Example: Phase 2, the `effect` mark

```
Task T007: classify api/src/slices/agent/**/*.tool.ts
Task T008: classify reins, skill, paddock
Task T009: classify user, setting, llm, mcpServer, usage, chat
Task T010: classify rancher, browser, integration, bridle and the rest
→ then T011 alone: boot check, tests, commit
```

## Parallel Example: User Story 2

```
Tests first, together: T031, T032, T033, T034, T035
Then: T036 → T037 → T038 (API, same slice, in order)
Alongside T037/T038: T039 and T040 (admin, different files)
Last: T041 (needs T038's client, T039, T040)
```

## Implementation Strategy

### MVP = US1 + US2, shipped together

US1 alone fixes the reported failure but also moves Users from "everything their role allows" to Basic. The Owner must have the role card in the same release, so the two P1 stories are one increment:

1. Phase 1, Phase 2 (can merge on its own: no behaviour change).
2. US1 and US2 on one branch → quickstart §1, §2, §6 → release.

### Then, each on its own

3. US3 (exceptions) → release.
4. US7 (the person sees why) — small, valuable as soon as anyone is narrowed.
5. US4 (Advanced) → release.
6. US5 (overview), US6 (chat tools) → release. US6 closes the constitution's "the chat is the hands" for this feature; do not call the feature done before it.

### Notes

- A test is written first and seen failing; a classification commit (T007–T010) is reviewed on its own.
- Do not merge US1 without US2.
- `fix/CLEAN-236-identity-boundaries` edits the colleague tool files T007 touches; whichever merges second rebases one line per tool.
- Commit after each task or logical group; every subject ends with `(CLEAN-240)`.
