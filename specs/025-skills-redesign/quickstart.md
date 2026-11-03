# Quickstart: verify the Skills library redesign (CLEAN-205)

How to run the feature and prove the spec's scenarios. Contracts: [skills-api.md](./contracts/skills-api.md), [skills-ui.md](./contracts/skills-ui.md), [agent-tools.md](./contracts/agent-tools.md). Data: [data-model.md](./data-model.md).

## Prerequisites

- Worktree on `feat/CLEAN-205-skills-redesign`, `bun install` done at the root.
- Local Postgres from the repo's compose (`postgres-local`), `.env.dev` in `api/`.
- Fresh worktree: `cd api && bun run generate` before anything that imports `@prisma/client`.

## Build and regenerate

```bash
cd api && bun run generate && bun run migrate      # applies 20261103120000_skill_library_order
bun run build && bun run generate:swagger          # typecheck + api/swagger-spec.json
cd ../admin && bun run build:api                   # regenerate the SDK (SkillGroup union, new endpoints)
```

Check the migration backfilled: `SELECT name, "sortOrder", "tokenEstimate" FROM "Skill" ORDER BY "sortOrder";` — contiguous order, non-zero estimates for non-empty bodies.

## Unit tests

```bash
cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/skill src/slices/rancher/rancher.tool.spec.ts
cd admin && bun test slices/skill
```

Expected: tokens, order service (hash, 409, permutation, reorderByNames), name-available, both tool specs; admin slugify / reorder / editTime / summary / activity / tokens all green. Never `bun run test` in `api` while a dev API is running.

## Static gates

```bash
cd api && npx eslint --quiet src/slices/skill src/slices/rancher/rancher.tool.ts
cd admin && npx nuxt typecheck
cd .. && bun run locale:check
```

If `app/slices/setup/api` shows as modified after the admin typecheck and `app` needed nothing, restore it: `MSYS_NO_PATHCONV=1 git show "HEAD:app/slices/setup/api/data/repositories/api/<file>" > <same path>`.

## Run

```bash
bun run dev:api      # :4000
bun run dev:admin    # :3001
```

Seed a few skills if the library is empty (New skill or Import from GitHub).

## Manual walkthrough (maps to spec user stories)

1. **US1 — library**: open `/skills`. Summary shows count, `≈ <n>k tokens`, edited this week with "last … ago", not-used count with slugs. Strip has one segment per skill; hover reads `<slug>, 1.7k tokens`; click selects. Type in search → list narrows after a pause and `?q=` appears. Pick a group chip → `?group=`. Switch to Recently edited → `?sort=recent`, handles disabled with the hint. Click a row → highlight, `?skill=<slug>`, panel shows path + Copy path ("Copied" for 2 s), Tokens with `% of library`, Files, Created, description, template chips linking to `/templates/:id`, Activity. Copy the URL into a new tab → same state.
2. **US2 — order**: in Custom order drag a row (translucent row, 3 px line), drop → badges `↑n` / `↓n`, bar `List order changed: n positions moved`. Discard → back. Drag again, Save order → toast `Order saved`; reload in another browser/profile → same order. Keyboard: Tab to a handle, ↑/↓ → row moves, live region text `<slug> moved to position x of n`. Filter to a group, move one visible row, Save → the hidden rows kept their places (compare `GET /skills/order` before/after). Concurrency: save from tab A, then save a stale draft from tab B → tab B reloads and shows `Someone else changed the order…`. Failure: block `PATCH /skills/order` in devtools → order rolls back, toast `Could not save the order`. Leave with a pending draft → confirmation.
3. **US3 — form**: `/skills/create`. Title `DevOps Engineer!` → slug `devops-engineer`, hint `Folder: .agent/skills/devops-engineer/`. Edit the slug by hand, change the title → slug stays. Type a taken name → `This name is taken`, Create disabled. Description past 140 → red counter + hint. Body → `n lines · ≈ m tokens`, row preview and rendered markdown update. Close the tab, reopen → draft restored, `Draft · edited …`. Ctrl/Cmd+S → created, redirected to `/skills?skill=devops-engineer`, toast; draft gone. Edit a skill, change its slug → rename warning; Save changes → existing redeploy dialog still appears.
4. **US4 — widths**: devtools device toolbar at 1440 / 1280 (column, sticky, own scroll), 1024 / 768 (drawer `min(420px, 90vw)`, Esc / backdrop / × / Back close it, focus returns to the row), 390 (cards, ⋯ menu 44×44, bottom sheet with handle closable by swipe/button, 2×2 summary, chips scroll, sort select, Reorder button → handles + pinned Cancel / Save order). At every width `document.documentElement.scrollWidth === clientWidth`; with the panel open the list is ≥ 560 px. Enable "Emulate prefers-reduced-motion" → no slide animations.
5. **US5 — delete**: select a skill in two templates → Delete → `Delete <slug>? It is removed from A and B.` → Keep leaves it; Delete removes it and selects the neighbour; the templates page no longer lists it. Delete the only skill → empty state with New skill / Import from GitHub.
6. **States**: throttle network → skeletons (summary + 6 rows); block `GET /skills` → error + Retry; search gibberish → `No skills match` + Clear search and filters.
7. **Agent tools**: in the Rancher chat Tools panel, topic Skills lists `reorder_skills`; "Put mazda-year-resolution first" reorders the library and the page shows it after refresh; "Set the group of alm-api to API" uses `update_skill` with `group`. Confirm no agent restarted and no template changed.

## E2E scripts

```bash
# once, outside the repo: mkdir ~/pw && cd ~/pw && bun init -y && bun add playwright-core
PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/reorder.mjs
PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/drawer.mjs     # 1024 px
PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/sheet.mjs      # 390 px
PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/form.mjs
```

Each prints `PASS` / `FAIL` lines and exits non-zero on any failure; paste the output into the PR. Credentials come from `RANCH_LOGIN` / `RANCH_PASS` in `.env.project` as in CLEAN-102's `lib.mjs`.

## Done when (from the spec)

- SC-001 order identical for every user after reload; `GET /templates` and each agent's mounted skills unchanged before/after.
- SC-002 no horizontal scroll at 390 / 768 / 1024 / 1280 / 1440; list ≥ 560 px with the panel open.
- SC-006 the PR lists what is hidden for lack of backend support: the five-event Activity history (no audit log) — everything else is backed.
- SC-007 unit tests and the four e2e scripts pass; SC-008 the a11y check (contrast, names) is clean.
