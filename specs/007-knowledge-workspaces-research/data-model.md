# Phase 1 — data model

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

Entities are described as they become after this feature, with the current shape
alongside so a reviewer can see exactly what moves. Field names follow the
existing Prisma models in `api/src/slices/reins/`.

---

## Knowledge

The unit that answers. After this feature it is also the isolation boundary, so
its area and the state of that area belong on it.

### Today

```prisma
model Knowledge {
  id                String   @id @default(uuid())
  name              String
  description       String?
  workspace         String   @unique
  entityTypes       String[] @default([])
  relationshipTypes String[] @default([])
  indexStatus       String   @default("idle")
  indexError        String?
  indexedAt         DateTime?
  indexStartedAt    DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  sources           Source[]
  @@index([indexStatus])
}
```

### Changes

| Field | Change | Why |
|---|---|---|
| `entityTypes` | **removed** | Never sent to the retrieval service in the product's history; collected, stored, ignored (retrospective §4). FR-020 removes settings with no effect. Contract change — see `contracts/knowledge-api.md`. |
| `relationshipTypes` | **removed** | Same. |
| `workspace` | **kept, becomes load-bearing** | Written as `'pending'` then patched to `workspaceOf(id)` and never read at runtime. It becomes the recorded name of the base's retrieval area. `workspaceOf()` stays the only place that computes it; the column records what was actually provisioned, so a drift between the two is detectable rather than silent. |
| `instanceState` | **new** — `absent` \| `starting` \| `ready` \| `failed` \| `stopping` | An answer is only possible when the base's area is running. The operator needs this distinguished from "no content yet" (FR-029, FR-031). |
| `instanceError` | **new**, nullable | Why provisioning failed, in the interface rather than in logs. |
| `instanceEndpoint` | **new**, nullable | The in-cluster address of this base's instance. Derived and cached rather than recomputed on every call; null while `instanceState` is `absent`. |
| `migrationState` | **new** — `notStarted` \| `inProgress` \| `done` \| `failed` | Drives FR-036: a base that has not been re-processed reports its answers as incomplete. Becomes `done` for bases created after the transition. |
| `indexStatus` | kept | Stays the base-level rollup, but is now **derived** from its sources rather than set independently — see the state rules below. |

### State rules

- `indexStatus` is `ready` only when the base has at least one source and every
  source is `indexed` (FR-031). Any source `processing` → `indexing`. Any source
  `failed` with none processing → `partial`. No sources → `empty`.
- A base answers only when `instanceState = ready`. Otherwise the query returns
  the reason, never a generated answer from no context (FR-003, FR-029).
- While `migrationState != done`, every answer from the base carries the
  incomplete notice (FR-036).
- Deleting a base deletes its sources (existing cascade), stops its instance and
  removes its area's content. Deletion of one base must not touch another (US1,
  scenario 6).

### Validation

- `name` required; duplicates permitted but must be disambiguated wherever a base
  is picked or attributed (spec edge case).
- Creating a base is refused with a stated reason when cluster capacity has no
  room for another instance (FR-008 ceiling, research R2).

---

## Source

One piece of content in a base. Gains the state it has always implied.

### Today

```prisma
model Source {
  id            String    @id @default(uuid())
  knowledgeId   String
  knowledge     Knowledge @relation(fields: [knowledgeId], references: [id], onDelete: Cascade)
  type          String
  name          String
  url           String?
  mimeType      String?
  content       String?
  sizeBytes     Int?
  lightragDocId String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@index([knowledgeId])
  @@index([lightragDocId])
}
```

### Changes

| Field | Change | Why |
|---|---|---|
| `indexState` | **new** — `queued` \| `processing` \| `indexed` \| `failed` | `indexed: lightragDocId !== null` in `source.mapper.ts:29` means "handed over", not "searchable". This is the source of the untrue status in retrospective §5, and it is what makes the migration resumable. |
| `indexError` | **new**, nullable | The reason *this* source failed, so one failure in a batch is attributable (FR-030, FR-032). |
| `indexedAt` | **new**, nullable | When it actually became searchable. |
| `lightragDocId` | kept | Continues to hold the track id. During migration it is rewritten with the track id from the base's own instance; a source still holding its pre-migration id is the resume marker. |

### State transitions

```
queued ──▶ processing ──▶ indexed
   │            │
   └────────────┴──▶ failed ──(retry)──▶ queued
```

Driven by polling `/documents/track_status/{trackId}`, which the client already
calls in `resolveDocIdsByTrackId`. A source is never silently dropped: `failed`
is a terminal state the operator can see and retry.

### Re-processability

Every type is rebuildable from Ranch's own storage — this is what makes the
transition free for the operator (research R3):

| `type` | Rebuilt from | Failure mode to report |
|---|---|---|
| `text` | `content` | `content` null — data defect, report per source |
| `url` | re-fetch `url` | origin no longer resolves — report, do not drop |
| `file` | S3 download of `url` | object missing — report, do not drop |

---

## Retrieval instance *(new, not persisted as its own table)*

The running area for one base. It has a lifecycle but no independent identity:
exactly one per base, named by `workspaceOf(knowledgeId)`, addressed by a Service
named for the base. Its state lives on `Knowledge` (`instanceState`,
`instanceError`, `instanceEndpoint`) rather than in a table of its own, because a
row that can only ever be 1:1 with a base and cannot outlive it is a column set,
not an entity.

| Property | Value |
|---|---|
| Namespace | `agents` — where Argo already provisions |
| Workspace | `workspaceOf(knowledgeId)` = `knowledge_<uuid without dashes>` |
| Requests | one agent slot: 100m CPU, 512Mi (Burstable) |
| Limits | 2 CPU, 4Gi — headroom for ingest bursts |
| Storage | `emptyDir` for `rag_storage` and `inputs` (verify on dev, research R2) |
| Backend | shared `lightrag-postgres.platform`, all four storages Postgres |
| Address | `lightrag-kb-<baseId>.agents.svc:9621` |

**Invariant**: a base's content is reachable from exactly one area. During a
failed or interrupted migration a base may be *incompletely* migrated, but its
content is never simultaneously answerable from both the shared pool and its own
area — reads follow `migrationState`, and only one of the two is authoritative
at any moment.

---

## Binding *(unchanged in shape, corrected in behaviour)*

`Agent.knowledgeIds String[]` and `Template.defaultKnowledgeIds String[]` stay
as they are: an agent may hold several bases, a base may be read by several
agents, and the runtime resolution in `agent.controller.ts:273` — the agent's own
list, falling back to the template default — is unchanged.

What changes is that the binding finally means something. Today it selects which
bases the tool *names*, while retrieval reaches everything. After this feature it
is the only thing that decides what an agent can reach, and a base outside it is
neither readable nor enumerable (FR-004).

Neither array has a foreign key, so a deleted base leaves a dangling id. FR-013
makes that visible rather than silently dropped; adding referential integrity is
recorded in the retrospective's pattern list and is **not** in this feature's
scope.

---

## Migration record *(new)*

The one-time transition needs somewhere to resume from. It reuses what exists
rather than adding a table: per-base progress is `Knowledge.migrationState`, and
per-source progress is `Source.indexState` plus a `lightragDocId` that belongs to
the base's own instance. A restart re-reads both and continues.

The only genuinely new state is installation-level: whether the shared pool has
been decommissioned. That belongs with the other knowledge settings in the
`reins/config` gateway, not on any base.
