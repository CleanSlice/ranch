# Tasks: Agent Cost Reduction (Heartbeat & Context Spend)

**Input**: Design documents from `/specs/004-agent-cost-reduction/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the runtime repo has `bun test` with colocated `*.spec.ts` precedent, and plan.md commits to test-first where infrastructure exists.

**Organization**: All code changes land in the sibling `runtime` repository (`../runtime` relative to this repo's root); ranch receives no functional changes. Tasks are grouped by user story from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = skip empty heartbeats, US2 = interval tuning, US3 = prompt caching

## Path Conventions

Cross-repo feature: paths starting with `../runtime/` are in the runtime repo; paths starting with `specs/` are in ranch. Contract references: [heartbeat-actionability.md](contracts/heartbeat-actionability.md), [llm-caching.md](contracts/llm-caching.md).

---

## Phase 1: Setup

**Purpose**: Confirm a green baseline in the runtime repo before touching it

- [X] T001 Run `bun test` in `../runtime` and record the baseline result (all existing specs must pass before changes; if the baseline is red, report and stop)

---

## Phase 2: Foundational

No foundational tasks — the three stories touch disjoint files (`domain/heartbeat.service.ts`, `heartbeat.module.ts`, `claude/claude.repository.ts`) and share no new infrastructure. All stories can start immediately after Phase 1.

**Checkpoint**: Baseline green — user story implementation can begin, in any order or in parallel

---

## Phase 3: User Story 1 - Idle agents stop spending money (Priority: P1) 🎯 MVP

**Goal**: A heartbeat task file that is absent, empty, or template-boilerplate-only produces **no** LLM call, no session write, no usage record; the decision is re-evaluated every tick.

**Independent Test**: quickstart.md scenario 2 — agent with template `HEARTBEAT.md` logs a skip each interval and moves no usage counters; appending a task line activates the next tick without restart.

### Tests for User Story 1

- [X] T002 [US1] Write failing spec `../runtime/src/slices/agent/heartbeat/domain/heartbeat.service.spec.ts` covering the full decision table from contracts/heartbeat-actionability.md: cases 1–9 (absent file, empty/whitespace, unmodified shipped template, headings-only, HTML-comments-only → skip; template+task bullet, bare prose line → run; add/delete between ticks → decision flips at next tick). Test `hasActionableTasks()` as a pure function and `shouldRun()` against a temp agentDir; run `bun test` and confirm the new specs fail

### Implementation for User Story 1

- [X] T003 [US1] Implement in `../runtime/src/slices/agent/heartbeat/domain/heartbeat.service.ts`: exported pure `hasActionableTasks(content: string): boolean` (normalization order per contract: strip HTML comments, `#`-heading lines, whole-line emphasis (`_…_`/`*…*`), the literal `(empty — add reminders or periodic checks here)` placeholder, blank lines; non-empty remainder ⇒ true); change `shouldRun()` to `gateway.exists() && hasActionableTasks(await gateway.load())`; log one info line `no actionable tasks, skipping` on skip. `tick()` and gateway stay unchanged. All T002 specs green
- [X] T004 [P] [US1] Update template `../runtime/.agent.example/HEARTBEAT.md` wording per research.md D6: state that with no tasks listed the agent makes no background LLM calls, and that adding a task enables checks at the configured interval
- [X] T005 [US1] Validate quickstart.md scenario 2 (covered at tick level by heartbeat.service.spec.ts — skip on template, mid-flight activation without restart, stop on delete; live pod-log check rolls into T015) locally (idle agent skips; task added mid-flight activates next tick without restart) and record the observed log lines in the PR description

**Checkpoint**: US1 fully functional — an idle template agent makes zero background calls (SC-001/SC-002)

---

## Phase 4: User Story 2 - Operators tune or disable proactivity per agent (Priority: P2)

**Goal**: Per-agent `heartbeat.intervalMin` is validated (invalid → default 30 with warning); file deletion via existing surfaces stops ticks at the next scheduled check.

**Independent Test**: quickstart.md scenario 3 — `intervalMin: 180` yields `interval=180min` in startup logs; `0`/`-5` yields a warning and `interval=30min`.

### Tests for User Story 2

- [X] T006 [US2] Write failing spec `../runtime/src/slices/agent/heartbeat/heartbeat.module.spec.ts` for interval resolution: valid positive minutes pass through; `0`, negative, `NaN`, `Infinity`, and non-numeric fall back to the 30-minute default (test the exported resolver, not timers); run `bun test` and confirm failure

### Implementation for User Story 2

- [X] T007 [US2] Implement interval validation in `../runtime/src/slices/agent/heartbeat/heartbeat.module.ts`: exported `resolveIntervalMs(candidate: number | undefined): number` guarding non-finite/≤0 → `30 * 60_000` with a warning log; constructor uses it. No changes to `runtime.module.ts` call site (it keeps passing `config.heartbeat.intervalMin * 60_000`). T006 specs green
- [X] T008 [US2] Validate quickstart.md scenario 3 (unit-level: 180 passes through, 0/-5/NaN fall back with warning; deletion-stops-ticks covered by tick spec; live restart check rolls into T015) locally (180 → applied; 0/-5 → warning + fallback 30) and confirm file deletion stops ticks at the next check (case 9 of the contract, via scenario 2 setup)

**Checkpoint**: US1 + US2 both work independently — cadence is a safe per-agent knob (SC-003)

---

## Phase 5: User Story 3 - Repeated context stops being billed at full price (Priority: P3)

**Goal**: Claude requests mark the system prompt with `cache_control: {type: "ephemeral", ttl: "1h"}` (one breakpoint covering tools+system), both client kinds carry the `extended-cache-ttl-2025-04-11` beta flag, cache metrics are logged; degradation is silent and correctness-neutral.

**Independent Test**: quickstart.md scenario 4 — two calls within an hour: first logs `cache_creation_input_tokens > 0`, second logs `cache_read_input_tokens` ≈ prefix size with correspondingly reduced `input_tokens`.

### Tests for User Story 3

- [X] T009 [US3] Write failing spec `../runtime/src/slices/setup/llm/data/repositories/claude/claude.repository.spec.ts` for the request-shaping helpers per contracts/llm-caching.md: system param builder returns `[{type: "text", text, cache_control: {type: "ephemeral", ttl: "1h"}}]` preserving prompt bytes; beta-header builder yields `oauth-2025-04-20,claude-code-20250219,extended-cache-ttl-2025-04-11` for OAuth clients and `extended-cache-ttl-2025-04-11` for the API-key client; run `bun test` and confirm failure

### Implementation for User Story 3

- [X] T010 [US3] Implement caching in `../runtime/src/slices/setup/llm/data/repositories/claude/claude.repository.ts`: extract the tested helpers; use the system content-block array in both `stream()` and `complete()`; add the beta flag to `defaultHeaders` for OAuth clients (append) and the API-key client (new); leave `messages`/`tools`/retry/fallback logic untouched. T009 specs green
- [X] T011 [US3] Add cache observability in `../runtime/src/slices/setup/llm/data/repositories/claude/claude.repository.ts`: read `cache_read_input_tokens`/`cache_creation_input_tokens` from response usage (`message_start`/`message_delta` events in `stream()`, `response.usage` in `complete()`) and include them in the per-call log line (log-only; `ModelUsage` shape unchanged per research.md D5)
- [X] T012 [US3] Validate quickstart.md scenario 4 (live run, claude-haiku-4-5: call 1 `in=11 cache_write=8025 cache_read=0`, call 2 `in=11 cache_write=0 cache_read=8025` — full prefix at 0.1× rate, ≥50% target far exceeded) with a real credential (two calls within an hour; confirm write-then-read pattern and reduced `input_tokens` on the second call) and record the log excerpt in the PR description

**Checkpoint**: All three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 Run the full `../runtime` suite (`bun test`) and confirm no regressions beyond the new specs (channel, cron, session specs stay green)
- [X] T014 Re-read the diff against spec FR-004/FR-008 guardrails: heartbeat behavior for task-bearing agents byte-identical (same prompt, same tick path), non-Anthropic providers untouched; fix any drift found
- [ ] T015 After deploy, verify quickstart.md scenario 5 — **pending deploy** (runtime branch `fix/CLEAN-23-heartbeat-cost`, 3 commits, not yet pushed) in production: idle template agent shows 0 calls/$0 for the day in the ranch Usage panel (agent-only view); task-bearing agents keep scheduled activity; note the D5 caveat (panel cost is a slight lower bound once caching is live)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: empty — no blockers
- **User Stories (Phases 3–5)**: each depends only on Phase 1; they touch disjoint files and are fully independent of each other
- **Polish (Phase 6)**: T013–T014 after all implemented stories; T015 after deploy

### User Story Dependencies

- **US1 (P1)**: independent — `domain/heartbeat.service.ts` (+ spec, template)
- **US2 (P2)**: independent — `heartbeat.module.ts` (+ spec); no file overlap with US1
- **US3 (P3)**: independent — `claude/claude.repository.ts` (+ spec); different slice entirely

### Within Each User Story

- Spec written and failing before implementation (T002→T003, T006→T007, T009→T010)
- Implementation before local validation (T003→T005, T007→T008, T010/T011→T012)

### Parallel Opportunities

- After T001: T002, T006, T009 (three spec files, different slices) can all be written in parallel
- T004 (template wording) is parallel to everything
- The three implementation tracks (T003, T007, T010–T011) run in parallel across different files
- Sequential-solo order if preferred: T001 → US1 → US2 → US3 → Polish

## Parallel Example: kicking off all stories after baseline

```bash
# All three failing specs in parallel (different files):
Task: "T002 heartbeat.service.spec.ts — actionability decision table"
Task: "T006 heartbeat.module.spec.ts — interval resolution"
Task: "T009 claude.repository.spec.ts — cached request shape"

# Then the three implementations in parallel:
Task: "T003 heartbeat.service.ts — hasActionableTasks + shouldRun"
Task: "T007 heartbeat.module.ts — resolveIntervalMs"
Task: "T010 claude.repository.ts — cache_control + beta header"
```

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 baseline → T002 failing specs → T003 implementation → T004 template → T005 validation
2. **STOP and VALIDATE**: an idle template agent makes zero background calls — this alone eliminates ~$60/mo per idle agent and is deployable on its own
3. Ship as the first runtime release if desired

### Incremental Delivery

1. US1 → validate → deploy (MVP — the dominant cost lever)
2. US2 → validate → deploy (safe cadence knob for task-bearing agents)
3. US3 → validate → deploy (per-call price cut for all remaining traffic)
4. T015 production verification closes the loop against SC-001…SC-005

### Notes

- Runtime repo release flow: changes ship with the runtime's own build/deploy; ranch needs no release for this feature
- Commit after each task or logical group; each checkpoint is a valid stopping point
