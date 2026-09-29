# Contract: admin value formats

What an operator sees for each kind of value, on every admin screen, in every
browser. One row, one format. A value that is not in this table is not formatted
by hand — the table gets a row first.

**Language**: English, fixed. **Time zone**: the viewer's own. **Clock**:
24-hour.

The reference instant for the examples is 21 August 2026, 00:46:12 local time.

| Kind | Looks like | Used for |
|------|-----------|----------|
| Date | `Aug 21, 2026` | table columns, "created", "expires" |
| Date and time | `Aug 21, 2026, 00:46` | "last synced", "last modified", session start, tooltips |
| Time of day | `00:46` | "saved at", rate-limit reset, a message sent today |
| Time of day, to the second | `00:46:12` | debug panel, log lines |
| Message time | `00:46` today · `Aug 21, 00:46` earlier this year · `Aug 21, 2025, 00:46` before that | chat transcript |
| Modified | `00:46` today · `Aug 21` this year · `Aug 21, 2025` before that | file explorer rows |
| Day divider | `August 21, 2026` | the line between days in a chat |
| Relative time | `5 minutes ago`, `yesterday`, `in 2 hours` | "deployed", "updated", activity feeds |
| Count | `1,234,567` | tokens, files, rows |
| Amount | `$1,234.50` | cost |
| Amount, per call | `$0.0012` | the usage panel, where a call costs a fraction of a cent — as before |
| Compact count | `1.2k`, `3.4M` | dense headers — unchanged, already language-neutral |
| Name order | `a` before `B` before `c`, the same for every operator | every list sorted by name |

## Standing in for a missing value

| Situation | Text |
|-----------|------|
| No date recorded, table cell | `—` |
| Never happened ("last sync") | `never` |
| Date that cannot be read | empty |

These are decided per screen today and stay per screen; the contract is only
that they are English and that a date which *can* be read always uses the table
above.

## What does not change

- The instant shown. Only the wording and the format change.
- Byte sizes (`2.1 KB`), durations (`1.4 s`), CPU and memory units. They are
  already independent of the browser. The console carries several copies of the
  byte formatter that round differently; collapsing them is recorded as debt in
  [research.md](../research.md), not done here.
- Anything a person or the agent wrote.
- Log lines, error details and reasons received from the server or the agent
  runtime, including any timestamp written inside them. The console formats
  the label it puts next to a log line, never the line.

## Visible differences after this change

An operator with an **English (US) browser** will notice:

- times move from `12:46 AM` to `00:46` wherever the browser used to decide;
- the debug panel date order is unaffected (it shows time only).

An operator with a **Russian browser** will notice every date and number
changing from Russian to English. That is the fix.
