# Data Model: Profile statistics dashboard

**Date**: 2026-11-27 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Three new tables, additive columns on two existing ones, one relation
removed, four indexes. Nothing is dropped and no existing value changes
meaning. Each `.prisma` file lives in the slice that owns the fact.

## New

### ChatActivityHour (`api/src/slices/chat/chatActivity.prisma`)

How many messages one conversation had in one UTC hour. The base of every
figure about conversations, messages, people, agents answered and channels.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | String | `ChatSession.id`, `onDelete: Cascade` |
| `hour` | DateTime | start of the hour, UTC |
| `agentId` | String | copied from the conversation; never changes for a conversation |
| `channel` | String | copied: `bridle` \| `telegram` \| `slack` \| `internal` |
| `externalUserId` | String | copied: the person's chat identity (`admin` for the Owner) |
| `userMessages` | Int, default 0 | messages from the person in that hour |
| `agentMessages` | Int, default 0 | answers in that hour |

- **Key**: `@@id([sessionId, hour])`.
- **Indexes**: `([externalUserId, channel, hour])` for one person;
  `([agentId, hour])` for an installation; `([hour])` for pruning.
- **Rules**: a row exists only for an hour with at least one message. Live
  writes add 1; the settle pass raises to the transcript's count and never
  lowers ([contracts/collection.md](./contracts/collection.md)). Rows older
  than 400 days are pruned daily (FR-030).
- **Lifecycle**: disappears with its conversation, which disappears with its
  agent. That is the behaviour the person's history already has (spec, edge
  case "A deleted agent").
- **Not here**: message text, message ids, anything about the content
  (FR-033).

### AgentLoadDay (`api/src/slices/agent/limit/agentLimit.prisma`)

Requests per agent per UTC day; what remains after `AgentLoadMinute` is
pruned at 30 days.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | String | `Agent.id`, `onDelete: Cascade`, as the minute rows |
| `day` | DateTime | start of the day, UTC |
| `accepted` | Int, default 0 | |
| `refused` | Int, default 0 | |
| `exempt` | Int, default 0 | operator and agent-to-agent requests |

- **Key**: `@@id([agentId, day])`. **Index**: `([day])`.
- **Rules**: incremented by the same deltas, in the same transaction, as the
  minute row. A rebuild sets a day to the sum of its minute rows and is
  allowed only for days whose minutes are all still kept. Pruned at 400 days.

### ChatTopic (`api/src/slices/chat/chatTopic.prisma`)

One subject, as the installation's summaries name it.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String | uuid |
| `key` | String, unique | lower-case English slug; what the model chooses between |
| `labels` | Json | `{ "en": "…", "ru": "…" }`, one entry per console language, written when the topic is coined; a missing language falls back to `en` |
| `mergedIntoId` | String? | set when an operator folds this topic into another; readers follow it once |
| `createdAt` | DateTime | |

- **Rules**: a topic is created only by the summary batch, one at a time (the
  batch is sequential and re-reads the vocabulary for each conversation). A
  label is 1 to 3 words. A merged topic is never offered to the model again.
- **Bound**: at most 100 topics stand (not merged) at once
  (`TOPICS_STANDING_MAX`). The prompt offers 60; the 40 above are room for
  new subjects, and past that a new key is more likely a rewording than a
  subject. At the bound a proposal is dropped and its conversation is stored
  with no topic; merging two topics makes room.
- **Offered**: the 60 most used, and always the topics the running batch
  coined itself, which take the places of the least used: by count alone a
  topic coined a conversation ago stands sixty-first once 60 are in use, and
  the next conversation on its subject would coin a second key.
- **Whose conversations**: the vocabulary is the installation's and is
  printed in every prompt, so a person can have the list of subject names
  repeated in the summary of their own conversation. Accepted as the price
  of one vocabulary. A conversation with an agent only the Owner manages
  (today the Ranch assistant) neither coins a topic nor is given one: its
  prompt lists no vocabulary and asks for no topic, and `topicIds` stays
  empty. Its summary, question, outcome, tone and language are written as
  for any other.

### StatFigure (`api/src/slices/stats/stats.prisma`)

What the product knows about one figure's history.

| Field | Type | Notes |
|-------|------|-------|
| `key` | String, id | the figure's key in the registry, e.g. `messages` |
| `completeSince` | DateTime | the first instant from which the figure is complete |
| `updatedAt` | DateTime | |

- **Rules**: written once, when the figure is first seen at boot: the moment
  live recording starts for a figure with a recorder, the earliest row of its
  source for a figure read from events. It is never moved later. Read with
  every period view; a period that starts before it carries a note (FR-028).

## Changed

### ChatSession (`api/src/slices/chat/chat.prisma`)

| Field | Type | Notes |
|-------|------|-------|
| `outcome` | String? | `resolved` \| `open` \| `unknown`; null while there is no summary |
| `question` | String? | the person's main question, one line, at most 120 characters, their language |
| `topicIds` | String[], default `[]` | `ChatTopic.id`s the summary assigned with a clear fit, at most two |
| `insightVersion` | Int, default 0 | 0 none, 1 before this feature, 2 with question, outcome and vocabulary |
| `activityRebuiltAt` | DateTime? | when the settle pass last read this conversation's transcript |

- **New indexes**: `([activityRebuiltAt, lastMessageAt])`, for the settle
  pass: a conversation is due when `activityRebuiltAt` is null, and every
  write that moves a conversation on sets it back to null, so the due ones
  are one index range however many conversations there are;
  `([externalUserId, channel, lastMessageAt])`, for one person's
  conversations.
- **Unchanged**: `summary`, `summaryAt`, `insights` (Json). `insights` keeps
  being written (`topics` as English labels, `sentiment`, `resolved`,
  `language`) for the admin console's chat pages.
- **Migration**: two folders. `…_chat_summary_v2` adds the table and the
  columns; `…_chat_summary_v2_backfill` then sets `insightVersion = 1` and
  `outcome` from `insights.resolved` where a summary exists: `true` →
  `resolved`, anything else (`false`, missing, not a boolean) → `unknown`.
  Not `open` for `false`: version 1 stored "could not tell" as `false`, so a
  `false` was never a calibrated "open", and the open list is the one figure
  a person acts on. Version 1 rows are re-summarised within the 180-day
  window (research R7) and get a real outcome then. The backfill is a
  migration of its own so that the `ALTER TABLE`'s exclusive lock on
  `ChatSession` is not held while rows are updated.

**Outcome states**

```text
(no summary) ──summarised──▶ resolved | open | unknown
resolved | open | unknown ──conversation continued, summarised again──▶ resolved | open | unknown
```

A conversation below three messages from the person never leaves "no
summary".

### Usage (`api/src/slices/usage/usage.prisma`)

| Change | Notes |
|--------|-------|
| relation `agent` removed | `agentId` stays as a plain String; the row no longer dies with the agent (FR-031) |
| `agentName` String? added | written with each report; backfilled from `Agent.name` by the migration |

`@@unique([agentId, model, date])` and both indexes are unchanged.

### Indexes on existing tables

| Table | Index | Read it serves |
|-------|-------|----------------|
| `ChatFeedback` | `([authorId, createdAt])` | a person's ratings in a period |
| `ChatFeedback` | `([createdAt])` | ratings of an installation in a period |
| `ChatMessageSource` | `([clientId, createdAt])` | a person's cited answers in a period |
| `AgentDelegation` | `([clientId, startedAt])` | hand-overs made while answering a person |

## Read models (not stored)

The two responses in [contracts/api.md](./contracts/api.md) are assembled per
request from the tables above. In the app console one Pinia store keeps them
by `scope:period` ([contracts/ui.md](./contracts/ui.md)).

## Who a row belongs to

| Fact | The person is | Source of that identity |
|------|---------------|-------------------------|
| activity, outcomes, topics | `ChatSession.externalUserId` on channel `bridle` | `clientIdFromJwtPayload`: `admin` for the Owner, the token's `sub` otherwise, the same function `GET /me/chats` uses |
| citations | `ChatMessageSource.clientId` | the same chat identity |
| hand-overs | `AgentDelegation.clientId` | the same chat identity |
| ratings | `ChatFeedback.authorId` | the token's `sub`, also for the Owner |

There is no table of personal statistics, so deleting an account leaves
nothing personal to delete (FR-035): the rows are the conversations' and are
handled as conversations are today.

## Mapping from the spec's entities

| Spec entity | Here |
|-------------|------|
| Activity record | `ChatActivityHour`, `AgentLoadDay`, and the event rows read in place (`ChatFeedback`, `ChatMessageSource`, `AgentDelegation`, `AgentIncident`) |
| Conversation outcome | the new columns on `ChatSession` |
| Topic | `ChatTopic` |
| Spend record | `Usage` |
| Figure definition | a file in `api/src/slices/stats/domain/figures/` plus its `StatFigure` row |
| Period view | the response DTOs; the store in the app console |
