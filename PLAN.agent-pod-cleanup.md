# PLAN: delete pod on agent delete

## Problem

`agent.controller.ts:remove()` currently calls `cancelAgentWorkflow(workflowId)`
and `agentGateway.delete(id)`. The Argo workflow creates the agent pod with
`kind: Pod`, `name: agent-{agentId}`, `namespace: agents`, `restartPolicy: Never`.
Cancelling the workflow does **not** delete the pod — it lives on until manually
removed.

## Slice

| Slice | Type | Responsibility |
|---|---|---|
| `agent/pod` | New subslice | Kubernetes pod operations for agent runtime (delete) |

Symmetrical to `log` slice which already uses CoreV1Api for read-only pod ops.

## API Files

```
ranch/api/src/slices/agent/pod/
├── pod.module.ts
├── domain/
│   ├── index.ts
│   └── pod.gateway.ts       # abstract IPodGateway { delete(agentId) }
└── data/
    └── pod.gateway.ts       # KubePodGateway using @kubernetes/client-node
```

Behaviour of `KubePodGateway.delete`:
- Build pod name `agent-${agentId}` in namespace `process.env.AGENTS_NAMESPACE || 'agents'`
- Call `CoreV1Api.deleteNamespacedPod` with `propagationPolicy: 'Background'`
- Treat 404 as success (already gone)
- Other errors: log warning, don't throw (delete should not be blocked by k8s glitches)

## Wiring

1. `agent.module.ts` → import `PodModule`
2. `agent.controller.ts:remove()` → after `cancelAgentWorkflow`, call `podGateway.delete(id)` inside try/catch with warning
3. `k8s/deploy/25-api-rbac.yaml` → add `delete` verb on `pods` for `ranch-api-agent-reader` Role (rename role to `ranch-api-agent-manager` since it now writes too — keep role name backward-compatible, just expand verbs)

## Out of scope
- Service / Deployment / ConfigMap deletion — agent runtime only creates a Pod
- Force-kill semantics — Background propagation is fine; pod terminates within seconds
- Waiting for pod deletion to complete — fire-and-forget, controller returns immediately
