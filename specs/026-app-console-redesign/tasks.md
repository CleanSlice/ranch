---

description: "Task list for the App console redesign (CLEAN-215)"
---

# Tasks: App console redesign

**Input**: Design documents from `specs/026-app-console-redesign/` — [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Ticket**: [CLEAN-215](https://dreamvention.atlassian.net/browse/CLEAN-215) · **Branch**: `feat/CLEAN-215-app-console-redesign` · **Worktree**: `C:/Users/maxim/orca/workspaces/ranch/app-ui`

**Tests**: the spec asks for unit tests on the pure utilities (SC-009) and for browser checks run by hand (quickstart §5–6); both are included. No component test runner exists in the repo.

**Organization**: by user story. The reference code arrives in one `git apply` (Phase 2) and is then committed zone by zone, each zone inside the story it serves. Every zone commit builds, typechecks and passes `bun test slices` on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 landing · US2 Orbit console · US3 Session gate · US4 Drum · US5 effects
- Paths are repo-relative. `REF` = `C:/Users/maxim/orca/workspaces/ranch/skills-redesign` (the reference worktree, read-only for this work). `E2E` = `specs/026-app-console-redesign/e2e`. `SHOTS` = `specs/026-app-console-redesign/shots` (gitignored output; see T006).

## Jira comments

Large task: one comment per checkpoint marked **(Jira)** below — what landed, what is next, screenshots attached where the task says so. Teammate tone, a few sentences.

---

## Phase 1: Setup (baseline and tooling)

**Purpose**: take the measurements that cannot be taken later, and build the scripts every later phase uses. Nothing in `app/` changes in this phase.

- [X] T001 Confirm the starting point: `git status` clean apart from `.specify/feature.json` and `specs/026-app-console-redesign/`; `git rev-parse HEAD` equals `origin/main` (`9d474bdd`); `node -e "require('C:/Users/maxim/pw/node_modules/playwright-core/package.json')"` resolves; Chrome exists at `C:/Program Files/Google/Chrome/Application/chrome.exe`
- [X] T002 [P] Create `E2E/lib.mjs` from `specs/015-chat-message-reliability/e2e/lib.mjs`: keep `REPO`, `.env.project` loader, `chromium.launch({ executablePath: CHROME })`, the login helper (`RANCH_PLATFORM_LOGIN` / `RANCH_PLATFORM_PASS` fallback to `RANCH_LOGIN` / `RANCH_PASS`), `APP` default `http://localhost:3000`; drop the CLEAN-102-specific helpers; never print secrets
- [X] T003 [P] Create `E2E/measure.mjs`: `--label <P0|P1|P2>` runs `npx lighthouse@12 http://localhost:3000/ --chrome-path=<CHROME> --chrome-flags="--headless=new" --output=json --output-path=<tmp>` three times with `--preset=desktop` and three times mobile, writes the medians (Performance, LCP element selector + ms, CLS, TBT, JS transfer bytes) and the gzip sum of every `_nuxt/*.js` from the `network-requests` audit (read from `app/.output/public/_nuxt/`, `zlib.gzipSync` level 9) to `specs/026-app-console-redesign/measurements/<label>.json`; `--compare P0 P1 P2` prints a markdown table (research R6, R7)
- [X] T004 [P] Create `E2E/shots.mjs`: pages `landing /`, `login /login`, `register /register`, `agents /agents/<AGENT_ID>` (logged in), `session-ended` (log in, open `/agents/<id>`, clear the `localStorage` token and trigger a request so `AuthSessionEndedProvider` opens); widths `1920,1440,1024,768,390,360` (`--widths` overrides, `--only <page[,page]>`); flags `--reduced` (`page.emulateMedia({ reducedMotion: 'reduce' })`), `--touch` (mobile context: `hasTouch: true`, `isMobile: true`); asserts `document.documentElement.scrollWidth === clientWidth` per shot; full-page PNGs to `--out <dir>/<page>-<width>[-reduced|-touch].png`
- [X] T005 [P] Create `E2E/horizon.mjs`: at 1440×900 (and 390×844) load `/`, wait for `img.land-atmo__img` complete, inject variant CSS via `page.addStyleTag` — `A`: `.land-atmo__img,.land-atmo__video{height:126%;top:-26%}.land-atmo__glow{top:50%}`; `B`: `.land-hero__stage{margin-top:96px}` plus the matching hero min-height bump — fold-only screenshots to `--out <dir>/A-raise-<w>.png`, `B-overlap-<w>.png`, and `base-<w>.png` without override (research R11)
- [X] T006 Add `specs/026-app-console-redesign/shots/` and `specs/026-app-console-redesign/measurements/*.tmp.json` to `.gitignore` (the medians `P0.json`/`P1.json`/`P2.json` are committed; raw Lighthouse output is not)
- [X] T007 Restore `.specify/feature.json` to `main`'s value (`git show HEAD:.specify/feature.json > .specify/feature.json`) — it is tracked and must not ride in this PR; downstream SpecKit commands are given the feature dir explicitly
- [X] T008 **P0 baseline**: with the API on `:4000`, `cd app && bun run build && bun run preview` (`:3000`), run `node E2E/measure.mjs --label P0` and `node E2E/shots.mjs --only session-ended --widths 1440,390 --out SHOTS/P0`; commit `measurements/P0.json`, `.gitignore` and the e2e scripts as `chore(app): e2e scripts and P0 baseline for the console redesign (CLEAN-215)` **(Jira: baseline numbers)**

---

## Phase 2: Foundational (reference import + brand zone)

**Purpose**: bring the reference into this worktree and land the brand zone that every other zone imports (`LandingBrandLogo`, `useBrandFonts`, the console theme).

**⚠️ CRITICAL**: no story phase starts before T015 is committed and green.

- [X] T009 Export the reference: `git -C REF diff > <scratch>/ref.patch`; list untracked files with `git -C REF status --short | grep '^??'` and exclude `Claude outputs/`, `.ranch-app-stage.tgz`, `.specify/feature.json`, `app/public/landing/brand/orbit-icon.webp`
- [X] T010 Apply the tracked changes: `git apply --3way <scratch>/ref.patch` at the repo root; resolve any conflict in favour of the reference and note it in the Jira comment; `git status --short` must list exactly the 29 tracked files of the brief §7 (30 minus `.specify/feature.json`)
- [X] T011 Copy the untracked files from `REF/app/...` to the same paths here (`public/landing/**` except `brand/orbit-icon.webp`; `slices/agent/components/agent/workspace/{Drum,Orbit,Sheet}.vue`; `slices/agent/composables/useAgentControls.ts`; `slices/agent/utils/{agentStatus,orbitLayout,orbitLayout.test,relativeTime}.ts`; `slices/common/assets/css/landing.css`; `slices/common/components/landing/{brand,capabilities,cta,footer,header,runtime,steps}/**`; `slices/common/components/landing/hero/{Atmosphere,Constellation,Stage}.vue`; `slices/common/composables/{useBrandVariant,useLandingChrome,useReveal}.ts`; `slices/common/layouts/landing.vue`; `slices/user/auth/components/auth/gate/**`; `slices/user/auth/composables/useGateStage.ts`); verify with `diff -rq REF/app/slices app/slices` that only intentional differences remain
- [X] T012 Whole-tree sanity before splitting: `cd app && npx nuxt prepare && npx nuxt typecheck && bun run build && bun test slices`; `cd .. && bun run i18n:check && bun run locale:check` — expect only the `locale:check` failure on `app/slices/agent/components/agent/workspace/Sheet.vue` (fixed in T024); anything else is a reference defect to fix now and list in the Jira comment
- [X] T013 Review `app/slices/common/components/landing/brand/Logo.vue`, `app/slices/common/composables/useBrandVariant.ts`, `app/slices/common/composables/useLandingChrome.ts`, `app/slices/common/components/layout/Provider.vue`, `app/slices/setup/theme/assets/themes/default.css`, `app/nuxt.config.ts` against research R9/R10 and `contracts/landing-ui.md` (Header): orbit default, `?brand=` → cookie → runtime config, `full|mark|wordmark|symbol` variants, `useHead({ htmlAttrs: { class: 'dark' } })`, preconnect + one `display=swap` stylesheet
- [X] T014 Stage and commit the brand zone only: `git add app/nuxt.config.ts app/public/landing/brand app/slices/common/components/landing/brand app/slices/common/composables/useBrandVariant.ts app/slices/common/composables/useLandingChrome.ts app/slices/common/components/layout/Provider.vue app/slices/setup/theme/assets/themes/default.css` → `feat(common): orbit brand, plum console theme and Geist fonts (CLEAN-215)`; the rest stays unstaged
- [X] T015 Zone boundary check on the brand commit alone: `git stash push -u -m "clean-215-rest"`, capture its SHA with `git stash list --format='%H %gs' | grep clean-215-rest`, `cd app && npx nuxt typecheck && bun run build`, then `git stash apply <sha>` and drop that entry by re-finding its tag (never bare `stash pop`); a follow-up commit if the brand zone does not build alone **(Jira: brand landed, landing next)**

**Checkpoint**: brand zone committed and green; working tree holds the remaining reference files.

---

## Phase 3: User Story 1 — Landing (Priority: P1) 🎯 MVP

**Goal**: the public landing with pill header, cinematic hero + Stage demo (real chat when a public agent allows the origin), Steps, Capabilities, Runtime, CTA, footer, scroll reveal, video rules; the FR-010 horizon decided on screenshots.

**Independent Test**: `node E2E/shots.mjs --only landing --out SHOTS/us1` at six widths matches `REF/Claude outputs/landing/*.png`; `--reduced` shows no video element and everything visible; every header anchor scrolls; the Stage Chat tab talks to the public agent.

### Review and fixes

- [X] T016 [US1] Review `app/slices/common/pages/index.vue`, `app/slices/common/layouts/landing.vue`, `app/slices/common/components/landing/header/Provider.vue` against `contracts/landing-ui.md`: section order and `id`s (`top`, `how`, `platform`, `infrastructure`, `start`, `footer`), visitor vs signed-in header links, opaque mobile menu (`background: var(--land-bg-2)`, no `backdrop-filter`), `.land-enter--done` freeze kept
- [X] T017 [P] [US1] Review `app/slices/common/components/landing/hero/Provider.vue`, `Atmosphere.vue`, `Constellation.vue` against the video table in `contracts/landing-ui.md` (reduced motion, `< 768`, `saveData`, `2g/3g`, load + idle, 1.2 s fade on `playing`, pause < 5 % visible, 8 % parallax on img and video); h1 two lines at 1440 with no blur; preload links present
- [X] T018 [P] [US1] Review `app/slices/common/components/landing/hero/Stage.vue`: Chat tab is `BridleChatProvider` for the first `publicAgents` entry whose `allowedOrigins` includes the page origin, else `hero.no_agent_*`; Workflow/Runtime demos labelled `stage.demo`; tablist keyboard; reduced motion shows the finished state (FR-008)
- [X] T019 [P] [US1] Review `app/slices/common/components/landing/{steps,capabilities,runtime,cta,footer}/Provider.vue` and `app/slices/common/composables/useReveal.ts`: one observer, `is-in` once, reduced motion shows all; copy contains no invented numbers (grep `en.json` for digits in `hero.*`, `capabilities.*`, `final.*`) (FR-011, FR-012, FR-013)
- [X] T020 [US1] Russian tone pass on `app/slices/common/i18n/locales/ru.json` for `landing_nav.*`, `hero.*`, `stage.*`, `steps.*`, `capabilities.*`, `runtime.*`, `final.*`, `footer.*`: wording corrections only, no new keys; then `bun run i18n:check` (if the sync marks keys outdated, run `bun run i18n:sync` and re-review)

### FR-010 horizon

- [X] T021 [US1] With `cd app && bun run dev` running, `node E2E/horizon.mjs --out SHOTS/horizon`; post `A-raise-1440.png`, `B-overlap-1440.png` and the two 390 shots on CLEAN-215 with one sentence each **(Jira: horizon variants, waiting for the pick)**
- [ ] T022 [US1] ⏸ Wait for the owner's pick; apply the chosen rule in `app/slices/common/components/landing/hero/Atmosphere.vue` (variant A: the `@media (min-width: 768px)` height/top block and `.land-atmo__glow` top) or `app/slices/common/assets/css/landing.css` (variant B: `.land-hero__stage` offset and hero min-height); record the choice in `specs/026-app-console-redesign/contracts/landing-ui.md` (Hero bullet)

### Commit

- [X] T023 [US1] Stage and commit the landing zone: `git add app/slices/common/nuxt.config.ts app/slices/common/assets app/slices/common/composables/useReveal.ts app/slices/common/layouts app/slices/common/pages/index.vue app/slices/common/components/landing app/public/landing app/slices/common/i18n` → `feat(common): landing with cinematic hero and product stage (CLEAN-215)`; zone boundary `cd app && npx nuxt typecheck && bun run build`; `node E2E/shots.mjs --only landing --out SHOTS/us1` and `--reduced`; attach 1440 + 390 to the ticket **(Jira: landing landed, console next)**

**Checkpoint**: landing shippable on its own (header, hero, sections, footer; gate and console still the old ones).

---

## Phase 4: User Story 2 — Orbit console (Priority: P1)

**Goal**: Orbit view with status rings, keyboard nodes, shared toolbar (view switch, ⌘K search, legend, slots, Create), cockpit Sheet with Restart/Stop/Start/Share/New chat on the one store record, list + full-width chat below `lg`.

**Independent Test**: `node E2E/console.mjs` passes (ring counts, keyboard order, Enter opens, ⌘K, stop rollback on an aborted request, sheet fold persists, `< 1024` layout); `bun test slices/agent` green; `bun run locale:check` green.

### Fixes and tests

- [X] T024 [US2] Replace `new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' })` in `app/slices/agent/components/agent/workspace/Sheet.vue` with `useFormat().date(props.agent.createdAt)` (drop the `useI18n` locale import if nothing else uses it); `bun run locale:check` must pass (research R8)
- [X] T025 [P] [US2] Add `app/slices/agent/utils/agentStatus.test.ts`: `agentStatusMeta` for the five statuses, `undefined` and an unknown string (neutral colour, `labelKey: null`); `LEGEND_STATUSES` order; `agentInitials` for one word, two words, three words (two letters), blank name → fallback id, blank both → `?`
- [X] T026 [P] [US2] Add `app/slices/agent/utils/relativeTime.test.ts`: `null`/invalid → `null`; 30 s → `just_now`; 5 min → `minutes` 5; 3 h → `hours` 3; 2 d → `days` 2; a future timestamp clamps to `just_now`
- [X] T027 [P] [US2] Extend `app/slices/agent/utils/orbitLayout.test.ts` where cases are missing: admin first inside the running bucket, 13 running agents overflow to ring 1, 67 agents open a 4th ring, `ringRadii(1|2|3|4)`, first node of each ring at −π/2
- [X] T028 [US2] Review `app/slices/agent/components/agent/workspace/Provider.vue`, `Orbit.vue`, `Rail.vue`, `RailItem.vue` against `contracts/console-ui.md` (Toolbar, Orbit): `role="tablist"` switch, `agent:view` persistence, search Enter/Esc/⌘K including the Rail's `[data-agent-search]`, legend order and non-zero filter, slots footer and disabled Create at 0, node `aria-label` "<name>, <status>", hub `aria-label` `rail.admin_agent`, arrow-key wrap, `:key="agent.id"`, `< lg` hides the switch and shows "Switch agent"
- [X] T029 [US2] Review `app/slices/agent/components/agent/workspace/Sheet.vue`, `app/slices/agent/composables/useAgentControls.ts`, `app/slices/agent/stores/agent.ts`, `app/slices/agent/components/agent/chat/Provider.vue` (`compact`) against `contracts/console-ui.md` (Sheet, Store): `canStart` rule, disabled while transitioning, `patch` + rollback + `upsert` + `fetchCapacity`, 401 leaves no second error, `agent:sheetOpen` default by `max-width: 1023px`, fold `aria-expanded`
- [X] T030 [P] [US2] Review the class-level restyle in `app/slices/bridle/components/bridle/chat/{Provider,Input,Empty,NewChat}.vue` and `app/slices/share/components/share/panel/Provider.vue`: classes only, no behaviour change (`git diff --stat` on those files shows ≤ 10 changed lines each)
- [X] T031 [US2] Russian tone pass on `app/slices/agent/i18n/locales/ru.json` for `orbit.*`, `drum.*`, `sheet.*`; `bun run i18n:check`

### Browser check

- [X] T032 [US2] Create `E2E/console.mjs`: log in, open `/agents/<AGENT_ID>` at 1440×900; assert nodes per ring equal legend counts and respect `[12,22,32]`; Tab to the first `[data-orbit-node]`, ArrowRight ×3 and ArrowLeft ×4 → `document.activeElement` follows orbit order and wraps; Enter → URL `/agents/<id>`; `Control+K` → search focused, type a name, Enter → first match opens, Escape clears; Sheet: with `page.route('**/agents/*/stop', r => r.abort())` click Stop → within 1 000 ms node border colour, Rail row dot and Sheet status all read running again and the `sheet.stop_failed` text is visible; without the route → `stopped` on all three; click fold, reload → still folded; `page.setViewportSize({ width: 1000, height: 800 })` → "Switch agent" button visible, no tablist
- [X] T033 [US2] Run `node E2E/console.mjs` and `node E2E/shots.mjs --only agents --out SHOTS/us2`; compare 1440 with `REF/Claude outputs/console/ranch-console-orbit-1440.png` and the mobile shot with `ranch-console-orbit-mobile-search-list.png`

### Commit

- [X] T034 [US2] Stage and commit the console zone: `git add app/slices/agent app/slices/bridle app/slices/share` → `feat(agent): orbit, drum and cockpit sheet in the agent console (CLEAN-215)`; zone boundary `cd app && npx nuxt typecheck && bun run build && bun test slices`; `cd .. && bun run locale:check` **(Jira: console landed with 1440 + 390 shots, gate next)**

**Checkpoint**: console shippable; the Drum view is in this commit and gets its own verification in Phase 6.

---

## Phase 5: User Story 3 — Session gate (Priority: P2)

**Goal**: `/login` and `/register` on the hero scene with the "You → RANCH hub → Your agents" route reacting to the form; Session-ended dialog unchanged.

**Independent Test**: manual walkthrough in quickstart §7 with the live API; `node E2E/shots.mjs --only login,register --out SHOTS/us3` matches `REF/Claude outputs/auth/*.png`; `SHOTS/us3/session-ended-*.png` pixel-equal to `SHOTS/P0`.

- [X] T035 [US3] Review `app/slices/user/auth/layouts/auth.vue`, `app/slices/user/auth/components/auth/gate/Route.vue`, `app/slices/user/auth/composables/useGateStage.ts` against `contracts/gate-ui.md`: stage table (idle/filling/connecting/failed), reset to `idle` on route change, `row` below 1024, back link icon-only below 768 with `aria-label`, switch links to the real `/login` and `/register`, reduced motion = instant colour change
- [X] T036 [US3] Review `app/slices/user/auth/components/auth/common/Form.vue`: `variant` defaults to the console look and the `console` branch's classes are byte-identical to `main` (`git diff main -- app/slices/user/auth/components/auth/common/Form.vue` shows only additions inside the `gate` branch and the stage watchers); `setStage` is a no-op without a provider
- [X] T037 [P] [US3] Review `app/slices/user/auth/components/auth/{login,register}/Provider.vue` and the `useRegistrationEnabled` use: `variant="gate"` passed; the registration-closed state renders inside the gate panel and offers Log in (FR-018)
- [X] T038 [P] [US3] Russian tone pass on `app/slices/user/auth/i18n/locales/ru.json` for `gate.*`; `bun run i18n:check`
- [X] T039 [US3] Manual run with the live API (quickstart §7): wrong password → hub red + message as received; right password → console; register with the flag on and off; expire the session in the console → dialog opens with the plain form; 390 px route row + icon back
- [X] T040 [US3] `node E2E/shots.mjs --only login,register,session-ended --out SHOTS/us3`; byte-compare `SHOTS/us3/session-ended-{1440,390}.png` with `SHOTS/P0/` (`cmp`); if they differ, open both and judge — any visible difference is a defect to fix in `Form.vue`
- [X] T041 [US3] Stage and commit the gate zone plus the manifest: `git add app/slices/user/auth app/i18n.sync.json` → `feat(auth): session gate for login and register (CLEAN-215)`; zone boundary `cd app && npx nuxt typecheck && bun run build`; `cd .. && bun run i18n:check` must pass here (the last zone carries the manifest); `git status --short` must be clean **(Jira: gate landed; all four zones in; effects next)**

**Checkpoint**: the whole reference is on the branch in four commits; `git status` clean.

---

## Phase 6: User Story 4 — Drum (Priority: P2)

**Goal**: Drum view verified against the contract (code already committed in T034; this phase proves and tunes it).

**Independent Test**: the Drum block of `E2E/console.mjs` passes; a screen reader announces the list box and the active card; `agent:view = drum` survives a reload.

- [X] T042 [US4] Review `app/slices/agent/components/agent/workspace/Drum.vue` against `contracts/console-ui.md` (Drum): 30° step, radius formula, 110 ms settle, lerp 0.16, wheel 90 px/card with `deltaMode` factors, drag threshold 4 px, click on a side card turns, front card click/Enter/Space selects, PageUp/Down ±5, Home/End, `role="listbox"` + `aria-activedescendant`, options beyond ±2 `aria-hidden`, reduced motion snaps
- [X] T043 [US4] Extend `E2E/console.mjs` with a Drum block: switch view via the tab, `mouse.wheel(0, 300)`, wait 150 ms → `aria-activedescendant` changed; `ArrowRight` → next; `Enter` → navigates; reload → the Drum tab is `aria-selected`; `--reduced` run → the transform equals the target after one frame
- [X] T044 [US4] Run `node E2E/console.mjs` and `node E2E/shots.mjs --only agents --out SHOTS/us4` with `localStorage['agent:view']='drum'` pre-set; compare with `REF/Claude outputs/console/ranch-console-drum-1440.png`; fix any drift in `Drum.vue` as a follow-up commit `fix(agent): drum <what> (CLEAN-215)` only if needed **(Jira: drum verified, shots attached)**

**Checkpoint**: all four zones verified; take P1 next.

---

## Phase 7: User Story 5 — Effects layer (Priority: P3)

**Goal**: seven effect primitives with tokens, pause and motion rules; eight placements, one commit each with screenshots and the owner's OK; P1/P2 measurements and the budget.

**Independent Test**: quickstart §3–4: per-section 1440 + 390 shots approved on the ticket; `--reduced` shows nothing moving; `--touch` shows no pointer glow; `node E2E/measure.mjs --compare P0 P1 P2` passes the gates in `contracts/effects.md`.

### P1 measurement (before any effect)

- [X] T045 [US5] `cd app && bun run build && bun run preview`; `node E2E/measure.mjs --label P1`; commit `measurements/P1.json` as `chore(app): P1 measurement after the redesign zones (CLEAN-215)`; if Google Fonts shows render-blocking and FCP/LCP regressed > 100 ms vs P0, apply research R10 step 1 (`preload as=style` + `onload`) in `app/slices/common/composables/useLandingChrome.ts` and re-measure before continuing **(Jira: P0 vs P1 table)**

### Primitives (one commit)

- [X] T046 [P] [US5] Create `app/slices/setup/theme/components/ui/glowing-effect/GlowingEffect.vue` + `index.ts` from the fetched upstream source: `cn` from `#theme/utils`; replace `animate()` from `motion-v` with a local `tweenAngle(from, to, seconds, onUpdate)` on `requestAnimationFrame` with the cubic-bezier `[0.16, 1, 0.3, 1]` easing; replace the four-colour default gradient with a two-stop conic from `var(--land-fx-from)` to `var(--land-fx-to)`; `disabled` driven by the caller (research R2)
- [X] T047 [P] [US5] Create `app/slices/setup/theme/components/ui/card-spotlight/CardSpotlight.vue` + `index.ts` (`cn` from `#theme/utils`; props `gradientSize`, `gradientColor`, `gradientOpacity`, `slotClass`; add a `disabled` prop that renders the slot only)
- [X] T048 [P] [US5] Create `app/slices/setup/theme/components/ui/animated-beam/AnimatedBeam.vue` + `index.ts` (`cn` from `#theme/utils`; keep SMIL `<animate>`; `defineExpose` the `svg` root so `useFxPause` can call `pauseAnimations()`; add a `static` prop that drops the `<animate>` elements and keeps the gradient at 50 % for reduced motion)
- [X] T049 [P] [US5] Create `app/slices/setup/theme/components/ui/{border-beam/BorderBeam,shimmer-button/ShimmerButton,marquee/Marquee,meteors/Meteors}.vue` (each + `index.ts`) from the fetched sources with `cn` from `#theme/utils`; `Meteors` colour from `var(--land-fx-from)` instead of slate, `count` default 6; `ShimmerButton` keeps the caller's background and radius; scoped keyframes kept (research R4)
- [X] T050 [US5] Add to `app/slices/common/assets/css/landing.css`: the `--land-fx-*` tokens with the defaults in `data-model.md`; `@theme inline { --animate-marquee: …; @keyframes land-marquee … }`; `[data-fx-paused] *, [data-fx-paused]::after { animation-play-state: paused !important }`; the `prefers-reduced-motion` block for `.land-fx` and `[class*="animate-"]`; `@media (hover: none)` rules hiding `.land-fx--pointer` and defining `.land-fx-once.is-in` (one-shot border highlight); the `.land-reveal--blur` transition on `[data-reveal]`
- [X] T051 [P] [US5] Create `app/slices/common/composables/useFxPause.ts`: `useFxPause(root)` → `IntersectionObserver` threshold 0.05 + `visibilitychange`; sets/removes `data-fx-paused`; pauses/unpauses every `svg` under root via `pauseAnimations()`/`unpauseAnimations()`; disconnects on unmount (research R5)
- [X] T052 [P] [US5] Create `app/slices/common/composables/useFxTokens.ts`: reads the numeric `--land-fx-*` tokens once on mount from `getComputedStyle(document.documentElement)` (`glowWidth`, `glowSpread`, `spotSize`, `beamSeconds`, `borderBeamSeconds`, `meteorCount`), exposes `reducedMotion` and `noHover` media flags that follow `change` events
- [X] T053 [US5] `cd app && npx nuxt prepare && grep -E "GlowingEffect|CardSpotlight|AnimatedBeam|BorderBeam|ShimmerButton|Marquee|Meteors" .nuxt/components.d.ts` (all seven registered, no prefix); `npx nuxt typecheck && bun run build`; commit `feat(theme): effect primitives for the landing — glow, spotlight, beams, shimmer, marquee, meteors (CLEAN-215)` **(Jira: primitives in, zero new dependencies)**

### Placements — one commit each, screenshots on the ticket, ⏸ wait for the OK before the next

- [X] T054 [US5] Hero Stage: in `app/slices/common/components/landing/hero/Stage.vue` add `<BorderBeam :duration="fx.borderBeamSeconds" color-from="var(--land-fx-from)" color-to="var(--land-fx-to)" :border-width="1.25" />` inside the panel, with a `useFxPause` root; commit `feat(common): border beam on the hero stage (CLEAN-215)`; `node E2E/shots.mjs --only landing --widths 1440,390 --out SHOTS/fx-1` **(Jira + ⏸ OK)**
- [X] T055 [US5] Capabilities: in `app/slices/common/components/landing/capabilities/Provider.vue` add `<GlowingEffect :proximity="64" :inactive-zone="0.4" :border-width="fx.glowWidth" :spread="fx.glowSpread" :disabled="fx.reducedMotion || fx.noHover" class="land-fx land-fx--pointer" />` to every card and `<CardSpotlight :gradient-size="fx.spotSize" gradient-color="var(--land-fx-spot-color)" :disabled="fx.reducedMotion || fx.noHover">` around the chat card only; cards get `land-fx-once`; commit `feat(common): glowing borders and chat spotlight on the capabilities bento (CLEAN-215)`; shots to `SHOTS/fx-2` **(Jira + ⏸ OK)**
- [X] T056 [US5] Steps: in `app/slices/common/components/landing/steps/Provider.vue` add refs on the three cards and two `<AnimatedBeam>` (Configure→Deploy, Deploy→Chat) with `:duration="fx.beamSeconds"`, token colours, `:static="fx.reducedMotion"`, started on the section's `is-in` and paused by `useFxPause`; commit `feat(common): beam across the steps (CLEAN-215)`; shots to `SHOTS/fx-3` **(Jira + ⏸ OK)**
- [X] T057 [US5] Runtime: in `app/slices/common/components/landing/runtime/Provider.vue` remove the existing dotted-line markup/CSS and add three `<AnimatedBeam>` between the four stages; sync the current-stage highlight to a timer of `fx.beamSeconds` per hop; `useFxPause` root with threshold 0.3 if Steps and Runtime are both ≥ 5 % visible at 1920×1080 (check first); commit `feat(common): beam through the runtime pipeline (CLEAN-215)`; shots to `SHOTS/fx-4` **(Jira + ⏸ OK)**
- [X] T058 [US5] Headings: add `land-reveal--blur` to the `h2`/eyebrow wrappers in the `steps`, `capabilities`, `runtime`, `cta` providers (never `hero`); commit `feat(common): blur reveal on section headings (CLEAN-215)`; shots to `SHOTS/fx-5` (mid-scroll capture at the Steps heading) **(Jira + ⏸ OK)**
- [X] T059 [US5] Primary button: wrap the `hero.cta_start` / `final.cta_start` pill(s) in `hero/Provider.vue` and `cta/Provider.vue` with `<ShimmerButton>` passing the existing background, radius `999px`, `shimmer-color="rgba(215,123,97,.35)"`, `shimmer-duration="var(--land-fx-shimmer-duration)"`; keep the `NuxtLink`/text semantics; commit `feat(common): shimmer on the primary call to action (CLEAN-215)`; shots to `SHOTS/fx-6` **(Jira + ⏸ OK)**
- [X] T060 [US5] Stack row: create `app/slices/common/components/landing/stack/Provider.vue` with `<Marquee pause-on-hover :repeat="3">` of five monochrome inline-SVG marks (Kubernetes, Argo Workflows, Docker, Socket.IO, Bridle — simple glyph + wordmark drawn in `currentColor`, no third-party logo files) and caption `stack.caption`; add `stack.caption: "Built on"` to `app/slices/common/i18n/locales/en.json`, run `bun run i18n:sync` (key + `CLAUDE_WORKSPACE_ID` verified), review the Russian; mount it in `app/slices/common/pages/index.vue` before `LandingCtaProvider`; `useFxPause` root; commit `feat(common): technology marquee before the call to action (CLEAN-215)`; shots to `SHOTS/fx-7` **(Jira + ⏸ OK)**
- [X] T061 [US5] CTA meteors: in `app/slices/common/components/landing/cta/Provider.vue` add `<Meteors v-if="!fx.reducedMotion" :count="fx.meteorCount" class="land-fx" aria-hidden="true" />` inside a `useFxPause` root; commit `feat(common): meteors in the closing call to action (CLEAN-215)`; shots to `SHOTS/fx-8` **(Jira + ⏸ OK)**

### P2 measurement and budget

- [X] T062 [US5] `cd app && bun run build && bun run preview`; `node E2E/measure.mjs --label P2`; `node E2E/measure.mjs --compare P0 P1 P2` → Performance `P2 ≥ P0` desktop and mobile, LCP element `img.land-atmo__img`, CLS 0, `P2 − P1` JS ≤ 30 720 B gzip; if a gate fails, find the effect by toggling each `useFxPause` root with a `data-fx-off` attribute and fix or drop it with the owner; commit `measurements/P2.json` **(Jira: P0/P1/P2 table)**
- [X] T063 [US5] `grep -nE "animation|transition" app/slices/setup/theme/components/ui/*/*.vue app/slices/common/assets/css/landing.css | grep -E "width|height|top|left|margin"` → nothing inside keyframes (FR-032); `node E2E/shots.mjs --only landing --reduced --out SHOTS/reduced` and `--touch --out SHOTS/touch`: no video element, no meteors, static beams, no spotlight/glow following the pointer, one-shot highlight on reveal

**Checkpoint**: effects complete, measured, approved section by section.

---

## Phase 8: Polish & cross-cutting

**Purpose**: the final evidence set, the gates, the PR and the ticket.

- [X] T064 Full screenshot set: `node E2E/shots.mjs --out SHOTS/final` (6 widths × landing, login, register, agents) and `--only session-ended --out SHOTS/P2`; byte-compare `SHOTS/P2/session-ended-*.png` with `SHOTS/P0/`; attach the 1440 and 390 landing/console/gate shots to CLEAN-215
- [X] T065 [P] Accessibility pass on the console and the gate with the Playwright MCP snapshot: Orbit nodes, hub, Drum listbox, view tabs, search, Sheet buttons and the gate form all reachable by Tab with visible focus and sensible names; no `aria-hidden` ancestor over a focusable element (SC-005)
- [X] T066 [P] Twin-console check written out: grep the symbols of research R13 in `admin/slices` (`LandingBrandLogo`, `useBrandFonts`, `useGateStage`, `AgentWorkspaceSheet`, `stop(`/`start(` in the agent store, `rounded-full` in the share panel) and paste the table with the "admin unchanged on purpose" statement into the PR body draft at `<scratch>/pr-body.md`
- [X] T067 Final gates: `cd app && npx nuxt typecheck && bun run build && bun test slices`; `cd .. && bun run i18n:check && bun run locale:check`; `git status --short` clean, `.specify/feature.json` untouched vs `main`, no generated SDK file modified
- [X] T068 Open the PR into `main` with `curl` against `https://api.github.com/repos/CleanSlice/ranch/pulls` (`GITHUB_TOKEN` from `.env.project`; body from `<scratch>/pr-body.md` via `--data-binary @file`): title `feat(app): console redesign — landing, session gate, orbit/drum console, effects layer (CLEAN-215)`; body: the P0/P1/P2 table, the chosen FR-010 variant, the twin statement, the commands run, links to the screenshot comments; no session URL anywhere
- [X] T069 Put the PR URL on CLEAN-215, move the issue to **In Testing** (transition 51); final Jira comment: what shipped, the numbers, what stays open (anything the owner deferred during the section approvals) **(Jira)**
- [ ] T070 After the owner's review and green CI: `gh pr merge <n> --merge` as the DREAM account (`gh api user` first), then watch the `Release Platform` Actions run for the push and report its conclusion on the ticket (CLAUDE.md merge and rollout rules)

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: T001 first; T002–T005 in parallel; T006–T007 any time; **T008 before any `app/` change** (the baseline is destroyed by Phase 2).
- **Phase 2 (Foundational)**: T009 → T010 → T011 → T012 → T013 → T014 → T015. Blocks every story.
- **Phase 3 (US1)**: after T015. T016–T019 parallel reviews, T020, then T021 → ⏸ T022 → T023.
- **Phase 4 (US2)**: after T015; independent of US1 (different slices) but its commit (T034) follows T023 to keep the brand → landing → console → gate history. T024 first (locale gate), T025–T027 parallel, T028–T031, T032 → T033 → T034.
- **Phase 5 (US3)**: after T015; T041 is the **last zone commit** and carries `app/i18n.sync.json`, so it follows T023 and T034.
- **Phase 6 (US4)**: after T034 (the Drum is in that commit).
- **Phase 7 (US5)**: T045 after T041 and T044 (all zones in, `git status` clean); T046–T049, T051–T052 parallel; T050 then T053; T054–T061 strictly sequential with an owner OK between each; T062–T063 last.
- **Phase 8**: after T063.

### Story dependencies

- US1 (landing) and US2 (console) share nothing but the brand zone.
- US3 (gate) reuses `LandingHeroAtmosphere`/`Constellation` from the landing zone → commit after T023.
- US4 (Drum) is code-complete in US2's commit; its phase is verification only.
- US5 touches only `common/components/landing/*`, `common/assets/css/landing.css`, two new composables and `setup/theme/components/ui/*`; it depends on US1's commit.

### Parallel opportunities

- Phase 1: T002, T003, T004, T005 (four separate scripts).
- Phase 3: T017, T018, T019 reviews.
- Phase 4: T025, T026, T027 tests; T030 review.
- Phase 5: T037, T038.
- Phase 7: T046, T047, T048, T049, T051, T052 (seven separate files).
- Phase 8: T065, T066.

Everything marked ⏸ waits on the owner: T022 (horizon pick) and the OK after each of T054–T061.

---

## Parallel example: Phase 7 primitives

```bash
# Six tasks, separate files, no shared state — write them together, then T050 (landing.css) and T053 (register + build + commit):
Task: "Create ui/glowing-effect/GlowingEffect.vue with the rAF tween (T046)"
Task: "Create ui/card-spotlight/CardSpotlight.vue (T047)"
Task: "Create ui/animated-beam/AnimatedBeam.vue with static prop and exposed svg (T048)"
Task: "Create ui/border-beam, ui/shimmer-button, ui/marquee, ui/meteors (T049)"
Task: "Create common/composables/useFxPause.ts (T051)"
Task: "Create common/composables/useFxTokens.ts (T052)"
```

---

## Implementation strategy

### MVP first (US1)

1. Phase 1 → Phase 2 (brand) → Phase 3 (landing, with the horizon pick).
2. **Stop and validate**: six-width shots vs the reference, reduced-motion run, Stage chat against a public agent.
3. The landing alone is a shippable PR if the owner wants it early; the old gate and console still work with the new header.

### Incremental delivery

1. US1 landing → US2 console (+ US4 Drum verification) → US3 gate = the full reference in four commits, `git status` clean.
2. P1 measurement, then US5 effects one section at a time behind the owner's OK.
3. P2, gates, PR.

### Notes

- Never edit the reference worktree; it is the comparison baseline until the PR merges.
- Shared stash stack: `git stash push -u -m "<tag>"`, apply by SHA, drop by tag (T015).
- `bun run i18n:sync` is only for new keys (T060); the reference's Russian gets a tone pass, not a rewrite.
- A Jira comment per **(Jira)** marker; screenshots attached where the task says so; no session links anywhere.
