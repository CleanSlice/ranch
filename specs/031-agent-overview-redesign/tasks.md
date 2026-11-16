---
description: "Task list for the agent Overview redesign (CLEAN-228)"
---

# Tasks: Agent Overview redesign

**Input**: design documents in `specs/031-agent-overview-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md, contracts/overview-ui.md

**Reference**: the prototype `C:\Users\maxim\Downloads\agent-overview-redesign.html` — read it before any component task; it is the target for layout, density and wording. Where it disagrees with the product, spec.md ("Where the prototype and the product disagree") decides.

**Tests**: required. FR-048 to FR-050: browser tests against a running local stack are a condition of done, and the CLEAN-224 browser suite must still pass.

**Ticket**: every commit carries `(CLEAN-228)`. Comment on the ticket at each checkpoint, in a few sentences.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 section list · US2 summary strip · US3 edit in place · US4 request limit · US5 access · US6 usage, advanced, delete

## House rules that apply to every task

- Admin console only. All paths below are under `admin/slices/agent/agent/` unless they start elsewhere. Do not touch `api/`, `app/`, or generated SDK files.
- Read first: `docs/state.md`, `specs/031-agent-overview-redesign/contracts/overview-ui.md` (the `data-*` hooks are exact), `data-model.md`.
- English only. Dates and numbers through `#common/utils/format` and `utils/agentFormat.ts`; never `Intl.*` / `toLocale*` in a component (`bun run locale:check`).
- Never run Prettier or ESLint over `admin/`; patch surgically and match the surrounding style. Light appearance only.
- Tests: `cd admin && bun test slices` (only `toBe` / `toEqual` typecheck in admin tests; prefer index loops over `for-of` + `while`). Typecheck: `cd admin && npx nuxt typecheck` (not `bun run typecheck`).
- Nuxt auto-imports components by path: check how siblings are referenced (`AgentOverviewUsageCard`, `AgentLoadMeters`) and follow it.
- Do not touch `.specify/feature.json`.

---

## Phase 1: Setup

- [X] T001 Prepare the worktree: `bun install` at the root, `cd api && bun run generate && bun run build`, `cd admin && npx nuxt prepare`, `cd app && npx nuxt prepare`; confirm `cd admin && bun test slices` and `npx nuxt typecheck` are green before any change
- [X] T002 [P] Create `specs/031-agent-overview-redesign/e2e/` with `shots/.gitkeep` and `lib.mjs` that re-exports everything from `specs/030-agent-request-limits/e2e/lib.mjs` and adds helpers used here: `openSettings(page, agentId, tab)`, `hook(page, name)`, `noSidewaysScroll(page)`, `requestBodies(page, urlPart)` (captures PUT bodies for assertions)
- [X] T003 [P] Extend `specs/030-agent-request-limits/e2e/seed.mjs`: an active LLM credential, two knowledge bases, and 30 days of usage rows (two models, some days with none) for `limits-off`; keep it idempotent; export the new ids from `specs/030-agent-request-limits/e2e/lib.mjs`
- [X] T004 Decide the model "None" question (research R5): with the local API up, send `PUT /agents/:id` with `llmCredentialId: null` and read the agent back. If it is cleared, fix `data/agent.mapper.ts:165` to pass `null` and note it in the PR; if not, record the finding on CLEAN-228, do not offer "None" in the Model row, and say so in the PR

---

## Phase 2: Foundational (blocks US3, US4, US5 and the debug switch of US6)

**Purpose**: the draft of unsaved edits, the guard, and the save bar. With the old cards still mounted, the page keeps working.

### Tests first

- [X] T005 [P] Write `utils/agentDraft.test.ts` per `data-model.md` "Draft": `value` and `changed` for every editable field; a field set back to its saved value stops being changed; `saved` moving under an untouched field is followed, under a touched field is not; `count`; `needsRestartOffer` only for cpu / memory; `payload()` carries changed fields only; description becomes `config` built from the CURRENT saved config with the key set or removed; limits become an object or `null` and are present only when a limit changed; `touchesLimitPath`; origins compared as an ordered list, knowledge ids as a set; `discard()`
- [X] T006 [P] Extend `utils/agentLimitForm.test.ts`: `PUBLIC_AGENT_NEEDS_LIMITS` is placed both in the limit block and by the landing-page switch; the other two codes stay by their fields

### Implementation

- [X] T007 Implement `utils/agentDraft.ts` (pure) until T005 passes
- [X] T008 Extend `utils/agentLimitForm.ts` until T006 passes
- [X] T009 Write `composables/useAgentDraft.ts`: binds `agentDraft` to the agent record (`useAgentStore().byId`) and the limit record (`useAgentLimitStore().byAgent`), exposes `value`, `changed`, `set`, `discard`, `count`, `needsRestartOffer`, `errors`, and `save({ restart })` — through `agentLimitStore.save(id, limits, send)` when `touchesLimitPath`, else `agentStore.update`; on success clears the draft, applies the restart rules of research R4 (`markPendingRestart`, or restart at once for "Save and restart"); on a refusal keeps the draft and records the code; provide/inject key exported
- [X] T010 Write `composables/useUnsavedGuard.ts` (research R6): `onBeforeRouteLeave`, `onBeforeRouteUpdate`, `beforeunload`, and an exported `confirmLeave()` built on `useConfirmStore().ask`; make `composables/useAgentTab.ts` `setTab` await a registered guard before replacing the query
- [X] T011 [P] Add `data-confirm-dialog`, `data-confirm-accept`, `data-confirm-cancel` to `admin/slices/common/components/confirm/Dialog.vue`
- [X] T012 Write `components/agent/overview/SaveBar.vue` per the contract (count, restart note, Discard, Save with the kept hook `data-visibility-save`, "Save and restart"; `role="status"`; sticky above the bottom edge) and `components/agent/overview/Row.vue` (label with optional small hint + control; stacks on narrow screens)
- [X] T013 Wire the draft into `components/agent/overview/Tab.vue`: provide it, mount `SaveBar`, register the guard; move `components/agent/visibility/Provider.vue` onto the draft (its own Save button and local form state removed, its fields read and write the draft) so there is one save on the page from here on
- [X] T014 Adjust `specs/030-agent-request-limits/e2e/settings.mjs` and `operator.mjs` for the save bar (research R13): wait for `[data-limit-input]` instead of a visible Save; assert the operator's link brings the limit block into view; then run both against the local stack and compare assertion counts with the last run (28 and 13)
- [X] T015 Gate: `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check`

**Checkpoint**: one draft and one save bar exist; nothing looks different yet except the visibility card's Save moved to the bar. Comment on CLEAN-228.

---

## Phase 3: User Story 1 — A compact section list (P1) 🎯

**Goal**: one-line rows in three groups; same addresses.

**Independent test**: all eleven sections visible with no scroll at 1280×720; every old `?tab=` value opens its section.

- [X] T016 [P] [US1] Update `utils/sections.test.ts`: the new order (overview · knowledge, a2a, channels, secrets, env · files, chats · logs, events, paddock), a `group` on every section (`null` only for overview), `SECTION_GROUPS` with three headings in order; every existing assertion about `toAgentTab`, aliases, `sectionOf` and counts stays as it is
- [X] T017 [US1] Update `components/agent/workspace/sections.ts`: add `group`, reorder, export `SECTION_GROUPS`; keep every `value`, `desc`, `countKey` and the tab functions untouched; T016 passes
- [X] T018 [US1] Write `components/agent/workspace/SectionRow.vue` per the contract and the prototype's `.snav button`: icon, name, right-aligned count (`data-section-count`, absent when unknown), `data-section`, `role="tab"`, `aria-selected`, `aria-current="page"` when selected, selected state shown by weight and an inset marker as well as background, `desc` as the tooltip, visible focus ring, at most 36 px high
- [X] T019 [US1] Rework `components/agent/workspace/SettingsNav.vue`: `data-section-nav`, at most 200 px wide on desktop, group headings (`data-section-group`) from `SECTION_GROUPS`, one sideways-scrolling row without headings below `lg`, `aria-orientation` matching the layout, arrow-key movement between rows; delete `components/agent/workspace/SectionCard.vue`; adjust the flex gap in `components/agent/workspace/Canvas.vue` if the content needs it
- [X] T020 [US1] Write `specs/031-agent-overview-redesign/e2e/nav.mjs` (quickstart §4): order, headings, one line per row, width, no scroll in the list at 1280×720, counts present or absent, `aria-current`, every old `?tab=` value plus `peers` and `settings`, keyboard reach and open, the one-row layout and no sideways page scroll at 390 px; screenshots
- [ ] T021 [US1] Gate: `bun test slices`, `npx nuxt typecheck`, run `nav.mjs`

**Checkpoint**: the list is done on every section. Comment on CLEAN-228 with a screenshot next to the prototype.

---

## Phase 4: User Story 2 — How the agent is doing at a glance (P1)

**Goal**: the four-figure summary strip.

**Independent test**: each figure matches the API for the same agent; pod load says "not available" for a pod-less agent.

- [X] T022 [P] [US2] Write `utils/agentSummary.test.ts` then `utils/agentSummary.ts` (pure): turns the agent record, pod status, metrics, usage totals and load snapshot into the four cells of `data-model.md` "Summary" — each `{ state: 'ok' | 'unavailable', ... }`; pod limits of 0 or a missing pod → unavailable, never 0%; requests detail line = refused this hour when any, else the hour's peak; "no limit per minute" when there is none
- [X] T023 [US2] Write `components/agent/overview/Summary.vue` per the contract and the prototype's `.sum`: four cells, small bars for CPU and memory, two-by-two below 760 px; status from `agentStatusStore`, usage via `useUsageStore.fetchForAgent`, load from `agentLimitStore` (`watchLoad`), pod metrics via `agentStore.fetchMetrics` on `utils/visiblePoller.ts` at 10 s (paused while hidden); each source failing marks only its own cell
- [X] T024 [US2] Mount `Summary` first in `components/agent/overview/Tab.vue`; delete `components/agent/overview/MetricsCard.vue` and `RuntimeCard.vue` once every fact they showed has its new place per `data-model.md` "Where each fact goes" (facts whose block is not built yet stay in a temporary plain list at the bottom, removed in T046)
- [X] T025 [US2] Write `specs/031-agent-overview-redesign/e2e/summary.mjs` (quickstart §4): figures equal the API's, pod load "not available" and not 0%, requests cell moves within 5 s of a burst, a stopped agent, two-by-two at 390 px

**Checkpoint**: Overview answers "is it fine?" in one strip.

---

## Phase 5: User Story 3 — Change the agent without leaving Overview (P1)

**Goal**: Configuration edited in place, saved with the bar.

**Independent test**: change name, model and one limit; the bar counts three; one save; reload shows all three.

- [X] T026 [US3] Write `components/agent/overview/ConfigCard.vue` per the contract and the prototype's Configuration block, on the draft: Name, Description (hint: shown on the A2A card; empty uses the template's), Model (active credentials from `llmStore`; state badge, fallback model and "Manage credentials" link beside it; "None" per T004), Knowledge (two-way choice "From template" / "Choose for this agent" with the list of bases and source counts only in the second; data from `useAgentKnowledges` and `knowledgeStore`; hidden with a sentence when the knowledge service is off or there are no bases), Resources (CPU and memory with the capacity hint the form shows today and "in use now" from metrics), Template (link + "Fixed after creation"); `data-field`, `data-changed`, `data-field-error` hooks
- [X] T027 [US3] Mount `ConfigCard` in `Tab.vue`; delete `components/agent/overview/LlmCard.vue` and `KnowledgeCard.vue`
- [X] T028 [US3] Retire the Edit page (research R12): `pages/agents/[id]/edit.vue` redirects to `/agents/:id?tab=overview` with replace; remove the "Edit" entry from the menu in `components/agent/workspace/Main.vue`; update the header's "public without limits" title text to name the Request limit block; delete `components/agent/edit/Provider.vue` only after T039 and T041 have moved debug, promote/demote and delete out of it
- [X] T029 [US3] Trim `components/agent/item/Form.vue` to creation only (edit-only branches and props removed) and confirm `components/agent/create/Provider.vue` still creates an agent
- [X] T030 [US3] Write `specs/031-agent-overview-redesign/e2e/edit.mjs` (quickstart §4): no bar until a change; marks and count; set-back; Discard; Save sends only the changed fields (assert the PUT body) and survives reload; CPU change → restart note and "Save and restart"; a refused save keeps every edit and names the field; unsaved changes + another section, the Chat tab, another agent, another page → confirmation each time and Cancel keeps the edits; `/agents/:id/edit` lands on Overview
- [ ] T031 [US3] Gate: `bun test slices`, `npx nuxt typecheck`, run `edit.mjs`

**Checkpoint**: the three P1 stories work in a browser — this is the MVP. Comment on CLEAN-228.

---

## Phase 6: User Story 4 — Set the limit against real traffic (P2)

**Goal**: the Request limit block with the live chart, the line that moves while typing, and the sentence.

**Independent test**: type a per-minute limit below the hour's peak; over-limit minutes are marked and the sentence gives minutes and requests, before saving.

- [X] T032 [P] [US4] Write `utils/limitPreview.test.ts` then `utils/limitPreview.ts` (pure, `data-model.md` "Limit preview"): `limitPreview(series, perMinute)` → `{ peak, over, refused }`; `chartTop(peak, limit)` with the rule of research R8; `verdictText(...)` for the four cases (no limit, none over, some over with singular and plural, limit above the scale)
- [X] T033 [US4] Extend `components/agent/load/Chart.vue`: a `previewLimit` prop (the typed value, falling back to the saved one), scale from `chartTop`, `data-over` on bars above it, `data-limit-above-scale` and the label "limit N is above this scale" when the line would leave the chart; existing hooks and the screen-reader table kept
- [X] T034 [US4] Write `components/agent/overview/LimitCard.vue` per the contract, on the draft, with `id="visibility-embed"`: the switch (off = three fields empty; on focuses per-minute; for a public agent the refusal shows here), the three fields with peaks beside them, presets 10 / 30 / 60 / 120 for per-minute, the sentence that everyone shares the allowance plus who is not counted and what is not covered, the preview of what a limited person reads ("This agent has reached its message limit. Try again in 0:42."), `AgentLoadMeters`, the chart with `previewLimit`, the verdict (`data-limit-verdict`, `data-over`, `data-refused`), the ask for limits on a legacy public agent; starts and stops `watchLoad`; every kept hook of the contract present
- [X] T035 [US4] Mount `LimitCard` in `Tab.vue`; delete `components/agent/load/Provider.vue` and remove the limit fields from `components/agent/visibility/Provider.vue` (what is left of it is replaced in T038)
- [X] T036 [US4] Write `specs/031-agent-overview-redesign/e2e/limit.mjs` (quickstart §4), including: typing a value sends no request; a preset counts as a change; the over-limit marks and the two numbers in the sentence match the series read from the API
- [ ] T037 [US4] Gate: `bun test slices`, `npx nuxt typecheck`, run `limit.mjs` and `specs/030-agent-request-limits/e2e/load.mjs` (expect 19)

---

## Phase 7: User Story 5 — Who can reach the agent (P2)

**Goal**: the Access block: landing-page switch, origin chips, folded embed code.

**Independent test**: add an origin with Enter, remove another, save, reload; open Embed code and copy a snippet.

- [X] T038 [P] [US5] Write `utils/origin.test.ts` then `utils/origin.ts` (pure `parseOrigin`): scheme + host + optional port; trailing slash stripped; paths, missing scheme, spaces and `*` refused; then write `components/agent/access/OriginsInput.vue` per the contract: chips with a remove button named for the origin, Enter or comma adds, Backspace on an empty field removes the last, duplicates ignored, hint line for the three states
- [X] T039 [US5] Write `components/agent/overview/AccessCard.vue` per the contract and the prototype's Access block, on the draft: landing-page switch with the sentence for each state and the kept hooks, `OriginsInput`, the share-link warning, and Embed code in the theme's `Accordion` (closed by default) with `Tabs` for Floating bubble / Inline / Mint a token, Copy, one line of explanation and the CSP note — snippet text and the public / private difference moved verbatim from `components/agent/visibility/Provider.vue`; then mount it in `Tab.vue` and delete `components/agent/visibility/Provider.vue`
- [ ] T040 [US5] Adjust `specs/030-agent-request-limits/e2e/settings.mjs` for chips (type the origin and press Enter) and write `specs/031-agent-overview-redesign/e2e/access.mjs` (quickstart §4); run both (settings: expect 28)

---

## Phase 8: User Story 6 — Usage, Advanced, Delete (P3)

**Goal**: the last three blocks; the Edit page can go.

**Independent test**: usage figures equal the usage panel's; debug saves through the bar; deleting asks with the backup and wipe options.

- [X] T041 [P] [US6] Write `admin/slices/usage/utils/usageDays.test.ts` then `admin/slices/usage/utils/usageDays.ts` (pure, `data-model.md` "Usage days"); rewrite `components/agent/overview/UsageCard.vue` per the contract and the prototype's Usage block: four figures, seven bars with values, "today so far" (calls and tokens), an empty state, and "All 30 days" opening the existing `UsagePanel` in the theme's `Sheet`
- [X] T042 [P] [US6] Move the delete dialog out of `components/agent/edit/Provider.vue` into `components/agent/delete/Dialog.vue` (backup download, optional wipe of stored files, the same calls and navigation) with the contract's hooks, and use it from the header menu's Delete in `components/agent/workspace/Main.vue` in place of the plain confirm; write `components/agent/overview/DangerCard.vue` per the prototype
- [X] T043 [US6] Write `components/agent/overview/AdvancedCard.vue` per the contract: folded by default with what is inside named in its header; debug switch on the draft (help text from `components/agent/debug/Provider.vue`); admin tools with promote (existing confirmation) and demote (the same kind of confirmation, new), both acting at once; Identifiers — agent id selectable, workflow id, node disk line, created and updated
- [X] T044 [US6] Mount the three in `Tab.vue` in the order of FR-008; delete `components/agent/edit/Provider.vue` and `components/agent/debug/Provider.vue`; remove the temporary list from T024; walk `data-model.md` "Where each fact goes" row by row and confirm each fact is on the page (SC-007)
- [X] T045 [US6] Write `specs/031-agent-overview-redesign/e2e/rest.mjs` (quickstart §4): usage figures and bars, empty state, the sheet, Advanced folded, debug through the bar, demote asks, delete dialog options and Cancel, no sideways scroll at 390 / 768 / 1024 / 1280 / 1440 / 1920 px, nothing animated under reduced motion
- [ ] T046 [US6] Gate: `bun test slices`, `npx nuxt typecheck`, `bun run locale:check`, run `rest.mjs`

**Checkpoint**: Overview is complete and the Edit page is gone. Comment on CLEAN-228.

---

## Phase 9: Polish and delivery

- [X] T047 Write `specs/031-agent-overview-redesign/e2e/all.mjs`: seed, start the API and the fake agents (as `specs/030-agent-request-limits/e2e/all.mjs` does — share its process handling through `lib.mjs` rather than copying it), run nav, summary, edit, limit, access, rest, then the whole CLEAN-224 suite, print one summary, exit non-zero on any failure
- [ ] T048 Manual pass against the prototype at 1440×900 (quickstart §5): list width and row height, the strip, Configuration rows, the limit chart and sentence, folded blocks, save bar; fix what differs beyond spec.md's table; keyboard-only walk through the whole page; 200 % zoom
- [ ] T049 [P] Grep for leftovers: links to `/edit` for an existing agent, imports of deleted components, the old hook `data-visibility-origins`, mentions of "Visibility & embed" in `admin/` and `docs/operations/agent-limits.md` (update the doc: limits are in the Request limit block of Overview)
- [ ] T050 [P] Twin-console statement for the PR: `agent`, `usage` and `common` touched in admin only; grep `app/` for the changed symbols and say in words why it needs nothing
- [ ] T051 Full gate on the finished build with Docker up: `cd admin && bun test slices && npx nuxt typecheck`, `bun run locale:check`, then `node specs/031-agent-overview-redesign/e2e/all.mjs`; keep the output; compare the CLEAN-224 counts with 45 / 26 / 22 / 14 / 28 / 19 / 13 / 29 and explain any difference (FR-050: written but not run does not count)
- [ ] T052 Read the version on `origin/main` again right before the bump, bump the root `package.json` to the next free number, commit, push over HTTPS, open the PR into `main` with the commands run, the browser results, before/after screenshots next to the prototype, the "None" finding of T004 and the twin-console statement; put the PR URL on CLEAN-228 and move it to In Testing
- [ ] T053 When CI is green, merge, watch `Release Platform`, check that the release tag points at the merge commit, then move CLEAN-228 to Done with the tag in a comment

---

## Dependencies

```text
Phase 1 ─┬─▶ US1 (Phase 3) ──────────────────────────────┐
         ├─▶ US2 (Phase 4) ──────────────────────────────┤
         └─▶ Phase 2 ─┬─▶ US3 (Phase 5) ─┐               ├─▶ Phase 9
                      ├─▶ US4 (Phase 6) ─┼─▶ T028 final  │
                      ├─▶ US5 (Phase 7) ─┤   deletion    │
                      └─▶ US6 (Phase 8) ─┘ ──────────────┘
```

- **US1** and **US2** need only Phase 1 and nothing from each other.
- **US3, US4, US5** and the debug switch of **US6** need the draft and the bar (Phase 2).
- `edit/Provider.vue` is deleted last (T044), after US3 and US6 have taken everything out of it; `visibility/Provider.vue` after US4 and US5 (T039).
- The usage and delete parts of US6 (T041, T042) need nothing from Phase 2.

## Parallel opportunities

- Phase 1: T002 and T003 together.
- Phase 2: T005 and T006 together; T011 alongside T009–T010.
- US1 and US2 as two tracks beside Phase 2 — three tracks from the start.
- Pure modules with their tests, any time: T022, T032, T038 (the `origin` half), T041 (the `usageDays` half).
- After Phase 2: US3, US4, US5 and US6 touch different files and all mount in `Tab.vue` — four tracks if `Tab.vue` edits are taken in turn.
- Phase 9: T049 and T050 together.

## Implementation strategy

**MVP = Phases 1–5** (US1, US2, US3): the compact list, the strip, and Configuration edited in place with the save bar. It can ship with the old limit, visibility and usage cards still below it, already saving through the same bar.

Then US4 and US5, which replace the last old card, and US6, which lets the Edit page go. The CLEAN-224 browser suite is rerun at T014, T037, T040 and in full at T051, so coverage is never assumed.

## Task counts

| Phase | Tasks |
|-------|-------|
| 1 Setup | 4 |
| 2 Foundational | 11 |
| 3 US1 section list | 6 |
| 4 US2 summary | 4 |
| 5 US3 edit in place | 6 |
| 6 US4 request limit | 6 |
| 7 US5 access | 3 |
| 8 US6 usage, advanced, delete | 6 |
| 9 Polish and delivery | 7 |
| **Total** | **53** |
