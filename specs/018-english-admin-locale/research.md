# Research: English-Only Admin Console, Language-Correct Values in App

Taken at `origin/main` `856eb7e1`, 2026-09-29. The full list of places is in
[inventory.md](inventory.md); this file records what was decided and why.

## What is actually wrong

**Admin.** 57 places decide a value's language. 41 of them leave it to the
browser — a date, time or number formatted with no language named. The reported
timestamp, "21 авг., 00:46", is `admin/slices/chat/utils/transcript.ts:100` and
`:107`. The other 16 are English already but spell it three ways (`en`,
`en-US`, `en-GB`), so the clock is 12-hour on one screen and 24-hour on the
next. Admin carries no Russian interface text, and its i18n setting is fixed to
`en` with no browser detection — the defect is entirely in computed values.

**App.** Dates are correct: all 9 calls take the active language, reactively,
and none captures it once. The problems are elsewhere:

| Problem | Where | Count |
|---------|-------|-------|
| English fallbacks written in the console for when the server says nothing | sign-in, register, session-ended, chat delivery error, agent restart | 9 |
| Interface text that bypasses translation | raw status / role / sentiment / mode / action values, a fallback agent name, key caps | 27 |
| Numbers and units built by hand | byte sizes, percent, plain counts | 14 |
| `<html lang>` never set | both consoles | 2 |

**API.** One tool description (`import_my_peer_by_address`) contains a Russian
trigger word, and the admin tool catalog shows descriptions. Titles and
templates of all 31 tool files are English. Chat export writes ISO timestamps
and is independent of language.

---

## Decisions

### D1. Admin language tag and clock

- **Decision**: `en-US` with a 24-hour clock (`hourCycle: 'h23'`), giving
  `Aug 21, 2026, 00:46`.
- **Confirmed** by the product owner on 2026-09-29.
- **Rationale**: Month-before-day matches the 8 places already on `en-US` and
  the shared `formatDate` helper, so the fewest screens change shape. The
  24-hour clock matches what operators see today on the screens that follow a
  European browser, including the one in the report, and removes AM/PM from
  log-adjacent screens where it costs width. `hourCycle: 'h23'` rather than
  `hour12: false`, because the latter is allowed to render midnight as `24:46`.
- **Alternatives considered**: `en-GB` (`21 Aug 2026, 00:46`) — 24-hour by
  default, but flips the order on every screen that is already English.
  `en-US` with its own 12-hour clock — no code reason against it; rejected on
  the width and the current look.

### D2. One format module per console, in `common`

- **Decision**: `admin/slices/common/utils/format.ts` and
  `app/slices/common/utils/format.ts`. Admin's fixes the language inside. App's
  takes the language as its first argument, and a composable
  (`app/slices/common/composables/useFormat.ts`) binds it to the active
  language for components. Admin's relative time ("5 minutes ago") needs a live
  clock and lives beside the module in `composables/useRelativeTime.ts`, so the
  module itself imports no Vue and pure utilities can use it under test.
- **Rationale**: The check (D6) can only be a lookup if there is one place
  where language-sensitive formatting is allowed. `common` is that place by the
  constitution's own definition — behaviour every slice needs. Pure utilities
  that already take a `locale` parameter (`chatFlow`, `transcript`) keep their
  signature and call the module.
- **Alternatives considered**: A helper per slice — what exists today, and how
  three spellings of English appeared. A package shared by both consoles — the
  consoles have opposite rules (fixed vs. active language); sharing the code
  would mean sharing a parameter one side must never vary. Twin consoles copy
  rather than share, and the check keeps the copies honest.

### D3. Slice-local helpers stay, and delegate

- **Decision**: `reins/domain/format.ts`, `agent/file/utils/format.ts`,
  `chat/utils/transcript.ts` and the existing `common/utils/formatDate.ts` keep
  their names and their placeholders (`never`, `-`, empty) and call the format
  module for the date itself.
- **Rationale**: Their callers and tests do not move. The placeholder is a
  per-screen choice (see [admin-format.md](contracts/admin-format.md)); the
  date format is not.
- **Alternatives considered**: Replacing every call site with the module
  directly — touches 35 more call sites for no visible change.

### D4. Formatters are built once per (language, kind)

- **Decision**: The module keeps each formatter after first use.
- **Rationale**: Constructing a date formatter is the expensive part, and the
  file explorer and chat render one per row. Today several components rebuild
  one on every call.
- **Alternatives considered**: Building per call — simplest, measurably slower
  on long lists, and there is no state to go stale: a formatter for `ru` stays
  correct for `ru`.

### D5. Sorting by name

- **Decision**: `compareText(a, b)` in the format module — English collation in
  admin, the active language in app (app has no name sort today).
- **Rationale**: A bare `localeCompare` uses the browser's language, so two
  operators can see the same list in different orders (FR-007). 5 admin places.
  A sixth (`agents/index.vue:25`) compares ISO timestamps as text; it becomes a
  comparison of instants.
- **Alternatives considered**: Plain code-point order — stable, but puts `Zeta`
  before `alpha`, a visible regression in the file tree.

### D6. The guard is a script, not a lint rule

- **Decision**: `scripts/locale-check.ts`, run as `bun run locale:check`, with
  its own tests. Rules in [locale-check.md](contracts/locale-check.md).
- **Rationale**: Neither console has linting configured (`lint` prints a TODO),
  and setting it up for two Nuxt projects is its own piece of work with its own
  findings. `scripts/i18n-sync.ts --check` is the precedent: a Bun script, no
  network, already gating CI and the image build. Vue templates are read with
  `@vue/compiler-dom`, which resolves from the repo root and from both
  consoles.
- **Alternatives considered**: ESLint `no-restricted-syntax` — the right home
  eventually, blocked on linting existing at all. Extending `i18n-sync.ts` — it
  is 460 lines about translation parity and covers only `app`; the new check
  covers three trees and asks a different question.

### D7. What the check can and cannot decide

- **Decision**: The check decides by position and by script, never by meaning.
  A language-sensitive call outside the format module fails. A non-Latin letter
  in admin source, or in a tool's title, template or description, fails.
  Literal text in an app template or a static `placeholder` / `title` /
  `aria-label` / `alt` fails.
- **Rationale**: Constitution VII. "Is this text English?" is a judgment;
  "does this file contain a Cyrillic letter?" is a rule.
- **Known gaps, stated rather than hidden**: another Latin-script language in
  admin (German, Spanish); a raw value rendered through `{{ x.status }}`; text
  decided in script and rendered through a variable. The first is left to
  review. The other two are closed by design (D9, D10) and by tests, and
  `docs/i18n.md` says so.

### D8. Units in app are translated words around a localised number

- **Decision**: The number is formatted for the active language
  (`10.5` / `10,5`); the unit is a key in `common` (`unit.kb` → `KB` / `КБ`),
  generated by `i18n:sync` like every other string. Percent uses the language's
  own percent format (`42%` / `42 %`). The two byte formatters in app `bridle`
  collapse into the one in the format module.
- **Rationale**: English output stays exactly as it is today, and the project's
  rule — English is the source, translations are generated — holds for units as
  it already does for `relative_time.*`. The built-in unit formatter was tried:
  it renders English kilobytes as `kB` and bytes as `856 byte`, a visible change
  for English customers with no gain.
- **Alternatives considered**: The built-in unit formatter (above). Leaving
  units in English for both languages — a Russian sentence reading
  "больше, чем 10.0 MB" is the defect the request is about.

### D9. Values from a closed list are translated by lookup

- **Decision**: Agent status, proposal mode and action, user role and chat
  sentiment render through a key built from the value, from a fixed set. A
  value outside the set is shown as received (amended 2026-09-29, following
  D10: what the console was handed is not hidden). The chat's detected language arrives as an ISO 639-1 code and renders
  as that language's name in the active language.
- **Rationale**: `status.*` keys already exist and two components ignore them.
  Showing an unrecognised raw value is how an English word reaches a Russian
  screen after the API gains a status.
- **Alternatives considered**: A translated "Unknown" for a value outside the
  set — the first draft. It hides the one thing an operator would need to be
  told, and the two places that already fell back to the raw value had it
  right.

### D10. Server messages in app

- **Decision** (product owner, 2026-09-29): what the server sends is shown as
  received, in every language. Logs, error details and reasons are not
  translated and not reformatted. The console translates only what it writes
  itself:
  1. **The words around a received message.** "Refused: {reason}" and "The
     agent could not take that message: {message}" are already keys with the
     server text as a parameter. They stay as they are.
  2. **The message shown when nothing was received.** The sign-in error mapper
     keeps preferring the server's sentence, and its six English fallbacks
     become keys. The chat gateway's fallback "Message could not be delivered"
     becomes a key.
  3. **The agent restart banner** shows the translated line followed by the
     transport detail as received, instead of the detail alone.
- **Rationale**: A message from the server is evidence. Someone will search
  the logs for it, paste it into a ticket or read it to support, and a
  translated or reworded copy matches nothing. It also keeps the detail for
  every customer, which the first draft of this decision took away from
  Russian ones.
- **Consequence, accepted**: a Russian screen can carry an English sentence
  from the server. It always sits inside or after a Russian line that says what
  happened.
- **Alternatives considered**: Showing the server's sentence only when the
  active language is English — the first draft; rejected by the product owner
  because it hides the detail from everyone else. Machine codes for every
  server message, translated in the console — no longer needed to meet the
  spec. Translating on the fly — a model call in the render path, against
  Constitution VII.

The same holds in admin: log lines in the agent logs view and the debug panel
are shown as the runtime wrote them. What admin formats is its own chrome — the
day a group of log lines belongs to, the clock next to a debug event.

### D11. `<html lang>` and browser translation

- **Decision**: Admin declares `lang="en"` and `translate="no"`. App sets
  `lang` from the active language and updates it on a switch.
- **Rationale**: Neither console sets `lang` today. Without it a browser
  guesses, and a Russian browser offers to translate the admin console — after
  which "strictly English" is no longer true whatever the code does. App leaves
  translation available: a customer who reads neither offered language is
  entitled to their browser's help.
- **Alternatives considered**: Leaving it unset — screen readers pick the wrong
  voice and hyphenation follows the wrong language.

### D12. No language flicker on load (FR-016)

- **Decision**: Nothing to build; verified by test.
- **Rationale**: Both consoles are single-page (`ssr: false`), so there is no
  server-rendered text for the browser to disagree with. App restores the
  language from its cookie before the first render.

### D13. The tool description

- **Decision**: Reword `import_my_peer_by_address` so the trigger phrases are
  English and the description says the request may come in any language.
- **Rationale**: The description is shown in the admin tool catalog. The agent
  does not need a Russian sample to recognise a Russian request.
- **Alternatives considered**: Exempting descriptions from rule L4 — the
  catalog shows them, so FR-006 covers them.

---

## Found, and deliberately not in this feature

| Finding | Why it waits |
|---------|--------------|
| Admin carries several byte formatters that round differently (`2 KB` vs `2.1 KB`) | Already independent of the browser; collapsing them changes numbers operators compare across screens. Own ticket. |
| App has a language switcher only in the main layout — none on sign-in, register or a shared link | A first-time visitor whose browser is neither English nor Russian gets English with no switch until signed in. A returning customer keeps their choice via the cookie. New interface, not a correction. Own ticket. |
| App `setup/error` builds keys from messages and toasts them, but no toaster is mounted and no such keys exist | Dead path today; nothing reaches a customer. Noted so nobody wires it up as is. |
| Linting is not configured in either console | D6. |

## Environment notes for whoever implements

- `i18n:sync` needs `CLAUDE_API_KEY` (and `CLAUDE_WORKSPACE_ID`) in
  `.env.project`; the new app keys cannot be generated without it.
  `locale:check` needs neither.
- Run console typechecks as `npx nuxt typecheck`; the `typecheck` script
  regenerates the SDK first and reports errors that are not yours. Admin has 8
  known `monaco-editor` errors on `main`.
- In console tests only `toBe` and `toEqual` typecheck.
- Format tests build dates with the local-time constructor and assert on the
  local rendering, so they pass in any time zone.
- Root `bun run test` runs the workspaces only; tests under `scripts/` need
  their own CI step.
