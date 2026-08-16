# Contract: Slice layers

**Date**: 2026-08-14 · Applies to every Nuxt layer under `app/slices/` and `admin/slices/`.

## 1. Discovery

`registerSlices.ts` (identical in both hosts) remains the discovery implementation.

- Scan `./slices/*` directories.
- Recurse until a `nuxt.config.ts` is found; that directory is a layer.
- Collect `./slices/setup` then `./slices/common` first, then the rest.
- Return paths for root `extends`.

A parent without `nuxt.config.ts` is a **group**, not a layer (`setup`, `agent`, `user` in admin).

**Inventory that must still load after the upgrade (SC-001):**

**app (11):** `setup/api`, `setup/error`, `setup/i18n`, `setup/pinia`, `setup/theme`, `common`, `agent`, `bridle`, `chat`, `template`, `user/auth`

**admin (28):** `setup/api`, `setup/error`, `setup/i18n`, `setup/init`, `setup/pinia`, `setup/theme`, `common`, `agent/agent`, `agent/agentChannel`, `agent/file`, `agent/secret`, `agent/template`, `agent/templateFile`, `agent/templateInstall`, `bridle`, `chat`, `llm`, `mcpServer`, `paddock`, `rancher`, `reins`, `sessions`, `setting`, `skill`, `usage`, `user/apiKey`, `user/auth`, `user/user`

Zero of these may be dropped, inlined into the host, or required to move under a host-level `app/` tree.

## 2. Layer filesystem (v3-flat, kept)

A layer MAY contain, at its own root (not nested under `app/`):

```text
nuxt.config.ts
pages/
components/
stores/
plugins/
middleware/
layouts/
composables/
domain/
data/
i18n/locales/en.json    # after i18n v10 (D4)
index.d.ts              # optional #app augmentation
```

Host files that stay at the **host** root: `nuxt.config.ts`, `registerSlices.ts`, `public/`, `app.vue` (app only), `Dockerfile`.

## 3. Aliases

Per-slice `alias: { '#name': currentDir }` MUST keep resolving (`#theme`, `#api`, `#common`, `#agent`, `#auth`, and admin feature aliases). `#app` module augmentation in `index.d.ts` MUST still type `$…Service` injections.

Breaking an alias is a contract break even if the build passes via relative imports.

## 4. Stores

Pinia setup-stores in `<slice>/stores/` remain auto-imported via that slice's `imports.dirs` (and the setup/pinia `imports.dirs`). Do not require relocation to `app/stores`. If `@pinia/nuxt` 0.11 stops seeing them, `pinia.storesDirs` MUST be pointed at the existing paths — files do not move.

## 5. i18n per layer

Today: many slices set `modules: ['@nuxtjs/i18n']` + `i18n: { langDir: 'locales', locales: [{ code: 'en', file: 'en.json' }] }`.

After v10:

- Locale file: `<slice>/i18n/locales/en.json`
- `restructureDir` is **not** `false` (option removed)
- `bundle.optimizeTranslationDirective` is **not** set (option removed)
- Merge rule when both `locales/` and `i18n/locales/` exist: wired `locales/` content wins, then the extra copy is deleted
- Setup layer: Vue I18n config lives under that layer's `i18n/` directory; `strategy: 'no_prefix'` stays global

## 6. Host must not steal slice pages

The upgrade MUST NOT add a host-level `pages/` (or Nuxt 4 `app/pages/`) that shadows slice routes. Slice `pages/` remain the only route source.
