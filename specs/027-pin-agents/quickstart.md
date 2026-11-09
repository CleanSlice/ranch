# Quickstart: Pin agents (CLEAN-216)

How to run, migrate, regenerate, gate and check the feature end to end. The
local stack is the one `specs/026-app-console-redesign/quickstart.md` set up;
this file only adds what this ticket needs.

## Prerequisites

- Branch `feat/CLEAN-216-pin-agents` (stacked on
  `feat/CLEAN-215-app-console-redesign`).
- Docker: `cd api && docker compose up -d postgres-local minio`.
- `.env.project` with `DATABASE_URL`, `RANCH_LOCAL_LOGIN` / `RANCH_LOCAL_PASS`
  (seeded Owner), Jira and GitHub keys. Never print it.
- The seed from the 026 run (21 agents, Owner user) already applied; re-run
  `seed.cjs` if the database was reset.

## 1. Migration

```bash
cd api
bun run generate                     # prisma-import + prisma generate (slice .prisma → schema.prisma)
DATABASE_URL="$(tr -d '\r' < ../.env.project | grep ^DATABASE_URL= | cut -d= -f2-)" \
  npx prisma migrate deploy          # applies 20261109120000_agent_pinned
```

Expected: `1 migration applied`, and `\d "Agent"` in psql shows `pinned |
boolean | not null default false`.

## 2. API build, swagger, SDKs

```bash
cd api && bun run build && bun run generate:swagger
cd ../app && bun run build:api
cd ../admin && bun run build:api
git diff --stat app/slices/setup/api admin/slices/setup/api   # only pinned-related hunks
```

If the diff carries other tickets' types, restore those files with
`git show HEAD:<path>` (CRLF: pipe through `sed 's/\r$//; s/$/\r/'`).

## 3. Run

```bash
# API (stop the previous one first — single process, memory note)
cd api && WORKFLOW_PROVIDER=mock node dist/main        # :3333
# App
cd app && npx nuxt dev --port 3000                     # never `bun run dev` (regenerates the SDK)
# Admin
cd admin && npx nuxt dev --port 3001
```

## 4. Gates

| Project | Command | Expectation |
|---|---|---|
| api | `NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/agent` | gateway + tool specs green, new cases included |
| api | `bun run build` | typecheck (no separate tsc bin) |
| app | `bun test slices` | `railOrder`, `orbitLayout` tests green |
| app | `npx nuxt typecheck` | clean (then revert any regenerated SDK noise) |
| app | `bun run i18n:check && bun run locale:check` | clean |
| admin | `bun test slices` | new `railOrder.test.ts` green |
| admin | `npx nuxt typecheck` | clean |

## 5. Browser checks

```bash
node specs/027-pin-agents/e2e/pin.mjs                    # app, Owner
node specs/027-pin-agents/e2e/pin.mjs --as user          # app, User (if seeded)
node specs/027-pin-agents/e2e/admin-pin.mjs              # admin
```

Each prints `ok` / `FAIL` lines and exits non-zero on any `FAIL`; screenshots
land in `specs/027-pin-agents/e2e/shots/` and go on the ticket.

## 6. Manual walk-through (what the ticket's reviewer does)

1. App, Owner: open any agent, press **Pin** on the sheet. The icon appears by
   the name; the rail row jumps to the top under the Ranch admin agent; Drum
   and Orbit show it first.
2. Reload: still pinned.
3. Admin: the same agent shows the pin in the header and the rail, first under
   Rancher. Press the pin button in the header: it unpins; back in the app,
   after the next poll (≤ 30 s) or a reload, the icon is gone.
4. Ranch admin chat: "pin <name>" → the reply confirms; the rail shows it on
   the next refresh. "unpin <name>" → gone.
5. Stop a pinned agent, start it again: the pin never changes, and the
   "Agent settings were updated, restart to apply" banner never appears for a
   pin.

## 7. Ticket and PR

- Comment on CLEAN-216 at the start (done) and the end, screenshots attached.
- Commits: `feat(api): pinned flag on the agent + pin_agent tool (CLEAN-216)`,
  `feat(app): pin agents in the sheet, rail, drum and orbit (CLEAN-216)`,
  `feat(admin): pin agents from the header and in the rail (CLEAN-216)`.
- PR into `main` after #176 merges (or against `feat/CLEAN-215-app-console-redesign`
  until then); the PR states the twin check: "agent slice changed in both
  consoles: app sheet/rail/drum/orbit, admin header/rail; ordering function
  and tests mirrored".
