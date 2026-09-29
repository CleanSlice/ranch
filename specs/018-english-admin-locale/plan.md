# Implementation Plan: English-Only Admin Console, Language-Correct Values in App

**Branch**: `fix/CLEAN-127-english-admin-locale` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Ticket**: [CLEAN-127](https://dreamvention.atlassian.net/browse/CLEAN-127)

**Input**: Feature specification from `/specs/018-english-admin-locale/spec.md`

## Summary

The admin console must read in English whatever the operator's browser says;
the customer console must put every value in its active language. Today admin
lets the browser decide the language of 41 of its 57 computed values — the
reported "21 авг., 00:46" among them — and app, whose dates are already
correct, still shows raw status values, hand-built units and its own English
fallback messages on a Russian screen.

The approach is one rule, made checkable:

1. **Each console gets one format module**, in its `common` slice. Admin's
   fixes English inside; app's follows the active language. Language-sensitive
   formatting is allowed there and nowhere else.
2. **Every inventory entry moves onto it** — 100 entries, listed in
   [inventory.md](inventory.md).
3. **A check enforces the rule by position**, not by meaning: a
   language-sensitive call outside the module fails the build, with the file
   and line. It runs next to the existing `i18n:check`.

Nothing stored changes. No endpoint, DTO or SDK changes.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 single-file components; Bun for scripts and tests

**Primary Dependencies**: Nuxt 4 (both consoles, `ssr: false`), `@nuxtjs/i18n` 10 / vue-i18n, `@vueuse/core` (relative time in admin), the platform `Intl` API, `@vue/compiler-dom` (the check reads templates with it; already installed). NestJS in `api` — touched for one tool description only.

**Storage**: N/A — presentation only. App keeps the active language in the existing `i18n_redirected` cookie; unchanged.

**Testing**: `bun test` — `bun test slices` in each console, `bun test scripts` for the check. Typecheck with `npx nuxt typecheck`.

**Target Platform**: Current evergreen browsers. `Intl.DateTimeFormat` with `hourCycle`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`, `Intl.Collator` and `Intl.DisplayNames` are all baseline.

**Project Type**: Web application — two browser consoles over one API, in a slice-per-feature monorepo.

**Performance Goals**: A language switch in app repaints every value on screen within one second (SC-004). Formatting a chat of several hundred messages or a file tree of a few thousand rows adds no perceptible delay: formatters are built once per language and kind (research D4).

**Constraints**: The check runs offline with no key, in seconds. English output in app stays character-for-character what it is today. Times stay in the viewer's time zone. No hand-written `ru.json`: new app strings go into `en.json` and `i18n:sync` generates the rest.

**Scale/Scope**: 100 inventory entries — 57 admin, 40 app, 1 api, 2 page-level. 13 admin slices and 7 app slices touched. All seven twin slices touched on both sides. One new script, two new modules, one new composable.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan answers |
|-----------|--------|-----------------------|
| **I. The slice is the unit** | Pass | Slices touched — admin: `agent`, `bridle`, `chat`, `common`, `llm`, `paddock`, `reins`, `sessions`, `setting`, `setup`, `share`, `usage`, `user`. App: `agent`, `bridle`, `chat`, `common`, `setup`, `share`, `user`. Api: `agent/peer`. The format module lives in `common` on purpose: it is behaviour every slice needs, and being the *only* home is what makes the rule checkable (research D2). Slices reach it through `#common`, its public surface. Slice-local helpers stay in their slices and delegate (D3). |
| **II. Twin consoles** | Pass | All seven twins are changed on both sides; nothing is fixed in one console only. The per-slice record is the "Shared-area review" table in [inventory.md](inventory.md) and is repeated in the PR. The two format modules are deliberate copies with opposite rules — fixed English vs. active language — and the check holds each to its own. |
| **III. Secrets stay behind `api/`** | Pass | No credential is introduced. `locale:check` needs no key. `i18n:sync` keeps using `CLAUDE_API_KEY` from `.env.project`, as today. |
| **IV. One entity, one store** | Pass | No store, fetch or feed is added. Formatting happens at render. Where a store holds error copy (`bridle`), it already holds a key plus parameters, and that pattern is extended, not replaced. |
| **V. The console is a window, the chat is the hands** | Pass | No console capability is added or changed, so no tool is owed. One existing tool's description is reworded, and rule L4 keeps tool metadata in Latin script from then on. |
| **VI. English is the source, translations are generated** | Pass | Every new app string — units, "unknown" labels, error messages — is added to the slice's `en.json` and generated by `i18n:sync`. Copy decided in script travels as a key: the sign-in error mapper stops returning sentences and returns keys. Admin stays English-only and gains no locale file; rule L3 enforces it. |
| **VII. A rule stays a rule** | Pass | Every decision here is a lookup. The check decides by where a call sits and by what script a letter belongs to (D7). Server messages need no decision at all: they are shown as received, and the console's own fallback is chosen by status (D10). No model is called in the product. What a rule cannot decide — English versus another Latin-script language — is left to review and said so, not approximated. |

**Additional constraints**

| Constraint | Status | Note |
|------------|--------|------|
| Generated code is generated | Pass | No DTO changes; the SDKs are not touched. |
| Tracker is Jira `CLEAN` | Pass | CLEAN-127; branch and commits carry it. |
| Surface marking is honest | **Action** | The ticket is `[ADMIN][APP]`. The plan touches `api` for one tool description, so the ticket gains `[API]` and the `api` label when that change lands. |

**Quality gates owed at the end**

1. Typecheck and tests for `admin`, `app`, `api` and `scripts`, with the commands named in the PR.
2. The twin-console table, in words, in the PR.
3. The reason behind each chosen value: `en-US`, `h23`, and the formats in the two format contracts.

**Result: gate passed. No violations, Complexity Tracking is empty.**

**Post-design re-check (after Phase 1)**: unchanged. The design added no
project, no dependency and no stored state. The one thing the design surfaced
that the constitution cares about is the `api` touch, recorded above.

## Project Structure

### Documentation (this feature)

```text
specs/018-english-admin-locale/
├── plan.md              # this file
├── spec.md              # what and why
├── research.md          # Phase 0 — decisions D1–D13, findings left out of scope
├── inventory.md         # Phase 0 — the 100 entries and the shared-area review
├── data-model.md        # Phase 1 — vocabulary; nothing is stored
├── quickstart.md        # Phase 1 — how to see it working
├── contracts/
│   ├── admin-format.md  # what an operator sees, per kind of value
│   ├── app-format.md    # what a customer sees, per kind of value and language
│   └── locale-check.md  # the check: rules, output, exit codes
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
scripts/
├── locale-check.ts                    # NEW  rules L1–L5
├── locale-check.test.ts               # NEW  one passing and one failing sample per rule
└── locale-check.allow.json            # NEW  exceptions, each with a reason

admin/
├── nuxt.config.ts                     # lang="en", translate="no"
└── slices/
    ├── common/utils/
    │   ├── format.ts                  # NEW  the admin format module
    │   ├── format.test.ts             # NEW
    │   └── formatDate.ts              # delegates
    ├── common/components/date/        # TimeAgo, TimeAgoInline → module
    ├── chat/utils/transcript.ts       # the reported timestamp
    ├── agent/   (agent, file, secret, template)
    ├── bridle/  (Message, ProposalCard, DebugPanel, chatFlow)
    ├── reins/domain/format.ts         # delegates
    ├── setting/ sessions/ paddock/ usage/ llm/ user/ share/
    └── setup/theme/…/ChartTooltipContent.vue

app/
├── app.vue  or  slices/setup/i18n/    # <html lang> follows the active language
└── slices/
    ├── common/
    │   ├── utils/format.ts            # NEW  the app format module
    │   ├── utils/format.test.ts       # NEW
    │   ├── composables/useFormat.ts   # NEW  binds the module to the active language
    │   └── i18n/locales/en.json       # units, "unknown"
    ├── user/auth/                     # error mapper returns keys; Form renders them
    ├── bridle/                        # sizes, counts, percent, proposal text, delivery error
    ├── chat/                          # counts, sentiment, language name, tooltip
    ├── agent/                         # status, restart banner
    └── share/                         # expiry date → module

api/
└── src/slices/agent/peer/peerSelf.tool.ts   # description reworded

docs/i18n.md                           # admin's rule, the format modules, locale:check and its limits
CLAUDE.md                              # i18n paragraph names the rule and the command
package.json                           # locale:check, test:scripts
.github/workflows/ci.yaml              # locale:check next to i18n:check; scripts tests
.github/workflows/build-images.yaml    # locale:check gates the admin and app images
```

**Structure Decision**: The existing slice layout, unchanged. Two new modules,
one per console, both in `common`; one new script beside `i18n-sync.ts`. No new
slice, package or project.

## Order of work

Each step leaves the tree working and can be reviewed alone. `/speckit-tasks`
breaks them down; this is the order and the reason for it.

| # | Step | Why here |
|---|------|----------|
| 1 | **The check, with its tests** — rules L1–L5, allowlist, exit codes. Not yet wired into CI. | It is written first and run against the untouched tree: its findings must match the inventory. If the check and the inventory disagree, one of them is wrong, and that is cheapest to learn before anything moves. |
| 2 | **Admin format module and its tests.** | Everything in step 3 depends on it. |
| 3 | **Admin entries, slice by slice** — `chat` first (the reported defect), then `bridle`, `agent`, `common`, then the rest. `<html lang>`. | The reported screen is fixed in the first commit that touches a screen. Each slice's L1 findings drop to zero as it lands. |
| 4 | **App format module, composable and tests.** | Everything in step 5 depends on it. |
| 5 | **App entries** — the 9 calls, then units and counts, then closed-list values, then the console's own fallback messages. New keys into `en.json`, `i18n:sync`. `<html lang>`. | Console fallbacks last: they add the most new keys, and by then everything mechanical is done. |
| 6 | **API tool description.** Ticket gains `[API]`. | Independent; one line. |
| 7 | **Wire the check into CI and the image build. Docs.** | Last, because the check only passes once steps 3, 5 and 6 are done. Turning it on earlier would block every unrelated PR. |

A checkpoint comment goes on CLEAN-127 after steps 1, 3, 5 and 7.

**Pull requests**: one PR is reviewable here because the change is wide and
shallow — the same substitution, many times. If review disagrees, the natural
split is after step 3: admin (steps 1–3) and app (steps 4–7), the second
stacked on the first.

## Risks

| Risk | Likelihood | What limits it |
|------|-----------|----------------|
| A value is missed | Medium | The check finds every language-sensitive call by name; the inventory was built the same way and cross-checked by reading every app component. What neither can see is listed in research D7. |
| Operators dislike the 24-hour clock | Low | Confirmed by the product owner; still one constant (D1). |
| English customers notice a change | Low | English output is kept exactly; format tests assert it. The visible changes are digit grouping in counts above 999 and translated words where raw values were shown. |
| A Russian screen carries an English sentence from the server | Certain | Decided, not a defect: server text is shown as received (D10). It always follows a Russian line saying what happened. |
| The check blocks unrelated PRs | Low | It is wired in only when the tree is clean (step 7), and every finding names its fix. |
| `i18n:sync` unavailable (key, network) | Low | Translations are generated once and committed; `i18n:check` verifies offline. |

## Complexity Tracking

No constitution violations. Nothing to justify.
