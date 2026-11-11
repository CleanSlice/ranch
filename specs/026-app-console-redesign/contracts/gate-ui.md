# UI contract: Session gate (`/login`, `/register`)

Holds `app/slices/user/auth/layouts/auth.vue`, `components/auth/gate/Route.vue`, `components/auth/common/Form.vue` (`variant="gate"`) and the two page providers to the spec.

## Layout

- Root `div.landing.gate` with `@animationend="onLandingAnimationEnd"`; `useLandingChrome()` for fonts and the dark body.
- Scene: `LandingHeroAtmosphere` + `LandingHeroConstellation` (same components as the landing; same video rules).
- Header bar: `LandingBrandLogo variant="full"` linking to `/`; `gate.back` link to `/` — text ≥ 768 px, icon-only below with `aria-label="$t('gate.back')"`.
- Grid: left `section.gate__story` (`aria-label="$t('gate.story_region')"`, eyebrow `01`, title, lede, `AuthGateRoute`); right `.gate__stage` → `.gate__panel` (light panel: `--land-panel`).
- Panel head: kicker with pulse, mono label `jwt · socket.io` (technical, not translated).
- Switch `nav.gate__switch` (`aria-label="$t('gate.switch_label')"`): `NuxtLink /login` = `account.sign_in`, `NuxtLink /register` = `account.create_account`; `is-active` by route. Real navigation; Back works.
- Footer `gate.footer` with `{ year }`.
- `< 1024`: `AuthGateRoute :row="true"` (compact horizontal row above the panel); the panel is full width, `min(100% - 2rem)`.

## Route visualisation (`AuthGateRoute`)

Props `stage: GateStage`, `row?: boolean`. Nodes: `gate.node_you` / `node_hub` / `node_agents` with `_sub` captions.

| Stage | You | line You→Hub | Hub | line Hub→Agents | Agents |
|---|---|---|---|---|---|
| idle | lit | dim | dim | dim | dim |
| filling | lit | light travels | dim | dim | dim |
| connecting | lit | lit | lit (copper) | light travels | dim |
| failed | lit | lit | **red** (`#d6453d`) | dim | dim |

Reduced motion: colours switch instantly, no travelling light (`animation: none`). Decorative: `aria-hidden` on lines; node names remain readable text.

## Form (`AuthForm`, `variant`)

| Prop `variant` | Used by | Look |
|---|---|---|
| `console` (default) | `AuthSessionEndedProvider` | exactly as on `main`: `rounded-md`, `bg-background`, primary button |
| `gate` | login / register pages | `h-12 rounded-2xl` white fields, dark pill submit `bg-[#1a1421]`, copper focus ring |

Stage reporting (gate only, no-op elsewhere): field `focus`/`input` → `filling` (unless submitting); `submitting` → `connecting`; `failed || errorMessage` → `failed`. Validation and error messages are unchanged: messages travel as keys; server text shown as received.

## Registration disabled

`/register` with `registration_enabled=false`: the gate layout renders, the story stays `idle`, the panel shows the closed-registration message (existing `account.*` keys) and the switch still offers `account.sign_in`.

## Non-regression (must hold)

- `/login` → success → the same redirect as `main` (last agent or `/agents`).
- 401 handling, token refresh, `auth.global` middleware: untouched.
- Session-ended dialog: `AuthForm` without `variant`; markup, classes and layout identical to `main` (the `console` branch of `Form.vue` is byte-for-byte the old code). It inherits the console's theme, so it is dark now like the rest of the console; a screenshot against `main` shows only that colour change (quickstart §5).
