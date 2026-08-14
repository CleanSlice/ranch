# Phase 0 Research: Upgrade operator consoles off Nuxt 3 EOL

**Date**: 2026-08-14 · **Spec**: [spec.md](./spec.md) · **Jira**: [CLEAN-32](https://dreamvention.atlassian.net/browse/CLEAN-32)

Repo reconnaissance plus current Nuxt 4 / i18n v10 / Pinia docs. No `NEEDS CLARIFICATION` items remain.

## Established facts

### F1 — Both consoles are Nuxt 3.21.2 SPAs composed from slices

- Declared `nuxt: ^3.16`, locked `nuxt@3.21.2`. Both roots set `ssr: false`, `compatibilityDate: '2024-10-04'`, no `future.compatibilityVersion`.
- Hosts: `app/` (user console, has root `app.vue`) and `admin/` (no root `app.vue`). No `srcDir`, no `server/`, no root `pages/`.
- Composition: `extends: [...registerSlices()]`. A directory is a layer iff it has `nuxt.config.ts`. `setup` and `common` are collected first. Nested groups (`setup/*`, `user/*`, `agent/*`) are not layers themselves.
- **11 layers in `app/`**, **28 layers in `admin/`**. Pages live only inside slices (~9 app, ~60 admin).

### F2 — Nuxt 4 `app/` directory collides with the workspace name

Nuxt 4 defaults `srcDir` to `app/`. The user console *is* already the workspace `app/`. Adopting the new layout literally would produce `app/app/app.vue` plus a demand that every layer grow an inner `app/` tree.

Nuxt 4 auto-detects the v3 layout and keeps it. If detection fails, the documented revert is:

```ts
srcDir: '.',
dir: { app: 'app' },
```

Mixing a v4 `app/`-based host with v3-flat layers is explicitly called out as unpredictable. Spec assumption: layout changes only where the new major requires them; cosmetic reshuffles are out of scope.

### F3 — Coupled modules today

| Package | Declared | Notes |
|---------|----------|--------|
| `@nuxtjs/i18n` | `^9` | Setup layer: `restructureDir: false`, `strategy: 'no_prefix'`, `legacy: false`. Feature slices re-declare the module with `langDir: 'locales'`. |
| `@pinia/nuxt` | `^0.9` | Pinia `^3` already a direct dependency. Stores auto-imported via `imports.dirs`, not `pinia.storesDirs`. |
| `shadcn-nuxt` | `^2.4.3` (lock ~2.5.3) | Theme layer; Tailwind v4 via `@tailwindcss/vite`. |
| `@nuxt/image` | `^1` | Registered on both roots; **zero `<NuxtImg>` usages**. |

i18n v10 **cannot disable** `restructureDir` (default `'i18n'`). `bundle.optimizeTranslationDirective` is removed (already `false` here). Vue I18n goes to v11; composition API already in use (`legacy: false`).

Several admin slices set `langDir: 'locales'` but only have `i18n/locales/` on disk. Many slices have **both** trees, sometimes with different JSON. Wired path today is `locales/`.

### F4 — Data fetching is Pinia + `useAsyncData`, not `useFetch`/`$fetch`

HTTP is OpenAPI → `@hey-api/client-axios`. UI calls `useAsyncData(() => store.fetch…())`. Nuxt 4 makes `useAsyncData` data a `shallowRef` (`deep: false` default), shares refs by key, and drops data when the last consumer unmounts. Because Pinia holds canonical state, shallow refs are low risk; still must not globally mix `deep` options on the same key.

### F5 — Typecheck is required by the ticket but does not exist yet

No `typecheck` script, no `vue-tsc`, no frontend typecheck in Makefile/turbo/CI. `tsconfig.json` extends `./.nuxt/tsconfig.json`. CLEAN-32's «tsc-проверка» means we must **introduce** `nuxt typecheck` (and keep it green), not assume a hidden command.

CI today: prisma generate → lint → test. Image builds are in `build-images.yaml`. Dockerfiles still run `bun run build` then `node .output/server/index.mjs`.

### F6 — Highest-risk surfaces

1. Layer `extends` + dozens of `#…` aliases and `#app` DI augmentations.
2. i18n v9 → v10 with `restructureDir: false` removed, plus locale-path drift.
3. `@pinia/nuxt` 0.9 → 0.11 (0.11 peers `@nuxt/kit` ^4 — bump **with** Nuxt 4, not before).
4. Introducing typecheck against generated `.nuxt` types and the OpenAPI SDK (SDK is generated in `predev`/`prebuild` from `api/swagger-spec.json`).

SPA (`ssr: false`) stays; Nuxt 4 supports it. Nitro output path used by Docker is expected to remain `.output/server/index.mjs`.

## Decisions

### D1 — Keep the v3-flat project layout; do not nest `app/app/`

- **Decision**: Both consoles keep today's layout (config, `public/`, `slices/` at the Nuxt project root). Enable Nuxt 4 directory *behavior* via compatibility, then rely on auto-detect. If auto-detect fails after `compatibilityVersion: 4`, set `srcDir: '.'` (and `dir.app` as in the upgrade guide). Do **not** move host files into a nested `app/` directory and do **not** give every slice an inner `app/` tree.
- **Rationale**: Workspace is already named `app/`; pages live in layers; mixing host/layer directory conventions is the documented failure mode; spec forbids cosmetic reshuffles. FR-006 is satisfied by accounting for the new defaults and applying the official revert when needed.
- **Alternatives considered**: (a) adopt Nuxt 4 `app/` in both hosts and all 39 layers — rejected: huge move, collides with the `app` workspace name, violates “slices must not be rewritten”; (b) host-only `app/` with flat slices — rejected: mixed conventions.

### D2 — Two-stage upgrade, modules bump with the package

- **Decision**:
  - **Stage A (compat)**: stay on Nuxt 3.21, set `future.compatibilityVersion: 4` on both roots, keep current module majors, fix locale-path drift, prove builds + smoke journeys. Do not bump `nuxt` until this checkpoint is green (SC-007).
  - **Stage B (major)**: bump `nuxt` to `^4` **together with** `@nuxtjs/i18n` `^10`, `@pinia/nuxt` `^0.11`, latest compatible `shadcn-nuxt` 2.x and `@nuxt/image` 1.x. Re-prove builds, typecheck, journeys.
- **Rationale**: Matches FR-002. `@pinia/nuxt@0.11` needs Nuxt 4 kit — cannot move it in Stage A. i18n v10 is the Nuxt 4 line.
- **Alternatives considered**: bump everything in Stage A — rejected: pinia 0.11 will not sit on Nuxt 3; one-shot major+modules — rejected by the ticket's two-step path.

### D3 — Keep `registerSlices()` / `extends`; do not switch to `layers/` auto-register

- **Decision**: Leave `registerSlices.ts` as the layer discovery mechanism (recursive `nuxt.config.ts`, `setup`+`common` first). Do not rename `slices/` → `layers/` or rely on alphabetical auto-register.
- **Rationale**: Order is load-bearing (theme/i18n/pinia/api before features). Nested slice groups would be mis-registered as layers if the parent dir were auto-scanned. FR-005: slices stay slices.
- **Alternatives considered**: Nuxt `layers/` directory — rejected: would reorder and flatten nested groups.

### D4 — i18n v10: drop `restructureDir: false`, standardize on `i18n/locales/` per layer

- **Decision**: On the v10 bump: remove `restructureDir: false` and `bundle.optimizeTranslationDirective`. Keep `strategy: 'no_prefix'`, `legacy: false`, `defaultLocale: 'en'`. Per layer, locale files live at `<slice>/i18n/locales/en.json` (v10 default). Where `locales/` and `i18n/locales/` diverge, **the currently wired `locales/` file wins**; copy it onto `i18n/locales/` and delete the duplicate. Fix admin slices that already only have `i18n/locales/` but declare `langDir: 'locales'`. Move the setup-layer Vue I18n config to the layer's `i18n/` tree (v10 default). App `detectBrowserLanguage` stays; admin stays without it.
- **Rationale**: v10 forbids disabling restructure; several slices already have `i18n/locales/`; composition API already matches Vue I18n v11.
- **Alternatives considered**: keep `langDir: 'locales'` at slice root via a custom `restructureDir` string — rejected: fights the default every layer will hit on the next major.

### D5 — Pinia: keep `imports.dirs`; bump `@pinia/nuxt` only in Stage B

- **Decision**: Leave Pinia `^3` as a direct dependency (required on Nuxt 4). Keep per-slice `imports.dirs: [stores]`. In Stage B bump `@pinia/nuxt` to `^0.11`. If store auto-import breaks because the module starts looking at `app/stores`, set `pinia.storesDirs` to the existing slice store paths rather than moving files.
- **Rationale**: Stores already resolve via layer `imports.dirs`; moving them would churn 30 files for no operator value.
- **Alternatives considered**: relocate every store to `app/stores` — rejected: D1 and FR-005.

### D6 — shadcn-nuxt + Tailwind v4: verify in place

- **Decision**: Keep the theme layer, `componentDir`, and Tailwind v4 Vite plugin. Bump `shadcn-nuxt` only if Stage B peers require it. No UI redesign.
- **Rationale**: Already on Tailwind v4 / shadcn 2.5; risk is peer alignment, not a kit rewrite.
- **Alternatives considered**: replace shadcn-nuxt — out of scope.

### D7 — `@nuxt/image`: keep, bump if peers require, do not adopt `<NuxtImg>`

- **Decision**: Leave the module registered. No new image components. Bump the 1.x line if Nuxt 4 peers demand it.
- **Rationale**: Unused in templates; removing it is unrelated cleanup.
- **Alternatives considered**: remove the unused module — rejected as extra scope.

### D8 — `useAsyncData`: do not force global `deep: true`

- **Decision**: Accept Nuxt 4 shallow-ref defaults. Canonical state stays in Pinia. During Stage A, grep for same-key `useAsyncData` calls with conflicting options and for code that mutates `data.value` nested fields. Fix those locally. Do not set `experimental.defaults.useAsyncData.deep: true` unless an audit finds widespread nested mutation of the asyncData ref (not the store).
- **Rationale**: Smallest change; SPA + Pinia already avoids most SSR/payload pitfalls. Global `deep: true` would paper over bugs and fight the new default.
- **Alternatives considered**: globally restore v3 deep refs — rejected unless the audit proves it is required.

### D9 — Introduce `nuxt typecheck` as the ticket's tsc gate

- **Decision**: Add `"typecheck": "nuxt typecheck"` to `app` and `admin`, add `vue-tsc` as a devDependency where Nuxt does not pull it, add a turbo `typecheck` task. Wire CI to typecheck both consoles after generating `api/swagger-spec.json` (same dependency as `prebuild` / Docker). `nuxt prepare` / typecheck must see the generated SDK.
- **Rationale**: FR-004 / SC-003. The repo has no typecheck today; “keep tsc green” otherwise means nothing.
- **Alternatives considered**: ad-hoc `tsc --noEmit` on `tsconfig.json` — rejected: needs `.nuxt` types and `vue-tsc` for SFCs; `nuxt typecheck` is the supported path.

### D10 — Docker and local env stay as they are

- **Decision**: Dockerfiles keep swagger-then-`bun run build` then `node .output/server/index.mjs`. `API_URL` / `NUXT_PUBLIC_API_URL` / `RANCH_VERSION` unchanged (FR-010/011). If Nitro's output filename changes in Nuxt 4, update both Dockerfiles in the same PR — do not change the runtime contract otherwise.
- **Rationale**: Spec forbids API/env redesign; images are the production proof.
- **Alternatives considered**: switch to static `nuxi generate` — rejected: current runtime is Nitro SPA host.

### D11 — Both consoles in one change; API untouched

- **Decision**: `app` and `admin` ship together (spec assumption). No API/OpenAPI contract changes (FR-012). SDK regeneration stays the existing `prebuild` / `openapi-ts` path.
- **Rationale**: Shared modules and lockfile; one-console-first would leave the workspace on mixed Nuxt majors.
- **Alternatives considered**: admin first as the larger surface — rejected by spec unless Stage A proves they cannot move together (then stop and re-plan).

## Cross-cutting notes

- **`#` aliases and `#app` DI**: keep; they are the slice public surface. Validate after each stage that `#theme`, `#api`, `#common`, and feature aliases still resolve.
- **`compatibilityDate`**: bump to a current Nuxt 4 date in Stage B (not Stage A) so Stage A diffs stay small.
- **Out of scope**: API, CLI, extension, k8s/terraform except console image builds; visual redesign; introducing a root `shared/` for existing slice utils; renaming `slices/` to `layers/`.
- **Release**: prod images still only on `v*` tag runs (`build-images.yaml`).
