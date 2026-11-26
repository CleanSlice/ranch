# Quickstart: proving the launch steps

Commands are from the repository root unless a `cd` says otherwise. Hooks
named here are in [contracts/launch-ui.md](./contracts/launch-ui.md).

## 1. Prerequisites

- Docker Desktop running; `cd api && docker compose up -d postgres-local &&
  npx prisma migrate deploy`.
- `bun install` at the root; `cd api && bun run generate && bun run build`
  (the build also typechecks the API and rewrites `swagger-spec.json`).
- `cd admin && bun run build:api && npx nuxt prepare`, the same in `app`.
  Check `git status` afterwards: the regenerated SDK may carry types of older
  tickets; only the `launchContext` change belongs to this one.
- `playwright-core` as for the earlier features (`PLAYWRIGHT_DIR`).

## 2. Fast checks (no browser)

```bash
cd admin && bun test slices          # launchSteps + existing
cd app   && bun test slices          # launchSteps + existing
bun run test:scripts                 # twins identical, no DSN, existing checks
bun run locale:check
cd admin && npx nuxt typecheck
cd app   && npx nuxt typecheck
cd api   && npx jest agentDeploy     # launchContext: initial / start / restart
```

Never Prettier or ESLint over `admin/` or `app/`. Run jest directly, not
`bun run test`, while a dev API is up.

Expected: all green; `launchSteps.test.ts` covers every row of research R5.

## 3. Bring the consoles up

```bash
cd admin && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3000
```

The runner in §4 seeds and starts the API and the fake agents itself.

## 4. Browser checks

```bash
node specs/037-agent-launch-steps/e2e/all.mjs
```

Each scenario runs in `admin` and in `app`, at 390 px and 1440 px, in light
and dark, and fails on any console error or failed request.

| Scenario | How | Expected |
|---|---|---|
| Restart, every stage | scripted stream frames (research R9) | rows `accepted → stopped → scheduled → container → online → ready` turn `done` in order; overlay clears after the hold |
| Start of a stopped agent | scripted | same without a `stopped` row; `data-launch="start"` |
| First start | scripted | `data-launch="initial"`, first-start wording |
| Reload mid-launch | reload at `container` | list reaches `container` as current within 2 s, earlier rows `done` |
| Failure | frame with `ImagePullBackOff`, then `status: failed` | `container` is `failed`, reason shown as received, `retry` and `logs` present for a manager, absent for a plain user |
| Stream drops | close the scripted stream | `data-launch-stale` present, rows keep their state; reopening catches up |
| Stopped during launch | `status: stopped` | no failed row; the existing `stopped` overlay |
| Second restart | restart again at `online` | list starts over from `accepted` |
| Russian (`app`) | language set to `ru` | step text in Russian, failure reason untouched |
| Reduced motion | `reducedMotion: 'reduce'` | rows change state with no transition |
| Composer stays free | type during a launch | the message is queued, the overlay does not cover the composer |
| Real restart, nothing mocked | press Restart on a fake agent | `accepted` then `online` and `ready`; the overlay clears when the chat answers |

Screenshots go to the scratchpad, never into the repo.

## 5. After the merge

The pod-by-pod rows are only real on a cluster. Once the release has rolled
out, restart one agent on dev and compare the rows with `kubectl get pod -w`
for the same agent; then take the timings for the "taking longer" budgets
(research R8).
