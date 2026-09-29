# Feature Specification: English-Only Admin Console, Language-Correct Values in App

**Feature Branch**: `fix/CLEAN-127-english-admin-locale`

**Created**: 2026-09-29

**Status**: Draft

**Ticket**: [CLEAN-127](https://dreamvention.atlassian.net/browse/CLEAN-127)

**Input**: User description: "Убедись что в админке все инструменты и интерфейсы строго на английском языке. Сейчас что бросилось в глаза - [screenshot: chat message stamped '21 авг., 00:46']. Дата сообщения на русском, видимо не передается параметр локали. Так же и в app, там язык можно менять, но должны все значения корректно переведены и использоваться, чтобы не было проблем"

## Background

The product has two consoles. The **admin console** is used by the team that
operates the platform and is English-only by decision. The **customer console**
(app) ships in English and Russian, and the customer picks the language.

Today the admin console is English only where somebody typed English words.
Values the console *computes* — dates, times, numbers — take their language
from the operator's browser. An operator with a Russian browser sees a chat
message stamped "21 авг., 00:46" in an otherwise English screen. The same
behaviour sits behind dates in files, secrets, templates, sessions, settings,
API keys, knowledge, evaluations, share links and users: roughly forty places
across the admin console follow the browser, and the ones that do not follow it
disagree with each other about what "English" looks like.

The customer console has the opposite obligation: whatever the customer picked
must reach every value on the screen, and nothing may stay behind in the other
language or fall back to the browser's.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator sees English regardless of their browser (Priority: P1)

An operator whose browser and operating system are set to Russian (or any other
language) opens the admin console. Every screen reads in English: labels,
buttons, messages, and every date, time, number and "5 minutes ago" on the page.

**Why this priority**: This is the reported defect and the one visible today.
The admin console is shared by a team working in different languages; a screen
whose dates change with the viewer cannot be screenshotted into a ticket or read
aloud on a call without confusion.

**Independent Test**: Set the browser language to Russian, walk every admin
screen, and confirm no value renders in Russian. Delivers a consistent English
admin console on its own, with no change to the customer console.

**Acceptance Scenarios**:

1. **Given** a browser set to Russian, **When** the operator opens a chat
   transcript with a message from a previous day, **Then** the timestamp reads
   in English (for example "Aug 21, 00:46"), not "21 авг., 00:46".
2. **Given** a browser set to Russian, **When** the operator opens any admin
   screen that shows a date, a time, a number or a relative time, **Then** the
   value is in English.
3. **Given** two operators with different browser languages, **When** both open
   the same admin screen, **Then** both see the same text for every value, apart
   from the time zone offset of their own location.
4. **Given** a value shown in a tooltip or on hover, **When** the operator
   hovers it, **Then** the tooltip is in English too.
5. **Given** the same kind of value shown on two different admin screens (for
   example a "last modified" date), **When** the operator compares them,
   **Then** both use the same format.

---

### User Story 2 - Customer sees every value in the language they picked (Priority: P1)

A customer uses the customer console in Russian. Everything the console itself
produces is in Russian: labels, messages, dates, times, numbers, relative time,
plural forms. They switch to English and everything follows, with nothing left
behind.

**Why this priority**: Equal to Story 1 — it is the same defect class on the
surface customers actually use. A half-translated screen reads as a broken
product, and a customer who picked a language has been told, by the switcher
itself, that the console honours the choice.

**Independent Test**: Walk every customer console screen once in each language
with the browser set to a third language, and confirm every console-produced
value matches the selected language. Delivers a fully consistent customer
console on its own.

**Acceptance Scenarios**:

1. **Given** the customer selected Russian, **When** they open any screen,
   **Then** every label, message, date, time and number produced by the console
   is in Russian.
2. **Given** the customer selected English and their browser is set to Russian,
   **When** they open any screen, **Then** every console-produced value is in
   English — the browser language has no effect.
3. **Given** a screen is open, **When** the customer switches language,
   **Then** every value on that screen changes to the new language without a
   reload, including values that were already rendered.
4. **Given** a count that needs a plural ("1 slot", "2 slots", "5 slots"),
   **When** it is shown in Russian, **Then** the grammatically correct form is
   used for that number.
5. **Given** an error or status message that originates outside the console,
   **When** it is shown to the customer, **Then** the console's own words
   around it are in the selected language and the message itself is shown
   exactly as it was received.

---

### User Story 3 - Agent tools read in English in the admin console (Priority: P2)

An operator working through the admin chat sees the tools the Ranch agent can
use: their names, descriptions, confirmation prompts and result summaries. All
of it is in English, whatever language the operator types in.

**Why this priority**: Tools are part of the admin interface and the request
names them explicitly. They are lower than Stories 1–2 because no non-English
tool text is known today; this story confirms it and keeps it true.

**Independent Test**: List every tool available in the admin console, trigger a
confirmation prompt and a result card for a sample of them, and confirm the
console-produced text is English.

**Acceptance Scenarios**:

1. **Given** the list of tools available to the agent in the admin console,
   **When** the operator reads their names and descriptions, **Then** all are in
   English.
2. **Given** a tool that asks for confirmation, **When** the prompt appears,
   **Then** the prompt and its buttons are in English.
3. **Given** the operator writes to the agent in Russian, **When** the agent
   answers in Russian, **Then** the answer is left as the agent wrote it, while
   the surrounding interface — timestamps, tool cards, buttons — stays English.

---

### User Story 4 - A new unlocalised value is caught before it ships (Priority: P2)

A developer adds a screen that shows a date. If they leave the language to the
browser, or add customer-facing text that is not translated, the automated
checks that already gate every change fail and say where.

**Why this priority**: Without it, Stories 1–3 hold only until the next feature.
The current state was reached one reasonable-looking line at a time; a rule that
lives in a document did not stop it.

**Independent Test**: Introduce a deliberately unlocalised date into each
console on a throwaway change and confirm the checks reject it, naming the
location.

**Acceptance Scenarios**:

1. **Given** a change that formats a date, time or number in the admin console
   without fixing the language to English, **When** the checks run, **Then**
   they fail and point at the place.
2. **Given** a change that formats a date, time or number in the customer
   console without using the selected language, **When** the checks run,
   **Then** they fail and point at the place.
3. **Given** a change that adds non-English interface text to the admin
   console, **When** the checks run, **Then** they fail.
4. **Given** a change that respects the rules, **When** the checks run,
   **Then** they pass without the developer doing anything extra.

---

### Edge Cases

- **Browser in a language with its own digits or right-to-left script**
  (Arabic, Persian): the admin console still shows Latin digits and English
  text; the customer console shows the selected language, not the browser's.
- **Time zone**: language and time zone are separate. Both consoles keep
  showing times in the viewer's local time zone; only the wording and format
  are governed by this feature.
- **Page load**: a value must not appear in one language and then change to
  another while the page finishes loading.
- **No language selected yet**: the customer console starts in the offered
  language matching the browser, English otherwise — the existing first-visit
  behaviour. The screen is then entirely in that language; a Russian date on an
  English screen is a defect whichever way the language was chosen.
- **Stored language no longer offered**: the customer console falls back to
  English.
- **Content written by people or by the agent** — chat messages, file names,
  agent names, knowledge documents, agent replies — is shown exactly as written
  in both consoles. It is never translated and never counts as a violation.
- **Logs, error details and reasons sent by the server** are shown exactly as
  received in both consoles, whatever language is active. A Russian screen may
  therefore carry an English sentence from the server; the words the console
  puts around it are Russian. Timestamps inside a log line are part of the
  line and are not reformatted.
- **Customer data containing non-English text** (a workbook with Cyrillic
  headers, a customer's company name) is content, not interface.
- **Values with no date yet** ("never", "unknown", "—") are interface text and
  follow the same language rule as the dates they stand in for.
- **Units and abbreviations** attached to numbers (durations such as "12s",
  file sizes, token counts) follow the console's language rule like any other
  produced value.
- **Sorting of names in lists** must give every operator the same order in the
  admin console, independent of browser language.
- **Exports and downloads** generated by a console (for example a chat
  transcript) carry dates in the same language the console showed them in.

## Requirements *(mandatory)*

### Functional Requirements

**Admin console**

- **FR-001**: The admin console MUST present all interface text in English,
  independent of the browser's or operating system's language.
- **FR-002**: The admin console MUST present every date, time, number,
  currency amount and relative time ("5 minutes ago") in English, independent
  of the browser's or operating system's language.
- **FR-003**: The admin console MUST use one consistent format per kind of
  value (date, date with time, time of day, relative time, count, amount), so
  the same kind of value looks the same on every screen.
- **FR-004**: The admin console MUST keep showing times in the viewer's local
  time zone.
- **FR-005**: Tooltips, hover text, placeholders, empty states and
  confirmation dialogs in the admin console MUST follow FR-001 and FR-002.
- **FR-006**: Names, descriptions, confirmation prompts and result summaries
  of agent tools shown in the admin console MUST be in English.
- **FR-007**: Lists sorted by name in the admin console MUST produce the same
  order for every operator.

**Customer console**

- **FR-008**: The customer console MUST present all interface text in the
  language the customer selected.
- **FR-009**: The customer console MUST present every date, time, number,
  currency amount and relative time in the selected language, and MUST NOT
  take the language from the browser or operating system once a selection
  exists.
- **FR-010**: Switching language MUST update every value on the current screen
  without a reload, including values rendered before the switch.
- **FR-011**: Counts MUST use the grammatically correct plural form for the
  selected language.
- **FR-012**: A message that originates outside the customer console — a
  server's reason, an error detail, a log line — MUST be shown exactly as it
  was received, in every language. The words the console itself puts around
  it, and the message the console shows when nothing was received, MUST be in
  the selected language.
- **FR-013**: Every piece of interface text in the customer console MUST exist
  in every offered language; no text may be shown as a raw identifier or fall
  back silently to another language.
- **FR-014**: When the customer has not selected a language yet, the customer
  console MUST start in the offered language that matches the browser's
  preference, and in English when none matches. The browser decides only that
  starting language: from then on every value follows the console's active
  language as one, never the browser directly.

**Both consoles**

- **FR-015**: Content authored by people or by the agent, and text received
  from the server (logs, error details, reasons), MUST be displayed as written
  and MUST NOT be translated or reformatted by this feature.
- **FR-016**: A value MUST NOT visibly change language while a page loads.
- **FR-017**: Wherever the same screen or behaviour exists in both consoles,
  both MUST be reviewed and brought into line with their own console's rule;
  the result of that review MUST be recorded for each shared area.
- **FR-018**: The work MUST begin with a complete inventory of every place in
  both consoles where a value's language is decided, and each entry MUST end
  as either corrected or confirmed correct.

**Keeping it true**

- **FR-019**: The automated checks that gate every change MUST fail when a
  date, time or number in the admin console is formatted without English being
  fixed, and MUST name the location.
- **FR-020**: The automated checks MUST fail when a date, time or number in
  the customer console is formatted without the selected language, and MUST
  name the location.
- **FR-021**: The automated checks MUST fail when non-English interface text
  is added to the admin console.
- **FR-022**: The rule for each console MUST be written where developers
  already look for language guidance, including the admin console's
  English-only formatting rule, which is not written down today.

### Key Entities

- **Console language rule**: the one rule each console obeys — "always
  English" for admin, "the customer's selection, English when there is none"
  for the customer console. Every produced value is judged against it.
- **Produced value**: anything a console generates rather than displays as
  written — a label, a date, a time, a number, an amount, a relative time, a
  plural form, a unit.
- **Authored content**: text written by a person or by the agent. Shown as is;
  outside the rule.
- **Received text**: text a console was handed by the server rather than
  wrote itself — a reason, an error detail, a log line. Shown as is, in both
  consoles; never translated and never reformatted.
- **Inventory entry**: one place where a produced value's language is decided,
  with its console, the screen it belongs to, and its outcome (corrected /
  confirmed correct).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the browser set to Russian, a walk through every admin
  screen finds zero produced values in a language other than English.
- **SC-002**: With the browser set to a third language, a walk through every
  customer console screen finds zero produced values in a language other than
  the selected one — verified once for each offered language.
- **SC-003**: Two operators with different browser languages see identical
  text on 100% of admin screens, time zone aside.
- **SC-004**: After switching language in the customer console, 100% of the
  values on the current screen are in the new language within one second,
  without a reload.
- **SC-005**: 100% of inventory entries are closed as corrected or confirmed
  correct, and every area shared by both consoles has a recorded review.
- **SC-006**: A deliberately unlocalised date added to either console is
  rejected by the automated checks in 100% of attempts, with its location
  named.
- **SC-007**: Each kind of value in the admin console has exactly one format
  across all screens.
- **SC-008**: Zero interface strings in the customer console are missing a
  translation in any offered language.

## Assumptions

- **Admin stays English-only.** This feature enforces the existing decision; it
  does not add a language switcher to the admin console.
- **The customer console offers English and Russian**, as today. Adding a third
  language is out of scope, but nothing in this feature may make it harder.
- **Admin format**: English month and day names, a 24-hour clock and English
  digit grouping. The 24-hour clock was confirmed by the product owner on
  2026-09-29.
- **Logs and server messages are not touched.** Log lines, error details and
  reasons sent by the server are shown as received in both consoles. Decided by
  the product owner on 2026-09-29: translating or reformatting them would make
  them harder to search for and to quote.
- **"Tools" means the agent tools surfaced in the admin console** — their
  names, descriptions, prompts and result cards — together with the admin
  screens themselves.
- **Time zone behaviour is unchanged.** Letting a viewer choose a time zone is
  out of scope.
- **What the agent says is authored content.** The language the agent replies
  in is governed by the agent's own instructions and is out of scope.
- **Emails, notifications sent outside the consoles, and text in messaging
  channels** are out of scope; this feature covers what is rendered inside the
  two consoles and the files they export.
- **Source code comments and test data** are not interface and are out of
  scope, whatever language they are written in.
- **Existing translation checks for the customer console remain** and are
  extended, not replaced.
- **No data changes.** Stored dates and numbers are not rewritten; only their
  presentation changes.
