# Data Model: English-Only Admin Console, Language-Correct Values in App

Nothing is stored. No table, column, endpoint or DTO changes, and no stored
date or number is rewritten. The entities below are the vocabulary the plan and
the check share; they live in code and in `inventory.md`, not in a database.

## Console language rule

The one rule a console obeys. There are exactly two.

| Field | admin | app |
|-------|-------|-----|
| `console` | `admin` | `app` |
| `language` | fixed: English | the console's active language |
| `source of the language` | a constant | the language switcher; on a first visit, the browser's preference among offered languages, else English |
| `reacts to a switch` | no switch exists | yes, every value on screen |
| `offered languages` | `en` | `en`, `ru` |

**Invariant**: a produced value takes its language from the rule and from
nowhere else. The browser is never asked directly.

## Produced value

Anything a console generates rather than shows as written.

| Field | Meaning |
|-------|---------|
| `kind` | `date` · `dateTime` · `time` · `timeWithSeconds` · `messageTime` · `modified` · `dayDivider` · `relativeTime` · `count` · `amount` · `nameOrder` · `text` |
| `input` | an instant, a number, two names to compare, or a message key |
| `language` | supplied by the console language rule |
| `output` | the text on screen |

**Validation**

- Each `kind` has exactly one format per console
  ([admin](contracts/admin-format.md), [app](contracts/app-format.md)).
- An unreadable `input` (invalid date, `NaN`) yields the screen's own
  placeholder, never `Invalid Date` or `NaN`.
- `text` in app exists in every offered language; in admin it is English.

## Authored content

Text written by a person or by the agent: chat messages, file names and
contents, agent names, knowledge documents, customer data. Shown as written.
Never translated, never reformatted, never reported by the check.

The boundary that matters in practice: an agent's reply is authored content; the
timestamp under it is a produced value.

## Received text

Text a console was handed by the server rather than wrote itself: a refusal
reason, an error detail, a log line. Treated like authored content — shown as
received, never translated, never reformatted — in both consoles and in every
language.

The boundary: in "Отклонено: Another proposal for this file was applied
first", the first word is a produced value and the sentence after the colon is
received text.

## Format module

The single place in each console where a produced value is turned into text.

| Field | admin | app |
|-------|-------|-----|
| `location` | the `common` slice | the `common` slice |
| `language input` | none — fixed inside the module | passed in, or read from the active language |
| `consumers` | every admin slice | every app slice |

**Invariant**: language-sensitive formatting happens inside the format module
and nowhere else. This is what makes the rule checkable: the check does not
need to understand a call, only to see where it sits.

## Inventory entry

One place where a produced value's language is decided. `inventory.md` holds
them all (FR-018).

| Field | Meaning |
|-------|---------|
| `console` | `admin` or `app` |
| `slice` | owning slice |
| `location` | file and line at the time of the inventory |
| `kind` | the produced-value kind it should use |
| `language came from` | `browser` · `fixed <tag>` · `active language` · `passed in` |
| `outcome` | `open` → `corrected` or `confirmed correct` |

**State**: `open` → `corrected` | `confirmed correct`. No entry may remain
`open` when the work is done (SC-005).

## Shared-area review

One record per slice that exists in both consoles (`agent`, `bridle`, `chat`,
`common`, `setup`, `share`, `user`).

| Field | Meaning |
|-------|---------|
| `slice` | one of the seven |
| `admin` | what was changed, or why nothing was needed |
| `app` | what was changed, or why nothing was needed |

Lives in `inventory.md` and is repeated, in words, in the pull request.

## Check finding

What the automated check reports.

| Field | Meaning |
|-------|---------|
| `rule` | which rule was broken ([contract](contracts/locale-check.md)) |
| `location` | file and line |
| `found` | the offending text, trimmed |
| `fix` | one sentence: what to use instead |

Zero findings → the check passes. One or more → it fails and prints every
finding, not just the first.
