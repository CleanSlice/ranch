# Extract reins into `CleanSlice/reins` (Phase 1)

**Status:** draft
**Date:** 2026-05-07
**Target repo:** https://github.com/CleanSlice/reins (currently empty)
**Spec lives in ranch:** committed to a doc-only branch in this repo for tracking; implementation work happens in the target repo.

## Problem

The `reins` slice (knowledge bases backed by LightRAG, with sources, graph and query) currently lives only inside the ranch monorepo at `api/src/slices/reins/` and `admin/slices/reins/`. The CTO asked (Slack DM, 2026-05-07 11:37 IDT) to extract it into the empty `CleanSlice/reins` GitHub repo, mirroring how `CleanSlice/bridle` is structured: a template repo that other CleanSlice projects clone and copy into their own `api/src/slices/<name>/` and `app|admin/slices/<name>/`. The CTO will provide the repo banner; everything else (description, docs, NestJS module, Nuxt layer, install prompt) is on us.

Goals:
1. A self-contained `CleanSlice/reins` repo that, given a CleanSlice host, lets a teammate paste a Quick Install prompt into Claude Code and have working knowledge management end-to-end.
2. Keep ranch as the canonical development surface for now. The repo is a publish point, not a dependency.

## Decisions

| Question | Choice |
|---|---|
| Decoupling from CleanSlice conventions | CleanSlice-only. Reins assumes host has prisma+prisma-import, llm, setting, aws/s3 slices. No generic adapters in this phase. |
| Prisma model delivery | Ship `*.prisma` files alongside slice code. Host's `prisma-import` merges them. |
| Wizard route hardcoding | Wizard hardcodes `/llms/create?capability=...` and `/settings/knowledge`. Host with non-CleanSlice routing patches in fork. |
| Settings UI integration | Reins ships `/settings/knowledge` page from the Nuxt layer. Host adds a sidebar link in their own settings nav, but the page itself lives in reins. |
| Module entry point | Single top-level `ReinsModule` re-exports sub-modules. Sub-modules remain importable individually for fine-grained control. |
| Repo shape | Bridle-style monorepo: `nestjs/`, `nuxt/`, `docs/` subdirs; Quick Install prompt in root README. No npm publish in Phase 1. |
| Workflow with ranch | Ranch stays canonical. Initial push captures current ranch state. Manual sync when ranch reins evolves. |
| Tests | None. Ranch has no tests; reins-the-template carries no tests either. |

## Repo structure

```
reins/
├── README.md            CTO banner + Quick Install prompt + packages table + protocol notes
├── Makefile             helpers: clone-into-target, docs build, lint
├── package.json         top-level (docs build for Heroku, mirrors bridle)
├── package-lock.json
├── .env.example
├── .gitignore
├── .github/             workflows (lint, optional CI)
├── .do/                 Heroku/DigitalOcean deploy descriptors for the docs site
├── docs/                VitePress site, deployed to reins.cleanslice.org
│   ├── package.json
│   └── docs/
│       ├── .vitepress/config.ts
│       ├── public/
│       └── *.md         intro, getting-started, nestjs, nuxt, prisma, lightrag, settings, credentials, api-reference
├── nestjs/              copies into host's api/src/slices/reins/
│   ├── README.md         deps, module wiring, prerequisites
│   ├── package.json      private (so npm i in this dir wouldn't publish)
│   ├── tsconfig.json
│   ├── reins.module.ts   top-level umbrella
│   ├── index.ts          re-exports ReinsModule + sub-modules + services + gateways + types + DTOs
│   ├── knowledge/        knowledge.module, knowledge.controller, knowledge.prisma, data/, domain/, dtos/
│   ├── source/           source.module, source.controller, source.prisma, data/, domain/, dtos/
│   ├── lightrag/         lightrag.module, data/lightragHttp.client.ts, domain/
│   └── config/           config.module, data/knowledgeConfig.gateway.ts, domain/
└── nuxt/                copies into host's admin/slices/reins/
    ├── README.md
    ├── package.json      private
    ├── tsconfig.json
    ├── nuxt.config.ts    #reins alias, #theme fallback, components/stores/plugins/i18n auto-import
    ├── theme/            fallback shadcn-vue theme dir for layer's standalone dev
    ├── pages/
    │   ├── knowledges/
    │   │   ├── index.vue
    │   │   ├── create.vue
    │   │   ├── [id].vue
    │   │   └── [id]/
    │   │       ├── edit.vue
    │   │       ├── sources.vue
    │   │       ├── graph.vue
    │   │       └── query.vue
    │   └── settings/
    │       └── knowledge.vue
    ├── components/
    │   ├── knowledge/
    │   ├── knowledgeCreate/
    │   ├── knowledgeEdit/
    │   ├── knowledgeList/
    │   ├── knowledgeGraph/
    │   ├── knowledgeQuery/
    │   ├── knowledgeSources/
    │   └── knowledgeSetup/Wizard.vue
    ├── stores/knowledge.ts
    ├── plugins/menu.ts   adds "Knowledges" sidebar entry
    ├── i18n/locales/en.json
    └── assets/
```

## Prerequisites (documented in README)

The CleanSlice host project must provide:

- Prisma + `prisma-import` configured. Host's `api/package.json` has `"prisma": { "schemas": "./src/**/!(schema).prisma" }` and a `premigrate` hook that runs `prisma-import`. Reins's `*.prisma` files are picked up automatically when copied into `api/src/slices/reins/`.
- `setting` slice with `ISettingGateway.findByKey(group: string, key: string)` returning a record with a `value: unknown` field. Reins reads `knowledge/url`, `knowledge/api_key`, `knowledge/s3_bucket`, `knowledge/enabled`, `knowledge/chat_credential_id`, `knowledge/embedding_credential_id`.
- `llm` slice: `LlmCredential` table with `supportsChat: boolean` and `supportsEmbedding: boolean` columns. `ILlmGateway.hasCredentialWithCapability('chat' | 'embedding'): Promise<boolean>` method. `LlmModule` exports `ILlmGateway`.
- `aws/s3` slice: `S3Repository` class (with `parseUri` and instance methods used in `source.gateway.ts`) and `AwsModule` providing it.
- LightRAG service running and reachable. The host's docker-compose / k8s deploys LightRAG separately. Connection details live in either env vars (`LIGHTRAG_URL`, `LIGHTRAG_API_KEY`) or settings (`knowledge/url`, `knowledge/api_key`).
- Nuxt admin with `#theme` alias resolving to shadcn-vue Card, Button, Input, Label, Checkbox, Textarea, ScrollArea, Table primitives.

The Quick Install prompt enumerates these prerequisites at the top so a new teammate or LLM agent does not start mid-setup.

## NestJS module wiring

`nestjs/reins.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { SourceModule } from './source/source.module';

@Module({
  imports: [KnowledgeModule, SourceModule],
  exports: [KnowledgeModule, SourceModule],
})
export class ReinsModule {}
```

`KnowledgeModule` and `SourceModule` already pull `ConfigModule`, `LightragModule`, and `AwsModule` (for `SourceModule`) transitively, so the host only needs to import `ReinsModule`.

`nestjs/index.ts`:

```ts
export { ReinsModule } from './reins.module';
export * from './knowledge';   // module, service, gateway interface, types, DTOs
export * from './source';
export * from './lightrag';
export * from './config';
```

Each sub-folder gets its own `index.ts` that re-exports the public surface (the same as ranch's current state, so no new code needed there).

Host's `api/src/app.module.ts`:

```ts
import { ReinsModule } from './slices/reins';
@Module({ imports: [ReinsModule, /* other host slices */] })
export class AppModule {}
```

## Nuxt layer wiring

`nuxt/nuxt.config.ts`:

```ts
import { fileURLToPath } from 'url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

export default defineNuxtConfig({
  alias: {
    '#reins': currentDir,
    '#theme': `${currentDir}/theme`, // overridden by host's #theme
  },
  components: [{ path: `${currentDir}/components`, pathPrefix: false }],
  imports: { dirs: [`${currentDir}/stores`] },
});
```

Host `admin/nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  extends: ['./slices/reins'],
});
```

The host's `#theme` alias takes precedence because Nuxt resolves aliases from the host config first; the layer's fallback only applies when the layer is run standalone for layer-level development.

`nuxt/theme/` carries a minimal shadcn-vue setup so `npm run dev` inside `nuxt/` works in isolation. This is for layer maintainers, not for end users.

## Quick Install prompt (in README)

The README contains a verbatim block to paste into Claude Code:

````
Add reins (Knowledge / RAG) to this CleanSlice project. The repo is at https://github.com/CleanSlice/reins

Prerequisites:
  - prisma + prisma-import configured in api/
  - llm slice with supportsChat/supportsEmbedding columns and ILlmGateway.hasCredentialWithCapability
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
       @Module({ imports: [ReinsModule, ...] })
   - Set api/.env values:
       LIGHTRAG_URL=<your LightRAG URL>
       LIGHTRAG_API_KEY=<your LightRAG shared secret>
       REINS_S3_BUCKET=<bucket name for sources>
     (or set them via the settings table at runtime: knowledge/url, knowledge/api_key, knowledge/s3_bucket)

3. Nuxt admin:
   - Copy reins/nuxt/* into admin/slices/reins/
   - Add to admin/nuxt.config.ts: extends: ['./slices/reins']
   - Add a sidebar link to /settings/knowledge in your settings nav. The page itself ships from this layer, you only add the link.

4. LightRAG runtime:
   - Make sure LightRAG is reachable from the API. See docs/lightrag.md for docker-compose snippet and k8s manifests.
   - Configure LightRAG's LLM and embedding bindings (OpenAI / Ollama / Azure) at the container level. Reins picks credentials in the admin but does not push them into the LightRAG container in this phase; see docs/credentials.md.

5. Verify:
   - Open /knowledges in the admin. The wizard renders with 4 steps.
   - Walk through: create an embedding LLM credential, create a chat credential, configure /settings/knowledge, restart LightRAG. The wizard collapses and the knowledge list appears.
````

## Docs site

VitePress, deployed to `reins.cleanslice.org` via Heroku, mirrors bridle's docs setup. Pages:

- `index.md`: architecture diagram (Browser admin / Reins API / LightRAG / OpenAI), one-paragraph intro.
- `getting-started.md`: install steps, env vars, prerequisites, link to Quick Install prompt.
- `nestjs.md`: `ReinsModule` wiring, sub-modules, gateways, controllers, route table.
- `nuxt.md`: layer setup, components reference, pages, stores, slots and props.
- `prisma.md`: `Knowledge` and `Source` models with column descriptions.
- `lightrag.md`: docker-compose snippet, k8s manifests, OpenAI bindings, Ollama bindings, env var reference, LightRAG version pinning.
- `settings.md`: settings keys reference (`knowledge/url`, `knowledge/api_key`, `knowledge/s3_bucket`, `knowledge/enabled`, `knowledge/chat_credential_id`, `knowledge/embedding_credential_id`).
- `credentials.md`: capability flags pattern. Documents the host requirement on the `llm` slice. Diagram showing how a credential's `supportsEmbedding` flows from admin form through DB into the wizard's setup status.
- `api-reference.md`: HTTP endpoints (`/knowledges/*`, `/knowledges/:id/sources/*`, `/knowledges/status`) with request/response shapes.

The docs site does not need to be deployed in Phase 1 to count as done; deployment can happen after the repo lands. Source files committed to the repo are the deliverable.

## File migration mapping

What goes from ranch into reins:

| Source (ranch) | Destination (reins) |
|---|---|
| `api/src/slices/reins/knowledge/**` | `nestjs/knowledge/**` |
| `api/src/slices/reins/source/**` | `nestjs/source/**` |
| `api/src/slices/reins/lightrag/**` | `nestjs/lightrag/**` |
| `api/src/slices/reins/config/**` | `nestjs/config/**` |
| `admin/slices/reins/**` | `nuxt/**` |
| `admin/slices/setting/pages/settings/knowledge.vue` | `nuxt/pages/settings/knowledge.vue` |

What stays in ranch (host responsibility, unchanged in this extraction):

- `api/src/slices/llm/` (host's LLM credentials infra, including the recent capability flags work).
- `api/src/slices/setting/` (generic settings table).
- `api/src/slices/aws/` (S3 repository).
- `admin/slices/llm/` (LLM admin pages, including the new providers catalog and Form.vue).
- `admin/slices/setting/` (settings index page; host adds a link to `/settings/knowledge`).
- `admin/slices/agent/template/components/template/Form.vue` (the `knowledgeServiceEnabled` check is integration code, not part of reins).

New files to create in reins (not copied 1:1 from ranch):

- `nestjs/reins.module.ts`
- `nestjs/index.ts`
- Each sub-module's `index.ts` re-export (some already exist, verify and write where missing).
- `nestjs/README.md`, `nuxt/README.md`, top-level `README.md`.
- `nuxt/theme/` minimal shadcn-vue subset for standalone development.
- `docs/` VitePress scaffolding and pages.
- `Makefile`, `package.json` (top-level), `.env.example`, `.gitignore`, `.github/`, `.do/`.

## Workflow with ranch

Phase 1 commits the current state of ranch's reins to `CleanSlice/reins`. After that:

- Ranch remains canonical for reins development. New features, fixes, and refactors land on ranch's `feat/reins-*` branches and merge into ranch's main.
- Periodic syncs from ranch to `CleanSlice/reins` capture released versions. The sync is a manual rsync-style copy, scripted in reins's `Makefile` (a `make sync-from-ranch` target that takes `RANCH_PATH=` and copies the relevant trees plus runs a sanity check).
- Workflow for downstream projects (other CleanSlice apps that want reins): they consume the `CleanSlice/reins` repo via the Quick Install prompt. They never look at ranch directly.

This keeps the immediate task simple: push current state, set up docs, document the install path. The longer-term workflow (canonical flip, two-way sync tooling, npm publish) is out of scope.

## Out of scope (Phase 2 of reins)

- Real npm publishing for `@cleanslice/reins-nestjs` and `@cleanslice/reins-nuxt`.
- Auto-syncing OpenAI key from admin into LightRAG container env (this is a separate Phase 2 spec from the prior knowledge-llm-credentials work).
- Multi-tenant LightRAG (one instance per tenant).
- Generic adapters for non-CleanSlice hosts.
- Two-way sync tooling between ranch and `CleanSlice/reins`.
- Full deployment of `reins.cleanslice.org` docs site.

## Risks and open questions

- **Sync drift.** Ranch's reins evolves between syncs. Manual sync invites copy-paste mistakes. Mitigation: `make sync-from-ranch` script runs a tree diff after copy, fails loudly if unexpected files appear or disappear. Reviewer eyeballs the diff before pushing.
- **Theme dependency.** The Nuxt layer assumes the host's `#theme` exposes shadcn-vue primitives with the same component API. If a host has a different theme system, the layer's components break. Mitigation: README documents the exact required components and their import paths. The fallback `nuxt/theme/` is for layer maintainers, not as a polyfill for the host.
- **Prisma model evolution.** When ranch adds columns to `Knowledge` or `Source`, the next sync requires the host to run a migration. The Quick Install README links to a "Updating reins" section in the docs that explains the `npm run migrate` flow. Phase 2 may automate this.
- **LightRAG version pinning.** `LightragHttpClient` talks to a specific LightRAG API. If a host runs a different LightRAG version, requests may fail. Mitigation: `docs/lightrag.md` pins the recommended image tag. Phase 2 may bake in a version probe.
- **Wizard hardcoded routes.** `/llms/create?capability=...` and `/settings/knowledge` are baked into the wizard CTAs. A host that does not follow CleanSlice routing must patch the layer. Documented in `docs/nuxt.md`.
- **Banner asset.** CTO will provide the banner image. We commit a placeholder `docs/cleanslice-reins-background.png` (1x1 transparent PNG or similar) so the README does not 404 until the real image lands. Documented in README.

## References

- Bridle repo for shape reference: https://github.com/CleanSlice/bridle
- Empty target repo: https://github.com/CleanSlice/reins
- Slack DM with CTO 2026-05-07 setting the task: messages 1778143029 through 1778143139.
- Prior phase 1 spec (knowledge UX + LLM capabilities) which produced the wizard and capability flags now being extracted: `docs/superpowers/specs/2026-05-06-knowledge-llm-credentials-design.md`.
- Prior phase 1 plan: `docs/superpowers/plans/2026-05-06-knowledge-llm-credentials-phase-1.md`.
