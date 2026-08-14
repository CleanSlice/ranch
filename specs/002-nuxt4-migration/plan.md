# Implementation Plan: Upgrade operator consoles off Nuxt 3 EOL

**Branch**: `feat/CLEAN-32-nuxt4-migration` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-nuxt4-migration/spec.md`

## Summary

Both Ranch consoles (`app/` and `admin/`) run Nuxt 3.21.2, which is end-of-life. CLEAN-32 moves them to Nuxt 4 without flattening the slice architecture.

Approach (see [research.md](./research.md)):

1. **Stage A** — stay on Nuxt 3.21, set `future.compatibilityVersion: 4`, keep current module majors, fix i18n locale-path drift, prove production builds and primary journeys (SC-007).
2. **Stage B** — bump `nuxt` to `^4` together with `@nuxtjs/i18n` `^10`, `@pinia/nuxt` `^0.11`, and the current 2.x/1.x lines of `shadcn-nuxt` / `@nuxt/image`. Standardize per-slice locales onto `i18n/locales/`. Introduce `nuxt typecheck` and run it in CI. Re-prove builds, typecheck, Docker images, and journeys.

Keep today's flat layout (`srcDir` remains the project root / auto-detected v3 tree). Do not nest `app/app/` and do not rewrite slices into Nuxt 4 `app/` trees (D1, D3). API is untouched (FR-012).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.2 workspaces (turbo monorepo); Node 22 in console images

**Primary Dependencies**: `nuxt` 3.21.2 → `^4`; Vue `^3.5`; `@nuxtjs/i18n` `^9` → `^10`; `@pinia/nuxt` `^0.9` → `^0.11` + `pinia` `^3`; `shadcn-nuxt` `^2.4`; `@nuxt/image` `^1`; Tailwind 4 (`@tailwindcss/vite`); `@hey-api/client-axios` + `openapi-ts` (unchanged)

**Storage**: N/A (no schema/migration). Locale JSON on disk; Pinia in-memory; auth cookie `access_token`

**Testing**: No frontend unit runner today. Gates: `bun run build` in `app` and `admin`; new `nuxt typecheck` in both; Docker image builds; manual smoke journeys in [quickstart.md](./quickstart.md)

**Target Platform**: SPA consoles (`ssr: false`) served by Nitro (`.output/server/index.mjs`) in Docker; local `bun run dev` on ports 3000 (`app`) and 3001 (`admin`)

**Project Type**: Web application (two Nuxt SPAs + NestJS API) in a monorepo. This feature touches only the two SPAs and their CI/image recipes.

**Performance Goals**: Existing screens keep loading; no new performance target. Language switch remains interactive.

**Constraints**: Slice `extends` architecture must survive (FR-005); both consoles ship together; no API contract changes; `strategy: 'no_prefix'` routes stay valid; `API_URL` / `NUXT_PUBLIC_API_URL` / `RANCH_VERSION` env contract unchanged; Stage B must not start until Stage A is green (FR-002)

**Scale/Scope**: 2 Nuxt hosts, 11 + 28 layers, ~70 page files, ~31 Pinia stores, theme UI kit (admin-heavy), two Dockerfiles, CI + `build-images.yaml`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific principles or gates are ratified. No violations possible; gate **PASS** (pre-Phase-0 and re-checked post-Phase-1). Engineering defaults: smallest change that satisfies the spec, both consoles together, slices not rewritten, API untouched.

## Project Structure

### Documentation (this feature)

```text
specs/002-nuxt4-migration/
├── plan.md              # This file
├── research.md          # Phase 0 — facts F1–F6, decisions D1–D11
├── data-model.md        # Phase 1 — platform/module state, slice inventory
├── quickstart.md        # Phase 1 — Stage A/B validation
├── contracts/
│   ├── console-platform.md  # versions, config, build, typecheck, Docker, env
│   └── slice-layers.md      # registerSlices, layer layout, i18n files, aliases
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
app/                                 # user console (Nuxt host)
├── nuxt.config.ts                   # + future.compatibilityVersion: 4; later nuxt ^4
├── package.json                     # nuxt ^4, i18n ^10, pinia-nuxt ^0.11, typecheck script
├── tsconfig.json                    # still extends .nuxt/tsconfig.json
├── registerSlices.ts                # unchanged discovery
├── app.vue                          # stays at host root (D1)
├── Dockerfile                       # still swagger → build → .output/server/index.mjs
└── slices/
    ├── setup/i18n/                  # drop restructureDir: false; vueI18n under i18n/
    ├── setup/pinia/                 # @pinia/nuxt bump in Stage B
    ├── setup/theme/                 # shadcn-nuxt verify/bump
    └── <feature>/i18n/locales/      # standardized locale path (D4)

admin/                               # admin console (same pattern, 28 layers, no root app.vue)
├── nuxt.config.ts
├── package.json
├── registerSlices.ts
├── Dockerfile
└── slices/                          # including nested agent/* and user/*

package.json                         # workspaces unchanged
turbo.json                           # + typecheck task
.github/workflows/ci.yaml            # + swagger generate + app/admin typecheck
.github/workflows/build-images.yaml  # unchanged flow; must still produce both images
```

**Structure Decision**: Existing monorepo layout is kept. All code changes land in the `app` and `admin` workspaces plus turbo/CI wiring. Slices are not moved, renamed, or flattened. API/CLI/extension/k8s/terraform are out of scope except that console Dockerfiles must still build.

## Complexity Tracking

No constitution violations — table not required.

## Implementation sketch (not tasks.md)

Stage A then Stage B, both consoles in lockstep. Detailed tasks belong in `/speckit-tasks`.

1. **Stage A — compatibility checkpoint**
   - Set `future.compatibilityVersion: 4` on `app/nuxt.config.ts` and `admin/nuxt.config.ts`.
   - If layer/`app.vue` resolution breaks, apply D1 revert (`srcDir: '.'`).
   - Align duplicate locale trees onto the wired `locales/` content (prep for D4); fix admin slices whose `langDir` does not match disk.
   - `bun run build` in both hosts; smoke S1–S3 in [quickstart.md](./quickstart.md). Record the checkpoint (SC-007).
2. **Stage B — package bump**
   - `bun add nuxt@^4` in both hosts; bump coupled modules (D2, D5–D7).
   - Apply D4 i18n v10 file layout; remove removed options.
   - Add `typecheck` scripts + turbo + CI (D9).
   - Rebuild Docker images; confirm `.output/server/index.mjs` (D10).
   - Repeat smoke S1–S5; `nuxt typecheck` green (SC-002/003/006).
