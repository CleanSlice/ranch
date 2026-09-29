# Tasks: English-Only Admin Console, Language-Correct Values in App

**Input**: Design documents from `/specs/018-english-admin-locale/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [inventory.md](./inventory.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tracker**: [CLEAN-127](https://dreamvention.atlassian.net/browse/CLEAN-127) · branch `fix/CLEAN-127-english-admin-locale`

**Decided by the product owner, 2026-09-29**: the admin clock is 24-hour; server messages and logs are shown as received and are not translated or reformatted.

**Base**: `origin/main` `856eb7e1`, re-fetched 2026-09-29 before these tasks were written — nothing had landed since the inventory was taken, so its line numbers hold.

**Tests**: asked for by the spec (FR-019–021, SC-006) and the plan. The check and both format
modules are pure and are tested with `bun test`; each test is listed before the code it covers
and is written to fail first. There is no component-test harness — what a screen shows is
verified through [quickstart.md](./quickstart.md).

**Organization**: tasks are grouped by user story. All paths are repository-relative. Entry
numbers ("entries 29–30") refer to the tables in [inventory.md](./inventory.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 admin reads in English · US2 app follows the active language · US3 agent tools in English · US4 the check keeps it true

## Path conventions

- Admin format module: `admin/slices/common/utils/format.ts`, imported as `#common/utils/format`
- App format module: `app/slices/common/utils/format.ts`; bound to the active language by `app/slices/common/composables/useFormat.ts`
- The check: `scripts/locale-check.ts`, its tests `scripts/locale-check.test.ts`, its exceptions `scripts/locale-check.allow.json`
- App strings: `app/slices/<slice>/i18n/locales/en.json` is the source; `ru.json` and `app/i18n.sync.json` are written by `bun run i18n:sync` only
- Formats: [contracts/admin-format.md](./contracts/admin-format.md), [contracts/app-format.md](./contracts/app-format.md)

## Rules that apply to every task

- Code containing a regular expression or a `$` is written with the editor, never through a shell heredoc or `node -e` — the shell drops backslashes.
- In console tests only `toBe` and `toEqual` typecheck. Write `expect(re.test(x)).toBe(true)`, not `toMatch`.
- Typecheck a console with `npx nuxt typecheck`, not `bun run typecheck`: the script regenerates the SDK first and reports errors that are not yours. If the SDK was regenerated anyway, `git checkout -- <console>/slices/setup/api/data/repositories/api/`.
- Format tests build dates with the local-time constructor (`new Date(2026, 7, 21, 0, 46, 12)`) and pass `now` explicitly, so they hold in any time zone and on any day.
- Never edit `ru.json` as a first step. Add English, then sync.
- Text received from the server — a reason, an error detail, a log line — is rendered exactly as received, in both consoles and in every language. Do not translate it, reword it, trim it or reformat a timestamp inside it. Only the words the console writes itself are in scope (research D10).

---

## Phase 1: Setup

**Purpose**: a known baseline before anything moves, and the commands the rest of the work runs.

- [X] T001 Run the baseline gates and record the results in the start-of-implementation comment on CLEAN-127: `bun test slices` in `admin/` and in `app/`, `npx nuxt typecheck` in `admin/` (expect exactly the 8 known `monaco-editor` errors) and in `app/`, and `bun run i18n:check` at the root. If `node_modules/monaco-editor` is missing, run `bun install` at the root first.
- [X] T002 Add two scripts to the root `package.json`: `"locale:check": "bun scripts/locale-check.ts"` and `"test:scripts": "bun test scripts"`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the check's frame and rule L1. It is the instrument every later phase is measured with, and running it against the untouched tree proves the inventory before anything is changed.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [X] T003 Write `scripts/locale-check.test.ts` covering the frame and rule L1 from [contracts/locale-check.md](./contracts/locale-check.md), using small in-memory fixture sources, not the real tree: (a) each of the 15 listed call names is a finding in an admin file and in an app file; (b) the same call inside the console's format module is not; (c) `*.test.ts`, `*.spec.ts` and anything under `/repositories/api/` are skipped; (d) a finding carries rule, `file:line`, the trimmed text and a one-sentence fix; (e) every finding is reported, not only the first; (f) exit code is `0` with no findings, `1` with findings, `2` when a root directory is missing or no files were read; (g) an allowlist entry that matches nothing is itself a finding. Run `bun test scripts` and confirm the tests fail.
- [X] T004 Implement `scripts/locale-check.ts` and `scripts/locale-check.allow.json` so T003 passes. Export the pure parts for the tests (`checkSource(path, content)` returning findings, `run(roots, allowlist)` returning findings plus the number of files read) and keep `main` to reading the tree, printing and exiting. Roots: `admin/slices`, `app/slices`. The allowlist is a JSON array of `{ "file", "rule", "reason" }` and starts with two entries, both for L1: `admin/slices/common/utils/format.ts` and `app/slices/common/utils/format.ts`. Print the summary line with the number of files checked in both the passing and the failing case.
- [X] T005 Run `bun run locale:check` on the untouched tree and reconcile it with [inventory.md](./inventory.md): L1 must report 57 findings under `admin/` and 9 under `app/`, at the listed locations. The two allowlisted modules do not exist yet, so the stale-allowlist rule will also fire twice — expected until T009 and T026. For any other difference, decide whether the check or the inventory is wrong and correct that one. Post the checkpoint comment on CLEAN-127: the check exists, what it found, whether the inventory held.

**Checkpoint**: the check runs and agrees with the inventory. User stories can start.

---

## Phase 3: User Story 1 — Operator sees English regardless of their browser (Priority: P1) 🎯 MVP

**Goal**: every date, time, number and name order in the admin console is English, in one format per kind, whatever the browser's language.

**Independent Test**: with the browser set to Russian, walk the screens in quickstart §2–§4. No value is in Russian, the reported timestamp reads `Aug 21, 00:46`, and `bun run locale:check` reports no L1 finding under `admin/`.

### Tests for User Story 1

> Write these first and see them fail.

- [X] T006 [P] [US1] Write `admin/slices/common/utils/format.test.ts` against [contracts/admin-format.md](./contracts/admin-format.md), one assertion per row of the table with the reference instant 21 Aug 2026 00:46:12 local: `formatDate` → `Aug 21, 2026`; `formatDateTime` → `Aug 21, 2026, 00:46`; `formatTime` → `00:46`; `formatTimeWithSeconds` → `00:46:12`; `formatMessageTime` for today, earlier this year and an earlier year; `formatModified` for the same three; `formatDayDivider` → `August 21, 2026`; `formatCount(1234567)` → `1,234,567`; `formatAmount(1234.5)` → `$1,234.50`; `compareText` orders `['c', 'B', 'a']` as `a, B, c`; `compareInstants` orders two ISO strings by time. Also: midnight renders `00:`, never `24:`; an invalid date, `null`, `undefined` and `NaN` return `''` and never `Invalid Date` or `NaN`.
- [X] T007 [P] [US1] Create `admin/slices/chat/utils/transcript.test.ts` for `formatMessageTime`: a message from an earlier day renders `Aug 21, 00:46` and a message from today renders `00:46`. Give `formatMessageTime` an optional second parameter `now: Date = new Date()` so the test can fix the day.

### Implementation for User Story 1

- [X] T008 [US1] Create `admin/slices/common/utils/format.ts` so T006 passes. One constant `ADMIN_LOCALE = 'en-US'` and one `ADMIN_HOUR_CYCLE = 'h23'`, each with a comment giving the reason from research D1. Build each formatter once and keep it (research D4). Inputs accept `string | number | Date | null | undefined`. Export, besides the functions in T006, `useRelativeTime(source)` wrapping `useTimeAgoIntl` with the fixed language, so relative time has one home too.
- [X] T009 [US1] Turn `admin/slices/common/utils/formatDate.ts` into a re-export of `formatDate` and `formatDateTime` from `./format` (entries 33–34) and export the rest of the module from `admin/slices/common/utils/index.ts`. Every existing caller of `formatDateTime` now shows the 24-hour clock; that is intended.
- [X] T010 [US1] Fix the reported defect: in `admin/slices/chat/utils/transcript.ts` make `formatMessageTime` delegate to the format module (entries 29–30). T007 passes.
- [X] T011 [P] [US1] `admin/slices/bridle/` (entries 20–28): `components/bridle/Message.vue` time and tooltip, `components/bridle/ProposalCard.vue` time, `components/bridle/DebugPanel.vue` clock with seconds and the four token counts (the event payloads and log text shown in the panel are not touched), `utils/chatFlow.ts` day divider. `chatFlow` keeps its `locale` option for the twin's sake but the admin caller in `components/bridle/Provider.vue` stops passing a literal and the divider comes from the module. Update `admin/slices/bridle/utils/chatFlow.test.ts` if its expected label changes.
- [X] T012 [P] [US1] `admin/slices/agent/agent/` (entries 1–4): `components/agent/logs/BarSummary.vue` count, `components/agent/workspace/Main.vue` relative time via `useRelativeTime`, `pages/agents/index.vue` line 25 becomes `compareInstants`, `utils/agentLogs.ts` day label — the label only; `line.text` and any timestamp inside a log line stay as the runtime wrote them. Update `admin/slices/agent/agent/utils/agentLogs.test.ts` if the label changes; its fixtures must stay several days apart because grouping is by the viewer's local day.
- [X] T013 [P] [US1] `admin/slices/agent/file/` (entries 5–15): `utils/format.ts` — `formatModified` delegates and keeps its signature; `components/agentFile/ExplorerRow.vue`, `Provider.vue` lines 204, 214, 215, `TreeNode.vue` tooltip; name order through `compareText` in `components/agentFile/Tree.vue`, `stores/agentFile.ts` and `utils/fileTree.ts`. Run `admin/slices/agent/file/utils/fileTree.test.ts`; the order of a mixed-case list must not regress.
- [X] T014 [P] [US1] `admin/slices/agent/secret/components/agentSecret/Provider.vue` (entries 16–17) and `admin/slices/agent/template/components/template/item/Provider.vue`, `list/Provider.vue` (entries 18–19).
- [X] T015 [P] [US1] `admin/slices/common/components/date/TimeAgo.vue` and `TimeAgoInline.vue` (entries 31–32): use `useRelativeTime`; drop the `useI18n` locale read.
- [X] T016 [P] [US1] `admin/slices/reins/` (entries 38–41): `domain/format.ts` keeps `formatDate`, `formatDateTime`, `formatTime` and their placeholders (`-`, `never`) and delegates the date itself; `components/knowledge/list/Provider.vue` line 37.
- [X] T017 [P] [US1] `admin/slices/paddock/components/paddock/evaluation/list/Provider.vue` and `evaluation/Provider.vue` (entries 36–37); `admin/slices/sessions/components/session/Detail.vue` and `List.vue` (entries 42–43).
- [X] T018 [P] [US1] `admin/slices/setting/` (entries 44–48): `components/setting/Form.vue`, `components/setting/github/StatusCheck.vue` lines 88 and 101, `pages/settings/auth.vue`, `pages/settings/knowledge.vue`.
- [X] T019 [P] [US1] `admin/slices/user/` (entries 54–57): `apiKey/components/apiKey/CreateDialog.vue`, `CreatedKeyDisplay.vue`, `List.vue`, `user/components/user/item/Provider.vue`; and `admin/slices/share/composables/useShareLink.ts` (entry 50).
- [X] T020 [P] [US1] `admin/slices/usage/components/usage/Line.vue` and `Panel.vue` (entries 51–53), `admin/slices/llm/components/llm/usage/Provider.vue` (entry 35), `admin/slices/setup/theme/components/ui/chart/ChartTooltipContent.vue` (entry 49). Run `admin/slices/usage/utils/usageLine.test.ts`.
- [X] T021 [P] [US1] In `admin/nuxt.config.ts` add `htmlAttrs: { lang: 'en', translate: 'no' }` to `app.head` (research D11).
- [X] T022 [US1] Close the story: `bun run locale:check` reports zero L1 findings under `admin/`; `bun test slices` and `npx nuxt typecheck` in `admin/` are at baseline. (The browser walkthrough, quickstart §2–§4, is T052.) In [inventory.md](./inventory.md) mark the 57 admin entries and the admin `<html lang>` entry `corrected`, and write the Admin column of the shared-area review. Post the checkpoint comment on CLEAN-127.

**Checkpoint**: the admin console is English in every browser. This alone answers the report.

---

## Phase 4: User Story 2 — Customer sees every value in the language they picked (Priority: P1)

**Goal**: in the customer console every date, number, size, status and error follows the active language, and a switch repaints all of it without a reload.

**Independent Test**: with the browser set to German, walk quickstart §5–§7 in English and in Russian. No value is in the other language or in German; `bun run locale:check` reports no L1 finding under `app/`; `bun run i18n:check` passes.

### Tests for User Story 2

> Write these first and see them fail.

- [X] T023 [P] [US2] Write `app/slices/common/utils/format.test.ts` against [contracts/app-format.md](./contracts/app-format.md), each kind for `en` and for `ru`: date, date and time, time of day, message time, message tooltip, day divider, day in full, count (`12,345` / `12 345`), percent (`42%` / `42 %`), language name (`uk` → `Ukrainian` / `украинский`), and size as a pair `{ value, unit }` — `856` + `b`, `2` + `kb`, `5.9` / `5,9` + `mb`. Compare Russian output after replacing no-break and narrow no-break spaces with a plain space; say so in a comment. Invalid input returns `''`.
- [X] T024 [P] [US2] Write `app/slices/user/auth/data/authError.mapper.test.ts`: network failure, 401 with a session code, 401 without, 429, 403 and any other status each map to their own `account.error_*` key; a sentence sent by the server is carried on the error unchanged, character for character; the mapper itself produces no English sentence.

### Implementation for User Story 2

- [X] T025 [US2] Create `app/slices/common/utils/format.ts` so T023 passes. Every function takes the language as its first argument; nothing in the file reads the browser's language. Formatters are kept per language and kind. Sizes return `{ value, unit }` so the unit word can come from translation (research D8); keep today's rounding (`B` whole, `KB` rounded, `MB` one decimal) so English output does not change.
- [X] T026 [US2] Create `app/slices/common/composables/useFormat.ts`: reads the active language from `useI18n()` at call time, not once at setup, and returns the format functions bound to it, plus `size(bytes)` which joins the number with the translated unit. Add to `app/slices/common/i18n/locales/en.json`: `unit.b`, `unit.kb`, `unit.mb` as `"{value} B"`, `"{value} KB"`, `"{value} MB"`, and `value.unknown` as `"Unknown"`.
- [X] T027 [US2] `app/slices/bridle/components/bridle/chat/ProposalCard.vue` — every entry in this file in one pass: acted-on time through the module (call 3); delete the local `formatBytes` and use `size` (unit 2); counts through `formatCount`, including the number passed into `proposal.large_change` (units 4–6); mode and row action through keys `proposal.mode.*` and `proposal.action.*`, unknown values through `value.unknown` (text 5–6). Line 148 is not changed: a translated "Refused" followed by the server's reason as received is already what research D10 asks for (server 10, confirmed correct). Add the new keys to `app/slices/bridle/i18n/locales/en.json`.
- [X] T028 [P] [US2] `app/slices/bridle/components/bridle/chat/Message.vue`, `Provider.vue` and `app/slices/bridle/utils/chatFlow.ts` (calls 1, 2, 4, 5): time, tooltip, day in full and day divider through the module; `chatFlow` keeps its `locale` option. In `Provider.vue` line 118 the fallback name `'Agent'` becomes a key `chat.agent_fallback` (text 10). Update `app/slices/bridle/utils/chatFlow.test.ts` if needed.
- [X] T029 [P] [US2] Attachment sizes (unit 1, 3; text 12). Remove `formatBytes` from `app/slices/bridle/domain/attachment.constants.ts`. In `app/slices/bridle/stores/bridle.ts` lines 452 and 458 pass the raw number as `limitBytes` instead of a formatted string — a string formatted in the store keeps the old language after a switch. Format at render in `components/bridle/chat/AttachmentChip.vue` (line 111) and `AttachmentList.vue` (line 158), and wherever `chat.error_size` / `chat.error_total` are rendered. Replace the joined progress line at `AttachmentChip.vue:98` with one message `chat.attachment_progress` taking `{percent}`, formatted by the module.
- [X] T030 [US2] Chat delivery error (server 9), after T028 because it shares `Provider.vue`: `app/slices/bridle/data/bridle.gateway.ts` line 129 passes the server's sentence unchanged, or `null` when there is none — the English fallback written there goes away; `app/slices/bridle/stores/bridle.ts` lines 915–918 keep `chat.error_message` with the sentence as its parameter when there is one and use a new key `chat.error_generic` when there is not; `components/bridle/chat/Provider.vue` line 396 renders whichever it was given. Add `chat.error_generic` ("Message could not be delivered") to `app/slices/bridle/i18n/locales/en.json`.
- [X] T031 [P] [US2] `app/slices/chat/` (calls 6–8; text 8, 9, 11; units 7, 8): `components/chat/detail/Provider.vue` — date and time (line 90), message count (200), sentiment through `session.sentiment.*` keys (224), language name from the code (230); `components/chat/list/Card.vue` line 62 count; `utils/transcript.ts` delegates and makes `locale` a required parameter; `components/chat/message/Bubble.vue` line 86 tooltip becomes one message `message.attached_file_detail` with `{name}` and `{size}`. New keys into `app/slices/chat/i18n/locales/en.json`.
- [X] T032 [P] [US2] Agent status and restart banner (text 1–4; server 8): `app/slices/agent/components/agent/Item.vue` line 9 and `app/slices/common/components/landing/hero/AgentCard.vue` line 24 render `status.<value>`; `app/slices/agent/components/agent/chat/Provider.vue` line 102 and `workspace/RailItem.vue` line 69 fall back to `value.unknown` instead of the raw value; the restart banner at `chat/Provider.vue` line 251 always shows `chat.restart_failed` and, when line 53 kept a transport detail, shows that detail after it exactly as received, instead of the detail alone.
- [X] T033 [P] [US2] `app/slices/common/components/layout/Provider.vue` line 62: role through `role.<value>` keys with `value.unknown` as fallback (text 7); take the set of roles from the generated SDK type, do not retype it. `app/slices/common/components/landing/hero/Provider.vue`: `99.9%` through the module from the number `0.999` (unit 9) and the two counts at lines 55 and 62. Keys into `app/slices/common/i18n/locales/en.json`.
- [X] T034 [P] [US2] `app/slices/share/components/share/panel/Provider.vue` line 69: expiry date through the module (call 9).
- [X] T035 [P] [US2] Sign-in errors (server 1–7), T024 passes: `app/slices/user/auth/data/authError.mapper.ts` sets a `messageKey` on each error — `account.error_network`, `account.error_session_ended`, `account.error_bad_credentials`, `account.error_too_many_attempts`, `account.error_forbidden`, `account.error_unknown`, two levels deep as `docs/i18n.md` requires — and carries the server sentence separately as `serverMessage`; extend the error classes under `app/slices/user/auth/domain/errors/` accordingly. `components/auth/login/Provider.vue`, `register/Provider.vue` and `sessionEnded/Provider.vue` pass both. `components/auth/common/Form.vue` line 268 renders the server's sentence as received when there is one and `$t(messageKey)` when there is not — the same preference the mapper has today, with the fallback now translated; correct the prop comment at line 7. English text of each key is the sentence the mapper returns today, into `app/slices/user/auth/i18n/locales/en.json`, next to the existing `account.login_failed`.
- [X] T036 [P] [US2] In `app/app.vue` set `<html lang>` from the active language with `useHead({ htmlAttrs: { lang: locale } })`, reactive to a switch (research D11).
- [X] T037 [US2] Generate the translations: `bun run i18n:sync` at the root (needs `CLAUDE_API_KEY`, and `CLAUDE_WORKSPACE_ID` if the key is identity-linked, in `.env.project`), read the new Russian strings once for sense, then `bun run i18n:check`. Commit `en.json`, `ru.json` and `app/i18n.sync.json` together.
- [X] T038 [US2] Close the story: `bun run locale:check` reports zero L1 findings under `app/`; `bun test slices` and `npx nuxt typecheck` in `app/` are at baseline. (The browser walkthrough, quickstart §5–§7, is T052.) In [inventory.md](./inventory.md) mark the 39 open app entries (the fortieth, the proposal reason, is already `confirmed correct`) and the app `<html lang>` entry, and write the App column of the shared-area review. Post the checkpoint comment on CLEAN-127.

**Checkpoint**: both consoles obey their own rule. Stories 1 and 2 work independently of each other.

---

## Phase 5: User Story 3 — Agent tools read in English in the admin console (Priority: P2)

**Goal**: titles, templates and descriptions of agent tools are English, and stay so.

**Independent Test**: quickstart §8 — the tool catalog reads in English, including "Import a peer by address"; `bun run locale:check` reports no L4 finding.

### Tests for User Story 3

- [X] T039 [US3] Add rule L4 cases to `scripts/locale-check.test.ts`: a Cyrillic letter in a tool's `title`, in its `template` and in its `description` are three findings; the same letter in a comment or in a string outside those three fields of a `*.tool.ts` file is not; a description split over several concatenated string literals is read as one. Confirm they fail.

### Implementation for User Story 3

- [X] T040 [US3] Implement rule L4 in `scripts/locale-check.ts` over `api/src/**/*.tool.ts` so T039 passes. Running the check now reports exactly one L4 finding, at `api/src/slices/agent/peer/peerSelf.tool.ts`.
- [X] T041 [US3] Reword the description of `import_my_peer_by_address` in `api/src/slices/agent/peer/peerSelf.tool.ts` (line 248): keep `"connect this"` and `"add this agent"`, drop the Russian sample, and say the request may come in any language. Adjust `api/src/slices/agent/peer/peerSelf.tool.spec.ts` only if it asserts the old wording. Run that spec with jest directly from `api/` (`NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/peer/peerSelf.tool.spec.ts`) — `bun run test` regenerates Prisma and takes a running dev API down — and typecheck with `bun run build`.
- [X] T042 [US3] Make the surface marking honest: rename CLEAN-127 to start with `[ADMIN][APP][API]` and add the `api` label. Mark the API entry in [inventory.md](./inventory.md) `corrected`. (The browser walkthrough, quickstart §8, is T052.)

**Checkpoint**: nothing an operator reads in the admin console is in another language.

---

## Phase 6: User Story 4 — A new unlocalised value is caught before it ships (Priority: P2)

**Goal**: the rules are enforced on every change, in CI and before an image is built, and written down where developers look.

**Independent Test**: quickstart §9 — each of the seven deliberate mistakes fails the check and names the place; a clean tree passes.

### Tests for User Story 4

- [X] T043 [US4] Add cases for rules L2, L3 and L5 to `scripts/locale-check.test.ts`, per [contracts/locale-check.md](./contracts/locale-check.md). L2: a Cyrillic, a Greek and a CJK letter in an admin file are findings; `—`, `…`, `«»`, `·`, `⚠`, `µ` and accented Latin letters are not; the same Cyrillic letter in an app file is not. L3: a `ru.json` under an admin `i18n/locales/`, `detectBrowserLanguage` in an admin `nuxt.config.ts`, and a `defaultLocale` other than `en` are findings. L5: a template text node with a letter, and a static `placeholder`, `title`, `aria-label`, `alt` or `label` with a letter, are findings in an app `.vue` file; text inside `{{ }}`, a bound attribute (`:title`), whitespace, punctuation and digits alone are not; an expression containing `>` and an attribute spanning several lines do not confuse it. Confirm they fail.

### Implementation for User Story 4

- [X] T044 [US4] Implement rules L2 and L3 in `scripts/locale-check.ts`. L2 tests each letter with Unicode script properties: a finding is a `\p{L}` that is neither `\p{Script=Latin}` nor `\p{Script=Common}`.
- [X] T045 [US4] Implement rule L5 in `scripts/locale-check.ts`, reading the template block with `@vue/compiler-dom` and walking text and attribute nodes. Add to `scripts/locale-check.allow.json` the entries from "Left exactly as written" in [contracts/app-format.md](./contracts/app-format.md), each with its reason: the key caps in `app/slices/bridle/components/bridle/chat/Input.vue`, and any other template literal from that list the rule reports.
- [X] T046 [US4] Run `bun run locale:check` and `bun run test:scripts` on the whole tree until both pass with zero findings and no stale allowlist entry. Anything L2 or L5 reports that the inventory did not list is a new entry: add it to [inventory.md](./inventory.md), fix it or allowlist it with a reason, and say so in the PR.
- [X] T047 [P] [US4] In `.github/workflows/ci.yaml` add, directly after "Check i18n locale parity", a step "Check locale rules" running `bun run locale:check`, and after "Test" a step "Test scripts" running `bun run test:scripts`.
- [X] T048 [P] [US4] In `.github/workflows/build-images.yaml` add a job `locale` modelled on `i18n` (checkout, setup-bun, `bun install --frozen-lockfile` because the check imports `@vue/compiler-dom`, then `bun run locale:check`), running when `admin` or `app` changed, and add it to `needs` of both `build-admin` and `build-app`. Update the comment above the `i18n` job, which says checkout plus bun is the whole job.
- [X] T049 [P] [US4] Document the rule in `docs/i18n.md`: a section for the admin console (English-only covers computed values; the format module; the contract table), a section for app values (`useFormat`, units as keys, closed-list values, server messages), and a section for `bun run locale:check` next to the existing commands table — what each rule catches and, stated plainly, what it cannot (research D7). Extend the i18n paragraph in `CLAUDE.md` with one sentence naming the two format modules and the command. `.specify/memory/constitution.md` is not changed: Principle VI already says what this enforces.
- [X] T050 [US4] Run the drill in quickstart §9: make each of the seven changes, confirm the finding and the exit code, revert. Record the seven results in the PR description.

**Checkpoint**: the state reached in Phases 3–5 cannot drift back unnoticed.

---

## Phase 7: Polish & cross-cutting

**Purpose**: prove the whole, close the inventory, hand over.

- [X] T051 Run every gate in quickstart §1 from a clean checkout of the branch and keep the output for the PR: `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts`, `bun test slices` and `npx nuxt typecheck` in `admin/` and `app/`, the peer tool spec and `bun run build` in `api/`.
- [ ] T052 **For a person, in a browser** — walk quickstart §2–§8 end to end against the running consoles: Russian browser for admin, German for app in both languages, including the language switch without reload (§6) and the server's reason shown character for character the same in both languages (§7). Everything that can be proved without a browser is proved by the tests, which run on a machine whose own default language is Russian.
- [X] T053 Close [inventory.md](./inventory.md): `grep -c "| open |"` returns `0`, every entry reads `corrected` or `confirmed correct`, the totals table is updated, and the shared-area review has a sentence in both columns for all seven slices.
- [ ] T054 [P] Create two follow-up issues in Jira `CLEAN`, each linked to CLEAN-127 and assigned like it: `[ADMIN]` collapse the admin byte formatters that round differently; `[APP]` language switcher on the sign-in, register and shared-link layouts.
- [ ] T055 Commit with Conventional Commits and the ticket id, one commit per phase (`feat(tooling): locale check …`, `fix(admin): …`, `fix(app): …`, `fix(api): …`, `ci: …`, `docs: …`, each ending `(CLEAN-127)`), open the pull request into `main`, and in its description give: the twin-console table in words, the commands run with their results, the reason for `en-US` and the 24-hour clock, the visible changes for an English-browser operator, and the decision that server messages and logs are shown as received, so a Russian screen can carry an English sentence from the server. Put the PR link on CLEAN-127 and move the issue to In Testing (transition 51).

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Blocks |
|-------|-----------|--------|
| 1 Setup | — | everything |
| 2 Foundational | 1 | all user stories |
| 3 US1 admin | 2 | — |
| 4 US2 app | 2 | — |
| 5 US3 tools | 2 | — |
| 6 US4 the check | 3, 4 and 5 for T046 onward; T043–T045 need only 2 | 7 |
| 7 Polish | 3–6 | — |

### User story dependencies

- **US1, US2, US3** are independent of each other. Each needs only the check's frame from Phase 2 and touches its own tree: `admin/`, `app/`, `api/`.
- **US4** is the only story that depends on the others: its rules can be written at any time, but the check cannot be switched on in CI (T047, T048) until the tree is clean, which is what US1–US3 deliver. Switching it on earlier would fail every unrelated pull request.

### Within each story

- Tests before the code they cover.
- The format module before anything that calls it: T008 → T009 → T010–T020; T025 → T026 → T027–T035.
- Same file, same task or in sequence: `ProposalCard.vue` is one task (T027); `bridle/…/chat/Provider.vue` is T028 then T030; `scripts/locale-check.ts` and its test file are touched by T003–T004, T039–T040 and T043–T045, never in parallel.
- T037 (`i18n:sync`) after every task that adds an English key: T026–T035.

### Parallel opportunities

- T006 and T007; T023 and T024.
- T011–T021: eleven admin tasks in different slices, once T009 is done.
- T028, T029, T031–T036 in app, once T026 is done.
- Phase 3, Phase 4 and Phase 5 as wholes, by different people.
- T047, T048 and T049.

---

## Parallel example: User Story 1

```bash
# Tests first, together:
Task: "T006 admin/slices/common/utils/format.test.ts against contracts/admin-format.md"
Task: "T007 admin/slices/chat/utils/transcript.test.ts for formatMessageTime"

# After T008–T010, the slices together:
Task: "T011 admin/slices/bridle — entries 20–28"
Task: "T012 admin/slices/agent/agent — entries 1–4"
Task: "T013 admin/slices/agent/file — entries 5–15"
Task: "T016 admin/slices/reins — entries 38–41"
Task: "T018 admin/slices/setting — entries 44–48"
```

## Parallel example: User Story 2

```bash
# After T025 and T026:
Task: "T028 bridle Message.vue, Provider.vue, chatFlow.ts"
Task: "T029 bridle attachment sizes"
Task: "T031 chat slice"
Task: "T032 agent status and restart banner"
Task: "T035 sign-in errors"
```

---

## Implementation Strategy

### MVP first — User Story 1

1. Phase 1, Phase 2.
2. Phase 3 through T010: the reported timestamp is fixed by the first commit that touches a screen.
3. Phase 3 to the end: the whole admin console.
4. **Stop and validate**: quickstart §2–§4 with a Russian browser.

That is a shippable answer to the report, with app untouched.

### Incremental delivery

| Step | Adds | Can ship alone |
|------|------|----------------|
| Phases 1–3 | admin in English | yes |
| Phase 4 | app in the active language | yes |
| Phase 5 | tool catalog | yes |
| Phase 6 | the check in CI | only after 3–5 |
| Phase 7 | proof, inventory, PR | — |

### One pull request or two

The plan assumes one: the change is wide and shallow. If review prefers smaller, split after
Phase 3 — admin (T001–T022) first, app and the rest (T023–T055) stacked on that branch. The
CI wiring stays in the second either way.

---

## As built — where the work differs from the task text

- **Function names in the admin module** are not the ones T006 and T008 list. `formatCount`, `formatMessageTime` and `formatModified` are already auto-imported from other admin slices, so the module exports `formatNumber`, `formatStamp` and `formatStampDate`, plus `formatClock`, `formatClockSeconds`, `formatLongDate`, `formatMoney`, `compareText`, `compareInstants`. The slice helpers keep their old names and delegate.
- **`useRelativeTime` is its own file**, `admin/slices/common/composables/useRelativeTime.ts`, not part of `format.ts` (T008). Inside the module it pulled Vue into every pure utility that imports a date formatter. The allowlist has a third L1 entry for it.
- **`formatDate.ts` was removed**, not turned into a re-export (T009). `utils/index.ts` exports the module; a third file exporting the same two names only added an auto-import duplicate.
- **`formatMoney` takes a precision.** The usage panel shows cost per call to four decimals (`$0.0012`); rounding to two would print every call as `$0.00`.
- **L1 knows 16 names, not 15**: `Intl.DisplayNames` was added, since the app module uses it for language names.
- **A value outside a closed list is shown as received**, not as a translated "Unknown" (T027, T031, T032, T033). It follows from the decision on server text: what the console was handed is not hidden. Two inventory entries — the unknown-status fallbacks — were therefore already right and are `confirmed correct`.
- **`noticeParams`** (`app/slices/bridle/utils/noticeParams.ts`, with tests) is how a size limit stored as a number becomes a size when the notice is shown (T029). Three components render notices; one function serves them.
- **Inventory entry 28 is two findings**: the check reports the formatter's type annotation as well as its construction, so admin had 58 L1 findings for 57 entries.
- **The `api` build reports 4 errors**, all in `src/slices/mcpServer/oauth/domain/mcpOauth.service.ts`, from a Prisma client that was not regenerated in this worktree. They are not from this change and the file is untouched; the peer tool spec (26 tests) passes. `prisma generate` was not run here because it takes a running dev API down on Windows.

## As built — where the work differs from the task text

- **Function names in the admin module** are not the ones T006 and T008 list. `formatCount`, `formatMessageTime` and `formatModified` are already auto-imported from other admin slices, so the module exports `formatNumber`, `formatStamp` and `formatStampDate`, plus `formatClock`, `formatClockSeconds`, `formatLongDate`, `formatMoney`, `compareText`, `compareInstants`. The slice helpers keep their old names and delegate.
- **`useRelativeTime` is its own file**, `admin/slices/common/composables/useRelativeTime.ts`, not part of `format.ts` (T008). Inside the module it pulled Vue into every pure utility that imports a date formatter. The allowlist has a third L1 entry for it.
- **`formatDate.ts` was removed**, not turned into a re-export (T009). `utils/index.ts` exports the module; a third file exporting the same two names only added an auto-import duplicate.
- **`formatMoney` takes a precision.** The usage panel shows cost per call to four decimals (`$0.0012`); rounding to two would print every call as `$0.00`.
- **L1 knows 16 names, not 15**: `Intl.DisplayNames` was added, since the app module uses it for language names.
- **A value outside a closed list is shown as received**, not as a translated "Unknown" (T027, T031, T032, T033). It follows from the decision on server text: what the console was handed is not hidden. Two inventory entries — the unknown-status fallbacks — were therefore already right and are `confirmed correct`.
- **`noticeParams`** (`app/slices/bridle/utils/noticeParams.ts`, with tests) is how a size limit stored as a number becomes a size when the notice is shown (T029). Three components render notices; one function serves them.
- **Inventory entry 28 is two findings**: the check reports the formatter's type annotation as well as its construction, so admin had 58 L1 findings for 57 entries.
- **The `api` build reports 4 errors**, all in `src/slices/mcpServer/oauth/domain/mcpOauth.service.ts`, from a Prisma client that was not regenerated in this worktree. They are not from this change and the file is untouched; the peer tool spec (26 tests) passes. `prisma generate` was not run here because it takes a running dev API down on Windows.

## Notes

- 55 tasks: Setup 2 · Foundational 3 · US1 17 · US2 16 · US3 4 · US4 8 · Polish 5.
- Checkpoint comments on CLEAN-127 after T005, T022, T038 and at T055, in a few sentences and a teammate's tone.
- The branch carries no version bump. If this should ship as an image, ask before adding one; the last branch did it as its own commit.
- `git fetch` over SSH needs the key's passphrase and hangs without a terminal. `origin/main` was fetched over HTTPS with `GITHUB_TOKEN` from `.env.project`; pushing the branch will need the same, or the passphrase entered once.
- Out of scope, recorded in research.md: admin byte formatters, the app switcher on the auth and share layouts, the unused `setup/error` toast path, linting.
