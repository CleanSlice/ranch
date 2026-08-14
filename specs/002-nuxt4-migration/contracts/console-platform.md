# Contract: Console platform (app + admin)

**Date**: 2026-08-14 · Applies to `app/` and `admin/` Nuxt hosts. API HTTP contracts are **unchanged** (FR-012).

## 1. Platform version

After Stage B both `package.json` files MUST declare `nuxt` with major **4** (SC-006). Neither host may remain on `nuxt@3`.

Stage A MAY keep `nuxt@3.21.x` but MUST set:

```ts
future: { compatibilityVersion: 4 }
```

on both root `nuxt.config.ts` files. Stage B MUST NOT start until Stage A builds and smoke journeys pass (SC-007).

## 2. Runtime mode

```ts
ssr: false
```

Both consoles remain client-rendered SPAs. Local ports stay **3000** (`app`) and **3001** (`admin`).

## 3. Layer composition

Root config MUST keep:

```ts
extends: [...registerSlices()]
```

`registerSlices()` semantics: see [slice-layers.md](./slice-layers.md). Flattening slices into a single host tree is a contract break (FR-005, SC-001).

## 4. Coupled modules

After Stage B:

| Package | Major |
|---------|-------|
| `@nuxtjs/i18n` | 10 |
| `@pinia/nuxt` | 0.11.x (Nuxt 4 line) |
| `pinia` | 3 (direct dependency) |
| `shadcn-nuxt` | 2.x compatible with Nuxt 4 |
| `@nuxt/image` | 1.x compatible with Nuxt 4 |

i18n product contract: `strategy: 'no_prefix'`, `defaultLocale: 'en'`, composition API (`legacy: false`). Existing paths (no locale prefix) remain valid (FR-009). Language switching still works for every shipped locale (today: `en`) (SC-005).

## 5. Environment

| Variable | Who sets it | Meaning |
|----------|-------------|---------|
| `API_URL` | local `ranch dev` / `.env` | fallback for `runtimeConfig.public.apiUrl` |
| `NUXT_PUBLIC_API_URL` | k8s | Nuxt runtimeConfig override |
| `RANCH_VERSION` | Docker `--build-arg` / local fallback to root `package.json` | version shown in UI |

No new required variables. Axios `baseURL` still comes from this config (existing plugins).

## 6. Build

From a clean install:

```bash
# after api swagger exists (Docker already does this; local prebuild runs openapi-ts)
cd app && bun run build     # exit 0
cd admin && bun run build   # exit 0
```

Both MUST emit Nitro output under `<host>/.output/`. Image runtime MUST keep:

```text
node .output/server/index.mjs
```

with `NITRO_PORT=3000` (app) and `NITRO_PORT=3001` (admin), unless Nuxt 4 changes the filename — in which case **both** Dockerfiles update in the same PR and this contract is amended to the new path.

## 7. Typecheck

After Stage B both hosts MUST provide:

```json
"typecheck": "nuxt typecheck"
```

```bash
cd app && bun run typecheck     # exit 0
cd admin && bun run typecheck   # exit 0
```

CI MUST run both after `api/swagger-spec.json` is generated (same input as `prebuild`). Failure is a merge blocker (FR-004, SC-003).

## 8. Operator-facing routes

Existing page files under slice `pages/` keep their URL paths. Auth layouts via `definePageMeta` remain. No intentional route renames in this feature.
