# Feature Specification: Slack Bot Transport — One Message per Incident, the Story in Its Thread

**Feature Branch**: `feat/CLEAN-165-slack-bot-transport`

**Created**: 2026-10-14

**Status**: Draft

**Ticket**: [CLEAN-165](https://dreamvention.atlassian.net/browse/CLEAN-165)

**Input**: User description: "CLEAN-165. Slack bot transport for agent failure notifications: one message per incident in the channel, the incident's story in that message's thread, a reaction on the message that mirrors the incident's state. Today (CLEAN-139) notifications go through a Slack incoming webhook, which can only drop a new message into one channel: no thread, no reaction, no edit. The owner wants the channel feed to stay one line per incident. […] Code red escalation is CLEAN-166, Telegram is CLEAN-143, both out of scope."

## Background

CLEAN-139 made Ranch tell the team when an agent goes down: one message when
an incident opens, one when it closes, through a Slack incoming webhook. After
a week of real alerts the owner looked at the channel and found it hard to
read. Every incident is two or more unrelated-looking messages; the one that
says "Agent back" lands far below the one that said "failed"; nothing on the
first message ever changes, so a red alert from the morning still looks red
in the evening even though the agent has been fine for hours.

The incoming webhook is the limit, not the text. A webhook can do exactly one
thing: drop a new message into the one channel it was created for. It cannot
reply in a thread, cannot put a reaction on a message, cannot edit what it
sent, and does not even tell Ranch which message it created. Everything the
owner asked for needs a Slack *bot*: an app the workspace admin installs once,
which can post, edit, react and reply in threads in any channel it is invited
to.

The owner already has that app ("Ranch Alerts"), re-installed with the two
permissions a bot needs for this (post messages, add reactions), and the shape
of the result was settled over three live mockups in the alerts channel on
2026-10-14. This feature is the agreed shape, nothing more:

```text
channel feed                                       thread of that message
──────────────────────────────────────────────     ──────────────────────────────────────
🔴 @channel Test Chatbot — incident #12            🔴 Failed — 4:04 PM
   · down since 4:04 PM · OOMKilled                   Cause: OOMKilled
   Open in Ranch                                      Reported by: events (via grafana)
                                                      Ranch sees: running — the two disagree
      ↓ a second report arrives
🔴 Test Chatbot — incident #12                     🔴 Failed again — 4:06 PM
   · down since 4:04 PM · OOMKilled · 2 reports       Cause: pod restarted, OOMKilled
                                                      Reported by: Ranch (its own watch) · 2 reports
      ↓ Ranch sees it running
🟢 Test Chatbot — incident #12                     🟢 Running again — 4:09 PM
   · up, watching since 4:09 PM · 2 reports           Seen by Ranch. Closes after 10 quiet minutes.
      ↓ ten quiet minutes
✅ Test Chatbot — incident #12                     ✅ Resolved — 4:19 PM
   · resolved 4:19 PM · downtime 5 min · 2 reports    Down for 5 min (4:04 → 4:09), stable for 10 min.
```

The root line is rewritten in place at every step; the reaction under it is
swapped (🔴 → 🟢 → ✅); the thread only grows. The channel mention is in the
first version of the root and nowhere else.

The webhook does not go away. An install that has no bot keeps today's
behaviour unchanged; the owner chooses which of the two to use.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One line per incident in the channel (Priority: P1)

An operator scrolling the alerts channel sees one message per incident. The
message says which agent, which incident, what state it is in now and since
when, and the cause. When the agent recovers, that same message changes to
say so — the operator does not have to find a second message and match it to
the first.

**Why this priority**: this is the whole reason for the feature. Without it
the bot is just a webhook with extra steps.

**Independent Test**: with the bot configured, post a failure for a running
agent, then let Ranch see it running for ten minutes. The channel holds
exactly one new message, and its text and reaction went through
down → up, watching → resolved.

**Acceptance Scenarios**:

1. **Given** the bot destination is set, **When** an incident opens,
   **Then** one message appears in the channel: state emoji, channel mention,
   agent name, incident number, "down since" the opening time, the cause, and
   a link to the agent's Events tab; the message carries the 🔴 reaction.
2. **Given** that message exists, **When** a second failure report joins the
   incident, **Then** the message is rewritten to show the report count and
   nothing else about it changes; the channel is not mentioned again; no new
   message appears in the channel.
3. **Given** the incident is open, **When** Ranch sees the agent running,
   **Then** the message reads "up, watching since <time>" with 🟢 as both the
   leading emoji and the reaction.
4. **Given** the agent stayed up for the quiet period, **When** the incident
   closes as recovered, **Then** the message reads "resolved <time> · downtime
   <span> · <n> reports" with ✅ as emoji and reaction, and the channel
   mention is gone from its text.
5. **Given** an incident closes without Ranch having seen the agent come back
   (an outside report, ten quiet minutes, no Ranch witness), **Then** the
   message reads "quiet since <time>, unconfirmed" with 🟢.
6. **Given** an incident closes because a person stopped or deleted the agent,
   **Then** the message reads "stopped by owner <time>" (or "deleted") with
   ⏹, and nobody is paged: no new message in the channel.

---

### User Story 2 - The story of the incident in its thread (Priority: P1)

An operator who wants to know what happened opens the thread under the
incident's message and reads it top to bottom: every report, every change
Ranch saw, and how it ended, each with its time.

**Why this priority**: the root line is deliberately short; without the
thread the detail that CLEAN-139 put in the channel (cause, who reported,
what Ranch saw) would be lost.

**Independent Test**: run the same incident as Story 1 and open its thread:
four replies, in order — Failed, Failed again, Running again, Resolved — each
with the time and the detail listed below.

**Acceptance Scenarios**:

1. **Given** an incident opens, **Then** the thread's first reply says
   "Failed" with the time, the cause as received, who reported it, and what
   Ranch held for the agent at that moment.
2. **Given** a further failure report joins, **Then** a reply "Failed again"
   with its time, cause, reporter and the running count is added — unless a
   repeat reply was added less than a minute ago, in which case only the root
   count changes and the report is still recorded in Ranch.
3. **Given** Ranch sees the agent running, **Then** a reply "Running again"
   with the time says the incident closes after the quiet period.
4. **Given** the incident closes, **Then** the last reply says how it closed
   — Resolved with the downtime, No further reports, Stopped, Deleted — and
   it is the only thing that can notify people who follow the thread; the
   channel itself is not pinged.
5. **Given** a reply could not be delivered, **Then** it is retried the way
   notifications are retried today, and the order of replies in the thread is
   the order of the events, never the order of successful retries.

---

### User Story 3 - The owner chooses the transport (Priority: P2)

The owner opens Settings → Notifications and picks either "Incoming webhook"
(today's) or "Slack bot". For the bot they paste the bot token and the channel
id, send a test, and see the delivery result. The token is a secret: once
saved it is never shown again, only a hint of it.

**Why this priority**: without the switch the bot cannot be turned on; but the
switch is worthless until Stories 1 and 2 give it something to carry.

**Independent Test**: as Owner, switch to the bot, paste token and channel,
press Test — a test message from the bot appears in the channel; reload the
page — the token is not there, only its hint and the channel id.

**Acceptance Scenarios**:

1. **Given** the page shows the webhook form, **When** the owner picks "Slack
   bot", **Then** the form asks for a bot token and a channel id, with a short
   guide: where the token comes from, which two permissions it needs, that
   the bot must be invited to the channel, where the channel id is found.
2. **Given** token and channel are saved, **When** the owner presses Test,
   **Then** a test message is posted to that channel by the bot and the page
   shows the result (delivered, or the error Slack gave) — never the token.
3. **Given** the bot is configured, **When** the owner reads the destination
   (page, API, or the Ranch agent), **Then** they get the kind, the channel
   id, a hint of the token and the last delivery result, never the token.
4. **Given** either transport is configured, **When** the owner switches to
   the other, **Then** the previous secret is discarded and incidents that
   open afterwards use the new transport; an incident that opened on the
   old one finishes on the old rules (its closing message is a plain post).
5. **Given** an Admin (not Owner) opens the page, **Then** they can read the
   destination but cannot change it — the same rule as today.
6. **Given** the Ranch agent is asked to set, read, remove or test the
   destination, **Then** it can do all of that for the bot kind as it can for
   the webhook today, under the same audience rules, and never shows the
   token.

---

### User Story 4 - The incident has a number (Priority: P2)

An operator can refer to an incident as "#12" in Slack, in the console and in
conversation. The number is short, unique within the install, and counts up.

**Why this priority**: the root line needs a short handle; the id Ranch has
today is a 36-character uuid nobody will read aloud.

**Independent Test**: open three incidents in a row; their numbers are
consecutive and appear in the Slack root, in the Events page incident list and
on the agent's Events tab.

**Acceptance Scenarios**:

1. **Given** two incidents open at the same moment on two agents, **Then**
   they get two different numbers.
2. **Given** incidents that existed before this feature, **Then** they get
   numbers too, in the order they opened, so the list is never half-numbered.
3. **Given** the Events page or the agent's Events tab, **Then** each incident
   shows its number next to the state.

---

### User Story 5 - The webhook still works as it did (Priority: P3)

An install without a bot — or an owner who does not want one — keeps today's
behaviour exactly: an opening message with the channel mention, a closing
message when the incident ends, nothing in between.

**Why this priority**: regressions here would hit the installs that are
already live.

**Independent Test**: with the webhook destination set, run the Story 1
incident: two messages, the same text as before this feature.

**Acceptance Scenarios**:

1. **Given** the webhook destination, **When** reports join or Ranch sees the
   agent running, **Then** nothing is sent (as today).
2. **Given** the webhook destination, **When** the incident closes as
   recovered or unconfirmed, **Then** the closing message of today is sent;
   stopped and deleted stay silent.

---

### Edge Cases

- **Slack refuses to edit** (the root was deleted by a person, or the message
  is too old to edit): the rewrite is dropped, the thread reply is still
  posted, the delivery is marked with the error. Ranch never re-posts a new
  root for the same incident.
- **The bot was removed from the channel**: every delivery fails with Slack's
  "not in channel"; the destination's last-delivery error says so in words
  the owner can act on, the outbox retries as today, nothing is lost in Ranch.
- **The token is revoked**: same as a wrong webhook address today — the
  delivery is marked failed and not retried, the Settings page shows the
  error.
- **A burst of reports** (the 60-per-minute flood limit of CLEAN-139 lets 60
  through): the thread gets at most one "Failed again" per minute; the root
  count still climbs with every report; the API and the console record all
  of them.
- **Two Ranch replicas** both decide to rewrite the root: the rewrite always
  renders from the incident's current state, so whichever lands last is right.
- **The incident closes before its root was ever delivered** (Slack was down
  the whole time): the thread replies and the rewrite wait for the root; when
  the root finally lands it is posted already in its final state, and the
  pending replies follow it in order.
- **The agent is renamed mid-incident**: the root keeps the name it opened
  with, as the console does today.
- **The destination is switched from bot to webhook while an incident is
  open**: switching discards the token (FR-006), so the bot can no longer
  write to the open incident's thread; its remaining updates are marked
  skipped (they are never spoken through the webhook), and only incidents
  opened after the switch use the webhook. *(Settled at implementation:
  the first draft said "finishes on the bot", which the discarded token
  makes impossible.)*
- **Times**: every time in the message is shown in the reader's own timezone
  by Slack, as today's messages do.

## Requirements *(mandatory)*

### Functional Requirements

**Destination**

- **FR-001**: The notification destination has a *kind*: `webhook` (today's)
  or `bot`. One destination per install, as today.
- **FR-002**: The `bot` kind holds a bot token and a channel id. The token is
  a secret: stored, used for delivery, never returned by any route, page,
  tool result or log line; a hint (its last four characters) is what the
  owner sees.
- **FR-003**: The channel id is not a secret and is returned with the
  destination.
- **FR-004**: Saving a `bot` destination validates the token shape and the
  channel id shape before storing; a test delivery is the proof that they
  work.
- **FR-005**: Only the Owner can set, change, test or remove the destination;
  Owner and Admin can read it — the rules of CLEAN-139 unchanged.
- **FR-006**: Switching kind discards the other kind's secret.
- **FR-007**: The Ranch agent's tools for the destination (get, set, remove,
  send test) accept and report the `bot` kind with the same audience rules
  and the same secret rule as the webhook.
- **FR-008**: Settings → Notifications offers the kind choice, the bot's two
  fields, the test button and the delivery result, with a guide to obtaining
  the token, the two required permissions, inviting the bot and finding the
  channel id.

**Root message (bot kind)**

- **FR-009**: When an incident opens, the bot posts one message to the
  channel: state emoji, channel mention, agent name, incident number, "down
  since" the opening time, the opening cause (shortened), and a link to the
  agent's Events tab. Ranch keeps the message's identity with the incident.
- **FR-010**: The root is rewritten in place at every change of the incident:
  a report joining (count), Ranch seeing the agent running ("up, watching
  since"), the close ("resolved <time> · downtime <span>", "quiet since
  <time>, unconfirmed", "stopped by owner <time>", "deleted <time>"), always
  with the report count.
- **FR-011**: The channel mention appears only in the first version of the
  root. Every rewrite omits it.
- **FR-012**: The bot keeps exactly one reaction of its own on the root — 🔴
  while down, 🟢 while up-and-watching or closed unconfirmed, ✅ resolved,
  ⏹ stopped or deleted — and swaps it on each state change. Reactions added
  by people are never touched.
- **FR-013**: Every rewrite renders from the incident's current state, not
  from the previous message text, so concurrent or out-of-order deliveries
  cannot leave a stale line.

**Thread (bot kind)**

- **FR-014**: Each of these events becomes one reply in the root's thread, in
  the order the events happened: the opening failure (time, cause, reporter,
  what Ranch held), a joining failure (time, cause, reporter, count), Ranch
  seeing the agent running (time), the close (time, resolution, downtime when
  the resolution is recovered).
- **FR-015**: A joining failure produces a reply at most once per minute per
  incident; reports inside that minute only move the root's count. Every
  report is still stored and shown in the console, as today.
- **FR-016**: Thread replies never mention the channel.
- **FR-017**: Stopped and deleted closes get their thread reply and root
  rewrite but no channel-level message — nobody is paged, as today.

**Delivery mechanics**

- **FR-018**: Every thing to say is one queued delivery, retried and
  rate-limited exactly as CLEAN-139 does for its two messages; a rewrite of
  the root rides on the delivery that caused it.
- **FR-019**: A thread reply is delivered only after the root it belongs to
  was delivered; replies for one incident are delivered in event order.
- **FR-020**: A failed rewrite or reaction does not fail the delivery of the
  reply it rode on; the error is recorded on the destination's last-delivery
  result so the owner can see it.
- **FR-021**: The webhook kind behaves exactly as before this feature: an
  opening and a closing message, no replies, no rewrites, no reactions; the
  "joined" and "running" events produce no delivery on it.
- **FR-022**: An incident whose root was posted on one kind finishes on that
  kind regardless of a later switch; an incident whose root could not be
  posted at all (no destination, or the destination failed permanently) is
  recorded as skipped, as today.

**Incident number**

- **FR-023**: Every incident gets a number, unique within the install,
  assigned in opening order, never reused; two incidents opening at the same
  instant get different numbers.
- **FR-024**: Existing incidents are numbered in the order they opened when
  the feature arrives.
- **FR-025**: The number is shown in the Slack root, in the Events page
  incident list, on the agent's Events tab and is returned by the incidents
  API and the Ranch agent's incident tool.

**Test message**

- **FR-026**: "Send test" on the bot kind posts a plain message to the channel
  from the bot (no thread, no reaction) and reports Slack's answer in words
  the owner can act on: delivered, not in channel, invalid token, channel
  not found.

### Key Entities

- **Notification destination**: one per install; kind (webhook | bot); for
  the webhook its address, for the bot its token and channel id; the secret's
  hint, who changed it and when, the last delivery result. The secret is
  write-only.
- **Incident** (existing): gains a sequential number, and — for the bot kind
  — the identity of its root message in the channel (which channel, which
  message) so replies and rewrites find it. Also records when the last
  "Failed again" reply was queued, for the one-per-minute rule.
- **Notification** (existing queued delivery): its kind grows from
  opened | closed to opened | joined | running | closed; it knows which
  incident it belongs to and is delivered in event order within that
  incident. Its payload is fixed at queue time as today; the root rewrite
  rendered at delivery time reads the incident's current state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For one incident of any length, the channel feed gains exactly
  one message; the thread gains one reply per event, in order.
- **SC-002**: The root's text and reaction reflect the incident's current
  state within one delivery tick (5 s) plus Slack's own latency of every
  change; a stale root never survives a successful later delivery.
- **SC-003**: 60 failure reports in one minute for one agent produce at most
  one "Failed again" reply per minute in the thread and a root count that
  reaches 60; the console lists all 60.
- **SC-004**: An install on the webhook kind sends byte-for-byte the same two
  messages as before this feature for the same incident.
- **SC-005**: No route, page, tool result or log line ever contains the bot
  token; the existing secret-leak test for tool results covers the new
  field.
- **SC-006**: The owner can switch to the bot and see a test message in the
  channel in under two minutes with the guide on the page, without a
  developer.
- **SC-007**: Every incident in an existing install has a number after the
  upgrade, and incident numbers never collide under concurrent opens (two
  replicas, same instant).

## Assumptions

- The bot app exists and is installed in the workspace by a Slack admin with
  the two permissions "post messages" and "add reactions"; inviting the bot
  to the channel is a manual step the guide describes. Ranch does not try to
  join channels on its own.
- One channel per install. Routing incidents to different channels is out of
  scope.
- "Code red" escalation when many agents fail at once is CLEAN-166, built on
  this transport; Telegram is CLEAN-143.
- The root link uses the console address Ranch already knows for CLEAN-139;
  when it is not configured the root has no link, as today.
- The one-per-minute rule for "Failed again" replies is fixed, not a setting.
- Slack's own limits (about one message per second per channel, and a cap on
  how old a message can be and still be edited) are accepted; a rewrite
  refused as too old is dropped with its error recorded, never re-posted.
- The incident number is a plain counter per install; it is not shown to
  outside senders and the ingest API does not change.
- Messages stay in English, as the alerts channel and the admin console are.
