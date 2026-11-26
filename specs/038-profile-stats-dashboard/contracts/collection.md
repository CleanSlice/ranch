# Contract: Collection

**Plan**: [../plan.md](../plan.md) | **Data**: [../data-model.md](../data-model.md)

How a number gets into the tables, how it is repaired, and what adding a new
one involves. This is the part of the feature that has to hold when the page
changes.

## 1. Two kinds of figure

| Kind | Examples | Where the number lives | Rebuild |
|------|----------|------------------------|---------|
| **Recorded** | messages, conversations, people, channels; limit refusals | a table written for it: `ChatActivityHour`, `AgentLoadDay` | from the fact's source, by the rule below |
| **Read in place** | ratings, citations, hand-overs, incidents, spend, outcomes, topics | the event or day rows that already exist | none: the row is the source |

A figure is *recorded* only when nothing durable holds it by time.

## 2. Live recording of chat activity

Owner: `chat` slice, `IChatGateway.recordActivity` (existing entry point,
called without waiting from the agent socket handler).

1. In one transaction: apply the lifetime increment exactly as today (refused
   when the event's `eventId` is the one counted last); if and only if it
   applied, or the conversation
   row was just created by this event, add 1 to `userMessages` or
   `agentMessages` of `(sessionId, floor(ts to the hour))`, creating the row
   with the conversation's `agentId`, `channel` and `externalUserId`.
2. A unique-key race on the hour row is retried once.
3. A failure rolls back both and is logged as today. The caller never waits
   and the message is unaffected (FR-032, SC-011). The settle pass repairs it.

**What the dedup is, exactly.** The runtime reports each message once, with a
random id, and does not retry; while its socket is down the report is dropped
(`reportActivity` in the runtime's bridle repository). The hub's watermark
therefore only has to refuse an immediate repeat, and that is all it does: an
old event replayed after newer ones would be counted again, by the lifetime
totals and by the hour alike. The realistic failure is a lost report, and
section 3 repairs it.

**Invariant**: for a conversation that began after recording started,
`sum(userMessages) = userMessageCount` and
`sum(userMessages + agentMessages) = messageCount`. A spec asserts it after a
replayed, a duplicated and a concurrent delivery.

## 3. The settle pass

Owner: `chat` slice, `ChatActivityService`, on a timer like the summary batch
(the API has no scheduler; one process).

- **Picks** up to `STATS_SETTLE_BATCH` (default 100) conversations where
  `lastMessageAt` is more than 60 minutes old and within the last 180 days,
  and `activityRebuiltAt` is null or older than `lastMessageAt`; newest first.
- **For each**: read the transcript as the live write counts it: one message
  per stored `user` or `assistant` event, transient ones filtered, and no
  bubbles (`bubbles: false`: a streamed answer is one event shown as several
  bubbles, and the runtime reports one activity per event); count per UTC
  hour; for each hour set the stored value to `max(stored, counted)`,
  creating the row if absent; set `activityRebuiltAt = now`.
- **Never**: lowers a value, deletes a row, or touches hours the transcript
  does not mention. A compacted transcript therefore cannot erase history.
- **A transcript that cannot be read** leaves `activityRebuiltAt` untouched
  and is tried again on a later run; three failures in a row are reported
  once as a background error tagged `chat.activity`, and the conversation is
  set aside for an hour so it does not fill every batch ahead of the ones
  that can be read.
- **A transcript that does not exist** is not a failure. There is nothing to
  raise the hours to; the conversation is marked settled as it stands and is
  due again with its next message.
- **The daily prune runs whatever the interval says**, at boot and every 24
  hours, because the live write fills the table whether the pass runs or not.
- **Every** `STATS_SETTLE_INTERVAL_SEC` (default 300; `0` disables). One run
  at a time; a run that finds the previous one still going is skipped.
- **Daily**: prune `ChatActivityHour` older than 400 days.

It serves three needs with one path: history on upgrade, events lost to a
restart, and the past of a figure added later.

## 4. Limit refusals by day

Owner: `agent/limit` slice.

- The flush that upserts `AgentLoadMinute` adds the same deltas to
  `AgentLoadDay` for the minute's UTC day, in the same transaction.
- At boot, days of the last 30 that have minute rows and no day row are set
  from their minutes. This is the rebuild; it is refused for a day whose
  minutes have begun to be pruned.
- The daily prune that removes minutes older than 30 days also removes days
  older than 400.

## 5. The figure registry

Owner: `stats` slice, `api/src/slices/stats/domain/figures/`. One file per
figure, exporting a definition:

| Part | Meaning |
|------|---------|
| `key` | stable name; the key of its `StatFigure` row and of its note in a response |
| `scopes` | `personal`, `installation`, or both |
| `read(range, subject)` | calls one public read method of the slice that owns the fact; returns the value for the range |
| `firstRecord()` | the earliest instant the source covers; used once, to write `completeSince` |
| `rebuild` | absent for a figure read in place; otherwise names the owning slice's rebuild |

**Adding a figure** (FR-034, SC-007):

1. Write the definition file and add it to the registry's list.
2. If the fact is not kept by time yet, add its recorder and its rebuild in
   the slice that owns the fact. No existing recorder or definition is edited.
3. Add its field to the response DTO and regenerate the SDK.

**At boot** the registry writes a `StatFigure` row for every figure that has
none: `completeSince = firstRecord() ?? now`.

**On read** a period view carries, for each figure whose `completeSince` is
later than the period's start, one note `{ figure, completeSince }`. The page
turns the notes of a block into one line (FR-028).

## 6. What each figure reads

| Figure | Kind | Read from |
|--------|------|-----------|
| conversations, messages, agents answered, active days, weekdays, calendar | recorded | `ChatActivityHour` by person |
| people in conversations, conversations per agent, channels | recorded | `ChatActivityHour` by agent; `internal` and `peer:` identities excluded; `share-` identities on `bridle` are the share-link channel |
| outcomes, tone, language, open questions, topics | in place | `ChatSession` rows of the conversations the period's activity names |
| ratings | in place | `ChatFeedback` |
| citations | in place | `ChatMessageSource` |
| hand-overs | in place | `AgentDelegation` |
| models that answered | derived | the person's messages by agent and UTC day × `Usage` of that agent and day ([research R8](../research.md)) |
| tokens, calls, cost, spend by day, agents by cost | in place | `Usage`, rolled up and priced by the functions the admin overview uses |
| incidents | in place | `AgentIncident` opened in the range or still open |
| limit refusals | recorded | `AgentLoadDay` |

## 7. Days

- **Personal scope**: the viewer's zone. A period of N days is from the start
  of the local day N−1 days ago to now; the previous period is the N local
  days before it. Hour rows are assigned to local days in
  `api/src/slices/stats/domain/period.ts`, which has specs for a zone east
  and a zone west of UTC, both DST changes, and an unknown zone.
- **Installation scope**: UTC days throughout, the boundary `Usage.date` and
  `AgentLoadDay.day` already have.

## 8. Guarantees a reviewer can test

| Guarantee | Test |
|-----------|------|
| An event is counted once | deliver each event twice in a row, and two different ones concurrently; assert the invariant of section 2 |
| The settle pass is idempotent | run it twice on the same transcript; rows identical |
| The settle pass never lowers | give it a compacted transcript after a full one; rows unchanged |
| Recording cannot break a message | make the hour write throw; the handler logs, the lifetime totals roll back, the next settle pass restores both |
| Refusals by day equal their minutes | flush a set of deltas; sum of minutes per day equals the day row |
| A deleted agent's spend stays | delete the agent; the installation totals for a past period are unchanged and name it |
| A new figure touches nothing else | SC-007 acceptance: the diff of the trial figure contains no line of an existing recorder or definition |
