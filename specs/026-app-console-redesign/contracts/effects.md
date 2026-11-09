# UI contract: landing effects layer

Seven primitives under `app/slices/setup/theme/components/ui/<slug>/`, one composable `useFxPause`, one helper `useFxTokens`, tokens `--land-fx-*` in `landing.css`. Source: `unovue/inspira-ui@main` (Tailwind v4 line), adapted per research R2.

## Components

| Component | Props kept | Props bound to tokens at the call site | Rendering | Pausable by |
|---|---|---|---|---|
| *(grid spotlight, no component)* `useGridSpotlight(gridRef, fx)` | — | radius ← `--land-fx-spot-size` (×1.6 border, ×2 glow), colours ← `--land-fx-from`, `--land-fx-spot-color` | one `pointermove` on the bento grid writes `--mx`/`--my` into every `[data-spot]` card; each card's `::before` (border, masked ring) and `::after` (inner glow) are radial gradients at that point, wider than a card, so one light runs across the neighbours | `--spot-on` 0 on `pointerleave`; `display: none` under reduced motion and `hover: none` |
| `AnimatedBeam` | `containerRef`, `fromRef`, `toRef`, `curvature`, `reverse`, `pathColor/Width/Opacity`, `gradientStartColor`, `gradientStopColor`, `duration`, `delay`, offsets | colours ← `--land-fx-from/to`, `duration` ← `--land-fx-beam-duration` | SVG path + SMIL `<animate>` on the gradient | `svg.pauseAnimations()` via `useFxPause`; `animation: none` + static gradient under reduced motion |
| `BorderBeam` | `size`, `duration`, `anchor`, `borderWidth`, `colorFrom`, `colorTo`, `delay` | `duration` ← `--land-fx-border-beam-duration` (s), colours ← tokens | CSS `offset-path` keyframe | `animation-play-state` |
| `ShimmerButton` | `shimmerColor`, `shimmerSize`, `shimmerDuration`, `borderRadius`, `background` | `shimmerDuration` ← `--land-fx-shimmer-duration`; `background` = the existing white pill; `shimmerColor` = `rgba(215,123,97,.35)` | CSS keyframes | `animation-play-state` |
| `Marquee` | `reverse`, `pauseOnHover`, `vertical`, `repeat` | duration ← `--land-fx-marquee-duration` through `--animate-marquee` | CSS keyframe `land-marquee` | `animation-play-state`; `pauseOnHover` |
| `Meteors` | `count` | `count` ← `--land-fx-meteor-count` (6); colour `--land-fx-from` at 60 % | CSS keyframes, absolutely positioned spans | `animation-play-state`; not rendered under reduced motion |

Every component imports `cn` from `#theme/utils`. No component imports `motion-v`, `@vueuse/core`, `gsap`, `three` or `ogl`.

## Placement (one commit each, in this order)

| # | Section | Effect | Rule |
|---|---|---|---|
| 1 | Hero `Stage` panel | `BorderBeam` | the hero's only loop; 8–12 s cycle |
| 2 | Capabilities bento | one shared pointer light over the grid (`useGridSpotlight`): border ring + inner glow on every card from the same pointer position | pointer-reactive, no loop; the owner asked for one light shared by all cards (2026-11-09) in place of a per-card glow and a single spotlight |
| 3 | Steps | one `AnimatedBeam` Configure → Deploy → Chat | runs once on `is-in`, then `--land-fx-beam-duration` cycle while in view |
| 4 | Runtime pipeline | `AnimatedBeam` 1 → 4 replacing the dotted line; current-stage highlight synced to the beam's `duration` | loop while in view |
| 5 | Section headings (Steps, Capabilities, Runtime, CTA) | `.land-reveal--blur` | reveal only; never the hero h1 |
| 6 | Primary CTA button(s) | `ShimmerButton` wrapping the existing pill | shape/colours unchanged |
| 7 | Stack row (new, before CTA) | `Marquee pauseOnHover` of five monochrome marks | caption `stack.caption` |
| 8 | CTA section | `Meteors :count="6"` | dim, rare |

Rule of one: when Steps is in view its beam loops, Runtime's is paused by the observer (they are never both ≥ 5 % visible at 1440×900 — verify at 1920×1080 and set Runtime's `threshold` to 0.3 if they are).

## Motion / input matrix

| Condition | Loops (BorderBeam, AnimatedBeam, Marquee, Meteors, Shimmer) | Pointer (grid spotlight) | Reveal blur |
|---|---|---|---|
| default | run while section ≥ 5 % visible and tab visible | follow pointer | on |
| section off-screen or `document.hidden` | paused (`data-fx-paused`) | n/a | n/a |
| `prefers-reduced-motion: reduce` | `animation: none`; Meteors not rendered; beams show a static gradient | `disabled`; glow at rest not shown | off (instant) |
| `(hover: none)` | as default | hidden; `.land-fx-once` one-shot border highlight on `is-in` | on |

## Tokens (`landing.css`, `.landing`)

See data-model "Landing effect tokens" for names and defaults. Rule: a component never contains a literal colour or duration that a token covers; call sites pass `var(--land-fx-…)` for colours and `useFxTokens().<name>` for numbers.

## Budget and measurement (research R6, R7)

- JS added by this layer ≤ 30 720 bytes gzip (`P2 − P1`), expected 6–9 KB.
- Lighthouse Performance `P2 ≥ P0` (desktop and mobile); LCP element = `img.land-atmo__img`; CLS = 0; TBT not worse than `P1` by more than 50 ms.
- Only `transform`, `opacity` (and `filter`, `box-shadow` on hover) are animated. `grep -nE "animation|transition" app/slices/setup/theme/components/ui/*/*.vue app/slices/common/assets/css/landing.css` shows no `width`, `height`, `top`, `left`, `margin` in keyframes.

## Accessibility

Every effect element is `aria-hidden="true"` and `pointer-events: none`; focus order and reading order are unchanged by the layer. `ShimmerButton` keeps the original `NuxtLink`/`button` semantics and text.
