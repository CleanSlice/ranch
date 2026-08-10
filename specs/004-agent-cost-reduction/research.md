# Research: Agent Cost Reduction (Heartbeat & Context Spend)

**Feature**: 004-agent-cost-reduction | **Date**: 2026-08-10

All Technical Context items were resolvable from direct code inspection of the two repositories and provider documentation; no NEEDS CLARIFICATION markers remain.

## D1 — How to decide "no actionable tasks" (FR-002)

**Decision**: Deterministic content check in the runtime, no LLM involvement. Normalize the heartbeat file content by stripping: markdown headings (`#`-prefixed lines), emphasis-only template lines (the shipped `_Add periodic tasks here…_` line), the literal template placeholder (`(empty — add reminders or periodic checks here)`), HTML comments, and blank lines. If nothing remains, the file has no actionable tasks and the tick is skipped.

**Rationale**: The whole point is eliminating spend — a classifier call would pay to decide whether to pay. The template's boilerplate is fully known (it ships from `.agent.example/HEARTBEAT.md` in the runtime repo), so a syntactic check is exact for the default case and safely conservative for user edits: any non-boilerplate line (task bullet, prose instruction) counts as actionable and the tick runs.

**Alternatives considered**:
- *File-absence only (delete the file to opt out)* — rejected as the sole mechanism: every existing agent was provisioned with the empty template, so the fleet would keep paying until operators manually delete files one by one. Absence remains a skip condition (FR-001), content check covers the default-template fleet (FR-002).
- *Byte-compare against the shipped template* — rejected: breaks the moment a user edits boilerplate without adding tasks (e.g. translates the heading), and requires versioning template bytes.
- *LLM-based classification* — rejected: costs the money the feature exists to save; nondeterministic.

## D2 — Where the skip decision lives

**Decision**: `HeartbeatService.shouldRun()` (domain layer): `gateway.exists() && hasActionableTasks(await gateway.load())`. The actionability predicate is a pure exported function in the domain, unit-testable in isolation. `tick()` already calls `shouldRun()` on every fire, which satisfies FR-003 (re-evaluated each tick, no restart needed) with zero changes to the timer/module wiring or either entrypoint.

**Rationale**: `HeartbeatGateway.load()` already exists (currently unused by the skip path). Putting the predicate in the domain keeps the gateway dumb (file I/O only) and matches the runtime's slice convention (cf. `cron.service` / `cron.parser` split with colocated specs).

**Alternatives considered**: check in `HeartbeatModule.run()` — rejected: module is wiring, logic belongs in the service; harder to test without timers.

## D3 — Interval configuration & validation (FR-005)

**Decision**: Keep the existing per-agent knob `agent.config.json → heartbeat.intervalMin` (default 30, `AGENT_CONFIG_DEFAULTS`). Add a guard where the module receives the interval: non-finite or ≤ 0 values fall back to the default 30 minutes with a warning log. Interval changes take effect on agent restart (current behavior, accepted by spec).

**Rationale**: The config surface already exists end-to-end (defaults merge in init, `runtime.module.ts` passes `intervalMin * 60_000` to `HeartbeatModule`); the only gap versus FR-005 is validation. Hot-reload of the interval is not required by the spec and would touch the module lifecycle for no cost benefit — with the P1 skip in place, idle agents pay nothing regardless of interval.

**Alternatives considered**: fleet-wide default change 30 → 180 — rejected per spec assumption: after P1, only agents with real tasks tick, and their cadence is a per-agent product decision, not a platform default change.

## D4 — Prompt caching mechanics (FR-007, FR-008)

**Decision**: In `ClaudeRepository.stream()` and `complete()`, send the system prompt as a content-block array with a cache breakpoint: `system: [{type: "text", text: systemPrompt, cache_control: {type: "ephemeral", ttl: "1h"}}]`. Add the beta flag `extended-cache-ttl-2025-04-11` to client `defaultHeaders` (appended to the existing `oauth-2025-04-20,claude-code-20250219` list for OAuth clients; added for the API-key client).

Key provider facts grounding this:
- Render order is `tools → system → messages`, so one breakpoint on the system block caches the tool definitions *and* the system prompt together. Both are stable per agent between calls.
- The cache TTL refreshes on each hit, so a 30-minute heartbeat cadence keeps a 1h-TTL entry warm indefinitely: one 2× write, then ~0.1× reads steady-state (~90% off the stable prefix).
- Minimum cacheable prefix for Haiku 4.5 is 4096 tokens; observed agent prefixes are ~20k+ tokens, comfortably above it. Below-minimum prompts silently don't cache — which is exactly the graceful degradation FR-008 requires.
- Cache misses/expiry degrade to full-price processing only; responses are unaffected. Non-Anthropic providers (`google`, `openai-compat`, `claudecli` repositories) are untouched.

**Rationale**: One breakpoint, no request-ordering changes, no new dependencies (SDK 0.79.0 supports `cache_control`). Conversation history is *not* given a second breakpoint in this feature: heartbeat history is short, the win is dominated by the system+tools prefix, and multi-breakpoint placement in a sanitized/merged message pipeline (`sanitizeMessages`) is easy to get subtly wrong. Recorded as a possible follow-up.

**Alternatives considered**:
- *5-minute default TTL* — rejected: expires between 30-minute ticks, so heartbeats would pay the 1.25× write every time and read never.
- *Also cache message history (2nd breakpoint on last message)* — deferred: real but smaller win for active chats; revisit after measuring.

## D5 — Cost-accounting scope (FR-009, SC-004 verification)

**Decision** *(amended during implementation, operator-approved)*: No ranch schema/DB changes. The runtime reports **billing-equivalent input tokens**: `inputTokens = input + 0.1 × cache_read + 2 × cache_write` (the 0.1×/2× are Anthropic's price ratios for cache reads and 1h-TTL writes relative to the base input rate). Downstream cost math (`cost = inputTokens × rate` in usage.json, the report pipeline, and the ranch panel) therefore stays **exact in dollars** end-to-end. The per-call log line keeps the raw `in/cache_write/cache_read` split for debugging; SC-004 remains verifiable from those logs.

**Trade-off accepted**: displayed token *counts* become billing equivalents rather than literal throughput (e.g. 8025 cached-read tokens surface as +802 input tokens). The panel's purpose is cost, so dollars-exact beats tokens-literal.

**Rationale**: the originally accepted "slight understatement" turned out to reach ~50% of the (much smaller) post-caching bill on active agents — acceptable for trend-watching but wrong for cost accounting. This fix is runtime-only, deploy-order-free, and reversible. The full-fidelity alternative (separate cache-token fields through DTO → external-DB migration → blended pricing, enabling cache-hit-rate UI) remains recorded as follow-up work; note its strict deploy order (ranch first — the usage upsert rejects unknown fields).

## D6 — Template wording

**Decision**: Update `.agent.example/HEARTBEAT.md` to state the new contract explicitly: with no tasks listed, the agent makes no background calls; adding a task enables checks at the configured interval.

**Rationale**: The file is the operator-facing surface of this feature; its current text ("Your assistant checks this every 30 minutes") describes the old always-tick behavior and would mislead after the change.
