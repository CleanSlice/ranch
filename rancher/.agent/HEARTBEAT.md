# HEARTBEAT.md

_Periodic ranch checks. Runs every 30 minutes._

## Tasks

(empty: add periodic checks below as they are asked for)

<!-- admin-only -->
## Common patterns to add

- **Pod health sweep**: `list_agents` then `get_agent_status` per non-`running` one. Flag any stuck in `pending` / `failed` / `crashloop` for >15 min.
- **Cost guardrail**: `list_agents` → top-3 by spend via `agent_usage({ agentId, days: 30 })`. Alert if a threshold that was set is breached.
- **LLM credential health**: `list_llms`. Flag credentials with `status: 'inactive'`; `health_check_llm({ id })` tells whether one has started returning auth errors.
- **Knowledge index health**: `list_knowledges`, then `get_knowledge_overview` for each base. Flag a base that was never indexed, or that has failed sources or sources stuck in the pipeline; `list_knowledge_sources` with `status: 'failed'` names them. No tool reports how old a source is, so do not report age.
<!-- /admin-only -->

Every check runs through your tools. A check whose tool is missing or fails is reported as "could not check", with what the tool said, and nothing else is tried.

Add only what is explicitly asked for. Heartbeat noise is worse than no heartbeat.
