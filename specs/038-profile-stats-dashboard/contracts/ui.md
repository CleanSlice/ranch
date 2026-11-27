# Contract: Statistics tab

**Plan**: [../plan.md](../plan.md) | **API**: [api.md](./api.md) | **Reference**: [../reference/profile-stats-prototype.html](../reference/profile-stats-prototype.html)

The prototype is the reference for layout, spacing, colour, type and wording.
This file states what the prototype cannot: addresses, states, where the
code lives, and where the page departs from it.

## Address

`/profile?tab=&period=&scope=`, read and written by
`app/slices/profile/utils/statsView.ts` (pure, tested).

| Parameter | Values | Default | Omitted from the address when |
|-----------|--------|---------|-------------------------------|
| `tab` | `stats` \| `account` | `stats` | default |
| `period` | `7` \| `30` \| `90` | `30` | default, or `tab=account` |
| `scope` | `mine` \| `installation` | `mine` | default, or `tab=account` |

- An unknown value is read as the default. `scope=installation` for a User is
  read as `mine`. The address is rewritten with `replace`, not `push`, when a
  value is corrected; a choice made by the person is a `push`, so Back
  returns to the previous view.
- Changing tab, period or scope does not reload the page or move the pass.

## Structure

```text
profile.vue
├── ProfilePass (unchanged)
└── right column
    ├── bar: [Statistics | Account] ........ [7 | 30 | 90]   (period only on Statistics)
    ├── scope line: [My conversations | Whole installation] + who sees it   (operators)
    │               "only you see these figures"                             (User)
    ├── Statistics → ProfileStatsProvider
    └── Account    → ProfileAccount, ProfileCapabilities, ProfileSession (unchanged)
```

## Blocks

Order as in the prototype. Each block is one component under
`app/slices/profile/components/profile/stats/` and takes its part of the
period view as props; none fetches.

**Personal scope**

| # | Block | Component | Shown when |
|---|-------|-----------|------------|
| 1 | Scoreboard | `Board.vue` | always |
| 2 | Activity | `Activity.vue` (`Calendar.vue`, table view) | always |
| 3 | Who you talk to | `Agents.vue` (`Orbit.vue`) | at least one agent |
| 4 | Topics and questions | `Topics.vue` | summaries on |
| 5 | How conversations end · Who answers you (side by side; stacked under 640 px) | `Outcome.vue`, `Models.vue` | outcome: summaries on; models: always |
| 6 | Open questions | `OpenQuestions.vue` | summaries on |
| 4–6 replaced | Topics, outcomes and open questions | `SummariesOff.vue` | summaries off; then `Models.vue` takes a full row |
| 7 | How agents helped | `Help.vue` | always |

"Summaries on" and "summaries off" are `summaries.enabled` of the answer and
nothing else (CLEAN-270). With summaries off every count read from them is
zero and every list empty, and with them on a new account's are zero too:
the two are different pages, so no block decides by a zero. `Provider.vue`
places the blocks by that field; `Board.vue`, `Agents.vue` and `Quality.vue`
take it as `summariesEnabled`. An answer of an API older than the console
has none of these fields, and the mapper reads it as "off".

As built:

- **Scoreboard, fourth tile.** With a share: the percent of the summarised
  conversations a summary calls resolved, and under it the coverage,
  "summary for 8 of 12" (summarised of the period's conversations). Without
  one: a dash, and under it "summaries are not produced" (off) or "no
  summaries yet" (on, nothing summarised in the period).
- **Who you talk to.** A row ends with the agent's resolved share where its
  conversations have summaries, on a line of its own under the
  conversations: the percent, its word and of how many, "67% resolved of 6".
  The whole is on the row because 1 of 1 and 40 of 40 both read 100%, and
  the row's detail, where "Resolved: 4 of 6 with a summary" still stands,
  never opens on a touch. The line is the shortest that says it: what it
  takes at 390 px it takes from the agent's name. No share for an agent
  without a summarised conversation, and none while summaries are off.
- **Topics.** The caption is the coverage. Rows are buttons with
  `aria-pressed`; the first is selected, a choice lasts until the period
  changes. The bar is `topicPixels.ts`: 34 pixels for the largest topic,
  resolved in full colour, left open thinned, and what a summary could not
  tell as an empty outline, which the legend names only when one is drawn.
  The pixels narrow rather than leave the row, so the proportion is whole at
  any width. A row shows its total; it says its other numbers in words to a
  screen reader and in its detail on hover and focus. The selected topic's
  line prints them for everyone, "12 conversations · 8 resolved (67%) · 3
  left open", with "· 1 unclear" when a summary could not tell: a tap on a
  row is how a phone reads a topic's counts, and the rows are no wider for
  it. A question's mark is a word and an icon of its own: resolved (check),
  open (dot in a circle), unclear (question mark). A topic no summary quoted
  a question for says so. With no topic at all the block is one line, "No
  topics yet. A topic comes from a conversation's summary.", and the line
  under it still says what is waiting or too short; "All conversations of
  the period are counted." is not said over it while nothing has a summary.
- **How conversations end.** Resolved and open are always in the legend,
  unclear and "no summary" only above zero. Unclear is hatched, so that it
  differs from "no summary" beside it by more than a shade. Tones and
  language chips are of the summarised conversations: while none of the
  period's has a summary they are replaced by one line. A chip is the
  language's name from `useFormat().languageName` and its share of the
  conversations a language was judged for. When `Models.vue` draws nothing
  (no message has a model) the card takes the whole row.
- **Open questions.** The question is cut at two lines, whole in the
  element's title. A conversation left open with no quoted question
  (`question: null`) is listed under "The summary quoted no question" and
  offers Continue like the others. The caption "can be continued" stands only
  over a list. Under 480 px Continue goes under the question. Open
  conversations of which none can be listed (the answer named no
  conversation or no agent for them) are one sentence with their count in
  place of the list, and no "N more" under it.
- **Summaries off.** One card, "Topics, outcomes and open questions",
  captioned "no summaries". Its first sentence is the same for everyone:
  "Topics and outcomes will appear once conversation summaries are switched
  on." Then, by role (`canSeeInstallation`, the rule that offers the scope
  switch): a User reads "An administrator of the installation switches them
  on. The rest of the statistics is counted without them."; the owner and an
  administrator read "Summaries are switched off for this installation, so
  this block is empty for everyone." and the sentence of `SummariesHow.vue`:
  "A background task of the API writes them once the summary interval
  `CHAT_INSIGHT_INTERVAL_SEC` is set and an Anthropic credential is active."
  Those are the two conditions of the API's `ChatInsightService.isEnabled()`.
  The setting's name comes from the domain (`SUMMARY_INTERVAL_VARIABLE`) and
  is not translated.

**Installation scope**

| # | Block | Component | Shown when | As built (CLEAN-265) |
|---|-------|-----------|------------|----------------------|
| 1 | Scoreboard | `InstallationBoard.vue` | always | cost carries "≈"; the `activity` completeness note stands once, under this block, because people, conversations and channels are one figure in three blocks |
| 2 | Spend by day | `Daily.vue` (stacked columns, table view) | always | drawn at the card's measured width, not as a scaled `viewBox`, so the dates keep their size on a phone; the axis is `axisScale.ts`, the columns and their dates `dailyColumns.ts`; the days are an HTML overlay of one cell each, one tab stop walked with the arrow keys, Home and End; a day of unpriced models only shows the "no price" mark instead of "≈ $0.00", and a day that mixes priced and unpriced models keeps its cost with a dashed "+" beside it (`dayPricing` in `dailyColumns.ts` says which of the three a day is); the topmost bar of a day with usage is at least 1.5 px high (`dayBars`, same file), so a few tokens against a maximum of millions are not drawn as an empty day |
| 3 | Agents by cost | `AgentsByCost.vue` | always | rows carry "≈"; an agent whose `cost` is `partial` has a dashed "+" beside it and a tip saying the cost is of its priced models only; with `projection30d` null the projection is a dash and the sentence "A projection needs at least one finished day with usage." |
| 4 | Health · Where people are unhappy (side by side; stacked under 640 px) | `Health.vue`, `Quality.vue` | always | Health: an open incident has the alert mark, an incident's time is on its own line (a long reason, cut at three lines, took the time with it), its duration is `span.ts`, and the `refusals` completeness note is inside this card. Quality: see below |
| 5 | Where people write | `Channels.vue` | at least one conversation in the period | |

Above the blocks one line says that the days are UTC days, and an operator
limited to some agents gets a second one with the count: "These figures
cover the 2 agents you reach, not the whole installation." An operator who
reaches an agent whose conversations are the Owner's alone to read
(`reach.ownerOnly`) gets one more, with the names: "Conversations with Ranch
are the owner's alone to read: the people, quality and channel figures here
are counted without them. Its spend and health are counted in full." It
concerns the people tile of the scoreboard, `Quality.vue` and `Channels.vue`,
and nothing else on the page. The Owner's list is empty and the line is not
drawn.

`Quality.vue` has the three columns of the prototype. PR 4 shipped before
PR 3 with a dash in the "left open" column; since CLEAN-270 `quality[]`
carries `open` and `summarised` per agent and the answer `summaries.enabled`,
and the cell is one of three things, decided by `utils/qualityRows.ts`:

| `data-stats-state` | When | The cell |
|--------------------|------|----------|
| `share` | summaries on, and the agent has `summarised > 0` | `open / summarised` as a whole percent with "N of M" under it, as the thumbs-down column has |
| `none` | summaries on, and `summarised === 0` for the agent | a dash, read out as "no summaries yet"; as soon as one row has it, one line under the table: "A dash means that no conversation of that agent has a summary yet." |
| `off` | `summaries.enabled` is false | a dash, read out as "summaries are not produced", in every row; one line under the table: "The share left open is read from conversation summaries, which this installation does not produce." followed by the sentence of `SummariesHow.vue`, the same one the "summaries off" card has for operators |

A dash is never explained to a screen reader alone: either line under the
table is visible text, because a phone has no hover to ask.

The highest share of each column is marked by colour, an icon and words for
a screen reader; equal highest shares are all marked, and nothing is while
every share is zero. "Equal" is by the whole percent that is printed: 1 of 3
and 33 of 100 are both 33% and both marked. A share is compared only when it
is of at least three: three summarised conversations for the share left
open (`MIN_SUMMARISED_TO_RANK`), three rated answers for the thumbs down
(`MIN_RATED_TO_MARK`). Under three, one conversation is half of the share
or all of it, and 1 of 1 left open would be marked above 60 of 100. A share
of fewer keeps its percent and its "N of M" and is never marked; where
every share of a column is of fewer, nothing in it is.

With summaries on, the rows stand in two groups. First the agents whose
share left open is compared, by that share, highest first; equal shares by
conversations, most first; what is still equal in the order received. After
them the agents whose share is of fewer than three and the agents with no
share at all, by conversations, most first, then in the order received:
neither is placed by a percent that says so little. With summaries off the
rows keep the API's order, most conversations first. The words under the
table stood in the cell at first and broke over three lines in every row.

Shared pieces: `Card.vue` (title, caption, optional action, one note line),
`Segmented.vue` (the three switches), `StackBar.vue` (tall and thin segmented
bars), `Tip.vue` (hover and focus detail, on `reka-ui`'s tooltip),
`TableToggle.vue`.

## States

| State | What the tab shows |
|-------|--------------------|
| Loading, nothing held for this view | the blocks at their final size with placeholders; no spinner page |
| Loading, a view for this scope held for another period | the held view dimmed until the new one arrives; no jump |
| Failed | one card: it could not be loaded, with Retry. The Account tab is unaffected |
| No conversations in the period or the one before | one card: figures appear after the first conversation, with a link to the agents |
| Summaries off (`summaries.enabled` false, or an answer without the field) | blocks 4 to 6 become one card and `Models.vue` takes the row; the scoreboard's fourth tile is a dash with "summaries are not produced"; no agent row has a resolved share. The card's text depends on the role: a User is told an administrator switches them on and that the rest is counted without them; the owner and an administrator are told they are off for this installation and that the summary interval `CHAT_INSIGHT_INTERVAL_SEC` and an active Anthropic credential switch them on |
| Summaries on, some conversations waiting | one line under Topics: how many are waiting and not counted yet; conversations too short to summarise are named separately, in a sentence of their own, and not as waiting. "All conversations of the period are counted." only when neither count is above zero, and not at all while there is no topic and nothing has a summary: the line is then not drawn |
| Summaries on, nothing summarised in the period yet (a new account) | the three blocks stand, each saying it: the fourth tile is a dash with "no summaries yet"; Topics is "No topics yet. A topic comes from a conversation's summary." with the coverage "summary for 0 of N" and the waiting / too-short line; "How conversations end" is the bar as one part, "no summary", its legend, and "No conversation of this period has a summary yet." in place of tones and languages; Open questions is "No conversation of this period has a summary yet, so no question is known to be open.", without the check mark |
| Summaries on, summarised conversations but no topic among them | Topics is the same one line; outcomes and open questions are drawn as usual |
| A topic whose summaries quoted no question | "No summary of these conversations quoted a question." in place of the list |
| An open conversation with no quoted question (`question: null`) | listed under "The summary quoted no question", in muted type, with its agent, topic, age and Continue |
| The summary could not tell how a conversation ended (`unknown`) | a part of its own in the outcome bar and legend ("unclear"), an empty-outline pixel in the topic's bar, an "unclear" mark on its question; never under open questions |
| A figure's history starts inside the period | one line in that block: counted since the date (from `notes`). In the installation scope `activity` is noted once, under the scoreboard, and `refusals` inside the Health card |
| No open questions, and at least one summarised conversation | one line with a check mark: "No open questions in these 30 days." |
| More than four open questions | four are listed and one line under them says how many more there are and that every open conversation is in its agent's history |
| Open conversations, none of which can be listed (`items` empty, `more` above zero) | one sentence in place of the list: "3 conversations were left open. They cannot be listed here; each is in its agent's history." No "N more" line: more than nothing is not a count |
| An open question whose agent came without a name | the link's accessible name is "Continue this conversation" and its detail "Opens this conversation in its agent's history": neither is left with a gap where the name would be |
| No incidents / no refusals | one line each |
| A model without a price | a dashed "no price" mark in the legend and in the agent's row, tokens instead of money, and the total labelled as an estimate without it. An agent that ran priced and unpriced models keeps its cost, with a dashed "+" and a tip that the cost covers the priced ones only. A day of unpriced models only shows the mark where its cost would be: that money is unknown, not zero |
| A day that mixes priced and unpriced models | the day keeps its cost, which is of the priced models only, and a dashed "+" stands beside it wherever that cost is printed: in the day's detail on the chart, with the line "Some of the day's models have no price; the cost is of the rest." under it, and in the day's row of the table, where the same line stands once under the table (a mark with a pop-up in each of 90 rows would be 90 tab stops, and a touch opens no pop-up). The cell's label says it in words: "…, estimated cost ≈ $7.35, without the models that have no price" |
| A cost above zero and under half a cent | "< $0.01" in the language's money format, never "≈ $0.00": something was spent. A true zero stays "≈ $0.00" |
| No finished day with usage in the period | the projection is a dash with "A projection needs at least one finished day with usage." |
| The share of conversations left open, installation scope | per row a share with "N of M", or a dash for an agent with no summarised conversation, with one line under the table that says what the dash means; with summaries off a dash in every row and one line under the table (see `Quality.vue` above) |
| A share of fewer than three (summarised conversations, rated answers), installation scope | shown as any other, percent and "N of M"; never marked as the highest of its column, and its row stands after the rows whose share is compared, by conversations |
| A count that came larger than its whole (9 resolved of 6 summarised) | the part is read as the whole, in the mapper and in `share.ts`: "6 of 6" and 100%, never "9 of 6" or 150% |
| No conversations in the period, installation scope | the Channels card is not shown |
| The installation route answers 403 | no installation view is kept and the cached ones are dropped; one card says so and links back to "My conversations". No Retry: a refusal is not a failure |
| The Owner on "My conversations" | the scope line says these are their conversations from both consoles |
| An operator limited to some agents, on the installation scope | a line above the blocks says the figures cover the agents they reach, with the count |
| An operator who reaches an agent whose conversations are the Owner's alone to read (`reach.ownerOnly` not empty) | one more line above the blocks names those agents and says that the people, quality and channel figures are counted without their conversations, and that their spend and health are counted in full. It concerns the people tile of the scoreboard, "Where people are unhappy" and "Where people write"; "Spend by day", "Agents by cost" and "Health" show those agents like any other. One sentence for one agent and one for several; the names are shown as received and joined by the format module. Never drawn for the Owner |
| A User with `?scope=installation` in the address | corrected to `/profile`; no scope switch is drawn and no request for the installation route is made |
| The role changes while the page is open (an administrator made a User) | the view goes to the person's own figures and the address is corrected with it. A change of account is not corrected from here: signing out and the `accountScope` plugin navigate themselves |

Hooks these states add (the end-to-end checks read them):

| Hook | Where | Says |
|------|-------|------|
| `data-stats-owner-only` | the line above the installation's blocks | present only while `reach.ownerOnly` has a name; `data-stats-value` is how many |
| `data-stats-pricing` | a day's cell on the spend chart and the cost cell of its table row | `priced`, `partial` or `unpriced` |
| `data-stats-partial` | the dashed "+" beside a cost: an agent's in "Agents by cost" (as before), a day's in its detail and in its table row | the cost leaves out the models that have no price |
| `data-stats-partial-note` | the words that explain the "+" of a day: the line in the day's detail, the line under the table | present only while a day of the period is `partial` (under the table) or for that day (in its detail) |

Hooks of the summaries blocks (CLEAN-270):

| Hook | Where | Says |
|------|-------|------|
| `data-stats-block` | every block's root | `topics`, `outcome`, `open-questions` or `summaries-off` for the new ones; the others as before |
| `data-stats-wording` | the "summaries off" card | `operator` or `user`: whose text it shows |
| `data-stats-summaries-how` | the sentence that says what switches summaries on | in the "summaries off" card for operators and in the line under the quality table |
| `data-stats-summaries` | the scoreboard's fourth tile (`data-stats-tile="resolved"`) | `off`, `none` or `share`; with `share`, `data-stats-value` is the whole percent and `data-stats-coverage` marks the line under it |
| `data-stats-resolved-share` | an agent's row in "Who you talk to" | the visible line "67% resolved of 6", present only when the agent has a share; `data-stats-value` is the whole percent and `data-stats-of` the summarised conversations it is a share of |
| `data-stats-summarised` | the Topics card | conversations of the period with a summary |
| `data-stats-topic` | a topic's row | the topic's id; `data-stats-selected` is `true` on the selected one, `data-stats-value` its conversations |
| `data-stats-topic-detail` | the pane with the selected topic's questions | the topic's id |
| `data-stats-topic-counts` | the line under the selected topic's name | its conversations, resolved (with the share), left open and, if any, unclear, as visible text |
| `data-stats-question` | a question of the selected topic | `data-stats-outcome` is `resolved`, `open` or `unknown`; `data-chat` its conversation |
| `data-stats-questions-none`, `data-stats-topics-none` | the line in place of a topic's questions, of the topic list | present only then |
| `data-stats-coverage` | each sentence of the line under Topics | `source`, `waiting`, `too-short` or `all-counted`; `data-stats-value` is the count of the two that have one |
| `data-stats-part` | a legend entry of "How conversations end" | `resolved`, `open`, `unknown` or `notSummarised`, with `data-stats-value`; the bar's segments carry the same names in `data-segment` |
| `data-stats-tone`, `data-stats-language` | a tone tile, a language chip | the tone, the language code; `data-stats-value` is the count |
| `data-stats-outcome-none` | the line in place of tones and languages | present only while nothing is summarised |
| `data-stats-open` | the Open questions card | how many conversations are open: the rows and the remainder |
| `data-stats-open-question` | an open question's row | `data-chat`, `data-agent`; `data-stats-quoted` is `false` for the placeholder |
| `data-stats-continue` | the Continue link of a row | its `href` is the agent's page on that conversation |
| `data-stats-open-more` | the line under four open questions | `data-stats-value` is how many more; present only under a list |
| `data-stats-open-none` | the line in place of the list | `none` (a finding, with the check mark), `pending` (nothing summarised yet) or `unlisted` (open conversations, none of which can be listed; `data-stats-value` is how many) |
| `data-stats-open-share` | the "left open" cell of a quality row | `data-stats-state` is `share`, `none` or `off`; with `share`, `data-stats-value` is the whole percent. The row has `data-worst-open` beside the `data-worst` of the thumbs-down column |
| `data-stats-open-off` | the line under the quality table | present only while summaries are off. It replaces `data-stats-open-pending` |
| `data-stats-open-unsummarised` | the line under the quality table | present only while summaries are on and a row has a dash for want of a summary (`data-stats-state="none"`); never together with `data-stats-open-off` |

## Departures from the prototype

| Prototype | Here | Why |
|-----------|------|-----|
| "Where you write" in the personal scope | `Channels.vue` in the installation scope only | a console account is not linked to a messenger identity (spec, Assumptions) |
| "Counted by the model the agent has now" always | that line only when `models.fallback` is true | the day's model is on record |
| Outcome bar: resolved, open, no summary | a fourth, neutral part "unclear" when its count is above zero | `unknown` is a real answer |
| Day cells say "N conversations" started | conversations written in that day | a conversation can last for weeks; the block's caption says "conversations you wrote in" |
| "Where people are unhappy" orders equal open shares by its own agent list, and marks a column of zeros | equal shares by conversations, most first, then in the order received; nothing marked while every share is zero; a dash, not a share, where there is nothing to take a share of or summaries are off | the prototype's agent list means nothing here, and the highest of nothing is not news |
| The open share alone in its cell | "N of M" under it, as the thumbs-down share has | 1 of 3 and 100 of 300 are the same share and not the same news |
| The highest share of a column is marked whatever it is a share of, and an agent without a share is ordered as zero | a share is marked and ordered by only when it is of at least three; the rows of fewer and the rows with no share stand after the others, by conversations | under three, one conversation is half of the share or all of it: 1 of 1 left open stood marked above 60 of 100, and an agent nobody summarised stood above one known to have left nothing open |
| A dash in the "left open" cell with nothing said of it | one line under the table says what the dash means | its reason was read out to a screen reader only, and a phone shows no detail on hover |
| "Who you talk to": the bare percent after the conversations | a line of its own, "67% resolved of 6" | 1 of 1 and 40 of 40 both read 100%; the word and the whole were in the row's detail, which a touch never opens |
| A topic's line: "12 conversations · 67% resolved" | "12 conversations · 8 resolved (67%) · 3 left open", with "· 1 unclear" when there is one | a row shows only its total, and its resolved and open counts were in its detail and for a screen reader |
| A pill with a dot of its colour: "resolved", "open" | an icon of its own in place of the dot (check, dot in a circle), and a third, "unclear" | two pills that differ by the colour of one dot differ by colour alone; `unknown` is a real answer |
| Topic bar: resolved and the rest | a third kind of pixel, an empty outline, for what a summary could not tell; pixels narrow to fit their row | `unknown` is neither resolved nor open; 34 pixels of 6 px do not fit the topics column between 1024 and about 1100 px |
| Topics in two columns down to 700 px | one under the other also from 1024 to 1179 px | from 1024 px the pass takes 400 px beside the column, which leaves each half about 200 px |
| Scoreboard: "67" with a small "%" | the percent as the format module writes it, "67%" · "67 %" | the sign's place and spacing are the language's |
| Tones always two to a row | as many as fit at 118 px each: two in half a row, four in a whole one | "раздражение" does not fit half of a narrow card |
| Language chips "RU 82%", of all conversations | the language's name, as a share of the conversations a language was judged for | a code is not a name (T080); a language is known for summarised conversations only |
| An open question on one line | two lines, the whole of it in the title | on a phone one line is a few words and nothing hovers |
| "No open questions" whenever the list is empty | that line only when something is summarised; otherwise "nothing has a summary yet" without the check mark | a check mark for nothing looked at is not a finding |
| Axis steps of 1 or 2 times the maximum's power of ten | 1, 2 or 5 times a power of ten: three to five steps, never more than six | the prototype's ladder left some maxima with two steps and much of the chart empty |
| Sticky control bar, data-source notes | not shipped | prototype controls |
| `toLocaleString('ru-RU')`, inline Russian plurals | `useFormat()` and i18n keys | `docs/i18n.md` |

## Store and data

- `app/slices/profile/stores/profileStats.ts`: `views` by `scope:period`, each
  with its status; `load(scope, period)` fetches and upserts; a view older
  than 60 seconds is fetched again when shown, the held one staying on screen
  meanwhile. Cleared by the account-change reset (`docs/state.md`, rule 7).
  60 seconds because the figures behind it change at most once per message
  and the tab is often reopened by Back.
- `app/slices/profile/domain/stats.gateway.ts` and
  `data/stats.gateway.ts` + `stats.mapper.ts`: the two SDK calls, `res.error`
  checked (the generated client does not throw).
- Components take values from the store through the provider; none keeps its
  own copy. The selected topic and the selected agent are view state of their
  block, not entities, and reset to the first item when the period changes.

## Pure functions (each with a `.test.ts`)

| File in `app/slices/profile/utils/` | Does |
|------|------|
| `statsView.ts` | address ↔ view, defaults, role clamp |
| `calendarGrid.ts` | 13 Monday-first weeks from 91 days: cell positions, month labels, dimming outside the period, today |
| `intensity.ts` | the five levels of the calendar: 0, 1, 2, 3–4, 5+ conversations in a day, as in the prototype |
| `delta.ts` | rise, fall, same, no data |
| `orbitLayout.ts` | ring, angle and size per agent; one agent and nine agents |
| `stackSegments.ts` | widths and which segments are wide enough for a label (14% tall bar, 16% model bar, from the prototype) |
| `axisScale.ts` | the top value and steps of the spend chart: steps of 1, 2 or 5 times a power of ten, three to five of them, never more than six |
| `dailyColumns.ts` | the width of a day's column at the chart's measured width, and which days get a date under them; `dayBars`: the bars a day's column is stacked of, the topmost never under 1.5 px; `dayPricing`: whether a day's cost is of all its models, of the priced ones only, or unknown |
| `span.ts` | how long an incident lasted |
| `share.ts` | a part of a whole as a whole percent, and no share at all (null, drawn as a dash) when there is no whole; the part is held inside its whole, so no share is over 100% |
| `topicPixels.ts` | a topic's pixel bar: how many pixels beside the largest topic, never under one, and how they are shared between resolved, open and neither, by largest remainder |
| `qualityRows.ts` | the rows of the quality table: both shares, which is the highest of its column among the shares of at least three (`MIN_SUMMARISED_TO_RANK`, `MIN_RATED_TO_MARK`), what the "left open" cell holds (`share`, `none`, `off`), and the order; `anyWithoutSummary`: whether a row has a dash for want of a summary, which is when the table says so under itself |

The mapper (`data/stats.mapper.ts`, tested) reads the summaries blocks
defensively: a missing block, a count that is not a count and a list that is
not a list become zero, empty and `enabled: false`; a topic without an id or
a label and a topic question without words are left out; an open question
that names no conversation cannot be continued and is counted under `more`,
so the list and the remainder still add up to the open conversations. A
count that is a part of another (resolved or left open, of the summarised)
is never read as more than it.

## Text, numbers, dates

- English is written in `app/slices/profile/i18n/locales/en.json` under
  `stats.*`; `bun run i18n:sync` writes `ru`. Plurals use `|`. Copy chosen in
  script travels as a key.
- Numbers, percentages, dates and relative times go through `useFormat()` and
  `useRelativeTime()`. Added to the app format module: a compact number
  ("1.2M", "340k"), money, short weekday and month names, the browser's
  time zone name, which is what the page sends as `tz`, and a list of names
  joined the way the language joins them ("Ada, Bo, and Cy" · "Ада, Бо и Cy").
  A language's name ("Ukrainian" · "украинский") is `languageName`, which the
  module already had for the chat history; a code it does not know is shown
  as received.
- A label that is read out whole (a day's cell, an agent's bar) is one key
  with named parameters, with a key of its own for each kind of day or row:
  no sentence is put together from pieces in a template.
- Model names, incident reasons, knowledge base names, topic labels and
  questions are shown as received.

## Access and responsiveness

- Every chart has a text equivalent: the calendar and the spend chart have a
  table view; bars and the orbit carry an `aria-label` that reads the values.
  The table of days and the quality table have a caption for a screen reader,
  and the cell that names a row (the day, the agent) is its row header.
- What a number means is never left to a detail on hover: a touch opens
  none. A share stands with what it is a share of ("67% resolved of 6",
  "N of M" under a quality share), a topic's resolved and open counts are in
  the selected topic's line, and a dash in the quality table has a line
  under the table that says what it stands for.
- Everything that shows a detail on hover is focusable and shows it on focus.
  The three switches are button groups with `aria-pressed`; tabs are a
  `tablist`. The days of the spend chart are one tab stop, walked with the
  arrow keys, Home and End, so that 90 days do not stand between a keyboard
  and the next card.
- Colour is never the only carrier: a question's resolved, open and unclear
  marks differ in label and icon, the parts of a bar in label and position,
  the busiest weekday is named in text, "no price" has a dashed outline and
  words, and the highest share of a quality column has an icon and words.
- Entrance and count-up animation is skipped under
  `prefers-reduced-motion`.
- 390 px to 1440 px without page-level horizontal scroll. The calendar and
  tables scroll inside their block. Under 1024 px the pass sits above the
  column; under 700 px the scoreboard is two by two and two-column blocks
  stack.

## Colour

`app/slices/profile/assets/stats.css`, custom properties scoped to the
statistics root, values from the prototype: four categorical colours and a
neutral, three status colours (resolved, open, none), five steps of one hue
for calendar intensity. One addition (CLEAN-270): `--unclear`, a hatch of two
greys for the outcome the prototype did not have; it is a background, not a
colour. They were validated on the prototype's card colour;
the page uses the same card colour, like the pass beside it.

## Links out

- "To the agents" → `/agents`.
- "Continue" on an open question → `panelLocation(agentId, { kind:
  'conversation', chatId })` from `#agent/utils/panelView`, the builder the
  agent slice exports for this: `/agents/<agentId>?view=history&chat=<chatId>`,
  the agent's page with that conversation open in its history. It is a link
  (`NuxtLink`) and not a button with a handler: it opens in the same tab, as
  a link inside the console does, and like any link it can be opened in a
  new one or copied. Its accessible name is "Continue with <agent>", and its
  detail on hover and focus says where it leads; for an agent that came
  without a name both speak of the conversation instead.
