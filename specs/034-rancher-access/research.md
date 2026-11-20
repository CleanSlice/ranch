# Research: The Ranch assistant for everyone, on the Owner's terms (CLEAN-240)

What was looked up in the code before designing, and what was decided from it.
Paths are from the repository root.

## R1. Why an Admin loses the assistant today

- `GET /agents/admin/current` (`api/src/slices/agent/agent/agent.controller.ts`)
  is open to Owner and Admin and then asks `AgentAccessService.assertReaches`.
- `AgentReach.has()` (`api/src/slices/user/agentAccess/domain/agentAccess.types.ts`)
  answers "reached unless denied, or unless the account is `limited` and the
  agent is not on its allowed list". The assistant is an ordinary agent id to
  it.
- The admin sidebar (`admin/slices/common/components/layout/Sidebar.vue`) hides
  the assistant when that route answers 404.

**Decision**: the assistant's availability stops being an entry in the lists.
`AgentAccessService.reachableIds()` is the single place every route and tool
gets an `AgentReach` from, so the override goes there: the reach is built with
the assistant's id and the caller's assistant switch, and `has(assistantId)`
answers the switch, whatever the lists say.

**Rationale**: one seam, already asked by every surface (routes through
`AgentScoped`, tools through `callerParty`), so "off means it does not exist"
(FR-004) needs no new checks anywhere.

**Alternatives considered**: (a) auto-add the assistant to every allowed list —
keeps it a row, breaks FR-002, and every new restricted account needs the
write; (b) special-case `isAdmin` in the routes — a dozen call sites and the
first one forgotten is a leak.

## R2. Where "which abilities" can be decided

- A tool reaches a caller through `ToolCatalogService.listFor()`
  (`api/src/slices/mcp/services/tool-catalog.service.ts`): audience first
  (`audienceAllows`, the role ceiling), then the tool class's own
  `isListedForRequest`, then `CallerToolPolicy.allowedToolsFor()` — a set of
  names, or `null` for "all". `tools/call` asks the same policy.
- `CallerToolPolicy` has one implementation today,
  `TemplateToolPolicyService` (CLEAN-209: a template's tool allowlist).
- The party a call is made for is already on the request (`callerParty`,
  CLEAN-232): `person` with a role read from the database, `trusted`, `guest`.

**Decision**: the assistant's grant is a second `CallerToolPolicy`. The
catalogue asks every registered policy and intersects the answers. The new
policy answers `null` unless the bearer is the assistant's own token **and**
the party is a `person` whose role is Admin or User; then it answers the names
that person's setting includes.

**Rationale**: the ceiling stays where it is (audience), the grant can only
remove names, so FR-006 holds by construction — there is no code path by which
a setting adds a tool. Listing and calling share the policy, so FR-011 (absent,
not refused) and "taken away mid-task" hold too.

**Alternatives considered**: (a) a new audience per level — audiences are
compile-time and per tool, levels are data and per person; (b) filter in the
runtime — the runtime is not trusted with this (specs/032).

**Not governed, on purpose**: a person calling the MCP endpoint with their own
console token is not talking through the assistant and keeps their console
power; the Owner; a `trusted` call (the assistant for itself); a `guest`
(already gets nothing managerial); tools of audience `everyone` and `agent`
(11 today: reading an attachment, searching the assistant's own knowledge, the
agent's own colleagues) — the assistant needs them to hold any conversation.

## R3. What the platform knows about an ability

`@Tool` metadata (`api/src/slices/mcp/decorators/tool.decorator.ts`) carries
`name`, `title`, `topic`, `template`, `destructive`. The registry refuses to
boot a tool without `topic`/`title`/`template` or without an audience. There
is **no "only reads" flag**; FR-010 needs one.

**Decision**: add a required `effect: 'read' | 'write'` to `@Tool`. The
registry refuses to boot a tool without it, and refuses `destructive: true`
with `effect: 'read'`. All 174 tools are classified in the same change.

**Rationale**: a level defined by a rule over (area, effect, audience) places a
tool added next month correctly without anyone remembering this feature
exists. Guessing from the name (`list_`, `get_`) was tried for the inventory
below and is wrong for at least five tools (`sync_chats`,
`browser_session_set_status`, `health_check_llm`, …).

**Inventory** (name heuristic, five corrected by hand; exact after the
classification): 174 tools — 157 within an Admin's ceiling, 49 within a
User's, 6 Owner-only, 11 always on. 35 are marked destructive.

## R4. The rule that defines the levels

Areas are the existing topics (`api/src/slices/mcp/decorators/topics.ts`): 15,
not the 13 the spec listed from memory — `Attachments` and `Platform` exist
too. The spec's statement that areas are "the groups the abilities already
carry" stands; its list is illustrative.

**Decision**:

| Level | Includes |
|---|---|
| Basic | every tool with `effect: 'read'`, plus every tool of audience `person` (personal: pinning, the person's own browser sessions and integration accounts) |
| Standard | Basic, plus `effect: 'write'` in the areas Agents, Agent workspace, Knowledge, Skills, Peers, Paddock |
| Full | everything |

Always limited by the audience. Result today: Admin — Basic 83, Standard 132,
Full 157 of 157; User — Basic 28, Standard 49, Full 49 of 49.

**Consequence**: for a User, Standard and Full are the same set, because
everything else a User could write is above their ceiling. The console offers
Users two levels (Basic, Standard) and shows Full as "same as Standard for
Users".

**Alternatives considered**: hand-written lists per level — exact, and stale
with the first new tool; a fourth level "no destructive" — it is a filter, not
a level, and the Advanced panel gives it as one click ("only the ones that
change things" → None).

## R5. What a custom choice stores

**Decision**: a custom choice stores the names that are **on** and the names
that were **known** when it was saved. A tool in the catalogue and not in
`known` is new: off, and marked "new" in the panel until the next save. A name
no longer in the catalogue is dropped on read.

**Rationale**: the spec's two edge cases (a new ability is off in every Custom
choice and marked; a removed one disappears) fall out of the data without a
migration per release. Storing "off" names instead would switch new abilities
on silently.

## R6. Role default, account exception, precedence

No row for a role means the default (FR-009: Admin on + Full, User on +
Basic). A row for an account wins over its role in both directions (FR-015).
The Owner is never looked up (FR-005). An exception above the account's
current role ceiling needs no rewrite: the audience check already trims it,
and the overview says so (story 5, scenario 3).

## R7. "The next message" (FR-012)

`tools/list` and `tools/call` are per request and the party's role is already
re-read from the database on each. **Decision**: the grant is read per request
too, memoised on the request object the way `TemplateToolPolicyService` does.
No process-wide cache — the API runs more than one replica (CLEAN-224 notes
this for limits), and two rows by primary key cost nothing.

**The runtime needs no change.** It asks `tools/list` for the person of each
turn and keeps the answer for a minute under the acting token
(`catalogueFor` / `actorKey` in the runtime's `setup/mcp/data/mcp.gateway.ts`);
the hub signs a new acting token with every console message, so each message
gets a fresh list. Within one turn the list is fixed; a tool removed between
two steps is refused at `tools/call` by the same policy.

The runtime's `# Audience` block already tells the model that the tools in
the conversation are the ones this person may use, and tells a User to say
"their account cannot do that". It does not know about levels.

**Decision (changed 2026-11-20, on the requester's word)**: the runtime is
taught the levels as part of this feature. The hub adds
`acting.assistant = { level }` to a console person's message to the
assistant; the runtime's block names the level and points at the two tools
that hold the definitions ([contracts/acting.md](./contracts/acting.md)).
Enforcement stays where it is: the field is wording only.

**What the runtime does not get**: the definitions. A level is a rule the API
owns; a copy in the runtime or in an agent file would be wrong after the
first release that adds a tool. The runtime knows *that* levels exist and
which one this person has; `get_assistant_access` and
`get_my_assistant_access` say what they contain.

**Cost**: a runtime release and a restart of the assistant's pod (a runtime
release does nothing until the pod restarts). Until then the feature works
without the lines (FR-035). The runtime's `main` is at 0.35.0 and its
`fix/CLEAN-236-identity-boundaries` branch, not merged, also edits
`audience.prompt.ts`; whichever merges second rebases.

## R8. Telling the person (FR-028, FR-029)

A tool that is not listed cannot explain itself. **Decision**: one always-
listed tool of audience `person`, `get_my_assistant_access`, answering the
person's level, the areas it covers and the titles of abilities their role
has but their setting leaves out — never anything about other accounts. Its
description tells the model to call it before saying it cannot do something,
and what to say then.

The guidance lives in that description and nowhere else. Not in the Rancher
template's `SOUL.md`: identity files are copy-if-missing since CLEAN-56
(`AGENT_OWNED_ROOT_FILES`), so an edited template never reaches an assistant
that already exists, and that file is at its prompt limit (CLEAN-230). A tool
description travels with every `tools/list`, so it reaches a running pod on
the person's next message.

In the consoles the same answer comes from `GET /me/assistant-access`.

## R9. Who may change what

Mirrors `refuseAccessEdit` in `agentAccess.service.ts`: the Owner changes
roles and any non-Owner account; an Admin changes a User they reach under
specs/032, to at most their own grant, compared tool by tool (a custom choice
is allowed when it is a subset of the Admin's own set); nobody changes the
Owner's or their own. A `trusted` party acts as the Owner.

## R10. Carrying over (FR-030)

One data migration, in the same Prisma migration that creates the tables:

- entry `denied` for the assistant → account setting `enabled: false`;
- entry `allowed` for the assistant → nothing (on is the default);
- every entry for the assistant is deleted; `UserAgentAccess.limited` is left
  as it is.

An account whose only allowed agent was the assistant ends `limited` with an
empty allowed list — "reaches nothing, needs review", exactly what the Owner
sees today for a deleted last agent — and still has the assistant. Same
outcome as before the update.

Afterwards the lists refuse the assistant's id on write (`change()`), and
`view()` no longer returns it.

Users drop from "everything their role allows" to Basic (Clarifications). The
assistant's page shows a one-time notice to the Owner with the count of Users
who manage an agent and one button to raise Users to Standard.

## R11. Consoles

- `admin`: the account's card is `admin/slices/user/agentAccess/components/agentAccess/Editor.vue`
  (in `user/item/Provider.vue`); the assistant's page is
  `admin/slices/rancher/pages/rancher.vue`. `admin` already has shadcn
  `switch`, `checkbox`, `accordion`, `sheet`, `tabs`, `badge`.
- `app` (twin): Users meet the assistant as the hub of
  `app/slices/agent/components/agent/workspace/Orbit.vue`, found by `isAdmin`
  in the agents the account reaches — it disappears by itself once reach says
  so. `app` needs the person's own level shown there (FR-028) and nothing
  else: no setting is edited in `app`. English source + `bun run i18n:sync`
  (`CLAUDE_API_KEY` in `.env.project` answered 401 on 2026-11-20; hand-written
  `ru` adopted by the sync is the documented fallback).

## R12. Overlap with work in flight

`fix/CLEAN-236-identity-boundaries` (specs/033, not merged) changes colleague
tools, sign-in per console and chat identity per Admin. It touches
`api/src/slices/agent/peer`, `user/auth`, `bridle`. This feature touches
`mcp/services/tool-catalog.service.ts`, `mcp/decorators/tool.decorator.ts`,
every `*.tool.ts` (one new metadata line each) and `user/agentAccess`. The
colleague tool files overlap by one line per tool; whichever merges second
rebases. Nothing here depends on 033's behaviour.
