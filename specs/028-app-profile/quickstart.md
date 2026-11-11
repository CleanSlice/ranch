# Quickstart: App profile page "Pass" (CLEAN-217)

## Prerequisites

- Branch `feat/CLEAN-217-app-profile` (stacked on
  `feat/CLEAN-215-app-console-redesign`).
- Local stack as in `specs/026-app-console-redesign/quickstart.md`: Docker
  (`postgres-local`, `minio`), API `node dist/main` on :3333 with
  `WORKFLOW_PROVIDER=mock`, seeded Owner in `.env.project`
  (`RANCH_LOCAL_LOGIN` / `RANCH_LOCAL_PASS`). The API needs no rebuild for
  this ticket. If the local database carries the CLEAN-216 migration, an API
  built from this branch still runs (an extra column is ignored).
- App: `cd app && npx nuxt dev --port 3000` (never `bun run dev`).

## Gates

| Where | Command | Expectation |
|---|---|---|
| app | `bun test slices` | `registryNumber`, `capabilities`, `slotScale` green, nothing else red |
| app | `npx nuxt typecheck` | 0 errors; revert SDK files if it regenerated them |
| app | `bun run build` | builds (stop the dev server's lock first if it complains) |
| root | `bun run i18n:sync` then `bun run i18n:check` | in sync |
| root | `bun run locale:check` | no findings |

## Browser checks

```bash
node specs/028-app-profile/e2e/profile.mjs          # all states, screenshots
node specs/026-app-console-redesign/e2e/console.mjs # workspace still behaves after the poll move
node specs/026-app-console-redesign/e2e/gate.mjs    # login / register untouched
```

Screenshots land in `specs/028-app-profile/e2e/shots/` (gitignored) and go on
the ticket.

## Manual walk-through

1. Sign in, click your name in the header: the pass shows your initials,
   name, role, registry number and "Active".
2. Copy the id: "Copied" for two seconds; paste it somewhere.
3. Compare the fleet stub with the agents page: same totals; stop an agent
   there and watch "running" drop here within 30 s.
4. Move the mouse over the pass: it tilts slightly. With reduced motion
   enabled in the OS it stays flat.
5. Narrow the window below 1024 px: one column, pass first.
6. Log out from the session row: same result as the header's Log out.
7. Open `/profile` signed out: login page, and back to the profile after
   signing in.

## Ticket and PR

Comments on CLEAN-217 at checkpoints with screenshots. Commits:
`refactor(agent): one fleet poll shared by the workspace (CLEAN-217)`,
`feat(profile): pass page for the signed-in user (CLEAN-217)`,
`feat(common): header pill to the profile, /profile behind sign-in (CLEAN-217)`.
PR against `feat/CLEAN-215-app-console-redesign` until #176 merges, then
`main`; the twin-console statement from research R6 goes in the body.
