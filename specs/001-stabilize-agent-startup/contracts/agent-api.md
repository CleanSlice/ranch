# API Contracts: Stabilize Agent Startup Status & Logs

**Date**: 2026-07-30 · Applies to `api/` (NestJS, OpenAPI-generated admin SDK). All changes are **additive** — no existing field changes shape or meaning.

## 1. Agent resource — new response fields

Affected endpoints: `GET /agents`, `GET /agents/:id`, and any response embedding the agent record (including `AgentStatusDto.agent` on `GET /agents/status` and SSE `GET /agents/status/stream`).

```jsonc
{
  "id": "agent-…",
  "status": "deploying",            // unchanged enum: pending|deploying|running|failed|stopped
  "launchContext": "initial",       // NEW: "initial" | "restart" | null — why the current/last deploy ran
  "statusReason": null,             // NEW: string | null — human-readable reason, non-null only when status="failed"
  "firstDeployedAt": null,          // NEW: ISO datetime | null — null ⇒ agent has never been deployed
  // …all existing fields unchanged
}
```

Guarantees:

- `launchContext = "initial"` on every response while (and after) an agent's **first** deploy is in flight; `"restart"` for every subsequent deploy, whatever triggered it (manual restart, start after stop, config-change redeploy, admin promote/demote).
- `statusReason` is non-null **only when** `status = "failed"`; it is cleared on every transition out of `failed` and on every new deploy. It may still be null for a `failed` recorded before the field existed (legacy rows are not backfilled) — consumers must tolerate `failed` with a null reason.
- Swagger/DTO updated so the generated admin SDK (`admin/slices/setup/api/…`) exposes the three fields with correct types (agent payload must not remain `{[key:string]: unknown}` for these fields).

## 2. Lifecycle endpoints — status-sequence guarantees

Endpoints unchanged in shape: `POST /agents` (create+deploy), `POST /agents/:id/start`, `POST /agents/:id/stop`, `POST /agents/:id/restart`, `POST /agents/restart-by-template/:templateId`.

Behavioural contract (what a poller at any frequency may observe, FR-001/FR-002/FR-010):

| Operation | Permitted status sequence | Forbidden |
|-----------|--------------------------|-----------|
| create → healthy | `pending → deploying → running` | any `failed` |
| start (from `stopped`) → healthy | `stopped → deploying → running` | any `failed`, any stale earlier status |
| restart (from `running`/`failed`) → healthy | `<prior> → deploying → running` | `failed` appearing *after* `deploying` began |
| stop | `<prior> → stopped` | — |
| any → genuine failure | `… → deploying → failed` (with `statusReason`) | `failed` before a definitive signal or before the 5-minute timeout |

Definitive-failure triggers and their reasons: see [data-model.md](../data-model.md) state-machine table. `failed` MUST be written within 60 s of a definitive signal (SC-006) and MUST NOT be written inside the 5-minute grace window by the *absence-of-pod* heuristic alone.

`POST /agents/:id/restart` additionally guarantees: the agent record never references the cancelled old workflow after the restart request is accepted (`workflowId` is cleared before cancellation — closes the stale-workflow `failed` race).

MCP tool `restart_agent` (rancher toolset) performs the same operation as `POST /agents/:id/restart` — never a bare status write.

## 3. Logs endpoint — marker contract

`GET /agents/:agentId/logs?tail=N` → `{ "logs": string }`, where `logs` is either real log text or exactly one marker line:

| Marker (exact format) | When |
|---|---|
| `[no pod yet for <status> agent]` | Pod `agent-<id>` does not exist (k8s 404) |
| `[container <reason>]` | Pod exists but container is waiting; `<reason>` lowercased, e.g. `containercreating`, `podinitializing` |
| `[log fetch failed: <message>]` | Any other fetch error; `<message>` MUST be a single-line, parsed error message — never a raw serialized HTTP response (no `HTTP-Code:`/`Body:`/`Headers:` dumps) |

The `[container …]` marker MUST be returned for k8s 400 "waiting to start" responses regardless of whether the k8s client delivers the error body as an object or a string (closes RC-3).

## 4. Status stream — unchanged, referenced

SSE `GET /agents/status/stream` and `GET /agents/status` keep their shape (`AgentStatusDto { agent, pod | null }`; pod: `phase`, `ready`, `restartCount`, `startedAt`, `lastTerminationReason`, `containerWaitingReason`, `message`, `observedAt`). The embedded `agent` record carries the new fields from §1. `ContainerCreating`/`PodInitializing` in `containerWaitingReason` remain non-failure signals.

## 5. MCP server bootstrap (internal contract)

- Seeded default for the built-in CleanSlice server: `https://mcp.cleanslice.org/mcp` (env `CLEANSLICE_MCP_URL` overrides).
- On every API bootstrap the seeder converges the **existing** built-in row's `url` to the configured value (idempotent heal); built-in rows remain non-editable/non-deletable via the public API.
- Consequence for agents: `MCP_SERVERS_B64` baked at deploy time contains the healed URL from the next deploy onward; a successfully started agent registers > 0 tools from CleanSlice and its startup log contains no connect-failure line (FR-012, SC-005).
