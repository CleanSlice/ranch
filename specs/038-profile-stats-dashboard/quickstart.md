# Quickstart: proving it works

Contracts: [api](./contracts/api.md) · [collection](./contracts/collection.md) · [ui](./contracts/ui.md) · [judgments](./contracts/summary-judgments.md). Shapes: [data-model](./data-model.md).

Sections follow the delivery order of [plan.md](./plan.md): 1 can be run after the first PR, 2 after the second, and so on.

## Prerequisites

- Local stack as in the worktree setup notes: `bun install`, `cd api && bun run generate && bun run build`, Postgres up (`postgres-local`) on a database whose name contains "e2e", seed, API on its port, MinIO for transcripts, `cd app && npx nuxt prepare`. Ask before starting Docker.
- Agents answered by the scripted runtime: `node specs/035-tool-reconnect-chat-queue/evidence/runtime.mjs` (it takes the API's environment plus `E2E_API`, `E2E_APP`, `E2E_CONTROL`).
- Three accounts: an Owner, an Admin limited to two agents, and a User who reaches three agents.
- `CHAT_INSIGHT_INTERVAL_SEC=60` and an active Anthropic credential for sections 3 and 6; unset for the "summaries off" checks.
- Scripts in `specs/038-profile-stats-dashboard/e2e/`:
  - `seed-history.mjs --user <id> --days 120`: real conversations with transcripts in MinIO spread over the days, some closed with New chat, plus ratings, citations and one hand-over. Prints the expected figures for 7, 30 and 90 days as JSON: the independent recount.
  - `seed-volume.mjs --conversations 1000000 --heavy-user <id>`: index and hour rows only, no transcripts, for timing.
  - `replay.mjs`: sends a fixed set of `session_activity` events to the agent socket and checks the hour rows against the lifetime totals; `--twice` sends each event twice in a row, as a retry would; `--concurrent` sends two different events for one conversation together.

## Automated

```bash
# api: jest directly, never `bun run test` while a dev API is up
cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/stats src/slices/chat src/slices/usage src/slices/agent/limit src/slices/mcp/toolReach.spec.ts && bun run build

# app
cd ../app && bun test slices/profile slices/common && npx nuxt typecheck

# repo
cd .. && bun run locale:check && bun run i18n:check && bun run test:scripts
```

Expected: all green. After `nuxt typecheck`, restore generated SDK files it rewrote beyond the hunks of this feature. Before each PR the whole api suite runs once (`npx jest` with no path); CI runs everything.

## 1. Collection (Story 2)

1. **Counted once (SC-004).** `replay.mjs`, then on a clean database `replay.mjs --twice`: `ChatActivityHour` is the same in both; for every conversation `sum(userMessages)` equals `userMessageCount`. `replay.mjs --concurrent`: both events are counted.
2. **Settle pass.** Stop the API, write three messages straight into a transcript in MinIO with timestamps in two different hours, set that conversation's `lastMessageAt` two hours back, start the API with `STATS_SETTLE_INTERVAL_SEC=10`. Within a run the two hours hold the transcript's counts and `activityRebuiltAt` is set. Let it run again: no row changes.
3. **Never lowers.** Replace the same transcript with a shorter one (a `summary` marker and the last message), touch `lastMessageAt`: after the next run the hours are unchanged.
4. **History on upgrade (SC-005).** `seed-history.mjs`, then `TRUNCATE "ChatActivityHour"` and null every `activityRebuiltAt`, start the API: when the pass has gone through, the table equals the script's expected JSON for every day of the last 120.
5. **Recording cannot hurt (SC-011).** In a spec, make the hour write throw: the handler logs one warning, the lifetime totals roll back with it, nothing reaches the caller, and the next settle pass restores both. On the stack, time 50 messages on this branch and on `main`: no difference beyond noise.
6. **Refusals by day.** Give an agent a limit of 2 a minute, send 10: `AgentLoadDay.refused` for today equals the sum of today's minute rows. Restart the API: unchanged.
7. **Spend survives (Story 2, scenario 6).** Report usage for an agent for yesterday, delete the agent: `GET /usage/overview` as the Owner still has yesterday's tokens under the agent's name; as the limited Admin it does not.
8. **Completeness.** `StatFigure` has one row per registered figure; restart: no row changed.

## 2. Personal statistics (Stories 1 and 5)

1. **Truth (SC-001).** After `seed-history.mjs`, as the User: `GET /me/stats?period=7|30|90&tz=Europe/Kyiv` equals the script's expected JSON, field by field. Repeat with `tz=America/Los_Angeles`: the days move, the totals of a period ending now do not.
2. **The page.** Open `/profile`: Statistics is selected, 30 days. Switch to 7 and 90: every block follows and the address changes; Back returns to the previous period. Reload on `?period=90`: 90 is selected.
3. **Account tab.** The account, capabilities and session cards are as on `main`: compare with a screenshot taken before the change.
4. **Activity.** Today is outlined, days outside the period are dimmed, the busiest weekday is highlighted and named. Table view lists the same days. Send a message now: within 5 minutes of a reload today's cell and the scoreboard have it (SC-003).
5. **Agents.** Selecting an agent in the list selects it in the orbit and the reverse. With one agent only, the orbit shows one node on the inner ring.
6. **Help and models.** Get one cited answer, one hand-over, rate one answer up and one down: the three tiles move by exactly that. Change an agent's model, report usage for both days, write on both: the model card splits the messages by day; with no usage row for a day, the fallback line appears.
7. **Access taken away.** Remove one agent from the User's access: its conversations leave every figure and "out of N" drops by one. Give it back: they return.
8. **New person.** A User with no conversations sees the one explanatory card with a link to the agents.
9. **Nobody else's (SC-006).** As the Admin, no parameter of `GET /me/stats` returns the User's figures; `scope=installation` in the address as a User opens "My conversations".
10. **The tool.** As the User, ask the Ranch assistant "how many conversations did I have this month": the answer is the scoreboard's number.

## 3. Topics, outcomes, open questions (Story 3)

1. Hold four conversations of four messages each on two subjects with one agent, close each with New chat within the hour, leave one clearly unanswered. After the batch: two topics, each once; the unanswered one under Open questions; the closed conversations have summaries although they were archived before their quiet hour passed.
2. **Continue** opens that agent on that conversation.
3. End one conversation mid-thought: its outcome is "unclear", it is in neither the resolved share nor Open questions.
4. Continue a resolved conversation with a new unanswered question; after the next batch it has moved to open.
5. A conversation of two messages is named as too short, not as waiting.
6. Unset `CHAT_INSIGHT_INTERVAL_SEC`, restart: blocks 4 to 6 are one card, worded for a User and differently for the Owner; the scoreboard's fourth tile shows a dash.
7. Topic labels follow the console language: switch to Russian, the labels are Russian; the questions stay as written.
8. An existing version 1 summary active in the last 180 days is replaced by a version 2 one within the batch's cap.

## 4. Installation view (Story 4)

1. As the Owner, switch to "Whole installation" for 30 days: tokens, calls and cost equal `GET /usage/overview`'s totals and the admin console's Usage page.
2. 7 and 90 days: every block answers, with comparisons.
3. Report usage for a model missing from the price list: it is marked "no price" in the legend and in its agent's row, with tokens, and the total says it excludes it.
4. As the limited Admin: every figure covers the two agents, the scope line says so; the Owner sees more.
5. Open an incident and let it close; cause refusals: Health lists both; with none, one line each.
6. Where people are unhappy: the highest share of thumbs-down ratings is marked; the open-share column holds a dash, with one line under the table saying it is not counted yet. PR 3 restores the open share, and the mark on the worst one with it.
7. As the User: no switch; `GET /stats/installation` answers 403; the tool `get_installation_stats`, called as the Ranch admin agent answering the User, is refused.

## 5. Timing (SC-002)

`seed-volume.mjs --conversations 10000`, measure `GET /me/stats?period=90` for the heavy user and `GET /stats/installation` for 7, 30 and 90 days as the Owner, median. Repeat with `--conversations 1000000`. Write the numbers into the PR.

The criterion is read per route, because the two routes grow with different things ([research.md](./research.md) R9):

- **`GET /me/stats`**: under 2 seconds, and the larger run within 20% of the smaller. Its queries are bounded by one person's rows. Measured in PR 2: 157 ms with 15 120 conversations in the installation, 139 ms with 1 005 120.
- **`GET /stats/installation`**: under 2 seconds at a million conversations. The 20% half does not apply to it: people and conversations are distinct counts over the period, a distinct count cannot be added up from per-day rows (a conversation active on two days would count twice), so the route's time follows the conversations of the period. Measured in PR 4, medians of 40 calls: 6, 7 and 10 ms for 7, 30 and 90 days at 15 278 conversations; 30, 90 and 700 ms at 1 005 120, the slowest call 1.6 s.

Call the installation route at least ten times per period before reading a time. Its statements are prepared once per connection, and from the sixth execution Postgres may replace the plan made for the dates asked with one kept for any dates. It did here, and both statements went from 0.6 s to 5.5 s. Five calls, or one `EXPLAIN`, never see it.

If the installation route misses the 2 seconds on a larger installation, the step is the covering partial index named in R9, measured before it is kept.

## 6. Calibration (`T-CAL`, constitution Principle VII)

1. Export 100 summarised conversations from our own installation through the read-only account (ids, transcripts). The export stays out of the repo.
2. A person labels each with a subject and with resolved, open or cannot tell, in a CSV next to the export.
3. `bun api/scripts/summary-calibration.ts --sample <dir>` runs the version 2 prompt over the sample in the batch's order with an empty vocabulary and prints the eight numbers [contracts/summary-judgments.md](./contracts/summary-judgments.md) names.
4. Targets: same-subject agreement 90%, precision of `open` 80%. Under either, revise the prompt and rerun. Write the final numbers, the date and any changed target with its reason into the Results section of that file.

Story 3 is not merged before this section has a result.

## 7. Adding a figure (SC-007)

During acceptance of the second PR, add a trial figure on a scratch branch: "answers per conversation hour" needs nothing new recorded, so it is one definition file and one DTO field. The diff contains no line of an existing recorder or definition, and the figure answers for 90 days at once. Discard the branch.

## 8. Browser evidence

Sections 2 to 4 are driven through Playwright at 390 px and at 1440 px as the User, the Admin and the Owner, in English and in Russian, with console errors and failed requests read, and compared block by block with `reference/profile-stats-prototype.html` opened beside it; differences other than the departures listed in [contracts/ui.md](./contracts/ui.md) are fixed or listed. Screenshots stay in the scratchpad, never in the repo; the result goes on the ticket in one line.
