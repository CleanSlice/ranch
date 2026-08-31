# Contract — retrieval instance provisioning

**Feature**: [spec.md](../spec.md) · **Plan**: [plan.md](../plan.md) · **Research**: [research.md](../research.md) (R1, R2)

The contract between Ranch and the cluster for one knowledge base's isolated
retrieval area. It deliberately mirrors the agent-deployment contract that
already exists in `api/src/slices/workflow/`, so the two can be reviewed
side by side.

---

## Gateway interface

`api/src/slices/reins/instance/domain/instance.gateway.ts`

```ts
export interface IProvisionInstanceData {
  knowledgeId: string;
  knowledgeName: string;   // label only, for humans reading the cluster
  workspace: string;       // workspaceOf(knowledgeId) — the isolation namespace
}

export interface IInstanceStatus {
  knowledgeId: string;
  state: 'absent' | 'starting' | 'ready' | 'failed' | 'stopping';
  endpoint: string | null; // in-cluster base URL, null unless ready
  error: string | null;
  observedAt: string;
}

export abstract class IInstanceGateway {
  /** Idempotent: provisioning an existing, healthy instance is a no-op. */
  abstract provision(data: IProvisionInstanceData): Promise<IInstanceStatus>;
  abstract status(knowledgeId: string): Promise<IInstanceStatus>;
  abstract list(): Promise<IInstanceStatus[]>;
  /** Removes the pod and its Service. Does not delete indexed content. */
  abstract terminate(knowledgeId: string): Promise<void>;
}
```

Implementations, following the `workflow` slice's shape exactly:

| File | Role |
|---|---|
| `data/argoInstance.gateway.ts` | Submits the manifest through the Argo path already used for agents |
| `data/mockInstance.gateway.ts` | Local development — reports a single shared endpoint so `bun run dev` works without a cluster |
| `data/routerInstance.gateway.ts` | Picks between them, as `router-workflow.gateway.ts` does |
| `data/instance.manifest.ts` (+ `.spec.ts`) | Builds the manifest; unit-tested like `agent-workflow.manifest.spec.ts` |

`provision` being idempotent matters: it is called on base creation, on API
start-up reconciliation, and by the migration. None of those may create a second
area for the same base.

---

## Manifest

Built fully-baked as JSON, as `agent-workflow.manifest.ts` does — no
`arguments.parameters`, no `{{workflow.parameters.X}}` placeholders.

**Namespace** `agents`, **service account** `workflow` — the same constants the
agent manifest uses, so no new RBAC is required.

### Pod

| Property | Value |
|---|---|
| `metadata.name` | `lightrag-kb-<knowledgeId>` |
| `metadata.labels` | `ranch/knowledge-id: <knowledgeId>`, `ranch/component: retrieval` |
| `image` | `ghcr.io/hkuds/lightrag@sha256:ab23a9c83a735901b18c8960b6b482b602d5b6291abb7e07c5776f7bb2da504e` — pinned digest (resolved 2026-08-27), never `latest` |
| `containerPort` | `9621` |
| `resources.requests` | `cpu: 100m`, `memory: 512Mi` — one agent slot |
| `resources.limits` | `cpu: 2`, `memory: 4Gi` — headroom for ingest bursts |
| `volumes` | `emptyDir` at `/app/data/rag_storage` and `/app/data/inputs` |
| `nodeSelector` | `node-role: agents` |
| `tolerations` | `workload=agent:NoSchedule` |
| `readinessProbe` | TCP `9621` |

**Pinning the image is part of this contract.** The shared deployment tracks
`:latest`, and that is how this integration was broken twice by upstream renames
(`/documents/url` removed, `/documents/file` → `/documents/upload`, both recorded
in the client's comments). With one instance per base, an upstream change that
lands mid-migration would break bases unevenly.

### Environment

Identical to `k8s/platform/lightrag/deployment.yaml` — same `lightrag-api`
secret, same OpenAI bindings, same Postgres host and credentials, same four
`LIGHTRAG_*_STORAGE` values — with exactly one addition:

```
WORKSPACE = <workspaceOf(knowledgeId)>
```

`EMBEDDING_DIM=1536` must stay identical across every instance: the vector
column is sized on first init and all instances share one table.

### Service

| Property | Value |
|---|---|
| `metadata.name` | `lightrag-kb-<knowledgeId>` |
| `selector` | `ranch/knowledge-id: <knowledgeId>` |
| `port` | `9621` |

Resolved by ranch-api as `http://lightrag-kb-<knowledgeId>.agents.svc:9621`,
recorded on `Knowledge.instanceEndpoint`.

---

## Client addressing

`LightragHttpClient` currently resolves one shared config
(`LightragConfigResolver → {url, apiKey, enabled}`). It becomes per-base: the
resolver takes a knowledge id and returns that base's endpoint plus the shared
api key.

Consequences that must not be missed:

- Every call in the client already carries, or can carry, the base it belongs to.
  `query()`, `getGraph()` and `getGraphLabels()` — the three that today send no
  workspace — are the ones this fixes.
- `input.workspace` on the ingest methods becomes redundant: the instance is the
  workspace. Keeping a parameter that the server ignores is what produced the
  original defect, so it is **removed** rather than left as documentation.

---

## Lifecycle

| Event | Action |
|---|---|
| Base created | `provision`; base is `starting` until ready; capacity checked first |
| Base deleted | `terminate`, then remove the area's content |
| API restart | reconcile: `list()` against the bases in the database, provision what is missing, report what is orphaned |
| Instance crash | the readiness probe and pod watch report it; the base reports `instanceState: failed` with a reason instead of answering |
| Capacity exhausted | base creation refused with a stated reason (FR-008) |

**Orphans are reported, not auto-deleted.** An instance with no matching base is
a symptom of a failed deletion, and silently removing it would destroy the
evidence along with the content.

---

## Local development

`MockInstanceGateway` returns a single shared endpoint — the `docker-compose`
LightRAG — for every base. This means **local development does not reproduce
isolation**, which must be stated plainly wherever the mock is used: the
guarantee is verified against a cluster, and the integration test in
`quickstart.md` is the thing that proves it.
