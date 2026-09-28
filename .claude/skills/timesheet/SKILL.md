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
beside it (`--repos a,b` to override).

It prints a short header and two paths. Read the `digest` file in full: it is
the month day by day, each ticket with its Jira events and commits. `data` is
the same as JSON.

## 2 · Read the identity line first

The first line of the header says whose month this is.

| First line | What to do |
|---|---|
| `identity: … (verified)` | `git config user.email` was found in Jira. Carry on. |
| `WARNING identity: …` | The git address is unset or unknown to Jira, and the data is the **default person's**. Open your reply with this, naming both addresses, before any table. |
| `timesheet: …` and exit 1 | Nothing was collected. Report the message and stop. |

The person is never chosen by name, by guess, or from the conversation. To
report for someone else, that person runs it from their own clone.

## 3 · Turn evidence into rows

One row per ticket per day. What counts as evidence that day:

| The ticket that day has | Row |
|---|---|
| a commit or a comment | yes |
| `created` and nothing else | yes, 1 hour, as the write-up of the task |
| `created`, and it is a `subtask of` a ticket with a row that day | no, it is part of the parent's row |
| status changes and nothing else | no |

**Days**

- Work before 05:00 that continues the evening before belongs to that evening's
  date.
- `weekdays still ahead` — leave them out and say so.
- `today` — today counts for what it shows so far. Say the day was not over.
- `weekdays without any activity` — ask the person what they did. If they
  already said they worked every day, put the nearest large ticket there and
  list the day under assumptions.
- A weekday that shows little — one merge, a couple of comments — is filled to
  6 only if the person said they worked every day, and is listed under
  assumptions. Otherwise it gets what it shows.

**Hours**

- Whole numbers, 1 at the least.
- Weigh first, then fit the day. Weight comes from the span between the first
  and last event, the number of commits, spec/plan/tasks commits, a release
  bump. A ticket opened and sent to testing within minutes on one commit is 1;
  a ticket with a spec and a dozen commits is 3 or more, whatever else
  happened that day.
- A weekday lands on 6–8 when the weights allow it, and may reach 10 when the
  day was crowded. Above 10, `build-csv.mjs` names the day: take the hours off
  its largest rows.
- A weekend day gets what it shows, with no target.
- A commit naming two tickets counts for both, and its weight is shared, not
  doubled.

**Tickets**

- `(no ticket)` commits: when the subject makes the ticket plain, they add to
  that ticket's weight and are listed under assumptions. Otherwise leave them
  out and list them too.
- A ticket marked `assignee: <someone else>` stays in if the person committed
  to it; list it under assumptions.
- `absent in Jira` tickets get no row.

**Descriptions** — Russian, one line, up to about 100 characters, no full stop.
Say what landed that day, from the commit subjects. When a ticket spans
several days, each day names its own part. A row without commits is worded
from the ticket title: `Постановка: …` for a created ticket, `Проверка и
обсуждение: …` for a commented one.

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
Exit 1 lists rows to fix; fix them and run it again. Do not write the CSV by
hand. `рабочих дней` in the last row counts every day worked, weekends too.

## 5 · Report

In this order:

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
