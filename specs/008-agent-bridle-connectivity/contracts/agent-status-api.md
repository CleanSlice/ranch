# Contract changes: agent status API (CLEAN-55)

All changes are additive; existing consumers keep working. After DTO changes regenerate clients: `cd api && bun run generate:swagger` → `cd admin && bun run build:api` (openapi-ts, output `admin/slices/setup/api/data/repositories/api/`). API restart required before frontend regen picks up the new spec.

## `GET /agents/status` — snapshot (`@Public()`, unchanged auth)

Response item (`AgentStatusDto`):

```jsonc
{
  "agent": {
    "id": "…",
    "status": "unreachable",        // enum gains "unreachable"
    "statusReason": "pod is running but the runtime never connected to the bridle hub — check integrations/bridle_url and bridle_api_key (/settings/bridle), then restart the agent",
    // …existing AgentDto fields unchanged
  },
  "pod": { "phase": "Running", "ready": true, /* … */ },
  "bridleConnected": false          // NEW, always present, boolean
}
```

Security note (FR-011): payload adds only a boolean and reason texts naming settings *keys* — no URLs-with-credentials, no key material.

## `GET /agents/status/stream` — SSE (`@Public()`, unchanged auth)

- `{"type":"snapshot","payload":[AgentStatusDto…]}` — includes `bridleConnected` per item.
- `{"type":"event","payload":{"eventType":"modified","status":AgentStatusDto}}` — now ALSO emitted on bridle hub `connected`/`disconnected` for the affected agent (previously pod events only). Consumers must upsert by `status.agent.id` (existing behavior — no change needed).

## `POST /agents/:id/deploy` (behavioral, no schema change)

When `integrations/bridle_url` or `integrations/bridle_api_key` DB value is empty: deploy proceeds (HTTP response unchanged), server logs a warning, and `agent.statusReason` is immediately populated with the deploy-time diagnostic. Visible in the next status snapshot/SSE event.

## `GET /agents/:id/env` (unchanged, referenced by UI)

Already returns `AgentEnvVarDto[]` env preview; with empty bridle settings the resolved values fall back to dev defaults (`argo-workflow.gateway.ts` `DEFAULTS`) — the admin chat hint links here so the operator can see what the pod will actually receive. Roles: Owner/Admin (unchanged).

## Generated client impact (admin)

- `AgentStatusTypes` / status enum in `types.gen.ts` gains `unreachable` — exhaustive `switch`/`Record` maps in admin (e.g. `AGENT_STATUS_VARIANT`) must add the key or fail typecheck (`cd admin && bun run typecheck`).
- `AgentStatusDto` gains required `bridleConnected: boolean`.
