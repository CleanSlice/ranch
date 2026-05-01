# Reins Slice Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `api/src/slices/reins/` into 4 sub-slices (`knowledge/`, `source/`, `config/`, `lightrag/`), add `knowledge-{uuid}` / `source-{uuid}` ID prefixes, and align with the established `agent/` group-slice pattern.

**Architecture:** One-way module dependency chain `Config ← Lightrag ← Source ← Knowledge`. `workspaceOf(id)` is a pure TS function in `knowledge/domain/workspace.ts` that `Source` imports — no DI cycle. `KnowledgeService.deleteKnowledge` calls `SourceService.removeAllByKnowledge(id)` to clean up LightRAG documents before Prisma cascade removes Source rows.

**Tech Stack:** NestJS, Prisma 6 (multi-file via `prisma-import`), TypeScript strict, S3 (existing `#/aws/s3`), LightRAG HTTP API.

**Spec:** [`docs/superpowers/specs/2026-05-01-reins-refactor-design.md`](../specs/2026-05-01-reins-refactor-design.md)

**Branch:** `feat/reins-lightrag` (already pulled main)

**No tests in this codebase.** Verification is via TypeScript compilation, dev-server boot, and a browser smoke test against `/admin/knowledges`.

---

## Task 1: Pre-flight — CleanSlice MCP consultation

Per `~/.claude/CLAUDE.md`, MCP must be consulted before any code change.

**Files:** none modified.

- [ ] **Step 1: Load core conventions**

Run: `mcp__cleanslice__get-started`
Run: `mcp__cleanslice__list-categories`

- [ ] **Step 2: Search for slice-split patterns**

Run: `mcp__cleanslice__search` with queries:
1. "group slice with multiple sub-slices controller gateway mapper layout"
2. "cross-slice dependencies forwardRef cycles workspace utility pure function"

If snippets are unclear, follow up with `mcp__cleanslice__read-doc` on the most relevant document.

- [ ] **Step 3: Confirm conventions match the spec**

Compare what MCP returned with the spec's structure. If MCP recommends a different layout (e.g., separate `index.ts` per layer, different mapper signature), apply MCP's guidance and note the deviation in the PR description. Otherwise, proceed.

---

## Task 2: Create `config/` sub-slice

Move `IKnowledgeConfigService` interface + `KnowledgeConfigService` impl out of `knowledge/` into a dedicated config slice that has no controller and no Prisma model.

**Files:**
- Create: `api/src/slices/reins/config/domain/knowledgeConfig.service.ts`
- Create: `api/src/slices/reins/config/domain/index.ts`
- Create: `api/src/slices/reins/config/data/knowledgeConfig.service.ts`
- Create: `api/src/slices/reins/config/config.module.ts`
- Delete: `api/src/slices/reins/knowledge/domain/knowledgeConfig.service.ts`
- Delete: `api/src/slices/reins/knowledge/data/knowledgeConfig.service.ts`

- [ ] **Step 1: Create config interface**

Write `api/src/slices/reins/config/domain/knowledgeConfig.service.ts`:

```ts
export interface IKnowledgeConfig {
  url: string;
  apiKey: string;
  bucket: string;
  enabled: boolean;
}

export abstract class IKnowledgeConfigService {
  abstract resolve(): Promise<IKnowledgeConfig>;
  abstract isEnabled(): Promise<boolean>;
}
```

- [ ] **Step 2: Create config domain barrel**

Write `api/src/slices/reins/config/domain/index.ts`:

```ts
export * from './knowledgeConfig.service';
```

- [ ] **Step 3: Create config impl**

Write `api/src/slices/reins/config/data/knowledgeConfig.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISettingGateway } from '#/setting/domain';
import {
  IKnowledgeConfig,
  IKnowledgeConfigService,
} from '../domain/knowledgeConfig.service';

const SETTING_GROUP = 'knowledge';

@Injectable()
export class KnowledgeConfigService extends IKnowledgeConfigService {
  constructor(
    private readonly settings: ISettingGateway,
    private readonly env: ConfigService,
  ) {
    super();
  }

  async resolve(): Promise<IKnowledgeConfig> {
    const [urlSetting, apiKeySetting, bucketSetting, enabledSetting] =
      await Promise.all([
        this.settings.findByKey(SETTING_GROUP, 'url'),
        this.settings.findByKey(SETTING_GROUP, 'api_key'),
        this.settings.findByKey(SETTING_GROUP, 's3_bucket'),
        this.settings.findByKey(SETTING_GROUP, 'enabled'),
      ]);

    const url =
      readString(urlSetting?.value) ?? this.env.get<string>('LIGHTRAG_URL', '');
    const apiKey =
      readString(apiKeySetting?.value) ??
      this.env.get<string>('LIGHTRAG_API_KEY', '');
    const bucket =
      readString(bucketSetting?.value) ??
      this.env.get<string>('REINS_S3_BUCKET', '');

    const explicitFlag = readBoolean(enabledSetting?.value);
    const allowed = explicitFlag !== false;
    const enabled = allowed && url.length > 0;

    return { url, apiKey, bucket, enabled };
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.resolve();
    return config.enabled;
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}
```

- [ ] **Step 4: Create config module**

Write `api/src/slices/reins/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { SettingModule } from '#/setting/setting.module';
import { IKnowledgeConfigService } from './domain/knowledgeConfig.service';
import { KnowledgeConfigService } from './data/knowledgeConfig.service';

@Module({
  imports: [NestConfigModule, SettingModule],
  providers: [
    { provide: IKnowledgeConfigService, useClass: KnowledgeConfigService },
  ],
  exports: [IKnowledgeConfigService],
})
export class ConfigModule {}
```

- [ ] **Step 5: Delete the obsolete copies inside `knowledge/`**

```bash
rm api/src/slices/reins/knowledge/domain/knowledgeConfig.service.ts
rm api/src/slices/reins/knowledge/data/knowledgeConfig.service.ts
```

- [ ] **Step 6: Update consumers' imports**

The consumers right now point to `knowledge/domain/knowledgeConfig.service`. They must point to the new path. Patch in place — every later task either rewrites these files entirely or expects them to compile.

In `api/src/slices/reins/reins.controller.ts`, replace:
```ts
import { IKnowledgeConfigService } from './domain/knowledgeConfig.service';
```
with:
```ts
import { IKnowledgeConfigService } from './config/domain/knowledgeConfig.service';
```

In `api/src/slices/reins/reins.module.ts`, replace:
```ts
import { IKnowledgeConfigService } from './domain/knowledgeConfig.service';
import { KnowledgeConfigService } from './data/knowledgeConfig.service';
```
with:
```ts
import { IKnowledgeConfigService } from './config/domain/knowledgeConfig.service';
import { KnowledgeConfigService } from './config/data/knowledgeConfig.service';
```

In `api/src/slices/reins/knowledge/data/reins.gateway.ts`, replace:
```ts
import { IKnowledgeConfigService } from '../domain/knowledgeConfig.service';
```
with:
```ts
import { IKnowledgeConfigService } from '../../config/domain/knowledgeConfig.service';
```

In `api/src/slices/reins/knowledge/domain/index.ts`, remove the `export * from './knowledgeConfig.service';` line. New content:
```ts
export * from './reins.types';
export * from './reins.gateway';
export * from './reins.service';
```

- [ ] **Step 7: Verify it compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add api/src/slices/reins/config api/src/slices/reins/knowledge/data/knowledgeConfig.service.ts api/src/slices/reins/knowledge/domain/knowledgeConfig.service.ts api/src/slices/reins/knowledge/domain/index.ts api/src/slices/reins/knowledge/data/reins.gateway.ts api/src/slices/reins/reins.controller.ts api/src/slices/reins/reins.module.ts
git commit -m "refactor(reins): extract knowledgeConfig into reins/config sub-slice"
```

---

## Task 3: Create `lightrag/` sub-slice

Move LightRAG client (interface + HTTP impl + types) from `knowledge/data/repositories/lightrag/` into a dedicated slice. Used by both `knowledge/` and `source/`.

**Files:**
- Create: `api/src/slices/reins/lightrag/domain/lightrag.client.ts`
- Create: `api/src/slices/reins/lightrag/domain/lightrag.types.ts`
- Create: `api/src/slices/reins/lightrag/domain/index.ts`
- Create: `api/src/slices/reins/lightrag/data/lightragHttp.client.ts`
- Create: `api/src/slices/reins/lightrag/lightrag.module.ts`
- Delete: `api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.client.ts`
- Delete: `api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.types.ts`
- Delete: `api/src/slices/reins/knowledge/data/repositories/lightrag/lightragHttp.client.ts`
- Delete: `api/src/slices/reins/knowledge/data/repositories/lightrag/index.ts`
- Delete: `api/src/slices/reins/knowledge/data/repositories/` (empty after above)

- [ ] **Step 1: Move interface + types**

```bash
mv api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.client.ts api/src/slices/reins/lightrag/domain/lightrag.client.ts
mv api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.types.ts api/src/slices/reins/lightrag/domain/lightrag.types.ts
```

(`mv` will fail unless the destination directory exists.)

```bash
mkdir -p api/src/slices/reins/lightrag/domain api/src/slices/reins/lightrag/data
mv api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.client.ts api/src/slices/reins/lightrag/domain/lightrag.client.ts
mv api/src/slices/reins/knowledge/data/repositories/lightrag/lightrag.types.ts api/src/slices/reins/lightrag/domain/lightrag.types.ts
mv api/src/slices/reins/knowledge/data/repositories/lightrag/lightragHttp.client.ts api/src/slices/reins/lightrag/data/lightragHttp.client.ts
rm api/src/slices/reins/knowledge/data/repositories/lightrag/index.ts
rmdir api/src/slices/reins/knowledge/data/repositories/lightrag api/src/slices/reins/knowledge/data/repositories
```

- [ ] **Step 2: Fix imports inside moved impl**

`api/src/slices/reins/lightrag/data/lightragHttp.client.ts` previously imported `./lightrag.client` and `./lightrag.types` (sibling). Now siblings live in `../domain/`. Update at the top:

```ts
import { ILightragClient } from '../domain/lightrag.client';
// (or whatever the file currently imports — change every relative path
//  that pointed at './lightrag.types' or './lightrag.client' to '../domain/...')
```

Read the file once and patch every `from './lightrag.` import to `from '../domain/lightrag.`.

- [ ] **Step 3: Create domain barrel**

Write `api/src/slices/reins/lightrag/domain/index.ts`:

```ts
export * from './lightrag.client';
export * from './lightrag.types';
```

- [ ] **Step 4: Create LightragModule**

Write `api/src/slices/reins/lightrag/lightrag.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { IKnowledgeConfigService } from '../config/domain/knowledgeConfig.service';
import { ILightragClient } from './domain/lightrag.client';
import { LightragHttpClient } from './data/lightragHttp.client';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ILightragClient,
      inject: [IKnowledgeConfigService],
      useFactory: (cfg: IKnowledgeConfigService) =>
        new LightragHttpClient({
          resolveConfig: async () => {
            const c = await cfg.resolve();
            return { url: c.url, apiKey: c.apiKey, enabled: c.enabled };
          },
        }),
    },
  ],
  exports: [ILightragClient],
})
export class LightragModule {}
```

- [ ] **Step 5: Update consumers' imports**

In `api/src/slices/reins/knowledge/data/reins.gateway.ts`, replace:
```ts
import { ILightragClient } from './repositories/lightrag/lightrag.client';
```
with:
```ts
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
```

In `api/src/slices/reins/reins.module.ts`, replace these two lines:
```ts
import { ILightragClient } from './data/repositories/lightrag/lightrag.client';
import { LightragHttpClient } from './data/repositories/lightrag/lightragHttp.client';
```
with the module-level import:
```ts
import { LightragModule } from './lightrag/lightrag.module';
```
And in the `@Module({ imports: ... })`, replace the inline `ILightragClient` factory provider with importing `LightragModule`. Concretely, the `@Module` block becomes:

```ts
@Module({
  imports: [ConfigModule, PrismaModule, AwsModule, SettingModule, LightragModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    {
      provide: IReinsGateway,
      inject: [
        PrismaService,
        ReinsMapper,
        ILightragClient,
        S3Repository,
        IKnowledgeConfigService,
      ],
      useFactory: (
        prisma: PrismaService,
        mapper: ReinsMapper,
        lightrag: ILightragClient,
        s3: S3Repository,
        knowledgeConfig: IKnowledgeConfigService,
      ) => new ReinsGateway(prisma, mapper, lightrag, s3, knowledgeConfig),
    },
    ReinsService,
  ],
  exports: [ReinsService, IKnowledgeConfigService],
})
```

Note `KnowledgeConfigService` impl is no longer registered here — it comes via `ConfigModule` import (added in Task 2). The `IKnowledgeConfigService` token is re-exported transitively. Same for `ILightragClient` from `LightragModule`.

Also remove the now-stale provider entry for `IKnowledgeConfigService` from the `providers` array (it was created in Task 2 step 6 only as token in imports — confirm it's not duplicated here).

Update `api/src/slices/reins/reins.module.ts` `import` statements: keep `IKnowledgeConfigService` (still used in `ReinsGateway` factory injection token) and `ILightragClient` (same reason).

- [ ] **Step 6: Verify it compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/slices/reins/lightrag api/src/slices/reins/knowledge/data/repositories api/src/slices/reins/knowledge/data/reins.gateway.ts api/src/slices/reins/reins.module.ts
git commit -m "refactor(reins): extract LightRAG client into reins/lightrag sub-slice"
```

---

## Task 4: Add `workspaceOf` pure utility

Replace the privately-scoped `workspaceOf` in `reins.gateway.ts` with an exported pure function so `source/` can import it without DI coupling.

**Files:**
- Create: `api/src/slices/reins/knowledge/domain/workspace.ts`
- Modify: `api/src/slices/reins/knowledge/data/reins.gateway.ts`

- [ ] **Step 1: Create the util**

Write `api/src/slices/reins/knowledge/domain/workspace.ts`:

```ts
export function workspaceOf(knowledgeId: string): string {
  return `knowledge_${knowledgeId.replace(/-/g, '')}`;
}
```

- [ ] **Step 2: Replace local definition + lookup in gateway**

In `api/src/slices/reins/knowledge/data/reins.gateway.ts`:

Add the import at the top:
```ts
import { workspaceOf } from '../domain/workspace';
```

Delete the file-scoped function:
```ts
function workspaceOf(id: string): string {
  return `knowledge_${id.replace(/-/g, '')}`;
}
```

Delete the private method:
```ts
private async workspaceOfKnowledge(knowledgeId: string): Promise<string> {
  const record = await this.prisma.knowledge.findUnique({
    where: { id: knowledgeId },
    select: { workspace: true },
  });
  return record?.workspace ?? workspaceOf(knowledgeId);
}
```

Replace every call `await this.workspaceOfKnowledge(<id>)` with `workspaceOf(<id>)` (synchronous now). Affected methods: `indexSource`, `searchKnowledge`. Adjust: `const workspace = workspaceOf(source.knowledgeId);` and `return this.lightrag.query({ workspace: workspaceOf(knowledgeId), ... })`.

- [ ] **Step 3: Verify it compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/slices/reins/knowledge/domain/workspace.ts api/src/slices/reins/knowledge/data/reins.gateway.ts
git commit -m "refactor(reins): extract workspaceOf as pure utility"
```

---

## Task 5: Refactor `knowledge/` to final form

Rename files (drop `reins.` prefix → `knowledge.`), drop source methods from gateway/mapper, add `toCreate` with ID prefix, build `KnowledgeController` and `KnowledgeModule`. Keep `reins.module.ts` and `reins.controller.ts` alive until Task 8 — they will be modified to delegate to the new module so the app still boots.

**Files:**
- Rename: `api/src/slices/reins/knowledge/data/reins.gateway.ts` → `knowledge.gateway.ts`
- Rename: `api/src/slices/reins/knowledge/data/reins.mapper.ts` → `knowledge.mapper.ts`
- Rename: `api/src/slices/reins/knowledge/domain/reins.gateway.ts` → `knowledge.gateway.ts`
- Rename: `api/src/slices/reins/knowledge/domain/reins.service.ts` → `knowledge.service.ts`
- Rename: `api/src/slices/reins/knowledge/domain/reins.types.ts` → `knowledge.types.ts`
- Modify: `api/src/slices/reins/knowledge/domain/index.ts`
- Modify: `api/src/slices/reins/knowledge/dtos/index.ts`
- Move: `api/src/slices/reins/knowledge/dtos/createSource.dto.ts` → `api/src/slices/reins/source/dtos/createSource.dto.ts`
- Move: `api/src/slices/reins/knowledge/dtos/source.dto.ts` → `api/src/slices/reins/source/dtos/source.dto.ts`
- Create: `api/src/slices/reins/knowledge/knowledge.controller.ts`
- Create: `api/src/slices/reins/knowledge/knowledge.module.ts`
- Modify: `api/src/slices/reins/knowledge/index.ts`
- Modify: `api/src/slices/reins/reins.module.ts` (interim — delegate to new modules)
- Modify: `api/src/slices/reins/reins.controller.ts` (delete — Knowledge controller replaces it)

- [ ] **Step 1: Rename files (git mv)**

```bash
git mv api/src/slices/reins/knowledge/data/reins.gateway.ts api/src/slices/reins/knowledge/data/knowledge.gateway.ts
git mv api/src/slices/reins/knowledge/data/reins.mapper.ts api/src/slices/reins/knowledge/data/knowledge.mapper.ts
git mv api/src/slices/reins/knowledge/domain/reins.gateway.ts api/src/slices/reins/knowledge/domain/knowledge.gateway.ts
git mv api/src/slices/reins/knowledge/domain/reins.service.ts api/src/slices/reins/knowledge/domain/knowledge.service.ts
git mv api/src/slices/reins/knowledge/domain/reins.types.ts api/src/slices/reins/knowledge/domain/knowledge.types.ts
mkdir -p api/src/slices/reins/source/dtos
git mv api/src/slices/reins/knowledge/dtos/createSource.dto.ts api/src/slices/reins/source/dtos/createSource.dto.ts
git mv api/src/slices/reins/knowledge/dtos/source.dto.ts api/src/slices/reins/source/dtos/source.dto.ts
```

- [ ] **Step 2: Rename class + interface and slim domain types**

Edit `api/src/slices/reins/knowledge/domain/knowledge.types.ts`. Remove source-only types `ISourceData`, `ICreateSourceData`, `IUploadSourceFileInput`, `IUploadedSourceFile`, `SourceTypes`. Remove `sources?: ISourceData[]` from `IKnowledgeData`. Keep everything else (`IndexStatusTypes`, `QueryModeTypes`, `IKnowledgeData`, `ICreateKnowledgeData`, `IUpdateKnowledgeData`, `IIndexStatePatch`, `IKnowledgeQueryReference`, `IKnowledgeQueryResult`, `IGraphNodeData`, `IGraphEdgeData`, `IGraphData`, `IGetGraphParams`).

Final `knowledge.types.ts`:

```ts
export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

export interface IKnowledgeData {
  id: string;
  name: string;
  description: string | null;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  indexStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateKnowledgeData {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeData {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IIndexStatePatch {
  indexStatus: IndexStatusTypes;
  indexError?: string | null;
  indexedAt?: Date | null;
  indexStartedAt?: Date | null;
}

export interface IKnowledgeQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IKnowledgeQueryResult {
  answer: string;
  references: IKnowledgeQueryReference[];
}

export interface IGraphNodeData {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface IGraphEdgeData {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface IGraphData {
  nodes: IGraphNodeData[];
  edges: IGraphEdgeData[];
  isTruncated: boolean;
}

export interface IGetGraphParams {
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}
```

- [ ] **Step 3: Slim down the domain gateway interface**

Rewrite `api/src/slices/reins/knowledge/domain/knowledge.gateway.ts`:

```ts
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';

export abstract class IKnowledgeGateway {
  abstract findAll(): Promise<IKnowledgeData[]>;
  abstract findById(id: string): Promise<IKnowledgeData | null>;
  abstract create(data: ICreateKnowledgeData): Promise<IKnowledgeData>;
  abstract update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData>;
  abstract updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData>;
  abstract delete(id: string): Promise<void>;

  abstract searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult>;

  abstract getGraphLabels(): Promise<string[]>;
  abstract getGraph(params: IGetGraphParams): Promise<IGraphData>;
}
```

- [ ] **Step 4: Rewrite the data gateway impl**

Rewrite `api/src/slices/reins/knowledge/data/knowledge.gateway.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { IKnowledgeGateway } from '../domain/knowledge.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IIndexStatePatch,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from '../domain/knowledge.types';
import { workspaceOf } from '../domain/workspace';
import { KnowledgeMapper } from './knowledge.mapper';

@Injectable()
export class KnowledgeGateway extends IKnowledgeGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: KnowledgeMapper,
    private readonly lightrag: ILightragClient,
  ) {
    super();
  }

  async findAll(): Promise<IKnowledgeData[]> {
    const records = await this.prisma.knowledge.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IKnowledgeData | null> {
    const record = await this.prisma.knowledge.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const created = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.knowledge.create({
        data: this.mapper.toCreate(data),
      });
      return tx.knowledge.update({
        where: { id: initial.id },
        data: { workspace: workspaceOf(initial.id) },
      });
    });
    return this.mapper.toEntity(created);
  }

  async update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.entityTypes && { entityTypes: data.entityTypes }),
        ...(data.relationshipTypes && {
          relationshipTypes: data.relationshipTypes,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateIndexState(
    id: string,
    patch: IIndexStatePatch,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        indexStatus: patch.indexStatus,
        ...(patch.indexError !== undefined && { indexError: patch.indexError }),
        ...(patch.indexedAt !== undefined && { indexedAt: patch.indexedAt }),
        ...(patch.indexStartedAt !== undefined && {
          indexStartedAt: patch.indexStartedAt,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }

  async searchKnowledge(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    return this.lightrag.query({
      workspace: workspaceOf(knowledgeId),
      query,
      mode,
      topK,
    });
  }

  getGraphLabels(): Promise<string[]> {
    return this.lightrag.getGraphLabels();
  }

  getGraph(params: IGetGraphParams): Promise<IGraphData> {
    return this.lightrag.getGraph({
      label: params.label,
      maxDepth: params.maxDepth,
      maxNodes: params.maxNodes,
    });
  }
}
```

- [ ] **Step 5: Slim down the mapper**

Rewrite `api/src/slices/reins/knowledge/data/knowledge.mapper.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Knowledge as PrismaKnowledge, Prisma } from '@prisma/client';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IndexStatusTypes,
} from '../domain/knowledge.types';

const INDEX_STATUSES: readonly IndexStatusTypes[] = [
  'idle',
  'indexing',
  'ready',
  'failed',
];

function isIndexStatus(value: string): value is IndexStatusTypes {
  return (INDEX_STATUSES as readonly string[]).includes(value);
}

function parseIndexStatus(value: string): IndexStatusTypes {
  return isIndexStatus(value) ? value : 'idle';
}

@Injectable()
export class KnowledgeMapper {
  toEntity(record: PrismaKnowledge): IKnowledgeData {
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      entityTypes: record.entityTypes,
      relationshipTypes: record.relationshipTypes,
      indexStatus: parseIndexStatus(record.indexStatus),
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
      indexStartedAt: record.indexStartedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateKnowledgeData): Prisma.KnowledgeCreateInput {
    return {
      id: `knowledge-${crypto.randomUUID()}`,
      name: data.name,
      description: data.description ?? null,
      entityTypes: data.entityTypes ?? [],
      relationshipTypes: data.relationshipTypes ?? [],
      workspace: 'pending',
    };
  }
}
```

- [ ] **Step 6: Rewrite the service to delegate source cleanup**

Rewrite `api/src/slices/reins/knowledge/domain/knowledge.service.ts`:

```ts
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IKnowledgeGateway } from './knowledge.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';
import { SourceService } from '../../source/domain/source.service';

const STALE_INDEX_AFTER_MS = 10 * 60 * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IKnowledgeGateway,
    private readonly sources: SourceService,
  ) {}

  list(): Promise<IKnowledgeData[]> {
    return this.gateway.findAll();
  }

  async get(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    return this.gateway.create(data);
  }

  async update(id: string, data: IUpdateKnowledgeData): Promise<IKnowledgeData> {
    await this.get(id);
    return this.gateway.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    try {
      await this.sources.removeAllByKnowledge(id);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${id}) failed: ${errorMessage(err)}`,
      );
    }
    await this.gateway.delete(id);
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.get(knowledgeId);

    if (k.indexStatus === 'indexing' && k.indexStartedAt) {
      const ageMs = Date.now() - k.indexStartedAt.getTime();
      if (ageMs < STALE_INDEX_AFTER_MS) {
        throw new Error(
          `Knowledge ${knowledgeId} already indexing (started ${Math.round(ageMs / 1000)}s ago)`,
        );
      }
      this.logger.warn(
        `Knowledge ${knowledgeId} has stale indexing state — restarting`,
      );
    }

    await this.gateway.updateIndexState(knowledgeId, {
      indexStatus: 'indexing',
      indexStartedAt: new Date(),
      indexError: null,
    });

    const task = this.runIndex(knowledgeId);
    this.inflightIndexing.set(knowledgeId, task);
    void task.finally(() => {
      if (this.inflightIndexing.get(knowledgeId) === task) {
        this.inflightIndexing.delete(knowledgeId);
      }
    });
  }

  async waitForIndex(knowledgeId: string): Promise<void> {
    const task = this.inflightIndexing.get(knowledgeId);
    if (task) await task;
  }

  async query(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    await this.get(knowledgeId);
    return this.gateway.searchKnowledge(knowledgeId, query, mode, topK);
  }

  getGraphLabels(): Promise<string[]> {
    return this.gateway.getGraphLabels();
  }

  getGraph(params: IGetGraphParams): Promise<IGraphData> {
    return this.gateway.getGraph(params);
  }

  private async runIndex(knowledgeId: string): Promise<void> {
    try {
      const sources = await this.sources.findByKnowledge(knowledgeId);
      for (const source of sources) {
        if (source.indexed) continue;
        await this.sources.indexSource(source);
      }
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: 'ready',
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${errorMessage(err)}`,
      );
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: errorMessage(err),
      });
    }
  }
}
```

`SourceService` interface (`findByKnowledge`, `indexSource`, `removeAllByKnowledge`) is created in Task 6.

- [ ] **Step 7: Update the domain barrel**

Rewrite `api/src/slices/reins/knowledge/domain/index.ts`:

```ts
export * from './knowledge.types';
export * from './knowledge.gateway';
export * from './knowledge.service';
export * from './workspace';
```

- [ ] **Step 8: Update the dtos barrel**

Rewrite `api/src/slices/reins/knowledge/dtos/index.ts`:

```ts
export * from './knowledge.dto';
export * from './createKnowledge.dto';
export * from './updateKnowledge.dto';
export * from './filterKnowledge.dto';
export * from './queryKnowledge.dto';
export * from './knowledgeRecord.dto';
export * from './getGraph.dto';
export * from './graph.dto';
```

- [ ] **Step 9: Fix dtos that import `SourceTypes` / `ISourceData`**

Search inside `api/src/slices/reins/knowledge/dtos/`:

```bash
grep -l "from '../domain/reins.types'" api/src/slices/reins/knowledge/dtos/
```

Each match must be updated to import from `'../domain/knowledge.types'` (note: `SourceTypes` and `ISourceData` are gone from this file — but no remaining knowledge dto needs them, since `source.dto.ts` and `createSource.dto.ts` were moved out in Step 1).

If any remaining knowledge dto references `ISourceData` or `SourceTypes`, that's a sign it actually belongs in source/dtos — flag and discuss before continuing. (Spec says only knowledge.dto, createKnowledge.dto, updateKnowledge.dto, filterKnowledge.dto, queryKnowledge.dto, knowledgeRecord.dto, getGraph.dto, graph.dto live in knowledge/dtos/.)

- [ ] **Step 10: Build the new controller**

Write `api/src/slices/reins/knowledge/knowledge.controller.ts`:

```ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { KnowledgeService } from './domain/knowledge.service';
import { IKnowledgeConfigService } from '../config/domain/knowledgeConfig.service';
import { IGraphData } from './domain/knowledge.types';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  QueryKnowledgeDto,
  GetGraphDto,
  GraphDto,
  KnowledgeQueryResultDto,
} from './dtos';

@ApiTags('knowledges')
@Controller('knowledges')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly knowledgeConfig: IKnowledgeConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List knowledges', operationId: 'getKnowledges' })
  async list() {
    if (!(await this.knowledgeConfig.isEnabled())) return [];
    return this.service.list();
  }

  @Get('status')
  @ApiOperation({
    summary: 'Knowledge service availability',
    operationId: 'getKnowledgeStatus',
  })
  async status(): Promise<{ enabled: boolean }> {
    return { enabled: await this.knowledgeConfig.isEnabled() };
  }

  @Get('graph/labels')
  @ApiOperation({
    summary: 'List graph entity labels',
    operationId: 'getGraphLabels',
  })
  graphLabels(): Promise<string[]> {
    return this.service.getGraphLabels();
  }

  @Get('graph')
  @ApiOperation({ summary: 'Get knowledge graph', operationId: 'getGraph' })
  @ApiOkResponse({ type: GraphDto })
  graph(@Query() dto: GetGraphDto): Promise<IGraphData> {
    return this.service.getGraph({
      label: dto.label,
      maxDepth: dto.maxDepth,
      maxNodes: dto.maxNodes,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  getOne(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create knowledge', operationId: 'createKnowledge' })
  create(@Body() dto: CreateKnowledgeDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update knowledge', operationId: 'updateKnowledge' })
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge', operationId: 'deleteKnowledge' })
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.delete(id);
  }

  @Post(':id/index')
  @ApiOperation({ summary: 'Start indexing', operationId: 'indexKnowledge' })
  @HttpCode(202)
  async startIndex(@Param('id') id: string) {
    await this.service.startIndex(id);
    return { ok: true };
  }

  @Post(':id/query')
  @ApiOperation({
    summary: 'Query knowledge (LLM-generated answer)',
    operationId: 'queryKnowledge',
  })
  @ApiOkResponse({ type: KnowledgeQueryResultDto })
  query(@Param('id') id: string, @Body() dto: QueryKnowledgeDto) {
    return this.service.query(id, dto.query, dto.mode, dto.topK);
  }
}
```

- [ ] **Step 11: Build the new module**

Write `api/src/slices/reins/knowledge/knowledge.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceModule } from '../source/source.module';
import { KnowledgeController } from './knowledge.controller';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { KnowledgeService } from './domain/knowledge.service';
import { KnowledgeGateway } from './data/knowledge.gateway';
import { KnowledgeMapper } from './data/knowledge.mapper';

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
```

- [ ] **Step 12: Delete the slice-root barrel**

The agent convention (see `api/src/slices/agent/agent/`) has no `index.ts` at the slice root — modules and types are imported by full path. The current `knowledge/index.ts` is a leftover from the in-progress refactor.

```bash
rm api/src/slices/reins/knowledge/index.ts
```

(There is no equivalent file in `source/`, so nothing to delete there.)

- [ ] **Step 13: TS compile check**

Compilation will fail until Task 6 creates `SourceService` and `SourceModule`. That's expected. Skip the build check at this point and proceed straight to Task 6 — the two tasks are paired.

- [ ] **Step 14: No commit yet**

Do not commit. Compilation is broken intentionally. The commit happens at the end of Task 6 once `source/` exists.

---

## Task 6: Create `source/` sub-slice

Build the source slice from scratch. Provides `SourceService` (used by `KnowledgeService` for cleanup), `ISourceGateway`, mapper with `source-` prefix, controller mounted at `knowledges/:knowledgeId/sources`.

**Files:**
- Create: `api/src/slices/reins/source/domain/source.types.ts`
- Create: `api/src/slices/reins/source/domain/source.gateway.ts`
- Create: `api/src/slices/reins/source/domain/source.service.ts`
- Create: `api/src/slices/reins/source/domain/index.ts`
- Create: `api/src/slices/reins/source/data/source.mapper.ts`
- Create: `api/src/slices/reins/source/data/source.gateway.ts`
- Create: `api/src/slices/reins/source/dtos/index.ts`
- Modify: `api/src/slices/reins/source/dtos/source.dto.ts` (already moved in Task 5; needs import path fix)
- Modify: `api/src/slices/reins/source/dtos/createSource.dto.ts` (already moved; needs import path fix)
- Create: `api/src/slices/reins/source/source.controller.ts`
- Create: `api/src/slices/reins/source/source.module.ts`

- [ ] **Step 1: Domain types**

Write `api/src/slices/reins/source/domain/source.types.ts`:

```ts
export type SourceTypes = 'file' | 'url' | 'text';

export interface ISourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  indexed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateSourceData {
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url?: string;
  mimeType?: string;
  content?: string;
  sizeBytes?: number;
}

export interface IUploadSourceFileInput {
  knowledgeId: string;
  filename: string;
  body: Buffer;
  contentType: string;
}

export interface IUploadedSourceFile {
  url: string;
}
```

- [ ] **Step 2: Domain gateway interface**

Write `api/src/slices/reins/source/domain/source.gateway.ts`:

```ts
import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadedSourceFile,
} from './source.types';

export abstract class ISourceGateway {
  abstract findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]>;
  abstract findById(id: string): Promise<ISourceData | null>;
  abstract create(data: ICreateSourceData): Promise<ISourceData>;
  abstract delete(id: string): Promise<void>;

  abstract uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile>;
  abstract deleteFile(url: string): Promise<void>;

  abstract indexSource(source: ISourceData): Promise<void>;
  abstract removeFromIndex(source: ISourceData): Promise<void>;
  abstract removeAllByKnowledge(knowledgeId: string): Promise<void>;
}
```

- [ ] **Step 3: Domain service**

Write `api/src/slices/reins/source/domain/source.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ISourceGateway } from './source.gateway';
import { ISourceData } from './source.types';

export interface IUploadedFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(private readonly gateway: ISourceGateway) {}

  findByKnowledge(knowledgeId: string): Promise<ISourceData[]> {
    return this.gateway.findByKnowledgeId(knowledgeId);
  }

  async addFile(
    knowledgeId: string,
    file: IUploadedFile,
  ): Promise<ISourceData> {
    const stored = await this.gateway.uploadFile({
      knowledgeId,
      filename: file.name,
      body: file.buffer,
      contentType: file.mimeType,
    });
    return this.gateway.create({
      knowledgeId,
      type: 'file',
      name: file.name,
      url: stored.url,
      mimeType: file.mimeType,
      sizeBytes: file.size,
    });
  }

  addUrl(
    knowledgeId: string,
    data: { name: string; url: string },
  ): Promise<ISourceData> {
    return this.gateway.create({
      knowledgeId,
      type: 'url',
      name: data.name,
      url: data.url,
    });
  }

  addText(
    knowledgeId: string,
    data: { name: string; content: string },
  ): Promise<ISourceData> {
    return this.gateway.create({
      knowledgeId,
      type: 'text',
      name: data.name,
      content: data.content,
    });
  }

  async delete(id: string): Promise<void> {
    const source = await this.gateway.findById(id);
    if (!source) throw new NotFoundException(`Source ${id} not found`);
    if (source.indexed) {
      try {
        await this.gateway.removeFromIndex(source);
      } catch (err) {
        this.logger.warn(
          `removeFromIndex(${id}) failed: ${errorMessage(err)}`,
        );
      }
    }
    if (source.type === 'file' && source.url) {
      try {
        await this.gateway.deleteFile(source.url);
      } catch (err) {
        this.logger.warn(
          `deleteFile(${source.url}) failed: ${errorMessage(err)}`,
        );
      }
    }
    await this.gateway.delete(id);
  }

  indexSource(source: ISourceData): Promise<void> {
    return this.gateway.indexSource(source);
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const sources = await this.gateway.findByKnowledgeId(knowledgeId);
    try {
      await this.gateway.removeAllByKnowledge(knowledgeId);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${knowledgeId}) lightrag cleanup failed: ${errorMessage(err)}`,
      );
    }
    for (const source of sources) {
      if (source.type === 'file' && source.url) {
        try {
          await this.gateway.deleteFile(source.url);
        } catch (err) {
          this.logger.warn(
            `deleteFile(${source.url}) failed: ${errorMessage(err)}`,
          );
        }
      }
    }
  }
}
```

- [ ] **Step 4: Domain barrel**

Write `api/src/slices/reins/source/domain/index.ts`:

```ts
export * from './source.types';
export * from './source.gateway';
export * from './source.service';
```

- [ ] **Step 5: Data mapper**

Write `api/src/slices/reins/source/data/source.mapper.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Source as PrismaSource, Prisma } from '@prisma/client';
import {
  ISourceData,
  ICreateSourceData,
  SourceTypes,
} from '../domain/source.types';

const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

function isSourceType(value: string): value is SourceTypes {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function parseSourceType(value: string): SourceTypes {
  return isSourceType(value) ? value : 'text';
}

@Injectable()
export class SourceMapper {
  toEntity(record: PrismaSource): ISourceData {
    return {
      id: record.id,
      knowledgeId: record.knowledgeId,
      type: parseSourceType(record.type),
      name: record.name,
      url: record.url ?? null,
      mimeType: record.mimeType ?? null,
      content: record.content ?? null,
      sizeBytes: record.sizeBytes ?? null,
      indexed: record.lightragDocId !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateSourceData): Prisma.SourceUncheckedCreateInput {
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
}
```

- [ ] **Step 6: Data gateway impl**

Write `api/src/slices/reins/source/data/source.gateway.ts`:

```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IKnowledgeConfigService } from '../../config/domain/knowledgeConfig.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { workspaceOf } from '../../knowledge/domain/workspace';
import { ISourceGateway } from '../domain/source.gateway';
import {
  ISourceData,
  ICreateSourceData,
  IUploadSourceFileInput,
  IUploadedSourceFile,
} from '../domain/source.types';
import { SourceMapper } from './source.mapper';

@Injectable()
export class SourceGateway extends ISourceGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: SourceMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly knowledgeConfig: IKnowledgeConfigService,
  ) {
    super();
  }

  private async requireBucket(): Promise<string> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.bucket) {
      throw new ServiceUnavailableException(
        'Knowledge S3 bucket is not configured',
      );
    }
    return cfg.bucket;
  }

  async findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ISourceData | null> {
    const record = await this.prisma.source.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateSourceData): Promise<ISourceData> {
    const record = await this.prisma.source.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } });
  }

  async uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = `${input.knowledgeId}/${crypto.randomUUID()}-${input.filename}`;
    const stored = await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async deleteFile(url: string): Promise<void> {
    const location = S3Repository.parseUri(url);
    await this.s3.delete(location);
  }

  async indexSource(source: ISourceData): Promise<void> {
    const workspace = workspaceOf(source.knowledgeId);
    const docId = await this.ingestByType(source, workspace);
    await this.prisma.source.update({
      where: { id: source.id },
      data: { lightragDocId: docId },
    });
  }

  async removeFromIndex(source: ISourceData): Promise<void> {
    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    if (!record?.lightragDocId) return;
    await this.lightrag.deleteDocumentsByTrackIds([record.lightragDocId]);
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId, lightragDocId: { not: null } },
      select: { lightragDocId: true },
    });
    const trackIds = records
      .map((r) => r.lightragDocId)
      .filter((v): v is string => v !== null);
    if (trackIds.length === 0) return;
    await this.lightrag.deleteDocumentsByTrackIds(trackIds);
  }

  private async ingestByType(
    source: ISourceData,
    workspace: string,
  ): Promise<string> {
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.lightrag.ingestText({
        workspace,
        text: source.content,
        fileSource: source.name,
      });
      return res.docId;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.lightrag.ingestUrl({
        workspace,
        url: source.url,
      });
      return res.docId;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const location = S3Repository.parseUri(source.url);
      const buffer = await this.s3.download(location);
      const res = await this.lightrag.ingestFile({
        workspace,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      return res.docId;
    }
    const exhaustive: never = source.type;
    throw new Error(`Unknown source type: ${String(exhaustive)}`);
  }
}
```

- [ ] **Step 7: Fix the moved DTO imports**

Edit `api/src/slices/reins/source/dtos/source.dto.ts`. Replace:
```ts
import { ISourceData, SourceTypes } from '../domain/reins.types';
```
with:
```ts
import { ISourceData, SourceTypes } from '../domain/source.types';
```

Edit `api/src/slices/reins/source/dtos/createSource.dto.ts`. Replace:
```ts
import { SourceTypes } from '../domain/reins.types';
```
with:
```ts
import { SourceTypes } from '../domain/source.types';
```

- [ ] **Step 8: DTOs barrel**

Write `api/src/slices/reins/source/dtos/index.ts`:

```ts
export * from './source.dto';
export * from './createSource.dto';
```

- [ ] **Step 9: Controller**

Write `api/src/slices/reins/source/source.controller.ts`:

```ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { SourceService } from './domain/source.service';
import { CreateSourceDto } from './dtos';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('knowledge-sources')
@Controller('knowledges/:knowledgeId/sources')
export class SourceController {
  constructor(private readonly service: SourceService) {}

  @Get()
  @ApiOperation({
    summary: 'List sources',
    operationId: 'getKnowledgeSources',
  })
  list(@Param('knowledgeId') knowledgeId: string) {
    return this.service.findByKnowledge(knowledgeId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add source (file|url|text)',
    operationId: 'addKnowledgeSource',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file'))
  add(
    @Param('knowledgeId') knowledgeId: string,
    @Body() dto: CreateSourceDto,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    if (dto.type === 'file') {
      if (!file) {
        throw new BadRequestException('file is required when type=file');
      }
      return this.service.addFile(knowledgeId, {
        name: file.originalname,
        buffer: file.buffer,
        mimeType: file.mimetype,
        size: file.size,
      });
    }
    if (dto.type === 'url') {
      if (!dto.url) {
        throw new BadRequestException('url is required when type=url');
      }
      return this.service.addUrl(knowledgeId, { name: dto.name, url: dto.url });
    }
    if (dto.type === 'text') {
      if (!dto.content) {
        throw new BadRequestException('content is required when type=text');
      }
      return this.service.addText(knowledgeId, {
        name: dto.name,
        content: dto.content,
      });
    }
    const exhaustive: never = dto.type;
    throw new BadRequestException(`Unknown source type: ${String(exhaustive)}`);
  }

  @Delete(':sourceId')
  @ApiOperation({
    summary: 'Delete source',
    operationId: 'deleteKnowledgeSource',
  })
  @HttpCode(204)
  async remove(
    @Param('knowledgeId') _knowledgeId: string,
    @Param('sourceId') sourceId: string,
  ) {
    await this.service.delete(sourceId);
  }
}
```

- [ ] **Step 10: Module**

Write `api/src/slices/reins/source/source.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { AwsModule } from '#/aws/aws.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceController } from './source.controller';
import { SourceService } from './domain/source.service';
import { ISourceGateway } from './domain/source.gateway';
import { SourceGateway } from './data/source.gateway';
import { SourceMapper } from './data/source.mapper';

@Module({
  imports: [PrismaModule, AwsModule, ConfigModule, LightragModule],
  controllers: [SourceController],
  providers: [
    SourceMapper,
    SourceService,
    { provide: ISourceGateway, useClass: SourceGateway },
  ],
  exports: [SourceService, ISourceGateway],
})
export class SourceModule {}
```

- [ ] **Step 11: Verify it compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: errors only about `reins.module.ts`/`reins.controller.ts` still importing the now-renamed `ReinsService`/`ReinsGateway`/etc. That's expected — Task 7 deletes them.

If there are errors inside the new files themselves (knowledge/* or source/*), fix them before proceeding.

- [ ] **Step 12: No commit yet**

Same as Task 5 — Tasks 5–7 form one logical change. Commit at the end of Task 7.

---

## Task 7: Wire AppModule, delete obsolete `reins.*`

Replace `ReinsModule` with `KnowledgeModule + SourceModule` (Config and Lightrag come transitively). Delete the now-orphaned `reins.module.ts` and `reins.controller.ts`.

**Files:**
- Modify: `api/src/app.module.ts`
- Delete: `api/src/slices/reins/reins.module.ts`
- Delete: `api/src/slices/reins/reins.controller.ts`

- [ ] **Step 1: Update AppModule**

In `api/src/app.module.ts`, replace:
```ts
import { ReinsModule } from './slices/reins/reins.module';
```
with:
```ts
import { KnowledgeModule } from './slices/reins/knowledge/knowledge.module';
import { SourceModule } from './slices/reins/source/source.module';
```

In the `@Module({ imports: [...] })` array, replace `ReinsModule` with `KnowledgeModule, SourceModule` (order: SourceModule first or KnowledgeModule first — does not matter; NestJS resolves by token).

- [ ] **Step 2: Check for other consumers of `ReinsModule` / `ReinsService` / `IReinsGateway`**

Run: `cd api && grep -rn "ReinsModule\|ReinsService\|IReinsGateway\|ReinsController\|ReinsMapper\|ReinsGateway\b" src --include='*.ts'`

Expected output: only the two files about to be deleted (`src/slices/reins/reins.module.ts`, `src/slices/reins/reins.controller.ts`).

If anything else turns up (e.g., a `bridle/` module imports `IReinsGateway`), update those imports to point at `IKnowledgeGateway` or `KnowledgeService`/`SourceService` as appropriate before continuing.

- [ ] **Step 3: Delete obsolete files**

```bash
rm api/src/slices/reins/reins.module.ts
rm api/src/slices/reins/reins.controller.ts
```

- [ ] **Step 4: Verify it compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit (combined for Tasks 5+6+7)**

```bash
git add api/src/slices/reins/knowledge api/src/slices/reins/source api/src/app.module.ts api/src/slices/reins/reins.module.ts api/src/slices/reins/reins.controller.ts
git commit -m "refactor(reins): split into knowledge/source sub-slices with id prefixes"
```

The deleted files (`reins.module.ts`, `reins.controller.ts`) are picked up by `git add` because their parent `api/src/slices/reins/` is staged. Verify with `git status` — there should be no leftover unstaged deletions in `reins/`.

---

## Task 8: Split Prisma schema and reset DB

Replace `reins.prisma` with two per-slice files. `prisma-import` regenerates `schema.prisma`. `migrate:reset` wipes the dev DB (no production data, per spec).

**Files:**
- Create: `api/src/slices/reins/knowledge/knowledge.prisma`
- Create: `api/src/slices/reins/source/source.prisma`
- Delete: `api/src/slices/reins/reins.prisma`
- Auto-modified: `api/prisma/schema.prisma` (regenerated by `prisma-import`)

- [ ] **Step 1: Write knowledge.prisma**

Write `api/src/slices/reins/knowledge/knowledge.prisma`:

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

- [ ] **Step 2: Write source.prisma**

Write `api/src/slices/reins/source/source.prisma`:

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

- [ ] **Step 3: Delete the old combined file**

```bash
rm api/src/slices/reins/reins.prisma
```

- [ ] **Step 4: Regenerate schema.prisma**

Run: `cd api && npx prisma-import --force`
Expected: writes `prisma/schema.prisma` with two new blocks `// knowledge.prisma` and `// source.prisma`, no `// reins.prisma`. Identical model definitions to before.

Verify with `git diff api/prisma/schema.prisma` — should show the section header rename and re-ordering, no model body changes.

- [ ] **Step 5: Reset DB and apply existing migrations**

Run: `cd api && npm run migrate:reset`
Expected: prompts may appear — answer yes. DB drops and reapplies all migrations. No new migration is created because the model bodies are unchanged.

- [ ] **Step 6: Regenerate Prisma client**

Run: `cd api && npx prisma generate`
Expected: `node_modules/.prisma/client` regenerated. No type changes, just rebuilt.

- [ ] **Step 7: Verify TypeScript still compiles**

Run: `cd api && npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add api/src/slices/reins/knowledge/knowledge.prisma api/src/slices/reins/source/source.prisma api/src/slices/reins/reins.prisma api/prisma/schema.prisma
git commit -m "refactor(reins): split prisma into knowledge.prisma and source.prisma"
```

---

## Task 9: Regenerate frontend client and smoke-test

Generated `client.gen.ts` files in `admin/` and `app/` already exist on this branch. They must be regenerated against the new Swagger output (`getKnowledges`, `addKnowledgeSource`, etc. — same operationIds, but tags changed from `reins` to `knowledges` + `knowledge-sources`).

**Files:**
- Auto-modified: `admin/slices/setup/api/data/repositories/api/client.gen.ts`
- Auto-modified: `admin/slices/setup/api/data/repositories/api/index.ts`
- Auto-modified: `app/slices/setup/api/data/repositories/api/client.gen.ts`
- Auto-modified: `app/slices/setup/api/data/repositories/api/index.ts`

- [ ] **Step 1: Build API and regenerate swagger spec**

```bash
cd api && npm run build && npm run generate:swagger
```

This produces `api/swagger-spec.json`. Spot-check:
```bash
grep -o '"knowledge-sources\|"knowledges' api/swagger-spec.json | sort -u
```
Expected: both tags present.

- [ ] **Step 2: Regenerate admin and app clients**

```bash
cd admin && npm run build:api
cd ../app && npm run build:api
```

Each runs `openapi-ts` against `api/swagger-spec.json` and writes into `slices/setup/api/data/repositories/api/`.

Verify with `git diff admin/slices/setup/api/data/repositories/api/client.gen.ts`: operation IDs (`getKnowledges`, `addKnowledgeSource`, `deleteKnowledgeSource`, etc.) preserved; only tag groupings change.

- [ ] **Step 3: Boot the stack**

Three terminals (or `make dev`-equivalent if it boots all):
```bash
cd api && npm run dev          # nest watch (API)
cd admin && npm run dev        # nuxt dev --port 3001
cd app && npm run dev          # nuxt dev --port 3000
```

Wait until each one prints its readiness banner.

- [ ] **Step 4: Browser smoke test — empty state**

Open `http://localhost:3001/knowledges` in the browser (the admin UI for knowledges; verify the exact route in `admin/slices/.../routes` if 404).

Expected: empty list. If LightRAG is misconfigured, the list returns `[]` and a banner / empty state shows.

- [ ] **Step 5: Smoke test — create knowledge**

Click "Create knowledge" / equivalent button. Fill name and description. Submit.

Verify in DB:
```bash
cd api && npm run studio
```
Open `Knowledge` table. New row should have `id` starting with `knowledge-`, `workspace` field equal to `knowledge_<id without dashes>`.

- [ ] **Step 6: Smoke test — add file source**

In the admin UI for the just-created knowledge, click "Add source" → file. Upload any small file (e.g. a README).

Verify in DB: `Source` table row, `id` starts with `source-`, `knowledgeId` matches, `url` is an `s3://...` URI, `lightragDocId` is null (not yet indexed).

- [ ] **Step 7: Smoke test — add URL source**

Same UI, type=url. Enter `https://example.com` and a name. Submit.

Verify: another `Source` row with prefix and `type=url`.

- [ ] **Step 8: Smoke test — add text source**

Same UI, type=text. Enter content and name.

Verify: another `Source` row with prefix and `type=text`.

- [ ] **Step 9: Smoke test — index**

Click "Index" / "Start indexing" on the knowledge. Wait. Watch the API logs — should see LightRAG calls.

Verify: `Knowledge.indexStatus` transitions `idle → indexing → ready`. Each `Source.lightragDocId` becomes non-null.

- [ ] **Step 10: Smoke test — query**

In the UI, run a query against the knowledge. Verify a non-empty answer comes back.

- [ ] **Step 11: Smoke test — delete one source**

Delete the URL source.

Verify: row gone from DB. LightRAG document removed (check API logs for `deleteDocumentsByTrackIds`).

- [ ] **Step 12: Smoke test — delete knowledge**

Delete the knowledge entirely.

Verify: knowledge row gone, all remaining source rows gone (cascade), all LightRAG documents gone.

- [ ] **Step 13: Smoke test — disabled state**

In `Settings` admin UI, set `knowledge.enabled = false` (or unset `LIGHTRAG_URL`). Reload the knowledges page.

Expected: list returns `[]`, status endpoint returns `{ enabled: false }`.

- [ ] **Step 14: Restore enabled state**

Re-enable knowledge in settings. Reload. Verify list works again.

- [ ] **Step 15: Commit regenerated client**

```bash
git add admin/slices/setup/api/data/repositories/api app/slices/setup/api/data/repositories/api api/swagger-spec.json
git commit -m "chore(reins): regenerate admin/app api client after slice split"
```

If `git status` is clean (e.g., the swagger output happens to match the version already committed during this branch), skip this commit.

- [ ] **Step 16: Final verification**

```bash
git status
git log --oneline -10
```

Expected: clean working tree (no leftover changes), 5 commits added by this plan (Tasks 2, 3, 4, 5+6+7, 8) plus optional Task 9 client commit.

---

## Self-review notes

- **Spec coverage:** Every numbered "Order of execution" item in the spec maps to a task here (config → T2, lightrag → T3, prisma split → T8, knowledge refactor → T5, source slice → T6, workspaceOf → T4, AppModule → T7, deletion → T7, regen → T9, smoke test → T9).
- **No placeholders:** All steps include exact code or exact commands.
- **Type consistency:** `IKnowledgeGateway` methods (`findAll`, `findById`, `create`, `update`, `delete`, `updateIndexState`, `searchKnowledge`, `getGraphLabels`, `getGraph`) are used identically in `knowledge.gateway.ts` (impl), `knowledge.service.ts`, and `knowledge.controller.ts`. `ISourceGateway` methods (`findByKnowledgeId`, `findById`, `create`, `delete`, `uploadFile`, `deleteFile`, `indexSource`, `removeFromIndex`, `removeAllByKnowledge`) match in source.gateway impl and source.service consumption. `KnowledgeService` calls `sources.findByKnowledge`, `sources.indexSource`, `sources.removeAllByKnowledge` — these match the methods defined in `SourceService` (Task 6 step 3).
