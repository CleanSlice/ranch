# Feature Specification: Profile statistics dashboard

**Feature Branch**: `feat/CLEAN-258-profile-stats-dashboard` (spec directory `038-profile-stats-dashboard`)

**Ticket**: [CLEAN-258](https://dreamvention.atlassian.net/browse/CLEAN-258) `[APP]`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "@C:\Users\maxim\Downloads\profile-stats-prototype.html - Есть проработанный прототип для дашборда пользователя нужно его имплементировать и оживить реальными метриками, продумать масштабируемую систему для собирания данных"

**Source materials**: `reference/profile-stats-prototype.html` in this directory — the prototype, copied as received. It is the visual and behavioural reference: layout, colours, card order, wording, empty states. Its sticky top bar (role switch, data switch, "where the numbers come from") is a prototype control, not part of the design; the notes it reveals are the starting point of the *Data inventory* below. Every number in it is synthetic.

## Why

The profile page ("Pass", CLEAN-217) answers "which account is this and what
is it allowed to do". It was built on one rule: show only what the console
already holds, invent nothing. That rule left the page without a single
number about what the person actually does here.

The prototype adds that: a Statistics tab with the person's own conversations
and, for an owner or administrator, the installation. The rule stays. A
statistic that is guessed, silently partial, or counted differently in two
places is worse than no statistic, so half of this feature is the page and
the other half is how the numbers are gathered: recorded when things happen,
kept by day, rebuildable for the past, and cheap to read however large the
history grows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My statistics at a glance (Priority: P1)

A signed-in person opens their profile and sees two tabs next to the pass:
Statistics (open by default) and Account (the cards the page has today,
unchanged). On Statistics they pick 7, 30 or 90 days and see a scoreboard
(conversations, their own messages, agents that answered them out of those
they can reach, share of questions resolved), each with a comparison to the
previous period of the same length; an activity calendar of the last 13
weeks with the selected period highlighted, a by-weekday breakdown, the
busiest weekday and the number of active days; and "who you talk to": the
agents ranked by the person's messages, as an orbit and as a list, with
conversations, last contact and resolved share per agent.

**Why this priority**: This is the page a person sees. It needs no
conversation summaries, so it works on every installation from day one.

**Independent Test**: Sign in as an account with known conversations, open
the profile, switch between 7, 30 and 90 days: every figure equals an
independent recount of that account's conversations for that range. Open the
Account tab: the three cards that exist today are there, unchanged.

**Acceptance Scenarios**:

1. **Given** a person with conversations in the last 30 days, **When** they open their profile, **Then** the Statistics tab is selected, the period is 30 days, and the scoreboard, activity and agents blocks show their figures.
2. **Given** the Statistics tab, **When** the person selects 7 or 90 days, **Then** every block recalculates for that period and each comparison refers to the previous 7 or 90 days.
3. **Given** a period with no data in the previous period, **When** the scoreboard renders, **Then** the comparison reads "no data for the previous period" instead of a percentage.
4. **Given** the activity calendar, **When** the person switches it to the table view, **Then** the same days and counts are listed as rows.
5. **Given** a person who has never talked to an agent, **When** they open Statistics, **Then** one card explains that figures appear after the first conversation and links to the agents; no empty charts are drawn.
6. **Given** a person with the role User, **When** they open Statistics, **Then** there is no installation switch and a line says only they see these figures.
7. **Given** the Account tab, **When** it is opened, **Then** the account, capabilities and session cards are shown exactly as before this feature.

---

### User Story 2 - Numbers that stay true as the installation grows (Priority: P1)

An operator upgrades an installation that already has months of
conversations. After the upgrade the statistics are filled in for the past as
far as the sources allow, each figure says from which date it is complete,
and from then on every message, rating, citation, hand-over, refusal and
incident is counted once, when it happens. The page opens as fast with a
million conversations in the installation as with a thousand. Later the team
adds a new figure to the page: it is declared, filled in for the past, and
nothing that already worked is touched.

**Why this priority**: Story 1 cannot be true without it. Messages per period
and activity by day are not recorded anywhere today (see *Data inventory*),
and counting on every page view stops working at the first large customer.

**Independent Test**: On a copy of real data, run the fill for the last 180
days twice and deliver each live event twice in a row: the stored figures are
identical after each run and equal an independent recount. Load an
installation with a million conversations and open the page: it answers
within the target. Add a trial figure and observe that no existing figure's
collection changed.

**Acceptance Scenarios**:

1. **Given** an installation with history before this feature, **When** it is upgraded, **Then** past periods are filled in from the sources that still exist and each figure records the first day it is complete from.
2. **Given** a selected period that starts before a figure's first complete day, **When** the block renders, **Then** it says the figure is counted since that day rather than showing a smaller number as if it were the whole period.
3. **Given** the same event delivered twice, or a fill run twice over the same days, **When** the figures are read, **Then** nothing is counted twice.
4. **Given** the service restarts while people are chatting, **When** it is back, **Then** the events it missed are recovered and the figures match a recount.
5. **Given** recording a statistic fails, **When** a person sends a message, **Then** the conversation is unaffected and the missed count is recovered later.
6. **Given** an agent is deleted, **When** an operator opens the installation view for a period in which it worked, **Then** its tokens, calls and cost for that period are still in the totals under the name it had.

---

### User Story 3 - What I ask about and how it ends (Priority: P2)

On an installation where conversation summaries are produced, the person
also sees: their topics, each with a count and a resolved/open bar, and for
the selected topic the main questions they asked, which agent answered, when,
and whether it was resolved; how conversations end (resolved, left open, not
yet summarised), the tone of their conversations and the languages they wrote
in; and their open questions, each with a button that reopens that exact
conversation with that agent.

**Why this priority**: The most interesting part of the page, but it depends
on summaries, which an installation may not produce, and on labels that have
to be made stable first.

**Independent Test**: With summaries on, hold several conversations on two
subjects, leave one unresolved, wait for the summaries: both subjects appear
once each, the unresolved one is under open questions, and its button lands
in that conversation. With summaries off, the same account sees one
explanatory card instead of three empty ones.

**Acceptance Scenarios**:

1. **Given** summarised conversations in the period, **When** the topics block renders, **Then** it lists at most eight topics by count, the first is selected, and the caption says how many of the period's conversations have a summary.
2. **Given** a selected topic, **When** it is shown, **Then** up to four distinct main questions appear, newest first, each with the agent, how long ago and a resolved or open mark.
3. **Given** conversations not yet summarised, **When** the block renders, **Then** a line says how many are waiting and that they are not counted yet.
4. **Given** an open question, **When** the person presses Continue, **Then** the agent opens on that conversation.
5. **Given** more than four open questions, **When** the block renders, **Then** four are shown and a line says how many more there are and where to find them.
6. **Given** no open questions in the period, **When** the block renders, **Then** it says so, with no list.
7. **Given** an installation that produces no summaries, **When** Statistics opens, **Then** topics, outcomes and open questions are replaced by one card: for a User it says an administrator switches summaries on and the rest works without them; for an owner or administrator it says summaries are switched off for this installation and how they are switched on.
8. **Given** two conversations about the same subject, **When** they are summarised, **Then** they fall under the same topic label.

---

### User Story 4 - The installation, for those who run it (Priority: P2)

An owner or administrator sees a switch above the statistics: "My
conversations" and "Whole installation". The installation view shows tokens
(in and out), model calls, estimated cost and people in conversations, with
period comparisons; spend by day stacked by model, with a table view; agents
ranked by cost with a projection for 30 days at the current pace; health
(incidents with state, reason, age and duration, and requests refused by
limits per agent); where people are unhappy (per agent: conversations, share
left open, share of poor ratings, the worst highlighted); and the channels
people write in.

**Why this priority**: Operators have part of this in the admin console
already; here it meets the personal view and gains periods and health. It
builds on the same collection as Story 2.

**Independent Test**: As an administrator, switch to the installation view
for 30 days: tokens, calls and cost equal what the admin console's usage
page shows for the same agents and days. Switch to 7 and 90 days: every block
answers. As a User, confirm the switch does not exist and the installation
figures cannot be requested.

**Acceptance Scenarios**:

1. **Given** an owner or administrator, **When** they open Statistics, **Then** the scope switch is shown with "My conversations" selected and a line says who sees each scope.
2. **Given** the installation scope, **When** any of the three periods is selected, **Then** every block shows that period, including the comparison to the previous one.
3. **Given** a model with no known price, **When** cost is shown, **Then** that model and its agents are marked "no price" and show tokens only; they are never shown as zero cost, and the total is labelled as an estimate that excludes them.
4. **Given** an administrator who reaches only some agents, **When** they open the installation scope, **Then** every figure covers only those agents and the page says so.
5. **Given** no incidents and no refusals in the period, **When** health renders, **Then** it says so in one line each.
6. **Given** the spend chart, **When** switched to the table view, **Then** the same days, models and estimated cost are listed.
7. **Given** a User, **When** they request installation figures by any means, **Then** they are refused.
8. **Given** the owner, **When** "My conversations" is selected, **Then** a line explains that these are their conversations from both consoles, because the owner's channel is shared between them.

---

### User Story 5 - How agents helped, and who answers (Priority: P3)

The person sees three tiles: answers that came with sources (how many
conversations, and which knowledge base or the web was cited most), times an
agent asked a peer (how many, how many succeeded, which peer most), and their
own ratings (up, down, share marked useful). A further card shows which
models answered them, weighted by their messages, and names the one that
answers most.

**Why this priority**: Useful colour, already recorded per event, and not
needed for the page to make sense.

**Independent Test**: In one conversation get an answer with a citation,
trigger one hand-over to a peer, rate one answer up and one down: the three
tiles move by exactly that, and the model card names the model that agent
used on that day.

**Acceptance Scenarios**:

1. **Given** no citations, hand-overs or ratings in the period, **When** the tiles render, **Then** each shows zero with its own plain sentence ("agents have not cited sources yet", "agents managed on their own", "you have not rated answers yet").
2. **Given** an agent whose model was changed during the period, **When** the model card renders, **Then** the person's messages before the change are attributed to the earlier model and those after it to the later one.
3. **Given** days for which no record of the model in use exists, **When** the card renders, **Then** those messages are attributed to the agent's current model and a line says so.

---

### Edge Cases

- **A conversation that lasts for weeks.** A conversation with an agent stays one conversation until the person starts a new chat. It is counted in every period in which the person wrote in it, and on every day they wrote in it; day counts can therefore add up to more than the period's conversation count, and the two are labelled so that this is not read as an error.
- **Access taken away.** Conversations with an agent the person no longer reaches are not counted in their statistics, exactly as they are hidden from their history, and return with the access. "Out of N available" is the number of agents they reach now.
- **A deleted agent.** In the personal view its conversations disappear, as they do from history. In the installation view its past spend stays in the totals (Story 2, scenario 6).
- **A summary that could not tell.** A conversation whose summary gives no answer on "resolved" is counted as unknown, not as open, and never appears under open questions.
- **A summary that changed.** A conversation summarised again after it continued moves between resolved and open; statistics follow the latest summary.
- **Too short to summarise.** Conversations below the summary threshold stay "not summarised" for good; the coverage line counts them, and they are not presented as a backlog that will clear.
- **The current day.** Figures for today are provisional: installation spend for today appears only after agents report it, and the block says so.
- **Midnight and time zones.** A message sent at 00:30 belongs to the day the viewer sees on their clock. Installation figures follow UTC days, the boundary spend is reported in, and the installation view says so.
- **Changing role.** An administrator who becomes a User loses the installation scope on the next page load, including by a saved link.
- **A saved link to a scope or period that is not allowed or not known.** The page opens on the default (own conversations, 30 days) without an error.
- **Loading and failure.** While figures load the blocks hold their size and show placeholders; if they cannot be loaded, the tab says so with a retry, and the Account tab keeps working.
- **Very long names.** Agent, topic, knowledge base and model names are cut with an ellipsis and available in full on hover or focus.
- **One agent, one topic, one model.** The orbit, the topic list and the stacked bars still read sensibly with a single item.
- **A share-link visitor or an embedded-chat visitor.** They have no profile; the page is for signed-in console accounts only.

## Requirements *(mandatory)*

### Functional Requirements

**The page**

- **FR-001**: The profile MUST offer two tabs, Statistics and Account, with Statistics selected by default. The Account tab MUST hold the account, capabilities and session content the page has today, unchanged in content and behaviour. The pass card stays beside both.
- **FR-002**: Statistics MUST offer the periods 7, 30 and 90 days, 30 by default. A period is today and the days before it; the "previous period" is the same number of days immediately before.
- **FR-003**: The selected tab, period and scope MUST be part of the page address, so that a reload or a shared link opens the same view, subject to FR-020.
- **FR-004**: The blocks, their order, wording and visual treatment MUST follow the prototype, with the departures listed under *Assumptions*. The prototype's control bar and data-source notes MUST NOT ship.

**Personal figures**

- **FR-005**: The scoreboard MUST show, for the period: conversations the person wrote in; the person's own messages; distinct agents that answered them, out of the agents they currently reach; and the share of resolved conversations among those with a summary, with the coverage ("summary for N of M"). The first two MUST carry a comparison to the previous period: a rise or fall in percent, "same as the previous period", or "no data for the previous period".
- **FR-006**: Activity MUST show the last 13 weeks as a calendar, weeks as columns starting on Monday, today marked, days outside the selected period dimmed, five intensity levels with a legend; a by-weekday breakdown for the period with the busiest day highlighted; the number of days with conversations out of the period; and a table view with the same data.
- **FR-007**: "Who you talk to" MUST rank agents by the person's messages in the period and show per agent: messages, conversations, resolved share where summaries exist, the model, and the time of last contact. The orbit and the list MUST present the same ranking and share one selection.
- **FR-008**: Topics MUST list up to eight topics of the period's summarised conversations by count, each with its resolved and open parts; selecting one MUST show up to four distinct main questions with agent, age and state, and the topic's count and resolved share.
- **FR-009**: Outcomes MUST show conversations resolved, left open and not summarised as parts of the period's total; counts by tone (calm, neutral, mixed, irritated); and the share of each language the person wrote in.
- **FR-010**: Open questions MUST list the period's conversations whose latest summary says unresolved, newest first, at most four, each with agent, topic, age and an action that opens that conversation with that agent; a remainder count when there are more.
- **FR-011**: When the installation produces no summaries, FR-008 to FR-010 MUST be replaced by a single explanatory card whose text depends on the viewer's role; when it does produce them, conversations still waiting MUST be counted and named as not yet included.
- **FR-012**: "How agents helped" MUST show conversations with cited sources out of the period's total and the most cited sources; hand-overs to peers, how many succeeded and the peer asked most; and the person's ratings up and down with the share marked useful.
- **FR-013**: "Who answers you" MUST attribute the person's messages to the model the agent was using on the day of the message, name the model with the largest share, and say where it had to fall back to the agent's current model.

**Installation figures**

- **FR-014**: The installation scope MUST show tokens in and out, model calls, estimated cost and distinct people in conversations for the period, with comparisons to the previous period for calls, cost and people.
- **FR-015**: Spend by day MUST show tokens per day stacked by model for the period, with per-day estimated cost in the detail and in a table view.
- **FR-016**: Agents by cost MUST rank agents by estimated cost with their share of the total, tokens and calls, and a projection for 30 days at the period's pace. The estimate MUST be labelled as computed from a price list, not from a provider's invoice.
- **FR-017**: A model without a known price MUST be marked "no price" wherever it appears, shown with tokens only, and excluded from cost totals with that exclusion stated. It MUST NOT be presented as costing nothing.
- **FR-018**: Health MUST show the period's incidents (open or closed, agent, reason, age, duration once closed) and requests refused by limits per agent. Quality MUST show per agent the conversations, the share left open and the share of poor ratings, with the worst value in each column highlighted.
- **FR-019**: The channels block MUST show the period's conversations by channel (console, Telegram, Slack, share link) in the installation scope.

**Who sees what**

- **FR-020**: A person MUST see personal statistics only for their own conversations. No request, link or parameter may return another person's personal figures, questions or topics, to any role.
- **FR-021**: The installation scope MUST be available only to owners and administrators, and MUST cover only the agents the viewer reaches. It MUST contain counts and per-agent figures only: no person's name, question text or per-person breakdown.
- **FR-022**: Personal statistics MUST count only conversations with agents the person currently reaches (the rule their history follows).
- **FR-023**: The page MUST state who can see the figures on screen: "only you" for the personal scope, "the owner and administrators" for the installation scope.

**Collection**

- **FR-024**: Every figure on the page MUST be read from records kept by time: an hour, a day, or the event itself. A fact that is already kept as one durable record per event is read where it is and not copied. Opening the page MUST NOT recount conversations or read their content, and its response time MUST NOT depend on how much history the installation holds.
- **FR-025**: Activity MUST be recorded when it happens, attributed to the person, the agent and the time, for at least: a person's message, an agent's answer, a rating, a cited source, a hand-over to a peer, a request refused by a limit. Recording MUST be finer than a day where needed for FR-029.
- **FR-026**: Recording MUST be idempotent: an event delivered more than once, a retry, a restart or two writers at the same moment MUST NOT change a figure.
- **FR-027**: Any stored figure MUST be rebuildable for a past range from the sources that still hold it, with a result identical to what live recording produced. The rebuild is how history is filled on upgrade, how a missed event is recovered, and how a new figure gets its past.
- **FR-028**: Each figure MUST know the first day it is complete from. A block asked for a period reaching before that day MUST say so in one line, not in a warning per number.
- **FR-029**: Personal figures by day MUST follow the viewer's own day boundaries. Every installation figure follows one fixed boundary, the UTC day spend is reported in, so that two administrators in different time zones see the same number; the installation view MUST say so once.
- **FR-030**: Every figure offered for 90 days MUST have its records kept for at least 400 days, so that the comparison with the previous period is always available and a yearly period can be added later without new collection. Records that are pruned sooner today (requests refused by limits, kept 30 days) MUST get a daily record that outlives the pruning.
- **FR-031**: Installation spend for a past day MUST NOT change when an agent, a model credential or a person is deleted afterwards; the agent's name as it was MUST stay available for display.
- **FR-032**: A failure to record a statistic MUST NOT fail, delay or alter the conversation it belongs to, and MUST be recoverable by FR-027.
- **FR-033**: The statistics records MUST hold counts and labels, never message text. The one exception is the main question of a summarised conversation, which belongs to that conversation's summary and is shown only to its owner.
- **FR-034**: Adding a figure MUST consist of declaring what is counted, by which dimensions, and how its past is rebuilt. It MUST NOT require changing how existing figures are recorded or read.
- **FR-035**: When a person's account is deleted, their personal statistics MUST be deleted with it; installation totals keep the counts.
- **FR-036**: Each summarised conversation MUST carry a one-line main question in the person's language, and its topics MUST come from labels that stay the same for the same subject across conversations and over time. A missing or unreadable answer on "resolved" MUST be stored as unknown.

**Consistency and presentation**

- **FR-037**: A figure shown here and in the admin console for the same agents and days (tokens, calls, cost, incidents, ratings) MUST be the same number.
- **FR-038**: What the statistics page can show, the Ranch agent MUST be able to report when asked, for the party asking and under FR-020 to FR-022.
- **FR-039**: All text MUST exist in every language the console offers; plurals, numbers, dates, weekday and month names and relative times ("yesterday", "3 days ago") MUST follow the active language. Model names, incident reasons and other text received from elsewhere are shown as received.
- **FR-040**: Every chart MUST have a text equivalent (a table view or a described summary), every interactive mark MUST be reachable and operable by keyboard with a visible focus, details shown on hover MUST also appear on focus, and entrance animation MUST be skipped for people who ask for reduced motion. Meaning MUST NOT rest on colour alone.
- **FR-041**: The page MUST work from a 390 px phone to a 1440 px desktop without horizontal page scrolling; wide content (the calendar, tables) scrolls inside its own block.

### Data inventory

What the prototype's source notes say, checked against the product as it is
on 2026-11-26. "Kept" means recorded today in a form the figure can be built
from; the third column is what this feature has to add.

| Figure | Today | To add |
|--------|-------|--------|
| Conversations, agents that answered | Kept, one record per conversation | A per-period count |
| My messages in a period | Not kept: only a lifetime total per conversation, and a conversation can last for months | A per-day record, filled for the past from conversation transcripts where they still hold it |
| Activity by day and weekday | Not kept: only the day a conversation started | The same per-day record |
| Topics, tone, language, resolved | Kept per summarised conversation, when the installation produces summaries; topic labels are free text and differ for the same subject | Stable labels; "unknown" as an outcome; per-period counts |
| Main question of a conversation | Not produced | One line in each summary |
| Models that answered | The agent's current model only; tokens by agent, model and day are kept | Attribution of a person's messages by the day's model |
| Cited sources, hand-overs to peers, ratings | Kept per event, with the person | Per-period counts |
| Channels | Kept per conversation; Telegram and Slack identities are not linked to console accounts | Installation scope only (see *Assumptions*) |
| Tokens, calls, cost | Served for 30 days; lost when the agent is deleted; a model without a price counts as zero | Any period and its predecessor; survive deletion; "no price" |
| People in conversations | Derivable | A distinct count per period |
| Incidents | Kept | Per-period list |
| Requests refused by limits | Kept per minute for 30 days | A daily record kept as long as FR-030 asks |
| Tokens per person | Not kept | Out of scope: nothing on the page shows it |

### Key Entities

- **Activity record**: how much of one kind of activity (messages sent, answers received, ratings, citations, hand-overs, refusals) happened for one person with one agent in one slice of time. Counts and labels only. The base every personal figure and most installation figures are read from.
- **Conversation outcome**: what the latest summary says about one conversation: its topics, main question, tone, language, and whether it was resolved, left open or could not be told; plus whether a summary exists at all.
- **Topic**: a label that means one subject across the installation's conversations.
- **Spend record**: tokens in and out and model calls of one agent with one model on one day, with the agent's name as it was; independent of the agent's later fate.
- **Figure definition**: what a figure counts, the dimensions it is kept by, the first day it is complete from, and how its past is rebuilt.
- **Period view**: the answer for one person or one installation scope and one period: the figures, their comparisons, their coverage and their completeness notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a sample of 20 real accounts, every personal figure for 7, 30 and 90 days equals an independent recount from the sources; for 3 installations the same holds for every installation figure. No tolerated difference.
- **SC-002**: The Statistics tab shows its figures within 2 seconds on a normal connection for a person with 5,000 conversations in an installation with 1,000,000, and that time is within 20% of the time measured on an installation with 10,000.
- **SC-003**: A message, rating or citation is reflected on the page within 5 minutes of happening; a conversation's topics and outcome within 15 minutes of its summary being produced.
- **SC-004**: An event delivered again right after itself, and a rebuild of the same 90 days run twice, each leave every stored figure unchanged.
- **SC-005**: After upgrade, an installation with six months of history has every rebuildable figure filled for at least the last 180 days, or back to the first day its source still covers, without interrupting conversations.
- **SC-006**: In a test with two accounts and three roles, there are zero ways for one person to obtain another's personal figures, and zero ways for a User to obtain installation figures.
- **SC-007**: A trial figure is added during acceptance without modifying the recording or reading of any existing figure, and its last 90 days are filled in by the standard rebuild.
- **SC-008**: On a sample of 100 summarised conversations labelled by a person, at least 90% of pairs judged to be about the same subject carry the same topic label, and the top eight topics contain no two labels judged to mean the same thing. The 90% is a starting target: the calibration the plan must name (constitution, Principle VII) confirms or replaces it, with the reason.
- **SC-009**: Every period offers every block: no block is limited to 30 days, and no figure is shown for a range it does not cover without the note required by FR-028.
- **SC-010**: At 390 px and at 1440 px the page has no horizontal scroll, no clipped text and no console errors; every chart's data can be read without seeing it, and every action can be reached by keyboard alone.
- **SC-011**: Sending a message takes no longer with statistics recording on than with it off, within measurement noise, and a forced recording failure loses no message.

## Assumptions

- **Scope of the console.** The page lives in the app console's profile, which has no twin in the admin console. Installation figures also shown in the admin console come from the same records (FR-037); the admin console's own pages are not redesigned here.
- **Departures from the prototype**, each because the prototype's version cannot be made true with what the product knows:
  - *Channels move to the installation scope.* The prototype shows "where you write" in the personal view with Telegram, Slack and share links. A console account is not linked to a Telegram or Slack identity, and a share-link visitor is anonymous, so a personal breakdown would always read "console 100%". Linking identities is a separate feature.
  - *"Who answers you" uses the model of the day*, not the agent's current model with a disclaimer, because the day's model is already on record. The disclaimer remains only for days without a record.
  - *A conversation is counted when the person writes in it*, not on the day it started, because a conversation lasts until the person starts a new chat and may run for weeks.
  - *An unknown outcome is a third state.* The prototype has resolved and open only.
- **The installation scope follows reach.** An administrator restricted to some agents sees the installation through them, as they already do for usage. "Whole installation" is literal only for someone who reaches every agent.
- **Summaries stay an installation setting.** Whether an installation produces summaries, and what that costs it in model usage, is its operator's decision. This feature makes the page honest in both cases and does not switch summaries on.
- **Owners and administrators can already read every conversation**, so per-agent tone and open share in the installation scope expose nothing new, even for an agent with a single user.
- **The owner's own conversations** are the ones in the shared owner channel, from both consoles; this is how the product identifies the owner today and is not changed here.
- **Estimated cost** uses the product's own price list. Keeping that list current is outside this feature; a missing price is shown as missing (FR-017).
- **History before the upgrade** is rebuilt from what still exists. Transcripts that were compacted or deleted cannot give back per-day counts; FR-028 covers the result. Lifetime totals already on record are not altered.
- **Retention of 400 days** is chosen to cover the 90-day period and its predecessor with a year's margin for a future yearly view. Longer periods, exports, scheduled reports, goals and alerts are out of scope.
- **How activity is delivered.** An agent reports each message once and does not retry; while it is disconnected the report is lost, not queued. The product refuses an immediate repeat of the last report. So the risk FR-026 and FR-027 guard against is a missed message, repaired from the transcript, far more than a doubled one. Replaying an old stream of reports out of order is not a supported operation and is not claimed to be idempotent: history is rebuilt from transcripts instead.
- **Time zones with a half-hour offset.** Activity is kept by the hour, so a viewer in a zone offset by 30 or 45 minutes gets their days cut at the nearest whole hour; a message within that margin of midnight can fall on the neighbouring day. Accepted until a customer in such a zone asks.
- **Hour-of-day activity** is not shown by the prototype and is not added to the page; recording finer than a day (FR-025) is required for time zones and leaves the door open.
- **Tokens and cost per person** are out of scope: usage is reported by agent, and nothing on the page needs it.
- **Languages** are the ones the app console already offers, English being the source text.
