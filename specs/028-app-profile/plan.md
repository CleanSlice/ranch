# Implementation Plan: App profile page "Pass"

**Branch**: `feat/CLEAN-217-app-profile` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/028-app-profile/spec.md`

**Ticket**: [CLEAN-217](https://dreamvention.atlassian.net/browse/CLEAN-217) `[APP]`

## Summary

A new `/profile` page in the app console, built as its own `profile` slice:
a pass card (personal sign, name, role, registry number, account status, fleet
stub) and a "back of the pass" column (account details, capabilities by role,
session row). Everything is read from the two stores the console already has
(`auth`, `agent`); no API change, no new store, no new dependency. The header's
name + role badge become one pill linking to the page, and `/profile` joins the
protected routes. Three pure functions carry the rules and are unit-tested;
the page itself is checked in a browser across roles, widths and reduced
motion.

## Technical Context

**Language/Version**: TypeScript 5.x, Nuxt 4 (`ssr: false`), Vue 3.5, Pinia,
@nuxtjs/i18n, Tailwind v4. App console only (`app/`).

**Primary Dependencies**: none added. Icons through the existing `<Icon>`
(lucide), logo through `LandingBrandLogo`, fonts already self-hosted (Geist,
Geist Mono, DotGothic16).

**Storage**: none. Reads `useAuthStore().user` and `useAgentStore()`
(`agents`, `capacity`).

**Testing**: `bun test slices` for the pure utils; `npx nuxt typecheck`;
`bun run i18n:check` and `bun run locale:check` from the repo root;
playwright-core script `specs/028-app-profile/e2e/profile.mjs` reusing
`specs/026-app-console-redesign/e2e/lib.mjs`.

**Target Platform**: the app console, 360–1920 px, dark RANCH theme.

**Project Type**: web console (monorepo, slices).

**Performance Goals**: none specific; the page adds one route chunk and no
request the agents workspace does not already make.

**Constraints**: FR-003 (no value → no row), FR-017 (nothing else breaks),
tilt only on `(hover: hover) and (pointer: fine)` and off under reduced
motion, no endless animation.

**Scale/Scope**: one new slice (~9 files), three touched files outside it
(header, route guard, workspace provider), ~35 i18n keys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| I. The slice is the unit | PASS | New top-level slice `app/slices/profile` (page, components, utils, i18n). The brief suggested `user/auth`; that slice owns sign-in and would have to reach into the agent slice for the fleet, so the profile is its own slice and reads `auth` and `agent` through their public surfaces only: the auto-imported stores, `#agent/utils/agentStatus` (`agentInitials`, `agentStatusMeta`) and one new composable the agent slice exports (R3). The header pill lives in `common` because the header does. |
| II. Twin consoles (NON-NEGOTIABLE) | PASS with statement | `profile` is not a twin slice. Touched twins: `common` (header `layout/Provider.vue`), `user` (`auth.global.ts`), `agent` (workspace provider, new composable). Admin checked (R6): its user block is in the sidebar with its own menu, its guard protects everything by default, its workspace has an SSE feed instead of this poll. None of the three changes has a counterpart to make there; the PR says so. |
| III. Secrets stay behind `api/` | PASS | No credential. The id shown and copied is the person's own. |
| IV. One entity, one store | PASS | The page renders `authStore.user` and `storeToRefs(agentStore).agents` / `capacity`; `useAsyncData('agents', …)` is kept for `pending` / `refresh` only, with the same key as the workspace so the two never double-fetch. No copy of either entity in a component. |
| V. Console is a window, chat is the hands | N/A, stated | Applies to admin-console capabilities. This is an app page that changes nothing on the server. |
| VI. English is the source | PASS | Keys under `profile.*` in `app/slices/profile/i18n/locales/en.json`; `bun run i18n:sync` generates `ru`; then `ru.json` is corrected to the mock-up's wording (docs/i18n.md: a hand-corrected translation is kept). The brief's "ru by hand" is overridden by this rule. |
| VII. A rule stays a rule | PASS | Registry number, capability list and slot scale are pure functions with tests. No model call. |
| Generated code is generated | PASS | No DTO change; SDK untouched. |
| Tracker / surface | PASS | CLEAN-217, `[APP]`, label `app`. |
| Quality gates | PLANNED | Commands in [quickstart.md](./quickstart.md). Magic numbers carry their reason: 30 s (the workspace's existing poll), 40 slots (above it one mark per slot is under 6 px wide on the 400 px pass), 6° tilt and 44 px targets (the brief), 2 s "Copied" (the brief). |

**Post-design re-check**: no violation. Two decisions worth naming: (a) own
slice instead of `user/auth` (R1); (b) the 30 s fleet poll moves from the
workspace provider into `useAgentFleet()` in the agent slice so the profile
and the workspace share one implementation rather than two copies (R3). The
workspace's behaviour is unchanged and is re-verified with the existing
`e2e/console.mjs`.

## Project Structure

### Documentation (this feature)

```text
specs/028-app-profile/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: R1–R9
├── data-model.md        # Phase 1: what the page reads, derived values
├── quickstart.md        # Phase 1: run, gates, browser checks, states
├── contracts/
│   └── profile-ui.md    # route, header pill, pass, back, a11y, motion, i18n keys
├── e2e/                 # implementation phase: profile.mjs, shots/
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
app/slices/profile/                      # new slice
├── nuxt.config.ts                       # alias #profile, i18n langDir, imports
├── pages/profile.vue                    # the page: two columns, data wiring
├── components/profile/
│   ├── Sign.vue                         # personal sign, inline SVG, props initials + size
│   ├── Pass.vue                         # lanyard, card, identity, perforation, tilt
│   ├── Fleet.vue                        # stub: counters, slot scale, caption
│   ├── Account.vue                      # dl rows, copy id
│   ├── Capabilities.vue                 # list from capabilitiesFor(role)
│   └── Session.vue                      # signed-in row, To agents, Log out
├── utils/
│   ├── registryNumber.ts (+ .test.ts)   # id → "7F3A·9C1E"
│   ├── capabilities.ts (+ .test.ts)     # role → five items with state
│   └── slotScale.ts (+ .test.ts)        # capacity → marks | bar
└── i18n/locales/en.json (+ ru.json via sync, then corrected)

app/slices/agent/
├── composables/useAgentFleet.ts         # new: 'agents' fetch + 30 s list/capacity poll
└── components/agent/workspace/Provider.vue   # uses useAgentFleet (behaviour unchanged)

app/slices/common/components/layout/Provider.vue   # name + role → one pill to /profile
app/slices/user/auth/middleware/auth.global.ts     # '/profile' in PROTECTED_PREFIXES
app/i18n.sync.json                                  # manifest picks up the new slice (generated)
```

**Structure Decision**: one new app slice plus three small touches in the
slices that own the header, the route guard and the fleet poll.

## Complexity Tracking

No violations to justify.
