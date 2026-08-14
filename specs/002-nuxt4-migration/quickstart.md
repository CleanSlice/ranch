# Quickstart Validation: Upgrade operator consoles off Nuxt 3 EOL

**Date**: 2026-08-14 · **Contracts**: [console-platform.md](./contracts/console-platform.md), [slice-layers.md](./contracts/slice-layers.md) · **Success criteria**: [spec.md](./spec.md) §Success Criteria

## Prerequisites

- `bun install` at repo root.
- API can produce swagger (`cd api && bun run generate:swagger` or a full `bun run build` there) so `app`/`admin` `prebuild` / `openapi-ts` can run.
- Local consoles: `cd app && bun run dev` (port 3000), `cd admin && bun run dev` (port 3001), API already up (`ranch dev` or `cd api && bun run dev`).
- Stage B typecheck needs the same swagger file CI will generate.

## S1 — Stage A compatibility checkpoint (P2; FR-002, SC-007)

1. On Nuxt **3.21**, both roots have `future.compatibilityVersion: 4`. `nuxt` major is still 3.
2. Build:
   ```bash
   cd app && bun run build
   cd admin && bun run build
   ```
3. **Expected**: both exit 0. Slice count in the Nuxt build log / `.nuxt` layer list still matches 11 (app) and 28 (admin) — none missing.
4. Smoke locally: sign-in, main nav, one agent workflow, settings on **both** consoles. Language remains `en` and UI strings load (SC-005).
5. Record this checkpoint in the PR/ticket before any `nuxt@^4` bump. If this fails, **stop** — do not start Stage B.

## S2 — Slice graph intact (P1; FR-005, SC-001)

1. After each stage, compare `registerSlices()` output (or the resolved `extends` list in `.nuxt`) to the inventory in [slice-layers.md](./contracts/slice-layers.md).
2. Open a screen that today lives in a nested admin slice (e.g. agent detail, a `user/*` page) and a screen from `app/slices/user/auth`.
3. **Expected**: 11/11 and 28/28 layers present; those screens still originate from the same slice directories (not a new host `pages/` tree). `#theme` / `#api` / `#common` imports still typecheck and run.

## S3 — Production builds (P1; FR-003, SC-002)

```bash
cd app && bun run build
cd admin && bun run build
```

**Expected**: both green on a clean checkout after `bun install` and swagger generate. Repeat after Stage B.

## S4 — Typecheck (P1; FR-004, SC-003) — Stage B

```bash
cd app && bun run typecheck
cd admin && bun run typecheck
```

**Expected**: exit 0. CI on the PR runs the same two commands after generating `api/swagger-spec.json`.

## S5 — Coupled modules + i18n (P2; FR-007/008, SC-005)

1. `app/package.json` and `admin/package.json` show `nuxt` major 4, `@nuxtjs/i18n` major 10, `@pinia/nuxt` 0.11.x, `pinia` still a direct dependency.
2. Per-slice locale files exist at `i18n/locales/en.json`; no remaining `restructureDir: false` or `optimizeTranslationDirective`.
3. In the running UI, strings from several slices still resolve (auth, common chrome, one feature slice). Pinia-backed screens still load lists/detail. shadcn controls (admin: button/dialog/table; app: existing chrome) still render.
4. **Expected**: no missing-module build errors; no blank i18n keys that used to resolve; stores still auto-imported.

## S6 — Local env and Docker (P1; FR-010/011)

1. `ranch dev` / existing `.env` still points both consoles at the API (`API_URL` fallback). Login works without new env vars.
2. Build images the same way CI does (`app/Dockerfile`, `admin/Dockerfile`).
3. **Expected**: images start `node .output/server/index.mjs` (or the amended path if Nuxt 4 renamed it, updated in **both** Dockerfiles). Health: consoles serve the SPA.

## S7 — Routes survive (FR-009)

1. Bookmark a deep link used today (localized prefix is none — `no_prefix`).
2. **Expected**: the same URL opens the same screen after Stage B (login wall still applies).
