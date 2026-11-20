# Implementation Plan: The Ranch assistant for everyone, on the Owner's terms

**Branch**: `feat/CLEAN-240-rancher-access` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-rancher-access/spec.md`

**Ticket**: [CLEAN-240](https://dreamvention.atlassian.net/browse/CLEAN-240)

## Summary

Whether an account has the Ranch assistant, and which of its abilities it gets,
becomes a setting of its own: per role with a default (Admins on + Full, Users
on + Basic), per account as an exception, as a level (Basic / Standard / Full)
or a custom choice by area and ability. The assistant stops being a row in the
agent lists, so limiting an account to some agents no longer removes it.

Technically it is two overrides at two seams that already exist, plus one new
piece of tool metadata:

1. **Availability** — `AgentAccessService.reachableIds()` builds the reach with
   the assistant's switch, so every route and tool that asks "does this caller
   reach this agent" gets the new answer without being touched
   ([research R1](./research.md)).
2. **Abilities** — a second `CallerToolPolicy` narrows `tools/list` and
   `tools/call` for a person talking through the assistant. The audience (role
   ceiling) still filters first, so a setting can only remove
   ([research R2](./research.md)).
3. **`effect: 'read' | 'write'`** on every `@Tool`, enforced at boot, so levels
   are a rule over (area, effect, audience) and not a list someone maintains
   ([research R3, R4](./research.md)).

## Technical Context

**Language/Version**: TypeScript 5 — NestJS 11 (`api`), Nuxt 3 / Vue 3 (`admin`, `app`)

**Primary Dependencies**: Prisma (PostgreSQL), the in-repo MCP layer (`api/src/slices/mcp`), zod, Pinia, shadcn-vue on reka-ui (`admin` has switch / checkbox / accordion / sheet; `app` has sheet since CLEAN-237), vue-i18n in `app`

**Storage**: PostgreSQL — two new tables (`AssistantRoleAccess`, `AssistantAccountAccess`), one data migration over `UserAgentAccessEntry` ([data-model.md](./data-model.md))

**Testing**: jest (`api`, incl. `mcp/toolReach.spec.ts`-style table tests), `bun test` (`admin`, `app`), `nuxt typecheck`, `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts`

**Target Platform**: Linux containers on Kubernetes; evergreen browsers

**Project Type**: Web application — one API, two consoles (twin slices)

**Performance Goals**: no added round trip a person can notice — the grant is two primary-key reads per `tools/list` / `tools/call`, memoised on the request

**Constraints**: a setting never widens the role ceiling; a change is in force on the affected person's next message with more than one API replica (no process-wide cache); the API refuses to boot a tool without `effect`; `admin` English-only, `app` English source

**Scale/Scope**: 174 existing tools to classify (157 within an Admin's ceiling, 49 within a User's); 2 role rows; exceptions in the tens; 1 new API slice, 1 new `admin` slice area, 1 small `app` addition; 6 new agent tools

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1 design. Both passes: no violation.*

| Principle | How this plan meets it |
|---|---|
| **I. The slice is the unit** | New API slice `user/assistantAccess` (controller, tool, domain, data, dtos, `.prisma`). It gives `agentAccess` the assistant's switch through an interface the way `IAgentReach` already crosses that boundary; `mcp` learns nothing about it — it only asks every `CallerToolPolicy`. |
| **II. Twin consoles** | `user` is a twin slice. Settings are edited in `admin` only (the account pages and the assistant's page live there). `app` gets what a User needs: the assistant disappears when off (already follows reach) and the person sees their own level. The PR states that `app` edits nothing and why. |
| **III. Secrets stay behind `api/`** | No new secret. Tool results and routes carry names, titles and counts. `get_my_assistant_access` and `/me/assistant-access` say nothing about other accounts. |
| **IV. One entity, one store** | `admin`: one `assistantAccess` Pinia store (roles, exceptions by user id, catalogue). Optimistic switch/level changes go through `patch()` with rollback. `app`: one small store for the person's own grant. |
| **V. The console is a window, the chat is the hands** | Every console capability here has a tool ([contracts/tools.md](./contracts/tools.md)): overview, set per role, get/set/reset per account, and the person's own view. Narrowing asks for `confirm`. |
| **VI. English is the source** | `app` copy in `en.json`, `ru` through `i18n:sync` (R11 notes the key that answered 401 and the documented fallback). `admin` literal English. Numbers through the format modules. |
| **VII. A rule stays a rule** | No model judgment anywhere: availability is a lookup, a level is a rule over three stored facts, precedence is account → role → default. The one thing the model is asked to do — call `get_my_assistant_access` before saying it cannot — changes wording, never access. |

**Quality gates** carried into tasks: tool metadata boot check, `toolReach` table extended with the assistant grant, `locale:check`, typecheck of both consoles, docs updated in the same PR (`docs/agent-tools.md` for `effect` and the grant; `CLAUDE.md` + `constitution.md` Agent-tools lines gain `effect`).

## Project Structure

### Documentation (this feature)

```text
specs/034-rancher-access/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # HTTP routes
│   ├── tools.md         # agent tools
│   └── ui.md            # what the consoles show
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
api/src/slices/
├── mcp/
│   ├── decorators/tool.decorator.ts        # + effect: 'read' | 'write' (required)
│   ├── services/mcp-registry.service.ts    # boot refusal without effect / read+destructive
│   ├── services/tool-catalog.service.ts    # ask every CallerToolPolicy, intersect
│   └── interfaces/caller-tool-policy.interface.ts   # multi-provider token
├── user/
│   ├── assistantAccess/                    # NEW slice
│   │   ├── assistantAccess.prisma          # AssistantRoleAccess, AssistantAccountAccess
│   │   ├── assistantAccess.controller.ts   # /assistant-access…, /users/:id/assistant-access, /me/assistant-access
│   │   ├── assistantAccess.tool.ts         # the six tools
│   │   ├── assistantAccess.module.ts
│   │   ├── domain/
│   │   │   ├── assistantAccess.types.ts    # Choice, Resolved, defaults
│   │   │   ├── assistantLevels.ts          # levelSet(level, abilities) — pure
│   │   │   ├── assistantAccess.service.ts  # resolve, set, reset, refuse rules, overview
│   │   │   ├── assistantToolPolicy.service.ts   # the CallerToolPolicy
│   │   │   └── assistantAccess.gateway.ts
│   │   ├── data/                           # gateway + mapper
│   │   └── dtos/
│   └── agentAccess/
│       └── domain/agentAccess.service.ts   # reach override; refuse the assistant id in lists
│       └── domain/agentAccess.types.ts     # AgentReach takes the assistant's switch
├── agent/agent/agent.controller.ts         # GET /agents/admin/current open to User
├── rancher/                                # one paragraph in the assistant's instructions
└── **/*.tool.ts                            # + effect on each of 174 tools
api/prisma/migrations/<ts>_assistant_access/  # tables + data migration (R10)

admin/slices/
├── user/assistantAccess/                   # NEW: store, gateway, mapper, domain
│   └── components/assistantAccess/
│       ├── RoleCard.vue                    # card A
│       ├── AccountRow.vue                  # block B
│       ├── Advanced.vue                    # sheet C
│       ├── LevelPicker.vue  AreaSwitch.vue  Badge.vue
│       └── utils/ (counts, tri-state, diff "who loses what") + tests
├── user/agentAccess/components/agentAccess/Editor.vue   # hosts AccountRow; assistant gone from rows
├── rancher/components/…                    # hosts RoleCard; level badge in the chat header
└── common/components/layout/Sidebar.vue    # unchanged logic; now driven by the switch

app/slices/
├── agent/components/agent/workspace/…      # level badge on the assistant (D)
├── user/…                                  # store for /me/assistant-access
└── */i18n/locales/en.json (+ generated ru)

docs/agent-tools.md, CLAUDE.md, .specify/memory/constitution.md   # effect + the grant
```

**Structure Decision**: the feature lives next to the thing it replaces —
`user/assistantAccess` beside `user/agentAccess` in both `api` and `admin` —
because it is about accounts and roles, is edited on the same account page, and
has to hand `agentAccess` one answer (the switch). `mcp` stays generic: it
gains a required metadata field and the ability to ask more than one policy.

## Delivery order

Each step leaves the product working and is a commit (or small PR) of its own.

1. **`effect` on every tool** — metadata, boot check, 174 classifications,
   docs. No behaviour change. Largest diff, lowest risk; lands first so nothing
   else waits on it.
2. **Settings and resolution** — tables, service, level rule, refusal rules,
   routes, tests. Nothing reads them yet.
3. **Abilities seam** — multi-policy catalogue, `AssistantToolPolicy`,
   `get_my_assistant_access`, the assistant's instruction paragraph,
   `toolReach`-style table over role × level × area.
4. **Availability seam + carrying over** — reach override, lists refuse the
   assistant, data migration, `/agents/admin/current` for Users. This is the
   step that fixes the reported failure and changes Users' default; it ships
   together with step 5 so the Owner has the controls the moment the default
   moves.
5. **`admin` UI** — card A, block B, sheet C, the notice, badge.
6. **`app`** — the person's badge, i18n.
7. **The remaining five tools** and the quickstart on a live stack.

## Risks

| Risk | Mitigation |
|---|---|
| A misclassified `effect` puts a write into Basic | Classification is reviewed as its own commit; a test asserts no tool with `destructive` or with a name starting `create_ / set_ / delete_ / update_ / write_ / remove_ / revoke_ / run_ / start_ / stop_ / restart_` is `read` without an entry in an explicit allowlist with a reason. |
| Users lose agent management through chat on update | Decided (Clarifications). One-time notice with the count and a one-click raise to Standard. |
| An old runtime caches a tool list across turns | `tools/call` asks the same policy; a removed tool is refused there. |
| Overlap with `fix/CLEAN-236` in colleague tool files | One metadata line per tool; second to merge rebases (R12). |
| The model says "I have no tool" instead of explaining | `get_my_assistant_access` is always listed and its description, plus the instruction paragraph, tell it to check first; quickstart 2.2 verifies on a live stack. |

## Complexity Tracking

No constitution violation to justify.
