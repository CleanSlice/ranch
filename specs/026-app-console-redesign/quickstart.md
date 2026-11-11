# Quickstart: verify the App console redesign (CLEAN-215)

How to run the feature, measure it and prove the spec's scenarios. Contracts: [landing-ui.md](./contracts/landing-ui.md), [gate-ui.md](./contracts/gate-ui.md), [console-ui.md](./contracts/console-ui.md), [effects.md](./contracts/effects.md). State: [data-model.md](./data-model.md).

## Prerequisites

- Worktree `C:/Users/maxim/orca/workspaces/ranch/app-ui` on `feat/CLEAN-215-app-console-redesign`; `bun install` at the root.
- API running (`bun run dev:api`, `:4000`) with at least one account that owns agents in several statuses and one **public** agent whose `allowedOrigins` includes `http://localhost:3000` (for the hero Stage chat).
- Fresh worktree: `cd app && npx nuxt prepare` before `bun test`; `bun run build:api` only if `app/slices/setup/api/.../sdk.gen.ts` lacks `agentControllerStop`.
- Browser checks: `PLAYWRIGHT_DIR=/c/Users/maxim/pw`, Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- The reference worktree `C:/Users/maxim/orca/workspaces/ranch/skills-redesign` stays untouched until the zone commits are in; compare against it, do not edit it.

## 0. Baseline first (before any code lands)

```bash
cd app && bun run build && bun run preview        # :3000, production build of main
node specs/026-app-console-redesign/e2e/measure.mjs --label P0   # lighthouse desktop+mobile ×3, gzip of landing JS
node specs/026-app-console-redesign/e2e/shots.mjs --only session-ended --out shots/P0   # dialog at 1440 and 390
```

Expected: `specs/026-app-console-redesign/measurements/P0.json` with Performance, LCP element, CLS, TBT, JS bytes; two PNGs of the Session-ended dialog.

## 1. Land the reference (four zone commits)

```bash
git -C C:/Users/maxim/orca/workspaces/ranch/skills-redesign diff > /tmp/ref.patch
git apply --3way /tmp/ref.patch
# copy the untracked files from the brief §7 (skip Claude outputs/, .ranch-app-stage.tgz, orbit-icon.webp, .specify/feature.json)
```

After **each** zone commit:

```bash
cd app && npx nuxt typecheck && bun run build
bun test slices
cd .. && bun run i18n:check && bun run locale:check
```

Expected: green at every zone boundary. `locale:check` must pass after the console zone — `Sheet.vue` uses `useFormat().date`, not `Intl` (R8).

## 2. FR-010 horizon variants

```bash
node specs/026-app-console-redesign/e2e/horizon.mjs --out shots/horizon   # A-raise.png, B-overlap.png at 1440×900 (+390)
```

Post both to CLEAN-215, wait for the pick, apply it in `Atmosphere.vue` / `landing.css`, record the choice in `contracts/landing-ui.md`.

## 3. Effects

Primitives commit, then one commit per section (order in `contracts/effects.md`). After each section:

```bash
cd app && npx nuxt typecheck && bun run build
node specs/026-app-console-redesign/e2e/shots.mjs --only landing --widths 1440,390 --out shots/fx-<n>
```

Post the two PNGs (or a short recording) to the ticket and wait for the OK before the next section.

## 4. Measurements after the effects

```bash
cd app && bun run build && bun run preview
node specs/026-app-console-redesign/e2e/measure.mjs --label P2
node specs/026-app-console-redesign/e2e/measure.mjs --compare P0 P1 P2    # table for the PR
```

Pass: Performance `P2 ≥ P0` (desktop and mobile), LCP element `img.land-atmo__img`, CLS 0, `P2 − P1` JS ≤ 30 720 B gzip.

## 5. Full screenshot set and emulations

```bash
node specs/026-app-console-redesign/e2e/shots.mjs --out shots/final            # 6 widths × landing, login, register, agents
node specs/026-app-console-redesign/e2e/shots.mjs --reduced --out shots/reduced  # prefers-reduced-motion: reduce
node specs/026-app-console-redesign/e2e/shots.mjs --touch --out shots/touch      # hover: none device
node specs/026-app-console-redesign/e2e/shots.mjs --only session-ended --out shots/P2
```

Expected: no horizontal scroll at any width (the script asserts `scrollWidth === clientWidth`); the reduced set shows no travelling light, no meteors, the Stage in its finished state, no video element; the touch set has no glow following the pointer; `shots/P2` Session-ended PNGs show the same dialog, fields and layout as `shots/P0`, differing only by the console's dark theme (FR-017).

## 6. Console behaviour

```bash
node specs/026-app-console-redesign/e2e/console.mjs
```

Asserts: Orbit nodes count per ring matches the legend counts and `RING_CAPACITY`; Tab + arrows move `document.activeElement` across `[data-orbit-node]` in orbit order; Enter navigates to `/agents/<id>`; `Ctrl+K` focuses the search, Enter opens the first match, Esc clears; Drum: wheel then 110 ms → `aria-activedescendant` changes, Enter opens; Sheet Stop with `POST /agents/*/stop` aborted → node, row and sheet show `running` again within 1 s and the error text is shown; without abort → `stopped` on all three; sheet fold persists across reload; `< 1024` shows the list button and full-width chat.

## 7. Gate behaviour (manual, with the live API)

1. `/login` idle: first node lit. Focus email → light runs to the hub. Submit wrong password → hub red, message shown as received; fix → success → console.
2. `/register` with `registration_enabled` on → account created → console; with it off → closed message, Log in offered.
3. In the console, expire the session (delete the token) → Session-ended dialog = `main`.
4. 390 px: route is one row, back link is an icon with an accessible name.

## 8. Unit tests

```bash
cd app && bun test slices/agent slices/common
```

Expected: `orbitLayout` (ordering, capacities 12/22/32, 4th ring beyond 66, label side), `agentStatus` (known/unknown statuses, legend order, initials), `relativeTime` (buckets, invalid input), existing `railOrder`, `format`.

## 9. Static gates (before the PR)

```bash
cd app && npx nuxt typecheck && bun run build && bun test slices
cd .. && bun run i18n:check && bun run locale:check
git status --short   # .specify/feature.json back to main's value; no generated SDK files modified
```

## 10. PR

Into `main`, title with `CLEAN-215`, body: the P0/P1/P2 table, the chosen FR-010 variant, the twin-console statement from research R13, the commands run, links to the screenshot comments on the ticket. Put the PR URL on CLEAN-215 and move it to **In Testing** (id 51).
