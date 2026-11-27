# Statistics: how a number gets onto a page

The profile's Statistics tab shows a person their own conversations and shows
an owner or administrator the installation (spec 038, CLEAN-258). This file
is about what stands behind every number there: where it is kept, how it is
repaired, and what adding one involves. Read it before adding a figure to a
page or changing how one is counted.

## The one rule that explains the rest

**A fact is kept once, by time, by the slice that owns it.**

A page view never counts conversations and never opens a transcript. It reads
rows that already say "this much, at this time". If such rows exist for a
fact, they are read where they are. Only when nothing durable keeps a fact by
time does it get a table of its own.

That gives two kinds of figure:

| Kind | Examples | Where the number lives | Repair |
|------|----------|------------------------|--------|
| **Recorded** | messages, conversations, people, channels; limit refusals | a table written for it: `ChatActivityHour`, `AgentLoadDay` | rebuilt from the fact's source |
| **Read in place** | ratings, citations, hand-overs, incidents, spend | the event or day rows that exist anyway: `ChatFeedback`, `ChatMessageSource`, `AgentDelegation`, `AgentIncident`, `Usage` | none: the row is the source |

A rating can be changed or withdrawn, and a citation is one row from the
moment it is made. Copying either into a counter would create a second truth
that has to be kept equal to the first. So they are not copied.

## Messages by the hour

`ChatSession` keeps lifetime totals, and a conversation lasts until the
person starts a new chat, which can be weeks. "My messages in the last 30
days" therefore had no source. `ChatActivityHour` is that source: one row per
conversation and UTC hour, with the person's messages and the agent's.

**Live.** `IChatGateway.recordActivity` increments the lifetime totals once
per `session_activity` event and refuses an immediate repeat of the last one.
The hour is written in the same transaction, and only when that increment
applied. An event is counted in both or in neither, so for a conversation
that began after recording started:

```text
sum(userMessages)                 = userMessageCount
sum(userMessages + agentMessages) = messageCount
```

The transaction is given 15 seconds to get a connection, not Prisma's
default two: under a burst it waits its turn, as the single statement it
replaced did, instead of failing and losing the event from the totals too.

The socket handler does not wait for the write and a failure never reaches
the message. It is logged and repaired by the pass below. So is the far more
common loss: the runtime reports each message once and drops the report while
its socket is down.

**The settle pass** (`ChatActivityService`). Every 5 minutes it takes up to
100 conversations that are due, have been quiet for an hour and were active
in the last 180 days. It reads each transcript once, counts messages per
hour, and raises each stored hour to the transcript's count where that is
higher. It never lowers a value and never deletes a row, because compaction
shortens a transcript.

A conversation is due when `ChatSession.activityRebuiltAt` is null. The pass
stamps it; every write that moves the conversation on (a live event, a
reconcile of a changed file) sets it back to null. "Due" is therefore one
column with an index, and a run that has nothing to do reads nothing,
however many conversations there are. The stamp is the start of the run and
is refused for a conversation that moved on during it.

It counts what the live write counts: one message per stored user or
assistant event. A streamed answer is one event shown as several bubbles, so
the transcript is read with `bubbles: false`; counting bubbles would raise an
hour above what was reported live.

A conversation whose transcript cannot be read stays due and is tried again;
after three failures in a row it is reported once (`chat.activity`) and set
aside for an hour, so that the ones behind it in the queue are still read. A
conversation with no transcript at all is not a failure: there is nothing to
raise its hours to, so it is settled as it stands.

One pass, three jobs: filling history when an installation is upgraded,
recovering events lost to a restart, and giving a figure added later its
past.

| Number | Why |
|--------|-----|
| one hour quiet | the cooldown the summary batch uses, so both read a conversation at the same point in its life |
| 100 per run, every 5 minutes | about 10 to 20 seconds of sequential transcript reads, which leaves the single API process free; 28 800 conversations a day |
| 180 days back | the longest period shown (90 days) and the one before it |
| 400 days kept | the same, plus a year for a yearly view that would otherwise need new collection |

`STATS_SETTLE_INTERVAL_SEC` (default 300, `0` turns the pass off) and
`STATS_SETTLE_BATCH` (default 100) exist for an operator who has to slow it
down. No manifest sets them. The prune of hours older than 400 days runs at
boot and daily whatever they say, because the live write fills the table
either way.

Hourly rows, not daily, because a person's day is cut on their own clock: the
hours are assigned to local days when a period is read. An installation is
cut on UTC days, the boundary `Usage` and `AgentLoadDay` already have, so two
administrators in different zones see the same number. A zone with a
half-hour offset gets its days cut at the nearest whole hour.

## Limit refusals by the day

`AgentLoadMinute` is pruned at 30 days. `AgentLoadDay` is incremented by the
same deltas in the same transaction as the minute row, so a day can only
equal the sum of its minutes, and is kept 400 days. At boot, a day of the
last 30 that has minutes and no day row is set from its minutes.

## Spend outlives the agent

`Usage.agentId` is a plain column with no foreign key, and each row carries
the agent's name as it was when the usage was reported. Deleting an agent
does not change what a past period cost. With the key gone, the report route
is what refuses an agent that does not exist. A model missing from
`model-pricing.ts` has no price: `hasPrice()` says so, and a page shows it as
"no price" with tokens, never as zero.

## The figure registry

`api/src/slices/stats/domain/figures/` has one file per figure. A definition
says what the figure is called, which scopes it has, which public read method
of the owning slice returns it, and, for a recorded figure, how to find the
earliest moment its table covers. The `stats` slice owns periods, time zones, the registry and
the routes. It reads no table but its own, `StatFigure`.

`StatFigure` holds the first instant a recorded figure, one whose definition
names a `rebuild`, is complete from. The row is written once, the first time
the figure is seen at boot, and never moved later; a period that starts
before it carries a note, and the block says "counted since …" in one line
instead of showing a smaller number as if it covered the whole period. A
figure read in place has no row and never carries a note: its rows are the
source, so no rows before some day means nothing happened before that day,
and "counted since" would claim that something was missed. A row an earlier
release wrote for such a figure is removed at boot.

## Adding a figure

1. Write its definition file in `api/src/slices/stats/domain/figures/` and
   register it.
2. If the fact is not kept by time yet, add its recorder and its rebuild in
   the slice that owns the fact. Record it in the transaction that already
   writes the fact, so the two cannot disagree. No existing recorder or
   definition is edited.
3. Add its field to the response DTO and regenerate the SDK.

If step 2 is needed, ask first whether the fact really has no durable row
with a time on it. Most do.

## What a reviewer checks

- Does the page read rows by time, or does it count something on the way?
- Is a new counter a copy of rows that already exist?
- Is a recorded figure written in the same transaction as its fact, and does
  its rebuild only ever raise?
- Does a repeated event, a retry or a restart change the number?
- Does every interval, cap and retention carry its reason where it is
  defined?
- Is a person's figure reachable only by that person, and an installation
  figure filtered by reach, totals included?
- Does any statistics row hold message text? It must not.
