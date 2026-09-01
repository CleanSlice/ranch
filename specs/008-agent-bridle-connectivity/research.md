# Research: Agent bridle connectivity in status (CLEAN-55)

All Technical Context unknowns resolved. Code references verified against the current tree.

## R1. New status value: `unreachable`

- **Decision**: Add `unreachable` to `AgentStatusTypes` (`api/src/slices/agent/agent/domain/agent.types.ts:1`, admin mirror `admin/slices/agent/agent/domain/agent.types.ts:5`). No DB migration: `agent.prisma:15` stores `status String @default("pending")` — plain string column.
- **Rationale**: Clarified 2026-09-01 — status must be truthful for every consumer, not just the open chat window.
- **Alternatives considered**: derived display over `running` (rejected in clarify: leaves the lie in the public endpoint/DB); reuse `failed` (rejected: pod is healthy, semantics differ, auto-restart logic keys off `failed`).

## R2. Where `unreachable` participates in existing status machinery

- `LIVE_DB_STATUSES` (`agentStatus.service.ts:52`) gains `unreachable`: capacity treats it as live (pod still occupies a slot), and the missing-pod drift branch (`:299-305`) then automatically fails an `unreachable` agent whose pod disappears.
- `RESERVED_DB_STATUSES` (`:58`) unchanged.
- **Pod-driven promotion guard (critical)**: `reconcileDbStatus()` promotes Running+Ready → `running` (`:457`). It MUST skip agents in `unreachable`, otherwise every pod event would re-mask the incident. Only bridle registration promotes out of `unreachable`.
- `markRunningFromBridle` (`:156-177`): extend to promote `unreachable` → `running` (currently only non-running/non-stopped). `stopped` exemption stays.
- `statusReason` persistence: `agent.gateway.ts:91` hard-codes `status === 'failed' ? reason : null`. Change to persist reason for `failed` **and** `unreachable`; every transition to any other status still clears it (invariant preserved). Update the comment in `agent.prisma:16` accordingly.

## R3. Grace window design

- **Decision**: dedicated in-memory observation window inside `AgentStatusService`:
  - `bridleDownSince: Map<agentId, epochMs>` — first sweep that observes `pod Running+Ready && status==='running' && !isAgentConnected(id)` records `Date.now()`; demotion to `unreachable` happens only when `now - downSince > BRIDLE_GRACE_MS` (**60_000 ms**) on a later sweep (sweep interval `DRIFT_INTERVAL_MS = 30_000`, so worst-case detection ≈ 90 s — matches SC-001).
  - Entry is deleted whenever `isAgentConnected` is true (existing bridle-truth branch in `detectDrift`, `:274`) and on `connected` events.
  - Demotion additionally respects `isWithinDeployGrace(agent)` (`deployGrace.ts:8`, 5 min) per the spec edge case — fresh deploys are not flagged during startup; the deploy-time reason (R5) covers the misconfigured-deploy window instead.
- **Rationale**: the hub map is in-process; after an API restart the `bridleDownSince` map is empty, so every agent automatically gets a fresh 60 s window to reconnect — no separate "service started at" anchor needed. Same mechanism absorbs runtime reconnect flaps.
- **Alternatives considered**: reuse deploy-grace alone (rejected: 5 min detection lag for established agents, and it does not cover API restarts for agents that never redeployed); tracking `disconnected` events from `agentEvents$()` (rejected: misses "never connected at all", which is the incident case).

## R4. Diagnostic reason text (sweep)

- **Decision**: `pod is running but the runtime never connected to the bridle hub — check integrations/bridle_url and bridle_api_key (/settings/bridle), then restart the agent`.
- Written via `agentGateway.updateStatus(id, 'unreachable', undefined, reason)`. Cleared automatically on promotion to `running` (R2).

## R5. Deploy-time misconfiguration warning

- **Decision**: non-blocking (confirmed in clarify 2026-09-01). In `AgentDeployService.deploy()` (`agentDeploy.service.ts:118`), after `markDeployStarted`, check the DB values of `integrations/bridle_url` and `integrations/bridle_api_key`; if either is empty/missing → `logger.warn` + write the reason via a new `IAgentGateway.setStatusReason(id, reason)` (reason-only write; status stays `deploying`).
  - Reason text: `integrations/<key> is not set — the agent pod will start without hub credentials and can never come online; set it at /settings/bridle and restart the agent`.
  - Settings access: the agent slice must not reach into workflow data. Expose a `checkBridleSettings(): Promise<string | null>` (null = ok, string = warning text) on the workflow domain service that `AgentDeployService` already injects for `submitAgentWorkflow`.
- **Gotcha discovered**: `argo-workflow.gateway.ts:26-45` now has non-empty dev `DEFAULTS` for `bridle_url`/`bridle_api_key` (`value || DEFAULTS[name]`), so an empty setting no longer produces a missing env var — it produces a pod pointed at a *dev* endpoint that is unreachable in prod. The check therefore keys off the **DB setting being empty**, not the final env value; the message warns about the dev-default fallback. (`buildAgentEnv` empty-value filtering at `agent-workflow.manifest.ts:186-191` remains relevant for other env vars and for the env preview.)
- **Reason lifecycle gap (accepted)**: pod Running+Ready promotes `deploying` → `running`, clearing the deploy-time reason; up to ~60 s later the sweep demotes to `unreachable` and rewrites it. During that gap the UI still shows `bridleConnected: false` (R6), so the admin is never fully green.

## R6. `bridleConnected` in snapshot + SSE

- **Decision**: extend `IAgentStatus` (`agentStatus.service.ts:32`) to `{ agent, pod, bridleConnected: boolean }`, filled from `bridleGateway.isAgentConnected(agent.id)` in `snapshot()` (`:179`) and in every `stream$()` event (`:215`).
- Additionally merge `bridleGateway.agentEvents$()` into `stream$()` updates so connect/disconnect pushes a fresh per-agent `{type:'event', payload:{eventType:'modified', status}}` without waiting for a pod event (US1 scenario 4).
- DTO: `AgentStatusDto` (`api/src/slices/agent/agent/dtos/agentStatus.dto.ts`) gains `@ApiProperty() bridleConnected: boolean`; `AgentDto.status` enum gains `unreachable`. Regenerate: `cd api && bun run generate:swagger`, then `cd admin && bun run build:api`.
- Not persisted to DB (spec FR-010). `GET /agents/status` stays `@Public()` — a boolean and a settings-key hint expose no secrets (FR-011).
- Injection: `AgentStatusService` already injects `IBridleGateway` via `forwardRef` (`agentStatus.service.ts:71-79`); `isAgentConnected`/`agentEvents$` already exist on the abstract interface (`api/src/slices/bridle/domain/bridle.gateway.ts:83,90`) — no interface change needed for R6; only stream wiring.

## R7. Admin UI

- **Status rendering**: `AGENT_STATUS_VARIANT` (`admin/slices/agent/agent/utils/agentFormat.ts:5`) gains `unreachable` (destructive-style badge, visually distinct from green `running`). Touch points: `components/agent/workspace/Main.vue:146`, `components/agent/overview/RuntimeCard.vue` (extend the `statusReason` line, currently `failed`-only, to include `unreachable` + tooltip), agents list `pages/agents/index.vue` (verify exact badge site during implementation), global `components/agent/status/Indicator.vue` + `stores/agentStatus.ts` (`failingCount`-style counter: add unreachable count).
- **Store**: `stores/agentStatus.ts` records `bridleConnected` per agent from snapshot/events; admin local `IAgentData`/types mirror gains `unreachable` + `bridleConnected` on the status payload type.
- **Chat hint**: `admin/slices/bridle/components/bridle/Provider.vue` — when `!isAgentConnected` and the agent status is `running`/`unreachable`, replace the bare "Agent is not connected" with a hint: link to `/settings/bridle` (page exists: `admin/slices/setting/pages/settings/bridle.vue`), point at the agent env preview (`components/agent/env/Tab.vue`, backed by `GET /agents/:id/env`), and state that a restart is required after fixing settings. Admin is English-only — no i18n work.

## R8. Tests

- No existing `agentStatus.service.spec.ts` — create one (`api/src/slices/agent/agent/domain/`). Instantiate the service directly with hand-rolled gateway mocks (pattern: factory helpers as in `agent-workflow.manifest.spec.ts`); drive `detectDrift`/handlers directly instead of timers.
- Cases: demote after grace; no demote within grace; no demote within deploy-grace; `stopped` untouched; `connected` event promotes `unreachable` → `running` + clears reason; pod Running+Ready does NOT promote out of `unreachable`; snapshot carries `bridleConnected`. Deploy-warning cases in `agentDeploy.service.spec.ts` (extend/create).
- Run: `cd api && bunx jest agentStatus agentDeploy`. Full check before push: `cd api && bunx tsc --noEmit`; `cd admin && bun run typecheck` (nuxt typecheck, CI runs it via turbo).
