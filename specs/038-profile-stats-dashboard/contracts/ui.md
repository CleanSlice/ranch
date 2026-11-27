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

`Quality.vue` has the three columns of the prototype, and one of them waits.
PR 4 shipped before PR 3, so `quality[]` has no `open` yet: the "left open"
column holds a dash in every row, read out as "not counted yet", and one
line under the table says "The share of conversations left open is not
counted yet." The words stood in the cell at first and broke over three
lines in every row. Rows keep the API's order, most conversations first,
until the open share exists; the highest share of poor ratings is
marked by colour, an icon and words for a screen reader.

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
| Summaries off | blocks 4 to 6 become one card; the text depends on the role: a User is told an administrator switches them on; an operator is told they are off for this installation and that `CHAT_INSIGHT_INTERVAL_SEC` switches them on |
| Summaries on, some conversations waiting | one line under Topics: how many are waiting and not counted yet; conversations too short to summarise are named separately and not as waiting |
| A figure's history starts inside the period | one line in that block: counted since the date (from `notes`). In the installation scope `activity` is noted once, under the scoreboard, and `refusals` inside the Health card |
| No open questions | one line with a check mark |
| No incidents / no refusals | one line each |
| A model without a price | a dashed "no price" mark in the legend and in the agent's row, tokens instead of money, and the total labelled as an estimate without it. An agent that ran priced and unpriced models keeps its cost, with a dashed "+" and a tip that the cost covers the priced ones only. A day of unpriced models only shows the mark where its cost would be: that money is unknown, not zero |
| A day that mixes priced and unpriced models | the day keeps its cost, which is of the priced models only, and a dashed "+" stands beside it wherever that cost is printed: in the day's detail on the chart, with the line "Some of the day's models have no price; the cost is of the rest." under it, and in the day's row of the table, where the same line stands once under the table (a mark with a pop-up in each of 90 rows would be 90 tab stops, and a touch opens no pop-up). The cell's label says it in words: "…, estimated cost ≈ $7.35, without the models that have no price" |
| A cost above zero and under half a cent | "< $0.01" in the language's money format, never "≈ $0.00": something was spent. A true zero stays "≈ $0.00" |
| No finished day with usage in the period | the projection is a dash with "A projection needs at least one finished day with usage." |
| The share of conversations left open, until PR 3 | a dash in every row of the quality table and one line under it |
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

## Departures from the prototype

| Prototype | Here | Why |
|-----------|------|-----|
| "Where you write" in the personal scope | `Channels.vue` in the installation scope only | a console account is not linked to a messenger identity (spec, Assumptions) |
| "Counted by the model the agent has now" always | that line only when `models.fallback` is true | the day's model is on record |
| Outcome bar: resolved, open, no summary | a fourth, neutral part "unclear" when its count is above zero | `unknown` is a real answer |
| Day cells say "N conversations" started | conversations written in that day | a conversation can last for weeks; the block's caption says "conversations you wrote in" |
| "Where people are unhappy" shows a share left open per agent | a dash in that column and rows in the API's order, most conversations first, until PR 3 | the share is read from summaries, and PR 4 shipped first (CLEAN-265) |
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

## Text, numbers, dates

- English is written in `app/slices/profile/i18n/locales/en.json` under
  `stats.*`; `bun run i18n:sync` writes `ru`. Plurals use `|`. Copy chosen in
  script travels as a key.
- Numbers, percentages, dates and relative times go through `useFormat()` and
  `useRelativeTime()`. Added to the app format module: a compact number
  ("1.2M", "340k"), money, short weekday and month names, the browser's
  time zone name, which is what the page sends as `tz`, and a list of names
  joined the way the language joins them ("Ada, Bo, and Cy" · "Ада, Бо и Cy").
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
- Everything that shows a detail on hover is focusable and shows it on focus.
  The three switches are button groups with `aria-pressed`; tabs are a
  `tablist`. The days of the spend chart are one tab stop, walked with the
  arrow keys, Home and End, so that 90 days do not stand between a keyboard
  and the next card.
- Colour is never the only carrier: resolved and open differ in label and
  position, the busiest weekday is named in text, "no price" has a dashed
  outline and words.
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
for calendar intensity. They were validated on the prototype's card colour;
the page uses the same card colour, like the pass beside it.

## Links out

- "To the agents" → `/agents`.
- "Continue" on an open question → `panelLocation(agentId, <that
  conversation>)` from `#agent/utils/panelView`, the builder the agent slice
  exports for this.
