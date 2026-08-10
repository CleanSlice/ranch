# Contract: Heartbeat Skip Decision

**Consumer**: `HeartbeatModule.run()` (timer) → `HeartbeatService.tick()`
**Provider**: `HeartbeatService.shouldRun()` + pure predicate `hasActionableTasks(content)`

## Interface

```
HeartbeatService.shouldRun(): Promise<boolean>
  true  ⇢ heartbeat file exists AND has actionable content → handler runs (LLM loop)
  false ⇢ tick is a no-op: no LLM call, no session write, no usage record

hasActionableTasks(content: string): boolean   // pure, exported for tests
```

`tick(prompt, handler)` semantics: `if (!await shouldRun()) return` — unchanged call order, decision re-evaluated on every tick (never memoized).

## Actionability decision table

| # | File state / content | shouldRun | Covers |
|---|---|---|---|
| 1 | File absent | false | FR-001 (existing) |
| 2 | Empty file / whitespace only | false | FR-002 |
| 3 | Unmodified shipped template (headings + `_Add periodic tasks here…_` + `(empty — add reminders or periodic checks here)`) | false | FR-002 — the fleet default |
| 4 | Headings and blank lines only | false | FR-002 |
| 5 | HTML comments only | false | FR-002 |
| 6 | Template + one task bullet (`- check inbox daily`) | true | FR-004 |
| 7 | Prose instruction, no markdown structure | true | FR-004 — conservative: any non-boilerplate line is actionable |
| 8 | Task added between ticks | true at next tick | FR-003 |
| 9 | File deleted between ticks | false at next tick | FR-003/FR-006 |

Normalization strips, in order: HTML comments, `#`-heading lines, emphasis-only lines (`_…_` / `*…*` whole-line), the literal placeholder `(empty — add reminders or periodic checks here)`, blank lines. Non-empty remainder ⇒ actionable. When in doubt the predicate must err toward `true` (running costs money once; silently disabling a real task loses user trust).

## Interval contract

`HeartbeatModule(agentDir, intervalMs, prompt?)`: if `intervalMs` is non-finite or ≤ 0, the module uses the default (30 min) and logs a warning. Source of the value: `agent.config.json → heartbeat.intervalMin` (existing per-agent config, default 30).

## Observability

Each skipped tick logs one debug/info line (`heartbeat: no actionable tasks, skipping`) — enough to verify SC-001 from pod logs without adding usage noise.
