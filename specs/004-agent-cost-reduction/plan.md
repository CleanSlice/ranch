# Implementation Plan: Agent Cost Reduction (Heartbeat & Context Spend)

**Branch**: `fix/CLEAN-23-Heartbeat-cost` (feature dir `004-agent-cost-reduction`) | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-agent-cost-reduction/spec.md`

## Summary

Idle agents burn ~$2/day (~$60/mo) each on scheduled heartbeat check-ins that re-send ~24.6k tokens of context to the LLM and get "nothing to do" back, because the platform triggers a check-in whenever `HEARTBEAT.md` merely *exists* — and the agent template ships it empty. The fix has three independent parts, all landing in the **runtime repository** (`../runtime`, cross-repo precedent: feature 003):

1. **Skip empty heartbeats (P1)**: `HeartbeatService.shouldRun()` gains a deterministic "has actionable tasks" content check — absent, empty, or template-boilerplate-only task files skip the LLM call entirely. Re-evaluated every tick, so edits take effect without restart.
2. **Interval hygiene (P2)**: the per-agent `heartbeat.intervalMin` config already exists; add validation (zero/negative/NaN → fall back to default 30) and document the knob. No new config surface.
3. **Prompt caching (P3)**: `ClaudeRepository.stream()/complete()` send the system prompt as a content block with `cache_control: {type: "ephemeral", ttl: "1h"}`, so the stable prefix (tools + system prompt) bills at ~0.1× on repeated calls. Cache metrics are logged for verification; no ranch schema changes.

Ranch repo hosts the spec and receives no functional changes (skipped ticks produce no usage records by construction — no call, no `usage.add`).

## Technical Context

**Language/Version**: TypeScript on Bun (runtime repo); no ranch code changes

**Primary Dependencies**: `@anthropic-ai/sdk` 0.79.0 (already in runtime); no new dependencies

**Storage**: Agent-local files (`{agentDir}/HEARTBEAT.md`, `agent.config.json`); S3 sync unchanged; no DB changes

**Testing**: `bun test` — colocated `*.spec.ts` (existing precedent: channel, cron, session slices)

**Target Platform**: Agent runtime pods (Linux, Bun); single-agent (`index.ts`) and multi-agent (`multi.ts`) entrypoints both flow through `AgentRuntime` → shared fix point

**Project Type**: Cross-repo feature — runtime (behavior) + ranch (spec home, no code)

**Performance Goals**: Idle agent = 0 background LLM calls/day (baseline ~48); cached calls bill prefix at ~0.1× input rate

**Constraints**: Skip check must be deterministic and free (no LLM involvement); caching must never affect correctness (graceful degradation to full price); heartbeat behavior for agents *with* tasks must be byte-for-byte unchanged

**Scale/Scope**: All deployed agents; 3 touched runtime slices (`agent/heartbeat`, `setup/llm/.../claude`, `.agent.example` template)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific gates are defined. Applying general engineering defaults instead: test-first where infrastructure exists (runtime has `bun test` — used), no new projects/dependencies introduced, smallest change that satisfies the spec. **PASS** (pre-Phase-0 and re-checked post-Phase-1 — design adds no projects, no dependencies, no schema changes).

## Project Structure

### Documentation (this feature)

```text
specs/004-agent-cost-reduction/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── heartbeat-actionability.md   # Skip-decision contract
│   └── llm-caching.md               # Cached-request contract
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

This feature spans two sibling repositories; the spec lives in `ranch`, all code changes land in `runtime` (precedent: feature 003 telegram-restart-recovery).

```text
../runtime/                                # behavior changes
├── src/slices/agent/heartbeat/
│   ├── heartbeat.module.ts                # interval validation (fallback on invalid values)
│   ├── domain/heartbeat.service.ts        # shouldRun(): exists → exists && hasActionableTasks
│   ├── domain/heartbeat.service.spec.ts   # NEW — actionability + skip tests
│   └── data/heartbeat.gateway.ts          # load() already exists; exists() unchanged
├── src/slices/setup/llm/data/repositories/claude/
│   ├── claude.repository.ts               # system prompt → content block with cache_control (1h TTL);
│   │                                      # beta header extended-cache-ttl-2025-04-11; cache metrics in logs/usage
│   └── claude.repository.spec.ts          # NEW — request-shape tests (system block, header)
└── .agent.example/HEARTBEAT.md            # template wording: "no tasks = no background calls"

ranch/                                     # this repo — no functional changes
└── specs/004-agent-cost-reduction/        # feature documentation (this directory)
```

**Structure Decision**: Both repos keep their existing slice layouts; no new directories. The heartbeat skip is implemented in the domain service (`heartbeat.service.ts`) so the module/timer wiring and both entrypoints (`index.ts`, `multi.ts`) are untouched. Caching is confined to the Claude repository — other providers (`google`, `openai-compat`, `claudecli`) are out of scope per spec FR-008 (graceful non-support).

## Complexity Tracking

No constitution violations — table not applicable.
