# Reins (LightRAG integration) — Design Spec

- **Status:** Draft (awaiting user review)
- **Author:** Claude + ntorbinskiy
- **Date:** 2026-04-23

## Context

Ranch is an agent deployment platform on Kubernetes. Agents need a Knowledge / RAG capability comparable to the one already shipping in Agentfy (the closed-source sibling). Agentfy built its own RAG stack manually: OpenSearch (vector store) + Neo4j (graph) + Bedrock (LLM) + Cohere (rerank), plus ~800 lines of entity/relationship/community extraction logic in `KnowledgesService`.

[LightRAG](https://github.com/HKUDS/LightRAG) (HKU-DS) replaces the entire custom stack with a single open-source service that ships the same capabilities out of the box (chunking, embeddings, entity/relationship extraction, community detection, dual-level retrieval).

**Reins** is a new CleanSlice slice inside Ranch that wraps LightRAG as a managed dependency, following the same pattern as the existing `bridle` slice (self-contained, can be pulled into other projects).

## Goals

- Provide a Knowledge feature in Ranch admin UI, feature-parity with Agentfy Knowledge (list / create / edit / sources / query).
- Replace all of Agentfy's custom RAG code with thin HTTP calls to LightRAG.
- Keep the slice self-contained so it can be extracted into another project (like `bridle`).
- Ship v1 with the minimum viable scope — no UI graph visualization, no multi-tenant, no background job queue.

## Non-goals (v1)

| Out of scope | Why |
|---|---|
| `app/slices/reins/` (user-facing frontend) | Users work with knowledge through agents; no standalone query page in v1 |
| Knowledge graph visualization in UI | Agentfy doesn't have it either; LightRAG exposes graph data but rendering is a separate effort |
| Team / user scoping | Ranch has no team model yet; add `teamId` when teams land |
| Background job queue (BullMQ) | In-process async task is enough; watchdog by `indexStatus` timestamp |
| LightRAG horizontal scaling | 1 replica in v1 |
| LLM providers other than OpenAI | LightRAG supports more, but extra configuration surface. v1 = OpenAI only |
| Cohere rerank | LightRAG's built-in scoring is sufficient for v1 |
| Embedded LightRAG WebUI in admin | Accessible only via `kubectl port-forward` for operators |
| OIDC / JWT between Ranch API and LightRAG | v1 uses static API key via env |
| Reading LLM keys from `LlmCredential` table | v1 reads `OPENAI_API_KEY` from env; move to credentials later |
| Soft-delete + cleanup job | Best-effort cascade delete with logged failures |

## High-level architecture

```
┌──────────── Ranch ──────────────────────┐
│                                         │
│  admin (Nuxt)      (no app/reins in v1) │
│   slices/reins  ──────────────┐         │
│                               ▼         │
│  api (NestJS)                           │
│   src/slices/reins/                     │
│    ├─ reins.controller                  │
│    ├─ domain/reins.gateway (abstract)   │
│    ├─ data/reins.gateway (Prisma)       │
│    ├─ data/lightrag.client (HTTP)       │
│    └─ reins.prisma (Knowledge + Source) │
│                                         │
│   Ranch Postgres                        │
│   (metadata: id, name, sourceIds,       │
│    config, indexStatus)                 │
│                     │                   │
│                     ▼ HTTP              │
│  LightRAG service                       │
│   ghcr.io/hkuds/lightrag                │
│   FastAPI :9621                         │
│                     │                   │
│                     ▼                   │
│  LightRAG Postgres                      │
│   (pgvector + AGE: chunks,              │
│    entities, relationships)             │
└─────────────────────────────────────────┘
```

**Key decisions**

- LightRAG runs as a separate container (docker-compose locally, k8s Deployment in prod).
- Two Postgres instances — Ranch's own + LightRAG's own. They must not share a database to avoid Prisma migrations touching LightRAG tables and to keep Reins portable.
- Frontend only talks to Ranch API. `LIGHTRAG_API_KEY` lives in Ranch API env; never exposed to the browser.
- Each `Knowledge` row maps to one LightRAG workspace (namespace-level isolation inside a single LightRAG instance).

## Backend slice: `api/src/slices/reins/`

```
api/src/slices/reins/
├── reins.prisma                 # Prisma model Knowledge + ReinsSource
├── reins.module.ts              # NestJS module
├── reins.controller.ts          # HTTP endpoints
├── domain/
│   ├── index.ts
│   ├── reins.types.ts           # IKnowledgeData, ICreateKnowledgeData, ...
│   ├── reins.gateway.ts         # abstract IReinsGateway
│   └── reins.service.ts         # orchestration (Prisma + LightRAG)
├── data/
│   ├── index.ts
│   ├── reins.gateway.ts         # concrete ReinsGateway (Prisma)
│   ├── reins.mapper.ts          # Prisma ↔ domain mapping
│   └── lightrag.client.ts       # HTTP client for LightRAG API (isolated)
└── dtos/
    ├── index.ts
    ├── knowledge.dto.ts
    ├── createKnowledge.dto.ts
    ├── updateKnowledge.dto.ts
    ├── filterKnowledge.dto.ts
    ├── queryKnowledge.dto.ts
    └── knowledgeRecord.dto.ts
```

**Responsibility split**

- `reins.controller` — HTTP routes, DTO validation, service calls.
- `reins.service` (domain) — orchestrates: persists metadata, invokes LightRAG via the client, manages index state machine.
- `reins.gateway` (abstract in `domain/`, concrete in `data/`) — access to Prisma tables.
- `lightrag.client` (data) — only HTTP calls to LightRAG. Isolated so a future LightRAG API change or replacement stays local.

**Sources** — a minimal `ReinsSource` model lives in the reins slice itself (no external sources slice dependency), keeping Reins portable.

## Data model (`reins.prisma`)

```prisma
model Knowledge {
  id                String   @id @default(uuid())
  name              String
  description       String?

  // LightRAG workspace name; stored explicitly for migrations
  workspace         String   @unique

  // Graph config (mirrors Agentfy)
  entityTypes       String[] @default([])
  relationshipTypes String[] @default([])

  // Last index run state
  indexStatus       String   @default("idle")    // idle | indexing | ready | failed
  indexError        String?
  indexedAt         DateTime?
  indexStartedAt    DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  sources           ReinsSource[]

  @@index([indexStatus])
}

model ReinsSource {
  id          String   @id @default(uuid())
  knowledgeId String
  knowledge   Knowledge @relation(fields: [knowledgeId], references: [id], onDelete: Cascade)

  type        String   // file | url | text
  name        String
  url         String?  // MinIO URL (file) or external URL (url)
  mimeType    String?
  content     String?  // inline content for type=text
  sizeBytes   Int?

  // doc_id returned by LightRAG on ingest — enables incremental re-index and deletion
  lightragDocId String?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([knowledgeId])
  @@index([lightragDocId])
}
```

**Notes**

- `workspace` is decoupled from `id` because LightRAG has formatting constraints on workspace names.
- `indexStatus` is a simple discriminated string. `indexStartedAt` enables a watchdog: if status is `indexing` and started more than N minutes ago, the UI allows a fresh re-index.
- No `teamId`/`userId` in v1 — will be added when Ranch's team model lands.

## API endpoints

| Method | Path | Description | `operationId` |
|---|---|---|---|
| `GET` | `/knowledges` | List with filter + pagination | `getKnowledges` |
| `GET` | `/knowledges/:id` | Fetch one | `getKnowledge` |
| `POST` | `/knowledges` | Create (no indexing) | `createKnowledge` |
| `PUT` | `/knowledges/:id` | Update config (name, graph types, description) | `updateKnowledge` |
| `DELETE` | `/knowledges/:id` | Delete (cascade Ranch + LightRAG + MinIO best-effort) | `deleteKnowledge` |
| `POST` | `/knowledges/:id/index` | Start/restart indexing (async 202) | `indexKnowledge` |
| `GET` | `/knowledges/:id/records` | Query via LightRAG (`?query=`, `?mode=`, `?topK=`) | `getKnowledgeRecords` |
| `GET` | `/knowledges/:id/sources` | List sources | `getKnowledgeSources` |
| `POST` | `/knowledges/:id/sources` | Add source (multipart file / JSON url / JSON text) | `addKnowledgeSource` |
| `DELETE` | `/knowledges/:id/sources/:sourceId` | Delete source | `deleteKnowledgeSource` |

**Async indexing**

- `POST /knowledges/:id/index` returns 202. Side effect: `indexStatus=indexing`, `indexStartedAt=now()`.
- A service method (fire-and-forget Promise, not awaited by the handler) iterates the Knowledge's sources, dispatching each to LightRAG based on type:
  - `file` → download from MinIO → `POST /documents/file`
  - `url` → `POST /documents/url`
  - `text` → `POST /documents/text`
- **Incremental**: sources where `lightragDocId IS NOT NULL` are skipped. New sources get their `lightragDocId` persisted after success.
- On completion: `indexStatus = ready`, `indexedAt = now()`. On failure: `indexStatus = failed`, `indexError = err.message`.
- Watchdog: the `POST /index` endpoint itself accepts a re-trigger if the current state is `indexing` and `indexStartedAt` is older than 10 minutes — it resets the state and starts a fresh run. No separate cron or timer; the stale state is cleared on the next user-initiated index.

**Query (`GET /records`)** — synchronous proxy to LightRAG `POST /query`. Response shape `{ pageContent, metadata }[]` matches Agentfy to allow frontend component reuse later.

**DTOs** — follow Ranch conventions (`@ApiProperty`, explicit types, no `any`/`as`), one file per DTO under `dtos/`.

## Admin frontend: `admin/slices/reins/`

Follows the current Ranch convention (split pages for list/create/edit, not Agentfy's dialog pattern).

```
admin/slices/reins/
├── nuxt.config.ts
├── pages.ts
├── i18n/locales/en.json
├── plugins/menu.ts                    # sidebar entry "Knowledge" (icon: Brain)
├── stores/knowledge.ts                # Pinia (optional, for shared state)
├── pages/
│   └── knowledges/
│       ├── index.vue                  # list
│       ├── create.vue                 # create form
│       └── [id]/
│           ├── edit.vue               # General tab
│           ├── sources.vue            # Sources tab
│           ├── graph.vue              # entityTypes / relationshipTypes
│           └── query.vue              # query test
└── components/
    ├── knowledge/
    │   ├── Form.vue                   # shared create/edit form
    │   └── IndexStatusBadge.vue
    ├── knowledgeList/Provider.vue
    ├── knowledgeCreate/Provider.vue
    ├── knowledgeEdit/Provider.vue
    ├── knowledgeSources/
    │   ├── Provider.vue
    │   └── AddDialog.vue              # file / url / text
    └── knowledgeQuery/Provider.vue    # query input + result cards
```

**Pages**

- `knowledges/index.vue` — table (Name / Source count / Status badge / Updated / Actions), search, Create button, pagination.
- `knowledges/create.vue` — `KnowledgeForm` with name + description only. Graph config is edited after creation.
- `knowledges/[id]/edit.vue` — tab layout (General / Sources / Graph / Query) via separate routes. Top bar has `[Index]` button, disabled while `indexStatus === 'indexing'`.

**Polling** — `useIntervalFn` on the edit page polls `GET /knowledges/:id` every 3 seconds while `indexStatus === 'indexing'`. Stops once the status changes. No websockets in v1.

**i18n** — only `en.json`; Ranch admin currently has no Russian locale.

## App frontend

**Not built in v1.** Users interact with knowledge through agents, not through a dedicated page in `app/`. Ranch API `/knowledges/:id/records` is reachable from agent pods (out of scope for v1 UI work).

## Deployment

### Local (`api/docker-compose.yml`)

Two new services alongside the existing `postgres-local` + `minio` + `minio-init`:

```yaml
lightrag-postgres:
  image: shangor/postgres-for-rag:v1.0
  container_name: ranch-lightrag-postgres
  ports:
    - '5433:5432'
  environment:
    POSTGRES_USER: lightrag
    POSTGRES_PASSWORD: lightrag
    POSTGRES_DB: lightrag
  volumes:
    - ./docker/lightrag-postgres:/var/lib/postgresql/data
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U lightrag']
    interval: 5s
    timeout: 5s
    retries: 5

lightrag:
  image: ghcr.io/hkuds/lightrag:latest
  container_name: ranch-lightrag
  ports:
    - '9621:9621'
  environment:
    LIGHTRAG_API_KEY: ${LIGHTRAG_API_KEY}
    LLM_BINDING: openai
    LLM_MODEL: gpt-4o-mini
    LLM_BINDING_API_KEY: ${OPENAI_API_KEY}
    EMBEDDING_BINDING: openai
    EMBEDDING_MODEL: text-embedding-3-small
    EMBEDDING_BINDING_API_KEY: ${OPENAI_API_KEY}
    POSTGRES_HOST: lightrag-postgres
    POSTGRES_PORT: 5432
    POSTGRES_USER: lightrag
    POSTGRES_PASSWORD: lightrag
    POSTGRES_DATABASE: lightrag
    LIGHTRAG_KV_STORAGE: PGKVStorage
    LIGHTRAG_DOC_STATUS_STORAGE: PGDocStatusStorage
    LIGHTRAG_VECTOR_STORAGE: PGVectorStorage
    LIGHTRAG_GRAPH_STORAGE: PGGraphStorage
  depends_on:
    lightrag-postgres:
      condition: service_healthy
  volumes:
    - ./docker/lightrag-data:/app/data/rag_storage
    - ./docker/lightrag-inputs:/app/data/inputs
```

`shangor/postgres-for-rag` ships Postgres 16 + pgvector + Apache AGE preconfigured — the image LightRAG docs recommend.

### Env (`api/.env.dev`)

```
LIGHTRAG_URL=http://localhost:9621
LIGHTRAG_API_KEY=dev-secret-change-me
OPENAI_API_KEY=sk-...
```

Ranch API reads `LIGHTRAG_URL` + `LIGHTRAG_API_KEY`. `OPENAI_API_KEY` is used by LightRAG only (not by Ranch API in v1).

### MinIO

Reins stores uploaded source files in a dedicated bucket `ranch-reins-sources`. A new entry is added to `minio-init` in `docker-compose.yml` (alongside the existing `ranch-agent-data` bucket).

### Kubernetes (`k8s/platform/lightrag/`)

```
k8s/platform/lightrag/
├── deployment.yaml        # LightRAG FastAPI Deployment (replicas: 1)
├── postgres.yaml          # CNPG Cluster with pgvector + AGE extensions
├── service.yaml           # ClusterIP service on :9621
└── secret.yaml            # referenced; real values provisioned via `make k8s-secrets`
```

- No Ingress — LightRAG is not exposed publicly. Ranch API reaches it via `http://lightrag.platform.svc.cluster.local:9621`.
- CNPG Cluster is separate from Ranch's DB cluster. Extensions enabled via `postInitApplicationSQL`.
- An entry for `k8s/platform/lightrag/` is added to `k8s/argocd/app-of-apps.yaml` so ArgoCD picks it up.

### Makefile

Add one convenience target:

```makefile
lightrag-logs:
	docker compose -f api/docker-compose.yml logs -f lightrag
```

`make dev` already covers the docker-compose lifecycle — no other Makefile changes needed.

## Failure modes and recovery

| Failure | Handling |
|---|---|
| LightRAG unreachable during query | API returns 503 with message; UI shows "service unavailable" |
| Index task crashes mid-flight | `indexStatus` stays `indexing`; watchdog detects staleness after 10 min |
| Source file missing from MinIO during index | Source marked failed (logged), others continue; overall `indexStatus = failed` with partial message |
| LightRAG delete fails on `DELETE /knowledges/:id` | Ranch row is still removed; failure logged; orphan workspace remains in LightRAG (acceptable in v1 — no cleanup job) |
| Duplicate ingest on re-index | Prevented by `lightragDocId` check — only sources without a doc id are dispatched |

## Security

- `LIGHTRAG_API_KEY` is a static secret shared between Ranch API and LightRAG, stored in env (local) and k8s Secret (prod).
- LightRAG itself is only reachable on the cluster-internal network; public access is blocked at Ingress level.
- Uploaded source files are stored in MinIO with signed URLs (reuse existing Ranch pattern for agent-data bucket).
- No PII-specific handling in v1 beyond standard Ranch auth on `/knowledges/*` routes.

## Testing strategy

- Unit tests for `reins.service` — mock `ILightragClient`, verify state transitions (idle → indexing → ready/failed) and incremental logic.
- Unit tests for `lightrag.client` — mock `fetch`, verify request shape and error mapping.
- Integration test (optional in v1) — spin up LightRAG via docker-compose in CI and run a full ingest/query round-trip.
- No end-to-end test for admin UI in v1.

## Migration / rollout

New slice; no existing data. Steps:

1. `make generate` merges `reins.prisma` into the combined schema.
2. `make migrate` creates initial Prisma migration with the two tables.
3. First deploy of LightRAG via ArgoCD provisions LightRAG Postgres + Deployment.
4. LightRAG on first run initializes its own schema inside its Postgres (handled by the image).

No backfill or data migration from Agentfy — this is a fresh start in Ranch.

## Open follow-ups (post-v1)

- Read LLM credentials from `LlmCredential` table instead of env.
- Team/user scoping once Ranch introduces teams.
- Graph visualization page (`knowledges/[id]/graph-view`).
- `app/slices/reins/` if a user-facing query page becomes needed.
- Cleanup job for orphaned LightRAG workspaces and MinIO files.
- Evaluate background queue (BullMQ) once indexing workloads grow.
