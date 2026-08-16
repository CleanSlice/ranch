# Tasks: Agent Thinking Shimmer & Extended Thinking Display

**Input**: Design documents from `/specs/005-shimmer-thinking-ui/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Not requested — repos have typecheck-only gates; validation is scenario-driven via [quickstart.md](./quickstart.md) checkpoints.

**Organization**: Tasks are grouped by user story. Feature spans three working copies: `~/my-knowledge/bridle` (SDK + canonical types + standalone hub), `~/my-knowledge/runtime` (agent loop), `~/my-knowledge/ranch` (production hub + admin, this repo). Paths below are repo-relative with the repo name prefixed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = shimmer status (P1), US2 = extended thinking timeline (P2), US3 = admin parity (P3)

## Phase 1: Setup

**Purpose**: Working branches across the three repos (ranch branch `feat/CLEAN-10-shimmer-thinking` already exists)

- [X] T001 Create branch `feat/CLEAN-10-shimmer-thinking` from up-to-date main in `bridle/` and `runtime/` repos (`git fetch origin main && git checkout -b feat/CLEAN-10-shimmer-thinking origin/main` in each)

---

## Phase 2: Foundational (Blocking Prerequisites)

**No foundational tasks.** US1 needs zero protocol changes (research D4 reuses the existing `typing` event), so nothing blocks all stories. The wire-protocol foundation for the timeline lives inside US2 (T008–T013) and blocks only US2/US3's timeline rendering.

**Checkpoint**: US1 can start immediately after T001.

---

## Phase 3: User Story 1 - Shimmering "thinking" status while the agent works (Priority: P1) 🎯 MVP

**Goal**: Rovo-style shimmering `«{title}» is thinking…` status line replaces the three dots and covers the entire generation window, including tool-only phases that today show nothing.

**Independent Test**: quickstart.md Scenario 1 — send a tool-using message on the example page; shimmer appears ≤1 s, persists through tool phases, is replaced by the first answer tokens without flicker; reduced-motion shows static text.

### Implementation for User Story 1

- [X] T002 [US1] Add optional `sendTyping?(to: string): Promise<void>` to `IChannelGateway` in `runtime/src/slices/setup/channel/domain/channel.gateway.ts` and route it through `channel.service.ts` (no-op for channels that don't implement it, mirroring the `streamSend?` pattern)
- [X] T003 [US1] Implement `sendTyping` in `runtime/src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts` — emit the existing `typing` event (`{ clientId, ts }`) on the agent socket
- [X] T004 [US1] Emit typing at turn start in `runtime/src/slices/runtime/loop/domain/loop.service.ts`: call `sendTyping` once before the first `callLlm` iteration, only for external turns (`!ctx.isInternal` — heartbeat/internal turns must stay silent); expose it on `ILoopContext` in `loop.types.ts`
- [X] T005 [P] [US1] Replace the dots block with the shimmer status line in `bridle/sdk/src/BridleChat.ce.vue`: `.bridle__thinking` header per [contracts/widget-thinking-ui.md](./contracts/widget-thinking-ui.md) — status text from existing `title` prop, shown on `typing`, cleared by first `stream`/`message` text; keep the greeting-delay flow (`maybeShowGreeting`) working. Include the stale-shimmer guard (analyze finding I1) at this level too: hide/de-animate the status line after ~75 s without `typing`/`thinking`/`stream` events or on the client `close` event, so a cancelled turn never leaves an infinite shimmer even in an MVP-only (US1) release
- [X] T006 [US1] Add shimmer CSS + accessibility in `bridle/sdk/src/BridleChat.ce.vue`: gradient sweep via `background-clip: text` on `--bridle-*` tokens (both color modes), `@media (prefers-reduced-motion: reduce)` fallback, `role="status"` + `aria-label`; remove obsolete `.bridle__typing` dots styles
- [ ] T007 [US1] Checkpoint: run quickstart.md Scenario 1 end-to-end (local hub + runtime + example page) and the SDK gates (`bun run typecheck && bun run build` in `bridle/sdk`)

**Checkpoint**: Story 1 fully functional — deployable improvement on its own (also upgrades old-SDK behavior via early `typing`).

---

## Phase 4: User Story 2 - Extended thinking: named steps with expandable detail (Priority: P2)

**Goal**: Live Rovo-style timeline of named, expandable steps published by the runtime per tool call, auto-collapsing to a summary row when the answer completes.

**Independent Test**: quickstart.md Scenario 2 — tool-using message shows live collapsed steps (active ≠ done styling), details expand/collapse, block freezes + collapses on completion and re-expands; no-tool answers show no empty timeline. Scenario 3 confirms old hub/SDK combos degrade to Story 1.

### Wire protocol foundation (blocks T014–T017)

- [X] T008 [US2] Add canonical thinking types to `bridle/nestjs/domain/bridle.types.ts`: `IBridleThinkingStep`, `IBridleThinkingEvent`, add `'thinking'` to `IBridleOutgoingEvent.type` union — fields per [data-model.md](./data-model.md)
- [X] T009 [P] [US2] Whitelist the event in the standalone hub: `@SubscribeMessage('thinking')` → `gateway.handleAgentEvent` in `bridle/nestjs/handlers/bridleAgentWs.handler.ts`
- [X] T010 [P] [US2] Production hub mirror in this repo: add thinking types to `api/src/slices/bridle/domain/bridle.types.ts` and `@SubscribeMessage('thinking')` → `handleAgentEvent` in `api/src/slices/bridle/handlers/bridleAgentWs.handler.ts`
- [X] T011 [P] [US2] SDK types mirror in `bridle/sdk/src/types.ts`: `IBridleThinkingStep`, `IBridleThinkingEvent`, client-side `IThinkingBlock`, `IBridleMessage.thinking?: IThinkingBlock`
- [X] T012 [US2] SDK client in `bridle/sdk/src/client.ts`: add `'thinking'` to the `capabilities` handshake array, `socket.on('thinking', …)`, and a typed `on('thinking', handler)` overload
- [X] T013 [P] [US2] Agent-side lib helper: `sendThinking(to, event)` emit in `bridle/runtime/bridle.repository.ts` (no-op when socket offline, same guard as `emitDebug`)

### Runtime emission

- [X] T014 [US2] Thread thinking through the runtime channel slice: optional `sendThinking?` on `IChannelGateway` (`runtime/src/slices/setup/channel/domain/channel.gateway.ts`), routing in `channel.service.ts`, capability-gated implementation in `data/repositories/bridle/bridle.repository.ts` (emit only when the triggering message's `capabilities` includes `'thinking'` — research D6), and `sendThinking` on `ILoopContext` in `runtime/src/slices/runtime/loop/domain/loop.types.ts`
- [X] T015 [US2] Emit steps from the loop in `runtime/src/slices/runtime/loop/domain/loop.service.ts`: mint `turnId` per run; per tool call emit `state:'active'` before execution and `state:'done'` (same step `id`) after; `label` = humanized tool name; `detail` = interleaved `response.text` attached to the iteration's first step; never include raw tool params (FR-008, research D3)

### Widget rendering

- [X] T016 [US2] Thinking block state in `bridle/sdk/src/BridleChat.ce.vue`: handle `client.on('thinking')` — open block on first event, append/update steps by `id`, freeze + attach to the assistant message on `stream_end`/`message` (`m.thinking`), auto-collapse, ignore stragglers by `turnId` ([data-model.md](./data-model.md) state transitions). **Stale-block guard (analyze finding I1)**: also freeze the open block into a non-animated `done` state (steps forced `done`, shimmer off) when (a) an inactivity timeout fires — no `typing`/`thinking`/`stream` event for the open turn within ~75 s, reset on every event — or (b) the existing client `close` event fires (socket disconnect); covers cancelled runtime turns (`task.controller.signal.aborted` breaks the loop without emitting `stream_end`/`message`) so the spec's "no infinite shimmer" edge case is fully closed without protocol changes
- [X] T017 [US2] Timeline UI in `bridle/sdk/src/BridleChat.ce.vue`: `.bridle__thinking-steps` vertical-rule timeline, per-step chevrons (`<button>` + `aria-expanded`, details via existing `renderMarkdown`), `--active` styling, post-completion summary row per [contracts/widget-thinking-ui.md](./contracts/widget-thinking-ui.md); scroll must not jump on expand (existing auto-follow rules)
- [ ] T018 [US2] Checkpoint: run quickstart.md Scenarios 2 + 3 (including old-hub/old-SDK degradation matrix) and repo gates (`bun run typecheck && bun run build` in `bridle/sdk`; `npx tsc --noEmit` in `runtime` and `ranch/api`)

**Checkpoint**: Stories 1+2 complete on the visitor widget — full CLEAN-10 experience on the product surface.

---

## Phase 5: User Story 3 - Same thinking experience in the admin agent preview (Priority: P3)

**Goal**: Operators see identical shimmer + timeline behavior in the admin chat preview (own Pinia store + Tailwind components, not the SDK).

**Independent Test**: quickstart.md Scenario 5 — agent chat preview in ranch admin shows shimmer and live timeline; DebugPanel unchanged.

### Implementation for User Story 3

- [X] T019 [US3] Handle `thinking` in the admin store `admin/slices/bridle/stores/bridle.ts` (this repo): subscribe to the socket event, add `'thinking'` to the connect `capabilities`, maintain block/steps state mirroring [data-model.md](./data-model.md) (freeze on `stream_end`/`message`)
- [X] T020 [US3] Render shimmer + timeline in `admin/slices/bridle/components/bridle/Provider.vue` (status line replacing the `animate-bounce` dots) and `admin/slices/bridle/components/bridle/Message.vue` (collapsed thinking summary on completed messages) using Tailwind + local keyframes, reduced-motion respected
- [X] T021 [US3] Checkpoint: run quickstart.md Scenario 5 against a local/dev agent; `npx tsc --noEmit` typecheck for touched admin code per repo practice

**Checkpoint**: All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 [P] Document the `thinking` event and turn sequencing in `bridle/docs/docs/protocol/streaming.md` (mirror [contracts/thinking-event.md](./contracts/thinking-event.md), including the compatibility matrix and capability token)
- [X] T023 [P] Bump `@cleanslice/bridle` to 0.15.0 in `bridle/sdk/package.json` (new capability + API surface; actual release happens via the `sdk-v*` tag flow — tagging is a separate, user-approved step)
- [X] T024 Run all static gates across repos: `bun run typecheck && bun run build` in `bridle/sdk`, `npx tsc --noEmit` in `runtime` and `ranch/api`
- [ ] T025 Full quickstart.md validation: Scenario 4 (themes × color modes, reduced motion, screen-reader tree) plus the sign-off checklist — including the SC-002 side-by-side style comparison with the Rovo reference

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 only — blocks everything in `bridle`/`runtime` repos
- **Foundational (Phase 2)**: empty — US1 starts right after T001
- **US1 (Phase 3)**: independent of US2/US3
- **US2 (Phase 4)**: wire foundation T008 → {T009, T010, T011, T013}; T011 → T012; {T008} → T014 → T015; {T011, T012} → T016 → T017. Widget tasks T016–T017 also build on US1's T005–T006 (same SFC, status line hosts the timeline)
- **US3 (Phase 5)**: needs T010 (hub relay) + T015 (runtime emission) live to test; code tasks T019–T020 can be written in parallel with US2's widget tasks
- **Polish (Phase 6)**: after desired stories complete

### User Story Dependencies

- **US1 (P1)**: none — MVP
- **US2 (P2)**: layers on US1's widget status line; independently testable via Scenario 2
- **US3 (P3)**: consumes US2's wire event; shimmer part reproducible with US1 only if delivered early

### Parallel Opportunities

- T005 (SDK widget) ∥ T002–T004 (runtime) — different repos
- After T008: T009 ∥ T010 ∥ T011 ∥ T013 — four different files/repos
- T014–T015 (runtime) ∥ T016–T017 (SDK widget) — different repos, joined only at Scenario 2
- T019–T020 (ranch admin) ∥ any US2 widget work
- T022 ∥ T023 in Polish

## Parallel Example: User Story 2 wire foundation

```bash
# After T008 lands in bridle/nestjs/domain/bridle.types.ts, launch together:
Task: "T009 whitelist 'thinking' in bridle/nestjs/handlers/bridleAgentWs.handler.ts"
Task: "T010 mirror types + whitelist in ranch api/src/slices/bridle/"
Task: "T011 SDK types mirror in bridle/sdk/src/types.ts"
Task: "T013 sendThinking helper in bridle/runtime/bridle.repository.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 branches → T002–T006 (runtime typing + widget shimmer in parallel) → T007 validate
2. **STOP and VALIDATE**: Scenario 1 — this alone closes the "dead air" problem and is shippable (safe with old hubs per the compatibility matrix)

### Incremental Delivery

1. US1 → validate → ship (SDK release + runtime deploy; hubs untouched)
2. US2 → hubs first (T009/T010 deploy), then runtime, then SDK release (research D8 order) → validate Scenarios 2–3 → ship
3. US3 → admin deploy → validate Scenario 5
4. Polish → docs + version bump + full sign-off (SC-002 style approval)

## Notes

- The two `bridle.repository.ts` files are different artifacts: `bridle/runtime/` is the published agent-side lib, `runtime/src/.../data/repositories/bridle/` is the runtime's own channel implementation — both get their respective thinking/typing emitters (T013 vs T003/T014)
- Widget tasks touch one large SFC (`BridleChat.ce.vue`) — keep US1/US2 widget commits separate for reviewability
- Commit after each task or logical group; each checkpoint is a demoable increment

---

## Implementation status (2026-08-14)

All code tasks are implemented and committed on `feat/CLEAN-10-shimmer-thinking` in all three repos; static gates are green (bridle sdk `vue-tsc` + `vite build`, runtime `tsc --noEmit` + 116 bun tests, ranch api `tsc --noEmit`, admin store scratch-tsconfig check). T021's typecheck half is done — its live-agent half rides on T025.

**T025 remains open**: the browser scenarios of quickstart.md (1–5) need a running hub + LLM-configured agent and human eyes — including the SC-002 side-by-side style sign-off vs the Rovo reference. Checkpoint tasks T007/T018 were completed at their static-gate level; their browser halves are covered by the same T025 run.

Implementation deviations from the original task wording (design docs updated to match): a terminal `thinking {done:true}` event closes the block instead of `stream_end` (mid-turn bubbles made that unsafe); thinking blocks are standalone in-flow chat items rather than `IBridleMessage.thinking`; the capability gate lives at the loop-context wiring (`runtime.service.ts`) rather than inside the bridle repository; admin `Message.vue` needed no changes (blocks render in `Provider.vue`'s flow); `typing` is additionally re-emitted before each tool batch so US1 covers tool phases even mid-turn.
