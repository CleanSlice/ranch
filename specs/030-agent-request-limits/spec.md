# Feature Specification: Request limits for agents, with a live load view and a "try again in" notice

**Feature Branch**: `feat/CLEAN-224-agent-request-limits` (spec directory `030-agent-request-limits`)

**Created**: 2026-11-16

**Status**: Draft

**Ticket**: [CLEAN-224](https://dreamvention.atlassian.net/browse/CLEAN-224)

**Input**: User description: "Необходимо провести анализ и выполнить реализацию лимитов для публичных агентов, сейчас блок Visibility & embed доускает разные статусы для агента, и если он публичных, то лимиты обязательны, для приватных - опционально. Проработай разные комбинации кейсов. Речь про ограничения в количестве запросов в минуту. Это так же можно настроить, в час или в день. Ну и какаято визуализация статистики чтобы понимать нагрузку на агента в реально времени. Пользователям при общении с агентом (в https://ranch.cleanslice.org/ есть публичных агент) Нужно будет выводить плашку, когда заполнены лимиты, через сколько можно отправить запрос. Чтобы все было максимально интуитивно, посмотри как правильно масштабировать нашего агента для этого. И нужны ли изменения в bridle виджет, все таки его это тоже касается. По умолчанию лимиты выключены у всех"

## Background

A public agent can be talked to by anyone who opens the landing page or a site
that embeds the chat widget. Nothing caps how many requests it takes. Each
request costs model spend and occupies the agent, so one busy visitor or one
script can make the agent slow for everyone and run up a bill nobody agreed to.

The request asks for analysis first. These are the findings, checked against
this repository and the widget repository on 2026-11-16.

### What "public" means today

1. **One flag, two meanings.** An agent is public or private. The flag is set by
   a checkbox labelled "Show on landing page" in the agent form; the
   "Visibility & embed" card only shows it as a badge and edits the allowed
   origins. Public means both "listed on the landing page" and "a visitor on an
   allowed origin may chat with no credential".
2. **A share link is a third way in.** An agent can have one share link. It
   works whether the agent is public or private, and whoever holds the link
   chats without an account.
3. **A private agent is not closed to anonymous callers.** The two request
   routes meant for integrations (send, and send-and-wait) accept a message
   with no credential for any agent, private ones included. The allowed-origin
   check only stops browsers; a script that sends no origin passes. This is a
   gap in its own right (see *Out of scope*), and it matters here because
   "private" cannot be read as "only known people".

### Where requests come from

4. **Every request that the platform relays passes one point**, whichever way
   it arrived: the widget, the landing chat, the share page, both consoles'
   chats, the two integration routes, and agent-to-agent delegation. A limit
   placed there covers all of them at once.
5. **Three sources never pass that point**: Telegram (the agent talks to
   Telegram by itself), the agent's own scheduled runs, and evaluation runs.
   The platform cannot count or refuse them.
6. **An anonymous visitor has no stable identity.** The landing chat gets a new
   random identity on every connection, the widget's anonymous identity is
   chosen by the browser, and the integration routes mint a new one per
   request. A limit "per visitor" that trusts those identities is defeated by
   reloading the page. Only a verified identity (a signed-in user, an embed
   token, a share-link visitor) or the caller's network address is stable
   enough to count against.

### How a refusal reaches the person today

7. The platform can already answer a sent message with "rejected" and a reason,
   but only two consoles understand it, and the only reason they know is "agent
   offline". The widget does not read that answer at all: it gets a fake reply
   from the agent saying "Agent is not connected. Please try again later."
8. Each chat surface draws its own notices inline: the app console has a red
   error strip above the composer, the admin console has a muted line in the
   message list, the widget has an error banner for connection problems. None
   of them can show a wait time, and none disables the composer.
9. **The widget lives in a separate repository** (`CleanSlice/bridle`, checked
   at 0.15.1) and is loaded by customers from a "latest" address. Four things
   about it matter here:
   - It sends a message and never looks at the answer, so it cannot learn that
     a message was refused. It shows the visitor's bubble, empties the message
     field and waits; against a refusing platform that is a sent-looking
     message and typing dots that never stop.
   - Its message field and Send button are never unavailable, and Enter,
     suggestion chips, forms and the offline queue all send by themselves.
   - Its texts are English and fixed; a few can be replaced by the host page,
     one attribute per text. There is no language switch.
   - **The "latest" address is behind.** It serves 0.13.3, from August 2026,
     while the published package is 0.15.1: the address is refreshed by a
     separate site deployment, not by publishing the package. A widget change
     released the usual way does not reach embedded sites until that
     deployment is run.

   The same repository holds a second chat client (a Nuxt layer) and a
   reference copy of the hub with the protocol documentation; all three
   describe the same wire format by hand.

### What the operator can see today

10. Token usage is recorded per agent **per day**. Message counts per
    conversation are rebuilt from the agent's files on demand, not live. The
    only live feed carries agent status (running, connected), not load. There
    is nothing that answers "how busy is this agent right now".

### How an agent scales today

11. **One agent is one running copy with one connection to the platform.** A
    second copy of the same agent replaces the first; there is no way to put
    two behind one name. Requests are forwarded to it immediately, with no
    queue and no cap on how many are in progress at once.
12. **The platform itself runs as one copy on purpose** (CLEAN-140): who is
    connected and which conversation goes where is held in its memory. So
    counters kept by the platform are consistent without any shared store, and
    they are lost on a restart unless they are written down.

**Conclusion on scaling.** Running more copies of an agent is not available
today and is a project of its own. The lever that exists is admission: decide
how much one agent may take, refuse the rest politely with an exact wait time,
and show the operator the load so the numbers can be chosen from evidence
rather than guessed. That is this feature. The live view deliberately includes
"requests in progress right now", because that — not requests per minute — is
what tells an operator the agent itself is the bottleneck and a bigger change
is needed.

## Scope

**In scope:**

- Limits per agent on the number of requests per minute, per hour and per day.
- The rule that a public agent must have limits, and a private one may.
- One allowance per agent, shared by everyone who talks to it. **Decided
  2026-11-16.**
- A live load view for the operator in the admin console.
- A notice with a countdown on every chat surface the platform owns: landing
  chat, share page, app console chat. Operators in the admin console chat are
  not limited and get a line of their own.
- The same notice in the embed widget — a companion change in the widget
  repository, delivered under the same ticket, together with its second chat
  client, the protocol documentation, and a refresh of the "latest" address so
  the change actually reaches embedded sites.
- A machine-readable refusal for integrations that call the request routes.
- The Ranch agent can read and change limits and read the load (constitution
  principle V).

**Out of scope:**

- **A separate limit per visitor — next phase, not this one.** Decided
  2026-11-16: the allowance is the agent's and everyone draws on it, so nobody
  has to be identified and a share-link chat needs no special handling. The
  known cost is that one sender can use up the allowance for everyone; the
  load view is where that would show. If it does, the second layer is one
  rule — count by account when the sender is signed in or carries an embed
  token, otherwise by network address (finding 6) — and a share-link visitor
  is then simply an anonymous one.
- **Telegram and the agent's own scheduled runs.** They do not pass through the
  platform (finding 5). Limiting them belongs to the agent runtime and is a
  separate ticket if wanted. The settings screen says so in plain words, so
  nobody assumes a Telegram bot is covered.
- **Closing the anonymous integration routes for private agents** (finding 3)
  — [CLEAN-226](https://dreamvention.atlassian.net/browse/CLEAN-226). It is an
  access problem, not a load problem. This feature only makes sure that
  limits, once set, count those calls too.
- **What the live status feed hands an anonymous subscriber** —
  [CLEAN-225](https://dreamvention.atlassian.net/browse/CLEAN-225). Today it
  carries every agent's full record with no sign-in. This feature must not add
  limit settings or load figures to that record while it is open (see the
  privacy requirements); closing the feed itself is that ticket.
- **Running several copies of one agent**, queues, or priorities between
  visitors.
- **Limits on spend or tokens.** This feature counts requests only.
- **Limits per installation or per customer account** across several agents.

## The cases

"Request" below means one message from a person or a calling system that the
platform accepted for delivery to the agent.

### Visibility × limits

| # | Agent is | Limits | What the platform does |
|---|----------|--------|------------------------|
| 1 | Private | Off (the default) | Nothing changes. No counting against a limit, no refusals. Load is still shown. |
| 2 | Private | On | Limits are enforced exactly as for a public agent. |
| 3 | Private, with an active share link | Off | Allowed, but the settings screen warns that anyone with the link can use the agent without a cap. |
| 4 | Public | On | Enforced. This is the only valid state for a public agent that has been saved after this feature ships. |
| 5 | Public | Off — the operator tries to switch them off | Refused, with the reason: a public agent needs at least one limit. Make the agent private first. |
| 6 | Private → public, no limits set | — | The change is refused until at least one limit is filled in; the limit fields open in the same step, so it is one save, not two. |
| 7 | Public → private | On | Limits stay as they were and become optional; the operator may now switch them off. |
| 8 | Public, saved before this feature, no limits | Off | Keeps working uncapped — the rollout changes nothing by itself. The agent is flagged "public without limits" in the agent list and on its page until limits are set, and any later save of its visibility settings requires them. |
| 9 | Public, no allowed origins | On or missing | Same as any public agent: limits are required. The browser path is closed without origins, but the integration routes are not (finding 3). |

### Who is counted

| Sender | Counts toward the agent's limits | Notes |
|--------|----------------------------------|-------|
| Anonymous visitor on the landing page or an embedded widget | Yes | |
| Widget visitor with an embed token | Yes | |
| Share-link visitor | Yes | No special handling: same allowance as everyone else. |
| Signed-in user in the app console | Yes | They are the agent's audience, not its operators. |
| Integration calling the request routes | Yes | With or without a credential. |
| Operator (a signed-in Owner or Admin, from either console) | No | The operator must be able to reach an agent that is at its limit, to test and to fix it. It is the person who is exempt, not the screen. Shown in the load view as operator traffic. |
| Another agent delegating a task | No | Agent-to-agent traffic already has its own chain limit; refusing it mid-task would break the calling agent's answer. Shown in the load view. |
| Telegram, scheduled runs, evaluations | Not seen by the platform | Out of scope. |

### What the person sees

| Situation | The person sees |
|-----------|-----------------|
| A limit is full | "This agent has reached its message limit. Try again in 0:42." The same words whoever filled it. |
| Several windows are full at once (minute and day) | One notice, with the longest wait. Never a countdown that ends in another refusal. |
| The wait is long (hours) | The time of day it reopens, in the reader's own timezone and language, instead of a running clock: "Try again after 14:30." |

## The notice in the chat

What the person goes through, step by step. The same on the landing chat, the
share page, the app console chat and the embedded widget.

### What it says

Two short lines and nothing else:

- **What happened**: "This agent has reached its message limit." It names the
  agent and the limit — not the reader, not an error, not "something went
  wrong". In Russian: «У этого агента достигнут лимит сообщений.»
- **What to do**: "Try again in 0:42." / «Попробуйте через 0:42.»

| The wait is | The second line reads |
|-------------|-----------------------|
| Under a minute | "Try again in 0:42." — seconds tick |
| Under an hour | "Try again in 12:05." — minutes and seconds tick |
| An hour or more, same day | "Try again after 14:30." — no ticking |
| Past midnight | "Try again tomorrow after 09:15." |
| Just ended | "You can send your message now." — for a moment, then the notice leaves |

It never shows the limit's numbers, how much is used, or how many people are
talking to the agent.

### Where it is and how it looks

- Attached to the top edge of the message field, the same width, so the eye
  finds it where the hand already is. Not in the conversation, not a pop-up
  over the page, not a toast that leaves by itself.
- Calm: the neutral information colour with a clock, never the red of an
  error. A thin line across it shortens as the wait runs out; a reader who
  asked their device for less motion gets the text alone.
- At most two lines on a phone, and it never pushes the message field off the
  screen when the keyboard is open.
- It cannot be dismissed. It is a state, not an alert: it leaves when the
  state ends.

### What the person can still do

- **Keep typing.** The message field stays editable the whole time; the wait
  is a good moment to finish the thought. Text and attachments stay where they
  are.
- **Read.** The conversation scrolls, copies and rates as usual, and an answer
  the agent was already writing keeps arriving — the limit is about the next
  message, not the one in progress.
- **Not send.** The Send button is visibly off and carries the same wait for
  someone who goes straight to it. Pressing Enter does not fail silently: the
  notice gives a brief nudge so the person sees why nothing left. Suggestion
  chips and a form's submit button are off in the same way.

### When it appears

- **After a refused send**, at once: the message does not appear in the
  conversation, no typing dots start, the text is still in the field and the
  notice is above it.
- **On opening the chat**, when an hour or day window is already full: the
  notice is there before the person writes anything, so nobody composes a long
  message only to be refused. A full minute window is not announced ahead — it
  clears within a minute, and showing it to people who are only reading would
  make the notice flicker.
- **While the chat is open**, by the same rule: a person in the middle of
  typing learns that the hour or day window has filled without having to send.
- **An empty conversation** — the visitor's first message on the landing
  page — gets the same notice; it has to make sense to someone who has not
  seen the agent answer yet, which is why it names the agent's limit rather
  than "you".

### When it ends

- The notice says "You can send your message now", the Send button comes
  back, the cursor is still in the field. The person presses Send.
- **Nothing is sent by itself.** If every waiting chat fired at the same second
  most would be refused again, and a message leaving without a keypress is not
  what the person asked for.
- **If someone else took the free slot first**, the send is refused again and
  the notice returns with the new wait, in the same words, with the text still
  in the field. It reads as "still busy", not as a new failure.
- **If the limit is raised or switched off** while the person waits, the notice
  leaves early.

### What it survives

- **A reload or a second tab** shows the same remaining wait, by the rules in
  *When it appears*.
- **A tab left in the background** shows the right remaining time the moment
  it is looked at again, not a clock that stopped.
- **A dropped connection** during the wait shows the usual reconnecting state;
  the notice stays until its time is up and is re-checked once the connection
  is back.

### For someone who cannot see it

- A screen reader hears the two lines once when the notice appears and "You
  can send your message now" once when it ends — not every second in between.
- The Send button says why it is off and for how long.
- Nothing depends on colour or on the shrinking line alone.

### The operator in the admin console

Operators are not limited, so they never get this notice for themselves.
Their chat with an agent that is at its limit shows one quiet line instead:
"Visitors are being asked to wait — this agent is at its message limit. Your
messages are not limited." with a link to the limits. An operator testing the
agent must not conclude that it is fine for everybody.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An operator caps a public agent (Priority: P1)

The owner of a public agent opens its "Visibility & embed" card and sets how
many requests the agent takes per minute, per hour and per day. From the moment
they save, the agent stops accepting requests above those numbers, whichever
way they arrive.

**Why this priority**: This is the protection itself. Without it nothing else
in the feature has anything to show or to count against.

**Independent Test**: Set a limit of 3 requests per minute on a public agent,
send 4 messages within a minute from the landing page, and confirm the fourth
never reaches the agent while the first three were answered.

**Acceptance Scenarios**:

1. **Given** a public agent with a limit of 3 per minute, **When** a fourth
   request arrives within the same 60 seconds, **Then** it is not delivered to
   the agent and the sender is told how long to wait.
2. **Given** that fourth request was refused, **When** the stated wait has
   passed, **Then** the next request is accepted.
3. **Given** a private agent with limits off, **When** the operator makes it
   public without filling in a limit, **Then** the save is refused, the limit
   fields are shown, and the agent stays private.
4. **Given** a public agent with limits, **When** the operator tries to switch
   limits off, **Then** the save is refused with the reason and the limits stay.
5. **Given** a private agent, **When** the operator saves it with limits off,
   **Then** the save succeeds and nothing is refused.
6. **Given** a public agent saved before this feature, with no limits,
   **When** the feature ships, **Then** it keeps answering as before and is
   marked "public without limits" until an operator sets them.
7. **Given** a limit of 100 per hour with 80 already used, **When** the
   operator lowers it to 50, **Then** new requests are refused from that moment
   and the wait reflects when usage drops below 50.
8. **Given** limits on an agent, **When** the same 10 requests arrive through
   the widget, the share page and the integration routes in any mix, **Then**
   they draw on the same allowance.

---

### User Story 2 - A person chatting is told when they can write again (Priority: P1)

Someone is talking to the public agent on the landing page. The limit fills up.
Instead of an error or silence, they see a calm notice on the message field:
this agent has reached its message limit, try again in 0:42. Their text is
still in the field and they can keep editing it. When the time comes the notice
tells them they can send, and they press Send. The full behaviour is in *The
notice in the chat*.

**Why this priority**: A limit without this reads as a broken product. The
person on the public site is the one the notice is for, and that site is the
platform's shop window.

**Independent Test**: With a limit of 1 per minute, send two messages from the
landing chat and confirm the second produces a notice with a countdown, keeps
the typed text, and can be sent with one click when the countdown ends.

**Acceptance Scenarios**:

1. **Given** the limit is full, **When** the person sends a message,
   **Then** a notice appears above the composer with the remaining wait, the
   message is not shown as sent, and the text stays in the composer.
2. **Given** the notice is showing, **When** the wait ends, **Then** the notice
   goes away without a reload and Send works.
3. **Given** the notice is showing, **When** the person tries to send again,
   **Then** nothing is sent and nothing more is counted.
4. **Given** the person has two tabs open, **When** one tab is refused,
   **Then** the other shows the same wait the next time it tries, not a fresh
   allowance.
5. **Given** the person reloads the page during the wait, **When** they send
   again, **Then** they are refused with the remaining wait, not a full one and
   not a fresh allowance.
6. **Given** the limit was filled by other people and this person has sent only
   one message, **Then** the notice speaks of the agent's limit and never suggests
   that they wrote too much.
7. **Given** the app console is in Russian, **Then** the notice reads «У этого
   агента достигнут лимит сообщений. Попробуйте через 0:42.» with the time in
   the reader's format.
8. **Given** the same situation on the share page, in the app console chat and
   in the embedded widget, **Then** each shows the same notice with the same
   wait.
9. **Given** the notice is showing, **Then** the person can still edit their
   text, scroll and copy the conversation, and an answer that was already
   arriving keeps arriving.
10. **Given** the notice is showing, **When** the person presses Enter,
    **Then** nothing is sent and the notice visibly draws attention to itself.
11. **Given** the agent's hour limit is already full, **When** a person opens
    the chat, **Then** the notice is there before they type, with the time of
    day they can write again.
12. **Given** only the minute limit is full, **When** a person opens the chat
    and only reads, **Then** no notice is shown.
13. **Given** the wait has ended, **Then** the notice says the message can be
    sent, nothing is sent by itself, and one press of Send delivers it.
14. **Given** the wait has ended but someone else used the freed room first,
    **When** the person sends, **Then** the notice returns with a new wait in
    the same words and the text is still in the composer.
15. **Given** a person is waiting, **When** the operator raises the limit,
    **Then** the notice leaves without a reload.
16. **Given** the wait runs past midnight, **Then** the notice says "tomorrow
    after" and the time, with no running clock.
17. **Given** an operator chats from the admin console with an agent at its
    limit, **Then** their message goes through and a line tells them visitors
    are being asked to wait.

---

### User Story 3 - An operator watches the load live (Priority: P2)

The operator opens the agent's page and sees how busy the agent is right now:
how much of each limit is used, how many requests are in progress, how the last
hour went minute by minute, and how many requests were refused. The numbers
move while they watch. They use them to decide whether the limits are too tight
or too loose.

**Why this priority**: Limits chosen blind are either useless or harmful. The
view is what makes the first story's numbers defensible — but the protection
works without it.

**Independent Test**: Open the agent page, send a burst of requests from
another browser, and confirm the meters and the chart change within a few
seconds without a reload, including the refused ones.

**Acceptance Scenarios**:

1. **Given** an agent with limits, **When** the operator opens its page,
   **Then** each window shows used against allowed, and the time until the
   window has room again when it is full.
2. **Given** the page is open, **When** requests arrive, **Then** the figures
   update within 5 seconds with no reload.
3. **Given** an agent with limits off, **Then** the same view shows the load
   with no ceiling drawn, and the highest minute, hour and day it has seen, so
   the operator has something to choose limits from.
4. **Given** requests were refused, **Then** the view shows how many, when the
   last one was, and which window caused them.
5. **Given** operator and agent-to-agent traffic, **Then** it is visible in the
   view and marked as not counted toward the limits.
6. **Given** the agent list, **Then** an agent that is at a limit right now, or
   public without limits, is recognisable without opening it.
7. **Given** the platform restarted an hour ago, **Then** the day figure still
   includes what was used before the restart.

---

### User Story 4 - An integration is refused in a way it can act on (Priority: P3)

A customer's backend calls the platform to send a message to an agent. When the
limit is full it receives a refusal it can tell apart from a failure, with the
number of seconds to wait.

**Why this priority**: Integrations exist and must not be handed a hang or a
generic error, but they are fewer than people in a chat and their authors read
documentation.

**Independent Test**: With the limit full, call the send route and the
send-and-wait route and confirm both answer at once with a "too many requests"
refusal that carries the wait.

**Acceptance Scenarios**:

1. **Given** the limit is full, **When** an integration sends a request,
   **Then** it is refused immediately — the send-and-wait route does not wait —
   with a distinct "too many requests" result and the wait in seconds.
2. **Given** the limit is not full, **Then** the answer tells the integration
   how much of the tightest window remains, so it can pace itself.

---

### User Story 5 - The Ranch agent manages limits from the chat (Priority: P3)

An operator asks the Ranch agent "what are the limits on the support agent and
how loaded is it?" or "set 30 per minute on it". The agent answers and makes
the change, under the same rules as the console.

**Why this priority**: The constitution requires a tool for every console
capability. It is not what the customer feels first.

**Independent Test**: Ask the Ranch agent to read the limits and current load
of an agent, then to change one limit, and confirm the console shows the new
value.

**Acceptance Scenarios**:

1. **Given** an operator asks for an agent's limits and load, **Then** the
   Ranch agent reports the same figures the console shows.
2. **Given** an operator asks to switch off limits on a public agent,
   **Then** the Ranch agent refuses for the same reason the console does.
3. **Given** an operator asks to remove or loosen limits, **Then** the Ranch
   agent asks for confirmation before doing it.

---

### Edge Cases

- **The agent is offline.** The request is refused as offline, as today, and
  does not use up allowance.
- **The same message is sent twice** by a client retrying after a dropped
  connection. It counts once.
- **A refused request** does not count toward any window, so hammering Send
  during the wait does not extend it.
- **One sender uses up the whole allowance.** Everyone else is refused until
  the window has room; this is the accepted cost of a shared allowance. The
  load view shows the burst, and the operator's remedies are a tighter minute
  limit against a looser day limit, or the per-visitor phase.
- **A visitor's device clock is wrong.** The wait is given as a duration and
  counted down locally, so a wrong clock cannot produce a negative or absurd
  wait.
- **The limit is changed while people are waiting.** A notice already on screen
  keeps its countdown; the next attempt gets the wait under the new limit.
- **Limits are switched off while people are waiting.** Their next attempt goes
  through, even if their countdown has not ended; the composer must not be
  locked on the countdown alone.
- **A site embeds an older widget** that does not know the new refusal. The
  visitor still gets a readable message in the conversation saying when to try
  again, in English, with no countdown. They are never left with silence or a
  spinner.
- **A message with a form or an attachment** counts as one request, whatever
  its size.
- **A refused form or suggestion chip.** A form the agent asked the person to
  fill stays editable and is not marked as submitted; a suggestion chip can be
  pressed again after the wait. Neither is lost.
- **Messages typed while offline** and queued by the chat are held, not fired
  all at once, when the connection returns during a wait.
- **The person presses "New chat" during the wait.** The wait stays: the
  allowance is the agent's, not the conversation's.
- **A long agent answer** that is still streaming does not hold a request slot
  open: limits count requests accepted, not answers in progress. Requests in
  progress are shown in the load view only.
- **A limit of zero** is not a way to close an agent and is refused; the
  smallest limit is one.
- **Minute, hour and day limits that contradict each other** (an hour limit
  lower than the minute limit) are refused on save with the reason, because the
  larger window would make the smaller one unreachable.
- **The platform restarts.** Hour and day usage survive; a restart must not
  hand everyone a fresh daily allowance.
- **An agent is deleted or recreated.** Its counters and history go with it.

## Requirements *(mandatory)*

### Functional Requirements

**Limits and their rules**

- **FR-001**: An operator MUST be able to set, per agent, a maximum number of
  requests per minute, per hour and per day. Each window is optional on its
  own; an agent "has limits" when at least one is set.
- **FR-002**: Limits MUST be off for every agent by default, existing and new,
  and shipping this feature MUST NOT refuse a single request on an agent whose
  settings nobody touched.
- **FR-003**: A public agent MUST have at least one total limit. The platform
  MUST refuse to make an agent public without one, and MUST refuse to remove
  the last limit from a public agent, each time stating the reason.
- **FR-004**: A private agent MAY have limits. When it has them they MUST be
  enforced identically to a public agent's.
- **FR-005**: Making a public agent private MUST keep its limits and make them
  optional.
- **FR-006**: A public agent that had no limits before this feature MUST keep
  working, MUST be marked as "public without limits" wherever agents are listed
  and on its own page, and MUST require limits on the next save of its
  visibility settings.
- **FR-007**: A private agent with an active share link and no limits MUST show
  a warning on its settings, without blocking the save.
- **FR-008**: An agent's allowance MUST be shared by everyone who talks to it.
  The platform MUST NOT need to know who a sender is in order to count or
  refuse a request, and a share-link conversation MUST be counted exactly like
  any other.
- **FR-009**: The platform MUST refuse limits that are not positive whole
  numbers, and combinations where a longer window allows fewer requests than a
  shorter one, each with a reason a person can act on.
- **FR-010**: The setting that makes an agent public and its limits MUST be
  editable in one place, the "Visibility & embed" card, so the rule in FR-003
  can be satisfied in a single save.
- **FR-011**: Only the roles that may edit an agent today (Owner, Admin) may
  change its limits.

**Counting and refusing**

- **FR-012**: A window MUST cover the most recent 60 seconds, 60 minutes or 24
  hours, moving with time, so that a visitor cannot double their allowance by
  sending around a clock boundary.
- **FR-013**: Every request the platform relays to an agent MUST be checked
  against the limits before delivery, regardless of how it arrived: widget,
  landing chat, share page, app console chat, and the integration routes.
- **FR-014**: Requests from operators in the admin console and from other
  agents MUST NOT be refused by limits and MUST NOT use up allowance; they MUST
  still be shown in the load view, marked as such.
- **FR-015**: A refused request MUST NOT be delivered to the agent, MUST NOT be
  queued for later, and MUST NOT count toward any window.
- **FR-016**: A request the platform recognises as a repeat of one it already
  accepted MUST count once.
- **FR-017**: A request refused because the agent is offline MUST NOT count.
- **FR-018**: A change to limits MUST take effect for the next request, with no
  restart of the agent or the platform, and MUST keep the usage counted so far.
- **FR-019**: Usage for the hour and day windows MUST survive a restart of the
  platform.
- **FR-020**: Every refusal MUST carry: that a limit was the reason, and how
  long until a request will be accepted — the longest wait among all windows
  currently full.

**What the person chatting sees**

- **FR-021**: On every chat surface a limited person uses — landing chat,
  share page, app console chat, embedded widget — a full limit MUST appear as
  a notice attached to the composer, built as described in *The notice in the
  chat*. It MUST NOT be styled as an error, MUST NOT appear as a message from
  the agent, MUST NOT be saved into the conversation, and MUST NOT be
  dismissible.
- **FR-022**: The notice MUST say two things in this order: that this agent
  has reached its message limit, and when to try again. It MUST NOT say or
  imply that the reader did something wrong, and MUST NOT reveal the limit's
  numbers, the usage, or how many other people are talking to the agent.
- **FR-023**: The notice MUST count down without a reload, MUST show the right
  remaining time after the tab was in the background, MUST say that the
  message can be sent when the wait ends and then leave, and Send MUST work
  from that moment.
- **FR-024**: Nothing MUST be sent automatically when the wait ends. If the
  person's next send is refused again because others used the freed room, the
  notice MUST return with the new wait in the same words and the text MUST
  still be in the composer.
- **FR-025**: The refused text MUST remain in the composer, with any
  attachments, and MUST NOT appear in the conversation as sent or as failed;
  no "agent is typing" state may start for it.
- **FR-026**: The composer MUST stay editable for the whole wait, and the
  conversation MUST stay readable; an answer already in progress MUST keep
  arriving.
- **FR-027**: While the notice shows, Send MUST be visibly unavailable and MUST
  itself state the wait, and an attempt to send MUST NOT reach the platform —
  by the button, the keyboard, a suggestion, a form, or a queue of messages
  typed while offline. An attempt by keyboard MUST draw attention to the
  notice rather than do nothing visible.
- **FR-028**: When an hour or day limit is already full, a chat MUST show the
  notice on opening and while open, before the person sends anything. A full
  minute limit MUST be shown only after a refused send.
- **FR-029**: A change that makes room — the window moving on, a raised limit,
  limits switched off — MUST remove the notice from open chats without a
  reload.
- **FR-030**: A wait under one hour MUST be shown as a running countdown; a
  longer one as the time of day the person can write again, in their timezone,
  saying "tomorrow" when it falls on the next day.
- **FR-031**: An operator chatting from the admin console with an agent that
  is at its limit MUST see that visitors are being asked to wait and that
  their own messages are not limited, with a way to the limit settings.
- **FR-032**: In the app console, landing chat and share page the notice MUST
  follow the active language and its date and number formats; the operator's
  line in the admin console is English. In the widget it is English by default and the host
  page can replace the wording, the way it replaces the widget's other texts.
- **FR-033**: The notice MUST be announced to assistive technology once when it
  appears and once when the wait ends, not on every tick of the countdown, and
  MUST NOT rely on colour or motion alone; a reader who asked for reduced
  motion gets no animation.
- **FR-034**: On a phone-width screen the notice MUST fit in two lines and
  MUST NOT push the composer out of view with the keyboard open.
- **FR-035**: A chat client that does not understand the new refusal MUST still
  receive a human-readable line in the conversation that says a limit was
  reached and when to try again, and MUST NOT be left showing that the agent
  is typing.
- **FR-036**: A page that embeds the widget MUST be able to learn that a
  message was refused for a limit and for how long, as its own signal, not as
  an error, so it can react in its own interface.
- **FR-037**: The address customers load the widget from MUST serve the build
  that understands the refusal before limits are announced as available; a
  published package alone does not count as delivered.

**How it is proven**

- **FR-038**: The behaviour in *The notice in the chat* and in User Stories 1
  to 3 MUST be covered by automated browser tests that drive the real
  consoles against a running platform with a real database — not mocks of the
  chat. They live with this spec (`specs/030-agent-request-limits/e2e`), the
  way earlier features keep theirs.
- **FR-039**: The browser tests MUST cover at least: a refused send on the
  landing chat, the share page and the app console chat (notice shown, text
  kept, nothing added to the conversation, Send off); the countdown ending and
  the message then going through; a second refusal after the wait; reload and
  a second tab during the wait; an hour limit already full when the chat
  opens; the long-wait wording; the Russian wording in the app console; a
  raised limit clearing the notice; the operator's line in the admin console
  and the operator not being limited; the save rules for public and private
  agents in "Visibility & embed"; the live load view moving after a burst; and
  an agent with limits off refusing nothing.
- **FR-040**: The tests MUST be runnable by one command on a developer
  machine in under 10 minutes, which means they MUST NOT have to sit through a
  real hour or day window to see one end.
- **FR-041**: The feature is not done until those tests have actually been
  run and passed against the finished build, and the pull request names the
  command and the result. Written but not run does not count.
- **FR-042**: The counting rules (windows, what counts, what is exempt, the
  wait that is reported) MUST have their own fast tests that need no browser,
  and the widget MUST be covered by its own automated tests plus one browser
  check on a page that embeds it.

**What an integration receives**

- **FR-043**: The integration routes MUST answer a limited request at once,
  with a result distinguishable from every other failure and the wait in
  seconds; the send-and-wait route MUST NOT hold the call open.
- **FR-044**: A successful answer on those routes MUST tell a caller that
  presented a credential how much of the tightest window remains. An
  anonymous caller is told nothing beyond the wait on a refusal.

**What the operator sees**

- **FR-045**: The agent's page in the admin console MUST show, live: for each
  window, requests used against the limit; requests in progress right now; the
  last hour minute by minute; and requests refused, by the window that caused
  them, with the time of the latest.
- **FR-046**: The live figures MUST update within 5 seconds of a request,
  without a reload, and MUST stop consuming resources when nobody is looking.
- **FR-047**: The load view MUST work for an agent with limits off, showing
  load without a ceiling and the highest minute, hour and day observed in the
  last 30 days, placed next to the limit fields as the basis for choosing them.
- **FR-048**: The agent list MUST mark an agent that is currently at a limit
  and an agent that is public without limits.
- **FR-049**: The settings screen MUST state which traffic limits do not cover:
  operators, agent-to-agent, Telegram and scheduled runs.
- **FR-050**: The app console's read-only view of an agent's visibility MUST
  show whether limits are on, so its twin of the admin screen does not
  contradict it. Editing limits and the load view stay in the admin console.

**Privacy and safety**

- **FR-051**: Limit values and usage figures MUST be visible only to roles that
  may edit the agent. Nothing an anonymous caller can read — the public agent
  list, the status feed, the refusal itself — may expose them beyond the wait
  in FR-020.
- **FR-052**: Counting MUST NOT store anything about who sent a request: no
  account, no network address, no message content.

**The Ranch agent**

- **FR-053**: The Ranch agent MUST be able to read an agent's limits and
  current load, and to set them, for the same roles and under the same rules as
  the console, including the refusal in FR-003.
- **FR-054**: The Ranch agent MUST ask for confirmation before removing or
  loosening a limit.

### Key Entities

- **Agent limits**: belong to one agent. Up to three limits (minute, hour,
  day). Absent means off. Changing them is recorded with who and when.
- **Usage**: how many requests an agent accepted in its current minute, hour
  and day windows, plus requests in progress. Short-lived by nature; the hour
  and day parts survive a restart.
- **Load history**: per agent, requests accepted and refused per minute for the
  recent past, and the observed peaks for 30 days. Feeds the chart and the
  suggested values. Holds counts only — no message content, no visitor
  identities.
- **Refusal**: what a sender receives when a limit is full — the reason and
  the wait.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a limit of N per window, an agent never receives more than N
  counted requests in any span of that window's length, measured over a
  sustained burst of at least 10 × N requests from several senders at once.
- **SC-002**: After this feature ships and before anyone changes a setting, the
  number of requests refused for a limit across the installation is zero.
- **SC-003**: A person who is refused, and is the only one waiting, sends their
  message successfully on the first attempt after the countdown ends; the wait
  they were shown is never shorter than the real one and never longer by more
  than 2 seconds. With several people waiting, a repeated refusal always shows
  a new wait and never an error.
- **SC-004**: Shown the notice with no explanation, at least 9 of 10 people
  can say in their own words that the agent's message limit is reached and
  when they can write again.
- **SC-005**: Every browser test listed in the requirements passes on the
  finished build, in one run of under 10 minutes.
- **SC-006**: A person who is refused never loses what they typed (0 cases in
  testing across all four chat surfaces a limited person uses).
- **SC-007**: An operator can take a private agent public, limits included, in
  one save and under one minute, without reading documentation.
- **SC-008**: A request that arrives is reflected in the operator's live view
  within 5 seconds.
- **SC-009**: A refusal is returned to the sender within 1 second, on every
  surface including the send-and-wait route.
- **SC-010**: On a site that embeds a widget build from before this feature, a
  limited visitor still reads when to try again (no silent failure, no endless
  spinner).
- **SC-011**: After a restart of the platform, the day usage shown for an agent
  differs from the figure before the restart by no more than the requests
  accepted in the last minute before it.
- **SC-012**: Checking a limit adds no delay to a request that a person could
  notice (under 50 ms at the busiest observed load).

## Assumptions

- **"Request" means one message sent to the agent**, whatever it contains. The
  request did not ask for token or cost limits and none are included.
- **Both "mandatory for public" and "off by default for everyone" hold**, by
  reading the first as a rule on saving, not on rollout: nothing is switched on
  behind an operator's back, and an existing public agent is nagged rather than
  capped or closed (case 8). The alternative — forcing default numbers onto
  existing public agents at rollout — would refuse real visitors on day one
  with values nobody chose.
- **No numbers are pre-filled.** Any default would be a guess about someone
  else's traffic. The fields show the agent's own observed peaks instead; an
  agent with no history shows none and the operator decides.
- **One allowance per agent, shared by all senders** (decided 2026-11-16). It
  answers the request — load on the agent and its budget — with no need to
  tell senders apart. A per-visitor layer is deferred until the load view
  shows a single sender starving the rest.
- **Operators and agent-to-agent traffic are exempt**, for the reasons given in
  the table of who is counted. If agent-to-agent load turns out to matter, it
  shows in the load view first.
- **Windows move with time** rather than resetting on the clock. A calendar day
  would need a timezone per agent and lets a visitor spend two days' allowance
  around midnight.
- **Signed-in app console users draw on the same allowance as anonymous
  visitors.** They are the agent's audience, not its operators.
- **The load view is an admin-console screen.** The app console is where people
  use agents; it gets the notice and a read-only "limits on" line, not the
  charts.
- **The platform keeps running as a single copy** (CLEAN-140), which is what
  lets it count consistently by itself. If that ever changes, counting is one
  of the things that has to move with it.
- **The widget change ships from the widget repository** under this ticket.
  It reaches embedded sites only once the "latest" address is refreshed, which
  today is a separate deployment that has not run since August 2026; that
  refresh is part of this delivery and also carries the two widget releases
  already waiting behind it (0.14 and 0.15), so it needs its own check on a
  real embedding page. Sites on a pinned older build fall back to FR-035.
- **Depends on** the existing roles (Owner, Admin), the existing "Visibility &
  embed" card, and the live agent-status feed as the place a per-agent "at
  limit" mark can travel.
