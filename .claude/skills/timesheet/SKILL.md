---
name: timesheet
description: Use when someone asks for their monthly hours, a timesheet, a work
  report for a month, "таблица часов", "отчёт за месяц", "табель", or a
  Jira/git activity table to import into Google Sheets.
---

# timesheet

Builds one person's month as a table — date, day, ticket, link, description,
hours — from Jira and the git clones, as a CSV that Google Sheets imports.

Two scripts do the mechanical part. Deciding the hours and wording each row is
yours: Jira holds no worklogs, so every number is an estimate from evidence.

The delivery cycle in `CLAUDE.md` is for changes to the repo. This report makes
none, so it takes no Jira ticket, no branch and no commit.

## 1 · Collect

```bash
node .claude/skills/timesheet/scripts/collect.mjs --month 2026-09
```

Without `--month` it takes the current month from the 15th on, the previous
one before that. It scans this clone plus the `runtime` and `bridle` clones
beside it (`--repos a,b` to override, `--out file.json` to choose where the
data lands).

It prints a short header and two paths. Read the `digest` file in full: it is
the month day by day, each ticket with its Jira events and commits. `data` is
the same as JSON.

Everything in the digest is the person's own: commits they authored, tickets
they created, status changes and comments they made. Work before 05:00 is
already filed under the evening before and marked `+1d`.

## 2 · Read the identity line first

The first line of the header says whose month this is.

| First line | What to do |
|---|---|
| `identity: … (verified)` | `git config user.email` was found in Jira. Carry on. |
| `WARNING identity: …` | The git address is unset or unknown to Jira, and the data is the **default person's**. Build the table all the same, and open your reply with the warning, naming both addresses, before anything else. |
| `timesheet: …` and exit 1 | Nothing was collected. Report the message and stop. |

The person is never chosen by name, by guess, or from the conversation. To
report for someone else, that person runs it from their own clone.

## 3 · Turn evidence into rows

One row per ticket per day. Take the first line of this table that fits:

| The ticket that day | Row |
|---|---|
| is `absent in Jira` | no |
| is marked `assignee: …` (someone else, or nobody) and has no commit | no |
| has a commit | yes |
| has a comment | yes |
| was `created`, and is a `subtask of` a ticket with a row that day | no, it is part of the parent's row |
| was `created` | yes, 1 hour, as the write-up of the task |
| only changed status | no |

`(no ticket)` commits join a ticket when the subject names the same feature as
that ticket's title or its other commits; they count as that ticket's commits,
and may give it a row on a day it has nothing else. The rest stay out. List
both kinds under assumptions.

**Hours**

- Whole numbers, 1 at the least.
- Each row is weighed on its own evidence: the number of commits, the span
  between the first and last event, spec/plan/tasks commits, a release bump.
  A ticket opened and sent to testing within minutes on one commit is 1. A
  ticket with a spec and a dozen commits is 3 or more. A lone `(#NN)` merge
  days after the work is 1: review and merge.
- Tickets worked side by side in the same hour share that hour. Commits that
  carry one timestamp were rebased together; count them, ignore their span.
- A commit naming two tickets counts for both, and its weight is shared, not
  doubled.
- A day is the sum of its rows. A full weekday usually comes to 6–8; that is
  what to expect, not a number to reach.
- Above 10 hours `build-csv.mjs` names the day. Take hours off its largest
  rows, unless the 1-hour minimums alone make the day that long.

**Days**

- `weekdays still ahead` — leave them out and say so.
- `today` — today gets what it shows so far. Say the day was not over.
- `weekdays without any activity` — leave them out, list them, and ask what
  was done on them.
- When the person has said they worked every weekday in full, and only then:
  a weekday under 6 is raised to 6 on its largest row, and a weekday without
  activity gets the nearest large ticket at 6. List every such day under
  assumptions.
- A weekend day gets what it shows.

**Descriptions** — Russian, one line, up to about 100 characters, no full stop.
Say what landed that day, from the commit subjects. When a ticket spans
several days, each day names its own part. A row without commits is worded
from the ticket title: `Постановка: …` when the ticket was created that day,
`Проверка и обсуждение: …` otherwise.

## 4 · Build the CSV

Write the rows to a file in the scratchpad or temp directory:

```json
{ "month": "2026-09", "rows": [
  { "date": "2026-09-01", "key": "CLEAN-55", "text": "Статус «unreachable», когда рантайм не подключён к хабу", "hours": 2 }
] }
```

```bash
node .claude/skills/timesheet/scripts/build-csv.mjs --rows <rows.json>
```

It checks the rows, adds the day names, links and the `ИТОГО` row, and writes
`timesheet-YYYY-MM.csv` to the person's Downloads folder (`--out` to override).
Exit 1 lists rows to fix; fix them and run it again. A `days above 10h` line
comes with exit 0 and a written file: see Hours. Do not write the CSV by hand.
`рабочих дней` in the last row counts every day worked, weekends too.

## 5 · Report

In the language the person wrote in, in this order:

1. Whose month it is: the Jira name and the address. With the identity
   warning, if there was one, in front of it.
2. The path of the CSV, the number of rows and days, the total hours.
3. Hours per day.
4. Assumptions: days filled on the person's word, commits without a ticket,
   tickets of other people, weekend rows, days left out, today if unfinished.
5. That the hours are estimates, to be looked over before the table is sent.

## Never

- Print or paste values from `.env.project`.
- Invent a ticket, a day or a commit the digest does not show.
- Leave the CSV inside the repo.
