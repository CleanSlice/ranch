# CLEAN-245 — evidence

Screenshots and checks of the three stories, taken with Playwright against a
local stack: the API and both consoles of this branch, a scratch Postgres
database, and agent runtimes with the model taken out (`runtime.mjs`). No
production system was touched to make this folder; the production checks are
on the ticket.

## What is here

| File | What it shows |
|---|---|
| `us1-replay.log.txt` | The runtime's own MCP module reconnecting to a server that answers 503 and comes back 12 s later (runtime branch, T017) |
| `us2-admin-connecting.png` | Admin chat while a tool server is still being tried: the line names the server and the attempt |
| `us2-admin-limited-chat.png` | Admin chat of an agent that runs without Documents |
| `us2-admin-limited-list.png` | The agent's Overview with the server's state, and the badge in the rail |
| `us2-admin-refused.png` | A server that refused the agent's credentials |
| `us2-app-user-starting.png`, `us2-app-user-limited.png` | What a User sees: plain words, no server name |
| `us2-share-limited.png` | What a share-link visitor sees |
| `us2-admin-cleared.png` | The line is gone once every server is connected |
| `us2-rancher-answer.png` | The Ranch agent answering "What is wrong with Front Desk?" from `get_agent_status` |
| `us2-admin-incident-open.png`, `us2-admin-incident-up.png` | The *Limited tools* incident on the Events page, and the same incident once the tools are back |
| `us3-admin-queued-3.png`, `us3-admin-full.png` | Three messages waiting; the fourth refused in words and left in the composer |
| `us3-admin-drained.png` | The same three, sent one per turn in the order shown |
| `us3-admin-during-answer.png` | Messages written while the agent answers |
| `us3-app-queued.png`, `us3-app-drained.png`, `us3-app-queued-400w.png` | The app console, a User; the last one 400 px wide |
| `us3-share-queued.png` | A visitor's queue on the share page |
| `us4-admin-reordered.png`, `us4-admin-menu.png`, `us4-admin-folded.png` | Reordering with the keyboard only (Alt+↑), the row menu, the folded panel |
| `us4-admin-edit-back.png` | A queued message taken back into the composer |
| `us4-admin-held-stopped.png` | A stopped agent: the queue is kept, nothing is sent |
| `us4-app-reordered.png` | Reordering by dragging the handle |
| `us4-app-held-stale.png` | Messages written two days ago wait for *Send now* |
| `us4-app-blocked.png` | A message whose file the server no longer has: it stays, marked, and the one behind it went |
| `compat-old-runtime.png` | A runtime that reports no tool state (0.39): no tool line, the queue works |

Viewport 1440×900; `…-400w.png` is 400×800.

## How it is produced

```sh
# 1. a scratch database whose name contains "e2e", migrated
# 2. the API of this branch on :3345 with that DATABASE_URL and
#    TOOLS_LIMITED_ALERT_MS=60000 (so the incident opens in a minute)
# 3. both consoles: API_URL=http://localhost:3345 bunx nuxt dev --port 3105 (admin) / 3104 (app)
# 4. with the API's environment (JWT_SECRET, BRIDLE_API_KEY, DATABASE_URL):
node runtime.mjs &                 # the agents' runtimes, control port :3346
PLAYWRIGHT_CORE=<dir with playwright-core> CHROME=<chromium binary> \
  node shots.mjs all               # or: us2 | us2ops | us3 | us4 | compat
```

`playwright-core` is not a dependency of this repository: `PLAYWRIGHT_CORE`
points at any directory that has it installed. `lib.mjs` refuses to run
against anything but a local API and a database with "e2e" in its name: the
seed writes accounts and agents. Secrets come from the environment and are
never printed.

`shots.mjs` is checks first and pictures second: every scene asserts what the
picture is meant to show (what reached the agent, in which order, how many
times; what a User's page, its responses and its socket frames contain) and
exits non-zero on a failure. The last full run: 60 checks, none failed.

## What is and is not real

- The consoles, the API, the hub, the database, the incident machinery and
  `get_agent_status` are the code of this branch.
- The runtimes are scripts. They sign in to the hub as the agent, send the
  `tool_state` report runtime 0.40 sends, and answer `echo: <text>`. The
  reconnecting itself is shown by `us1-replay.log.txt`, not here.
- The Ranch agent's answer is the real result of the real tool, called over
  MCP as the agent for the person of the turn; the sentence around it is
  written by the script, because there is no model on this stack.
- `us4-app-held-stale` sets `queuedAt` back two days in `localStorage`;
  `us4-app-blocked` gives a queued message an attachment id the server does
  not have, so the hub's own `ATTACHMENT_FAILED` marks it.
- The incident is shown opening and marked up. Its closing after the quiet
  window is the existing incident sweep and is not waited for.
- The accounts (`owner@e2e.test`, `user@e2e.test`) exist in the scratch
  database only.
- There is no Kubernetes behind this stack: the admin *Logs* bar says "Log
  fetch failed" in every admin picture, and `pod`/`metrics` are `null` in the
  tool's result. `us2-app-user-starting` shows the deploy overlay of before
  this work above the new line.
