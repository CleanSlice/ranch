# Data Model: Agent bridle connectivity (CLEAN-55)

## Agent (existing Prisma model — no migration)

| Field | Type | Change |
|---|---|---|
| `status` | `String` (`api/src/slices/agent/agent/agent.prisma:15`) | New allowed value `unreachable` (column is a plain string — code-level union only) |
| `statusReason` | `String?` | Semantics widened: persists while status is `failed` **or** `unreachable`; additionally writable stand-alone during `deploying` via new `setStatusReason()` (deploy-time warning). Any transition to a status outside {failed, unreachable} clears it — except the reason-only write. Update the comment at `agent.prisma:16`. |

### `AgentStatusTypes` union (code)

`'pending' | 'deploying' | 'running' | 'failed' | 'stopped' | 'unreachable'`

- API: `api/src/slices/agent/agent/domain/agent.types.ts:1`
- Admin mirror: `admin/slices/agent/agent/domain/agent.types.ts:5`
- Status sets (`agentStatus.service.ts`): `LIVE_DB_STATUSES = {pending, deploying, running, unreachable}` (capacity: unreachable pod still occupies a slot; missing-pod drift then also covers unreachable). `RESERVED_DB_STATUSES` unchanged.

## Status state machine (transitions touched by this feature)

```text
running ──(sweep: pod Running+Ready ∧ !isAgentConnected ∧ downSince>60s ∧ !deployGrace)──▶ unreachable  [+reason]
unreachable ──(bridle 'connected' event)──▶ running  [reason cleared]
unreachable ──(pod Running+Ready reconcile)──▶ unreachable  (GUARD: no pod-driven promotion)
unreachable ──(pod missing / Failed / CrashLoop)──▶ failed  [existing drift & reconcile paths, via LIVE_DB_STATUSES]
stopped ──(anything bridle/pod)──▶ stopped  (untouched exemption)
deploying ──(deploy-time check: empty bridle settings)──▶ deploying  [reason-only write]
```

## `bridleDownSince` (new, in-memory, AgentStatusService)

| Aspect | Value |
|---|---|
| Shape | `Map<agentId: string, epochMs: number>` |
| Written | first sweep observing `status==='running' ∧ pod Running+Ready ∧ !isAgentConnected(id)` |
| Cleared | `isAgentConnected(id)` true during sweep; bridle `connected` event; agent no longer `running` |
| Consumed | demotion fires when `now − downSince > BRIDLE_GRACE_MS (60_000)` |
| Persistence | none — map resets on API restart, which *is* the restart-grace mechanism |

## `IAgentStatus` (service payload → DTO → SSE)

```ts
interface IAgentStatus {
  agent: IAgentData;            // includes status (with 'unreachable') + statusReason
  pod: IAgentPodStatus | null;
  bridleConnected: boolean;     // NEW — live from IBridleGateway.isAgentConnected()
}
```

- `AgentStatusDto` (`dtos/agentStatus.dto.ts`): `@ApiProperty() bridleConnected: boolean`; `AgentDto.status` enum includes `unreachable`.
- Stream message type unchanged in shape (`snapshot` | `event`), but `event` is now also emitted on bridle `connected`/`disconnected` (eventType `modified`) so connectivity flips push instantly.

## Settings (existing, read-only for this feature)

| Key | Group | Role |
|---|---|---|
| `bridle_url` | `integrations` | Hub URL baked into pod env at deploy; empty DB value → dev default fallback (`argo-workflow.gateway.ts:26`) — the deploy-time check keys off the **DB value**, not the resolved env |
| `bridle_api_key` | `integrations` | Hub handshake secret; same check |

Admin page: `/settings/bridle` (`admin/slices/setting/pages/settings/bridle.vue`) — target of all troubleshooting links.

## Admin store additions (`admin/slices/agent/agent/stores/agentStatus.ts`)

| Field | Type | Source |
|---|---|---|
| `bridleConnected` per agent | `Record<agentId, boolean>` (or folded into agent record) | SSE snapshot + events |
| `unreachableCount` | `computed<number>` | agents with status `unreachable` (global Indicator badge) |

## Diagnostic reason texts (canonical)

- Sweep demotion: `pod is running but the runtime never connected to the bridle hub — check integrations/bridle_url and bridle_api_key (/settings/bridle), then restart the agent`
- Deploy-time (per empty key): `integrations/<key> is not set — the agent pod will start without hub credentials and can never come online; set it at /settings/bridle and restart the agent`
