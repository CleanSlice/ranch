# Implementation Plan: Pin agents

**Branch**: `feat/CLEAN-216-pin-agents` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/027-pin-agents/spec.md`

**Ticket**: [CLEAN-216](https://dreamvention.atlassian.net/browse/CLEAN-216) `[ADMIN][APP]`

## Summary

One boolean on the agent, `pinned`, default `false`, written through the
existing `PUT /agents/:id` update route (Owner / Admin) and read back with every
agent. Both consoles order pinned agents ahead of unpinned ones in every list
through their existing pure ordering functions, show a pin icon on the agent,
and toggle the flag optimistically through the store's `patch()` with a
rollback. The Ranch admin agent gets one `pin_agent` tool. No new endpoint, no
new store, no new entity, one additive migration.

## Technical Context

**Language/Version**: TypeScript 5.x everywhere. API on NestJS 11 + Prisma 6
(`api/`), consoles on Nuxt 4 / Vue 3.5 / Pinia (`admin/`, `app/`).

**Primary Dependencies**: no new dependency. Icons: lucide through the app's
`<Icon name>` (`pin` / `pin-off`), `@tabler/icons-vue` in admin (`IconPin` /
`IconPinnedOff`); both sets already ship the icons (research R4).

**Storage**: PostgreSQL through Prisma; one new column `Agent.pinned BOOLEAN
NOT NULL DEFAULT false`, additive migration, no backfill needed.

**Testing**: API `jest` run directly (`NODE_OPTIONS=--experimental-vm-modules
npx jest <path>`; never `bun run test` with a dev API up); consoles `bun test
slices` for pure utils; `npx nuxt typecheck` in both consoles; browser checks
with playwright-core scripts under `specs/027-pin-agents/e2e/`.

**Target Platform**: the three existing projects; the local stack from
`specs/026-app-console-redesign/quickstart.md` (Postgres + MinIO in Docker,
API `node dist/main` on :3333, app dev on :3000, admin dev on :3001).

**Project Type**: web service + two web consoles (monorepo, slices).

**Performance Goals**: none specific; ordering is O(n log n) over tens of
agents, unchanged from today.

**Constraints**: the flag must never touch status, pod or access (FR-007), so
it travels in the update route but is excluded from the admin console's
"pending restart" banner (research R5). App copy through `en.json` + sync.

**Scale/Scope**: ~20 files across `api/src/slices/agent/agent`,
`app/slices/agent`, `admin/slices/agent/agent`; one migration; regenerated SDK
in both consoles.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| I. The slice is the unit | PASS | Everything lives in the `agent` slice of each project: `api/src/slices/agent/agent` (prisma, DTOs, types, gateway, mapper, tool), `app/slices/agent` (types, mapper, store use, utils, workspace components, i18n), `admin/slices/agent/agent` (types, mapper, composable, rail, header). Nothing reaches sideways; nothing goes to `common`. |
| II. Twin consoles (NON-NEGOTIABLE) | PASS | `agent` is a twin slice and this feature changes it in **both** consoles by design (US1 app, US2 admin). Grep targets recorded in research R3: `railOrder` (app) ↔ `useAgentRailEntries` (admin) are already declared twins in their comments (CLEAN-136); the plan extends both with the same rule and adds the same test to each. The PR states what was done in each console. |
| III. Secrets stay behind `api/` | PASS | No credential anywhere. The tool result carries `id`, `name`, `pinned`. |
| IV. One entity, one store | PASS | The flag is a field of the agent record in each console's existing agent store. Toggle = `store.patch(id, { pinned })` with the returned rollback, then `store.update(id, { pinned })`; on failure the rollback runs. Orbit node, drum card, rail row and sheet / header all read the same record. No second copy. |
| V. Console is a window, chat is the hands | PASS | `pin_agent` in `agentAdmin.tool.ts` (the slice's tool file), `topic: ToolTopics.Agents`, `title`, `template`, `requireOperator` (Owner / Admin), **no** `confirm` (reversible, harmless, research R6), result without secrets, one spec block in `agentAdmin.tool.spec.ts`. It calls the same gateway `update` the controller calls. |
| VI. English is the source | PASS | App keys added to `app/slices/agent/i18n/locales/en.json` (`sheet.pin`, `sheet.unpin`, `sheet.pinned`, `sheet.pin_failed`), `bun run i18n:sync` generates `ru`, then the Russian is read for tone. Admin stays English literals. |
| VII. A rule stays a rule | PASS | Ordering is a pure function with tests in each console; no model call. |
| Generated code is generated | PASS | `AgentDto.pinned` and `UpdateAgentDto.pinned` reach the consoles only through `bun run generate:swagger` → `bun run build:api`; the mappers read the generated field. Research R9 names the regen sequence and the check that the diff carries only this ticket's types. |
| Tracker / surface | PASS | CLEAN-216, `[ADMIN][APP]`, labels `admin`, `app`. API changes are implied by both surfaces. |
| Quality gates | PLANNED | Commands in [quickstart.md](./quickstart.md); magic numbers: none introduced. |

**Post-design re-check (after Phase 1)**: no violation. One choice worth
naming: the pin rides on the general update route instead of a dedicated
`POST /agents/:id/pin` pair. The route already exists with the right gate, the
SDK already has `agentControllerUpdate` in both consoles, and the tool and the
consoles then share one write path (research R2). The cost is that the update
route's "pending restart" semantics in the admin console must skip this field;
that is one condition in one composable (R5), cheaper than a new route in
three projects.

## Project Structure

### Documentation (this feature)

```text
specs/027-pin-agents/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R10
├── data-model.md        # Phase 1: Agent.pinned
├── quickstart.md        # Phase 1: stack, migration, regen, gates, browser checks
├── contracts/
│   ├── api.md           # DTO field, update route semantics, pin_agent tool
│   └── console-ui.md    # ordering rule, icon, controls, accessible names, failure
├── e2e/                 # implementation phase: pin.mjs (app), admin-pin.mjs (admin)
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
api/
├── prisma/migrations/20261109120000_agent_pinned/migration.sql   # new, additive
└── src/slices/agent/agent/
    ├── agent.prisma                     # + pinned Boolean @default(false)
    ├── dtos/agent.dto.ts                # + pinned
    ├── dtos/updateAgent.dto.ts          # + pinned?
    ├── domain/agent.types.ts            # IAgentData.pinned, IUpdateAgentData.pinned
    ├── data/agent.mapper.ts             # toEntity: pinned
    ├── data/agent.gateway.ts            # update(): pinned
    ├── data/agent.gateway.spec.ts       # + pinned round-trip
    ├── agentAdmin.tool.ts               # + pin_agent
    └── agentAdmin.tool.spec.ts          # + pin_agent cases

app/slices/agent/
├── domain/agent.types.ts                # IAgentData.pinned, IAgentUpdateInput.pinned
├── data/agent.mapper.ts                 # toEntity / toUpdateDto: pinned
├── utils/railOrder.ts (+ .test.ts)      # admin agent, pinned, rest
├── utils/orbitLayout.ts (+ .test.ts)    # pinned block before unpinned, status inside
├── composables/useAgentControls.ts      # + togglePin (optimistic, rollback)
├── components/agent/workspace/
│   ├── Sheet.vue                        # Pin / Unpin button, pin icon by the name
│   ├── RailItem.vue                     # pin icon
│   ├── Orbit.vue                        # pin icon on the node
│   └── Drum.vue                         # pin icon on the card
├── i18n/locales/en.json (+ ru.json via sync)
└── (setup/api/data/repositories/api/*.gen.ts regenerated)

admin/slices/agent/agent/
├── domain/agent.types.ts                # IAgentData.pinned, IUpdateAgentData.pinned
├── data/agent.mapper.ts                 # toEntity / toUpdateDto: pinned
├── utils/railOrder.ts (+ .test.ts)      # new: twin of app's railOrder
├── composables/useAgentRailEntries.ts   # uses railOrder, carries pinned
├── composables/useAgentPin.ts           # new: optimistic toggle with rollback
├── pages/agents/index.vue               # landing: Rancher, else first pinned, else newest
├── components/agent/workspace/
│   ├── RailItem.vue                     # pin icon
│   └── Main.vue                         # Pin / Unpin icon button in the header
└── (setup/api/data/repositories/api/*.gen.ts regenerated)
```

**Structure Decision**: three existing projects, one slice each; no new
folder beyond the migration and the two small admin files (`utils/railOrder.ts`
is the admin twin of a function the app already has; `useAgentPin.ts` keeps the
optimistic toggle out of the already long `Main.vue`).

## Complexity Tracking

No violations to justify.
