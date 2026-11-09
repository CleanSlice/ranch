# Implementation Plan: App console redesign

**Branch**: `feat/CLEAN-215-app-console-redesign` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) | **Ticket**: [CLEAN-215](https://dreamvention.atlassian.net/browse/CLEAN-215)

**Input**: Feature specification from `specs/026-app-console-redesign/spec.md`

## Summary

Bring the `app` console's redesign to production: a landing with a cinematic hero and a product Stage demo, a "Session" gate for `/login` and `/register`, and an agent console with Orbit / Drum / List views and a cockpit Sheet above the chat — then add a light layer of pointer- and scroll-reactive effects on the landing.

Technical approach: the reference implementation (30 modified + 29 new files, uncommitted in the `skills-redesign` worktree) is moved onto this branch as four reviewable zone commits (brand, landing, gate, console), with the repo's rules applied on the way (format module instead of `Intl`, English-first i18n, pure utilities under `bun test`). Seven Inspira UI components are copied into the theme slice as plain Vue + CSS with **zero new runtime dependencies**: the library's only shared import is a `cn` helper the theme already has, and the two components that pull `motion-v` are replaced by a CSS transition and a six-line tween. Every effect reads its colour, speed and duration from `--land-fx-*` tokens in `landing.css`, is paused off-screen and in hidden tabs by one shared composable, and is static under reduced motion. Lighthouse and gzip size are measured at three points: `main`, after the zone commits, after the effects.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3.5, Nuxt 4 (`ssr: false`, `compatibilityVersion: 4`), Pinia 3, `@nuxtjs/i18n` 10, Tailwind 4.2 via `@tailwindcss/vite`, `shadcn-nuxt` 2.4 (components under `app/slices/setup/theme/components/ui`), `tw-animate-css` 1.4, `lucide-vue-next` icons, Bun 1.x as runtime and test runner.

**Primary Dependencies**: existing only. `clsx` + `tailwind-merge` (the theme's `cn`), `@nuxt/image`, `socket.io-client` (chat), generated `@hey-api` SDK (`AgentsService.agentControllerStop/Start` already exist). **No package is added**: `@inspira-ui/plugins` is a `cn` re-export, `motion-v` is avoided (research R2), `@vueuse/core` is only needed by the canvas `sparkles` component, which is not used. The hero video (AV1 `.webm` 400 KB, H.264 `.mp4` 1.4 MB) and the brand/hero `.webp` assets ship as static files under `app/public/landing/`.

**Storage**: none server-side. Browser `localStorage` for `agent:view` and `agent:sheetOpen`; cookie `ranch-brand` for the brand override. No API or database change: stop/start endpoints exist (`POST /agents/:id/stop|start`).

**Testing**: `cd app && bun test slices` for pure utilities (`orbitLayout`, `agentStatus`, `relativeTime`, plus the existing `railOrder` and `format`); no component test runner in the repo. Browser checks are playwright-core scripts under `specs/026-app-console-redesign/e2e/` in the CLEAN-102 style (`PLAYWRIGHT_DIR=/c/Users/maxim/pw`, installed Chrome), run by hand: screenshots at six widths, reduced-motion and touch emulation, keyboard walk of Orbit/Drum, stop/start rollback with a blocked request. Gates: `npx nuxt typecheck` (app), `bun run build` (app), `bun run i18n:check`, `bun run locale:check`.

**Target Platform**: the customer console in evergreen desktop and mobile browsers. Acceptance widths 1920 / 1440 / 1024 / 768 / 390 / 360. Tailwind defaults (`md` 768, `lg` 1024, `xl` 1280) match every breakpoint the brief names, so no theme change.

**Project Type**: web application — `app/` only (Nuxt slices `common`, `user/auth`, `agent`, `bridle`, `share`, `setup/theme`). `api/` and `admin/` untouched.

**Performance Goals**: Lighthouse Performance on `/` not below the `main` baseline on the same machine and profile; LCP element stays the hero `<img>`; CLS 0; INP < 200 ms; effects JS ≤ ~30 KB gzip on top (expected ≈ 6–9 KB); video never requested under 768 px, with reduced motion, save-data or 2g/3g.

**Constraints**: animations touch only `transform` and `opacity` (`filter`/`box-shadow` on hover); one looping effect in view at a time; no WebGL/three/GSAP; no `Intl.*`/`toLocale*` outside `#common/utils/format` (locale check); `en.json` source, `ru` via `bun run i18n:sync`; Session-ended dialog pixel-identical to `main`; no horizontal scroll at any width; the reference's 30 s / 3 s polling unchanged.

**Scale/Scope**: one landing page (7 sections), two auth pages on one layout, one console page with three views and a sheet; ~3 500 lines of reference code to review and land; seven copied effect components (~450 lines total) plus one composable and one CSS block; ~140 new i18n keys already present in the reference.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| I. The slice is the unit | PASS | Landing (`common`), gate (`user/auth`), console (`agent`, with class-level touches in `bridle` and `share`), effects (`setup/theme/components/ui/*` as shared UI primitives, like `badge`). The only sideways reads are already-public surfaces: `#agent/stores/agent` from the landing hero (existing on `main`), `#auth/composables/useGateStage` from the shared form (same slice). Effect tokens and the pause composable live in `common` because the landing is `common`'s page; nothing goes to `common` by convenience. |
| II. Twin consoles (NON-NEGOTIABLE) | PASS with statement | `agent`, `bridle`, `common`, `setup`, `share`, `user` all exist in `admin`. This feature redesigns the **customer** console's brand surface; `admin` is the operator tool and keeps its own theme, auth layout and agent workspace (`admin/slices/agent/agent/components/agent/workspace/{Canvas,Main}.vue` are a different component). Grep results for every touched twin symbol are recorded in research R13; the PR states "admin checked: no shared behaviour changed, only app styling; admin left unchanged on purpose". The one behavioural addition — `stop`/`start` on the app agent store — mirrors functions admin's store already has (`docs/state.md`). |
| III. Secrets stay behind `api/` | PASS | No credential. `runtimeConfig.public.brandVariant` is a logo name, public by design. Google Fonts URL carries no key. |
| IV. One entity, one store | PASS | Orbit node, Drum card, Rail row, Sheet and chat overlay all render `agentStore.byId(id)` / `storeToRefs(agents)`; `useAsyncData` keeps `pending`/`refresh` only; `stop`/`start`/`restart` go through `patch()` with rollback in the store (the reference already does this; research R8 keeps it). View and sheet preferences are UI state in components with `localStorage`, not entities. |
| V. Console is a window, chat is the hands | N/A, stated | Applies to **admin**-console capabilities and the Ranch agent. This feature adds no admin capability; app stop/start call endpoints the API already exposes and the agent already has tools for. Nothing to add. |
| VI. English is the source | PASS | All ~140 new keys exist in the reference `en.json` files with `ru.json` and the `i18n.sync.json` manifest updated; `bun run i18n:check` is a gate. New strings added in this plan (marquee caption, sheet date label if any) are added to `en.json` and synced, never hand-written (research R17 covers the API key). `admin` stays English-only. |
| VII. A rule stays a rule | PASS | No model call anywhere. Orbit placement, ring capacities, drum geometry, status colours and the reveal/pause rules are pure code with tests. |
| Generated code is generated | PASS | `app/slices/setup/api` already carries `agentControllerStop/Start`; `bun run build:api` regenerates if the worktree is stale, and generated files are never hand-edited. |
| Tracker / surface | PASS | CLEAN-215, `[APP]`, label `app`. |
| Quality gates | PLANNED | Commands in [quickstart.md](./quickstart.md); twin check in the PR; every magic number carries its reason (research R-numbers, contracts). |

**Post-design re-check (after Phase 1)**: no new violation. Two decisions worth naming: (a) effect components under `setup/theme/components/ui` rather than inside `common` — they are presentation primitives with no landing knowledge, exactly what that folder holds (`badge`), and the landing colours reach them through props bound to `--land-fx-*` tokens; (b) `useBrandFonts` loads Geist from Google Fonts in both the landing and the console — an external request, measured in R10 with a guard rail to self-host if it costs LCP.

## Project Structure

### Documentation (this feature)

```text
specs/026-app-console-redesign/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R17
├── data-model.md        # Phase 1: client-side entities and state
├── quickstart.md        # Phase 1: run, gates, measurements, walkthrough
├── contracts/
│   ├── landing-ui.md    # sections, anchors, tokens, reveal, video rules
│   ├── gate-ui.md       # stages, routes, breakpoints, non-regression
│   ├── console-ui.md    # views, storage keys, keyboard, ARIA, sheet, polling
│   └── effects.md       # component API, token names, pause/motion/hover matrix, budget
├── e2e/                 # implementation phase: playwright-core scripts (shots, horizon, console, measure)
├── measurements/        # implementation phase: P0 / P1 / P2 lighthouse + gzip JSON
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

`.specify/feature.json` is restored to `main`'s value before the first commit (it is tracked and every parallel feature rewrites it); downstream SpecKit commands are given `specs/026-app-console-redesign` explicitly.

### Source Code (repository root)

```text
app/
├── nuxt.config.ts                               # runtimeConfig.public.brandVariant
├── i18n.sync.json                               # manifest (regenerated by i18n:sync)
├── public/landing/
│   ├── brand/orbit-mark.webp, orbit-wordmark.webp
│   ├── hero-desktop-1600.webp, hero-desktop-2560.webp, hero-mobile-720.webp, hero-mobile-1080.webp
│   ├── scene-calm-1200.webp, scene-calm-1920.webp
│   └── hero-loop-1080.webm, hero-loop-1080.mp4
└── slices/
    ├── common/
    │   ├── nuxt.config.ts                       # css: landing.css
    │   ├── assets/css/landing.css               # .landing tokens, --land-fx-* tokens, keyframes, reveal, pause
    │   ├── composables/useBrandVariant.ts, useLandingChrome.ts, useReveal.ts, useFxPause.ts (new), useFxTokens.ts (new)
    │   ├── layouts/landing.vue
    │   ├── pages/index.vue
    │   ├── components/landing/
    │   │   ├── brand/Logo.vue
    │   │   ├── header/Provider.vue
    │   │   ├── hero/Provider.vue, Atmosphere.vue, Constellation.vue, Stage.vue
    │   │   ├── steps/Provider.vue               # + AnimatedBeam
    │   │   ├── capabilities/Provider.vue        # + GlowingEffect, CardSpotlight
    │   │   ├── runtime/Provider.vue             # + AnimatedBeam (replaces dotted line)
    │   │   ├── stack/Provider.vue (new)         # technology Marquee before the CTA
    │   │   ├── cta/Provider.vue                 # + Meteors
    │   │   └── footer/Provider.vue
    │   ├── components/layout/Provider.vue       # console header: logo, pill nav, dark theme, fonts
    │   └── i18n/locales/en.json, ru.json
    ├── setup/theme/
    │   ├── assets/themes/default.css            # .dark plum/copper palette, Geist fonts
    │   └── components/ui/
    │       ├── glowing-effect/GlowingEffect.vue, index.ts
    │       ├── card-spotlight/CardSpotlight.vue, index.ts
    │       ├── animated-beam/AnimatedBeam.vue, index.ts
    │       ├── border-beam/BorderBeam.vue, index.ts
    │       ├── shimmer-button/ShimmerButton.vue, index.ts
    │       ├── marquee/Marquee.vue, index.ts
    │       └── meteors/Meteors.vue, index.ts
    ├── user/auth/
    │   ├── layouts/auth.vue                     # the gate
    │   ├── composables/useGateStage.ts
    │   ├── components/auth/gate/Route.vue
    │   ├── components/auth/common/Form.vue      # variant="gate"; console variant unchanged
    │   ├── components/auth/login/Provider.vue, register/Provider.vue
    │   └── i18n/locales/en.json, ru.json
    ├── agent/
    │   ├── components/agent/workspace/Provider.vue, Orbit.vue, Drum.vue, Sheet.vue, Rail.vue, RailItem.vue
    │   ├── components/agent/chat/Provider.vue   # compact prop
    │   ├── composables/useAgentControls.ts
    │   ├── utils/orbitLayout.ts (+ .test.ts), agentStatus.ts (+ .test.ts new), relativeTime.ts (+ .test.ts new)
    │   ├── domain/agent.gateway.ts, agent.service.ts
    │   ├── data/agent.gateway.ts
    │   ├── stores/agent.ts                      # stop(), start()
    │   └── i18n/locales/en.json, ru.json
    ├── bridle/components/bridle/chat/Provider.vue, Input.vue, Empty.vue, NewChat.vue   # class-level restyle
    └── share/components/share/panel/Provider.vue                                     # class-level restyle

specs/026-app-console-redesign/e2e/
├── lib.mjs          # copied from specs/015-chat-message-reliability/e2e/lib.mjs, trimmed
├── shots.mjs        # 6 widths × {landing, login, register, agents}; --reduced; --touch; --only session-ended
├── horizon.mjs      # FR-010: variant A and B at 1440×900
├── console.mjs      # keyboard walk Orbit/Drum, Cmd+K, stop/start rollback
└── measure.mjs      # lighthouse runner + gzip sum of the landing's JS chunks
```

**Structure Decision**: a single Nuxt project (`app/`) organised by slice. Every file above already exists in the reference except `useFxPause.ts`, `useFxTokens.ts`, `landing/stack/Provider.vue`, the seven `ui/*` effect folders, two new test files and the `e2e/` scripts. The effect components sit beside `ui/badge` because `shadcn-nuxt` registers every folder under `componentDir` with no prefix (`<Badge>` today, `<GlowingEffect>` tomorrow) and the theme's own `components:` entry ignores `**/ui/**` so nothing is registered twice (research R3).

## Phase 0 — Research

See [research.md](./research.md). Resolved: landing the reference as zone commits (R1); Inspira without new dependencies (R2); where the components live and how they auto-import (R3); Tailwind v4 keyframes and token plumbing (R4); pausing loops off-screen and in hidden tabs, reduced motion and `hover: none` (R5); Lighthouse method and baseline order (R6); bundle budget method (R7); the locale rule in the Sheet (R8); brand variants kept as in the reference (R9); Google Fonts guard rail (R10); FR-010 horizon variants (R11); polling unchanged (R12); twin-console grep record (R13); stop/start endpoints verified (R14); browser-check tooling (R15); Tailwind v4 syntax of the copied code (R16); the i18n sync key (R17).

## Phase 1 — Design

- [data-model.md](./data-model.md): the agent record as the console reads it, orbit node, drum position, view/sheet preferences, brand variant, gate stage, demo step, effect tokens and pause state.
- [contracts/](./contracts/): UI contracts a tester or a second implementer can hold the code to.
- [quickstart.md](./quickstart.md): how to run, measure and walk every spec scenario.

## Implementation order (for `/speckit-tasks`)

1. **Baseline** on the current commit (= `main`): Lighthouse desktop + mobile on `/`, gzip of the landing chunks, Session-ended dialog screenshot at 1440 and 390. Nothing else first — the baseline cannot be taken after the landing changes.
2. **Zone commits** from the reference, each building and typechecking on its own: brand → landing → gate → console. Fixes applied on the way (R8 format module, drop `orbit-icon.webp` and the empty tgz, Russian tone pass).
3. **FR-010 horizon**: two variants as screenshots on the ticket; wait for the pick; apply it in the landing zone.
4. **Effect primitives**: seven `ui/*` components + `useFxPause` + `useFxTokens` + `--land-fx-*` tokens + reduced-motion / hover rules; typecheck and build; P1 measurement before this commit.
5. **Effects by section**, one commit each with 1440 + 390 screenshots on the ticket and the owner's OK before the next: hero Stage border beam → Capabilities glow + spotlight → Steps beam → Runtime beam → headings blur reveal → CTA button shimmer → technology marquee → CTA meteors.
6. **Measurements** after the effects (P2); **final gates**; PR with the twin-console statement and the before/after numbers.

## Complexity Tracking

No constitution violation to justify. Two points a reviewer might raise, answered here:

| Decision | Why | Simpler alternative rejected because |
|---|---|---|
| Copy seven Inspira components instead of adding `motion-v` + `@inspira-ui/plugins` | Zero new dependencies, every line in the repo, colours from tokens; the library itself is distributed by copying | Installing the packages adds ~35 KB gzip (motion-v) for two uses that a CSS transition and a tween cover (R2) |
| Four zone commits + one commit per effect section | Reviewable history and screenshot checkpoints the brief asks for | One squash commit would hide 3 500 lines of reference behind one message and make the effects' performance cost untraceable |
