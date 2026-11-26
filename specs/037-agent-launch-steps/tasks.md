---
description: "Task list for agent launch steps (CLEAN-247)"
---

# Tasks: Agent launch steps

**Input**: Design documents from `/specs/037-agent-launch-steps/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/launch-ui.md, quickstart.md

**Tests**: Included. The plan names three layers (research R9): unit tests on the derivation, a twin check, and Playwright scripts.

**Organization**: By user story. Every story changes both consoles; a story is not done in one console alone (constitution II).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves
- Paths are from the repository root

## Phase 1: Setup

**Purpose**: a working tree where the gates run

- [X] T001 Work on branch `feat/CLEAN-247-agent-launch-steps`, rebased on current `origin/main`; set the CLEAN-247 title and labels to `[ADMIN][APP][API]`; point `.specify/feature.json` at `specs/037-agent-launch-steps`
- [X] T002 Bring the tree up per quickstart §1: `bun install`, `cd api && bun run generate && bun run build`, `npx nuxt prepare` in `admin/` and `app/`; confirm `bun test slices` passes in both consoles before any change

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the component, the derivation and the facts both consoles need

### What the facts really are

- [X] T003 Read `toStatusFrameMessage` in `api/src/slices/agent/agent/` and record in `specs/037-agent-launch-steps/research.md` R5 whether the public frame carries `terminating`; if not, `stopped` is read from the hub connection alone
- [X] T004 Confirm in `api/prisma/schema.prisma` that `lastLaunchContext` is a string column (no migration for a new value); record the answer in `data-model.md`

### API: start is not restart (research R7)

- [X] T005 Add the failing cases to `api/src/slices/agent/agent/domain/agentDeploy.service.spec.ts`: never deployed → `initial`; status `stopped` or `failed` before the launch → `start`; any other status → `restart`
- [X] T006 Add `start` to `LaunchContextTypes` in `api/src/slices/agent/agent/domain/agent.types.ts` and to the enum in `api/src/slices/agent/agent/dtos/agent.dto.ts`; derive it in `api/src/slices/agent/agent/domain/agentDeploy.service.ts` from the status read before `markDeployStarted`
- [X] T007 Regenerate: `cd api && bun run build` (rewrites `api/swagger-spec.json`), then `bun run build:api` in `admin/` and `app/`; keep only the `launchContext` change in the generated files; widen `LaunchContextTypes` and `toLaunchContext` in `admin/slices/agent/agent/domain/agent.types.ts` and `admin/slices/agent/agent/data/agent.mapper.ts`, and the same type in `app/slices/agent/domain/`

### The component (research R1, R2)

- [X] T008 Vendor upstream `MultiStepLoader.vue` and `index.ts` unchanged (inspira-ui commit `5ea509ce`) into `admin/slices/setup/theme/components/ui/multi-step-loader/` and `app/slices/setup/theme/components/ui/multi-step-loader/`, with a header comment naming the source, commit and licence; commit on its own so the next diff is readable
- [X] T009 Apply the six additions of research R2 to both copies, identically: `contained` prop, theme tokens, `Step.error`, `footer` slot, live region and `motion-reduce`, `cn` from `#theme/utils`; add `data-launch-step` and `data-step-state` on each row (contracts §4)
- [X] T010 [P] Write `scripts/launch-steps-twin.test.ts`: `MultiStepLoader.vue` and `launchSteps.ts` are byte-identical between `admin/` and `app/`; it fails until T012 lands

### The derivation (research R5, data-model Rules)

- [X] T011 [P] Write `admin/slices/agent/agent/utils/launchSteps.test.ts` first, failing: every row of the R5 table, a skipped stage, monotone progress, `stopped` only for `restart`, failure pinned on each step, `stopped` status is not a failure, tools connecting keeps `ready` current, a new launch starts over
- [X] T012 Implement `deriveLaunch(facts): LaunchView` in `admin/slices/agent/agent/utils/launchSteps.ts` (pure: no Vue, no alias, no clock, no text); copy the file and its test to `app/slices/agent/utils/`; T010 and T011 pass

### Live facts in `app` (research R6)

- [X] T013 Add `app/slices/agent/data/agentStatus.gateway.ts` (the `EventSource` on `/agents/status/stream`) and `app/slices/agent/stores/agentStatus.ts`: pod facts and hub connection per agent, `connectionState`, ref-counted `connect` / `disconnect`; a frame's `status` is patched into the agent store through `patch()`, never copied (docs/state.md)
- [X] T014 [P] Unit-test the frame handling of T013 in `app/slices/agent/utils/` on the pure part (frame → pod facts, unknown agent ignored)

**Checkpoint**: `bun test slices` in both consoles, `bun run test:scripts`, `npx jest agentDeploy` in `api/`, `npx nuxt typecheck` in both consoles: all green. Checkpoint comment on CLEAN-247.

---

## Phase 3: User Story 1 - Watch a restart step by step (P1) 🎯 MVP

**Goal**: a restart shows the six rows ticking off from real state, in both consoles

**Independent Test**: restart a running agent; rows complete in order, the last when the chat is usable; the overlay then clears

- [X] T015 [US1] Write `specs/037-agent-launch-steps/e2e/lib.mjs` (login, seed, a scripted `EventSource` installed with `addInitScript`, helpers for `data-launch-step` / `data-step-state`, console-error and failed-request guards) and `e2e/restart.mjs`: the restart scenario and the reload-mid-launch scenario of quickstart §4, both consoles; it fails now
- [X] T016 [P] [US1] Create `admin/slices/agent/agent/components/agent/launch/Steps.vue`: takes `LaunchFacts`, calls `deriveLaunch`, maps steps to the loader's `Step` (`async` on the current row, 250 ms catch-up, English wording table of contracts §5), mounts the loader `contained` with `preventClose`, raises `loading` in `onMounted`, re-keys on a new launch, holds the completed list 1200 ms; sets `data-launch`
- [X] T017 [US1] In `admin/slices/agent/agent/composables/useAgentLifecycle.ts` expose the `LaunchFacts` for the agent and carry them on the `starting` overlay; in `admin/slices/agent/agent/components/agent/chat/Tab.vue` render `AgentLaunchSteps` for `overlay.kind === 'starting'` in place of the spinner and two lines
- [X] T018 [P] [US1] Create `app/slices/agent/components/agent/launch/Steps.vue`, the same host with wording through `$t`; add the `launch.*` keys to `app/slices/agent/i18n/locales/en.json` and run `bun run i18n:sync`
- [X] T019 [US1] In `app/slices/agent/components/agent/chat/Provider.vue` build `LaunchFacts` from the agent store, the new status store and the bridle store; replace the overlay card with `AgentLaunchSteps`; add `data-chat-overlay`; delete the elapsed-time code (`elapsedSec`, `overlayStage`, `restartStartedAt`, the progress-bar style) and the `restart_stage.*` and `chat.elapsed` keys
- [X] T020 [US1] Run `e2e/restart.mjs`; fix until green in both consoles

**Checkpoint**: restart works end to end in both consoles. Checkpoint comment on CLEAN-247.

---

## Phase 4: User Story 2 - Watch a start step by step (P1)

**Goal**: first start and start-after-stop show the list without the `stopped` row, with their own heading

**Independent Test**: start a stopped agent and create a new one; five rows, `data-launch` is `start` / `initial`

- [X] T021 [US2] Write `specs/037-agent-launch-steps/e2e/start.mjs`: start of a stopped agent, first start, and a viewer who did not press the button; fails now
- [X] T022 [P] [US2] `admin`: take `kind` from `agent.launchContext`, and from the button pressed until the server answers, in `useAgentLifecycle.ts`; headings for `initial` / `start` / `restart` in `launch/Steps.vue`; keep `AgentLogsBar`'s `first-start` line consistent with the heading
- [X] T023 [P] [US2] `app`: the same in `chat/Provider.vue` and `launch/Steps.vue`; make the agent sheet's start (`app/slices/agent/composables/useAgentControls.ts`) raise the same overlay state as the chat header's restart
- [X] T024 [US2] Run `e2e/start.mjs`; fix until green in both consoles

---

## Phase 5: User Story 3 - See where a launch failed or stalled (P2)

**Goal**: a failed launch stops on its step with the reason and a way forward; a silent stream says so

**Independent Test**: scripted `ImagePullBackOff` then `failed`; the `container` row is failed with the reason as received; retry starts over

- [X] T025 [US3] Write `specs/037-agent-launch-steps/e2e/failure.mjs`: failure on `container`, retry, logs, a plain user sees no retry, stream drop and recovery, stop during launch, second restart mid-launch; fails now
- [X] T026 [P] [US3] `admin`: when a launch ends in `failed`, keep `AgentLaunchSteps` in the overlay with `error` on the pinned step (`statusReason`, else `containerWaitingReason`, as received) and put Restart and a logs action in the `footer` slot gated by `canManage`; the `failed` overlay outside a launch keeps its markup
- [X] T027 [P] [US3] `app`: the same in `chat/Provider.vue` and `launch/Steps.vue`; today the overlay disappears on `failed`, so keep it up for a failure that ended a launch; the reason is never passed through `$t`
- [X] T028 [US3] Both hosts: `data-launch-stale` and a one-line notice while the status stream is not connected, cleared when frames resume
- [X] T029 [US3] Run `e2e/failure.mjs`; fix until green in both consoles

**Checkpoint**: checkpoint comment on CLEAN-247.

---

## Phase 6: User Story 4 - The loader belongs to each console (P2)

**Goal**: native in both themes, at both widths, in Russian, with reduced motion

**Independent Test**: screenshots of a mid-launch list in each console × light/dark × 390/1440

- [X] T030 [US4] Write `specs/037-agent-launch-steps/e2e/look.mjs`: screenshots to the scratchpad for the eight combinations, no horizontal scroll and no clipped row at 390 px, Russian in `app` with an untranslated failure reason, `reducedMotion: 'reduce'`
- [X] T031 [US4] Tune the `contained` sizing in both copies of `MultiStepLoader.vue` until T030 passes; if a row with an error line breaks the 40 px scroll step, measure the row instead and record it as a seventh entry in research R2
- [X] T032 [US4] Look at every screenshot of T030; list on CLEAN-247 what differs from the surrounding interface, fix, repeat

---

## Phase 7: User Story 5 - The loader lives in the existing overlay (P3)

**Goal**: same place, same moments, nothing else blocked

**Independent Test**: overlay box equals today's; the composer accepts a message during a launch

- [X] T033 [US5] Write `specs/037-agent-launch-steps/e2e/overlay.mjs`: the overlay's box matches the message area and never covers the composer; a message typed during a launch is queued and sent; navigating away and back keeps the current step; the `stopped` and `tools` overlays outside a launch are unchanged
- [X] T034 [US5] Fix whatever T033 finds in `admin/.../chat/Tab.vue` and `app/.../chat/Provider.vue`

---

## Phase 8: Polish & checks

- [X] T035 [P] `specs/037-agent-launch-steps/e2e/all.mjs` running every script; add the real, unmocked restart of quickstart §4
- [X] T036 All gates of quickstart §2, and `bun run locale:check`; name the commands in the PR
- [X] T037 Twin statement for the PR: which console was checked for what, and that the two twin files are identical under `test:scripts`
- [X] T038 [P] Add one line on the launch overlay and the vendored component to `docs/state.md` (the new `app` status store) and wherever Inspira components are listed, if they are
- [X] T039 Commit with `CLEAN-247`, bump the root `package.json` version (no bump, no release tag), open the PR into `main`, put its URL on the ticket, move the ticket to review
- [ ] T040 After CI is green: merge as the DREAM account, watch `Release Platform`, confirm the tag exists
- [ ] T041 After the rollout: restart one agent on dev and compare the rows with the pod's real transitions; time 10 restarts and 10 starts, set each step's "taking longer" budget to twice its p95 in both hosts (research R8), ship that as a follow-up commit under CLEAN-247; then close the ticket with the release tag

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** → stories. Nothing in Phase 3+ starts before the Phase 2 checkpoint.
- Inside Phase 2: T005 → T006 → T007; T008 → T009; T011 → T012; T010 passes only after T009 and T012; T013 is independent of the component.
- **US1** is the MVP and the base: US2, US3, US4 and US5 all extend the two host components it creates.
- **US2** and **US3** can run in parallel after US1. **US4** needs US3 (it screenshots a failed row). **US5** can run any time after US1.
- T041 depends on the release being rolled out; a check before that runs against the old image.

### Parallel opportunities

- T010, T011 and T013 while the API work (T005 to T007) is in progress.
- Within each story the `admin` and `app` tasks marked [P] touch different trees.

```bash
# After T015, the two hosts of US1:
Task: "T016 admin launch/Steps.vue"
Task: "T018 app launch/Steps.vue + en.json"
```

## Implementation Strategy

1. Phases 1 and 2, then stop at the checkpoint and run every gate.
2. US1 in both consoles: this alone already replaces the spinner for the commonest case and removes the elapsed-time guess from `app`.
3. US2, US3, then US4 and US5.
4. Phase 8. The work is not finished at the merge: T041 is where the pod-by-pod rows are seen for real for the first time.
