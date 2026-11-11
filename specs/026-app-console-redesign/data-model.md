# Data model: App console redesign (CLEAN-215)

No server-side change. Everything below is client state in `app/`.

## Agent (existing, `app/slices/agent/domain/agent.types.ts`)

The one record every surface renders (`agentStore.byId(id)`; `docs/state.md`). Fields this feature reads:

| Field | Type | Used by |
|---|---|---|
| id | string | node key, route `/agents/:id`, `aria-activedescendant` |
| name | string | label, initials (`agentInitials`), search match |
| status | string | ring order, border colour, legend, Sheet actions; unknown values shown as received |
| templateId | string | Sheet "Template" |
| resources | `{ cpu, memory }` | Sheet "Resources", Stage demo card |
| isPublic, allowedOrigins | boolean, string[] | Sheet "Access"; landing Stage picks `publicAgents` whose `allowedOrigins` include the page origin |
| isAdmin | boolean | 12 o'clock on the inner ring; hub click target; class "ADMIN · AGENT" |
| createdAt, updatedAt | ISO string | Sheet "Created <date> · updated N ago" (`useFormat().date`, `relativeTime`) |

Store actions used: `fetchAll` (30 s poll), `fetchById` (3 s while transitional), `fetchPublic` (landing), `fetchCapacity`, `restart`, **`stop`**, **`start`** (new in app; `patch()` to `stopped` / `deploying` with rollback, then `upsert` of the server record).

### Status → presentation (`utils/agentStatus.ts`, pure)

| status | rank (ring order) | colour | pulse | alarm |
|---|---|---|---|---|
| running | 0 | `#2fa66b` | no | no |
| deploying | 1 | `#f5a16b` | yes | no |
| pending | 2 | `#f5a16b` | yes | no |
| failed | 3 | `#d6453d` | no | yes |
| stopped | 4 | `#7e7488` | no | no |
| anything else | 5 | `#7e7488` | no | no (label = raw status) |

Sheet action availability: `canStart` ⇔ status ∈ {stopped, failed}; otherwise Stop. Both and Restart disabled while `busy` or status ∈ {pending, deploying}.

## Agent capacity (existing)

`{ freeAgentSlots, usedAgentSlots, totalAgentSlots }` → toolbar footer "N slots free"; `freeAgentSlots === 0` disables Create agent.

## OrbitNode (`utils/orbitLayout.ts`, pure, tested)

| Field | Meaning |
|---|---|
| agent | the record |
| ring | 0 = inner; capacities `[12, 22, 32]`, a 4th ring opens beyond 66 |
| angle | radians, −π/2 is twelve o'clock; nodes evenly spread per ring, first at twelve |
| x, y | unit position (−1..1) relative to the hub, scaled by the pane's ellipse (`rx = w/2 − 110`, `ry = h/2 − 64`, minimums 120 / 100) |

`orbitOrder()` sorts by rank, then admin first, then server order. `ringRadii(n)` → `[1]`, `[0.54, 1]`, `[0.4, 0.7, 1]`. Label side: `dx > 0.35` → left-aligned to the right of the node, `dx < −0.35` → right-aligned, else centred above/below.

## Drum position (`Drum.vue`)

`position` (fractional card index), `target` (integer once settled), `centred = round(position)`. Constants: `CARD_W 224`, `CARD_H 296`, `STEP_DEG 30`, `RADIUS = (CARD_W/2 + 10) / tan(15°)`, settle delay **110 ms**, lerp factor 0.16 per frame (instant under reduced motion), wheel notch 90 px per card. Angles are never wrapped, so card *n* is `n·30°` away.

## Console view preference (browser-local)

| Key | Values | Default | Where |
|---|---|---|---|
| `localStorage['agent:view']` | `orbit` \| `drum` \| `list` | `orbit` | `workspace/Provider.vue`; ignored below `lg` (always list + full-width chat) |
| `localStorage['agent:sheetOpen']` | `'1'` \| `'0'` | `'1'` ≥ 1024 px, `'0'` below | `workspace/Sheet.vue` |

Search text is transient (not stored).

## Brand variant (`useBrandVariant`)

`'orbit' | 'agent-hub'`. Resolution: `?brand=` (also writes the cookie) → cookie `ranch-brand` (30 d, `sameSite: lax`) → `runtimeConfig.public.brandVariant` (`NUXT_PUBLIC_BRAND_VARIANT`) → `'orbit'`. Unknown strings are `null` at every step. `Logo.vue`: `variant: full | mark | wordmark | symbol`, `size` (mark height px), `label` (`null` inside a named link), `mono`.

## Gate stage (`useGateStage`)

`'idle' | 'filling' | 'connecting' | 'failed'`, provided by `layouts/auth.vue`, set by `auth/common/Form.vue`:

| Transition | Trigger |
|---|---|
| → filling | a field receives focus or input while not submitting |
| → connecting | `submitting` becomes true |
| → failed | `failed` or `errorMessage` becomes truthy |
| → idle | route path changes (login ↔ register) |
| success | navigation away; no stage |

Outside the gate (Session-ended dialog) `inject` finds no provider and `set()` is a no-op.

## Stage demo (`hero/Stage.vue`)

Tabs `chat | runtime | workflow`; default `chat` when a public agent is available, else `workflow`. Workflow steps `submit → schedule → pull → start → online`; runtime lifecycle `pending → deploying → running`; one 1 400 ms interval drives both, cycling `workflow.length + 3` ticks; reduced motion shows the finished state. All demo text under `stage.*` keys and labelled `stage.demo`.

## Landing effect tokens (`landing.css`, `.landing` scope)

| Token | Default | Consumer |
|---|---|---|
| `--land-fx-from` | `var(--land-copper)` | GlowingEffect gradient start, AnimatedBeam `gradientStartColor`, BorderBeam `colorFrom` |
| `--land-fx-to` | `var(--land-lavender)` | gradient ends |
| `--land-fx-glow-width` | `1.25` (px) | GlowingEffect `borderWidth` |
| `--land-fx-glow-spread` | `28` (deg) | GlowingEffect `spread` |
| `--land-fx-spot-size` | `320` (px) | CardSpotlight `gradientSize` |
| `--land-fx-spot-color` | `rgba(245,161,107,0.12)` | CardSpotlight `gradientColor` |
| `--land-fx-beam-duration` | `6` (s) | Steps / Runtime AnimatedBeam `duration` |
| `--land-fx-border-beam-duration` | `10` (s) | hero Stage BorderBeam (8–12 s per spec) |
| `--land-fx-shimmer-duration` | `6s` | ShimmerButton |
| `--land-fx-marquee-duration` | `40s` | Marquee |
| `--land-fx-meteor-count` | `6` | Meteors `count` (5–8 per spec) |
| `--land-fx-reveal-blur` | `12px` | blur reveal on `[data-reveal].land-reveal--blur` |

Numeric tokens are read once by `useFxTokens()` and passed as props; colour tokens are passed as `var(...)` strings.

## Effect pause state (`useFxPause`)

Per section root: `data-fx-paused` present ⇔ root not intersecting (threshold 0.05) **or** `document.hidden`. CSS pauses every animation under it; SMIL is paused/unpaused by method call. Derived flags from `useFxTokens()`: `reducedMotion` (media query), `noHover` (`(hover: none)`).
