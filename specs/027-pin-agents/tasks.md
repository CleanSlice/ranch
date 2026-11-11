---

description: "Task list for Pin agents (CLEAN-216)"
---

# Tasks: Pin agents

**Input**: Design documents from `specs/027-pin-agents/` — [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Ticket**: [CLEAN-216](https://dreamvention.atlassian.net/browse/CLEAN-216) · **Branch**: `feat/CLEAN-216-pin-agents` (stacked on `feat/CLEAN-215-app-console-redesign`) · **Worktree**: `C:/Users/maxim/orca/workspaces/ranch/app-ui`

**Tests**: research R10 names them — jest cases on the API gateway and tool, `bun test` cases on the pure ordering functions in both consoles, playwright-core browser checks. All included; no other runner exists.

**Organization**: by user story. The API field is foundational (every story reads it) and lands first as its own commit; then the app (US1), the admin (US2), the tool (US3). Each phase ends with its project's gates green and a commit carrying `CLEAN-216`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 app console · US2 admin console · US3 Ranch agent tool
- Paths are repo-relative. `E2E` = `specs/027-pin-agents/e2e`. `LIB` = `specs/026-app-console-redesign/e2e/lib.mjs` (login, API session, agent picker; imported, not copied).

## Jira comments

Large task (three projects): one comment per checkpoint marked **(Jira)** — what landed, what is next, screenshots where the task says so. Teammate tone, a few sentences. ADF JSON written to the scratchpad with node and sent with `--data-binary`; keys from `.env.project`, never printed.

---

## Phase 1: Setup

**Purpose**: the local stack is up on the right code and the browser-check folder exists. Nothing in the three projects changes.

- [X] T001 Confirm the stack: Postgres + MinIO containers up (`docker ps`), API answering on :3333 (`curl -s localhost:3333/agents/public | head -c 200`), app dev on :3000, seeded Owner login in `.env.project` (`RANCH_LOCAL_LOGIN`, `RANCH_LOCAL_PASS`, names only). If the API is the CLEAN-215 build, note that it is rebuilt in T011.
- [X] T002 [P] Create `specs/027-pin-agents/e2e/` with an empty `shots/.gitkeep`; `quickstart.md` §5 already describes the scripts; nothing else yet.

---

## Phase 2: Foundational — the field in the API

**Purpose**: `Agent.pinned` exists, is stored, is returned by every read, is writable through `PUT /agents/:id`, and both console SDKs know it. Blocks every story.

- [X] T003 Add `pinned Boolean @default(false)` after `isAdmin` in `api/src/slices/agent/agent/agent.prisma` with a one-line comment (installation-wide flag, decides nothing for the pod, CLEAN-216).
- [X] T004 Create `api/prisma/migrations/20261109120000_agent_pinned/migration.sql` with the `ALTER TABLE "Agent" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;` from data-model.md and its header comment; run `cd api && bun run generate` so `prisma/schema.prisma` and the client carry the column.
- [X] T005 [P] Add `pinned: boolean` to `IAgentData` and `pinned?: boolean` to `IUpdateAgentData` in `api/src/slices/agent/agent/domain/agent.types.ts`.
- [X] T006 [P] Add `@ApiProperty({ description: 'When true, the agent is kept at the top of every agent list in both consoles. Installation-wide.' }) pinned: boolean;` to `api/src/slices/agent/agent/dtos/agent.dto.ts` after `isPublic`, and `@ApiPropertyOptional(...) @IsOptional() @IsBoolean() pinned?: boolean;` to `api/src/slices/agent/agent/dtos/updateAgent.dto.ts` after `debugEnabled` (contracts/api.md wording).
- [X] T007 Map `pinned: record.pinned` in `toEntity` of `api/src/slices/agent/agent/data/agent.mapper.ts` (no change to `toCreate`), and write `...(data.pinned !== undefined && { pinned: data.pinned })` in `update()` of `api/src/slices/agent/agent/data/agent.gateway.ts`.
- [X] T008 Add one case to `api/src/slices/agent/agent/data/agent.gateway.spec.ts`: `update(id, { pinned: true })` passes `pinned: true` to prisma and the mapped entity carries it; `update(id, { name })` passes no `pinned` key. Fix any fixture in `api/src/slices/agent/agent/**/*.spec.ts` that builds an `IAgentData` literal and now fails typecheck (add `pinned: false`).
- [X] T009 Run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/agent` (green) and `bun run build` (typecheck + dist).
- [X] T010 Apply the migration to the local database: `DATABASE_URL=<from .env.project, not printed> npx prisma migrate deploy` from `api/`; verify with `docker exec ranch-postgres psql -U postgres -d <db> -c '\d "Agent"'` that `pinned` is there.
- [X] T011 Restart the local API on the new build (stop the running `node dist/main`, start again with `WORKFLOW_PROVIDER=mock`); `curl` one agent and see `"pinned": false`.
- [X] T012 Regenerate the SDKs: `cd api && bun run generate:swagger`, `cd app && bun run build:api`, `cd admin && bun run build:api`; `git diff --stat app/slices/setup/api admin/slices/setup/api` and inspect: keep only hunks that add `pinned`; restore any other drift with `git show HEAD:<path> | sed 's/\r$//; s/$/\r/' > <path>` (research R9).
- [X] T013 Commit `feat(api): pinned flag on the agent (CLEAN-216)` — prisma, migration, DTOs, types, mapper, gateway, spec, regenerated SDK files of both consoles. Push with the `GITHUB_TOKEN` HTTPS form from memory (never `-u`).
- [X] T014 **(Jira)** Comment on CLEAN-216: field, migration and SDKs in; app next.

**Checkpoint**: `GET /agents/:id` returns `pinned`; `PUT` with `{ pinned: true }` as Owner flips it; as User returns 403.

---

## Phase 3: User Story 1 — Pin an agent and find it first (app) (Priority: P1) 🎯 MVP

**Goal**: Owner / Admin pins from the sheet; the agent carries a pin icon on sheet, rail row, drum card and orbit node; pinned agents sit first in rail (both modes), Drum and Orbit; failure rolls back; Users see no control.

**Independent Test**: `node specs/027-pin-agents/e2e/pin.mjs` passes; a User run shows the icon and no button.

- [X] T015 [P] [US1] Add `pinned: boolean` to `IAgentData` (doc comment: installation-wide, ordered first, CLEAN-216) and `pinned?: boolean` to `IAgentUpdateInput` in `app/slices/agent/domain/agent.types.ts`; map `pinned: o.pinned === true` in `toEntity` and pass `pinned` through `toUpdateDto` in `app/slices/agent/data/agent.mapper.ts`.
- [X] T016 [P] [US1] Extend `railOrder` in `app/slices/agent/utils/railOrder.ts` to `[isAdmin…, pinned…, rest…]` (generic now `{ isAdmin: boolean; pinned?: boolean }`, index loops, comment updated to name the pin); add cases to `app/slices/agent/utils/railOrder.test.ts`: pinned ahead of unpinned, admin agent ahead of pinned, stable order inside each block, all pinned = unchanged order.
- [X] T017 [P] [US1] Extend `orbitOrder` in `app/slices/agent/utils/orbitLayout.ts` with `pinned` as the first sort key (generic gains `pinned?: boolean`; doc comment: pinned block first, then status, then admin, then arrival); add cases to `app/slices/agent/utils/orbitLayout.test.ts`: pinned stopped agent before running unpinned; inside the pinned block running before stopped; admin rule still applies inside a block.
- [X] T018 [US1] Add action `'pin'` to `useAgentControls` in `app/slices/agent/composables/useAgentControls.ts`: `AgentControlAction` gains `'pin'`; `togglePin()` computes `next = !agent.pinned`, takes `const rollback = agentStore.patch(id, { pinned: next })`, awaits `agentStore.update(id, { pinned: next })`, on error calls `rollback()` and sets `failed = { action: 'pin', message }` (same 401 rule); `busy` guards it. Export `togglePin`.
- [X] T019 [US1] Add the four keys to `app/slices/agent/i18n/locales/en.json` under `sheet`: `pin`, `unpin`, `pinned`, `pin_failed` (research R8); run `cd app && bun run i18n:sync`, read the generated `ru.json` entries and correct tone only in `ru.json` after the sync; `bun run i18n:check` green.
- [X] T020 [US1] In `app/slices/agent/components/agent/workspace/Sheet.vue`: pin icon (`<Icon name="pin" :size="12">` + `<span class="sr-only">{{ $t('sheet.pinned') }}</span>`) after the name in the fold line when `agent.pinned`; inside `v-if="canManage"` a button with class `agent-sheet__btn`, `:aria-pressed="agent.pinned"`, icon `pin` / `pin-off`, label `$t(agent.pinned ? 'sheet.unpin' : 'sheet.pin')`, disabled while `controls.busy.value !== null`, `@click="controls.togglePin()"`, placed before the Share wrapper; `failedKey` gains `case 'pin': return 'sheet.pin_failed'`.
- [X] T021 [P] [US1] In `app/slices/agent/components/agent/workspace/RailItem.vue`: prop type gains `pinned?: boolean`; render `<Icon name="pin" :size="11">` + sr-only `$t('sheet.pinned')` beside the name (before the admin shield when both).
- [X] T022 [P] [US1] In `app/slices/agent/components/agent/workspace/Orbit.vue`: node badge for `node.agent.pinned` mirroring the admin shield badge markup; the node button's `aria-label` appends `· ${$t('sheet.pinned')}` when pinned.
- [X] T023 [P] [US1] In `app/slices/agent/components/agent/workspace/Drum.vue`: card badge `<Icon name="pin" :size="13">` + sr-only next to the admin shield badge for `card.agent.pinned`.
- [X] T024 [US1] Run gates: `cd app && bun test slices` (railOrder, orbitLayout green), `npx nuxt typecheck` (then revert regenerated SDK noise if the typecheck regenerated anything, memory note), `bun run i18n:check`, `bun run locale:check`.
- [X] T025 [US1] Write `specs/027-pin-agents/e2e/pin.mjs` importing `LIB`: login as Owner; pick the last non-admin, unpinned rail row; open it; click the Pin button (regex `/Закрепить|^Pin$/`); assert Unpin shown, rail row index 1 (after the admin agent) is this agent and carries the pin icon; switch to Drum (`/Барабан|Drum/`) → first card; switch to Orbit → first node after the admin agent has the badge; reload → still pinned; `GET` via `apiSession()` as a check of server truth; click Unpin → order and icons back. `--as user` flag: logs in with `RANCH_LOCAL_USER_LOGIN` / `_PASS` if present in `.env.project`, else prints `skip`. `--check-only` flag: asserts the current pinned state and order without clicking (used by T038). Screenshots `E2E/shots/pin-sheet-1440.png`, `pin-orbit-1440.png`, `pin-rail-390.png`. Exit code 1 on any FAIL.
- [X] T026 [US1] Run `node specs/027-pin-agents/e2e/pin.mjs`; fix what fails; rerun until all `ok`.
- [X] T027 [US1] Commit `feat(app): pin agents from the sheet, first in rail, drum and orbit (CLEAN-216)`; push.
- [X] T028 **(Jira)** Comment with the three screenshots attached (`X-Atlassian-Token: no-check`): app done, admin next.

**Checkpoint**: US1 is a shippable MVP: the flag is set and read from the app alone.

---

## Phase 4: User Story 2 — The same pin in the admin console (Priority: P1)

**Goal**: operator pins from the agent page header; icon in header and rail row; rail orders admin agent → pinned → rest; `/agents` lands on the first pinned agent when there is no Rancher; no "pending restart" banner for a pin.

**Independent Test**: pin in admin, reload the app: pinned; unpin in app, reload admin: unpinned; `admin/` typecheck and `bun test slices` green.

- [X] T029 [P] [US2] Add `pinned: boolean` to `IAgentData` and `pinned?: boolean` to `IUpdateAgentData` in `admin/slices/agent/agent/domain/agent.types.ts`; map `pinned: o.pinned === true` in `toEntity` and pass it through the update mapper in `admin/slices/agent/agent/data/agent.mapper.ts`.
- [X] T030 [P] [US2] Create `admin/slices/agent/agent/utils/railOrder.ts` as the twin of the app's (same signature, same loops, header comment names `app/slices/agent/utils/railOrder.ts` as its twin and CLEAN-216), and `admin/slices/agent/agent/utils/railOrder.test.ts` with the same four cases as T016 (admin tests use `toBe` / `toEqual` only, memory note).
- [X] T031 [US2] In `admin/slices/agent/agent/composables/useAgentRailEntries.ts`: replace the inline `.sort(...)` with `railOrder(...)` applied to the filtered list; `IRailEntry` gains `pinned: boolean`; map it.
- [X] T032 [P] [US2] In `admin/slices/agent/agent/components/agent/workspace/RailItem.vue`: import `IconPin` from `@tabler/icons-vue`; render it `v-if="entry.pinned"` beside the name with `title="Pinned"` and `aria-label="Pinned"`, before the shield.
- [X] T033 [P] [US2] Create `admin/slices/agent/agent/composables/useAgentPin.ts`: `useAgentPin(agentId: string, agent: Ref<IAgentData | null | undefined>)` → `{ pinned: ComputedRef<boolean>, toggling: Ref<boolean>, error: Ref<string | null>, toggle(): Promise<void> }`; `toggle` does `patch` → `update({ pinned: next })` → rollback on error, never calls `markPendingRestart` (comment says why, research R5).
- [X] T034 [US2] In `admin/slices/agent/agent/components/agent/workspace/Main.vue`: import `IconPin`, `IconPinnedOff`; `IconPin` beside the name `v-if="agent.pinned"` with `title="Pinned"`; an icon-only `<Button variant="outline" size="sm" :aria-pressed="pinned" :title="pinned ? 'Unpin' : 'Pin'" :disabled="toggling" @click="toggle">` between the Stop / Start button and the actions menu; `lifecycleError` also shows the pin error.
- [X] T035 [P] [US2] In `admin/slices/agent/agent/pages/agents/index.vue`: landing becomes Rancher → else first pinned (reuse `railOrder` and take `[0]` when it is pinned) → else newest updated; comment updated.
- [X] T036 [US2] Run gates: `cd admin && bun test slices`, `npx nuxt typecheck` (revert SDK regen noise if any).
- [X] T037 [US2] Start the admin dev server (`cd admin && npx nuxt dev --port 3001`) and write `specs/027-pin-agents/e2e/admin-pin.mjs`: log in to admin with the seeded Owner (find the form fields; if the admin login cannot be driven in 20 minutes, stop, do the check by hand and record "manual" in quickstart §5), open the pinned agent from US1, assert the header icon and the rail order, click the header pin button to unpin, assert the rail row moved back, pin it again; screenshot `E2E/shots/admin-pin-1440.png`. Run it.
- [X] T038 [US2] Cross-console check (SC-003): with the agent pinned in admin, `node specs/027-pin-agents/e2e/pin.mjs --check-only` passes against the app.
- [X] T039 [US2] Commit `feat(admin): pin agents from the header, first in the rail (CLEAN-216)`; push.
- [X] T040 **(Jira)** Comment with `admin-pin-1440.png`: both consoles in, tool next.

**Checkpoint**: one flag drives both consoles; the twin check for the PR is now a fact, not a promise.

---

## Phase 5: User Story 3 — Pin through the Ranch agent (Priority: P2)

**Goal**: `pin_agent { id, pinned }` on `AgentAdminTool`, operator-gated, no confirm, result without secrets, covered by the tool spec.

**Independent Test**: jest cases pass; the tool appears in the admin Tools catalog for the Ranch agent; a local chat call (if the mock runtime allows) flips the flag.

- [X] T041 [US3] Add `pin_agent` to `api/src/slices/agent/agent/agentAdmin.tool.ts` after `start_agent`: `@Tool({ name: 'pin_agent', topic: ToolTopics.Agents, title: 'Pin or unpin an agent', template: 'Pin the agent «name»', description: '…keeps it at the top of every agent list in both consoles; pinned=false removes the pin. Harmless and reversible. Takes the agent id — resolve a name with list_agents first.', parameters: z.object({ id, pinned: z.boolean() }) })`; body: `requireOperator`, `findById` → `notFound(id)`, `agents.update(id, { pinned })`, `ok({ ok: true, agent: { id, name, pinned }, message })` (contracts/api.md wording).
- [X] T042 [US3] Add cases to `api/src/slices/agent/agent/agentAdmin.tool.spec.ts`: pin writes `{ pinned: true }` through the gateway and the result carries `id`, `name`, `pinned` and nothing else from the agent; unpin writes `false`; unknown id returns the not-found payload and calls no update; a non-operator caller throws `ForbiddenException` and calls no update.
- [X] T043 [US3] Run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/agent/agentAdmin.tool.spec.ts` and `bun run build`; restart the local API; confirm the tool is listed for the admin agent (admin console Tools catalog for Rancher, or the MCP tools list the catalog reads).
- [X] T044 [US3] Commit `feat(api): pin_agent tool for the Ranch agent (CLEAN-216)`; push.

**Checkpoint**: constitution V satisfied; `docs/agent-tools.md` review checklist walked in the PR description.

---

## Phase 6: Polish, PR and rollout

- [X] T045 Full gate run and record the commands in the PR: `api` jest on `src/slices/agent` + `bun run build`; `app` `bun test slices`, `npx nuxt typecheck`, `bun run i18n:check`, `bun run locale:check`; `admin` `bun test slices`, `npx nuxt typecheck`. Confirm `git status` is clean apart from gitignored shots.
- [X] T046 [P] Re-run `node specs/027-pin-agents/e2e/pin.mjs` end to end once more on the final build; leave the pinned state as the owner would expect (one agent pinned for the demo).
- [X] T047 Open the PR with `gh` as the DREAM account (`gh api user` first): base `feat/CLEAN-215-app-console-redesign` while #176 is open (retarget to `main` the moment #176 merges), title `feat: pin agents (CLEAN-216)`, body: summary, the twin-console statement in words (app sheet/rail/drum/orbit; admin header/rail/landing; ordering function and tests mirrored), tool checklist from `docs/agent-tools.md`, gate commands from T045, screenshots, the `settings/mcp.vue` stale list noted as pre-existing debt. No session link anywhere.
- [X] T048 **(Jira)** Final comment with the PR URL; transition CLEAN-216 to In Testing (transition 51).
- [ ] T049 After the owner's review and green CI, and after #176 is in `main`: retarget if needed, `gh pr merge <n> --merge` as the DREAM account, then watch the `Release Platform` Actions run for the push to `main` and report its conclusion on the ticket.

---

## Dependencies

```
Phase 1 ─▶ Phase 2 (API field, SDKs) ─▶ Phase 3 US1 (app) ─▶ Phase 4 US2 (admin) ─▶ Phase 5 US3 (tool) ─▶ Phase 6
                                      └──────────────────────┴──────────────────────┘
                                        US2 and US3 depend only on Phase 2; they are
                                        ordered after US1 for commit hygiene, not by code.
```

- T005 / T006 parallel; T007 after both. T008 after T007. T010 after T004 + T009. T012 after T011.
- US1: T015, T016, T017 parallel; T018 after T015; T019 before T020; T020 after T018 + T019; T021–T023 parallel after T015; T024 after all; T025 after T020–T023.
- US2: T029, T030 parallel; T031 after T030; T032, T033, T035 parallel after T029/T030; T034 after T033; T036 after all; T037 after T036; T038 after T037.
- US3: T041 → T042 → T043 → T044.

## Parallel execution examples

- Phase 2: `T005` (types) and `T006` (DTOs) at once; then `T007`.
- US1: `T016` (railOrder + test) and `T017` (orbitOrder + test) and `T015` (types/mapper) at once; then `T021`, `T022`, `T023` at once while `T018`→`T020` proceeds.
- US2: `T030` (railOrder twin + test) with `T029`; then `T032`, `T033`, `T035` at once.

## Implementation strategy

1. **MVP = Phase 2 + Phase 3**: the flag exists and the app pins, orders and shows it. Shippable on its own, admin merely displays nothing new.
2. **Increment 2 = Phase 4**: the admin console reads and writes the same flag; the twin rule is met.
3. **Increment 3 = Phase 5**: the chat gets the same hands; constitution V closed.
4. **Phase 6** closes the ticket: gates, PR, rollout watch.

Every phase ends with a commit that builds, typechecks and passes its project's tests on its own, so the branch is always in a state the owner can pull and click.
