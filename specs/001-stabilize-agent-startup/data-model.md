# Data Model: Stabilize Agent Startup Status & Logs

**Date**: 2026-07-30 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

## Agent (existing Prisma model — additive changes only)

Source: `api/src/slices/agent/agent/agent.prisma` (composed into `api/prisma/schema.prisma`; one new additive migration).

| Field | Type | New? | Semantics |
|-------|------|------|-----------|
| `status` | `String @default("pending")` | no | Unchanged vocabulary: `pending` \| `deploying` \| `running` \| `failed` \| `stopped` (clarification #1) |
| `workflowId` | `String?` | no | Now **cleared before** cancelling the old workflow in `restartAgent()` (D2); still cleared on stop |
| `firstDeployedAt` | `DateTime?` | **yes** | Set exactly once — on the agent's first successful workflow submit. Never updated afterwards. Null ⇒ the agent has never been deployed. A follow-up migration backfills `updatedAt` for pre-existing non-`pending` agents so their next deploy reads as `restart`, not a first launch |
| `lastDeployStartedAt` | `DateTime?` | **yes** | Set by `deploy()` together with the `deploying` status write. Anchor of the 5-minute grace/timeout window (D1). When null (legacy rows deployed before the migration), the grace predicate falls back to `updatedAt` so a mid-rollout deploy is not instantly drift-failed |
| `lastLaunchContext` | `String?` | **yes** | `'initial'` \| `'restart'`. Written by `deploy()`: `initial` iff `firstDeployedAt` is null at call time, else `restart`. Null only for legacy rows never deployed since migration |
| `statusReason` | `String?` | **yes** | Human-readable reason accompanying `failed` (FR-009). Set by every `failed` writer; cleared (null) on any transition to `deploying`, `running`, or `stopped` |

**Write discipline**: `AgentGateway.updateStatus()` remains the single DB writer for `status` and is extended to atomically accept `statusReason` (and the deploy-time fields where relevant), preserving the existing last-writer-wins reasoning in `agentDeploy.service.ts`.

## Status state machine (target behaviour)

States are the existing five values; what changes is *who may write `failed` and when*.

```text
pending ──deploy()──▶ deploying ──pod ready / bridle connect──▶ running
   ▲                     │  ▲                                      │
   │                     │  └── start/restart (deploy())           │
   │                     │                                         │
 (row created)           ├──stop()──▶ stopped ──start()──▶ deploying
                         │                ▲                        │
                         │                └─────────stop()─────────┘
                         │
                         └──definitive failure──▶ failed ──start/restart──▶ deploying
                                                    │
                                                    └──late pod ready / bridle connect──▶ running   (self-heal, kept)
```

**Definitive failure** (the only permitted `deploying → failed` / `running → failed` triggers, FR-002):

| Trigger | Latency | `statusReason` |
|---------|---------|----------------|
| Workflow submit throws (`agentDeploy.service.ts`) | immediate | generic `workflow submit failed` — raw submit errors can carry internal detail (Argo endpoints) and `statusReason` is served on public endpoints; the full message goes to the server log |
| Template missing at deploy | immediate | "template not found …" |
| Pod waiting reason ∈ `FAIL_WAITING_REASONS` (`CrashLoopBackOff`, `ImagePullBackOff`, `ErrImgPull`, `CreateContainerConfigError`, `CreateContainerError`) | ≤ pod-event latency | waiting reason + pod message |
| Pod phase `Failed` | ≤ pod-event latency | termination reason/message |
| Workflow phase `Failed`/`Error` via `syncStatus` — can only be the **current** workflow, since restart detaches the old id before cancelling and stop clears it (D2); definitive immediately, no time guard. Skipped when the runtime is live on the bridle hub (bridle-truth wins, same rule as the drift sweep) — a lying workflow record must not ping-pong a healthy agent to `failed` | ≤ next poll | `deploy workflow failed/error` |
| Drift sweep: no pod **and** `now − lastDeployStartedAt > 5 min` (D1) | ≤ 30 s after window expiry | "startup did not produce a running agent within 5 minutes" |

**Forbidden writers removed**: drift no-pod branch inside the grace window (RC-1 primary); `syncStatus` reading the cancelled old workflow (RC-1 secondary — eliminated by clearing `workflowId` first); `restart_agent` MCP tool's bare `deploying` write (now performs a real restart); bridle-truth resurrect paths flipping an explicitly **stopped** agent back to `running` (the old runtime's WS lingers after pod delete — indefinitely on local dev — and the resurrect both undid the operator's stop and set up a later pod-less-`running` → `failed` decay); `syncStatus` writing `failed` while the runtime is live on the bridle hub.

`ContainerCreating` / `PodInitializing` remain explicitly non-failure signals at every layer.

## Launch context (derived, server-authoritative)

`launchContext` on agent responses = `lastLaunchContext` (`'initial' | 'restart' | null`). Consumed by the admin UI to select copy while `status ∈ {pending, deploying}`:

| `launchContext` | Overlay title | Log-panel placeholder |
|---|---|---|
| `initial` | "Setting up the agent…" (first start) | "First start — logs will appear when the agent is up." |
| `restart` / null | "Restarting agent…" | "Agent is restarting — logs will resume when the new pod is up." |

(Exact wording finalized in implementation; the contract is: the two flows MUST render visibly different copy, FR-003/SC-003.)

## Log stream markers (API → admin contract)

`GET /agents/:agentId/logs` returns either real log text or exactly one of these single-line markers (existing contract, now reliable per D4):

| Marker | Meaning | Admin rendering |
|--------|---------|-----------------|
| `[no pod yet for <status> agent]` | Pod does not exist yet | "No pod yet — agent is <status>." placeholder |
| `[container <reason>]` | Pod exists, container waiting (e.g. `containercreating`) | Spinner + "Container creating…" |
| `[log fetch failed: <one-line message>]` | Genuinely unexpected fetch error | Italic placeholder with the *parsed one-line* message — never a raw multi-line HTTP dump |

## Client-side state (admin, no persistence changes)

- `IAgentData` (`admin/.../domain/agent.types.ts`) gains `launchContext`, `statusReason`, `firstDeployedAt` (nullable); mapper fills them; unknown `launchContext` strings coerce to null.
- `useAgentLifecycle`: poll ticks are skipped while a lifecycle mutation is awaiting its HTTP response (D6); restart-in-flight localStorage flag semantics unchanged.
- Log classifier (`utils/agentLogs.ts`): level determined by the line's explicit level token when present; body-substring matching only as fallback.
