# Knowledge UX + LLM credentials capabilities (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Knowledge usable end-to-end via the admin: typed LLM credentials (chat / embedding), dropdown provider/model picker, credential pickers in Knowledge settings, and a step-by-step wizard on `/knowledges` that guides setup until LightRAG is reachable.

**Architecture:** Extend `LlmCredential` with two boolean capability flags and a static FE-only provider/model catalog. Knowledge settings stores selected chat/embedding credential ids in the existing `setting` table (group `knowledge`). The `/knowledges/status` endpoint is extended with a `setup` object the wizard reads to color its 4 steps. Auto-syncing OpenAI key into LightRAG's container env is intentionally out of scope (Phase 2).

**Tech Stack:** NestJS + Prisma 6 (api), Nuxt 3 + Pinia (admin), `@hey-api/openapi-ts` for the generated client.

**Reference spec:** `docs/superpowers/specs/2026-05-06-knowledge-llm-credentials-design.md`.

**Project conventions to respect:**
- Ranch has zero tests; the user has explicitly asked not to add them by default. Do not add unit/integration tests in this plan unless asked. Manual browser verification is the QA path.
- Commit messages: `<type>(<scope>): <subject>`. Keep subjects short. Do not add `Co-Authored-By` lines.
- Strong TypeScript: no `as` casts (except for legitimate DOM/external boundary cases), no `any`, prefer type guards. See `~/.claude/examples/type-guards.ts`.
- Vue: no `// meta` headers, no imports of Nuxt auto-imports (`ref`, `computed`, `useFetch`, `defineProps`, etc.).

---

## File map

**Create:**
- `admin/slices/llm/data/providers.ts`
- `admin/slices/reins/components/knowledgeSetup/Wizard.vue`

**Modify (api):**
- `api/src/slices/llm/llm.prisma`
- `api/src/slices/llm/domain/llm.types.ts`
- `api/src/slices/llm/data/llm.mapper.ts`
- `api/src/slices/llm/dtos/llmCredential.dto.ts`
- `api/src/slices/llm/dtos/createLlmCredential.dto.ts`
- `api/src/slices/llm/domain/llm.gateway.ts`
- `api/src/slices/llm/data/llm.gateway.ts`
- `api/src/slices/reins/lightrag/data/lightragHttp.client.ts`
- `api/src/slices/reins/config/data/knowledgeConfig.gateway.ts`
- `api/src/slices/reins/config/domain/knowledgeConfig.gateway.ts`
- `api/src/slices/reins/knowledge/knowledge.module.ts`
- `api/src/slices/reins/knowledge/knowledge.controller.ts`

**Modify (admin):**
- `admin/slices/llm/stores/llm.ts`
- `admin/slices/llm/components/llm/Form.vue`
- `admin/slices/llm/components/llmCreate/Provider.vue`
- `admin/slices/setting/pages/settings/knowledge.vue`
- `admin/slices/reins/stores/knowledge.ts`
- `admin/slices/reins/pages/knowledges/index.vue`

**Auto-regenerated (do not hand-edit):**
- `api/swagger-spec.json`
- `admin/slices/setup/api/data/repositories/api/*.gen.ts`

---

## Task 1: Add capability columns to `LlmCredential`

**Files:**
- Modify: `api/src/slices/llm/llm.prisma`
- Auto-create: `api/prisma/migrations/<timestamp>_auto/migration.sql`

- [ ] **Step 1.1: Edit the Prisma schema**

Open `api/src/slices/llm/llm.prisma` and add two columns after `status`:

```prisma
import { Usage } from "../usage/usage"
import { Agent } from "../agent/agent/agent"

model LlmCredential {
  id                String   @id @default(uuid())
  provider          String
  model             String
  fallbackModel     String?
  label             String?
  apiKey            String
  status            String   @default("active")
  supportsChat      Boolean  @default(true)
  supportsEmbedding Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  usages Usage[]
  agents Agent[]

  @@index([status])
}
```

- [ ] **Step 1.2: Run the migration**

Run from the repo root:

```bash
npm --prefix api run migrate
```

Expected: `prisma-import` runs (premigrate hook), then `prisma migrate dev --name auto` creates a new directory under `api/prisma/migrations/`. The generated `migration.sql` should contain:

```sql
ALTER TABLE "LlmCredential" ADD COLUMN "supportsChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LlmCredential" ADD COLUMN "supportsEmbedding" BOOLEAN NOT NULL DEFAULT false;
```

Then `prisma generate` runs against `api/prisma/schema.prisma`.

- [ ] **Step 1.3: Verify existing rows look correct**

```bash
dotenv -e api/.env.dev -- psql "$DATABASE_URL" -c 'SELECT id, provider, model, "supportsChat", "supportsEmbedding" FROM "LlmCredential" LIMIT 5;'
```

Expected: every existing row shows `supportsChat = t`, `supportsEmbedding = f`.

If no rows exist locally, that is fine. Skip and continue.

- [ ] **Step 1.4: Commit**

```bash
git add api/src/slices/llm/llm.prisma api/prisma/migrations/ api/prisma/schema.prisma
git commit -m "feat(llm): add capability flags to LlmCredential"
```

---

## Task 2: Update LLM domain types and mapper

**Files:**
- Modify: `api/src/slices/llm/domain/llm.types.ts`
- Modify: `api/src/slices/llm/data/llm.mapper.ts`

- [ ] **Step 2.1: Extend domain interfaces**

Replace the contents of `api/src/slices/llm/domain/llm.types.ts` with:

```ts
export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  label: string | null;
  apiKey: string;
  status: string;
  supportsChat: boolean;
  supportsEmbedding: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateLlmCredentialData {
  provider: string;
  model: string;
  apiKey: string;
  fallbackModel?: string | null;
  label?: string | null;
  status?: string;
  supportsChat?: boolean;
  supportsEmbedding?: boolean;
}

export interface IUpdateLlmCredentialData {
  provider?: string;
  model?: string;
  apiKey?: string;
  fallbackModel?: string | null;
  label?: string | null;
  status?: string;
  supportsChat?: boolean;
  supportsEmbedding?: boolean;
}
```

- [ ] **Step 2.2: Pass capabilities through the mapper**

Replace `api/src/slices/llm/data/llm.mapper.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { LlmCredential } from '@prisma/client';
import { ILlmCredentialData, ICreateLlmCredentialData } from '../domain';

@Injectable()
export class LlmMapper {
  toEntity(record: LlmCredential): ILlmCredentialData {
    return {
      id: record.id,
      provider: record.provider,
      model: record.model,
      fallbackModel: record.fallbackModel,
      label: record.label,
      apiKey: record.apiKey,
      status: record.status,
      supportsChat: record.supportsChat,
      supportsEmbedding: record.supportsEmbedding,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateLlmCredentialData) {
    return {
      id: `llm-${crypto.randomUUID()}`,
      provider: data.provider,
      model: data.model,
      fallbackModel: data.fallbackModel ?? null,
      apiKey: data.apiKey,
      label: data.label ?? null,
      status: data.status ?? 'active',
      supportsChat: data.supportsChat ?? true,
      supportsEmbedding: data.supportsEmbedding ?? false,
    };
  }
}
```

- [ ] **Step 2.3: Type-check the api**

```bash
npm --prefix api run build
```

Expected: build succeeds. Any TS errors here mean a downstream consumer needs to be updated; fix them in this step before committing.

- [ ] **Step 2.4: Commit**

```bash
git add api/src/slices/llm/domain/llm.types.ts api/src/slices/llm/data/llm.mapper.ts
git commit -m "feat(llm): plumb capability flags through types and mapper"
```

---

## Task 3: Add capability fields to LLM DTOs

**Files:**
- Modify: `api/src/slices/llm/dtos/llmCredential.dto.ts`
- Modify: `api/src/slices/llm/dtos/createLlmCredential.dto.ts`

(`updateLlmCredential.dto.ts` extends via `PartialType`, no edit needed.)

- [ ] **Step 3.1: Update the response DTO**

Replace `api/src/slices/llm/dtos/llmCredential.dto.ts` with:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LlmCredentialDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'anthropic' })
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  model: string;

  @ApiPropertyOptional()
  fallbackModel: string | null;

  @ApiPropertyOptional()
  label: string | null;

  @ApiProperty()
  apiKey: string;

  @ApiProperty({ example: 'active', enum: ['active', 'disabled'] })
  status: string;

  @ApiProperty({ default: true })
  supportsChat: boolean;

  @ApiProperty({ default: false })
  supportsEmbedding: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

- [ ] **Step 3.2: Update the create DTO**

Append two optional boolean fields to `api/src/slices/llm/dtos/createLlmCredential.dto.ts`. The new file content:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeCredential } from '../domain/llm.utils';

export class CreateLlmCredentialDto {
  @ApiProperty({ example: 'anthropic' })
  @IsString()
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  @IsString()
  model: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeCredential(value) : value,
  )
  apiKey: string;

  @ApiPropertyOptional({ example: 'claude-haiku-4-5' })
  @IsOptional()
  @IsString()
  fallbackModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  supportsChat?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  supportsEmbedding?: boolean;
}
```

- [ ] **Step 3.3: Build to confirm DTO compiles**

```bash
npm --prefix api run build
```

Expected: build passes.

- [ ] **Step 3.4: Commit**

```bash
git add api/src/slices/llm/dtos/
git commit -m "feat(llm): expose capability flags in DTOs"
```

---

## Task 4: Add `hasCredentialWithCapability` to LLM gateway

**Files:**
- Modify: `api/src/slices/llm/domain/llm.gateway.ts`
- Modify: `api/src/slices/llm/data/llm.gateway.ts`

- [ ] **Step 4.1: Declare the method on the abstract class**

Replace `api/src/slices/llm/domain/llm.gateway.ts` with:

```ts
import {
  ILlmCredentialData,
  ICreateLlmCredentialData,
  IUpdateLlmCredentialData,
} from './llm.types';

export type LlmCapability = 'chat' | 'embedding';

export abstract class ILlmGateway {
  abstract findAll(): Promise<ILlmCredentialData[]>;
  abstract findActive(): Promise<ILlmCredentialData[]>;
  abstract findById(id: string): Promise<ILlmCredentialData | null>;
  abstract create(data: ICreateLlmCredentialData): Promise<ILlmCredentialData>;
  abstract update(
    id: string,
    data: IUpdateLlmCredentialData,
  ): Promise<ILlmCredentialData>;
  abstract delete(id: string): Promise<void>;
  abstract hasCredentialWithCapability(
    capability: LlmCapability,
  ): Promise<boolean>;
}
```

- [ ] **Step 4.2: Implement the method**

Append the implementation to `api/src/slices/llm/data/llm.gateway.ts`. The new file content:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ILlmGateway, LlmCapability } from '../domain/llm.gateway';
import {
  ILlmCredentialData,
  ICreateLlmCredentialData,
  IUpdateLlmCredentialData,
} from '../domain/llm.types';
import { LlmMapper } from './llm.mapper';

@Injectable()
export class LlmGateway extends ILlmGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: LlmMapper,
  ) {
    super();
  }

  async findAll(): Promise<ILlmCredentialData[]> {
    const records = await this.prisma.llmCredential.findMany({
      orderBy: [{ status: 'asc' }, { provider: 'asc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findActive(): Promise<ILlmCredentialData[]> {
    const records = await this.prisma.llmCredential.findMany({
      where: { status: 'active' },
      orderBy: [{ provider: 'asc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ILlmCredentialData | null> {
    const record = await this.prisma.llmCredential.findUnique({
      where: { id },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateLlmCredentialData): Promise<ILlmCredentialData> {
    const record = await this.prisma.llmCredential.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(
    id: string,
    data: IUpdateLlmCredentialData,
  ): Promise<ILlmCredentialData> {
    const record = await this.prisma.llmCredential.update({
      where: { id },
      data,
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.llmCredential.delete({ where: { id } });
  }

  async hasCredentialWithCapability(
    capability: LlmCapability,
  ): Promise<boolean> {
    const where =
      capability === 'chat'
        ? { status: 'active', supportsChat: true }
        : { status: 'active', supportsEmbedding: true };
    const count = await this.prisma.llmCredential.count({ where });
    return count > 0;
  }
}
```

- [ ] **Step 4.3: Build**

```bash
npm --prefix api run build
```

Expected: pass.

- [ ] **Step 4.4: Commit**

```bash
git add api/src/slices/llm/domain/llm.gateway.ts api/src/slices/llm/data/llm.gateway.ts
git commit -m "feat(llm): add hasCredentialWithCapability gateway method"
```

---

## Task 5: Add 2-second timeout to LightRAG `health()`

**Files:**
- Modify: `api/src/slices/reins/lightrag/data/lightragHttp.client.ts`

LightRAG's health endpoint can hang when the service is unreachable. The wizard's status endpoint will call `health()` and we do not want a slow probe to delay admin renders.

- [ ] **Step 5.1: Wrap `health()` with `AbortController`**

Find the `health()` method in `api/src/slices/reins/lightrag/data/lightragHttp.client.ts` (around lines 50-58) and replace it with:

```ts
async health(): Promise<ILightragHealth> {
  const cfg = await this.requireEnabled();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await this.fetchImpl(`${cfg.baseUrl}/health`, {
      method: 'GET',
      headers: this.headers(cfg.apiKey),
      signal: controller.signal,
    });
    await this.ensureOk(res, '/health');
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5.2: Build**

```bash
npm --prefix api run build
```

Expected: pass.

- [ ] **Step 5.3: Commit**

```bash
git add api/src/slices/reins/lightrag/data/lightragHttp.client.ts
git commit -m "feat(reins): time-bound LightRAG health probe at 2s"
```

---

## Task 6: Extend KnowledgeConfigGateway to read selected credential ids

**Files:**
- Modify: `api/src/slices/reins/config/domain/knowledgeConfig.gateway.ts`
- Modify: `api/src/slices/reins/config/data/knowledgeConfig.gateway.ts`

Adding the read here keeps setting access in one place. The controller composes the wizard's `setup` object from the gateway's outputs.

- [ ] **Step 6.1: Extend the abstract gateway**

Read the current `api/src/slices/reins/config/domain/knowledgeConfig.gateway.ts` (do this if you have not already; it defines the interface and the `IKnowledgeConfig` type).

Replace its contents with:

```ts
export interface IKnowledgeConfig {
  url: string;
  apiKey: string;
  bucket: string;
  enabled: boolean;
}

export interface ISelectedCredentialIds {
  chat: string | null;
  embedding: string | null;
}

export abstract class IKnowledgeConfigGateway {
  abstract resolve(): Promise<IKnowledgeConfig>;
  abstract isEnabled(): Promise<boolean>;
  abstract getSelectedCredentialIds(): Promise<ISelectedCredentialIds>;
}
```

(If the file currently re-exports `IKnowledgeConfig` from elsewhere, keep that pattern but add the new type and method.)

- [ ] **Step 6.2: Implement `getSelectedCredentialIds`**

Append to `api/src/slices/reins/config/data/knowledgeConfig.gateway.ts`:

```ts
async getSelectedCredentialIds(): Promise<ISelectedCredentialIds> {
  const [chatSetting, embeddingSetting] = await Promise.all([
    this.settings.findByKey(SETTING_GROUP, 'chat_credential_id'),
    this.settings.findByKey(SETTING_GROUP, 'embedding_credential_id'),
  ]);
  return {
    chat: readString(chatSetting?.value),
    embedding: readString(embeddingSetting?.value),
  };
}
```

Add the matching import at the top (next to the existing one):

```ts
import {
  IKnowledgeConfig,
  IKnowledgeConfigGateway,
  ISelectedCredentialIds,
} from '../domain/knowledgeConfig.gateway';
```

- [ ] **Step 6.3: Build**

```bash
npm --prefix api run build
```

Expected: pass.

- [ ] **Step 6.4: Commit**

```bash
git add api/src/slices/reins/config/
git commit -m "feat(reins): expose selected credential ids on knowledge config gateway"
```

---

## Task 7: Wire `LlmModule` into `KnowledgeModule`, extend `/knowledges/status`

**Files:**
- Modify: `api/src/slices/reins/knowledge/knowledge.module.ts`
- Modify: `api/src/slices/reins/knowledge/knowledge.controller.ts`

- [ ] **Step 7.1: Import `LlmModule` and `LightragModule` for the controller's needs**

Replace `api/src/slices/reins/knowledge/knowledge.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { LlmModule } from '#/llm/llm.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceModule } from '../source/source.module';
import { KnowledgeController } from './knowledge.controller';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { KnowledgeService } from './domain/knowledge.service';
import { KnowledgeGateway } from './data/knowledge.gateway';
import { KnowledgeMapper } from './data/knowledge.mapper';

@Module({
  imports: [PrismaModule, ConfigModule, LightragModule, SourceModule, LlmModule],
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

- [ ] **Step 7.2: Extend the `/status` endpoint in the controller**

Open `api/src/slices/reins/knowledge/knowledge.controller.ts`. Add these imports near the top (next to existing imports):

```ts
import { ILightragClient } from '../lightrag/domain/lightrag.client';
import { ILlmGateway } from '#/llm/domain';
```

Inject the new dependencies in the constructor and replace the `status()` method. The controller's constructor block becomes:

```ts
constructor(
  private readonly service: KnowledgeService,
  private readonly knowledgeConfig: IKnowledgeConfigGateway,
  private readonly lightrag: ILightragClient,
  private readonly llm: ILlmGateway,
) {}
```

Replace the existing `@Get('status')` method with:

```ts
@Get('status')
@ApiOperation({
  summary: 'Knowledge service availability and setup readiness',
  operationId: 'getKnowledgeStatus',
})
async status(): Promise<{
  enabled: boolean;
  setup: {
    hasChatCredential: boolean;
    hasEmbeddingCredential: boolean;
    hasUrl: boolean;
    hasBucket: boolean;
    hasCredentialsSelected: boolean;
    isHealthy: boolean;
  };
}> {
  const [config, selected, hasChat, hasEmbedding] = await Promise.all([
    this.knowledgeConfig.resolve(),
    this.knowledgeConfig.getSelectedCredentialIds(),
    this.llm.hasCredentialWithCapability('chat'),
    this.llm.hasCredentialWithCapability('embedding'),
  ]);

  let isHealthy = false;
  if (config.url.length > 0) {
    try {
      await this.lightrag.health();
      isHealthy = true;
    } catch {
      isHealthy = false;
    }
  }

  return {
    enabled: config.enabled,
    setup: {
      hasChatCredential: hasChat,
      hasEmbeddingCredential: hasEmbedding,
      hasUrl: config.url.length > 0,
      hasBucket: config.bucket.length > 0,
      hasCredentialsSelected:
        selected.chat !== null && selected.embedding !== null,
      isHealthy,
    },
  };
}
```

- [ ] **Step 7.3: Build**

```bash
npm --prefix api run build
```

Expected: pass. If `#/llm/domain` does not resolve, check the existing `domain/index.ts` re-export in `api/src/slices/llm/domain/`. Use a more direct import path if needed (`#/llm/domain/llm.gateway`).

- [ ] **Step 7.4: Smoke test the endpoint**

Start the api locally if it is not running, then:

```bash
curl -s http://localhost:3000/knowledges/status | jq
```

Expected JSON shape:

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "setup": {
      "hasChatCredential": true,
      "hasEmbeddingCredential": false,
      "hasUrl": false,
      "hasBucket": false,
      "hasCredentialsSelected": false,
      "isHealthy": false
    }
  }
}
```

(Exact values depend on local DB; `hasChatCredential: true` is expected if there is at least one active credential, since existing rows default to `supportsChat=true`.)

- [ ] **Step 7.5: Commit**

```bash
git add api/src/slices/reins/knowledge/knowledge.module.ts api/src/slices/reins/knowledge/knowledge.controller.ts
git commit -m "feat(reins): expand /knowledges/status with setup readiness"
```

---

## Task 8: Regenerate the swagger spec and admin OpenAPI client

**Files:**
- Auto-write: `api/swagger-spec.json`
- Auto-write: `admin/slices/setup/api/data/repositories/api/*.gen.ts`

- [ ] **Step 8.1: Build the api so the swagger generator can run**

```bash
npm --prefix api run build
```

- [ ] **Step 8.2: Regenerate `swagger-spec.json`**

```bash
npm --prefix api run generate:swagger
```

Expected: `api/swagger-spec.json` is rewritten. New schema entries: `LlmCredentialDto.supportsChat`, `supportsEmbedding`; `CreateLlmCredentialDto` similar; the `getKnowledgeStatus` operation has a new `setup` object schema in its response.

- [ ] **Step 8.3: Regenerate the admin client**

```bash
npm --prefix admin run build:api
```

Expected: files under `admin/slices/setup/api/data/repositories/api/` are rewritten with new types reflecting the API changes.

- [ ] **Step 8.4: Verify generated types include the new fields**

```bash
grep -n "supportsChat\|supportsEmbedding" admin/slices/setup/api/data/repositories/api/types.gen.ts | head -10
```

Expected: at least 4 matches (response DTO + create DTO).

- [ ] **Step 8.5: Commit**

```bash
git add api/swagger-spec.json admin/slices/setup/api/data/repositories/api/
git commit -m "chore: regenerate openapi client for llm capabilities + knowledge setup"
```

---

## Task 9: Add capability fields to admin LLM store

**Files:**
- Modify: `admin/slices/llm/stores/llm.ts`

- [ ] **Step 9.1: Extend store interfaces**

Open `admin/slices/llm/stores/llm.ts`. Replace the two interface definitions near the top (`ILlmCredentialData` and `ILlmCredentialInput`) with:

```ts
export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  label: string | null;
  apiKey: string;
  status: string;
  supportsChat: boolean;
  supportsEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ILlmCredentialInput {
  provider: string;
  model: string;
  apiKey: string;
  fallbackModel?: string;
  label?: string;
  status?: string;
  supportsChat?: boolean;
  supportsEmbedding?: boolean;
}
```

No other changes needed in this file. The existing `unwrap` flow passes the new fields through.

- [ ] **Step 9.2: Type-check the admin**

```bash
npm --prefix admin run prebuild
```

(If admin has a separate type-check, run it. `prebuild` runs `openapi-ts` again; that should be a no-op now and reveals downstream TS errors when `nuxt build` runs in later tasks.)

- [ ] **Step 9.3: Commit**

```bash
git add admin/slices/llm/stores/llm.ts
git commit -m "feat(admin/llm): plumb capability flags through the store"
```

---

## Task 10: Create the static providers/models catalog

**Files:**
- Create: `admin/slices/llm/data/providers.ts`

- [ ] **Step 10.1: Write the catalog**

Create `admin/slices/llm/data/providers.ts`:

```ts
export interface IModelDef {
  id: string;
  label: string;
  capabilities: { chat: boolean; embedding: boolean };
}

export interface IProviderDef {
  id: string;
  label: string;
  models: IModelDef[];
}

export const PROVIDERS: IProviderDef[] = [
  {
    id: 'claude',
    label: 'Anthropic',
    models: [
      {
        id: 'claude-opus-4-7',
        label: 'Claude Opus 4.7',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        capabilities: { chat: true, embedding: false },
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        capabilities: { chat: true, embedding: false },
      },
      {
        id: 'text-embedding-3-small',
        label: 'Embedding 3 small',
        capabilities: { chat: false, embedding: true },
      },
      {
        id: 'text-embedding-3-large',
        label: 'Embedding 3 large',
        capabilities: { chat: false, embedding: true },
      },
    ],
  },
];

export function getProvider(id: string): IProviderDef | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function getModel(
  providerId: string,
  modelId: string,
): IModelDef | null {
  const provider = getProvider(providerId);
  if (provider === null) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function isKnownProvider(value: string): boolean {
  return PROVIDERS.some((p) => p.id === value);
}

export function isKnownModel(providerId: string, modelId: string): boolean {
  return getModel(providerId, modelId) !== null;
}
```

- [ ] **Step 10.2: Commit**

```bash
git add admin/slices/llm/data/providers.ts
git commit -m "feat(admin/llm): add static provider/model catalog"
```

---

## Task 11: Rewrite the LLM credential form

**Files:**
- Modify: `admin/slices/llm/components/llm/Form.vue`

This task is the largest single component change. The new form uses native `<select>` for provider and model, plus two `<Checkbox>` controls for capabilities.

- [ ] **Step 11.1: Rewrite the form**

Replace `admin/slices/llm/components/llm/Form.vue` with:

```vue
<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import {
  PROVIDERS,
  getProvider,
  getModel,
  isKnownProvider,
  isKnownModel,
} from '#llm/data/providers';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const props = defineProps<{
  initialValues?: ILlmCredentialInput;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ILlmCredentialInput];
  cancel: [];
}>();

const initialProvider = props.initialValues?.provider ?? 'claude';
const initialModel = props.initialValues?.model ?? '';
const initialFallback = props.initialValues?.fallbackModel ?? '';

const form = reactive({
  provider: initialProvider,
  model: initialModel,
  fallbackModel: initialFallback,
  label: props.initialValues?.label ?? '',
  apiKey: props.initialValues?.apiKey ?? '',
  status: props.initialValues?.status ?? 'active',
  supportsChat: props.initialValues?.supportsChat ?? true,
  supportsEmbedding: props.initialValues?.supportsEmbedding ?? false,
});

const errors = reactive<
  Partial<Record<'provider' | 'model' | 'apiKey' | 'capabilities', string>>
>({});

const providerHasCustom = computed(() => !isKnownProvider(form.provider));

const modelOptions = computed(() => {
  const provider = getProvider(form.provider);
  if (provider === null) return [];
  return provider.models.map((m) => ({
    id: m.id,
    label: m.label,
  }));
});

const modelHasCustom = computed(() => {
  if (form.model === '') return false;
  return !isKnownModel(form.provider, form.model);
});

const fallbackHasCustom = computed(() => {
  if (form.fallbackModel === '') return false;
  return !isKnownModel(form.provider, form.fallbackModel);
});

function onProviderChange(): void {
  // Reset model and fallback when provider changes; user must pick again.
  form.model = '';
  form.fallbackModel = '';
}

function onModelChange(): void {
  const def = getModel(form.provider, form.model);
  if (def === null) return;
  form.supportsChat = def.capabilities.chat;
  form.supportsEmbedding = def.capabilities.embedding;
}

function validate(): boolean {
  errors.provider = form.provider.trim() ? undefined : 'Provider is required';
  errors.model = form.model.trim() ? undefined : 'Model is required';
  errors.apiKey = form.apiKey.trim() ? undefined : 'API key is required';
  errors.capabilities =
    !form.supportsChat && !form.supportsEmbedding
      ? 'Pick at least one capability'
      : undefined;
  return (
    !errors.provider && !errors.model && !errors.apiKey && !errors.capabilities
  );
}

function onSubmit(): void {
  if (!validate()) return;
  emit('submit', {
    provider: form.provider.trim(),
    model: form.model.trim(),
    fallbackModel: form.fallbackModel.trim() || undefined,
    apiKey: form.apiKey.trim(),
    label: form.label.trim() || undefined,
    status: form.status,
    supportsChat: form.supportsChat,
    supportsEmbedding: form.supportsEmbedding,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Credential</CardTitle>
        <CardDescription>
          API key is stored plaintext. When assigned to an agent, these values
          are injected as <code>LLM_PROVIDER</code>, <code>LLM_MODEL</code>,
          <code>LLM_FALLBACK_MODEL</code>, <code>LLM_API_KEY</code> on the pod.
          Mark which task this credential is for: chat (LLM completions) or
          embedding (vector search). Knowledge service picks credentials by
          these flags.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="provider">Provider</Label>
            <select
              id="provider"
              v-model="form.provider"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              :aria-invalid="!!errors.provider"
              @change="onProviderChange"
            >
              <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
              <option v-if="providerHasCustom" :value="form.provider">
                {{ form.provider }} (custom)
              </option>
            </select>
            <p v-if="errors.provider" class="text-xs text-destructive">
              {{ errors.provider }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label for="model">Model</Label>
            <select
              id="model"
              v-model="form.model"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              :aria-invalid="!!errors.model"
              @change="onModelChange"
            >
              <option value="" disabled>Select a model</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
              <option v-if="modelHasCustom" :value="form.model">
                {{ form.model }} (custom)
              </option>
            </select>
            <p v-if="errors.model" class="text-xs text-destructive">
              {{ errors.model }}
            </p>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="fallbackModel">Fallback model (optional)</Label>
            <select
              id="fallbackModel"
              v-model="form.fallbackModel"
              class="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">(none)</option>
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
              <option v-if="fallbackHasCustom" :value="form.fallbackModel">
                {{ form.fallbackModel }} (custom)
              </option>
            </select>
          </div>
          <div class="grid gap-2">
            <Label for="label">Label (optional)</Label>
            <Input id="label" v-model="form.label" placeholder="primary" />
          </div>
        </div>

        <div class="grid gap-2">
          <Label>Capabilities</Label>
          <label class="flex items-center gap-2 text-sm" for="cap-chat">
            <Checkbox
              id="cap-chat"
              :model-value="form.supportsChat"
              @update:model-value="
                (v: boolean | 'indeterminate') => (form.supportsChat = v === true)
              "
            />
            Use for chat (agent invocations)
          </label>
          <label class="flex items-center gap-2 text-sm" for="cap-embedding">
            <Checkbox
              id="cap-embedding"
              :model-value="form.supportsEmbedding"
              @update:model-value="
                (v: boolean | 'indeterminate') =>
                  (form.supportsEmbedding = v === true)
              "
            />
            Use for embedding (Knowledge / RAG)
          </label>
          <p v-if="errors.capabilities" class="text-xs text-destructive">
            {{ errors.capabilities }}
          </p>
          <p class="text-xs text-muted-foreground">
            Picking a model from the dropdown auto-fills these flags from the
            model's known capabilities. Override here if needed.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="status">Status</Label>
          <select
            id="status"
            v-model="form.status"
            class="h-9 rounded-md border bg-background px-3 text-sm max-w-xs"
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>

        <div class="grid gap-2">
          <Label for="apiKey">API key</Label>
          <Input
            id="apiKey"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-ant-… / sk-…"
            :aria-invalid="!!errors.apiKey"
          />
          <p v-if="errors.apiKey" class="text-xs text-destructive">
            {{ errors.apiKey }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? 'Create credential') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
```

- [ ] **Step 11.2: Browser test: create new credential**

Make sure the dev stack is up (`raunch dev` or `make dev`). Open `http://localhost:3001/llms/create`. Verify in the browser:

- Provider dropdown shows `Anthropic`, `OpenAI` (and any legacy provider if present in DB).
- Model dropdown is empty until provider is picked. After picking `OpenAI`, dropdown lists 4 models.
- Pick `text-embedding-3-small`. The "Use for embedding" checkbox auto-checks; chat auto-unchecks.
- Pick `gpt-4o-mini`. Capabilities flip to chat=true, embedding=false.
- Try to submit with both checkboxes off (uncheck them manually). Form shows `Pick at least one capability`.
- Fill API key and submit. Listing page returns; new row appears.

- [ ] **Step 11.3: Browser test: edit a legacy credential**

If a credential exists with `model='claude-3-5-sonnet-20241022'` (or any model not in the catalog), open it via the edit page. Verify:

- Provider dropdown displays "Anthropic" selected.
- Model dropdown has an extra option "claude-3-5-sonnet-20241022 (custom)" selected.
- Save works without changing model. The legacy string is preserved in DB.

(If no such legacy row exists, manually `INSERT` one via psql to test, or skip and rely on Phase 1 reviewer to validate later.)

- [ ] **Step 11.4: Commit**

```bash
git add admin/slices/llm/components/llm/Form.vue
git commit -m "feat(admin/llm): rewrite credential form with provider/model dropdowns and capabilities"
```

---

## Task 12: Wire `?capability=...` query param into the create page

**Files:**
- Modify: `admin/slices/llm/components/llmCreate/Provider.vue`

- [ ] **Step 12.1: Read query param and pre-set capabilities**

Replace `admin/slices/llm/components/llmCreate/Provider.vue` with:

```vue
<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import { IconArrowLeft } from '@tabler/icons-vue';

const llmStore = useLlmStore();
const route = useRoute();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

function readCapability(value: unknown): 'chat' | 'embedding' | null {
  if (typeof value !== 'string') return null;
  if (value === 'chat' || value === 'embedding') return value;
  return null;
}

const initialValues = computed<ILlmCredentialInput>(() => {
  const requested = readCapability(route.query.capability);
  return {
    provider: 'claude',
    model: '',
    apiKey: '',
    supportsChat: requested === null ? true : requested === 'chat',
    supportsEmbedding: requested === 'embedding',
  };
});

async function onSubmit(values: ILlmCredentialInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await llmStore.create(values);
    await navigateTo('/llms');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/llms');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/llms"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to LLMs
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New credential</h1>
      <p class="text-sm text-muted-foreground">
        Add an LLM provider/model pair with its API key.
      </p>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <LlmForm
      :initial-values="initialValues"
      :submitting="submitting"
      submit-label="Create credential"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
```

- [ ] **Step 12.2: Browser test: deep link**

Visit `http://localhost:3001/llms/create?capability=embedding`. Verify:

- "Use for embedding" checkbox is checked on load; "Use for chat" is unchecked.

Visit `http://localhost:3001/llms/create?capability=chat`. Verify:

- "Use for chat" checked; "Use for embedding" unchecked.

Visit `http://localhost:3001/llms/create` (no query). Verify:

- Default: chat=true, embedding=false.

- [ ] **Step 12.3: Commit**

```bash
git add admin/slices/llm/components/llmCreate/Provider.vue
git commit -m "feat(admin/llm): pre-fill capability checkboxes from ?capability= query"
```

---

## Task 13: Add credential pickers to Knowledge settings

**Files:**
- Modify: `admin/slices/setting/pages/settings/knowledge.vue`

- [ ] **Step 13.1: Replace the page**

Replace `admin/slices/setting/pages/settings/knowledge.vue` with:

```vue
<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const SETTING_GROUP = 'knowledge';

interface ITextField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  description?: string;
}

const TEXT_FIELDS: ITextField[] = [
  {
    name: 'url',
    label: 'Knowledge service URL',
    placeholder: 'http://lightrag.platform.svc.cluster.local:9621',
  },
  {
    name: 'api_key',
    label: 'API key',
    type: 'password',
    placeholder: 'shared secret with the knowledge service',
  },
  {
    name: 's3_bucket',
    label: 'S3 bucket for source files',
    placeholder: 'ranch-reins-sources',
  },
];

const settingStore = useSettingStore();
const llmStore = useLlmStore();

await Promise.all([
  useAsyncData('admin-settings-knowledge', () => settingStore.fetchAll()),
  useAsyncData('admin-settings-knowledge-llms', () => llmStore.fetchAll()),
]);

function readEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

function readString(name: string): string {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'string' ? v : '';
}

const enabled = ref<boolean>(readEnabled());
const values = reactive<Record<string, string>>({});
for (const f of TEXT_FIELDS) {
  values[f.name] = readString(f.name);
}
const chatCredentialId = ref<string>(readString('chat_credential_id'));
const embeddingCredentialId = ref<string>(readString('embedding_credential_id'));

const chatCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter((c) => c.supportsChat && c.status === 'active'),
);
const embeddingCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter(
    (c) => c.supportsEmbedding && c.status === 'active',
  ),
);

function credentialLabel(c: ILlmCredentialData): string {
  const tag = c.label !== null && c.label.length > 0 ? ` (${c.label})` : '';
  return `${c.provider} / ${c.model}${tag}`;
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave(): Promise<void> {
  if (
    enabled.value &&
    (chatCredentialId.value === '' || embeddingCredentialId.value === '')
  ) {
    errorMessage.value =
      'Pick both a chat and an embedding credential before enabling the service.';
    return;
  }

  saving.value = true;
  errorMessage.value = null;
  try {
    const tasks: Promise<unknown>[] = [];

    const currentEnabled = settingStore.get(SETTING_GROUP, 'enabled')?.value;
    const currentEnabledBool =
      typeof currentEnabled === 'boolean' ? currentEnabled : true;
    if (enabled.value !== currentEnabledBool) {
      tasks.push(
        settingStore.upsert(SETTING_GROUP, 'enabled', enabled.value, 'json'),
      );
    }

    for (const f of TEXT_FIELDS) {
      const next = values[f.name] ?? '';
      const current = settingStore.get(SETTING_GROUP, f.name)?.value;
      if (next !== (typeof current === 'string' ? current : '')) {
        tasks.push(settingStore.upsert(SETTING_GROUP, f.name, next, 'string'));
      }
    }

    const currentChat = readString('chat_credential_id');
    if (chatCredentialId.value !== currentChat) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'chat_credential_id',
          chatCredentialId.value,
          'string',
        ),
      );
    }

    const currentEmbedding = readString('embedding_credential_id');
    if (embeddingCredentialId.value !== currentEmbedding) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'embedding_credential_id',
          embeddingCredentialId.value,
          'string',
        ),
      );
    }

    await Promise.all(tasks);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>Knowledge service</CardTitle>
        <CardDescription>
          External RAG/knowledge service. Toggle off to disable knowledges
          across the admin and runtime even if the URL is set.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="knowledge-enabled">
          <Checkbox
            id="knowledge-enabled"
            :model-value="enabled"
            @update:model-value="(v: boolean | 'indeterminate') => (enabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="knowledge-enabled" class="cursor-pointer">
              Enable knowledge service
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, /knowledges API returns disabled and the admin hides
              knowledge pickers.
            </p>
            <p class="text-xs text-muted-foreground/70">knowledge/enabled</p>
          </div>
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>LLM credentials</CardTitle>
        <CardDescription>
          Pick which LLM credentials LightRAG uses. Chat handles agent
          invocations against the knowledge graph; embedding vectorizes source
          chunks. Filtered by capability flags.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="chat-credential">Chat LLM credential</Label>
          <select
            id="chat-credential"
            v-model="chatCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option
              v-for="c in chatCredentials"
              :key="c.id"
              :value="c.id"
            >
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            Used as <code>LLM_BINDING</code> / <code>LLM_MODEL</code> /
            <code>LLM_BINDING_API_KEY</code> in the LightRAG container.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/chat_credential_id
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="embedding-credential">Embedding LLM credential</Label>
          <select
            id="embedding-credential"
            v-model="embeddingCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option
              v-for="c in embeddingCredentials"
              :key="c.id"
              :value="c.id"
            >
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            Used as <code>EMBEDDING_BINDING</code> /
            <code>EMBEDDING_MODEL</code> /
            <code>EMBEDDING_BINDING_API_KEY</code>.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/embedding_credential_id
          </p>
        </div>

        <p
          class="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
        >
          After changing credentials, URL, or any LightRAG-relevant value,
          update <code>OPENAI_API_KEY</code> and the embedding/LLM model env
          vars in your <code>.env</code> (local dev) or the
          <code>lightrag-api</code> k8s secret (prod), then restart the
          LightRAG container or pod. Auto-sync of these values from the admin
          is planned for a follow-up phase.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Service connection</CardTitle>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div v-for="field in TEXT_FIELDS" :key="field.name" class="grid gap-2">
          <Label :for="`knowledge-${field.name}`">{{ field.label }}</Label>
          <Input
            :id="`knowledge-${field.name}`"
            v-model="values[field.name]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'new-password' : 'off'"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
          />
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ SETTING_GROUP }}/{{ field.name }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">
        Saved at {{ savedAt }}
      </span>
      <span v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </span>
    </div>
  </div>
</template>
```

- [ ] **Step 13.2: Browser test**

Visit `http://localhost:3001/settings/knowledge`. Verify:

- Three cards visible: Knowledge service (enable toggle), LLM credentials (two dropdowns), Service connection (URL/api_key/S3 inputs).
- Chat dropdown lists only credentials with `supportsChat=true`. Embedding dropdown lists only `supportsEmbedding=true`. Empty if no matching credentials.
- Toggle "Enable" on while leaving credentials unset and click Save: error banner appears with the validation message; nothing is saved (`Saved at` does not update).
- Pick credentials, hit Save: `Saved at <time>` shows. Refresh page: selections persist.

- [ ] **Step 13.3: Commit**

```bash
git add admin/slices/setting/pages/settings/knowledge.vue
git commit -m "feat(admin/setting): add chat/embedding credential pickers to knowledge settings"
```

---

## Task 14: Extend admin Knowledge store with `setup` parsing

**Files:**
- Modify: `admin/slices/reins/stores/knowledge.ts`

- [ ] **Step 14.1: Replace `fetchStatus` and add `setup` ref**

Open `admin/slices/reins/stores/knowledge.ts`. Locate the section near the top with `function isStatusBody...` and the inside-store `enabled` / `statusChecked` / `fetchStatus` block. Replace those pieces.

The new pieces to apply:

(a) Replace the `isStatusBody` helper with two type guards:

```ts
export interface IKnowledgeSetupStatus {
  hasChatCredential: boolean;
  hasEmbeddingCredential: boolean;
  hasUrl: boolean;
  hasBucket: boolean;
  hasCredentialsSelected: boolean;
  isHealthy: boolean;
}

const EMPTY_SETUP: IKnowledgeSetupStatus = {
  hasChatCredential: false,
  hasEmbeddingCredential: false,
  hasUrl: false,
  hasBucket: false,
  hasCredentialsSelected: false,
  isHealthy: false,
};

function isSetupBody(value: unknown): value is IKnowledgeSetupStatus {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.hasChatCredential === 'boolean' &&
    typeof o.hasEmbeddingCredential === 'boolean' &&
    typeof o.hasUrl === 'boolean' &&
    typeof o.hasBucket === 'boolean' &&
    typeof o.hasCredentialsSelected === 'boolean' &&
    typeof o.isHealthy === 'boolean'
  );
}

function isStatusBody(
  value: unknown,
): value is { enabled: boolean; setup?: IKnowledgeSetupStatus } {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.enabled !== 'boolean') return false;
  if (o.setup !== undefined && !isSetupBody(o.setup)) return false;
  return true;
}
```

(b) Inside `defineStore('reins-knowledge', ...)` add a `setup` ref next to `enabled` and update `fetchStatus`:

```ts
const setup = ref<IKnowledgeSetupStatus>(EMPTY_SETUP);

async function fetchStatus(): Promise<boolean> {
  try {
    const res = await apiClient.get<unknown>({ url: '/knowledges/status' });
    const body = unwrap<unknown>(res.data);
    if (isStatusBody(body)) {
      enabled.value = body.enabled;
      setup.value = body.setup ?? EMPTY_SETUP;
    } else {
      enabled.value = false;
      setup.value = EMPTY_SETUP;
    }
  } catch {
    enabled.value = false;
    setup.value = EMPTY_SETUP;
  }
  statusChecked.value = true;
  return enabled.value;
}
```

(c) Add `setup` to the `return { ... }` of the store at the bottom:

```ts
return {
  items,
  loading,
  error,
  enabled,
  statusChecked,
  setup,
  fetchStatus,
  fetchAll,
  // ... rest unchanged
};
```

- [ ] **Step 14.2: Type-check / dev server warning check**

Restart the admin dev server (`Ctrl+C` then `npm --prefix admin run dev`) and watch for compile errors in the terminal. Should be clean.

- [ ] **Step 14.3: Commit**

```bash
git add admin/slices/reins/stores/knowledge.ts
git commit -m "feat(admin/reins): parse setup details from /knowledges/status"
```

---

## Task 15: Build the Knowledge setup wizard component

**Files:**
- Create: `admin/slices/reins/components/knowledgeSetup/Wizard.vue`

- [ ] **Step 15.1: Write the wizard**

Create `admin/slices/reins/components/knowledgeSetup/Wizard.vue`:

```vue
<script setup lang="ts">
import type { IKnowledgeSetupStatus } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconCheck, IconCircle, IconCopy } from '@tabler/icons-vue';

interface IStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  cta?: { label: string; to: string };
}

const props = defineProps<{
  setup: IKnowledgeSetupStatus;
  enabled: boolean;
}>();

const configStepDone = computed(
  () =>
    props.enabled &&
    props.setup.hasUrl &&
    props.setup.hasBucket &&
    props.setup.hasCredentialsSelected,
);

const steps = computed<IStep[]>(() => [
  {
    id: 'embedding-credential',
    title: 'Create an embedding LLM credential',
    description:
      'Knowledge needs a model that turns source chunks into vectors (e.g. OpenAI text-embedding-3-small).',
    done: props.setup.hasEmbeddingCredential,
    cta: { label: 'Create embedding credential', to: '/llms/create?capability=embedding' },
  },
  {
    id: 'chat-credential',
    title: 'Create a chat LLM credential',
    description:
      'LightRAG uses a chat model to answer queries (e.g. OpenAI gpt-4o-mini or Anthropic Claude).',
    done: props.setup.hasChatCredential,
    cta: { label: 'Create chat credential', to: '/llms/create?capability=chat' },
  },
  {
    id: 'service-config',
    title: 'Configure the Knowledge service',
    description:
      'Set the LightRAG URL, S3 bucket, pick chat and embedding credentials, then turn the service on.',
    done: configStepDone.value,
    cta: { label: 'Open settings', to: '/settings/knowledge' },
  },
  {
    id: 'restart-lightrag',
    title: 'Restart LightRAG',
    description:
      "Apply the new env vars by restarting the container so LightRAG picks up the OpenAI key and models. Until that, queries will use the previous binding.",
    done: props.setup.isHealthy,
  },
]);

const allDone = computed(() => steps.value.every((s) => s.done));

const localCommand = 'make dev';
const k8sCommand = 'kubectl rollout restart deploy/lightrag -n platform';

const copiedKey = ref<string | null>(null);
async function copy(value: string, key: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  copiedKey.value = key;
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = null;
  }, 1500);
}

defineExpose({ allDone });
</script>

<template>
  <Card v-if="!allDone">
    <CardHeader>
      <CardTitle>Set up Knowledge</CardTitle>
      <CardDescription>
        Knowledge is not ready yet. Walk through the steps below to bring the
        service online.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      <ol class="grid gap-3">
        <li
          v-for="step in steps"
          :key="step.id"
          class="flex items-start gap-3 rounded-md border p-3"
          :class="step.done ? 'bg-muted/30' : 'bg-background'"
        >
          <span
            class="mt-0.5 inline-flex size-5 items-center justify-center rounded-full"
            :class="
              step.done
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-muted text-muted-foreground'
            "
          >
            <IconCheck v-if="step.done" class="size-3.5" />
            <IconCircle v-else class="size-3.5" />
          </span>
          <div class="flex-1 grid gap-2">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="text-sm font-medium">{{ step.title }}</h3>
              <span
                v-if="step.done"
                class="text-xs font-medium text-emerald-600"
              >
                Done
              </span>
            </div>
            <p class="text-xs text-muted-foreground">{{ step.description }}</p>

            <template v-if="step.id === 'restart-lightrag' && !step.done">
              <div class="grid gap-2">
                <p class="text-xs font-medium text-muted-foreground">Local</p>
                <div class="flex items-center gap-2">
                  <code class="rounded bg-muted px-2 py-1 text-xs">
                    {{ localCommand }}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    @click="copy(localCommand, 'local')"
                  >
                    <IconCopy class="size-3.5 mr-1" />
                    {{ copiedKey === 'local' ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
                <p class="text-xs font-medium text-muted-foreground">Kubernetes</p>
                <div class="flex items-center gap-2">
                  <code class="rounded bg-muted px-2 py-1 text-xs">
                    {{ k8sCommand }}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    @click="copy(k8sCommand, 'k8s')"
                  >
                    <IconCopy class="size-3.5 mr-1" />
                    {{ copiedKey === 'k8s' ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
              </div>
            </template>

            <div v-else-if="step.cta && !step.done">
              <NuxtLink :to="step.cta.to">
                <Button type="button" size="sm" variant="default">
                  {{ step.cta.label }}
                </Button>
              </NuxtLink>
            </div>
          </div>
        </li>
      </ol>
    </CardContent>
  </Card>
</template>
```

- [ ] **Step 15.2: Commit**

```bash
git add admin/slices/reins/components/knowledgeSetup/Wizard.vue
git commit -m "feat(admin/reins): add knowledge setup wizard component"
```

---

## Task 16: Mount the wizard on `/knowledges`

**Files:**
- Modify: `admin/slices/reins/pages/knowledges/index.vue`

- [ ] **Step 16.1: Render wizard above the list when not ready**

Replace `admin/slices/reins/pages/knowledges/index.vue` with:

```vue
<script setup lang="ts">
const store = useKnowledgeStore();
await useAsyncData('knowledges-status', () => store.fetchStatus());

const allReady = computed(
  () =>
    store.enabled &&
    store.setup.hasChatCredential &&
    store.setup.hasEmbeddingCredential &&
    store.setup.hasUrl &&
    store.setup.hasBucket &&
    store.setup.hasCredentialsSelected &&
    store.setup.isHealthy,
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <KnowledgeSetupWizard
      v-if="!allReady"
      :setup="store.setup"
      :enabled="store.enabled"
    />
    <KnowledgeListProvider v-else />
  </div>
</template>
```

(`KnowledgeSetupWizard` resolves via Nuxt auto-imports for components under `admin/slices/reins/components/knowledgeSetup/`. If it does not auto-resolve, an explicit import is `import KnowledgeSetupWizard from '#reins/components/knowledgeSetup/Wizard.vue'` placed in the `<script>` block.)

- [ ] **Step 16.2: Browser test: full happy path**

Have the dev stack running. Open `http://localhost:3001/knowledges` in a browser:

(a) **Initial state.** With no embedding credential and Knowledge disabled, the wizard shows. Steps 1, 3, 4 are red; step 2 is green if you already have an active chat-capable credential (default for legacy rows). The list does not render.

(b) **Step 1.** Click "Create embedding credential". Page navigates to `/llms/create?capability=embedding`. Embedding checkbox already checked. Pick OpenAI / `text-embedding-3-small`, paste a key, save. Browser returns to `/llms`. Navigate back to `/knowledges`. Step 1 turns green.

(c) **Step 2.** If not already green, repeat for chat capability via "Create chat credential" CTA.

(d) **Step 3.** Click "Open settings". Pick the new credentials in the dropdowns, fill URL and S3 bucket, toggle "Enable" on, save. Return to `/knowledges`. Step 3 turns green.

(e) **Step 4.** With LightRAG running locally and reachable at the configured URL, the health probe succeeds and step 4 turns green. The wizard collapses; the regular knowledge list renders.

If LightRAG is not running, step 4 stays red and the list does not appear. The user uses the copy buttons to grab the restart commands.

(f) **Negative case.** In `/settings/knowledge`, clear one of the credential dropdowns and save. The validation banner blocks the save. Restore the value to clear the error.

- [ ] **Step 16.3: Commit**

```bash
git add admin/slices/reins/pages/knowledges/index.vue
git commit -m "feat(admin/reins): mount knowledge setup wizard on /knowledges"
```

---

## Final integration check

- [ ] **Step F.1: Run a full admin build**

```bash
npm --prefix admin run build
```

Expected: build passes. Any TS error here indicates a downstream consumer of the changed types or the regenerated client that was missed; fix and amend the relevant commit (or add a follow-up commit).

- [ ] **Step F.2: Run the api build**

```bash
npm --prefix api run build
```

Expected: build passes.

- [ ] **Step F.3: Manual smoke (5 minutes)**

With `make dev` running:

1. `/llms` shows the existing list with no visual regressions in the columns (capability columns are not displayed in the list yet; that is acceptable for Phase 1, the form is the only surface).
2. `/llms/create` with default form: provider dropdown, model dropdown filtered. Save flow works.
3. `/settings/knowledge`: three cards, validation banner triggers on enable+missing creds.
4. `/knowledges`: wizard or list depending on state. Wizard CTAs link correctly. Copy buttons copy the right command.

If everything looks right, the branch is ready for review.

---

## Self-review (already applied)

- **Spec coverage:** Section 1 → Tasks 1, 2, 3. Section 2 → Task 10. Section 3 → Tasks 11, 12. Section 4 → Task 13. Section 5 → Tasks 15, 16. Section 6 → Tasks 4, 5, 6, 7, 8. Section 7 (data flow) → exercised by Task 16 browser test. Section 8 (out of scope) → respected. Section 9 (migration / backward compat) → Task 1 default values; Task 11 "(custom)" option for legacy values.
- **Placeholder scan:** No TODO / TBD / "implement later" left. Each step has the actual code or an exact command.
- **Type consistency:** `IKnowledgeSetupStatus` defined once in Task 14 and consumed by name in Task 15. `LlmCapability` defined in Task 4 and is the argument of `hasCredentialWithCapability` used in Task 7. Field names (`supportsChat`, `supportsEmbedding`) match across api types, DTO, prisma schema, admin store, and admin form.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-knowledge-llm-credentials-phase-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
