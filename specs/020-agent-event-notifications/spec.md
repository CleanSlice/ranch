# Feature Specification: Agent Events — an Endpoint to Post Failures to, and a Notification When an Agent Goes Down

**Feature Branch**: `feat/CLEAN-139-agent-event-notifications`

**Created**: 2026-10-06

**Status**: Draft

**Ticket**: [CLEAN-139](https://dreamvention.atlassian.net/browse/CLEAN-139)

**Input**: User description: "Нужно имплементировать возможность постить события, эндпоинт который будет использовать девопс, чтобы в случае падения агента кубер или argocd (не уверен) будет пушить наше приложение и мы должны быть уведомлены о данном казусе. Контекст: "добавить в ранч возможность постить события. API ендпоинт с каким то POST Body - {agentid:..., status: failed, datetime: ... } то есть мне нужно энпдоинт создать, на который ты будешь с источника слать данные, такой флоу" Но я вот думаю, должно ли это по сокету приходить? и какой канал обратной связи нам для уведомлений использовать? на почту слать? в слак? какие интеграции необходимы, пока для меня эти детали под загадкой, проведи ресерч и помоги решить"

**Scope update (2026-10-06, at planning)**: three rules changed once the design
met the code. (1) An incident closes when Ranch itself has seen the agent
running for 10 minutes with no further failure — not on the first sign of
life, and not on an outside *recovered* event alone — so a recovery that does
not hold is never announced. (2) An outside event about an agent that a person
stopped, or that is in the middle of a start or restart, is recorded and does
not notify: an outside sender cannot tell a restart from a crash. (3) The
destination's secret is kept apart from the general settings, which hand
secret values back to the console.

**Scope update (2026-10-06, after the first real delivery to Slack)**: "так же
желательно тегать всех в канале" — the message about a failure mentions the
whole channel (FR-037). The message that an agent is back does not.

## Background

The request has two halves. One is stated: an address DevOps can post an event
to — "agent X failed at this time". The other is the reason for it: **the team
must find out when an agent goes down.** The research below was done to answer
the three questions the request leaves open — how the event should arrive,
where the notification should go, and which integrations that takes.

### What Ranch already notices on its own

Ranch is not blind today. It watches every agent it started, continuously, and
re-checks the whole cluster every 30 seconds.

| Situation | Does Ranch notice? | What it does |
|-----------|--------------------|--------------|
| Agent keeps crashing and restarting | Yes | Marks the agent *failed*, with the cause as the cluster gave it |
| Agent cannot start (image cannot be fetched, bad configuration) | Yes | Marks it *failed*, with the cause |
| Agent ran out of memory, or its process exited | Yes | Marks it *failed*, with the cause |
| Agent vanished from the cluster | Yes | Marks it *failed*; if this is found while Ranch itself is starting up, it also starts the agent again |
| Agent did not come up within 5 minutes of a start | Yes | Marks it *failed* |
| Agent is up in the cluster but never connected back to Ranch | Yes | Marks it *unreachable* |
| Ranch itself is down | No | — |
| Database, knowledge service, deploy pipeline or a cluster node is in trouble | No | — |

Two things are missing, and neither is detection:

1. **Nobody is told.** A status change reaches only the admin console screens
   that happen to be open. An agent that fails at night is found in the morning
   by whoever opens the list — or by a customer.
2. **Nothing is kept.** An agent has one current status and one current reason.
   When it recovers, the fact that it was down, when, and why is gone.

So for agents, an external event is a *second witness* to something Ranch
usually sees already. Its real value is in what Ranch cannot see — and that
shapes who the sender should be.

### Who can send the event

| Sender | What it knows about | Can it name an agent? | Installed in this cluster today? |
|--------|---------------------|-----------------------|----------------------------------|
| Argo CD (its notification feature) | The applications it deploys: the Ranch API, both consoles, the knowledge service, the infrastructure. Reports "sync failed" and "health degraded". | **No.** Agents are not Argo CD applications — Ranch starts them itself — so Argo CD has no idea an individual agent exists. | Argo CD yes; its notifications are not configured |
| Kubernetes | Nothing leaves Kubernetes by itself. It needs a small watcher installed next to it (kwatch, Robusta, an event exporter) or a monitoring stack (Prometheus with Alertmanager). | Yes. Every agent's pod carries the agent's id as a label, so a watcher can report it. | No watcher, no monitoring stack |
| A script or a person | Whatever they are told | Yes | — |

The request says "Kubernetes or Argo CD (not sure)". The answer matters:
**Argo CD cannot report an agent failure at all**, only a platform one. An
agent-level event has to come from a cluster watcher that DevOps installs. All
of these senders work the same way — they call a web address with a body the
operator writes — and none of them needs anything from Ranch beyond that
address and a credential.

### Should it arrive over a socket?

No. A plain web request is the right shape, for three reasons:

- **Every candidate sender speaks it and none speaks sockets.** Argo CD,
  cluster watchers and Alertmanager all deliver by calling an address. A socket
  would have to be written and run by DevOps as a separate program.
- **The sender's whole job is to work when things are broken.** A socket is a
  connection that must be kept alive, noticed when it drops and re-opened. A
  request has no state to lose.
- **A request gets an answer.** The sender learns at once whether the event was
  accepted, and its own retry takes care of the rest.

Sockets are the right tool in the other direction — Ranch pushing a change to a
console screen that is open — and Ranch already does that for agent status.

### Where should the notification go?

| Channel | What it takes to set up | Reaches someone who is not looking at Ranch? | Verdict |
|---------|-------------------------|----------------------------------------------|---------|
| The admin console (live, plus a list of past events) | Nothing outside Ranch | No | Always on. It is the record, not the alarm. |
| Slack | One secret address created in Slack. No bot, no account for Ranch. | Yes — a team channel, with a push to the phone | Strong first choice |
| Telegram | A bot and the id of the chat to write to | Yes | Equally workable. Agents already talk to Telegram, but Ranch's own server does not yet. |
| Email | A mail provider, a sender domain, deliverability work | Slowly. Incident mail is read late and buried quickly. | Not in the first version |
| An on-call service (PagerDuty, Opsgenie) | A paid account, schedules, escalation rules | Yes, with escalation | More than is needed now |

Recommendation: the console **and** one team chat. The console alone repeats
today's problem; chat alone leaves no history inside Ranch.

### Who watches whom

The request asks for an *independent* witness: a failed agent cannot report
its own failure, so the report has to come from something that stands above
it. That is true of both witnesses in this feature — neither is the agent.
Ranch's own watch runs in the Ranch server, a separate program that started
the agent and observes it from outside; an agent crashing does not stop Ranch
from seeing it. But every witness has something it depends on, and it is
worth being exact about what each one survives:

| What goes down | Ranch's own watch | An outside sender posting to Ranch | Argo CD writing to the chat directly |
|----------------|-------------------|------------------------------------|--------------------------------------|
| One agent | Sees it | Sees it — a second witness | Does not know agents exist |
| Ranch's watch stalls or misreads, Ranch otherwise up | Misses it | **Sees it — the case the endpoint exists for** | Does not know agents exist |
| The Ranch server itself | Gone with it | Sees it, but has nowhere to post: the address is down too | Sees it |
| The whole cluster, or the node everything runs on | Gone | Gone, if it runs in that cluster | Gone, if it runs in that cluster |

Three consequences:

1. **Both witnesses are worth having, and the event must say which one
   spoke.** An event reported only by an outside sender while Ranch sees the
   agent running means something different from one both agree on. Who
   witnessed it is therefore part of every event and every notification.
2. **The endpoint does not make Ranch its own watchdog.** An event posted to
   Ranch needs Ranch alive. "Ranch is down" has to travel a path that does not
   pass through Ranch.
3. **Nothing inside the cluster reports the cluster's own death.** That takes
   a check from outside it and is a DevOps matter beyond this feature.

### The case Ranch cannot cover

If Ranch itself is down, it cannot receive an event and cannot send a
notification. No design of this feature changes that. The remedy is outside
Ranch and costs no development: Argo CD can write to Slack directly, so "the
Ranch platform is degraded" should go from Argo CD **straight to the same
chat**, not through Ranch. This spec records that as a recommendation to
DevOps and does not build it.

## Clarifications

### Session 2026-10-06

- Q: Which chat is the first notification destination? → A: Slack. The owner
  creates an incoming-webhook address in Slack and pastes it into Ranch; the
  admin console is always included. Telegram is a later addition.
- Q: Do failures Ranch notices itself notify too, or only events posted from
  outside? → A: Both, with one notification per incident. Every event must
  carry who witnessed it — Ranch's own watch or a named outside sender — and
  the notification must show it.
- Q: Are platform events with no agent in scope? → A: No. An event always
  names an agent. Who the outside sender will be is DevOps's choice and is not
  known yet; the endpoint is described so that any tool able to call a web
  address can use it.
- Q: Should the event arrive over a socket? → A: No — a plain web request. See
  *Should it arrive over a socket?*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - DevOps reports an agent failure to Ranch (Priority: P1)

A DevOps engineer points a piece of cluster tooling at Ranch. When that tooling
decides an agent is down, it sends Ranch a short message: which agent, what
happened, when. Ranch answers at once that it has the event. The engineer wires
this up from a written description of the message, using a credential that can
do nothing except report events.

**Why this priority**: This is the request as stated, and everything else hangs
off it. On its own it already leaves a record that an outside witness saw an
agent fail.

**Independent Test**: With a valid credential, send one event for an existing
agent from a terminal. The answer confirms acceptance, and the event can be
found afterwards with the agent, the status, the time it happened and the time
it arrived.

**Acceptance Scenarios**:

1. **Given** a valid credential and an existing agent, **When** a "failed"
   event is sent for it with a time, **Then** Ranch confirms acceptance and the
   event is stored with the agent, the status, the reported time and the time
   of arrival.
2. **Given** no credential, a wrong one or a revoked one, **When** an event is
   sent, **Then** it is refused, nothing is stored and nobody is notified.
3. **Given** a message with no agent, no status or a status Ranch does not
   know, **When** it is sent, **Then** it is refused with an answer that names
   what is wrong and lists the statuses Ranch accepts.
4. **Given** an event with no time in it, **When** it is sent, **Then** it is
   accepted and the time of arrival is used as the time it happened.
5. **Given** an event with an optional cause ("out of memory") and the name of
   the tool that sent it, **When** it is accepted, **Then** both are stored
   with it, word for word.
6. **Given** an event for an agent id Ranch does not know, **When** it is sent,
   **Then** it is accepted and stored, marked as not matching any agent — the
   sender is not asked to retry something that will never match.
7. **Given** a credential issued for reporting events, **When** it is used for
   anything else — reading agents, changing a setting — **Then** it is refused.

---

### User Story 2 - The team hears about a failed agent without looking (Priority: P1)

An agent goes down in the evening. Within a minute a message appears in the
team's chat: which agent, what happened, why if known, when, who reported it,
and a link straight to that agent in the admin console. The person who reads it
does not need Ranch open, and does not need to decode an id.

**Why this priority**: This is why the feature exists. An endpoint that stores
events nobody is told about changes nothing for the team.

**Independent Test**: With a destination set up, send a "failed" event for an
agent. A message naming that agent arrives in the chat within a minute, and its
link opens the agent's page.

**Acceptance Scenarios**:

1. **Given** a notification destination is set up, **When** a "failed" event
   for a known agent is accepted, **Then** one message reaches the destination
   with the agent's name, what happened, the cause if one was given, the time
   it happened, the sender, and a link to the agent.
2. **Given** the event came from outside, **When** the message is written,
   **Then** it also says what Ranch itself sees for that agent right now — so a
   reader can tell "the cluster and Ranch agree" from "the cluster says failed,
   Ranch says running".
3. **Given** the destination cannot be reached, **When** a notification is due,
   **Then** the event is still accepted and stored, delivery is tried again,
   and if it never succeeds the event is shown in the console as *not
   delivered*.
4. **Given** no destination is set up, **When** an event is accepted, **Then**
   it is stored and shown in the console, and the console says plainly that
   nobody outside it is being notified.
5. **Given** an event for an agent Ranch does not know, **When** it is
   accepted, **Then** no chat message is sent; it appears in the console only.
6. **Given** a cause supplied by the sender, **When** it is shown in a message
   or in the console, **Then** it appears as received — not translated,
   reworded or reformatted.

---

### User Story 3 - A failure Ranch notices itself is announced the same way (Priority: P2)

Ranch marks an agent failed or unreachable on its own, as it does today. The
team gets the same chat message and the same record as for an event that came
from outside, with Ranch named as the one who noticed.

**Why this priority**: Ranch already sees most agent failures and no cluster
watcher is installed yet. Without this story the team is notified only after
DevOps adds new tooling; with it, the notification works the day it ships.

**Independent Test**: With no outside sender configured, make an agent fail
(give it an image that does not exist). A chat message naming the agent and the
cause arrives, and the failure is in the event list.

**Acceptance Scenarios**:

1. **Given** Ranch marks an agent failed, **When** the change is recorded,
   **Then** an event with Ranch as the sender is stored and one notification is
   sent, carrying the cause Ranch recorded.
2. **Given** Ranch marks an agent unreachable, **When** the change is recorded,
   **Then** the same happens, and the message says *unreachable*, not *failed*.
3. **Given** a person stops, restarts or deletes an agent, **When** its pod
   goes away as a result, **Then** no failure event and no notification are
   produced.
4. **Given** Ranch and an outside sender both report the same failure of the
   same agent, **When** both are recorded, **Then** both are kept and the team
   receives one notification, not two.

---

### User Story 4 - One incident, one message (Priority: P2)

An agent that cannot start fails again every few minutes, and each attempt
produces another event. The team's chat gets one message when the trouble
starts and one when it ends — not one per attempt.

**Why this priority**: A channel that fires twenty times for one problem is
muted within a day, and then the next real failure is missed. Quiet matters as
much as delivery.

**Independent Test**: Make an agent fail, send twenty more "failed" events for
it over ten minutes, then bring it back and leave it running. The chat holds
exactly two messages — one when it failed, one once it has stayed up — and the
event list holds every event.

**Acceptance Scenarios**:

1. **Given** the team was notified that an agent failed, **When** more "failed"
   events arrive for that agent, **Then** they are all stored and none of them
   notifies again while the incident is open.
2. **Given** an open incident, **When** Ranch has seen the agent running for
   10 minutes with no further failure reported, **Then** one message says the
   agent is back and how long it was down, and the incident is closed.
3. **Given** an agent that comes up and fails again within 10 minutes, **When**
   the second failure arrives, **Then** it continues the same incident: no
   second "failed" message, and no "back" message in between.
4. **Given** a "recovered" event from outside, **When** it arrives, **Then** it
   is stored as evidence and sends no message by itself; the incident closes
   by the rule in scenario 2.
5. **Given** the same event delivered twice by a sender retrying, **When** the
   second copy arrives, **Then** it is stored once.
6. **Given** a person stops or deletes an agent that has an open incident,
   **When** that happens, **Then** the incident is closed without a message —
   the person who did it already knows.

---

### User Story 5 - Operators can see what happened, and when (Priority: P2)

An operator opens the admin console in the morning and sees the events of the
night: which agents went down, when, why, who reported it, whether the team was
notified, and whether each has recovered. On an agent's own page they see that
agent's history. While the console is open, a new event appears without a
reload.

**Why this priority**: Chat is the alarm; this is the record. It is also the
only place an event is visible when no destination is set up or delivery
failed.

**Independent Test**: Send three events for two agents. The event list shows
all three, newest first; one agent's page shows only its own; a fourth event
sent while the list is open appears without reloading.

**Acceptance Scenarios**:

1. **Given** events exist, **When** an owner or admin opens the event list,
   **Then** they see each event's agent, status, cause, time, sender and
   whether the team was notified, newest first.
2. **Given** the list is open, **When** a new event is accepted, **Then** it
   appears within a few seconds without a reload.
3. **Given** an agent's page, **When** it is opened, **Then** that agent's
   events are shown there, and only that agent's.
4. **Given** an event marked as not matching any agent, **When** it is shown,
   **Then** it carries the id the sender gave and is clearly marked as unknown.
5. **Given** a person who is neither owner nor admin, **When** they try to see
   events, **Then** they cannot.
6. **Given** a time on an event, **When** it is shown in the console, **Then**
   it follows the console's own date and time rules.

---

### User Story 6 - The owner sets it up without a developer (Priority: P3)

An owner opens the admin console, pastes in where notifications should go,
presses "send a test" and sees the test message arrive. They create a
credential for DevOps, copy it once, and can revoke it later. A page tells
DevOps exactly what to send and where.

**Why this priority**: The first install can be set up by hand by the team that
built it. Every later install — and every credential rotation — needs this.

**Independent Test**: On a fresh install, set a destination, send a test and
see it arrive; create a credential, post an event with it, revoke it, and see
the next event refused.

**Acceptance Scenarios**:

1. **Given** an owner, **When** they save a destination and send a test,
   **Then** a clearly labelled test message arrives, or the console says why it
   did not.
2. **Given** an owner, **When** they create a credential for a sender, **Then**
   its secret value is shown once, and afterwards only its name, when it was
   created and when it was last used.
3. **Given** a revoked credential, **When** it is used, **Then** the event is
   refused.
4. **Given** the destination's secret, **When** it is shown anywhere after
   saving — a page, a log, an answer from the Ranch agent — **Then** its value
   is hidden.
5. **Given** a DevOps engineer with the written description and a credential,
   **When** they wire up a sender, **Then** they need nothing else from the
   development team.

---

### User Story 7 - Ask the Ranch agent what happened (Priority: P3)

An owner asks the Ranch admin agent in chat, "what went down last night?" or
"what happened to the support agent yesterday?", and gets the events back, the
same ones the console shows.

**Why this priority**: The console is a window and the chat is the hands: what
an operator can read in the console, the Ranch agent must be able to answer.
It is last because the record has to exist first.

**Independent Test**: With events recorded, ask the Ranch agent for last
night's events. The answer lists the same events as the console, with no
secret in it.

**Acceptance Scenarios**:

1. **Given** recorded events, **When** an owner or admin asks the Ranch agent
   about a period or an agent, **Then** the answer lists the matching events
   with their status, cause, time and sender.
2. **Given** a person who may not see events in the console, **When** they ask
   the Ranch agent, **Then** it does not show them either.
3. **Given** any answer about events or their setup, **When** it is produced,
   **Then** it contains no credential and no destination secret.

---

### Edge Cases

- **A flood**: a broken sender posts hundreds of events a minute. Beyond 60 a
  minute from one credential the rest are refused with a "slow down" answer;
  other senders are unaffected, and the chat still gets one message per
  incident.
- **A late event**: Ranch was unreachable and the sender delivers an hour-old
  event afterwards. It is stored with both times — when it happened and when
  it arrived — and the message shows when it happened.
- **A time in the future or absurdly far in the past**: accepted, stored as
  sent, and ordered by time of arrival so it cannot jump to the top of the
  list or hide at the bottom.
- **The agent was deleted** between the failure and the event: stored, marked
  as not matching any agent, no chat message.
- **A stopped agent**: an outside sender reports "failed" for an agent a
  person stopped on purpose. It is stored and shown in the console with that
  explanation; no message is sent.
- **A restart in progress**: a person restarts an agent, and an outside sender
  sees the old pod die and reports "failed". It is stored and no message is
  sent. If the start then really fails, Ranch's own watch says so within 5
  minutes and that opens the incident.
- **Outside and inside disagree**: an outside sender says failed while the
  agent is connected and answering. The event is stored and notified, the
  message says what Ranch sees, and the agent's status in Ranch does not
  change.
- **Recovery never reported**: a sender reports failures but never
  recoveries. Nothing depends on it: the incident closes when Ranch has seen
  the agent running for 10 quiet minutes, and stays open and visible as open
  until then.
- **A false alarm from outside**: a sender reports a failure Ranch never saw,
  and the agent keeps running. The team is told once, with the disagreement
  shown; ten quiet minutes later the incident closes with a message that says
  so. It cannot stay open for ever and silence later, real failures.
- **Many agents at once**: a node is lost and ten agents fail in the same
  minute. Each is its own incident; the messages arrive as ten, not as a
  hundred.
- **The destination is down for an hour**: events keep being accepted;
  delivery is retried for a limited time and then marked *not delivered*
  rather than arriving as a burst of stale alarms the next day.
- **The secret leaks**: a credential is revoked and from that moment nothing
  sent with it is accepted; events already recorded stay.
- **An oversized or malformed message**: refused with a clear answer; nothing
  is stored.
- **Ranch is down**: nothing can be received or sent. See *The case Ranch
  cannot cover* above.

## Requirements *(mandatory)*

### Functional Requirements

**Receiving an event**

- **FR-001**: The system MUST offer a way for an outside sender to report an
  event with a single web request carrying the agent it concerns, a status and
  the time it happened.
- **FR-002**: The system MUST accept an event only from a sender presenting a
  valid credential issued for reporting events. Without one, nothing is stored
  and nobody is notified.
- **FR-003**: A credential issued for reporting events MUST NOT give access to
  anything else in Ranch.
- **FR-004**: The system MUST accept a fixed, documented set of statuses — at
  least *failed* and *recovered* — and MUST refuse any other with an answer
  that lists the accepted ones.
- **FR-005**: An event MAY also carry a cause in the sender's own words and
  the name of the tool that sent it. The system MUST store both as received.
- **FR-006**: The system MUST record, for every accepted event, both the time
  the sender says it happened and the time it arrived. If the sender gives no
  time, the time of arrival is used for both.
- **FR-007**: The system MUST answer the sender whether the event was accepted
  or refused, and why if refused, without waiting for any notification to be
  delivered.
- **FR-008**: An event for an agent the system does not know MUST be accepted,
  stored and marked as not matching any agent, and MUST NOT notify outside the
  console.
- **FR-009**: The same event delivered more than once MUST be stored once.
- **FR-010**: The system MUST refuse events from one credential beyond 60 a
  minute, with an answer that says so. (One a second is far above any honest
  sender on an install with tens of agents, and low enough that a runaway
  sender cannot fill the record.)
- **FR-011**: An event received from outside MUST NOT change the status Ranch
  itself holds for the agent. Ranch's own observation stays the only source of
  an agent's status.
- **FR-012**: An event MUST name an agent. Events about the platform itself,
  with no agent, are out of scope and are refused like any other message with
  a missing field.
- **FR-034**: Every event MUST record who witnessed it: Ranch's own watch, or
  an outside sender. For an outside sender the identity MUST be taken from the
  credential it presented, not from what the message says about itself, so a
  sender cannot pass for another or for Ranch. The tool name of FR-005 is
  extra detail next to it, never a replacement.

**Notifying**

- **FR-013**: The system MUST send a notification to the configured destination
  when an incident opens for a known agent and when it closes.
- **FR-014**: The destination for the first version MUST be a Slack channel,
  reached through an address the owner creates in Slack and saves in Ranch.
  The admin console is always included alongside it.
- **FR-015**: A notification MUST name the agent by its name, say what
  happened, give the cause if there is one, the time it happened, who
  witnessed it (FR-034), what Ranch itself currently sees for that agent, and
  a link to the agent in the admin console. When an outside sender and Ranch
  disagree about the agent, the notification MUST make that visible rather
  than pick a side.
- **FR-037**: The notification that an incident opened MUST mention everyone
  in the channel, so that it reaches people who are not looking. The
  notification that it closed MUST NOT mention anyone. Text supplied by a
  sender MUST NOT be able to add a mention of its own.
- **FR-016**: A notification MUST NOT contain a credential, a secret or the
  contents of an agent's configuration.
- **FR-017**: A failure the system notices on its own — an agent it marks
  failed or unreachable — MUST produce an event with Ranch as the witness and
  notify in the same way as an event from outside. Changes a person asked for
  — stop, restart, delete — MUST NOT produce a failure event.
- **FR-018**: While an incident is open for an agent, further failure events
  for that agent MUST be stored and MUST NOT notify again.
- **FR-019**: A failure of the same agent within 10 minutes of its coming back
  up MUST continue the same incident rather than open a new one, and no
  "back" notification MUST have been sent in between. (The cluster itself
  treats a restarted container as stable only after it has run for 10
  minutes; before that it is still the same crash loop.)
- **FR-020**: An incident MUST close when the system itself has seen the agent
  running for 10 minutes with no further failure event, and the closing
  notification MUST say how long the agent was down. A *recovered* event from
  outside is stored as evidence and MUST NOT close an incident on its own.
- **FR-035**: An incident MUST close without a notification when a person
  stops or deletes the agent.
- **FR-036**: An outside failure event for an agent that the system holds as
  stopped, or as being started or restarted, MUST be stored with that
  explanation and MUST NOT open an incident or notify.
- **FR-021**: When two senders report the same failure of the same agent, both
  events MUST be stored and one notification sent.
- **FR-022**: If a notification cannot be delivered, the system MUST retry for
  a limited time, MUST record the outcome on the event, and MUST NOT lose or
  refuse the event because of it.
- **FR-023**: With no destination configured, events MUST still be accepted,
  stored and shown, and the console MUST say that notifications are not set
  up.

**Seeing and managing**

- **FR-024**: Owners and admins MUST be able to see events in the admin
  console — all of them, newest first, and each agent's own on that agent's
  page — with status, cause, both times, sender and notification outcome.
- **FR-025**: An event accepted while the list is open MUST appear in it
  without a reload.
- **FR-026**: People who are neither owner nor admin MUST NOT be able to see
  events.
- **FR-027**: An owner MUST be able to set the notification destination, send
  a test notification and see whether it was delivered.
- **FR-028**: An owner MUST be able to create a credential for a sender, see
  its secret value exactly once, see when it was last used, and revoke it.
- **FR-029**: The destination's secret and every credential MUST be hidden
  wherever they are shown after saving.
- **FR-030**: The Ranch admin agent MUST be able to answer an owner's or
  admin's question about recorded events, within the same limits as the
  console.
- **FR-031**: The system MUST provide a written description of what a sender
  has to send — the address, the credential, the fields, the accepted
  statuses, the answers — complete enough to wire a sender without asking the
  development team, and stating how a cluster tool finds an agent's id.
- **FR-032**: Text supplied by a sender MUST be shown as received and MUST NOT
  be translated or reformatted. Times MUST follow the admin console's own
  format.
- **FR-033**: Events MUST be kept for 90 days and then removed.

### Key Entities

- **Event**: one report that something happened to an agent. Has the agent it
  concerns (or the unmatched id the sender gave), a status, an optional cause,
  the sender, the time it happened, the time it arrived, and the incident it
  belongs to.
- **Incident**: one stretch of trouble for one agent, from the first failure
  to the recovery. Groups the events of that stretch. It is what the team is
  notified about — once when it opens, once when it closes.
- **Sender (witness)**: whoever reported the event — an outside tool
  identified by its credential, or Ranch's own watch. Never the agent the
  event is about. An incident can have more than one witness.
- **Sender credential**: a named secret that allows reporting events and
  nothing else. Created and revoked by an owner; shown once.
- **Notification destination**: where the team is told. One per install, set
  by an owner, holding a secret.
- **Notification**: one message about an incident opening or closing, with its
  delivery outcome — delivered, retrying or not delivered.
- **Agent status**: what Ranch itself currently believes about an agent. Read
  by this feature, never written by an outside event.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When an agent goes down, the team's chat has a message naming it
  within 60 seconds of the event being accepted, in at least 95% of cases.
- **SC-002**: A sender gets its answer — accepted or refused — within 2
  seconds in at least 95% of requests.
- **SC-003**: 100% of accepted events can be found in the admin console, each
  with the time it happened and the time it arrived.
- **SC-004**: Twenty failure events for one agent within ten minutes, followed
  by the agent staying up, produce exactly two chat messages.
- **SC-005**: Zero events are stored, and zero notifications sent, for a
  request without a valid credential.
- **SC-006**: A credential for reporting events is refused by every other part
  of Ranch it is tried against.
- **SC-007**: During an hour-long outage of the destination, zero events are
  lost: every one is in the console, marked with its delivery outcome.
- **SC-008**: A DevOps engineer wires up a new sender in under 30 minutes
  using only the written description and a credential.
- **SC-009**: An owner goes from an empty setup to a test message in the chat
  in under 5 minutes.
- **SC-010**: An agent that a person stops, restarts or deletes produces zero
  failure notifications.
- **SC-011**: The team learns of an agent failure from the chat before anyone
  reports it by hand, in every failure during the first month of use.

## Assumptions

- **A web request, not a socket.** See *Should it arrive over a socket?*
  above.
- **The sender shapes the message to Ranch's description.** Argo CD and the
  cluster watchers let the operator write the body. Tools that send only their
  own fixed format, such as Alertmanager, are not supported in the first
  version; none is installed in this cluster.
- **DevOps installs and owns the sender.** Choosing and running a cluster
  watcher is outside Ranch. Ranch provides the address, the credential and the
  description.
- **An outside event informs, it does not decide.** Ranch's own watch already
  settles an agent's status and has rules for restarts and stale signals that
  an outside sender knows nothing about. Letting an outside event write the
  status would set the two against each other.
- **The sender is not chosen yet.** Which tool posts the events is DevOps's
  decision. The endpoint is described for any tool that can call a web address
  with a header and a body, and nothing in it is specific to one tool.
- **Agent events only.** Argo CD, which knows the platform and not the agents,
  is therefore not a sender to this endpoint; its place is the direct path to
  the chat described under *The case Ranch cannot cover*.
- **Slack first, Telegram later.** A second destination is a separate piece of
  work; nothing in the first version should make it harder.
- **Email is out of the first version.** It needs a mail provider this product
  does not have and is the slowest channel to be read.
- **One destination per install.** Routing by agent, by severity or by person,
  quiet hours, escalation and on-call schedules are out of scope.
- **No reminders.** An incident notifies when it opens and when it closes. An
  incident that stays open is visible in the console as open; repeating the
  alarm is out of scope.
- **Admin console only.** Events are an operator's concern. The customer
  console is unchanged, and a customer is not told that their agent went down.
- **Owners and admins.** Seeing events follows the roles that already manage
  agents; setting the destination and issuing credentials is the owner's.
- **Ranch being down is not covered here.** DevOps is advised to send
  "platform degraded" from Argo CD directly to the same chat.
- **90 days of history** is enough to investigate an incident and is the
  common default for operational records.
- **No automatic reaction.** This feature tells people. Restarting an agent
  because an outside event said so is out of scope; the restart Ranch already
  does for agents it finds missing when it starts up is unchanged.
