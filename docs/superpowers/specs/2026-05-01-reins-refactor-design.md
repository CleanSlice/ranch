# Reins slice refactor: split into knowledge / source / config / lightrag

**Status:** approved
**Date:** 2026-05-01
**Branch:** `feat/reins-lightrag`

## Problem

The `reins/` slice currently mixes four concerns in one flat module: knowledge CRUD, source CRUD, knowledge-service config (LightRAG URL/apiKey/bucket/enabled flag), and the LightRAG HTTP client. The single `ReinsGateway` has 13 methods spanning all of these. Knowledge and Source IDs are bare UUIDs without a slice prefix, breaking the project convention (agents are `agent-<uuid>`). A partial refactor in-progress on this branch already created `reins/knowledge/` but left files named `reins.*` and the source/config sub-slices empty.

## Decisions

| Decision | Choice |
|---|---|
| ID prefix | `knowledge-<uuid>` and `source-<uuid>` |
| Split scope | Full split: 4 sub-slices |
| Existing data | Dev-only `prisma migrate reset` — no production data exists |
| Source HTTP routing | Unchanged: `@Controller('knowledges/:knowledgeId/sources')` lives in `source/` |
| Config slice | Pure service slice — no controller, no prisma, exports `IKnowledgeConfigService` |
| LightRAG location | Own slice `reins/lightrag/` — used by both knowledge and source |

## Target structure

```
api/src/slices/reins/
├── knowledge/
│   ├── knowledge.controller.ts        # /knowledges (list/get/create/update/delete/index/query/graph/status)
│   ├── knowledge.module.ts
│   ├── knowledge.prisma                # model Knowledge only
│   ├── data/
│   │   ├── knowledge.gateway.ts        # impl
│   │   └── knowledge.mapper.ts         # toEntity + toCreate (id: 'knowledge-' + uuid)
│   ├── domain/
│   │   ├── knowledge.gateway.ts        # interface (abstract class)
│   │   ├── knowledge.service.ts
│   │   ├── knowledge.types.ts
│   │   ├── workspace.ts                # pure: workspaceOf(id)
│   │   └── index.ts
│   └── dtos/
│       ├── createKnowledge.dto.ts
│       ├── filterKnowledge.dto.ts
│       ├── getGraph.dto.ts
│       ├── graph.dto.ts
│       ├── knowledge.dto.ts
│       ├── knowledgeRecord.dto.ts
│       ├── queryKnowledge.dto.ts
│       ├── updateKnowledge.dto.ts
│       └── index.ts
├── source/
│   ├── source.controller.ts            # @Controller('knowledges/:knowledgeId/sources')
│   ├── source.module.ts
│   ├── source.prisma                   # model Source only (FK on Knowledge)
│   ├── data/
│   │   ├── source.gateway.ts           # impl
│   │   └── source.mapper.ts            # toEntity + toCreate (id: 'source-' + uuid)
│   ├── domain/
│   │   ├── source.gateway.ts
│   │   ├── source.service.ts
│   │   ├── source.types.ts
│   │   └── index.ts
│   └── dtos/
│       ├── createSource.dto.ts
│       ├── source.dto.ts
│       └── index.ts
├── config/
│   ├── config.module.ts                # exports IKnowledgeConfigService
│   ├── data/
│   │   └── knowledgeConfig.service.ts  # impl (reads from settings + env)
│   └── domain/
│       ├── knowledgeConfig.service.ts  # interface (abstract class)
│       └── index.ts
└── lightrag/
    ├── lightrag.module.ts              # exports ILightragClient
    ├── data/
    │   └── lightragHttp.client.ts      # impl (HTTP)
    └── domain/
        ├── lightrag.client.ts          # interface (abstract class)
        ├── lightrag.types.ts
        └── index.ts
```

Deleted: `reins/reins.controller.ts`, `reins/reins.module.ts`, `reins/reins.prisma`. Moved out of `knowledge/`: both `knowledgeConfig.service.ts` files (→ `config/`), the `repositories/lightrag/` subtree (→ `lightrag/`), and the source DTOs (→ `source/dtos/`). Renamed in place inside `knowledge/`: `reins.gateway.ts` → `knowledge.gateway.ts`, `reins.service.ts` → `knowledge.service.ts`, `reins.types.ts` → `knowledge.types.ts`, `reins.mapper.ts` → `knowledge.mapper.ts`.

## Prisma split

`reins/reins.prisma` is removed. Two replacement files use cross-file relation imports (same pattern as `agent/agent/agent.prisma` ↔ `agent/template/template.prisma`):

`knowledge/knowledge.prisma`:
```prisma
import { Source } from "../source/source"

model Knowledge {
  id                String        @id @default(uuid())
  name              String
  description       String?
  workspace         String        @unique
  entityTypes       String[]      @default([])
  relationshipTypes String[]      @default([])
  indexStatus       String        @default("idle")
  indexError        String?
  indexedAt         DateTime?
  indexStartedAt    DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  sources           Source[]

  @@index([indexStatus])
}
```

`source/source.prisma`:
```prisma
import { Knowledge } from "../knowledge/knowledge"

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

After both files exist: `prisma migrate reset && prisma migrate dev --name reins_split`.

## ID prefix

Prisma columns keep `String @id @default(uuid())` as a fallback. The actual ID is set in the mapper's `toCreate*` method, mirroring `agent.mapper.ts:25`:

```ts
// knowledge/data/knowledge.mapper.ts
toCreate(data: ICreateKnowledgeData) {
  return {
    id: `knowledge-${crypto.randomUUID()}`,
    name: data.name,
    description: data.description ?? null,
    entityTypes: data.entityTypes ?? [],
    relationshipTypes: data.relationshipTypes ?? [],
    workspace: 'pending',
  };
}

// source/data/source.mapper.ts
toCreate(data: ICreateSourceData) {
  return {
    id: `source-${crypto.randomUUID()}`,
    knowledgeId: data.knowledgeId,
    type: data.type,
    name: data.name,
    url: data.url ?? null,
    mimeType: data.mimeType ?? null,
    content: data.content ?? null,
    sizeBytes: data.sizeBytes ?? null,
  };
}
```

`workspaceOf(id) = knowledge_${id.replace(/-/g, '')}` continues to work — it strips all dashes, so a prefixed ID becomes `knowledge_knowledgexxxxxxxxxxxxxxxx` (no functional change).

## Module wiring

Linear dependency chain (no cycles):

```
ConfigModule        — exports IKnowledgeConfigService
    ↑
LightragModule      — imports ConfigModule; exports ILightragClient
    ↑
SourceModule        — imports ConfigModule, LightragModule, AwsModule, PrismaModule
    ↑
KnowledgeModule     — imports ConfigModule, LightragModule, SourceModule, PrismaModule
```

`SourceModule` never imports `KnowledgeModule`. The only thing source needs from knowledge is `workspaceOf(id)`, a pure function imported as a TypeScript symbol from `knowledge/domain/workspace.ts` — no runtime DI.

`KnowledgeModule` imports `SourceModule` so `KnowledgeService.deleteKnowledge` can call `SourceService.removeAllByKnowledge(id)` to clean up LightRAG documents before Prisma's cascade removes the rows.

`SourceModule` does NOT import `KnowledgeModule`. The only thing source needs from knowledge is `workspaceOf(id)`, which is a pure function imported as a TypeScript symbol from `knowledge/domain/workspace.ts`. No DI coupling.

`KnowledgeModule` imports `SourceModule` so that `KnowledgeController.deleteKnowledge` (or `KnowledgeService.deleteKnowledge`) can call `SourceService.removeAllByKnowledge(id)` to clean up LightRAG documents before the Prisma cascade deletes the rows.

```ts
// config/config.module.ts
@Module({
  imports: [ConfigModule, SettingModule],
  providers: [{ provide: IKnowledgeConfigService, useClass: KnowledgeConfigService }],
  exports: [IKnowledgeConfigService],
})
export class ConfigModule {}

// lightrag/lightrag.module.ts
@Module({
  imports: [ConfigModule],
  providers: [{
    provide: ILightragClient,
    inject: [IKnowledgeConfigService],
    useFactory: (cfg: IKnowledgeConfigService) =>
      new LightragHttpClient({
        resolveConfig: async () => {
          const c = await cfg.resolve();
          return { url: c.url, apiKey: c.apiKey, enabled: c.enabled };
        },
      }),
  }],
  exports: [ILightragClient],
})
export class LightragModule {}

// knowledge/knowledge.module.ts
@Module({
  imports: [PrismaModule, ConfigModule, LightragModule, SourceModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeMapper,
    KnowledgeService,
    { provide: IKnowledgeGateway, useClass: KnowledgeGateway },
  ],
  exports: [IKnowledgeGateway, KnowledgeService],
})
export class KnowledgeModule {}

// source/source.module.ts
@Module({
  imports: [PrismaModule, ConfigModule, LightragModule, AwsModule],
  controllers: [SourceController],
  providers: [
    SourceMapper,
    SourceService,
    { provide: ISourceGateway, useClass: SourceGateway },
  ],
  exports: [ISourceGateway, SourceService],
})
export class SourceModule {}
```

`AppModule` replaces `ReinsModule` with `KnowledgeModule` and `SourceModule`. `ConfigModule` and `LightragModule` come transitively.

## Gateway responsibilities

**`IKnowledgeGateway`:**
- `findAll(): Promise<IKnowledgeData[]>`
- `findById(id): Promise<IKnowledgeData | null>`
- `create(data): Promise<IKnowledgeData>`
- `update(id, data): Promise<IKnowledgeData>`
- `delete(id): Promise<void>`
- `updateIndexState(id, patch): Promise<IKnowledgeData>`
- `searchKnowledge(id, query, mode?, topK?): Promise<IKnowledgeQueryResult>` — uses `ILightragClient`
- `getGraph(params): Promise<IGraphData>` — uses `ILightragClient`
- `getGraphLabels(): Promise<string[]>` — uses `ILightragClient`

**`ISourceGateway`:**
- `findByKnowledgeId(knowledgeId): Promise<ISourceData[]>`
- `findById(id): Promise<ISourceData | null>`
- `create(data): Promise<ISourceData>`
- `delete(id): Promise<void>`
- `uploadFile(input): Promise<IUploadedSourceFile>` — S3 + bucket from config
- `deleteFile(url): Promise<void>` — S3
- `indexSource(source): Promise<void>` — LightRAG ingest, persist `lightragDocId`
- `removeFromIndex(source): Promise<void>` — LightRAG delete
- `removeAllByKnowledge(knowledgeId): Promise<void>` — bulk LightRAG cleanup before cascade

`workspaceOfKnowledge` (private DB lookup in current `ReinsGateway`) is replaced everywhere by the pure `workspaceOf(id)` function.

## Controller split

**`knowledge/knowledge.controller.ts`** — `@Controller('knowledges')`, `@ApiTags('knowledges')`:
| Verb | Path | operationId |
|---|---|---|
| GET | `/knowledges` | `getKnowledges` |
| GET | `/knowledges/status` | `getKnowledgeStatus` |
| GET | `/knowledges/graph/labels` | `getGraphLabels` |
| GET | `/knowledges/graph` | `getGraph` |
| GET | `/knowledges/:id` | `getKnowledge` |
| POST | `/knowledges` | `createKnowledge` |
| PUT | `/knowledges/:id` | `updateKnowledge` |
| DELETE | `/knowledges/:id` | `deleteKnowledge` |
| POST | `/knowledges/:id/index` | `indexKnowledge` |
| POST | `/knowledges/:id/query` | `queryKnowledge` |

`getKnowledgeStatus` and `getKnowledges` (which returns `[]` when service disabled) inject `IKnowledgeConfigService` from `ConfigModule`.

**`source/source.controller.ts`** — `@Controller('knowledges/:knowledgeId/sources')`, `@ApiTags('knowledge-sources')`:
| Verb | Path | operationId |
|---|---|---|
| GET | `/knowledges/:knowledgeId/sources` | `getKnowledgeSources` |
| POST | `/knowledges/:knowledgeId/sources` | `addKnowledgeSource` |
| DELETE | `/knowledges/:knowledgeId/sources/:sourceId` | `deleteKnowledgeSource` |

URLs are unchanged from `reins.controller.ts`. `operationId`s are preserved → admin/app generated client `client.gen.ts` regenerates with the same method names; no manual frontend changes needed.

## Cleanup ordering on Knowledge delete

Cascade is on Prisma's `onDelete: Cascade` for `Source.knowledgeId`. Before the Knowledge row is deleted, LightRAG documents must be removed (otherwise they leak — Source rows are gone but LightRAG still has them). Order in `KnowledgeService.deleteKnowledge(id)`:

1. `sourceService.removeAllByKnowledge(id)` — LightRAG delete by `lightragDocId`s
2. `knowledgeGateway.delete(id)` — Prisma cascade removes Source rows

`KnowledgeModule` imports `SourceModule` and injects `SourceService` directly. No `forwardRef` needed because `SourceModule` does not import `KnowledgeModule`.

## Out of scope

- `Template.defaultKnowledgeIds` data migration — not needed (dev-only reset).
- LightRAG client optimization, retry policies, request tracing.
- Tests — project has no test infrastructure.
- Frontend admin/app changes beyond regenerated `client.gen.ts`.
- The `Knowledge.workspace` DB column stays (kept for the `@unique` constraint), but is no longer read at runtime since `workspaceOf(id)` is deterministic.

## Risks

- **Prisma cross-file imports** — verified working in `agent/agent/agent.prisma` ↔ `agent/template/template.prisma`. No new risk.
- **Module circularity** — avoided by making `workspaceOf` a pure function and the cleanup direction one-way (Knowledge → Source).
- **Swagger tag grouping** — `'knowledges'` and `'knowledge-sources'` tags are new. Generated `client.gen.ts` will have a new tag block, which may shuffle the file. This is a generated artifact; no manual reconciliation expected.
- **Generated client churn on admin/app** — already modified in working tree (see `git status`). Will be regenerated again after this refactor.

## Verification

After implementation, in browser at `/admin/knowledges`:
1. Create a knowledge — DB row has `id` starting with `knowledge-`.
2. Add a file source — DB row has `id` starting with `source-`. File lands in S3 under `knowledge-<id>/...`.
3. Add a URL source.
4. Add a text source.
5. Run index — `lightragDocId` populates on each Source row.
6. Run query — returns LightRAG response.
7. Delete a single source — LightRAG document gone.
8. Delete the knowledge — all sources gone, all LightRAG documents gone.
9. `GET /knowledges/status` returns `{ enabled: true }` when configured.
10. Toggle `enabled = false` in settings — `GET /knowledges` returns `[]`.
