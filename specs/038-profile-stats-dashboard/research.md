# Research: Profile statistics dashboard

**Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

What had to be found out before the design, what was decided, and what was
turned down. Code references are to `main` at `v0.3.105`.

## R1. Where a person's messages per day come from

**Found.** A conversation is one `ChatSession` row per agent and person until
the person presses New chat (`archiveSession` moves the row to an archived
key). `messageCount` / `userMessageCount` are lifetime totals. The live path
is `session_activity` on the agent socket → `IChatGateway.recordActivity`
(`api/src/slices/chat/data/chat.gateway.ts`): one atomic `updateMany` that
increments the totals and refuses a repeated `eventId`. Each event carries
`ts` (unix ms), `role`, `channel`, `externalUserId`. Nothing keeps the time
of a message outside the transcript in S3.

**Decision.** A new table `ChatActivityHour`: one row per conversation and
UTC hour with `userMessages` and `agentMessages`, written in the same
transaction as the lifetime increment and only when that increment applied.

**Rationale.** The hourly row inherits the existing dedup exactly: an event
that does not move the lifetime total does not move the hour either, so the
two can never disagree about what was counted. Keying by conversation makes a
rebuild from one transcript a statement about that conversation's rows only,
and makes "conversations a person wrote in during a period" a distinct count
rather than a second figure to keep. `agentId`, `channel` and
`externalUserId` are copied onto the row so both scopes read one index range
without a join.

**Alternatives considered.**
- *Count from `ChatSession` on read* — impossible for messages (lifetime
  totals) and wrong for conversations in the previous period.
- *A generic `metric, dimension, bucket, value` ledger for every figure* —
  uniform, but ratings can be changed and withdrawn and citations and
  hand-overs already exist as one durable row per event; copying them into
  counters creates a second truth that has to be kept equal to the first.
  See R4.
- *Daily rows* — cannot serve the viewer's own day boundary (R3).

## R2. Filling the past, and recovering what the live path missed

**Found.** `ChatSyncService` rebuilds the index from transcripts, but only on
demand or when `CHAT_SYNC_INTERVAL_SEC` is set, and neither manifest set
(`k8s/deploy`, `k8s/platform`) sets it. Compaction shortens a transcript and
leaves a `summary` marker, which is why the lifetime totals are "raised,
never lowered" on reconcile. `TranscriptReaderService.read` returns `ts` per
message.

**Decision.** One mechanism, the *settle pass*, in the `chat` slice: every
5 minutes it takes up to 100 conversations that have been quiet for an hour
and are due (`activityRebuiltAt` is null: never read, or written in since,
because every write that moves a conversation on clears the stamp), reads
each transcript once, buckets the user and assistant messages by hour with
the same reader options the reconcile uses, and raises each hour to the
transcript's count where it is higher. It never lowers. Newest first, limited
to conversations active in the last 180 days. It runs by default and needs no
setting; `STATS_SETTLE_INTERVAL_SEC=0` turns it off.

**Rationale.** Upgrade backfill, recovery after a restart and "a new figure
gets its past" are the same operation, so they get one code path and one
test. `max()` is idempotent: running it twice changes nothing (SC-004).
Raise-only is the rule the lifetime totals already follow for the same
reason. One read per conversation per quiet period bounds the S3 traffic by
activity, not by history.

**Why these numbers.** 100 transcripts read one after another take about
10 to 20 seconds, which leaves the single API process free; at 5 minutes that
is 28 800 a day, so 100 000 conversations of history fill in about three and
a half days while live figures are already right. One hour quiet is the
cooldown the summary batch already uses, so both read a conversation at the
same point in its life. 180 days is the 90-day period and its predecessor.

**Alternatives considered.**
- *Switch `CHAT_SYNC_INTERVAL_SEC` on in production* — re-reads every active
  transcript on every tick and needs a manual apply of `k8s/deploy`.
- *A one-off migration script* — does nothing for the next restart and
  nothing for the next figure.

## R3. Whose day

**Found.** The admin console renders browser-local time. Usage is stored by
the UTC start of the date the agent reports. Limit refusals are stored per
UTC minute.

**Decision.** Personal figures are cut on the viewer's days: the browser
sends its IANA zone, the API validates it and buckets the person's hourly
rows into local days in a pure function. Every installation figure is cut on
UTC days, the same boundary spend already has, and the installation view says
so once. A zone the API does not know falls back to UTC.

**Rationale.** A person's hourly rows for 13 weeks are a few hundred to a few
thousand, so bucketing in code is cheap, testable across DST and needs no
database time-zone arithmetic. An installation is seen by people in several
zones; one fixed boundary is the only one on which two administrators see the
same number, and it is the one spend cannot leave.

**Known limit.** Zones with a half-hour or 45-minute offset get their days
cut at the nearest whole hour. Stated in the spec's assumptions. Quarter-hour
rows would remove it at up to four times the rows; not justified by a
customer today.

## R4. Figures that are already recorded per event

**Found.** Ratings (`ChatFeedback`, by `authorId`), citations
(`ChatMessageSource`, by `clientId`), hand-overs (`AgentDelegation`, by
`clientId`, with `status`), incidents (`AgentIncident`, with `openedAt` /
`closedAt` and the agent's name kept) and spend (`Usage`, by agent, model and
day) each exist as one durable row per event or per day.

**Decision.** They are read where they are, by an indexed time range. No
copy. The missing indexes are added: `ChatFeedback(authorId, createdAt)` and
`(createdAt)`, `ChatMessageSource(clientId, createdAt)`,
`AgentDelegation(clientId, startedAt)`.

**Rationale.** FR-027 asks that a stored figure can be rebuilt identically
from its source. For these the record *is* the source, so there is nothing to
rebuild and nothing that can drift, including when a rating is changed or
withdrawn. A read is bounded by the period's events, never by the history.

**Consequence for the spec.** FR-024 said "records kept for the purpose, by
day or finer". The event rows are finer than a day but were not made for
this. The wording is corrected to "records kept by time: an hour, a day, or
the event itself"; the requirement that a page view never recounts
conversations or reads their content is unchanged.

## R5. Limit refusals beyond 30 days

**Found.** `AgentLoadMinute` is pruned after 30 days by
`AgentLimitService`; the in-memory deltas are flushed by an upsert per agent
and minute.

**Decision.** `AgentLoadDay` (agent, UTC day, accepted, refused, exempt),
incremented in the same transaction as the minute row, kept 400 days. A
rebuild sets a day from its minute rows while all of them still exist; it is
run once at boot for the days the table lacks.

**Rationale.** The same deltas, written once, in one transaction: the day can
only equal the sum of its minutes. The page reads days for every period, so
7, 30 and 90 are computed the same way.

## R6. Spend that survives the agent

**Found.** `Usage.agent` is `onDelete: Cascade`: deleting an agent deletes
what it spent. `costUsd` returns 0 for a model missing from
`model-pricing.ts`, so an unpriced model reads as free. `GET usage/overview`
is fixed to 30 days; `findRecentAll(days)` underneath takes any number.

**Decision.** `Usage` keeps `agentId` as a plain column, loses the relation,
and gains `agentName`, written with each report and backfilled by the
migration. `model-pricing.ts` gains `hasPrice(model)`; `costUsd` is
unchanged. The installation view reads `findRecentAll(2 × period)` and rolls
it up with the functions the admin overview uses.

**Rationale.** The repo already keeps a plain id where a row must outlive its
owner (`ChatMessageSource.knowledgeId`). Using the same roll-up and price
functions as the admin console is what makes FR-037 true by construction
rather than by test. A deleted agent passes the reach filter only for an
account that is not limited to a list, which is the right answer: nobody was
granted an agent that no longer exists.

## R7. Summaries: what is missing for topics, outcomes and questions

**Found** (`api/src/slices/chat/domain/chatInsight.service.ts`).
- `topics` is "short topic tags": free text, a new spelling per conversation.
- There is no main question.
- `resolved` that is missing or not a boolean is stored as `false`, so "could
  not tell" is shown as open.
- `findEligibleForInsight` requires `archived: false`. A conversation closed
  with New chat before its hour of quiet has passed is never summarised.
- At most 25 conversations per run, at least 3 user messages, one hour quiet.
- Both manifest sets run the batch every 900 s, so production has summaries.

**Decision.** Summary version 2:
1. The prompt asks for `question` (one line, the person's language, at most
   120 characters), `outcome` (`resolved` | `open` | `unknown`) and `topics`
   chosen from the installation's vocabulary, each with a fit of `clear` or
   `loose`, or a proposal for a new topic with a label in each console
   language.
2. `ChatSession` gains `outcome`, `question`, `topicIds`, `insightVersion`.
   `insights` (Json) is still written, with topic labels in English, so the
   admin console's chat pages need no change.
3. Archived conversations become eligible once.
4. Conversations summarised with version 1 and active in the last 180 days
   are eligible again, newest first, inside the same 25-per-run cap.
5. The page learns whether summaries are produced from the API
   (`summaries.enabled`: the interval is set and an Anthropic credential is
   active).

The two model judgments involved, with their answers, thresholds and
calibration, are in [contracts/summary-judgments.md](./contracts/summary-judgments.md),
as constitution Principle VII requires.

**Alternatives considered.**
- *Group by the tag text as written* — fails SC-008 by design.
- *A topic list maintained by an operator* — needs a console screen and a
  tool to edit it, and is empty on day one.
- *Embedding and clustering* — a new dependency and a new credential for a
  problem a constrained choice solves.
- *A second vendor for typed judgments* — a new credential behind `api/`
  (Principle III) for one call that the existing credential already makes.

## R8. Which model answered

**Found.** `Usage` has one row per agent, model and day with `callCount`.

**Decision.** A person's messages to an agent on a UTC day are attributed to
the models that agent used that day, in proportion to their calls; a day with
no usage row falls back to the agent's current model and sets a flag the card
turns into its one line of explanation. A pure function with tests.

**Rationale.** It is the best record there is, it is already kept, and it is
exact whenever an agent used one model on a day, which is nearly always.

## R9. How fast, and when it stops being fast enough

**Decision.** The personal view runs about eight indexed queries in parallel,
each bounded by one person's rows in at most 180 days. The installation view
reads `ChatActivityHour` by `(agentId, hour)` for up to 180 days, plus small
tables. No cache in the first version.

**Check.** A seed script (`specs/038-profile-stats-dashboard/e2e/seed-volume.mjs`)
loads 1 000 000 conversations with a year of hourly rows and one person with
5 000; SC-002 is measured on it at 10 000 and at 1 000 000.

**The next step, named now.** If the installation view misses SC-002, a
per-agent per-day table built from the hourly rows by the settle pattern
(set, not increment) replaces the hourly range scan behind the same reader.
The response contract does not change. Not built until measured.

**Measured (PR 4, CLEAN-265, 2026-11-27).** `GET /stats/installation` as the
Owner, medians of 40 calls per period, local Postgres 18 in Docker on
Windows:

| Installation | 7 days | 30 days | 90 days |
|--------------|--------|---------|---------|
| 15 278 conversations, 45 602 hour rows | 6 ms | 7 ms | 10 ms |
| 1 005 120 conversations, 3 015 264 hour rows | 30 ms | 90 ms | 700 ms (slowest call 1.6 s) |
| the same million, before the three fixes below | 33 ms | 1.9 s | 10.2 s |

The route is under the 2 seconds of SC-002 at a million conversations. It is
not within 20% of the small installation, and it cannot be: its cost grows
with the conversations of the period. People and conversations are distinct
counts over the period, and the 90-day period of the large database holds
245 133 conversations to tell apart.

**Why the step named above does not apply.** A distinct count cannot be
added up from per-day rows: a conversation active on two days would count
twice, and so would a person. A per-agent per-day table answers sums, which
this view already reads from day rows (`Usage`, `AgentLoadDay`); it does not
answer the two figures that cost the time. It was not built.

So the two halves of SC-002 are held by different routes. The 20% half
applies to the personal route, whose queries are bounded by one person's
rows: 157 ms with 15 120 conversations in the installation, 139 ms with
1 005 120 (PR 2). The installation route is held to the 2 seconds.

**What made it slow was not the scan.** Three things, each found only on a
real database and fixed in `api/src/slices/chat/data/chatActivity.gateway.ts`:
a bound date compared in the session's time zone (a wrong number, not a slow
one: 16 244 conversations counted of 16 472 on a session in Europe/Kyiv); a
hash that spilled to disk under the default `work_mem` of 4 MB (6.3 s for a
statement whose scan took 0.4 s; 0.3 s with 64 MB); and a generic plan kept
from the sixth execution on (both statements from 0.6 s to 5.5 s). The rules
they leave behind are in `docs/statistics.md`, "Counting over a period in
SQL".

**The next step, named again.** If an installation outgrows this (several
million conversations a year), a covering partial index
`("hour") INCLUDE ("agentId","channel","externalUserId","userMessages") WHERE "userMessages" > 0`
lets both statements read the index alone. Its price is a second write on a
hot table. Not built until measured.

## R10. Slices, and who owns what

**Decision.** A new API slice `stats` owns the two routes, the period and
time-zone arithmetic, the figure registry and the two tools. It holds no
figures of its own except `StatFigure` (the first day each figure is complete
from). Each fact stays with its slice, which exposes a read method on its
existing public gateway: `chat` (activity, outcomes, ratings, citations),
`agent/peer` (hand-overs), `agent/limit` (refusals), `agent/event`
(incidents), `usage` (spend). In the app console everything lives in the
existing `profile` slice.

**Rationale.** Principle I: a helper does not reach into another slice's
tables. A figure definition in `stats` names the reader it calls, so adding
one (FR-034) is one file in `stats` and, only when the fact is not kept yet,
a recorder and a rebuild in the slice that owns the fact.

## R11. The page in the app console

**Found.** `profile` is an app-only slice (`Pass`, `Account`, `Capabilities`,
`Session`, `Fleet`). The Pass is drawn with fixed dark colours of its own.
The console has `reka-ui`, `@vueuse/core` and Pinia, and no chart library.
`#agent/utils/panelView` exports `panelLocation(agentId, view)`, the URL
builder the redirect pages of CLEAN-248 already import. Language-sensitive
formatting is allowed only in `app/slices/common/utils/format.ts`
(`bun run locale:check`); admin has its own, different module.

**Decision.**
- Charts are inline SVG and CSS built from pure layout functions with tests,
  as in the prototype. Three forms (calendar, stacked columns, segmented
  bars) do not justify a library.
- Chart colours are custom properties in one stylesheet of the slice, taken
  from the prototype, where they were validated on its card colour.
- One Pinia store holds period views by `scope:period`; components render
  from it; it is cleared on an account change (`docs/state.md`, rule 7).
- Tab, period and scope live in the query string, parsed and built by one
  pure module.
- Tooltips use the `reka-ui` tooltip so hover and focus behave the same.
- New formatters (compact number, money, short weekday and month names, the
  browser's time zone) go into the app format module and `useFormat()`.
  `common` is a twin slice: admin is English-only, has no statistics page and
  needs none of them; said so in the PR.
- "Continue" builds its address with `panelLocation`.

## R12. The agent's tools

**Decision.** Two tools in `api/src/slices/stats/stats.tool.ts`, both
`effect: 'read'`, topic `ChatsUsage`: `get_my_stats` (`person` audience, the
person from `requirePerson`, never an argument) and `get_installation_stats`
(`admin` audience, `requireOperator`, reach from `callerParty`). Each calls
the service its route calls. Both go into `toolReach.spec.ts`; the spec for
the second calls it as the Ranch admin agent answering a User and expects a
refusal.

## R13. Delivery order

**Decision.** Four pull requests, in this order, each releasable alone:

1. **Collection** (API only): `ChatActivityHour` and the live write, the
   settle pass, `AgentLoadDay`, `Usage` outliving its agent, `StatFigure`.
2. **Personal statistics**: `GET /me/stats` without the summary blocks, the
   Statistics tab (scoreboard, activity, agents, help, models), `get_my_stats`.
3. **Summaries v2**: the prompt, the vocabulary, the calibration, and the
   topics, outcomes and open-questions blocks.
4. **Installation view**: `GET /stats/installation`, the scope switch and its
   blocks, `get_installation_stats`.

**Rationale.** Collection goes first and alone because every day it is in
production before the page is a day of exact history the page will have.
Each PR bumps the root version, or no release is tagged.
