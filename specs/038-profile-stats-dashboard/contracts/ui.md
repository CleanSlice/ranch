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

| # | Block | Component |
|---|-------|-----------|
| 1 | Scoreboard | `InstallationBoard.vue` |
| 2 | Spend by day | `Daily.vue` (stacked columns, table view) |
| 3 | Agents by cost | `AgentsByCost.vue` |
| 4 | Health · Where people are unhappy (side by side) | `Health.vue`, `Quality.vue` |
| 5 | Where people write | `Channels.vue` |

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
| A figure's history starts inside the period | one line in that block: counted since the date (from `notes`) |
| No open questions | one line with a check mark |
| No incidents / no refusals | one line each |
| A model without a price | a dashed "no price" mark in the legend and in the agent's row, tokens instead of money, and the total labelled as an estimate without it |
| The Owner on "My conversations" | the scope line says these are their conversations from both consoles |
| An operator limited to some agents, on the installation scope | the scope line says the figures cover the agents they reach, with the count |

## Departures from the prototype

| Prototype | Here | Why |
|-----------|------|-----|
| "Where you write" in the personal scope | `Channels.vue` in the installation scope only | a console account is not linked to a messenger identity (spec, Assumptions) |
| "Counted by the model the agent has now" always | that line only when `models.fallback` is true | the day's model is on record |
| Outcome bar: resolved, open, no summary | a fourth, neutral part "unclear" when its count is above zero | `unknown` is a real answer |
| Day cells say "N conversations" started | conversations written in that day | a conversation can last for weeks; the block's caption says "conversations you wrote in" |
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
| `axisScale.ts` | the top value and steps of the spend chart |

## Text, numbers, dates

- English is written in `app/slices/profile/i18n/locales/en.json` under
  `stats.*`; `bun run i18n:sync` writes `ru`. Plurals use `|`. Copy chosen in
  script travels as a key.
- Numbers, percentages, dates and relative times go through `useFormat()` and
  `useRelativeTime()`. Added to the app format module: a compact number
  ("1.2M", "340k"), money, short weekday and month names, and the browser's
  time zone name, which is what the page sends as `tz`.
- Model names, incident reasons, knowledge base names, topic labels and
  questions are shown as received.

## Access and responsiveness

- Every chart has a text equivalent: the calendar and the spend chart have a
  table view; bars and the orbit carry an `aria-label` that reads the values.
- Everything that shows a detail on hover is focusable and shows it on focus.
  The three switches are button groups with `aria-pressed`; tabs are a
  `tablist`.
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
