# UI contract: landing (`/`)

Holds `app/slices/common/pages/index.vue`, `layouts/landing.vue` and `components/landing/*` to the spec. Tokens live in `assets/css/landing.css` under `.landing`.

## Sections, order and anchors

| # | Component | `id` (header anchor) | i18n namespace |
|---|---|---|---|
| — | `LandingHeaderProvider` | — | `landing_nav.*`, `nav.*` |
| 1 | `LandingHeroProvider` (+ `Atmosphere`, `Constellation`, `Stage`) | — (the logo links to `/`) | `hero.*`, `stage.*` |
| 2 | `LandingStepsProvider` | `how` | `steps.*` |
| 3 | `LandingCapabilitiesProvider` | `platform` | `capabilities.*` |
| 4 | `LandingRuntimeProvider` | `infrastructure` | `runtime.*` |
| 5 | `LandingStackProvider` (new; technology marquee) | — | `stack.*` (new: `stack.caption` = "Built on") |
| 6 | `LandingCtaProvider` | `start` | `final.*` |
| — | `LandingFooterProvider` | `footer` | `footer.*` |

Header anchors: Platform → `#platform`, How it works → `#how`, Infrastructure → `#infrastructure`; smooth scroll unless reduced motion; `history.replaceState` with the hash.

## Header

- Visitors: section anchors, locale switch, `Log in` (`/login`), `Get started` (→ `/register` when `registration_enabled`, else `/login`).
- Signed-in: `Agents` (`/agents`), `History` (`/chats`), `Open console` (`/agents`).
- Mobile (< 768): burger button with `aria-label` `landing_nav.open_menu` / `close_menu`, menu panel `background: var(--land-bg-2)`, **no `backdrop-filter`**.
- The header is `position: fixed`; its `.land-enter` entrance is frozen by `.land-enter--done` on `animationend` (do not remove).

## Hero

- `h1` is two `span.land-hero__line` lines, each a `.land-enter` with delay; at 1440 px neither line wraps. No blur reveal on the h1.
- `Atmosphere`: `<picture>` with mobile sources `< 768`, desktop `srcset` 1600/2560, `fetchpriority="high"`, `width/height` set, preload links in `useHead`. Video rules in the table below. Parallax `translate3d(0, scrollY*0.08, 0) scale(1.04)` on both `img` and `video`, capped at `scrollY 1200`, rAF-throttled, off under reduced motion.
- FR-010 fix: **variant A** (owner's pick, 2026-11-09) — in `Atmosphere.vue` the desktop scene is 126 % tall shifted up 26 % (was 114 % / −14 %) and the horizon glow sits at 50 % (was 58 %), so the lit horizon reads above the Stage panel at 1440×900.

| Condition | Video |
|---|---|
| `prefers-reduced-motion: reduce` | never requested |
| viewport `< 768` | never requested |
| `navigator.connection.saveData` | never requested |
| `effectiveType` matches `2g` / `3g` | never requested |
| otherwise | requested after `load` + idle (`requestIdleCallback` timeout 2 000 ms, Safari fallback 300 ms), `muted loop playsinline`, fades in 1.2 s on `playing`, paused when the hero is < 5 % visible |

Sources: `hero-loop-1440.webm` / `.mp4` when the viewport is at least ~1700 device pixels wide (1920 at 1x, 1024 at 2x), else `hero-loop-1080.webm` / `.mp4`; AV1 webm first (`av01.0.08M.10`), H.264 mp4 second. Chosen once when the video mounts. Files re-rendered 2026-11-09 from the 4K Veo master (clean star field, no streaks): 1080 0.48 / 1.04 MB, 1440 0.68 / 1.69 MB.

## Stage

- Card: initial/avatar, `stage.demo_agent` or the real agent's name, template, status dot + label (`status.*` from the agent slice, raw status when no key), CPU / memory.
- Tabs `chat | runtime | workflow`, `role="tablist"`, arrow/Home/End keys. Chat tab = `BridleChatProvider` for the first public agent whose `allowedOrigins` includes `useRequestURL().origin`; otherwise `hero.no_agent_title` / `hero.no_agent_lede` with the origin. Workflow/runtime are demos labelled `stage.demo`.
- Border beam (effects phase) is the **only** looping effect in the hero.

## Reveal

- `[data-reveal]` elements get `is-in` once from one `IntersectionObserver` (`rootMargin 0 0 -10% 0`, `threshold 0.12`), unobserved after; reduced motion → all `is-in` on mount.
- Section headings add `land-reveal--blur` (effects phase): `filter: blur(var(--land-fx-reveal-blur)) → 0`, `opacity 0 → 1`, same `is-in` trigger. Never on the hero h1.

## Copy rules

- No numbers that are not real (no agent counts, uptime, client logos, testimonials). The old `hero.stat_*` keys are gone and stay gone.
- `stack` marquee shows only Kubernetes, Argo Workflows, Docker, Socket.IO, Bridle as monochrome marks with the caption `stack.caption`; never presented as customers.
- Every string via `$t`; English in `en.json`, Russian via `i18n:sync` + tone pass.

## Widths

1920 / 1440 / 1024 / 768 / 390 / 360: no horizontal scroll (`document.documentElement.scrollWidth === clientWidth`), no element overlaps text (visual check on the screenshot set).
