# Contract: HTTP API and agent tools

**Plan**: [../plan.md](../plan.md) | **Data**: [../data-model.md](../data-model.md) | **Collection**: [collection.md](./collection.md)

Two read routes and two read tools, all in the new `stats` slice. Shapes are
given as fields and meaning; the DTO classes are written at implementation
and the console types are generated from `api/swagger-spec.json`, never by
hand.

## `GET /me/stats`

The signed-in person's own statistics.

- **Guards**: `JwtAuthGuard`; `@Roles(UserRoleTypes.User)`, stated, as on
  `me/chats` (a route with no role asks for Admin).
- **Who**: the caller's chat identity from `clientIdFromJwtPayload` and their
  `sub`, both from the token. There is no parameter that names a person
  (FR-020).
- **Which agents**: only those `AgentAccessService.reachableIds` returns for
  the caller (FR-022).

| Query | Values | Default | Notes |
|-------|--------|---------|-------|
| `period` | `7` \| `30` \| `90` | `30` | anything else → 400 |
| `tz` | IANA zone name | `UTC` | unknown or malformed → treated as `UTC`, and the response says which zone was used |

| Header | Read for | Notes |
|--------|----------|-------|
| `Accept-Language` | the language topics are named in | the language with the highest weight among the console's (`en`, `ru`; `TOPIC_LABEL_LANGUAGES`), region ignored; `en` when it names none of them or is absent. Nothing else in the answer depends on it. The tool `get_my_stats` has no such header and names topics in English |

**Response**

| Field | Meaning |
|-------|---------|
| `period`, `timeZone`, `range { from, to, previousFrom }` | what was computed; instants in ISO form |
| `notes[]` | `{ figure, completeSince }` for each figure whose history starts inside the requested or previous period |
| `summaries { enabled, topicsReady, summarised, waiting, tooShort }` | whether the installation produces summaries (`ChatInsightService.isEnabled()`: the batch is scheduled, an Anthropic credential is active, the provider did not reject it with a 401 or a 403, and it did not refuse two runs of the batch in a row, a run being refused when it called the model and every call came back with a 4xx or a 5xx (CLEAN-280: a subscription token of the kind the agents run on is refused that way, which is why the batch takes an API key first; one such run alone changes nothing here, so a provider that was down for a minute does not reach the page). The last two end when a call goes through or the credential is saved again; while either holds `enabled` is false whatever summaries were stored before, and the answer is the empty one described below); whether their topics are there to show (`topicsReady`: `enabled`, and the installation has a vocabulary, at least one topic that stands; one row of `ChatTopic` by id through `IChatTopicGateway.hasStanding()`, not asked when `enabled` is false); and for the period's conversations how many have one (`summaryAt` set), how many will get one, how many never will as they stand: under three messages from the person in the whole conversation (`INSIGHT_MIN_USER_MESSAGES`). The three add up to `board.conversations.value`. A conversation whose transcript the batch could not read is among `waiting`: nothing is stored that tells it apart |
| `board.conversations { value, previous }` | conversations the person wrote in |
| `board.messages { value, previous }` | the person's own messages |
| `board.agents { value, reachable }` | agents that answered; agents the person reaches now |
| `board.resolved { resolved, summarised }` | for the share and its coverage; both 0 when summaries are off. `summarised` is `summaries.summarised` |
| `activity.days[]` | 91 entries `{ date, conversations }`, oldest first, in the viewer's days, ending today |
| `activity.weekdays[7]` | conversations by weekday within the period, Monday first |
| `activity.activeDays` | days with at least one conversation within the period |
| `agents[]` | `{ agentId, name, messages, conversations, resolved, summarised, model, lastMessageAt }`, by messages, descending. `resolved` and `summarised` are of the agent's `conversations`, both 0 when summaries are off |
| `topics[]` | up to 8, most conversations first, equal ones by label: `{ id, label, conversations, resolved, open, questions[] }`. `id` is the topic that stands: a merged topic is counted under the one it was folded into (followed once), and a conversation that carries both is counted once. `label` in the request's language (`Accept-Language`, falling back to `en`, then to the key). `conversations` are summarised conversations of the period; `resolved` and `open` are of them, and `unknown` is in neither, so the two can add up to less. `questions` up to 4, each wording once (compared without case and spacing), newest first by the conversation's last message: `{ chatId, agentId, agentName, question, at, outcome }`, where `at` is that last message and `outcome` one of `resolved`, `open`, `unknown`; a conversation whose summary quotes no question takes no place. `[]` while `summaries.topicsReady` is false |
| `outcome { resolved, open, unknown, notSummarised }` | parts of `board.conversations.value`: they add up to it. `unknown` is a summarised conversation whose summary could not tell, or stored no outcome; `notSummarised` is `summaries.waiting + summaries.tooShort` |
| `outcome.sentiment { positive, neutral, mixed, negative }` | counts among summarised conversations; a summary that stored no tone is in none |
| `outcome.languages[]` | `{ code, conversations }` among summarised conversations, most first |
| `openQuestions { items[], more }` | up to 4 `{ chatId, agentId, agentName, question, topic, at }`, newest first; `more` is the remainder, so `items` and `more` together are `outcome.open`. `question` is null when the summary left the conversation open and quoted no question; `topic` is the label of the conversation's first topic, or null, and null for every item while `summaries.topicsReady` is false; `at` is the conversation's last message |
| `help.cited { conversations, sources[] }` | conversations with at least one cited source; up to 2 `{ name, citations }`, a knowledge base by its name, the web as `web` |
| `help.handovers { total, answered, topPeer }` | `topPeer` is `{ name, count }` or null |
| `help.ratings { up, down }` | the person's ratings given in the period |
| `models { items[], fallback }` | `{ model, messages }` by share, descending; `fallback` true when any day had no usage record |

`topics`, `outcome` and `openQuestions` are empty when
`summaries.enabled` is false; the page shows one card instead (FR-011).
Empty means the same shape with nothing in it: `topics` is `[]`,
`openQuestions` is `{ items: [], more: 0 }`, every number of `outcome`,
`summaries`, `board.resolved` and of `resolved` / `summarised` per agent is
0 and `outcome.languages` is `[]`. No field is absent or null. Nothing is
computed then, whatever a summary made by hand left on a conversation, so
the parts of `outcome` do not add up to anything: `summaries.enabled` is
the only field that says which case it is.

`topics` is also empty, and `topic` of every open question null, while
`summaries.topicsReady` is false: summaries are produced and the
installation has no vocabulary yet (the owner's decision of 2026-11-28,
[summary-judgments.md](summary-judgments.md), *Decision*). Until a topic
stands the summary asks no conversation about topics and coins none, so
there is nothing to read, and no topic is read: `findByIds` is not called.
Everything else made of summaries (`summaries`' counts, `board.resolved`,
`outcome` with tone and languages, `openQuestions`) is counted as with a
vocabulary. The page leaves the Topics block out by that field, never by the
empty list, which also means "no conversation of this period has a topic".
How a vocabulary comes to exist is CLEAN-278.

**How the summaries are read.** By the ids of the conversations the
person's hour rows of the period named (`findOutcomesForSessions`, by
primary key, 1000 ids a statement), in place of the read that brought each
conversation's agent and last message; `ChatSession` is never searched.
The topics those conversations carry are then read by id, where
`summaries.topicsReady` is true. The main
question is the person's own words (FR-033): it is in this answer because
the answer is its owner's, and in no other route or tool of this slice.

**Errors**: 401 without a token; 400 for a bad `period`. Never 403 or 404:
there is nothing here that belongs to someone else.

## `GET /stats/installation`

The installation, through the agents the caller reaches.

- **Guards**: `JwtAuthGuard`, `RolesGuard`,
  `@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)`.
- **Which agents**: `reachableIds(accessCallerOf(req))`, applied to every
  figure, totals included (FR-021). The two kinds of figure read it
  differently:
  - *Operations figures*: tokens, calls, cost, `daily[]`, `agents[]`,
    `projection30d`, `health.incidents[]` and `health.refusals[]`. The
    caller's plain reach, the one the admin usage overview applies, so the
    two agree about a period (FR-037).
  - *Conversation figures*: `board.people`, `quality[]` (its conversations
    and its ratings) and `channels[]`. The reach less the agents only the
    Owner manages, `reach.without(await permission.ownerOnlyIds(caller))`,
    which is the scope chat history reads with (CLEAN-236; CLEAN-263 and
    CLEAN-267 say the same of every chat tool). These figures carry no text,
    but they are built from what people said to the Ranch assistant, and
    that is the Owner's. `reach.ownerOnly` names the agents taken out,
    because whoever leaves an agent out owes the caller the reason. The
    same set is the second lock on the rows that come back and decides
    which agents may have a row in `quality[]`.

| Query | Values | Default |
|-------|--------|---------|
| `period` | `7` \| `30` \| `90` | `30` |

Shipped as PR 4 (CLEAN-265) before PR 3, so `quality[]` went out without
`open` and `summarised`; PR 3 (CLEAN-270) adds the two fields, and
`summaries { enabled }` beside them.

**Response**

| Field | Meaning |
|-------|---------|
| `period`, `range { from, to, previousFrom }` | UTC days |
| `reach { limited, agents, ownerOnly[] }` | whether the caller sees a part of the installation, and how many agents they reach. `ownerOnly` holds the names, as the agents list shows them, of the reached agents whose conversations are left out of the conversation figures; empty for the Owner, for a trusted party, and for a caller who does not reach the assistant. `limited` and `agents` are of the plain reach and do not change with it |
| `notes[]` | as above |
| `summaries { enabled }` | whether the installation produces conversation summaries, as in `GET /me/stats`. The one field: it is what tells a `quality[]` row with `open` 0 because nobody was left without an answer from one where nothing was counted |
| `board.tokens { input, output }` | |
| `board.calls { value, previous }` | |
| `board.cost { value, previous, unpriced[] }` | USD from the product's price list; `unpriced` names the models left out of it |
| `board.people { value, previous }` | distinct chat identities that wrote. A share-link visitor is one of them (each visitor has one identity); the `internal` channel and `peer:` identities, which are agent-to-agent traffic, are left out |
| `daily[]` | one per day, oldest first: `{ date, cost, byModel[] { model, tokens } }` |
| `models[]` | `{ model, priced }` for the legend |
| `agents[]` | `{ agentId, name, removed, model, tokens, calls, cost, partial }` by cost, descending, an agent with no price after the priced ones. `model` is the one that took most of the agent's tokens in the period. `cost` is USD over the agent's priced models, null when none of its models has a price. `partial` is true when the agent also ran a model with no price, so `cost` covers only the rest. `removed` is true when the agent no longer exists |
| `projection30d` | a number or null: the priced cost of the period's finished UTC days ÷ their number × 30. Today is left out of both, because its row is still being added to: counting it read up to one day in the period low, a seventh on the 7-day view. Days before the first usage row among the rows read (this period and the previous one) are left out too. Null while no such day is finished, and null when no model with a price ran in those days: the sum of unpriced models is 0, which is not a pace, and the page would print "≈ $0.00 in 30 days" above rows that all say "no price". A priced model that cost exactly 0 projects 0 |
| `health.incidents[]` | `{ number, agentName, open, reason, openedAt, closedAt }` opened in the period or still open, newest first, at most `INCIDENTS_SHOWN` of them (`installationStats.service.ts`, where the cap has its reason) |
| `health.incidentsTotal` | how many there are, the ones the cap left out included, so a cut list never reads as "that was all" |
| `health.refusals[]` | `{ agentId, name, refused }` where `refused > 0` |
| `quality[]` | `{ agentId, name, conversations, down, rated }`, most conversations first. `conversations` are those a person wrote in during the period; `down` and `rated` are every rating made in the period on conversations of the agents counted here (see *Which agents*), so `rated` can exceed what `conversations` suggests. `summarised` is how many of `conversations` have a summary and `open` how many of those it left open (`unknown` is not open): the open share is `open / summarised`, and `summarised` is shown with it, because a share over 3 conversations is not the news it is over 300. All three are counts of the same rows of one statement, so `open` is never more than `summarised` and `summarised` never more than `conversations`. Both 0 when `summaries.enabled` is false, where no summary is read |
| `channels[]` | `{ channel, conversations }`, channels with at least one conversation, most first. `channel` is `console` for a stored `bridle`, or `share` when the identity starts with `share-`; `telegram`; `slack`; anything else `other` |

No field carries a person's name, identity, question or message (FR-021).
The open share is two counts per agent: the statement that makes them reads
`summaryAt` and `outcome` of `ChatSession` and no column a person's words
are in.

**How the two counts are read.** People and conversations are distinct
counts over `ChatActivityHour`, made in the database by two statements that
run side by side, each in its own transaction with a 30 s timeout
(`api/src/slices/chat/data/chatActivity.gateway.ts`, which carries the
measured numbers). Where summaries are produced, the conversations statement
also counts how those conversations ended: each row of its one-row-per-
conversation inner query is joined to `ChatSession` by primary key, for
`summaryAt` and `outcome`, and `summarised` and `open` are two more counts
of the same rows. There is no statement of its own for that: one was tried,
scanned and hashed the same hour rows a second time, and took the 90-day
view from 0.65 s to about 1.65 s on a database of a million conversations.
Folded in, the conversations statement takes about 1.0 s there (0.3 s
without the join), beside 0.6 s for people. Where summaries are off the
statement is the one of CLEAN-265, unchanged, and `ChatSession` is not
read. At most two of these statements run at once in the API
process (`AGGREGATE_CONCURRENCY`, one view's pair) and later ones wait their
turn in order of arrival, so that a few operators switching periods cannot
hold the whole Prisma pool while chat and sign-in wait for a connection; the
30 s count from a statement's own turn, not from its time in that queue.
Three things in them are there because a real database showed them and no
unit spec could:

- Every bound moment is written `($n::timestamptz AT TIME ZONE 'UTC')`.
  `hour` is a `timestamp` without zone holding UTC; a `Date` bound into
  `$queryRaw` arrives as `timestamptz`, and Postgres then compares by reading
  the column in the session's zone. On a session in Europe/Kyiv a 7-day
  period began two hours late and nothing failed. A spec asserts that no
  comparison of `hour` is left with a bare parameter.
- `set_config('work_mem', '64MB', true)`. The count hashes one entry per
  conversation of the period, and under the server default of 4 MB a 90-day
  period at a million conversations spilled to disk.
- `set_config('plan_cache_mode', 'force_custom_plan', true)`. The statement
  is prepared once per connection, and from its sixth execution Postgres may
  keep one plan for any dates; the one it kept was the slow one.

Both settings are local to the transaction (`is_local = true`), so the
server's own values and every other query keep what they had.

**Errors**: 401 without a token; 403 for a User; 400 for a bad `period`.

## Inventories to update

New routes are added to the specs that enumerate guarded routes
(`api/src/slices/user/auth/guards/agentRoutes.spec.ts` and its neighbours),
so that a route without a stated role or a reach filter fails the build.

## Agent tools

File `api/src/slices/stats/stats.tool.ts`. Both `effect: 'read'`, topic
`ToolTopics.ChatsUsage`, no `confirm`, no secret in any result. Each calls
the service its route calls.

| Tool | Audience | First line of the method | Arguments | Result |
|------|----------|--------------------------|-----------|--------|
| `get_my_stats` | `person` | `requirePerson(httpRequest)` | `period` (7, 30, 90; default 30), `timeZone` (optional, default UTC) | the `GET /me/stats` response |
| `get_installation_stats` | `admin` | `requireOperator(httpRequest)`; reach from `callerParty(httpRequest)` | `period` | the `GET /stats/installation` response |

A third tool lives with the fact it changes, in
`api/src/slices/chat/chat.tool.ts`: `merge_chat_topics` (`admin`,
`requireOperator`, `effect: 'write'`, `confirm`), arguments `from` and `into`
(topic keys). It sets `mergedIntoId` on the first, so every reader counts its
conversations under the second and the summary call is no longer offered it.
It is the remedy when two labels turn out to mean one subject; there is no
console screen for it. `list_chat_topics` (`admin`, read) returns keys,
labels and conversation counts so the operator can see what to merge. The
keys already folded into a topic (`merged`) go only to a caller who reads
every conversation; for a caller whose scope is narrower the field is left
out, because the counts arrive folded and a folded key may have no
conversation that caller may read.

- `title` / `template`: "Your statistics" / "How many conversations did I
  have this month?"; "Installation statistics" / "What did the agents cost
  in the last 90 days, and which had incidents?"
- Neither takes a person as an argument.
- Specs: metadata present (the API refuses to boot otherwise);
  `get_installation_stats` called as the Ranch admin agent answering a User
  is refused; both are listed in `api/src/slices/mcp/toolReach.spec.ts` with
  an agent outside the caller's reach absent from every list in the result.
- `get_usage_overview` stays as it is; its description gains one sentence
  pointing to `get_installation_stats` for other periods.

## Changed behaviour of existing routes

| Route | Change |
|-------|--------|
| `POST /agents/:agentId/usage` | also stores the agent's current name with the row; answers 404 and writes nothing for an agent that does not exist, which the foreign key used to refuse |
| `GET /usage/overview`, `GET /llms/:id/usage`, and the tools `get_usage_overview` and `llm_usage` | a deleted agent's rows remain and are listed under the name it had; no shape change. `GET /agents/:agentId/usage` still answers 404 for an agent that no longer exists, as every route that names an agent does |
| `GET /chats`, `GET /chats/:id`, `GET /me/chats` | `ChatSessionDto` gains optional `outcome`, `question`, `topics[]` (labels); additive |
| `POST /chats/:id/summarize` | produces a version 2 summary |

The generated SDK of both consoles is regenerated; admin gets the additive
fields and uses none of them.
