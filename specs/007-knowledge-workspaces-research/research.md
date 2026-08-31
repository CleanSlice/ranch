# Phase 0 research — knowledge base isolation

**Feature**: [spec.md](./spec.md) · **Audit**: [retrospective.md](./retrospective.md)

**Date**: 2026-08-27

The specification fixes *what* must be true: one knowledge base answers only for
itself, and an agent given one base can neither read nor inspect another. This
document resolves *how*, and records what was rejected so the choices stay
re-litigable.

Every unknown carried out of the specification is resolved here. None remain.

---

## R1 — How a knowledge base gets its own isolated retrieval area

**Decision**: one LightRAG instance per knowledge base, run as a pod in the
`agents` namespace, provisioned through Argo with a dedicated manifest builder
that mirrors `agent-workflow.manifest.ts`. All instances share the existing
`lightrag-postgres`; isolation comes from each instance being started with
`WORKSPACE=knowledge_<uuid>`, the value `workspaceOf()` already computes.

**Rationale**: upstream fixes `workspace` at instance construction and documents
it as immutable afterwards. `/query` accepts no workspace and `QueryParam` has no
document filter, so isolation cannot be a query-time concern — it is a
deployment-time one. What makes this cheap in Ranch specifically is that the
platform already provisions a pod per agent this way: `IWorkflowGateway.submit`
builds a fully-baked Argo `Workflow` whose `resource.manifest` creates a Pod
(`api/src/slices/workflow/data/agent-workflow.manifest.ts`), `pod.gateway.ts`
watches pods and reports status, and `getClusterCapacity()` already answers "how
many more fit". A retrieval instance is the same shape of object as an agent,
so this adds a manifest builder and a gateway, not a capability.

All four storages are already Postgres (`PGKVStorage`, `PGDocStatusStorage`,
`PGVectorStorage`, `PGGraphStorage` in `k8s/platform/lightrag/deployment.yaml`),
where the workspace is a logical field in shared tables. N instances therefore
mean N processes against **one** database, not N databases.

**Alternatives considered**:

- **A custom Python service holding many `LightRAG` instances in one process.**
  Technically sound — `LightRAG(workspace=…)` is a constructor argument, so a
  service we own could keep a `workspace → instance` map and route per request,
  collapsing N pods into one. Rejected as the first move because it means owning
  a Python service and tracking upstream ourselves. The drift risk is not
  hypothetical: this integration has already been broken twice by upstream
  renames (`/documents/url` removed, `/documents/file` → `/documents/upload`,
  both recorded in the client's own comments). **Kept as the documented escape
  hatch** if pod count becomes the binding constraint before base count does.
- **Per-request workspace in the upstream server.** Would be ideal and does not
  exist; adding it means a patch plus upstream release cadence we do not control.
- **Filtering results in ranch-api after `/query`.** Rejected by FR-007: the
  generated answer is synthesised from foreign chunks before we ever see it, and
  graph traversal merges entity descriptions across bases. Discarding references
  afterwards hides the leak rather than closing it.
- **Querying the LightRAG Postgres directly from ranch-api with a workspace
  filter.** Reimplements keyword extraction, graph traversal and chunk ranking.
  Out of scope by a wide margin.

---

## R2 — Sizing, addressing and lifecycle of a retrieval instance

**Decision**:

- **Size it as a slot, not as the shared instance.** The current 500m CPU / 1Gi
  request was chosen for one instance serving the whole installation. The
  cluster's own convention for many small workloads is the agent slot —
  `AGENT_SLOT_CPU_MILLI = 100`, `AGENT_SLOT_MEM_BYTES = 512Mi`, Burstable QoS
  with a low request floor and a higher limit (`agent/pod/domain/pod.types.ts`).
  Retrieval instances follow that convention: a slot-sized request, a limit
  matching today's (2 CPU / 4Gi) so ingest bursts still fit.
- **Address it by a Service per base**, `lightrag-kb-<baseId>` in `agents`,
  selecting the pod by a `ranch/knowledge-id` label. Stable DNS, no IP
  bookkeeping, and a Service costs no scheduler resources.
- **Run it while the base exists.** No idle-stop in this feature. Ranch is
  personal and the base count is small; a cold start behind an operator's first
  question (the current readiness probe waits 30s before its first check) is a
  worse trade than a slot-sized idle pod. Idle-stop is a later optimisation, and
  the Service-based addressing does not have to change for it.
- **Report the ceiling instead of hitting it.** Before creating a base, ask
  `getClusterCapacity()` and refuse with a stated reason when there is no room —
  this is what the spec's ceiling edge case and FR-008 require.

**Rationale**: the footprint objection that drove the earlier (reversed) D2 was
computed against the shared instance's request. At slot size the same ten bases
reserve 1 CPU and 5Gi rather than 5 CPU and 10Gi, which is the difference between
"does not scale" and "scales the same way agents do".

**Storage**: the shared deployment mounts two 10Gi PVCs at
`/app/data/rag_storage` and `/app/data/inputs`. With all four storages on
Postgres, the working directory holds little and the input directory is a staging
area for uploads. Per-base instances use `emptyDir` for both — **verify on dev**
that nothing in the ingest path expects those to survive a restart, since a
per-base PVC would multiply cost by an order of magnitude and is the one thing
here that would make R1 unaffordable.

**Connection budget**: N instances open pools against one Postgres. Sizing the
per-instance pool and the server's `max_connections` is a planning input for the
tasks phase, not an open question — it is arithmetic once the ceiling from
`getClusterCapacity()` is known.

**Alternatives considered**: addressing pods directly by IP through the existing
pod watch (lighter, no Service objects, but re-introduces IP bookkeeping and a
window where the watch lags a restart); one Service in front of all instances
(defeats the purpose — routing would need a workspace header nothing honours).

---

## R3 — The transition off the shared pool

**Decision**: a resumable, per-base re-index orchestrated by ranch-api.

1. Create the base's instance and wait for readiness.
2. For each of its sources, re-ingest through the existing `ingestByType`
   (`reins/source/data/source.gateway.ts:202`), recording the new track id on
   `Source.lightragDocId` and the per-source state from R6.
3. Mark the base ready only when every source reports processed.
4. When every base is through, delete the old default-namespace content and
   remove the shared deployment.

**Rationale**: the shared pool holds every base's content with no marker
retrieval honours, so it cannot be split after the fact — re-processing is the
only way to place content in per-base areas. It costs the operator nothing
because every source type is rebuildable from Ranch's own storage: `text` from
`Source.content`, `url` by re-fetching `Source.url`, `file` by downloading
`Source.url` from S3. That is not new machinery — it is the function that already
runs on first index.

**Resumability** comes free from recording state per source: a restart re-reads
which sources have a fresh track id and continues. This satisfies FR-034.

**During the transition** the old shared instance keeps serving so bases still
answer, and every not-yet-migrated base reports its answers as incomplete
(FR-036). The old instance is decommissioned only after the last base is
through — which also means the rollback is "keep pointing at the old instance".

**Alternatives considered**: adopting the existing pool as one base's area
(possible only for an installation with exactly one base, and a trap the moment
a second exists); labelling existing rows by base in Postgres directly (the
mapping from a row to the base that wrote it does not exist — that is the whole
finding of retrospective §3).

---

## R4 — Attribution: naming the base an answer came from

**Decision**: attribute at the fan-out, and make references resolve to a `Source`
row.

- Ranch-api already issues one retrieval per bound base
  (`knowledge.tool.ts`, `Promise.all(targetIds.map(…))`). With per-base
  instances it knows which instance produced which block, so per-base
  attribution needs no help from LightRAG (FR-006).
- References today carry a raw `file_path` and nothing links them back
  (retrospective §7, item 8). Ingest already sets `file_source` — to
  `source.name` for text and the URL for web addresses. Extend it to carry the
  source id so a reference resolves deterministically, and keep displaying the
  human name (FR-005).

**Alternatives considered**: matching references back by `(knowledgeId, name)`
(breaks on two sources with the same name, which nothing prevents today);
asking LightRAG for document metadata per reference (an extra round trip per
reference for data we already hold).

---

## R5 — Closing the "seeing what another base holds" half

**Decision**: remove the installation-wide graph endpoints and scope them to a
base.

`GET /knowledges/graph` and `GET /knowledges/graph/labels` are registered above
`/:id` in `knowledge.controller.ts` and take no base id — they describe the whole
installation. They become `GET /knowledges/:id/graph` and
`GET /knowledges/:id/graph/labels`, served by that base's instance. The domain
gateway signatures (`getGraph()`, `getGraphLabels()`) gain the base id they
currently lack.

The agent-facing tool is already dynamically described per caller
(`IDynamicallyDescribedTool` in `knowledge.tool.ts`), so it lists only the
caller's bound bases — **verify** that the listing is built from
`effectiveKnowledgeIds` and never from a full base list, because that description
is exactly the surface the product answer forbids.

**Rationale**: FR-004 forbids discovering the *existence or contents* of an
unbound base through any tool. An endpoint that returns every entity in the
installation is that discovery, whether or not an answer quotes it.

---

## R6 — Honest per-source ingestion state

**Decision**: give `Source` its own state (`queued` / `processing` / `indexed` /
`failed`) plus a failure reason, driven by polling
`/documents/track_status/{trackId}` — an endpoint the client already calls in
`resolveDocIdsByTrackId`. A base reports ready only when every source is
`indexed` (FR-031), and one source failing does not stop the batch (FR-032).

**Rationale**: `indexed: record.lightragDocId !== null`
(`source/data/source.mapper.ts:29`) means "we handed it over", not "it is
searchable" — the source of the untrue status in retrospective §5. The
distinction becomes load-bearing during the transition, when "this base is
partially migrated" has to be visible.

**Alternatives considered**: a webhook from LightRAG (none exists); inferring
readiness from a query returning results (unreliable and expensive).

---

## R7 — The entity picker

**Decision**: `reka-ui`'s combobox with its virtualizer, already a dependency
(`reka-ui ^2.9.6`), fed by a base-scoped label endpoint that takes a search term
and a limit. Filtering happens in ranch-api because upstream's
`/graph/label/list` returns an unfiltered list.

**Rationale**: two multipliers made the page freeze — the list was
installation-wide (R5 removes that) and it rendered every label as a
`SelectItem` with no virtualization or search
(`admin/slices/reins/components/knowledge/graph/Provider.vue`). Removing one
without the other still leaves a busy base able to hang the page. No new
dependency is needed.

---

## R8 — The two UI defects

**Active tab** (`admin/slices/reins/pages/knowledges/[id].vue:100`): the active
class sets `border-primary text-foreground` while the static class sets
`border-transparent text-muted-foreground`. Two utilities set the same property
at equal specificity, so the winner is stylesheet order, not attribute order —
the static one wins and nothing highlights. **Decision**: use `NuxtLink`'s
`custom` slot and bind the class from `isActive`, so exactly one class set is
ever applied. The comparison case that survives today
(`setting/components/setting/nav/Menu.vue`) only survives because its active
class also sets a property the static class does not — worth noting so the fix
is not copied from the wrong place.

**Missing default section**: `pages/knowledges/[id].vue` renders a layout with
tabs but there is no `[id]/index.vue`, so `/knowledges/:id` shows an empty body.
**Decision**: add `[id]/index.vue` that renders the sources section (FR-027).

---

## R9 — Removing the settings nobody can interpret

**Decision**: drop `entityTypes` and `relationshipTypes` from the Prisma model,
the DTOs, the mapper and the admin types, then regenerate: `cd api && bun run
generate:swagger`, then `bun run build:api` in both `admin` and `app`.

**Rationale**: they have never been sent to the retrieval service in the
product's history — they are collected, stored and ignored (retrospective §4).
FR-020 removes settings with no effect rather than documenting them. This is a
contract change visible to both generated clients, which is why it is a planned
step and not incidental cleanup.

`Knowledge.workspace` is a second dead field — written as `'pending'` then
patched to `workspaceOf(id)` and never read. It stops being dead here: it becomes
the recorded name of the base's area, and the pure function stays the only place
that computes it.

---

## R10 — Testing

**Decision**: `api` runs Jest (`jest --passWithNoTests`) and already has
manifest-builder and gateway specs to copy from
(`agent-workflow.manifest.spec.ts`, `pod.gateway.spec.ts`). The slice has no
tests today (retrospective §7, item 17). This feature adds:

- unit tests for the retrieval-instance manifest builder, mirroring the agent one;
- unit tests for per-source state mapping and base readiness;
- an integration test for the isolation guarantee — two bases with disjoint
  facts, each queried for the other's — which is SC-001 executable;
- an adversarial set for SC-002: an agent bound to one base attempting to obtain
  the other's content or a description of it.

`admin` has no test runner (`admin test: no tests yet`); its acceptance stays
manual through `quickstart.md`.

**Rationale**: the isolation guarantee is the one thing in this feature that
cannot be verified by looking at a screen, and it is the thing the product owner
stated as a requirement. It gets an executable test or it is not delivered.

---

## Resolved unknowns

| Carried in | Resolved by |
|---|---|
| What arrangement pays for one retrieval process per isolated base | R1, R2 |
| Whether the transition can avoid re-processing | R3 — it cannot, and does not need to cost the operator anything |
| How an answer names its base | R4 |
| Whether "not seeing" needs more than query isolation | R5 — yes, the graph endpoints |
| How the picker stays responsive | R7 |
| Why the tab does not highlight | R8 |

**Open for verification on dev, not for decision** (each has a fallback that does
not change the design):

1. `emptyDir` suffices for `rag_storage` and `inputs` on a per-base instance
   (fallback: a small per-base PVC, which would force a re-costing of R1).
2. The tool description for `query_knowledge` is built only from the caller's
   bound bases (fallback: build it from `effectiveKnowledgeIds`).
3. Cross-namespace access from `agents` to `lightrag-postgres.platform` is open —
   no `NetworkPolicy` exists in `k8s/`, so this is expected to pass.

**Verification results (2026-08-27, T001–T003):**

1. **Verified live** against the local docker LightRAG (`ghcr.io/hkuds/lightrag`,
   all four storages on Postgres): after a successful text ingest and background
   processing, both `/app/data/rag_storage` and `/app/data/inputs` measured **0
   bytes**; after a container restart with those directories empty, `/query`
   still answered the ingested fact from Postgres. `emptyDir` is sufficient.
   *Caveat*: `/documents/upload` stages files into `inputs/` during processing —
   a pod rescheduled mid-ingest loses that staging copy, which per-source state
   already covers (the source never reaches `indexed` and is re-ingested).
2. **Verified in code**: `describeForRequest` in `knowledge.tool.ts` builds the
   listing from `resolveAllowedIds()` (agent's own ids, template fallback) and
   `findExistingByIds` — never from a full base list. No change needed.
3. **Verified statically**: no `NetworkPolicy` manifest anywhere in `k8s/`, none
   applied on the dev cluster. Final confirmation on the live cluster is an ops
   formality; nothing in the design depends on it.

**Pinned image (T003)**: `ghcr.io/hkuds/lightrag@sha256:ab23a9c83a735901b18c8960b6b482b602d5b6291abb7e07c5776f7bb2da504e`
(digest of `:latest` resolved 2026-08-27).
