# Reins Extraction (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the empty `CleanSlice/reins` repo with a bridle-style template (NestJS + Nuxt + docs) so a CleanSlice teammate can install reins via a Quick Install prompt and get working knowledge management end-to-end.

**Architecture:** Single repo with `nestjs/`, `nuxt/`, and `docs/` subdirs. Source-of-truth content is copied 1:1 from ranch's `api/src/slices/reins/`, `admin/slices/reins/`, and the reins-related part of `admin/slices/setting/pages/settings/knowledge.vue`. The repo carries no runtime; it is a template that other CleanSlice projects copy into their own slice directories.

**Tech Stack:** Node 20+, NestJS 10, Nuxt 3, Pinia, Prisma 6, VitePress for docs.

**Reference spec:** `docs/superpowers/specs/2026-05-07-reins-extraction-design.md` (in this ranch repo).

**Working directories:**
- Ranch (source-of-truth, read-only for this plan): `/Users/hatsaxi/Work/ranch`
- Reins target repo (empty, write here): `/Users/hatsaxi/Work/reins`. Already cloned from `https://github.com/CleanSlice/reins`. Branch `main` initialized but no commits yet.

**Conventions to respect:**
- No tests in this plan. Reins repo, like ranch, ships without a test suite. Manual verification per task.
- Commit messages: `<type>(<scope>): <subject>`. No `Co-Authored-By` lines.
- No em dashes (U+2014) or en dashes (U+2013) in any markdown or code output. Use plain hyphens, commas, or colons.
- Strong TypeScript: no `any`, no `as` outside boundary cases. Reins inherits ranch's typing discipline.
- Vue: no leading meta comments, no imports of Nuxt auto-imports.
- All commands in this plan use absolute paths to avoid ambiguity about working directory.

---

## File map

**Create in `/Users/hatsaxi/Work/reins/`:**

Root:
- `.gitignore`
- `.env.example`
- `Makefile`
- `package.json` (top-level, docs build for Heroku)
- `README.md` (Quick Install prompt + packages table)
- `.github/workflows/lint.yml` (optional minimal CI)

Sync tooling:
- `scripts/sync-from-ranch.sh` (driven by `make sync-from-ranch RANCH_PATH=...`)

NestJS package (sources copied from ranch):
- `nestjs/package.json`
- `nestjs/tsconfig.json`
- `nestjs/README.md`
- `nestjs/reins.module.ts` (umbrella)
- `nestjs/index.ts` (public exports)
- `nestjs/knowledge/**` (copied from `ranch/api/src/slices/reins/knowledge/**`)
- `nestjs/source/**` (copied)
- `nestjs/lightrag/**` (copied)
- `nestjs/config/**` (copied)

Nuxt package (sources copied from ranch):
- `nuxt/package.json`
- `nuxt/tsconfig.json`
- `nuxt/README.md`
- `nuxt/nuxt.config.ts`
- `nuxt/theme/` (minimal shadcn-vue subset for layer's standalone dev)
- `nuxt/pages/knowledges/**` (copied from `ranch/admin/slices/reins/pages/knowledges/**`)
- `nuxt/pages/settings/knowledge.vue` (copied from `ranch/admin/slices/setting/pages/settings/knowledge.vue`)
- `nuxt/components/**` (copied)
- `nuxt/stores/knowledge.ts` (copied)
- `nuxt/plugins/menu.ts` (copied)
- `nuxt/i18n/locales/en.json` (copied)
- `nuxt/assets/**` (copied if present)

Docs site:
- `docs/package.json`
- `docs/docs/.vitepress/config.ts`
- `docs/docs/.vitepress/public/cleanslice-reins-background.png` (placeholder PNG until CTO ships banner)
- `docs/docs/index.md`
- `docs/docs/getting-started.md`
- `docs/docs/lightrag.md`
- `docs/docs/settings.md`
- `docs/docs/credentials.md`

---

## Task 1: Bootstrap repo root

**Files:**
- Create: `/Users/hatsaxi/Work/reins/.gitignore`
- Create: `/Users/hatsaxi/Work/reins/.env.example`
- Create: `/Users/hatsaxi/Work/reins/Makefile`
- Create: `/Users/hatsaxi/Work/reins/package.json`

The repo is already cloned at `/Users/hatsaxi/Work/reins` with `origin` pointing to `CleanSlice/reins`. No commits yet, on branch `main`. Verify before starting:

```bash
cd /Users/hatsaxi/Work/reins && git status
```

Expected output includes `On branch main` and `No commits yet`.

- [ ] **Step 1.1: Write `/Users/hatsaxi/Work/reins/.gitignore`**

```
node_modules/
dist/
_static/
.DS_Store
*.log
.env
.env.local
docs/docs/.vitepress/dist/
docs/docs/.vitepress/cache/
```

- [ ] **Step 1.2: Write `/Users/hatsaxi/Work/reins/.env.example`**

```
# Used by docs site only (Heroku deploy).
# Reins package consumers do not read this file. See nestjs/README.md for runtime env vars.
PORT=8080
```

- [ ] **Step 1.3: Write `/Users/hatsaxi/Work/reins/Makefile`**

```makefile
.PHONY: help install dev docs sync-from-ranch

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-25s %s\n", $$1, $$2}'

install: ## Install docs deps
	cd docs && npm ci

dev: ## Run docs site in dev mode
	cd docs && npm run dev

docs: ## Build docs static site
	cd docs && npm run build

sync-from-ranch: ## Copy nestjs/ and nuxt/ from a ranch checkout: make sync-from-ranch RANCH_PATH=/path/to/ranch
	@bash scripts/sync-from-ranch.sh "$(RANCH_PATH)"
```

- [ ] **Step 1.4: Write `/Users/hatsaxi/Work/reins/package.json`**

```json
{
  "name": "reins",
  "version": "0.1.0",
  "private": true,
  "description": "Knowledge / RAG slice for CleanSlice projects",
  "engines": { "node": ">=20" },
  "scripts": {
    "heroku-postbuild": "cd docs && npm ci && npm run build && cd .. && rm -rf _static && cp -r docs/docs/.vitepress/dist _static",
    "build": "cd docs && npm ci && npm run build && cd .. && rm -rf _static && cp -r docs/docs/.vitepress/dist _static",
    "start": "serve -s _static -l tcp://0.0.0.0:${PORT:-8080}"
  },
  "dependencies": {
    "serve": "^14.2.4"
  }
}
```

- [ ] **Step 1.5: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add .gitignore .env.example Makefile package.json
git commit -m "chore: initial repo scaffold"
```

Verify:
```bash
cd /Users/hatsaxi/Work/reins && git log --oneline
```
Expected: one commit, `chore: initial repo scaffold`.

---

## Task 2: NestJS package skeleton

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nestjs/package.json`
- Create: `/Users/hatsaxi/Work/reins/nestjs/tsconfig.json`

- [ ] **Step 2.1: Create the directory**

```bash
mkdir -p /Users/hatsaxi/Work/reins/nestjs
```

- [ ] **Step 2.2: Write `/Users/hatsaxi/Work/reins/nestjs/package.json`**

```json
{
  "name": "reins-nestjs",
  "version": "0.1.0",
  "private": true,
  "description": "Reins NestJS slice: Knowledge + Source + LightRAG + Config",
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/swagger": "^7.4.0",
    "@prisma/client": "^6.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "prisma": "^6.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2.3: Write `/Users/hatsaxi/Work/reins/nestjs/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2.4: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nestjs/
git commit -m "chore(nestjs): package skeleton"
```

---

## Task 3: Copy reins NestJS source from ranch

**Files:**
- Copy: `ranch/api/src/slices/reins/knowledge/` → `reins/nestjs/knowledge/`
- Copy: `ranch/api/src/slices/reins/source/` → `reins/nestjs/source/`
- Copy: `ranch/api/src/slices/reins/lightrag/` → `reins/nestjs/lightrag/`
- Copy: `ranch/api/src/slices/reins/config/` → `reins/nestjs/config/`

- [ ] **Step 3.1: Copy each subdirectory**

```bash
cp -r /Users/hatsaxi/Work/ranch/api/src/slices/reins/knowledge /Users/hatsaxi/Work/reins/nestjs/
cp -r /Users/hatsaxi/Work/ranch/api/src/slices/reins/source    /Users/hatsaxi/Work/reins/nestjs/
cp -r /Users/hatsaxi/Work/ranch/api/src/slices/reins/lightrag  /Users/hatsaxi/Work/reins/nestjs/
cp -r /Users/hatsaxi/Work/ranch/api/src/slices/reins/config    /Users/hatsaxi/Work/reins/nestjs/
```

- [ ] **Step 3.2: Verify file count matches**

```bash
echo "Source (ranch):"
find /Users/hatsaxi/Work/ranch/api/src/slices/reins -type f -name "*.ts" -o -name "*.prisma" | wc -l
echo "Copied (reins):"
find /Users/hatsaxi/Work/reins/nestjs -type f -name "*.ts" -o -name "*.prisma" | wc -l
```

Expected: the two counts match exactly. Mismatch means cp missed something; investigate before continuing.

- [ ] **Step 3.3: Spot check a key file**

```bash
diff /Users/hatsaxi/Work/ranch/api/src/slices/reins/knowledge/knowledge.controller.ts /Users/hatsaxi/Work/reins/nestjs/knowledge/knowledge.controller.ts
```

Expected: no output (files identical).

- [ ] **Step 3.4: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nestjs/knowledge nestjs/source nestjs/lightrag nestjs/config
git commit -m "feat(nestjs): copy reins slice from ranch (knowledge, source, lightrag, config)"
```

Note: the copied files retain ranch-specific imports like `#/setup/prisma/prisma.module`, `#/aws/s3`, `#/llm/domain`. These are CleanSlice host-side aliases, intentional. The README will document the requirement.

---

## Task 4: Add `ReinsModule` umbrella and `index.ts` re-exports

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nestjs/reins.module.ts`
- Create: `/Users/hatsaxi/Work/reins/nestjs/index.ts`

- [ ] **Step 4.1: Write `/Users/hatsaxi/Work/reins/nestjs/reins.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { SourceModule } from './source/source.module';

/**
 * Reins Module: Knowledge / RAG slice for CleanSlice projects.
 *
 * Bundles:
 *   - KnowledgeModule: CRUD for knowledge bases plus /knowledges/status with setup readiness.
 *   - SourceModule: CRUD for sources attached to a knowledge.
 *
 * Sub-modules pull their own deps transitively:
 *   - ConfigModule (knowledge config gateway, reads url/api_key/bucket/credential ids from settings)
 *   - LightragModule (HTTP client to LightRAG service)
 *   - AwsModule (S3 storage for source files)
 *
 * Host requirements:
 *   - Prisma + prisma-import configured to merge knowledge.prisma and source.prisma.
 *   - llm slice with ILlmGateway.hasCredentialWithCapability and supportsChat / supportsEmbedding columns on LlmCredential.
 *   - setting slice with ISettingGateway.findByKey.
 *   - aws/s3 slice with S3Repository.
 *   - LightRAG service deployed (docker-compose or k8s); see docs/lightrag.md.
 *
 * Usage:
 *
 * ```ts
 * import { ReinsModule } from './slices/reins';
 *
 * @Module({ imports: [ReinsModule] })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [KnowledgeModule, SourceModule],
  exports: [KnowledgeModule, SourceModule],
})
export class ReinsModule {}
```

- [ ] **Step 4.2: Write `/Users/hatsaxi/Work/reins/nestjs/index.ts`**

```ts
export { ReinsModule } from './reins.module';

export { KnowledgeModule } from './knowledge/knowledge.module';
export { KnowledgeController } from './knowledge/knowledge.controller';
export { KnowledgeService } from './knowledge/domain/knowledge.service';
export { IKnowledgeGateway } from './knowledge/domain/knowledge.gateway';
export * from './knowledge/domain/knowledge.types';
export * from './knowledge/dtos';

export { SourceModule } from './source/source.module';
export { SourceController } from './source/source.controller';
export { SourceService } from './source/domain/source.service';
export { ISourceGateway } from './source/domain/source.gateway';
export * from './source/domain/source.types';
export * from './source/dtos';

export { LightragModule } from './lightrag/lightrag.module';
export { ILightragClient } from './lightrag/domain/lightrag.client';
export * from './lightrag/domain/lightrag.types';

export { ConfigModule as ReinsConfigModule } from './config/config.module';
export { IKnowledgeConfigGateway } from './config/domain/knowledgeConfig.gateway';
```

The `ConfigModule` re-export is aliased to `ReinsConfigModule` to avoid collision with `@nestjs/config` `ConfigModule`. The host can import either, but most hosts use `@nestjs/config` for env handling and `ReinsConfigModule` is wired transitively, so this alias is mainly for explicit access.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nestjs/reins.module.ts nestjs/index.ts
git commit -m "feat(nestjs): add ReinsModule umbrella and public exports"
```

---

## Task 5: Write `nestjs/README.md`

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nestjs/README.md`

- [ ] **Step 5.1: Write the README**

Content for `/Users/hatsaxi/Work/reins/nestjs/README.md`:

````markdown
# Reins NestJS Slice

Knowledge / RAG slice for CleanSlice projects. Bundles knowledge base CRUD, source ingestion, LightRAG HTTP client, and config gateway.

## Prerequisites

The host CleanSlice project must provide:

- Prisma + `prisma-import` configured to merge slice prismas (`schemas: "./src/**/!(schema).prisma"`).
- `llm` slice exporting `ILlmGateway` with method `hasCredentialWithCapability(capability: 'chat' | 'embedding'): Promise<boolean>`. The `LlmCredential` model must have `supportsChat: Boolean` and `supportsEmbedding: Boolean` columns.
- `setting` slice exporting `ISettingGateway` with `findByKey(group: string, key: string)`.
- `aws/s3` slice exporting `S3Repository` and `AwsModule`.
- A LightRAG service reachable from the API. See `../docs/lightrag.md`.

The slice imports host modules via the following path aliases:

| Alias | Resolves to |
|---|---|
| `#/setup/prisma/prisma.module` | host's PrismaService and module |
| `#/setup/prisma/prisma.service` | host's PrismaService |
| `#/aws/aws.module` | host's AWS module |
| `#/aws/s3` | host's S3Repository (named export) |
| `#/llm/domain` | host's `ILlmGateway` and llm types |
| `#/setting/domain` | host's `ISettingGateway` |

CleanSlice projects with the standard layout configure these aliases in `tsconfig.json` paths and Nest's module resolution.

## Dependencies

```bash
npm i @nestjs/common @nestjs/config @nestjs/core @nestjs/swagger @prisma/client class-transformer class-validator reflect-metadata rxjs
```

Prisma client and prisma CLI come from the host's `api/package.json`.

## Setup

1. Copy this directory into `api/src/slices/reins/`.

2. Run the host's migrate command:

   ```bash
   npm --prefix api run migrate
   ```

   This runs `prisma-import` to merge `knowledge.prisma` and `source.prisma` into the host's combined schema, then generates the migration.

3. Import the umbrella module:

   ```ts
   // api/src/app.module.ts
   import { ReinsModule } from './slices/reins';

   @Module({ imports: [ReinsModule, /* other slices */] })
   export class AppModule {}
   ```

4. Set runtime configuration. Either via environment variables or via the `setting` table at runtime:

   | Source | Variable / setting key | Purpose |
   |---|---|---|
   | env | `LIGHTRAG_URL` | LightRAG service URL |
   | env | `LIGHTRAG_API_KEY` | LightRAG shared secret |
   | env | `REINS_S3_BUCKET` | S3 bucket for source files |
   | setting | `knowledge/url` | Same as `LIGHTRAG_URL`, overrides env |
   | setting | `knowledge/api_key` | Same as `LIGHTRAG_API_KEY` |
   | setting | `knowledge/s3_bucket` | Same as `REINS_S3_BUCKET` |
   | setting | `knowledge/enabled` | `true` / `false`. When `false`, `/knowledges/*` returns 503. |
   | setting | `knowledge/chat_credential_id` | Pointer into `LlmCredential.id` for chat completions in LightRAG. |
   | setting | `knowledge/embedding_credential_id` | Pointer into `LlmCredential.id` for embeddings in LightRAG. |

   Settings take precedence over env vars when set.

## HTTP API

| Endpoint | Description |
|---|---|
| `GET /knowledges` | List all knowledge bases (returns `[]` when `knowledge/enabled` is `false`) |
| `GET /knowledges/status` | Service status and setup readiness (used by the wizard) |
| `GET /knowledges/:id` | Single knowledge by id |
| `POST /knowledges` | Create knowledge |
| `PUT /knowledges/:id` | Update knowledge |
| `DELETE /knowledges/:id` | Delete knowledge |
| `POST /knowledges/:id/index` | Trigger LightRAG ingestion of all sources |
| `POST /knowledges/:id/query` | Query the knowledge graph (mode: hybrid / local / global / naive) |
| `GET /knowledges/graph/labels` | Entity labels in the graph |
| `GET /knowledges/graph` | Get graph subgraph by label |
| `GET /knowledges/:knowledgeId/sources` | List sources |
| `POST /knowledges/:knowledgeId/sources` | Add source (text / url / file) |
| `DELETE /knowledges/:knowledgeId/sources/:sourceId` | Delete source |

`GET /knowledges/status` response shape:

```json
{
  "enabled": true,
  "setup": {
    "hasChatCredential": true,
    "hasEmbeddingCredential": false,
    "hasUrl": true,
    "hasBucket": true,
    "hasCredentialsSelected": false,
    "isHealthy": true
  }
}
```

## Architecture

```
KnowledgeController
  |-> KnowledgeService -> IKnowledgeGateway (Prisma)
  |-> IKnowledgeConfigGateway (settings + env)
  |-> ILightragClient (HTTP to LightRAG)
  |-> ILlmGateway (host)

SourceController
  |-> SourceService -> ISourceGateway (Prisma + S3)
  |-> ILightragClient
  |-> S3Repository (host)

LightragHttpClient -> LightRAG service
```

The `ILightragClient.health()` call has a 2-second `AbortController` timeout to keep the wizard's status probe responsive.

## Known constraints

- LightRAG configures its LLM and embedding bindings at container start. Reins admin picks credentials but does not push them into the LightRAG container in this phase. Restart the container after changing the credential settings. See `../docs/credentials.md`.
- `Source.url` for `type='file'` stores an `s3://bucket/key` URI. Other source types use `type='url'` (external URL) or `type='text'` (inline content).
````

- [ ] **Step 5.2: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nestjs/README.md
git commit -m "docs(nestjs): write package README with prerequisites and API reference"
```

---

## Task 6: Nuxt package skeleton

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nuxt/package.json`
- Create: `/Users/hatsaxi/Work/reins/nuxt/tsconfig.json`
- Create: `/Users/hatsaxi/Work/reins/nuxt/nuxt.config.ts`

- [ ] **Step 6.1: Create the directory**

```bash
mkdir -p /Users/hatsaxi/Work/reins/nuxt
```

- [ ] **Step 6.2: Write `/Users/hatsaxi/Work/reins/nuxt/package.json`**

```json
{
  "name": "reins-nuxt",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Reins Nuxt layer: knowledge admin pages, components, store",
  "dependencies": {
    "nuxt": "^3.16.0",
    "vue": "^3.5.0",
    "pinia": "^2.3.0",
    "@pinia/nuxt": "^0.9.0",
    "@vueuse/core": "^11.0.0",
    "@tabler/icons-vue": "^3.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6.3: Write `/Users/hatsaxi/Work/reins/nuxt/tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

- [ ] **Step 6.4: Write `/Users/hatsaxi/Work/reins/nuxt/nuxt.config.ts`**

```ts
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],

  alias: {
    '#reins': currentDir,
    '#theme': `${currentDir}/theme`,
  },

  components: [
    { path: `${currentDir}/components`, pathPrefix: false },
  ],

  imports: {
    dirs: [`${currentDir}/stores`],
  },

  vite: {
    plugins: [tailwindcss()],
  },

  devServer: {
    port: 3001,
  },

  devtools: { enabled: false },
});
```

The `#theme` alias resolves to the layer's local fallback `theme/` directory. When this layer is extended into a host project, the host's `#theme` alias takes precedence (Nuxt resolves host aliases before layer aliases).

- [ ] **Step 6.5: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nuxt/package.json nuxt/tsconfig.json nuxt/nuxt.config.ts
git commit -m "chore(nuxt): layer skeleton with #reins and #theme aliases"
```

---

## Task 7: Copy reins admin source from ranch

**Files:**
- Copy: `ranch/admin/slices/reins/pages/` → `reins/nuxt/pages/`
- Copy: `ranch/admin/slices/reins/components/` → `reins/nuxt/components/`
- Copy: `ranch/admin/slices/reins/stores/` → `reins/nuxt/stores/`
- Copy: `ranch/admin/slices/reins/plugins/` → `reins/nuxt/plugins/`
- Copy: `ranch/admin/slices/reins/i18n/` → `reins/nuxt/i18n/`

- [ ] **Step 7.1: Copy each subdirectory**

```bash
cp -r /Users/hatsaxi/Work/ranch/admin/slices/reins/pages      /Users/hatsaxi/Work/reins/nuxt/
cp -r /Users/hatsaxi/Work/ranch/admin/slices/reins/components /Users/hatsaxi/Work/reins/nuxt/
cp -r /Users/hatsaxi/Work/ranch/admin/slices/reins/stores     /Users/hatsaxi/Work/reins/nuxt/
cp -r /Users/hatsaxi/Work/ranch/admin/slices/reins/plugins    /Users/hatsaxi/Work/reins/nuxt/
cp -r /Users/hatsaxi/Work/ranch/admin/slices/reins/i18n       /Users/hatsaxi/Work/reins/nuxt/
```

- [ ] **Step 7.2: Spot check identity**

```bash
diff /Users/hatsaxi/Work/ranch/admin/slices/reins/components/knowledgeSetup/Wizard.vue /Users/hatsaxi/Work/reins/nuxt/components/knowledgeSetup/Wizard.vue
```

Expected: no output.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nuxt/pages nuxt/components nuxt/stores nuxt/plugins nuxt/i18n
git commit -m "feat(nuxt): copy reins admin slice from ranch (pages, components, stores, plugins, i18n)"
```

---

## Task 8: Extract `/settings/knowledge.vue` from ranch's setting slice

**Files:**
- Copy: `ranch/admin/slices/setting/pages/settings/knowledge.vue` → `reins/nuxt/pages/settings/knowledge.vue`

The settings page for knowledge currently lives in ranch's `setting` slice (a generic CleanSlice settings shell). For reins to ship a complete admin experience, this page moves into the reins layer. The host's settings nav adds a link; the page itself comes from the layer.

- [ ] **Step 8.1: Create the directory and copy**

```bash
mkdir -p /Users/hatsaxi/Work/reins/nuxt/pages/settings
cp /Users/hatsaxi/Work/ranch/admin/slices/setting/pages/settings/knowledge.vue /Users/hatsaxi/Work/reins/nuxt/pages/settings/knowledge.vue
```

- [ ] **Step 8.2: Verify**

```bash
diff /Users/hatsaxi/Work/ranch/admin/slices/setting/pages/settings/knowledge.vue /Users/hatsaxi/Work/reins/nuxt/pages/settings/knowledge.vue
```

Expected: no output.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nuxt/pages/settings/knowledge.vue
git commit -m "feat(nuxt): extract /settings/knowledge page into reins layer"
```

---

## Task 9: Theme fallback for layer's standalone dev

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nuxt/theme/` with a minimal shadcn-vue subset.

The layer references `#theme/components/ui/button`, `#theme/components/ui/card`, `#theme/components/ui/checkbox`, `#theme/components/ui/input`, `#theme/components/ui/label`, `#theme/components/ui/textarea`, `#theme/components/ui/scroll-area`, `#theme/components/ui/table`, and `#theme/components/ui/badge`. When a host extends the layer, the host's `#theme` overrides the layer's local fallback. The fallback exists so a maintainer can `npm install && npm run dev` inside `nuxt/` for layer-level development without a host project.

This task ships **minimal stubs**, not full shadcn-vue components. Each stub re-exports a plain HTML element wrapped to match the API. This is intentional: reins does not own the theme; the host does. Stubs only let the layer build.

- [ ] **Step 9.1: Create the directory tree**

```bash
mkdir -p /Users/hatsaxi/Work/reins/nuxt/theme/components/ui/{button,card,checkbox,input,label,textarea,scroll-area,table,badge}
mkdir -p /Users/hatsaxi/Work/reins/nuxt/theme/utils
```

- [ ] **Step 9.2: Write the stub `index.ts` files**

For each component directory, write `/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/<name>/index.ts` that re-exports a single `.vue` stub. Example for `button`:

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/button/index.ts`:
```ts
export { default as Button } from './Button.vue';
```

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/button/Button.vue`:
```vue
<script setup lang="ts">
defineProps<{
  variant?: string;
  size?: string;
  type?: string;
  disabled?: boolean;
}>();
</script>

<template>
  <button :type="type ?? 'button'" :disabled="disabled" class="reins-stub-button">
    <slot />
  </button>
</template>
```

Apply the same pattern for each of: `Button`, `Input`, `Label`, `Textarea`, `Checkbox`, `ScrollArea`, `Badge`.

For card, ship five named exports:

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/card/index.ts`:
```ts
export { default as Card } from './Card.vue';
export { default as CardHeader } from './CardHeader.vue';
export { default as CardTitle } from './CardTitle.vue';
export { default as CardDescription } from './CardDescription.vue';
export { default as CardContent } from './CardContent.vue';
export { default as CardFooter } from './CardFooter.vue';
```

Each is a one-liner Vue file:

`Card.vue`:
```vue
<template><div class="reins-stub-card"><slot /></div></template>
```

`CardHeader.vue`:
```vue
<template><div class="reins-stub-card-header"><slot /></div></template>
```

`CardTitle.vue`:
```vue
<template><h3 class="reins-stub-card-title"><slot /></h3></template>
```

`CardDescription.vue`:
```vue
<template><p class="reins-stub-card-description"><slot /></p></template>
```

`CardContent.vue`:
```vue
<template><div class="reins-stub-card-content"><slot /></div></template>
```

`CardFooter.vue`:
```vue
<template><div class="reins-stub-card-footer"><slot /></div></template>
```

For table, ship six named exports:

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/table/index.ts`:
```ts
export { default as Table } from './Table.vue';
export { default as TableHeader } from './TableHeader.vue';
export { default as TableBody } from './TableBody.vue';
export { default as TableRow } from './TableRow.vue';
export { default as TableHead } from './TableHead.vue';
export { default as TableCell } from './TableCell.vue';
```

Each is a one-liner with the equivalent HTML element (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`).

For checkbox, the stub uses an `<input type="checkbox">` wrapped to match the shadcn API:

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/checkbox/Checkbox.vue`:
```vue
<script setup lang="ts">
const props = defineProps<{ modelValue?: boolean | 'indeterminate'; id?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean | 'indeterminate'] }>();

function onChange(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    emit('update:modelValue', target.checked);
  }
}
</script>

<template>
  <input
    type="checkbox"
    :id="id"
    :checked="modelValue === true"
    class="reins-stub-checkbox"
    @change="onChange"
  />
</template>
```

For scroll-area:

`/Users/hatsaxi/Work/reins/nuxt/theme/components/ui/scroll-area/ScrollArea.vue`:
```vue
<template>
  <div class="reins-stub-scroll-area" style="overflow-y: auto"><slot /></div>
</template>
```

- [ ] **Step 9.3: Write the cn utility stub**

`/Users/hatsaxi/Work/reins/nuxt/theme/utils/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9.4: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nuxt/theme
git commit -m "chore(nuxt): minimal #theme fallback for layer standalone dev"
```

---

## Task 10: Write `nuxt/README.md`

**Files:**
- Create: `/Users/hatsaxi/Work/reins/nuxt/README.md`

- [ ] **Step 10.1: Write the README**

Content for `/Users/hatsaxi/Work/reins/nuxt/README.md`:

````markdown
# Reins Nuxt Layer

Knowledge / RAG admin UI for CleanSlice projects. Pages, components, stores, and a setup wizard.

## Prerequisites

The host Nuxt admin must provide:

- `#theme` alias resolving to a shadcn-vue compatible theme. The layer uses these components:
  - `#theme/components/ui/button` - `Button`
  - `#theme/components/ui/card` - `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
  - `#theme/components/ui/checkbox` - `Checkbox`
  - `#theme/components/ui/input` - `Input`
  - `#theme/components/ui/label` - `Label`
  - `#theme/components/ui/textarea` - `Textarea`
  - `#theme/components/ui/scroll-area` - `ScrollArea`
  - `#theme/components/ui/table` - `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`
  - `#theme/components/ui/badge` - (used in some layouts)
- A generated API client at `#api/data` with `KnowledgesService`, `KnowledgeSourcesService`, `LlmsService`, `SettingsService`. The store calls these.
- `useLlmStore` (from the host's `llm` slice) exposing items with `supportsChat`, `supportsEmbedding`, `status` fields.
- `useSettingStore` (from the host's `setting` slice) with `fetchAll`, `get(group, key)`, `upsert(group, key, value, valueType)`.
- A sidebar menu store at `#common/stores/menu` with `addSidebar({ id, group, title, link, active, icon, sortOrder })` and a `MenuGroupTypes` enum.

## Setup

1. Copy this directory into `admin/slices/reins/`.

2. Add the layer to the host Nuxt config:

   ```ts
   // admin/nuxt.config.ts
   export default defineNuxtConfig({
     extends: ['./slices/reins'],
   });
   ```

3. Add a sidebar link to `/settings/knowledge` in your settings nav. The page itself ships from this layer.

4. Verify dependencies are installed in the admin:

   ```bash
   npm i @vueuse/core @tabler/icons-vue clsx tailwind-merge
   ```

   Pinia, `@pinia/nuxt`, Tailwind, and Nuxt itself should already be in the host.

## Routes added by this layer

| Route | Description |
|---|---|
| `/knowledges` | List of knowledge bases. Renders the setup wizard if not fully configured. |
| `/knowledges/create` | Create a new knowledge base. |
| `/knowledges/:id` | Knowledge detail wrapper with tab navigation. |
| `/knowledges/:id/edit` | Edit knowledge metadata. |
| `/knowledges/:id/sources` | Manage sources (text, url, file). |
| `/knowledges/:id/graph` | Visualize the knowledge graph. |
| `/knowledges/:id/query` | Query the knowledge with mode and topK controls. |
| `/settings/knowledge` | Knowledge service settings: enable, URL, S3 bucket, chat / embedding credential pickers. |

## Components

| Component | Purpose |
|---|---|
| `KnowledgeSetupWizard` | Renders 4 setup steps with done / pending state and copy-to-clipboard buttons for restart commands. |
| `KnowledgeListProvider` | Search box and table of knowledge bases. |
| `KnowledgeCreateProvider` / `KnowledgeEditProvider` | Form wrapper for create / edit pages. |
| `KnowledgeSourcesProvider`, `KnowledgeSourcesAddForm` | Source list and add form. |
| `KnowledgeGraphProvider` | D3 graph rendering. |
| `KnowledgeQueryProvider` | Query input and answer display. |
| `IndexStatusBadge` | Shows index status (idle / indexing / ready / failed). |
| `KnowledgeForm` | Reusable form for create / edit. |

## Stores

`useKnowledgeStore` (from `#reins/stores/knowledge`):

| Method | Purpose |
|---|---|
| `fetchStatus()` | GET `/knowledges/status`, populates `enabled` and `setup` refs. |
| `fetchAll()` | GET `/knowledges`. |
| `fetchById(id)` | GET `/knowledges/:id`. |
| `create / update / remove` | CRUD. |
| `startIndex(id)` | POST `/knowledges/:id/index`. |
| `query(id, q, mode, topK)` | POST `/knowledges/:id/query`. |
| `listSources / addTextSource / addUrlSource / addFileSource / removeSource` | Source CRUD. |
| `getGraphLabels / getGraph` | Graph endpoints. |

## Standalone dev (for layer maintainers)

```bash
cd nuxt
npm install
npm run dev
```

This uses the local `theme/` fallback and a stub API. Useful for working on components in isolation. Note that the wizard's status probe will fail without a backend; this is expected in standalone mode.
````

- [ ] **Step 10.2: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add nuxt/README.md
git commit -m "docs(nuxt): write package README with prerequisites, routes, components"
```

---

## Task 11: Docs scaffolding

**Files:**
- Create: `/Users/hatsaxi/Work/reins/docs/package.json`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/.vitepress/config.ts`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/.vitepress/public/cleanslice-reins-background.png` (1x1 placeholder PNG)

- [ ] **Step 11.1: Create directories**

```bash
mkdir -p /Users/hatsaxi/Work/reins/docs/docs/.vitepress/public
```

- [ ] **Step 11.2: Write `/Users/hatsaxi/Work/reins/docs/package.json`**

```json
{
  "name": "reins-docs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev docs",
    "build": "vitepress build docs",
    "preview": "vitepress preview docs"
  },
  "devDependencies": {
    "vitepress": "^1.5.0"
  }
}
```

- [ ] **Step 11.3: Write `/Users/hatsaxi/Work/reins/docs/docs/.vitepress/config.ts`**

```ts
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Reins',
  description: 'Knowledge / RAG slice for CleanSlice projects',
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'GitHub', link: 'https://github.com/CleanSlice/reins' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
        ],
      },
      {
        text: 'Setup',
        items: [
          { text: 'LightRAG', link: '/lightrag' },
          { text: 'Settings reference', link: '/settings' },
          { text: 'LLM credentials', link: '/credentials' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/CleanSlice/reins' },
    ],
  },
});
```

- [ ] **Step 11.4: Create the placeholder banner**

```bash
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDAT\x08\xd7c\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82' > /Users/hatsaxi/Work/reins/docs/docs/.vitepress/public/cleanslice-reins-background.png
```

This writes a valid 1x1 transparent PNG. The CTO will replace it with the real banner. The README references this asset path; the placeholder prevents 404s.

Verify:
```bash
file /Users/hatsaxi/Work/reins/docs/docs/.vitepress/public/cleanslice-reins-background.png
```
Expected: `PNG image data, 1 x 1, ...`.

- [ ] **Step 11.5: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add docs/package.json docs/docs/.vitepress/config.ts docs/docs/.vitepress/public/cleanslice-reins-background.png
git commit -m "chore(docs): VitePress scaffolding and placeholder banner"
```

---

## Task 12: Docs core content

**Files:**
- Create: `/Users/hatsaxi/Work/reins/docs/docs/index.md`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/getting-started.md`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/lightrag.md`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/settings.md`
- Create: `/Users/hatsaxi/Work/reins/docs/docs/credentials.md`

The four pages cover the essential install + ops surface. `nestjs.md`, `nuxt.md`, `prisma.md`, `api-reference.md` are deferred to Phase 2 (a separate plan); the package READMEs already cover most of that content.

- [ ] **Step 12.1: Write `/Users/hatsaxi/Work/reins/docs/docs/index.md`**

```markdown
# Reins

Knowledge / RAG slice for CleanSlice projects. Reins lets a CleanSlice host manage knowledge bases backed by LightRAG: ingest sources, query with hybrid retrieval, visualize the knowledge graph.

## Architecture

```
Browser (admin Nuxt)         CleanSlice API (NestJS)         LightRAG (separate service)
       |                              |                                 |
       |--- /knowledges/* ----------->|                                 |
       |                              |--- POST /documents/text ------->|
       |                              |--- POST /query --------------->|
       |<--- response -----------|<--- response ------------------|
                                      |
                                      |--- GET ILlmGateway.* (host's llm slice)
                                      |--- GET ISettingGateway.* (host's setting slice)
                                      |--- S3Repository.* (host's aws slice)
```

Reins ships:

- A NestJS slice (`nestjs/`) that goes into `api/src/slices/reins/`.
- A Nuxt layer (`nuxt/`) that goes into `admin/slices/reins/`.
- These docs.

What it does not ship:

- Identity / auth (use the host's existing auth).
- The LightRAG service itself (deploy via docker-compose or k8s; see [LightRAG setup](./lightrag)).
- LLM credentials (use the host's `llm` slice; see [LLM credentials](./credentials)).
- Generic settings UI (use the host's `setting` slice).

## Quick install

See [Getting started](./getting-started). Two-minute summary:

1. Make sure your CleanSlice host has prisma + prisma-import, an `llm` slice with capability flags, a `setting` slice, and an `aws/s3` slice.
2. Deploy LightRAG.
3. Copy `nestjs/` into `api/src/slices/reins/`.
4. Copy `nuxt/` into `admin/slices/reins/`.
5. Open `/knowledges` and follow the wizard.
```

- [ ] **Step 12.2: Write `/Users/hatsaxi/Work/reins/docs/docs/getting-started.md`**

```markdown
# Getting started

This page walks through installing reins into a CleanSlice project.

## Prerequisites

The host must have:

- Prisma + `prisma-import` configured (`schemas: "./src/**/!(schema).prisma"` in `api/package.json`).
- `llm` slice with `LlmCredential` table including `supportsChat: Boolean` and `supportsEmbedding: Boolean` columns. `ILlmGateway` interface with `hasCredentialWithCapability(capability: 'chat' | 'embedding'): Promise<boolean>`.
- `setting` slice with `ISettingGateway.findByKey(group: string, key: string)` that returns a record with a `value: unknown` field.
- `aws/s3` slice with an `S3Repository` class and `AwsModule`.
- A LightRAG service deployed and reachable (see [LightRAG setup](./lightrag)).
- Nuxt admin with `#theme` alias resolving to shadcn-vue components.

## Quick Install via Claude Code

The fastest path is to paste the Quick Install prompt from the [repo README](https://github.com/CleanSlice/reins#quick-install) into Claude Code. The agent clones the repo, copies files into the right slices, sets env vars, and walks the verification.

## Manual install

If you prefer to do it by hand:

1. Clone the reins repo:

   ```bash
   git clone https://github.com/CleanSlice/reins.git
   ```

2. Copy the NestJS slice into your API:

   ```bash
   cp -r reins/nestjs/* /path/to/your-project/api/src/slices/reins/
   ```

3. Run the migrate command in the host's `api/`:

   ```bash
   cd /path/to/your-project/api
   npm run migrate
   ```

   This merges `knowledge.prisma` and `source.prisma` into your combined schema and creates an auto migration.

4. Add `ReinsModule` to the host's `app.module.ts`:

   ```ts
   import { ReinsModule } from './slices/reins';
   @Module({ imports: [ReinsModule] })
   export class AppModule {}
   ```

5. Set env vars in the host's `api/.env`:

   ```
   LIGHTRAG_URL=http://localhost:9621
   LIGHTRAG_API_KEY=<shared secret>
   REINS_S3_BUCKET=<bucket name>
   ```

6. Copy the Nuxt layer into your admin:

   ```bash
   cp -r reins/nuxt/* /path/to/your-project/admin/slices/reins/
   ```

7. Add the layer to the host's `admin/nuxt.config.ts`:

   ```ts
   export default defineNuxtConfig({
     extends: ['./slices/reins'],
   });
   ```

8. Add a sidebar link to `/settings/knowledge` in your settings nav. The page itself ships from the layer.

9. Start the API and admin. Open `/knowledges` in the browser. The setup wizard guides you through creating credentials, configuring the service, and verifying the LightRAG connection.

## Verifying the install

After all four wizard steps are green, you should see:

- The knowledge list at `/knowledges` (the wizard collapses).
- The settings page at `/settings/knowledge` with three cards (service toggle, LLM credential pickers, service connection details).
- The LLM credential form at `/llms/create` showing capability checkboxes.

If the wizard stays red on step 4 (LightRAG unreachable), see [LightRAG setup](./lightrag) for troubleshooting.
```

- [ ] **Step 12.3: Write `/Users/hatsaxi/Work/reins/docs/docs/lightrag.md`**

```markdown
# LightRAG setup

Reins uses [LightRAG](https://github.com/HKUDS/LightRAG) as the underlying RAG engine. Reins does not ship LightRAG itself; you deploy it and point reins at it.

## Local (docker-compose)

A minimal `docker-compose.yml` snippet:

```yaml
services:
  lightrag-postgres:
    image: gzdaniel/postgres-for-rag:16.6
    ports: ['5433:5432']
    volumes: [lightrag-postgres-data:/var/lib/postgresql]

  ollama:
    image: ollama/ollama:latest
    ports: ['11434:11434']
    volumes: [ollama-data:/root/.ollama]

  lightrag:
    image: ghcr.io/hkuds/lightrag:latest
    ports: ['9621:9621']
    environment:
      LIGHTRAG_API_KEY: dev-secret-change-me
      LLM_BINDING: ollama
      LLM_MODEL: llama3.2:latest
      LLM_BINDING_HOST: http://ollama:11434
      EMBEDDING_BINDING: ollama
      EMBEDDING_MODEL: nomic-embed-text:latest
      EMBEDDING_BINDING_HOST: http://ollama:11434
      EMBEDDING_DIM: 768
      POSTGRES_HOST: lightrag-postgres
      POSTGRES_PORT: 5432
      POSTGRES_USER: rag
      POSTGRES_PASSWORD: rag
      POSTGRES_DATABASE: rag
      LIGHTRAG_KV_STORAGE: PGKVStorage
      LIGHTRAG_DOC_STATUS_STORAGE: PGDocStatusStorage
      LIGHTRAG_VECTOR_STORAGE: PGVectorStorage
      LIGHTRAG_GRAPH_STORAGE: PGGraphStorage
    depends_on: [lightrag-postgres, ollama]

volumes:
  lightrag-postgres-data:
  ollama-data:
```

After `docker compose up -d`, LightRAG is at `http://localhost:9621`. Set in your API's `.env`:

```
LIGHTRAG_URL=http://localhost:9621
LIGHTRAG_API_KEY=dev-secret-change-me
```

## Local with OpenAI bindings

Replace the LLM and embedding bindings:

```yaml
LLM_BINDING: openai
LLM_MODEL: gpt-4o-mini
LLM_BINDING_API_KEY: sk-...
EMBEDDING_BINDING: openai
EMBEDDING_MODEL: text-embedding-3-small
EMBEDDING_BINDING_API_KEY: sk-...
```

## Kubernetes

Apply a deployment + service + secret:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lightrag
  namespace: platform
spec:
  replicas: 1
  selector:
    matchLabels: { app: lightrag }
  template:
    metadata:
      labels: { app: lightrag }
    spec:
      containers:
        - name: lightrag
          image: ghcr.io/hkuds/lightrag:latest
          ports: [{ containerPort: 9621 }]
          env:
            - name: LIGHTRAG_API_KEY
              valueFrom: { secretKeyRef: { name: lightrag-api, key: apiKey } }
            - name: LLM_BINDING
              value: openai
            - name: LLM_MODEL
              value: gpt-4o-mini
            - name: LLM_BINDING_API_KEY
              valueFrom: { secretKeyRef: { name: lightrag-api, key: openaiApiKey } }
            - name: EMBEDDING_BINDING
              value: openai
            - name: EMBEDDING_MODEL
              value: text-embedding-3-small
            - name: EMBEDDING_BINDING_API_KEY
              valueFrom: { secretKeyRef: { name: lightrag-api, key: openaiApiKey } }
            # ... postgres connection vars
          readinessProbe:
            tcpSocket: { port: 9621 }
            initialDelaySeconds: 30
            periodSeconds: 10
```

Provision the secret out-of-band:

```bash
kubectl create secret generic lightrag-api -n platform \
  --from-literal=apiKey=$(openssl rand -hex 32) \
  --from-literal=openaiApiKey=sk-...
```

## Restart after credential changes

LightRAG configures its bindings at container start. Changing the chat or embedding credential in the reins admin does not automatically restart the container. Restart manually:

- Local: `docker compose restart lightrag`
- Kubernetes: `kubectl rollout restart deploy/lightrag -n platform`

The setup wizard's step 4 fails the health probe until LightRAG is back up. Auto-sync of credential settings into the LightRAG container env is on the Phase 2 roadmap.

## Troubleshooting

- **Wizard step 4 stays red.** Verify `LIGHTRAG_URL` is reachable from the API process: `curl $LIGHTRAG_URL/health -H "x-api-key: $LIGHTRAG_API_KEY"`. Should return 200.
- **Queries return empty results.** Check that the embedding model in LightRAG matches what was used during ingestion. Switching embedding models without re-ingesting all sources produces empty matches.
- **5xx from LightRAG on /documents/text.** Check the LightRAG container logs for OpenAI rate limits or postgres connection errors.
```

- [ ] **Step 12.4: Write `/Users/hatsaxi/Work/reins/docs/docs/settings.md`**

```markdown
# Settings reference

Reins reads runtime configuration from the host's `setting` table (group `knowledge`). Env vars provide fallback defaults. When a setting is non-empty, it takes precedence over the env var.

## Keys

| Setting key | Env fallback | Type | Description |
|---|---|---|---|
| `knowledge/url` | `LIGHTRAG_URL` | string | LightRAG service URL. |
| `knowledge/api_key` | `LIGHTRAG_API_KEY` | string | Shared secret matching LightRAG's `LIGHTRAG_API_KEY`. |
| `knowledge/s3_bucket` | `REINS_S3_BUCKET` | string | S3 bucket where source files are stored. |
| `knowledge/enabled` | (true) | boolean | Master switch. When `false`, all `/knowledges/*` mutations return 503 and the admin shows a wizard. |
| `knowledge/chat_credential_id` | (none) | string | Pointer to a row in `LlmCredential.id`. Used to provision LightRAG's LLM binding (manual restart required after change). |
| `knowledge/embedding_credential_id` | (none) | string | Pointer to a row in `LlmCredential.id`. Used to provision LightRAG's embedding binding. |

## Storage type

`knowledge/enabled` is stored as JSON (`true` or `false` boolean). All others are strings.

## Validation

`knowledge/enabled = true` requires both credential ids to be set. The admin's `/settings/knowledge` page rejects the save with an error message until the user fills both pickers.

## Endpoint exposure

`GET /knowledges/status` returns:

```json
{
  "enabled": true,
  "setup": {
    "hasChatCredential": true,
    "hasEmbeddingCredential": true,
    "hasUrl": true,
    "hasBucket": true,
    "hasCredentialsSelected": true,
    "isHealthy": true
  }
}
```

The wizard reads `setup` to color its 4 steps.
```

- [ ] **Step 12.5: Write `/Users/hatsaxi/Work/reins/docs/docs/credentials.md`**

```markdown
# LLM credentials

Reins selects which LLM credential LightRAG uses for chat completions and which it uses for embeddings. Both are pointers into the host's `LlmCredential` table.

## Capability flags

The host's `LlmCredential` model must include two boolean columns:

```prisma
model LlmCredential {
  // existing fields...
  supportsChat      Boolean @default(true)
  supportsEmbedding Boolean @default(false)
}
```

A credential can support either or both. The reins admin filters credentials in the settings dropdowns by these flags:

- "Chat LLM credential" picker shows only `supportsChat = true` rows.
- "Embedding LLM credential" picker shows only `supportsEmbedding = true` rows.

The host's `ILlmGateway` must expose:

```ts
hasCredentialWithCapability(capability: 'chat' | 'embedding'): Promise<boolean>;
```

The status endpoint calls this to populate `setup.hasChatCredential` and `setup.hasEmbeddingCredential`.

## Workflow

1. The user opens `/knowledges`. The wizard shows step 1 red.
2. The user clicks "Create embedding credential" and lands on `/llms/create?capability=embedding`. The form pre-checks the embedding flag.
3. The user picks a provider (e.g. OpenAI) and an embedding model (e.g. `text-embedding-3-small`). The form auto-fills `supportsEmbedding=true, supportsChat=false` from the model's static capability definition. The user enters an API key and saves.
4. The user repeats for a chat credential.
5. The user opens `/settings/knowledge`, picks both credentials in the dropdowns, sets the URL and S3 bucket, toggles enable, and saves.
6. The user restarts the LightRAG container so it picks up the new bindings (this is manual in Phase 1; see [LightRAG setup](./lightrag)).

## Why two credentials

LightRAG uses different models for two roles:

- **Chat / completion**: answers user queries against the knowledge graph. GPT-4o, Claude, Gemini all work.
- **Embedding**: turns source chunks into vectors at ingest time. Only embedding models work here (`text-embedding-3-small`, etc).

Some providers offer both kinds of models. Some only offer one. The capability flags let users mix providers (e.g. Anthropic Claude for chat, OpenAI for embedding) without UI confusion.

## Phase 2: auto-sync

The current phase requires a LightRAG container restart after credential changes. Phase 2 will add an auto-sync step: when settings change, the API rewrites the LightRAG environment (k8s secret patch or docker-compose env file) and triggers a restart. Until then, the wizard's step 4 reminds users to do this manually.
```

- [ ] **Step 12.6: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add docs/docs/index.md docs/docs/getting-started.md docs/docs/lightrag.md docs/docs/settings.md docs/docs/credentials.md
git commit -m "docs: write index, getting-started, lightrag, settings, credentials"
```

---

## Task 13: Top-level `README.md` with Quick Install prompt

**Files:**
- Create: `/Users/hatsaxi/Work/reins/README.md`

- [ ] **Step 13.1: Write the README**

Content for `/Users/hatsaxi/Work/reins/README.md`:

````markdown
![Reins](./docs/docs/.vitepress/public/cleanslice-reins-background.png)

# Reins

Knowledge / RAG slice for CleanSlice projects. Reins lets a CleanSlice host manage knowledge bases backed by LightRAG: ingest text, urls, and files; query with hybrid retrieval; visualize the knowledge graph.

**[Full documentation: reins.cleanslice.org](https://reins.cleanslice.org)**

[NestJS slice](./nestjs/README.md) - [Nuxt layer](./nuxt/README.md) - [LightRAG setup](./docs/docs/lightrag.md) - [Settings reference](./docs/docs/settings.md) - [LLM credentials](./docs/docs/credentials.md)

## Quick Install

Copy this prompt into Claude Code to add Reins to your CleanSlice project:

```
Add reins (Knowledge / RAG) to this CleanSlice project. The repo is at https://github.com/CleanSlice/reins

Prerequisites:
  - prisma + prisma-import configured in api/
  - llm slice with supportsChat / supportsEmbedding columns on LlmCredential and ILlmGateway.hasCredentialWithCapability
  - setting slice with ISettingGateway.findByKey
  - aws/s3 slice with S3Repository
  - LightRAG service deployed (docker-compose or k8s)

Steps:

1. Clone reins next to this project (or reference it if already cloned).

2. NestJS API:
   - Copy reins/nestjs/* into api/src/slices/reins/
   - Run `npm --prefix api run migrate` to create Knowledge and Source tables.
   - Add ReinsModule to api/src/app.module.ts:
       import { ReinsModule } from './slices/reins';
       @Module({ imports: [ReinsModule, /* other slices */] })
   - Set api/.env values:
       LIGHTRAG_URL=<your LightRAG URL>
       LIGHTRAG_API_KEY=<your LightRAG shared secret>
       REINS_S3_BUCKET=<bucket name for sources>
     (or set them via the settings table at runtime: knowledge/url, knowledge/api_key, knowledge/s3_bucket)

3. Nuxt admin:
   - Copy reins/nuxt/* into admin/slices/reins/
   - Add to admin/nuxt.config.ts: extends: ['./slices/reins']
   - Add a sidebar link to /settings/knowledge in your settings nav. The page itself ships from this layer.

4. LightRAG runtime:
   - Make sure LightRAG is reachable from the API. See https://reins.cleanslice.org/lightrag for the docker-compose snippet and k8s manifests.
   - Configure LightRAG's LLM and embedding bindings (OpenAI, Ollama, Azure) at the container level. Reins picks credentials in the admin but does not push them into the LightRAG container in this phase; restart the container after changing credentials.

5. Verify:
   - Open /knowledges in the admin. The wizard renders with 4 steps.
   - Walk through: create an embedding LLM credential (OpenAI text-embedding-3-small), create a chat credential (OpenAI gpt-4o-mini or Anthropic Claude), configure /settings/knowledge, restart LightRAG. The wizard collapses and the knowledge list appears.

Read the package READMEs (reins/nestjs/README.md and reins/nuxt/README.md) for full reference.
```

## Packages

| Directory | Description | Stack |
|---|---|---|
| `nestjs/` | API slice: Knowledge + Source CRUD, LightRAG client, config gateway | NestJS, Prisma 6 |
| `nuxt/` | Nuxt layer: knowledge admin pages, components, store, setup wizard | Nuxt 3, Vue 3, Pinia, shadcn-vue |
| `docs/` | Documentation site (VitePress), published at [reins.cleanslice.org](https://reins.cleanslice.org) | VitePress |

## Architecture

```
Browser (admin Nuxt)         CleanSlice API (NestJS)         LightRAG (separate)
       |                              |                                |
       |--- /knowledges/* ----------->|                                |
       |                              |--- POST /documents/text ------>|
       |                              |--- POST /query --------------->|
       |<--- response -----------|<--- response -----------------|
                                      |
                                      |--- ILlmGateway.* (host's llm slice)
                                      |--- ISettingGateway.* (host's setting slice)
                                      |--- S3Repository.* (host's aws slice)
```

## What reins is not

- An identity / auth provider. Use the host's existing auth.
- A LightRAG deployment. Deploy LightRAG via your own docker-compose or k8s.
- A generic LLM credentials manager. Use the host's `llm` slice.
- A standalone application. Reins is a template for CleanSlice projects.

## Status

Phase 1 (this release): NestJS slice + Nuxt layer + core docs. Manual restart required after credential changes.

Phase 2 (planned): auto-sync of credential settings into the LightRAG container env, removing the manual restart step.

## License

TBD by CleanSlice.
````

- [ ] **Step 13.2: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add README.md
git commit -m "docs: top-level README with Quick Install prompt and packages table"
```

---

## Task 14: Sync-from-ranch script

**Files:**
- Create: `/Users/hatsaxi/Work/reins/scripts/sync-from-ranch.sh`

The script accepts a `RANCH_PATH` argument and copies the relevant trees from ranch into reins. It also runs a sanity diff so the operator sees what changed.

- [ ] **Step 14.1: Create the directory**

```bash
mkdir -p /Users/hatsaxi/Work/reins/scripts
```

- [ ] **Step 14.2: Write `/Users/hatsaxi/Work/reins/scripts/sync-from-ranch.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

RANCH_PATH="${1:-}"
if [ -z "$RANCH_PATH" ]; then
  echo "Usage: scripts/sync-from-ranch.sh <ranch-checkout-path>" >&2
  echo "Or: make sync-from-ranch RANCH_PATH=<ranch-checkout-path>" >&2
  exit 1
fi

if [ ! -d "$RANCH_PATH/api/src/slices/reins" ]; then
  echo "Error: $RANCH_PATH does not look like a ranch checkout (missing api/src/slices/reins)" >&2
  exit 1
fi

REINS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Syncing reins state:"
echo "  source: $RANCH_PATH"
echo "  target: $REINS_ROOT"

NESTJS_DIRS=(knowledge source lightrag config)
echo
echo "==> NestJS slice"
for d in "${NESTJS_DIRS[@]}"; do
  echo "  copy $d/"
  rm -rf "$REINS_ROOT/nestjs/$d"
  cp -r "$RANCH_PATH/api/src/slices/reins/$d" "$REINS_ROOT/nestjs/"
done

echo
echo "==> Nuxt layer"
NUXT_DIRS=(pages components stores plugins i18n)
for d in "${NUXT_DIRS[@]}"; do
  if [ -d "$RANCH_PATH/admin/slices/reins/$d" ]; then
    echo "  copy admin/slices/reins/$d/"
    rm -rf "$REINS_ROOT/nuxt/$d"
    cp -r "$RANCH_PATH/admin/slices/reins/$d" "$REINS_ROOT/nuxt/"
  fi
done

# Settings page lives in ranch's setting slice; cherry-pick it.
echo "  copy admin/slices/setting/pages/settings/knowledge.vue"
mkdir -p "$REINS_ROOT/nuxt/pages/settings"
cp "$RANCH_PATH/admin/slices/setting/pages/settings/knowledge.vue" "$REINS_ROOT/nuxt/pages/settings/knowledge.vue"

echo
echo "==> Diff summary"
cd "$REINS_ROOT"
git status --short nestjs/ nuxt/ || true

echo
echo "Sync done. Review the diff with: git diff -- nestjs/ nuxt/"
echo "If it looks right, commit and push."
```

- [ ] **Step 14.3: Make it executable**

```bash
chmod +x /Users/hatsaxi/Work/reins/scripts/sync-from-ranch.sh
```

- [ ] **Step 14.4: Smoke test the script (dry observation)**

```bash
cd /Users/hatsaxi/Work/reins
bash scripts/sync-from-ranch.sh /Users/hatsaxi/Work/ranch
git status --short nestjs/ nuxt/
```

Expected: a clean working tree (no diff), since the contents already match what we just copied in tasks 3, 7, and 8. If diff is non-empty, ranch has drifted since the manual copy, in which case the diff is the new sync delta. Reset with `git checkout -- nestjs nuxt` to undo if you do not want to commit it.

- [ ] **Step 14.5: Commit**

```bash
cd /Users/hatsaxi/Work/reins
git add scripts/sync-from-ranch.sh
git commit -m "chore: add sync-from-ranch script for periodic updates"
```

---

## Task 15: First push to GitHub

**Files:** none new; pushing existing commits.

- [ ] **Step 15.1: Verify the local state**

```bash
cd /Users/hatsaxi/Work/reins
git log --oneline | head -20
git status
```

Expected: roughly 14 commits (one per task above), clean working tree.

- [ ] **Step 15.2: Push to remote**

```bash
cd /Users/hatsaxi/Work/reins
git push -u origin main
```

Expected: push succeeds. The remote `https://github.com/CleanSlice/reins` now has all commits.

If the push fails because the remote has divergent history (somehow has commits we did not see at clone time), do not force-push. Investigate first:

```bash
git fetch origin
git log --oneline origin/main | head
```

If origin/main has unexpected commits, escalate to the controller before resolving.

- [ ] **Step 15.3: Verify on GitHub**

```bash
gh repo view CleanSlice/reins
gh api repos/CleanSlice/reins/contents | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f\"{e['type']:5} {e['name']}\") for e in d if isinstance(d, list)]"
```

Expected: structure visible (`file README.md`, `dir nestjs`, `dir nuxt`, `dir docs`, etc).

- [ ] **Step 15.4: Notify the CTO**

(Manual step for the user, not the implementer.) Drop a Slack message in DM with Dmitriy Zhuk pointing at the repo.

---

## Final integration checks

- [ ] **Step F.1: Repo structure matches spec**

```bash
cd /Users/hatsaxi/Work/reins
ls -la
ls nestjs/ nuxt/ docs/ docs/docs/ scripts/
```

Expected: matches the spec's repo layout.

- [ ] **Step F.2: All ranch sources are represented**

```bash
echo "Ranch reins/ files:"
find /Users/hatsaxi/Work/ranch/api/src/slices/reins /Users/hatsaxi/Work/ranch/admin/slices/reins -type f | wc -l
echo "Reins package files (excluding wrappers and docs):"
find /Users/hatsaxi/Work/reins/nestjs/{knowledge,source,lightrag,config} /Users/hatsaxi/Work/reins/nuxt/{pages,components,stores,plugins,i18n} -type f | wc -l
```

Expected: counts close (within 1 because reins has the extracted `pages/settings/knowledge.vue` from a different ranch source, which adds 1 to reins's count).

- [ ] **Step F.3: Quick Install prompt is actionable**

Read the prompt in the top-level README. Verify each numbered step references a real file, env var, or command:

```bash
grep -nE "ReinsModule|LIGHTRAG_URL|LIGHTRAG_API_KEY|REINS_S3_BUCKET|extends:|capability=embedding|capability=chat" /Users/hatsaxi/Work/reins/README.md
```

Each match should point to something covered in package READMEs or docs.

- [ ] **Step F.4: VitePress builds**

(Optional, if Node 20 + npm available.)

```bash
cd /Users/hatsaxi/Work/reins/docs
npm install
npm run build
```

Expected: build succeeds, `docs/.vitepress/dist/` is created. If npm install fails on the executor's machine due to network restrictions, skip this step and mark as a known-good item to verify in CI.

---

## Self-review (already applied)

- **Spec coverage:**
  - Spec section "Repo structure" → Tasks 1, 2, 6, 11.
  - Spec section "Prerequisites" → Tasks 5 (NestJS README), 10 (Nuxt README), 12 (docs).
  - Spec section "NestJS module wiring" → Tasks 3, 4.
  - Spec section "Nuxt layer wiring" → Tasks 6, 7, 9.
  - Spec section "Quick Install prompt" → Task 13.
  - Spec section "Docs site" → Tasks 11, 12.
  - Spec section "File migration mapping" → Tasks 3, 7, 8.
  - Spec section "Workflow with ranch" → Task 14 (sync script).
  - Spec section "Out of scope" → respected (no npm publish, no auto-sync, no extra doc pages beyond essential 4).
  - Spec section "Risks" → addressed in package READMEs and docs (banner placeholder in Task 11, theme dependency in Task 10, Lightrag versioning in Task 12 docs).
- **Placeholder scan:** No TBD / TODO / "implement later" remain. The README mentions "TBD by CleanSlice" only for the License field, which is intentional.
- **Type / path consistency:** `ReinsModule` defined in Task 4 and referenced in Task 13. `IKnowledgeConfigGateway` referenced consistently. Settings keys (`knowledge/url`, `knowledge/api_key`, etc.) consistent across Tasks 5, 12.4, and 14. File paths use absolute prefixes throughout.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-reins-extraction-phase-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
