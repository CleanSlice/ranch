# Data Model: Agent Cost Reduction

**Feature**: 004-agent-cost-reduction | **Date**: 2026-08-10

No database entities change. The feature operates on agent-local files and in-flight request/usage shapes.

## Heartbeat task file (`{agentDir}/HEARTBEAT.md`)

Per-agent markdown document listing periodic tasks. Synced to/from S3 with the rest of the agent directory; editable through the ranch admin file surface.

| Aspect | Rule |
|---|---|
| Existence | Absent → heartbeat skipped (FR-001, existing behavior kept) |
| Actionability | Present but normalized content empty → skipped (FR-002, new) |
| Normalization | Strip: `#`-heading lines, emphasis-only template lines, the literal `(empty — add reminders or periodic checks here)` placeholder, HTML comments, blank lines. Anything remaining ⇒ actionable |
| Evaluation | Re-read on every tick; no caching of the decision (FR-003) |

State transitions (evaluated per tick, never persisted):

```
absent ──create with tasks──▶ actionable ──edit to boilerplate-only──▶ inert
inert (empty/template) ──add task line──▶ actionable
actionable ──delete file──▶ absent
```

`actionable` → tick runs the LLM loop (unchanged path). `absent`/`inert` → tick returns before any LLM/session/usage side effect.

## Agent configuration (`agent.config.json → heartbeat`)

| Field | Type | Default | Validation (new) |
|---|---|---|---|
| `heartbeat.intervalMin` | number | 30 | Non-finite or ≤ 0 → fall back to 30 with a warning log; takes effect at agent restart |

## LLM request shape (Claude repository, in-flight only)

| Field | Before | After |
|---|---|---|
| `system` | plain string | `[{type: "text", text, cache_control: {type: "ephemeral", ttl: "1h"}}]` |
| client `defaultHeaders.anthropic-beta` | `oauth-2025-04-20,claude-code-20250219` (OAuth only) | + `extended-cache-ttl-2025-04-11` (OAuth and API-key clients) |
| `messages`, `tools`, `model`, `max_tokens` | — | unchanged |

## Model usage (runtime, in-memory + `data/usage.json`)

Existing shape unchanged: `{date, totalInputTokens, totalOutputTokens, totalCallCount, byCredential, byModel, reportedAt}`. Semantics of one field change (research.md D5, amended):

- `inputTokens` is **billing-equivalent**: `round(input + 0.1 × cache_read + 2 × cache_write)` — flat-rate cost math downstream stays exact in dollars; without cache activity it equals the raw count.
- Claude repository logs the raw `in/cache_write/cache_read` split per call (SC-004 verification).
- Skipped ticks produce no `usage.add()` call and therefore no counter movement and no report row (FR-009).
- Ranch's report DTO and mapper are untouched.

## Usage record (ranch, external DB)

Unchanged. Accuracy property preserved: rows reflect only calls actually made, because skips happen before any LLM invocation.
