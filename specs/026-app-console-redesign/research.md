# Research: App console redesign (CLEAN-215)

Every unknown from the Technical Context, resolved. Each entry: decision, why, what else was weighed.

## R1 — Landing the reference as zone commits

**Decision**: the reference changes stay in the `skills-redesign` worktree until they are moved here with `git -C <ref> diff > ref.patch && git apply --3way ref.patch` for the 30 tracked files and a plain copy for the 29 untracked ones (list in the brief §7), skipping `Claude outputs/`, `.ranch-app-stage.tgz`, `app/public/landing/brand/orbit-icon.webp` and `.specify/feature.json`. The result is split into four commits by path:

| Commit | Paths |
|---|---|
| `feat(common): orbit brand, plum console theme and Geist fonts (CLEAN-215)` | `nuxt.config.ts` (brandVariant), `public/landing/brand/*`, `common/components/landing/brand/Logo.vue`, `common/composables/useBrandVariant.ts`, `useLandingChrome.ts`, `common/components/layout/Provider.vue`, `setup/theme/assets/themes/default.css` |
| `feat(common): landing with cinematic hero and product stage (CLEAN-215)` | `common/nuxt.config.ts`, `assets/css/landing.css`, `composables/useReveal.ts`, `layouts/landing.vue`, `pages/index.vue`, `components/landing/{header,hero,steps,capabilities,runtime,cta,footer}`, `public/landing/{hero-*,scene-*}`, `common/i18n/*` |
| `feat(auth): session gate for login and register (CLEAN-215)` | `user/auth/layouts/auth.vue`, `components/auth/{gate,common,login,register}`, `composables/useGateStage.ts`, `user/auth/i18n/*` |
| `feat(agent): orbit, drum and cockpit sheet in the agent console (CLEAN-215)` | `agent/**`, `bridle/components/bridle/chat/*`, `share/components/share/panel/Provider.vue` |

The brand commit must come first: the console header and the gate both import `LandingBrandLogo` and `useBrandFonts`. Commit order in `tasks.md` is brand → landing → console → gate (story priority), and `i18n.sync.json` goes with whichever zone commits last (the gate, T041) because the manifest is one file; `bun run i18n:check` runs after each commit and is allowed to fail only between zones, never at a zone boundary.

**Rationale**: the brief asks for separate commits per zone so review is readable; `git apply --3way` on a branch at the same `main` commit the reference was rebased on applies cleanly and leaves the reference worktree intact for comparison.

**Alternatives**: cherry-picking (nothing is committed there); working directly in the reference worktree (it is on the unrelated CLEAN-205 branch and must not carry this work).

## R2 — Inspira UI without new dependencies

**Decision**: copy seven components from `unovue/inspira-ui@main` (`app/components/inspira/ui/<slug>/`, Tailwind v4 branch, fetched 2026-11-09) and adapt:

| Component | Upstream imports | Here |
|---|---|---|
| `GlowingEffect` (179 lines) | `cn` from `@inspira-ui/plugins`, `animate` from `motion-v` | `cn` from `#theme/utils`; `animate(current, target, {duration, ease})` → a ~10-line rAF tween with the same `[0.16,1,0.3,1]` curve (one function, `tweenAngle`) |
| `CardSpotlight` (74) | `cn` | `#theme/utils` |
| `AnimatedBeam` (207) | `cn` | `#theme/utils`; SMIL `<animate>` kept (pausable via `svg.pauseAnimations()`) |
| `BorderBeam` (61) | `cn` | `#theme/utils`; scoped keyframes kept |
| `ShimmerButton` (90) | `cn` | `#theme/utils`; scoped keyframes kept |
| `Marquee` (75) | `cn` | `#theme/utils`; needs `--animate-marquee` keyframes (R4) |
| `Meteors` (49) | `cn` | `#theme/utils`; scoped keyframes kept; `count` prop 6 |

Not copied: `blur-reveal` (uses `motion-v`'s `<Motion>`; the spec wants blur folded into the existing `useReveal`, so it becomes six lines of CSS on `[data-reveal].land-reveal--blur`), `tracing-beam` (`motion-v` + `vue-use-spring`; `AnimatedBeam` covers the Runtime pipeline), `sparkles` (canvas + `@vueuse/core`; the spec chose meteors).

`@inspira-ui/plugins` is a `clsx`+`tailwind-merge` `cn` — identical to `app/slices/setup/theme/utils/cn.ts`. `motion-v` would add ~35 KB gzip for two call sites. Result: **no `package.json` change**.

**Rationale**: the brief's budget is ~30 KB gzip for the whole layer; the seven files are ~15 KB of source before minification, ≈ 6–9 KB gzip expected. Everything is readable Vue + CSS that the repo owns.

**Alternatives**: `bun add motion-v @vueuse/core @inspira-ui/plugins` as the docs say (budget and three dependencies for one tween); Inspira's Nuxt registry/CLI (none exists; copying is the documented path).

**Amended 2026-11-09 after review**: `GlowingEffect` and `CardSpotlight` were landed, then replaced and deleted. The owner wanted the light to be one source shared by all cards (the pattern on nuxt.com's feature grid), not a highlight per card. That is a grid-level trick, not a component: `useGridSpotlight` writes the pointer position into every card as `--mx`/`--my` from one listener, and the cards' `::before`/`::after` draw radial gradients wider than a card. Five Inspira-derived components remain.

## R3 — Where the components live and how they register

**Decision**: `app/slices/setup/theme/components/ui/<slug>/<PascalName>.vue` with an `index.ts` re-export, beside `ui/badge`. `shadcn-nuxt` (`componentDir: './slices/setup/theme/components/ui'`, `prefix: ''`) calls `addComponentsDir` for that folder, so every `.vue` under it registers by file name: `<GlowingEffect>`, `<CardSpotlight>`, `<AnimatedBeam>`, `<BorderBeam>`, `<ShimmerButton>`, `<Marquee>`, `<Meteors>`. The theme's own `components:` entry ignores `**/ui/**`, so there is no double registration. Verified at implementation by `grep -E "GlowingEffect|Meteors" app/.nuxt/components.d.ts` after `nuxt prepare`.

**Rationale**: the brief says "where the shadcn components live by `components.json`" and to keep one prefix; `badge` is the precedent. A nested `ui/inspira/<slug>` folder would also register (Nuxt scans recursively with `pathPrefix: false`) but adds a level nothing else has.

## R4 — Tailwind v4 keyframes and token plumbing

**Decision**: components that ship their keyframes in a scoped `<style>` (`BorderBeam`, `ShimmerButton`, `Meteors`) keep them. `Marquee` relies on a theme-level `animate-marquee` utility; `landing.css` defines it once:

```css
@theme inline {
  --animate-marquee: land-marquee var(--land-fx-marquee-duration, 40s) linear infinite;
  @keyframes land-marquee { from { transform: translateX(0) } to { transform: translateX(calc(-100% - var(--gap))) } }
}
```

Colours, speeds and durations are **props bound to tokens** at the call site, never literals in the component: `:color-from="'var(--land-fx-from)'"`, `:duration="fx.borderBeamSeconds"`, where `fx` is `useFxTokens()` (reads `getComputedStyle(document.documentElement)` once on mount for the numeric ones that must be numbers, e.g. `BorderBeam.duration`). The full token list is in [data-model.md](./data-model.md) and [contracts/effects.md](./contracts/effects.md). Upstream default gradients (`#ffaa40 → #9c40ff`, slate meteors) are overridden on every use.

**Rationale**: the brief wants tuning without editing components; CSS custom properties are the one mechanism that reaches both CSS-only effects and JS-driven ones.

## R5 — Pause off-screen and in hidden tabs; reduced motion; `hover: none`

**Decision**: one composable, `app/slices/common/composables/useFxPause.ts`: `useFxPause(root: Ref<HTMLElement|null>)` observes the element (threshold 0.05) and `document.visibilitychange`, and toggles `data-fx-paused` on it. `landing.css`:

```css
[data-fx-paused] *, [data-fx-paused]::after { animation-play-state: paused !important; }
```

For SMIL (`AnimatedBeam`) the composable also calls `pauseAnimations()` / `unpauseAnimations()` on every `svg` under the root. Reduced motion is CSS-first:

```css
@media (prefers-reduced-motion: reduce) {
  .landing [class*="animate-"], .landing .land-fx, .landing .land-fx::after { animation: none !important; }
}
```

plus a `reducedMotion` flag from `useFxTokens()` that `GlowingEffect`/`CardSpotlight` read to set `disabled`, `Meteors` to render nothing, and `Stage`'s demo to show the finished state (already in the reference). `hover: none`: `@media (hover: none)` hides the pointer effects' layers and adds `.land-fx-once` to bento cards, a one-shot border highlight keyed off the reveal's `is-in` class.

**Rationale**: `animation-play-state` is the only way to pause a CSS loop without restarting it; one observer per section root instead of one per effect keeps the count at five. The brief lists all four rules explicitly.

**Alternatives**: per-component observers (more code, more observers); JS-driven `Animation.pause()` via WAAPI (components are CSS keyframes, not WAAPI).

## R6 — Lighthouse method and baseline order

**Decision**: `specs/026-app-console-redesign/e2e/measure.mjs` runs `npx lighthouse@12 <url> --chrome-path="$CHROME_PATH" --chrome-flags="--headless=new" --output=json --output-path=...` twice per point: `--preset=desktop` and default mobile, each three runs, median reported. Points: **P0** current commit (= `main` 9d474bdd) before any change, **P1** after the four zone commits, **P2** after all effects. Reported: Performance score, LCP element and ms, CLS, TBT (as the lab proxy for INP), transfer size of JS. `bun run build && bun run preview` on `:3000` with the API on `:4000` so the hero Stage has its public-agent request answered.

**Rationale**: P0 cannot be taken later, hence task 1 in the plan; P1 separates the redesign's cost from the effects' cost, which is what the brief wants to see.

## R7 — Bundle budget method

**Decision**: from the Lighthouse JSON (`network-requests` audit) take every `_nuxt/*.js` the landing loaded, `gzip -9 -c | wc -c` each from `app/.output/public/_nuxt/`, sum. Budget check: `P2 − P1 ≤ 30 720` bytes. Reported alongside the Lighthouse numbers.

**Alternatives**: `nuxt analyze` (whole-app treemap, not per route); `rollup-plugin-visualizer` (new dev dependency).

## R8 — Locale rule in the Sheet

**Decision**: `Sheet.vue` line 58 `new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' })` → `useFormat().date(agent.createdAt)` (`formatDate` already renders a medium date per language). `relativeTime()` stays as it is: it returns `{ key, count }` and the template renders `$t(key, { count })` with the `relative_time.*` keys that already exist in `common/i18n/locales/en.json`. `bun run locale:check` is a gate; the allowlist is not extended.

**Rationale**: `docs/i18n.md` and the constitution: dates go through the format module; the reference is the only violation found (`grep -rnE "Intl\.|toLocale" <ref>/app/slices`).

## R9 — Brand variants kept as in the reference

**Decision**: `useBrandVariant` keeps both `orbit` (default) and `agent-hub`; `?brand=`, cookie `ranch-brand` (30 days, lax), then `runtimeConfig.public.brandVariant`. The `Logo.vue` variants `full | mark | wordmark | symbol` are used: `full` in headers and the gate, `mark` in the orbit hub and the mobile header.

**Rationale**: the brief fixes orbit as the default and does not ask to remove the alternative; deleting working code is a separate decision for the owner.

## R10 — Google Fonts guard rail

**Decision**: keep `useBrandFonts()` (preconnect + one `display=swap` stylesheet for Geist, Geist Mono, DotGothic16) as the reference has it. Measure at P1: if the stylesheet shows as render-blocking in Lighthouse and FCP/LCP regress by > 100 ms against P0, switch to `<link rel="preload" as="style" onload="this.rel='stylesheet'">` with a `<noscript>` fallback; if that is not enough, self-host the three woff2 files under `public/fonts/` with `@font-face` in `landing.css`. The hero `<img>` keeps `fetchpriority="high"` and the `preload` links, so the LCP element is not waiting on fonts.

**Rationale**: the brief sets "Performance not worse than before" as the gate; fonts are the one external dependency the redesign introduces.

## R11 — FR-010: horizon under the Stage at 1440×900

**Decision**: `e2e/horizon.mjs` renders `/` at 1440×900 twice with a CSS override injected:

- **A — raise the scene**: `.land-atmo__img, .land-atmo__video { height: 126%; top: -26%; }` (reference: 114% / −14%) and `.land-atmo__glow { top: 50% }`, so the lit horizon sits ~110 px higher.
- **B — reduce the overlap**: `.land-hero__stage { margin-top: +96px }` and the hero's min-height grows by the same amount, so the Stage starts below the horizon; the fold shows the Stage's top edge only.

Both screenshots (and 390 for sanity) go on CLEAN-215; the owner picks (decision of 2026-11-09: compare first); the chosen rule lands in `landing.css`/`Atmosphere.vue` within the landing zone commit.

## R12 — Polling unchanged

**Decision**: list every 30 s, open agent every 3 s while `pending`/`deploying`, capacity every 30 s for owners/admins — as the reference and `main` have it. The admin console's SSE status feed is not ported (separate work; the reference's own comment says so). Node identity keeps `:key="agent.id"`, so a poll that changes no status re-renders no node.

## R13 — Twin-console grep record

Symbols touched here and their presence in `admin/`:

| Symbol / file | app | admin | Decision |
|---|---|---|---|
| `components/layout/Provider.vue` (console header) | restyled, dark theme forced | exists, own header | admin keeps its light theme; not a shared behaviour |
| `setup/theme/assets/themes/default.css` | `.dark` palette changed | exists, own palette | admin untouched |
| `auth/common/Form.vue` | `variant` prop added, console variant unchanged | admin has its own login form | no twin change |
| `agent/stores/agent.ts` `stop`/`start` | added | already has `stop`/`start` (docs/state.md) | app now matches admin |
| `bridle/components/bridle/chat/*` | class-level (`rounded-full`, `bg-card`) | exists | styling of the customer console; admin's chat is unchanged on purpose |
| `share/components/share/panel/Provider.vue` | class-level | exists | same |
| `agent/components/agent/workspace/*` | Orbit/Drum/Sheet | admin has `Canvas.vue`/`Main.vue`, a different component | not a twin |

PR statement: "Twin check: every touched twin slice grepped in admin; no shared behaviour changed, only app styling and app-only components; admin left unchanged on purpose. `stop`/`start` bring the app store level with admin's."

## R14 — Stop/start endpoints verified

`api/src/slices/agent/agent/agent.controller.ts`: `@Post(':id/restart')` (l.373), `@Post(':id/stop')` (l.383), `@Post(':id/start')` (l.396). `app/slices/setup/api/data/repositories/api/sdk.gen.ts` carries `agentControllerStop` and `agentControllerStart`. No API change; `bun run build:api` only if the worktree's SDK predates them.

## R15 — Browser-check tooling

**Decision**: playwright-core from `PLAYWRIGHT_DIR=/c/Users/maxim/pw` driving the installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`), scripts under `specs/026-app-console-redesign/e2e/` copying the `lib.mjs` conventions of CLEAN-102 (`.env.project` login, no secrets printed). `shots.mjs` takes 1920/1440/1024/768/390/360 of `/`, `/login`, `/register`, `/agents/<id>`; `--reduced` sets `prefers-reduced-motion: reduce` via `emulateMedia`, `--touch` uses a mobile device descriptor (`hasTouch`, `(hover: none)`); `console.mjs` walks Orbit and Drum with the keyboard and asserts `document.activeElement`, triggers `Cmd+K`, and blocks `POST /agents/*/stop` with `route.abort()` to prove the rollback; `horizon.mjs` as in R11. Playwright stays out of the repo's dependencies.

## R16 — Tailwind v4 syntax of the copied code

The upstream `main` branch is the v4 line (`mask-intersect!`, `gap-(--gap)`, `inset-(--cut)`, `blur-(--blur)`, `@container-[size]`, `bg-linear-to-r`); `v1.inspira-ui.com` is the v3 line and is not used. `@tailwindcss/vite` 4.2 compiles these; verified by `bun run build` in the primitives commit before any section uses them.

## R17 — The i18n sync key

`bun run i18n:sync` calls Anthropic with `CLAUDE_API_KEY` from `.env.project`. The key was renewed on 2026-11-09; it is identity-linked, so every request must carry `anthropic-workspace-id`, which the script already reads from `CLAUDE_WORKSPACE_ID` in the same file (verified: a test request answers 200 with the header, 400 without). The reference already ships `ru.json` for every new key and an updated manifest, so `bun run i18n:check` is expected to pass with no sync. The handful of new strings this plan adds (marquee caption, sheet date label if any) go through `i18n:sync`; Russian is never hand-written first, per `docs/i18n.md`. Russian copy from the reference gets a human tone pass as an explicit task (the brief: "живые, без маркетинговой воды").
