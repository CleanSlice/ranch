# Implementation Plan: Agent launch steps

**Branch**: `feat/CLEAN-247-agent-launch-steps` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-agent-launch-steps/spec.md`

**Ticket**: [CLEAN-247](https://dreamvention.atlassian.net/browse/CLEAN-247)

## Summary

Both consoles replace the spinner-and-a-sentence in their launch overlay with
the Inspira UI Multi Step Loader. The component is the centre of this work: it
is vendored from Inspira's source and keeps its API, its markup and its motion.
Six small, listed additions make it fit (research R2); it is not rewritten and
no look-alike is built.

The loader is driven through its own `async` mode by a pure function that turns
the facts the consoles already receive (agent status, pod phase, hub
connection, tool state) into six steps. `admin` has those facts live today.
`app` does not, and shows text picked by elapsed seconds; it gets a small store
on the same public status stream. The API learns to tell a start from a
restart, so the "previous instance stopped" row is there only when it is true.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3.5, Nuxt 4 (`admin`, `app`); NestJS on Bun (`api`)

**Primary Dependencies**: Tailwind CSS 4.2, shadcn-nuxt / reka-ui, Pinia; Inspira UI `MultiStepLoader` vendored as source (MIT, commit `5ea509ce`). No new npm package.

**Storage**: none new. One more value of the existing `Agent.launchContext` field.

**Testing**: `bun test slices` (pure utils, both consoles), `bun run test:scripts` (twin checks), jest (`api`), `npx nuxt typecheck`, Playwright via `playwright-core` scripts under `specs/037-agent-launch-steps/e2e/`

**Target Platform**: browsers, 390 px to 1440 px and wider, light and dark themes

**Project Type**: web application: `api/` + two consoles (`admin/`, `app/`)

**Performance Goals**: list visible within 1 s of the click (SC-002); a stage change shown within 2 s (SC-003); launch time itself unchanged (SC-008)

**Constraints**: steps follow reported state only, never a timer (FR-005); the list lives in the existing overlay and does not cover the composer (FR-012, FR-013); `admin` English only, `app` through `$t` with `en.json` as source; server text shown as received; no Prettier or ESLint over `admin/` or `app/`

**Scale/Scope**: 1 vendored component ×2, 1 pure util ×2, 1 host component per console, 1 new store in `app`, 1 enum value in `api`, 1 twin test, e2e scripts. No new route, no new page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. The slice is the unit | Pass | `agent` slice in all three projects; the vendored component in `setup/theme` (`ui/`), where `app` already keeps its Inspira components. Nothing reaches into another slice's internals: the hub connection comes through the bridle store's public getters, as today |
| II. Twin consoles | Pass | `agent` and `setup` are twin slices and both consoles are changed. The component and the derivation are byte-identical twins under a new `test:scripts` check (R3). The PR states what was checked in each console |
| III. Secrets stay behind `api/` | Pass | No credential. The status stream is already public and carries status facts only (CLEAN-232); `app` reads the same frames `admin` does |
| IV. One entity, one store | Pass | Pod facts get one store per console; the agent's `status` from a frame is patched into the agent store, not copied. The launch view is derived, never stored. The `app` component's local `restarting` / elapsed refs go away |
| V. Console is a window, chat is the hands | Pass, nothing to add | No new capability: start and restart exist and have their tools. This changes how a launch is shown |
| VI. English is the source | Pass | New `launch.*` keys in `app/slices/agent/i18n/locales/en.json`, `ru` by `bun run i18n:sync`; `restart_stage.*` removed. `admin` literals in English |
| VII. A rule stays a rule | Pass | The derivation is a lookup over reported facts. No model call |

Quality gate 4 (numbers carry reasons): the three numbers are in research R8.
The "taking longer" budgets are deliberately unset until measured.

**Post-design re-check**: unchanged. The one thing design added is the API
enum value (R7), which makes the ticket `[ADMIN][APP][API]`; the title and
labels are updated when implementation starts.

## Project Structure

### Documentation (this feature)

```text
specs/037-agent-launch-steps/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── launch-ui.md
├── checklists/
│   └── requirements.md
├── e2e/                 # written during implementation
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
api/src/slices/agent/agent/
├── domain/agentDeploy.service.ts        # launchContext: + 'start'
├── domain/agent.types.ts                # LaunchContextTypes
├── dtos/agent.dto.ts                    # enum in the DTO
└── domain/agentDeploy.service.spec.ts   # initial / start / restart
api/swagger-spec.json                    # regenerated

admin/slices/setup/theme/components/ui/multi-step-loader/
├── MultiStepLoader.vue                  # vendored, twin
└── index.ts
admin/slices/agent/agent/
├── utils/launchSteps.ts                 # twin
├── utils/launchSteps.test.ts
├── components/agent/launch/Steps.vue    # host: facts → steps → loader, wording
├── components/agent/chat/Tab.vue        # overlay renders the host for a launch
├── composables/useAgentLifecycle.ts     # exposes LaunchFacts; overlay carries the launch
└── domain/agent.types.ts                # LaunchContextTypes

app/slices/setup/theme/components/ui/multi-step-loader/
├── MultiStepLoader.vue                  # vendored, twin
└── index.ts
app/slices/agent/
├── utils/launchSteps.ts                 # twin
├── utils/launchSteps.test.ts
├── stores/agentStatus.ts                # new: pod facts off the public stream
├── data/agentStatus.gateway.ts          # new: the EventSource
├── components/agent/launch/Steps.vue    # host, `$t`
├── components/agent/chat/Provider.vue   # overlay: card replaced, elapsed-time code removed
└── i18n/locales/en.json                 # launch.* in, restart_stage.* out

scripts/launch-steps-twin.test.ts        # both twins byte-identical
```

**Structure Decision**: The existing three-project layout. The component sits
in each console's theme `ui/` directory because that is where vendored UI
primitives live and where `app` already keeps five Inspira components; the
launch logic sits in the `agent` slice of each project.

## Order of work

1. **API**: `launchContext` gains `start`; spec; regenerate swagger and both SDKs.
2. **Component**: vendor the upstream file unchanged in one commit, apply the
   R2 additions in the next, so the diff against upstream is readable in
   history. Twin test.
3. **Derivation**: `launchSteps.ts` with its tests, twin.
4. **admin**: host component, overlay wiring.
5. **app**: status store, host component, overlay wiring, i18n.
6. **Checks**: e2e scripts, visual pass at 390 px and 1440 px in both themes.
7. **After merge**: real restart on dev, timings for the slow-step budgets.

Steps 4 and 5 are independent once 2 and 3 are in.

## Risks

- **Local runs have no pods.** Every row is only real on a cluster; locally
  they are shown from scripted frames (R9). The dev check after the merge is
  part of the work, not an extra.
- **`terminating` may not be on the public frame.** Then `stopped` is read from
  the hub connection alone, as `admin` does now (R5). First task settles it.
- **The loader's row height is fixed at 40 px in its scroll maths**, so a row
  with `afterText` or an error line is taller than the scroll step. Upstream
  has the same quirk. If it shows at 390 px, the contained mode measures the
  row instead; that would be a seventh entry in the R2 table and is recorded
  there if it happens.
- **A second EventSource per tab in `app`.** One stream for the whole console,
  ref-counted as in `admin`, opened only while a view that needs it is mounted.

## Complexity Tracking

No violations.
