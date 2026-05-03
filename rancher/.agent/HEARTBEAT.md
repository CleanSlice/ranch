# HEARTBEAT.md

_Periodic ranch checks. Runs every 30 minutes._

## Tasks

(empty — add periodic checks below as the operator requests them)

## Common patterns to add

- **Pod health sweep**: `ranch_agent_status` — flag any agent stuck in `pending` / `failed` / `crashloop` for >15 min.
- **Cost guardrail**: `ranch_usage_get` for top-3 spending agents — alert the operator if 30d cost exceeds a threshold they set.
- **LLM credential health**: `ranch_llm_list` — flag credentials with `status: 'inactive'` or that have started returning auth errors.
- **Knowledge index freshness**: `ranch_knowledge_source_list` — flag sources whose `lastIndexedAt` is older than 7 days.

Add only what the operator explicitly asks for. Heartbeat noise is worse than no heartbeat.
