# Quickstart: Validating Agent Cost Reduction

**Feature**: 004-agent-cost-reduction. Behavior lives in the sibling `runtime` repo; run validation there unless noted.

## Prerequisites

- `runtime` repo checked out next to `ranch` (`../runtime`), Bun installed.
- For live-call scenarios (3–4): a Claude credential in `LLM_API_KEY` and a local agent dir.

## 1. Unit tests (fast, no credentials)

```sh
cd ../runtime
bun test src/slices/agent/heartbeat
bun test src/slices/setup/llm
```

**Expected**: green. Heartbeat specs cover the decision table in [contracts/heartbeat-actionability.md](contracts/heartbeat-actionability.md) (absent/empty/template → skip; task line → run; interval fallback). Claude repository specs assert the request shape in [contracts/llm-caching.md](contracts/llm-caching.md) (system content block with `cache_control`, beta header present).

## 2. Idle agent skips heartbeats (US1 / SC-001)

```sh
cd ../runtime
cp -r .agent.example .agent-test          # template ships HEARTBEAT.md with no tasks
# point a dev agent at it and run (see README dev setup), then watch logs ~2 ticks
```

**Expected**: log line `heartbeat … skipping` (no actionable tasks) each interval; **no** LLM call logged; `data/usage.json` call counters do not move. Then append a task line (`- reply HEARTBEAT_OK test`) to `.agent-test/HEARTBEAT.md` **without restarting**: the next tick runs the LLM loop (FR-003).

## 3. Interval configuration (US2 / SC-003)

In the agent's `agent.config.json` set `{"heartbeat": {"intervalMin": 180}}`, restart the agent, verify from logs that `heartbeat started, interval=180min`. Set `0` or `-5`, restart: expect a warning and fallback to `interval=30min` (FR-005).

## 4. Prompt caching pays out (US3 / SC-004)

With a task-bearing heartbeat file (so calls actually happen), trigger two LLM calls within an hour (two ticks, or two chat messages):

**Expected** in repository logs: first call `cache_creation_input_tokens > 0`; second call `cache_read_input_tokens` ≈ the tools+system prefix size and `input_tokens` reduced accordingly. Provider console (Anthropic usage page) shows the same split. ≥50% input-spend reduction on the repeated call satisfies SC-004.

## 5. Production verification (after deploy)

- Ranch admin → agent Usage panel (agent-only view): an idle template agent shows **0 calls / $0** for the day (baseline was ~48 calls, ~$2) — SC-001/SC-002.
- Agents with real heartbeat tasks keep their scheduled activity (SC-005): usage shows calls at the configured cadence only.
- Note: with caching live, panel **cost is exact** (runtime reports billing-equivalent input tokens — research.md D5, amended); displayed token counts are billing equivalents, not literal throughput.

## Artifact map

| Claim | Where verified |
|---|---|
| Skip decision table | `heartbeat.service.spec.ts` (unit) + scenario 2 |
| Interval validation | scenario 3 + unit spec |
| Cached request shape | `claude.repository.spec.ts` (unit) + scenario 4 |
| No usage records on skip | scenario 2 (`usage.json`) + scenario 5 (panel) |
