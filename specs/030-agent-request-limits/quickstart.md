# Quickstart: proving request limits end to end

How to bring the feature up locally and run the checks that make it "done"
(FR-038 to FR-042). Commands are from the repository root unless a `cd` says
otherwise.

## 1. Prerequisites

- Docker Desktop running (Postgres for the local stack).
- The local stack of `specs/026-app-console-redesign/quickstart.md`: API on
  `:3333`, app on `:3000`, admin on `:3001`, seeded Owner login in
  `.env.project`.
- playwright-core available to the e2e helpers, as described at the top of
  `specs/026-app-console-redesign/e2e/lib.mjs`.

Starting Postgres from a worktree recreates the shared `ranch-postgres`
container on this checkout's empty data directory. Nothing is lost; the usual
`docker compose up` in the main checkout switches it back.

## 2. Bring it up

```bash
cd api
docker compose up -d postgres-local
bun run generate                 # prisma-import + client, picks up agentLimit.prisma
npx prisma migrate deploy
bun run build && bun run generate:swagger
cd ../admin && bun run build:api
cd ../app && bun run build:api
```

Seed, then start the API (the seed must run first: the hour and day scenarios
rely on the API rebuilding its counters from the rows it finds at boot):

```bash
node specs/030-agent-request-limits/e2e/seed.mjs      # agents + limits + backdated load rows
cd api && PORT=3333 node dist/main                     # background
node specs/030-agent-request-limits/e2e/fakeAgent.mjs  # background: answers for the seeded agents
cd admin && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3000
```

What the seed creates (names are what the scripts look up):

| Agent | Visibility | Limits | Seeded load | Used for |
|-------|-----------|--------|-------------|----------|
| `limits-minute` | public, landing origin allowed | 2 / minute | none | refusal, countdown, reload, two tabs, second refusal |
| `limits-hour` | public | 5 / hour | 5 accepted, the oldest leaving in ~90 s | notice on opening, clearing when the limit is raised |
| `limits-day` | public | 3 / day | 3 accepted ~21 h ago | long-wait wording, "tomorrow after" with the page clock |
| `limits-off` | private | none | none | nothing is ever refused |
| `limits-legacy` | public | none | none | "public without limits" mark, save rules |
| `limits-share` | private, share link | none | none | share page, share warning |

## 3. Fast checks (no browser)

```bash
cd api
NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/limit src/slices/bridle
npx eslint --quiet src/slices/agent/limit src/slices/bridle
bun run build
cd ../admin && bun test slices && npx nuxt typecheck
cd ../app   && bun test slices && npx nuxt typecheck && bun run locale:check
```

Never `bun run test` in `api/` while the dev API is up — it regenerates the
Prisma client under the running process.

## 4. Browser checks

One command runs everything and exits non-zero on any `FAIL`:

```bash
node specs/030-agent-request-limits/e2e/all.mjs
```

It runs these in order; each can be run alone:

| Script | Proves |
|--------|--------|
| `e2e/notice.mjs` | landing chat on `limits-minute`: third send refused; notice text and time; text kept; nothing added to the conversation; no typing dots; Send off and described; Enter nudges; composer still editable; reload and second tab show the remaining wait; countdown reaches `ready`, nothing is sent by itself, one press delivers; a second refusal after the wait returns the notice |
| `e2e/notice-app.mjs` | the same core on the app console chat as a signed-in User, in English and in Russian |
| `e2e/notice-share.mjs` | the same core on the share page of `limits-share` after limits are set on it |
| `e2e/notice-long.mjs` | `limits-hour`: notice present on opening, before typing; leaves without a reload when the limit is raised. `limits-day`: "Try again after HH:MM"; with the page clock at 23:00, "tomorrow after" |
| `e2e/operator.mjs` | admin chat with `limits-hour` at its limit: the Owner's message goes through, the operator's line is shown |
| `e2e/settings.mjs` | "Visibility & embed": private → public without a limit refused in one save; with a limit saved; switching limits off on a public agent refused; contradictory windows refused; `limits-legacy` marked and renamable; share warning on `limits-share` |
| `e2e/load.mjs` | load view: a burst from a second context moves the meters and the chart within 5 s; refused count and "in progress" change; `limits-off` shows load with no ceiling and refuses nothing |
| `e2e/http.mjs` | `POST …/message` and `/message/sync`: 429 with `Retry-After` at once; `X-RateLimit-*` only with a credential |

Screenshots land in `specs/030-agent-request-limits/e2e/shots/` and go on the
ticket. Budget: the whole run under 10 minutes; the only real waits are one
minute window in `notice.mjs` and ~90 s in `notice-long.mjs`.

`all.mjs` re-seeds between scripts that would otherwise inherit a full
window; re-seeding the hour and day agents needs an API restart, which
`all.mjs` does itself and which doubles as the restart-survival check: the day
figure in `load.mjs` is compared before and after.

## 5. Widget (in `CleanSlice/bridle`)

```bash
cd sdk && npm ci && npm test && npm run build
```

Then one browser check: `example/` pointed at the local API and the locally
built bundle, agent `limits-minute` — third message shows the notice above the
composer, the text is kept, the host page's `limit` event fires, the message
goes through after the wait. After release and site deploy, the same page
against `https://bridle.cleanslice.org/sdk/latest.js`, and `Bridle.version`
reads `0.16.0`.

Old-widget fallback: the same page against the published `v0.13.3.js` — the
third message gets "This agent has reached its message limit. Try again in
about …" as a line in the conversation and the typing dots stop.

## 6. Manual walk-through (what a reviewer does)

1. Admin → an agent → "Visibility & embed": switch to Public, press Save with
   empty limits — refused, fields highlighted. Enter 3 / minute, Save.
2. Open the landing page in a private window, pick that agent, send four
   messages quickly. The fourth stays in the field; the notice says the agent
   has reached its message limit and counts down. Keep typing — allowed.
   Press Enter — the notice nudges.
3. Wait. "You can send your message now." Press Send — delivered.
4. Admin → the agent's load view while repeating step 2 from another window:
   meters and chart move, refused count rises.
5. Ranch admin chat: "what are the limits on <name> and how loaded is it?",
   then "remove the limits on <name>" — refused while it is public.
