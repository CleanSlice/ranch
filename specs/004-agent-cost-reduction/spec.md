# Feature Specification: Agent Cost Reduction (Heartbeat & Context Spend)

**Feature Branch**: `004-agent-cost-reduction`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "Давай проведем анализ и предпримем меры для устранения огромных расходов агентов — рычаги по убыванию эффекта: (1) удалить HEARTBEAT.md у агентов, которым проактивность не нужна; (2) увеличить интервал heartbeat (дефолт 30 мин → например 180); (3) похудеть контекст (~24,6k токенов на вызов); (4) prompt caching в рантайме (1h TTL)."

## Problem & Baseline (analysis)

Every deployed agent runs a periodic "heartbeat" check-in: on a fixed schedule the platform asks the agent's LLM to read its task file and act on it. Each check-in resends the agent's full context and is billed as a normal LLM call.

Observed baseline (production agent, one day, cheapest model tier):

- 81 LLM calls with a single user interaction — the rest were background check-ins and loop iterations.
- ~24,600 input tokens per call (full agent context resent every time), ~105 output tokens per call.
- **$2.04/day ≈ $60/month per agent** — while the agent's heartbeat task list was empty, i.e. the spend bought nothing.
- The agent template ships with an **empty** heartbeat task file, and the platform triggers a check-in whenever the file merely *exists* — so every agent created from the template pays this cost by default.

Cost scales linearly with context size: an agent with accumulated memory/history can reach $0.05–0.10 per check-in ($120–240/month at the default schedule).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Idle agents stop spending money (Priority: P1)

As a workspace operator, when an agent has no periodic tasks defined, it must not make any background LLM calls — its spend drops to actual user-driven usage only.

**Why this priority**: This is the dominant cost driver and requires no operator action. Today an agent with an empty task list burns ~$60/month asking the model "anything to do?" and hearing "no" 48 times a day. Fixing this alone eliminates nearly all idle-fleet spend.

**Independent Test**: Deploy an agent from the standard template (empty task list), leave it idle for 24 hours, and verify its usage panel shows zero LLM calls and zero cost.

**Acceptance Scenarios**:

1. **Given** an agent whose heartbeat task file is absent, **When** a scheduled check-in fires, **Then** no LLM call is made and no usage is recorded.
2. **Given** an agent whose heartbeat task file exists but contains no actionable tasks (empty or template boilerplate only), **When** a scheduled check-in fires, **Then** no LLM call is made and no usage is recorded.
3. **Given** an agent with actionable tasks in its heartbeat task file, **When** a scheduled check-in fires, **Then** the check-in runs as today (no regression of proactive behavior).
4. **Given** an idle agent that was skipping check-ins, **When** an operator adds a task to its heartbeat task file, **Then** the next scheduled check-in picks it up without requiring a restart.

---

### User Story 2 - Operators tune or disable proactivity per agent (Priority: P2)

As a workspace operator, I can control each agent's proactive behavior: remove its heartbeat task file entirely, or change how often it checks in (e.g. every 3 hours instead of every 30 minutes) — without redeploying the platform.

**Why this priority**: For agents that *do* have periodic tasks, check-in frequency is the main remaining cost lever (30 min → 180 min ≈ −85% of heartbeat spend). Operators need a per-agent knob rather than a fleet-wide constant.

**Independent Test**: Change one agent's check-in interval to 180 minutes, restart that agent, and verify from its usage records that check-ins now occur ~8 times/day instead of ~48.

**Acceptance Scenarios**:

1. **Given** an agent with heartbeat tasks, **When** the operator sets its check-in interval to N minutes in the agent's configuration, **Then** after the agent restarts, check-ins occur every N minutes.
2. **Given** an agent whose proactivity is no longer wanted, **When** the operator deletes its heartbeat task file through the existing agent file management surface, **Then** background LLM calls stop from the next scheduled check-in onward.
3. **Given** an agent with an invalid interval value (zero or negative), **When** the agent starts, **Then** the platform falls back to a safe default rather than failing or ticking continuously.

---

### User Story 3 - Repeated context stops being billed at full price (Priority: P3)

As a platform owner, when an agent's LLM calls resend the same large context (system prompt, persona, memory, skills), the unchanged portion is billed at the LLM provider's discounted cached rate instead of full price — for background check-ins and user conversations alike.

**Why this priority**: ~98% of the observed spend was input tokens re-transmitting an unchanged prefix. Caching cuts the per-call price of *every* call, including active user chats, but it is an optimization on top of Stories 1–2 rather than a prerequisite.

**Independent Test**: Run two consecutive LLM calls for the same agent with unchanged context within the cache lifetime and verify from provider usage metadata that the second call's input was predominantly billed at the cached rate.

**Acceptance Scenarios**:

1. **Given** an agent making repeated calls with an unchanged context prefix, **When** the second call occurs within the cache lifetime, **Then** the unchanged prefix is billed at the provider's cached-read rate.
2. **Given** the cache lifetime is shorter than the gap between calls, **When** the next call occurs, **Then** the call still succeeds at full price (correctness is never affected by cache state).
3. **Given** an agent configured with an LLM provider that does not support caching, **When** it makes calls, **Then** behavior is unchanged from today.

---

### Edge Cases

- Heartbeat task file contains only headings/boilerplate from the template (no task entries) → treated as "no actionable tasks", check-in skipped.
- Task file is deleted while the agent is running → check-ins stop at the next scheduled tick, no restart needed.
- Tasks are added between ticks → the next tick executes them (the skip decision is re-evaluated every tick, never cached).
- Check-in interval set larger than the provider's cache lifetime → periodic full-price cache refresh; functional behavior unchanged.
- Agent running only mock/eval channels → background jobs remain disabled entirely (existing behavior preserved).
- Usage accounting: a skipped check-in must produce no usage record at all (call count and cost reflect reality).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST NOT make a background LLM call for an agent whose heartbeat task file is absent.
- **FR-002**: The platform MUST NOT make a background LLM call for an agent whose heartbeat task file contains no actionable tasks (empty file or unmodified template boilerplate).
- **FR-003**: The skip decision MUST be re-evaluated at every scheduled check-in, so adding or removing tasks changes behavior from the next tick without an agent restart.
- **FR-004**: Agents with actionable heartbeat tasks MUST continue to execute their scheduled check-ins exactly as today (no regression of proactive behavior).
- **FR-005**: The check-in interval MUST be configurable per agent; a changed interval takes effect no later than the agent's next restart. Invalid values (zero, negative, non-numeric) fall back to the platform default.
- **FR-006**: Operators MUST be able to remove or edit an agent's heartbeat task file through the existing agent file management surface, without platform redeploy.
- **FR-007**: Where the agent's LLM provider supports context caching, repeated calls MUST bill the unchanged context prefix at the provider's discounted cached rate, with a cache lifetime chosen to cover the default check-in interval.
- **FR-008**: Caching MUST be transparent to correctness: cache misses, expiry, or provider non-support degrade only to today's full-price behavior, never to errors or altered responses.
- **FR-009**: Skipped check-ins MUST NOT create usage records; recorded call counts and cost MUST continue to reflect only calls actually made.

### Key Entities

- **Heartbeat task file**: A per-agent document listing periodic tasks the agent should perform proactively. Its presence *and* non-empty task content now gate background check-ins.
- **Agent configuration**: Per-agent settings including the check-in interval (minutes).
- **Usage record**: Per-agent daily accounting of LLM calls, tokens, and cost; must reflect only real calls.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An idle agent with no heartbeat tasks incurs **zero** background LLM calls and zero LLM cost over any 24-hour window (baseline: ~48 background check-ins, ~$2/day).
- **SC-002**: Fleet-wide, agents created from the standard template and never given tasks show 100% elimination of background spend (baseline: ~$60/month per idle agent).
- **SC-003**: For agents with heartbeat tasks, raising the check-in interval from 30 to 180 minutes reduces daily check-in count from ~48 to ~8 (≈85% reduction of heartbeat spend), with tasks still executed on the new schedule.
- **SC-004**: With context caching active, per-call input spend for repeated calls with unchanged context drops by at least 50% compared to baseline.
- **SC-005**: Proactivity is preserved: 100% of agents with actionable tasks continue executing them on schedule after the change.

## Assumptions

- The default check-in interval remains 30 minutes for agents that have actionable tasks; no fleet-wide default change is needed once idle agents skip check-ins (levers 1 and 2 make a default change unnecessary).
- Managing heartbeat files and intervals via the existing agent file/config editing surfaces is sufficient for this feature; no new admin UI controls are in scope.
- "Context slimming" (trimming an agent's memory/skills to shrink per-call context) is an operator practice using existing file management — it requires no platform change and is out of scope as an engineering item.
- Distinguishing background vs. user-driven calls in usage reporting (per-source breakdown) is out of scope; existing per-agent totals are sufficient to verify the success criteria.
- The behavior change lands in the agent runtime (separate repository), following the established cross-repo precedent of feature 003; this spec is the single source of truth for the feature.
- Agents currently deployed with empty task files lose nothing when their check-ins stop: an empty task list produces a no-op response by definition.
- The primary LLM provider supports context caching with a lifetime option that covers the default 30-minute interval; providers without caching support are unaffected.
