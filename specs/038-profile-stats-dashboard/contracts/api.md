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

**Response**

| Field | Meaning |
|-------|---------|
| `period`, `timeZone`, `range { from, to, previousFrom }` | what was computed; instants in ISO form |
| `notes[]` | `{ figure, completeSince }` for each figure whose history starts inside the requested or previous period |
| `summaries { enabled, summarised, waiting, tooShort }` | whether the installation produces summaries, and for the period's conversations how many have one, how many will get one, how many never will |
| `board.conversations { value, previous }` | conversations the person wrote in |
| `board.messages { value, previous }` | the person's own messages |
| `board.agents { value, reachable }` | agents that answered; agents the person reaches now |
| `board.resolved { resolved, summarised }` | for the share and its coverage; both 0 when summaries are off |
| `activity.days[]` | 91 entries `{ date, conversations }`, oldest first, in the viewer's days, ending today |
| `activity.weekdays[7]` | conversations by weekday within the period, Monday first |
| `activity.activeDays` | days with at least one conversation within the period |
| `agents[]` | `{ agentId, name, messages, conversations, resolved, summarised, model, lastMessageAt }`, by messages, descending |
| `topics[]` | up to 8: `{ id, label, conversations, resolved, open, questions[] }`; `label` in the request's language (`Accept-Language`, falling back to `en`); `questions` up to 4 distinct, newest first: `{ chatId, agentId, agentName, question, at, outcome }` |
| `outcome { resolved, open, unknown, notSummarised }` | parts of `board.conversations.value` |
| `outcome.sentiment { positive, neutral, mixed, negative }` | counts among summarised conversations |
| `outcome.languages[]` | `{ code, conversations }` |
| `openQuestions { items[], more }` | up to 4 `{ chatId, agentId, agentName, question, topic, at }`, newest first; `more` is the remainder |
| `help.cited { conversations, sources[] }` | conversations with at least one cited source; up to 2 `{ name, citations }`, a knowledge base by its name, the web as `web` |
| `help.handovers { total, answered, topPeer }` | `topPeer` is `{ name, count }` or null |
| `help.ratings { up, down }` | the person's ratings given in the period |
| `models { items[], fallback }` | `{ model, messages }` by share, descending; `fallback` true when any day had no usage record |

`topics`, `outcome` and `openQuestions` are empty when
`summaries.enabled` is false; the page shows one card instead (FR-011).

**Errors**: 401 without a token; 400 for a bad `period`. Never 403 or 404:
there is nothing here that belongs to someone else.

## `GET /stats/installation`

The installation, through the agents the caller reaches.

- **Guards**: `JwtAuthGuard`, `RolesGuard`,
  `@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)`.
- **Which agents**: `reachableIds(accessCallerOf(req))`, applied to every
  figure, totals included (FR-021).

| Query | Values | Default |
|-------|--------|---------|
| `period` | `7` \| `30` \| `90` | `30` |

**Response**

| Field | Meaning |
|-------|---------|
| `period`, `range { from, to, previousFrom }` | UTC days |
| `reach { limited, agents }` | whether the caller sees a part of the installation, and how many agents |
| `notes[]` | as above |
| `board.tokens { input, output }` | |
| `board.calls { value, previous }` | |
| `board.cost { value, previous, unpriced[] }` | USD from the product's price list; `unpriced` names the models left out of it |
| `board.people { value, previous }` | distinct chat identities that wrote, agent-to-agent traffic excluded |
| `daily[]` | one per day, oldest first: `{ date, cost, byModel[] { model, tokens } }` |
| `models[]` | `{ model, priced }` for the legend |
| `agents[]` | `{ agentId, name, removed, model, tokens, calls, cost }` by cost, descending; `cost` null when the agent's model has no price; `removed` true when the agent no longer exists |
| `projection30d` | priced cost of the period ÷ its days × 30 |
| `health.incidents[]` | `{ number, agentName, open, reason, openedAt, closedAt }` opened in the period or still open, newest first |
| `health.refusals[]` | `{ agentId, name, refused }` where `refused > 0` |
| `quality[]` | `{ agentId, name, conversations, open, summarised, down, rated }` |
| `channels[]` | `{ channel, conversations }` with `channel` one of `console`, `telegram`, `slack`, `share`, `other` |

No field carries a person's name, identity, question or message (FR-021).

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
labels and conversation counts so the operator can see what to merge.

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
