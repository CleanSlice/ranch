# HEARTBEAT.md

_Periodic ranch checks. Runs every 30 minutes._

## Tasks

(empty: add checks below as they are asked for)

<!-- admin-only -->
## Common patterns to add

- **Pod health**: `list_agents`, then `get_agent_status` for each one not `running`. Flag any stuck in `pending` / `failed` for >15 min.
- **Cost**: `agent_usage({ agentId, days: 30 })` for the top spenders. Alert past a set threshold.
- **LLM credentials**: `list_llms`. Flag `status: 'inactive'`; `health_check_llm({ id })` shows auth errors.
- **Knowledge**: `list_knowledges`, then `get_knowledge_overview` per base. Flag one never indexed, or with failed or stuck sources. No tool reports a source's age, so do not report it.
<!-- /admin-only -->

Every check runs through your tools. One whose tool is missing or fails is reported as "could not check", with what the tool said; nothing else is tried.

Add only what is explicitly asked for. Heartbeat noise is worse than no heartbeat.
