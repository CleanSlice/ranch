# HEARTBEAT.md

_Periodic ranch checks. Runs every 30 minutes._

## Tasks

(empty — add periodic checks below as the operator requests them)

## Common patterns to add

- **Pod health sweep**: `list_agents` then `get_agent` per non-`running` one — flag any stuck in `pending` / `failed` / `crashloop` for >15 min.
- **Cost guardrail**: `list_agents` → top-3 by spend via `agent_usage({ agentId, days: 30 })` — alert if a threshold the operator set is breached.
- **LLM credential health**: `list_llms` — flag credentials with `status: 'inactive'` or that have started returning auth errors.
- **Knowledge index freshness**: `http GET ${RANCH_API_URL}/knowledges` — flag knowledge bases whose sources are older than 7 days (no MCP shortcut for this; see ranch SKILL recipe #8).

Add only what the operator explicitly asks for. Heartbeat noise is worse than no heartbeat.
