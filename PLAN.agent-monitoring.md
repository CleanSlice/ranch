# PLAN: agent monitoring (watch + push) and bulk lifecycle

## Goal

1. **Live status visibility.** Admin sees every agent's k8s pod state (phase,
   restart count, last termination reason) in real time. A pod that crashes,
   gets evicted, or fails image pull surfaces immediately, not after a poll.
2. **Bulk lifecycle.** Two ops:
   - `stop-all` — terminate every running agent (delete pods, mark stopped).
   - `restart-all <image?>` — recycle every agent with the current template
     image, or with an override image passed in the request.

## Architecture choice

**Watch + Push** (chosen over poll):

- Single long-lived k8s `watch` on `pods` in `agents` namespace inside the API
  process. The k8s client emits `ADDED`/`MODIFIED`/`DELETED` events on every
  state change.
- API fans out events to subscribed clients over **SSE** (Server-Sent Events,
  `Sse()` decorator from `@nestjs/common`). One-way server→client only — fits
  perfectly, no need for WebSocket.
- Frontend opens an `EventSource` to `/agents/status/stream`, store applies
  patches reactively. Initial state pulled via `GET /agents/status` so the UI
  is correct on connect even before the first watch event lands.

Why not WebSocket: SSE is built into NestJS via `Sse()`, auto-reconnects in the
browser, plays nicely with HTTP/2, and we don't need client→server messages on
this channel.

## Slice layout

| Slice | Type | Responsibility |
|---|---|---|
| `agent/pod` | Extend existing subslice | Read pod status, run watch loop, expose event stream |
| `agent/agent` | Extend existing slice | New endpoints: `GET /agents/status`, `GET /agents/status/stream`, `POST /agents/stop-all`, `POST /agents/restart-all` |

No new top-level slice. `agent/pod` already owns "k8s pod operations for agent
runtime" — extending it is the symmetrical move.

## API — files

### Extend `agent/pod`

```
ranch/api/src/slices/agent/pod/
├── pod.module.ts                       (modified)
├── domain/
│   ├── index.ts                        (modified — export new types/classes)
│   ├── pod.gateway.ts                  (modified — add list, watch)
│   ├── pod.types.ts                    (NEW)
│   └── pod.events.ts                   (NEW — EventEmitter wrapper)
└── data/
    └── pod.gateway.ts                  (modified — implements list + watch loop)
```

**`domain/pod.types.ts`**

```ts
export type PodPhaseTypes =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown';

export interface IAgentPodStatus {
  agentId: string;
  podName: string;
  phase: PodPhaseTypes;
  ready: boolean;
  restartCount: number;
  startedAt: string | null;
  lastTerminationReason: string | null;   // OOMKilled, Error, etc.
  containerWaitingReason: string | null;  // ImagePullBackOff, CrashLoopBackOff
  message: string | null;
  observedAt: string;
}

export type PodEventTypes = 'added' | 'modified' | 'deleted';

export interface IAgentPodEvent {
  type: PodEventTypes;
  status: IAgentPodStatus;
}
```

**`domain/pod.gateway.ts`** (extended)

```ts
import { Observable } from 'rxjs';
import { IAgentPodStatus, IAgentPodEvent } from './pod.types';

export abstract class IPodGateway {
  abstract delete(agentId: string): Promise<void>;
  abstract list(): Promise<IAgentPodStatus[]>;
  abstract events$(): Observable<IAgentPodEvent>;   // hot stream, multicast
}
```

**`data/pod.gateway.ts`** (extended `KubePodGateway`)

- On `OnModuleInit`, start a `@kubernetes/client-node` `Watch` against
  `/api/v1/namespaces/{ns}/pods` filtered by label `app=agent` (the Argo
  template already labels created pods — verify; if not, also accept
  `name === agent-{uuid}` prefix).
- Maintain in-memory `Map<agentId, IAgentPodStatus>` updated on each event.
- Use a `Subject<IAgentPodEvent>` from `rxjs` (or Node `EventEmitter`); expose
  via `events$()` as a multicast `Observable`.
- On watch disconnect: reconnect with last `resourceVersion`, exponential
  backoff capped at 30s. Log reconnects at `warn`.
- `list()` returns `Array.from(map.values())` — cheap, no extra k8s call.
- `OnModuleDestroy` aborts the watch.

**`pod.module.ts`**

```ts
@Module({
  providers: [{ provide: IPodGateway, useClass: KubePodGateway }],
  exports: [IPodGateway],
})
export class PodModule {}
```

### Extend `agent/agent`

```
ranch/api/src/slices/agent/agent/
├── agent.controller.ts                 (modified)
├── domain/
│   ├── agent.gateway.ts                (modified — add updateMany helpers if needed)
│   └── agent.types.ts                  (unchanged — existing AgentStatusTypes covers it)
└── dtos/
    ├── restartAll.dto.ts               (NEW)
    └── agentStatus.dto.ts              (NEW — Swagger response shape for stream/list)
```

**Endpoints in `agent.controller.ts`**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agents/status` | Snapshot — array of `IAgentPodStatus` joined with `IAgentData` (id, name, db status). Used for initial render. |
| `GET` | `/agents/status/stream` | SSE — emits `{type, status, agent}` on every pod event. Sends initial snapshot on connect. |
| `POST` | `/agents/stop-all` | Iterate `agentGateway.findAll()` → for each: cancel workflow, `podGateway.delete(id)`, `agentGateway.updateStatus(id, 'stopped')`. Return `{ stopped: number }`. |
| `POST` | `/agents/restart-all` | Body: `{ image?: string }`. For each agent: cancel old workflow, optionally update template image (or pass override into `submitAgentWorkflow`), call existing `deploy()`. Return `{ restarted: number, failed: string[] }`. |

**Concurrency for bulk ops:** use `Promise.allSettled` capped via a small
`p-limit`-style helper (concurrency 5). Failures don't abort the batch; failed
agent IDs go in the response. Don't pull in `p-limit` if not already a dep —
write a 10-line semaphore inline.

**`restart-all` with new image:** preferred semantics — pass `image` straight
into `WorkflowService.submitAgentWorkflow(agent, image ?? template.image)`.
Don't mutate the template row; `restart-all --image=foo:v2` is a one-shot
override, the template is the long-term default.

**SSE format** (NestJS `Sse()` returns `Observable<MessageEvent>`):

```ts
@Sse('status/stream')
stream(): Observable<MessageEvent> {
  return merge(
    from(this.snapshot()).pipe(map(s => ({ data: { type: 'snapshot', payload: s } }))),
    this.podGateway.events$().pipe(
      map(evt => ({ data: { type: 'event', payload: evt } })),
    ),
  );
}
```

## Workflow integration

`WorkflowService.submitAgentWorkflow(agent, image)` already takes an explicit
image — confirmed in `agent.controller.ts:57`. No change needed; `restart-all`
just calls it with the override.

If the workflow template hardcodes a label like `app=agent`, perfect. If not,
add it in the Argo workflow spec so the watch can filter cheaply. Verify by
reading `ranch/k8s/templates/` and any Argo templates referenced by
`workflow.service.ts`.

## RBAC — `k8s/deploy/25-api-rbac.yaml`

Current rules already grant `list` and `watch` on pods (lines 17–19). **No
RBAC changes needed for the read path.** Delete is also already there. The
file's existing comment is still accurate. No edit.

## Frontend — files

```
ranch/app/slices/agent/
├── stores/
│   ├── agent.ts                        (modified — fetchAll already exists)
│   └── agentStatus.ts                  (NEW — SSE-backed live map of pod statuses)
├── pages/
│   └── agents/
│       └── index.vue                   (modified — show status badges from agentStatus store)
└── components/
    └── agentList/
        ├── AgentListBulkActions.vue    (NEW — Stop All / Restart All buttons + image input)
        └── AgentStatusBadge.vue        (NEW — phase + restart count + warning icon)
```

**`stores/agentStatus.ts`** (sketch)

```ts
export const useAgentStatusStore = defineStore('agentStatus', () => {
  const statuses = ref<Record<string, IAgentPodStatus>>({});
  const connected = ref(false);
  let es: EventSource | null = null;

  function connect() {
    es?.close();
    es = new EventSource('/api/agents/status/stream');
    es.onopen  = () => { connected.value = true; };
    es.onerror = () => { connected.value = false; };
    es.onmessage = (raw) => {
      const msg = JSON.parse(raw.data);
      if (msg.type === 'snapshot') {
        statuses.value = Object.fromEntries(msg.payload.map(s => [s.agentId, s]));
      } else if (msg.type === 'event') {
        if (msg.payload.type === 'deleted') delete statuses.value[msg.payload.status.agentId];
        else statuses.value[msg.payload.status.agentId] = msg.payload.status;
      }
    };
  }

  function disconnect() { es?.close(); es = null; connected.value = false; }
  return { statuses, connected, connect, disconnect };
});
```

Page connects on `onMounted`, disconnects on `onUnmounted`. EventSource
auto-reconnects, but if `connected` flips false for >5s show an "offline"
banner so the operator knows the view is stale.

**Bulk actions UI**

- "Stop all running" — confirmation dialog, then `POST /agents/stop-all`,
  then `agent.fetchAll()`.
- "Restart all" — text input for image (placeholder: "leave empty for template
  default"), confirmation dialog, then `POST /agents/restart-all` with body
  `{ image }`, then `agent.fetchAll()`.

## Status mapping (DB vs pod reality)

The DB `agents.status` is the *desired/coarse* state ('deploying', 'running',
'failed', 'stopped'). Pod status from the watch is the *observed/fine* state.
Show both:

- DB status drives the row's main badge.
- Pod status drives a secondary indicator: green (Running+Ready), yellow
  (Pending / ContainerCreating / restartCount>0), red (Failed / CrashLoopBackOff
  / ImagePullBackOff / OOMKilled).

When pod state contradicts DB (e.g., DB=`running` but pod is `Failed`), the
watch handler **should** reconcile: call `agentGateway.updateStatus(id,
'failed')`. This makes "see if any agent is not working" automatic — even
without the UI open. Add this reconciliation in the watch handler in
`KubePodGateway`, behind a small private method `reconcileDbStatus(podStatus)`.

## Out of scope

- Historical status timeline / metrics dashboard — current ask is "see now,"
  not "see over time." Add Grafana later if needed.
- Per-agent resource usage (CPU/memory) — needs `metrics-server` and a
  separate API path; not asked for.
- Auth on the SSE endpoint beyond what `/agents` already has — same guard.
- Pagination on stop-all / restart-all — assume <100 agents per cluster for
  now; if it grows, add `?templateId=` filter later.
- Force-kill semantics — `Background` propagation is fine, same as existing
  delete.

## Phasing

1. **Phase 1 — backend read path.** Extend `pod.gateway` with `list` + watch
   + reconciliation. Add `GET /agents/status` and `GET /agents/status/stream`.
   Smoke test: `curl -N /agents/status/stream`, then kill an agent pod, watch
   the event arrive.
2. **Phase 2 — frontend live view.** `agentStatus` store + status badge in
   the existing list. Verify auto-reconnect by toggling API.
3. **Phase 3 — bulk endpoints + UI.** `stop-all`, `restart-all`, dialog +
   image input.

Each phase is a separate PR. Phase 1 is independently useful (admin sees
pod health via curl/Swagger even without UI changes).

## Open questions

1. Are agent pods labeled `app=agent` (or similar) by the Argo workflow?
   Need to confirm before writing the watch's label selector. If not, watch
   all pods in `agents` ns and filter by name prefix `agent-` in code.
2. Should `restart-all` accept a new image *per agent* (e.g., only restart
   agents using template X with a new image), or is the global override the
   v1 ask? Plan assumes global override; happy to add filtering if needed.
