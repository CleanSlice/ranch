# Tasks: Chat History Inside the Agent

**Input**: Design documents from `/specs/036-agent-history-switch/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/ui.md, quickstart.md

**Ticket**: CLEAN-248 (every commit carries it). Branch `feat/CLEAN-248-agent-history-switch`, one PR into `main`.

**Tests**: included. The contracts name the cases, and the constitution's quality gate asks for the commands that were run.

**Browser checks**: every UI story ends with a Playwright check at 1440 px (list view), in the Orbit column and at 390 px, with console errors and failed requests read. Screenshots go to the scratchpad, never into the repo; the result goes on the ticket in one line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an unfinished task
- **[Story]**: US1 switch and list · US2 reading · US3 search · US4 Overview · US5 old way removed · US6 narrow panel · US7 New chat

## Path Conventions

Paths are relative to the repository root. `admin/` and `app/` files are patched by hand: no Prettier or ESLint run over them. `api/` is formatted by its own tooling; `bun run lint` there rewrites unrelated files, so restore anything outside this change before staging.

---

## Phase 1: Setup

- [X] T001 Baseline in this worktree: `bun install`, `cd api && bun run generate && bun run build`, `cd app && npx nuxt prepare`; then `cd api && npx jest myChat chat.gateway`, `cd app && bun test slices/chat slices/agent slices/bridle`, `cd app && npx nuxt typecheck`, and from the root `bun run locale:check && bun run i18n:check`. Record what already fails before this work in the first ticket comment
- [X] T002 [P] Write `specs/036-agent-history-switch/e2e/seed.mjs`: inserts `--count` closed `ChatSession` rows for `--user` (external id) and `--agent`, channel `bridle`, `archived = true`, unique `sessionKey`, titles and previews carrying a running number plus one row titled with a unique word, `lastMessageAt` spread over the last 60 days, `messageCount` 2 to 40; `--clean` removes rows it made (marked by a `sessionKey` prefix `seed-036-`). Connection from the local `DATABASE_URL`; refuses to run when the URL is not localhost
- [ ] T003 [P] **Not done.** The browser checks were driven by hand through the Playwright MCP session (see *What was run* at the end of this file), not from a committed script. Originally: write `specs/036-agent-history-switch/e2e/shots.mjs`: Playwright (`playwright-core` with the cached Chromium) with `login(role)`, `openAgent(id, view)`, `shot(name)`; takes the list, a closed conversation and the Overview at 1440×900 in list view, at 1440×900 in Orbit view and at 390×844; prints console errors and failed requests; reads accounts from `.env.project` and never prints a value; `--out` must be outside the repo

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the API can narrow a person's own list to one agent, the app keeps conversations once and knows which view the panel is in.

### API

- [X] T004 [P] Extend `api/src/slices/chat/myChat.controller.spec.ts` with the cases of contracts/api.md: reachable `agentId` reaches the gateway with the own channel and external id; `agentId` + `archived=true`; trimmed `search`; whitespace `search` treated as absent; `search` over 100 characters is 400; no new parameter gives the same gateway call as before. Must fail before T006
- [X] T005 [P] Extend `api/src/slices/chat/data/chat.gateway.spec.ts`: with `externalUserId` set, `search` produces only the title and preview conditions; without it the `externalUserId` condition is still there (admin list unchanged). Must fail before T007
- [X] T006 Add `agentId` (optional string) and `search` (optional, trimmed, 1..100, empty becomes undefined) to `api/src/slices/chat/dtos/myChats.dto.ts`, replacing the comment that says they must not be exposed with why they now are; in `api/src/slices/chat/myChat.controller.ts` mark `list` with `@AgentScoped('query.agentId')` and pass both to `this.chats.list` beside `agentScope`; update the operation description (depends on T004)
- [X] T007 In `buildWhere` of `api/src/slices/chat/data/chat.gateway.ts` leave the `externalUserId contains` branch out when `filter.externalUserId` is set, with a comment giving the reason from research R3 (depends on T005)
- [X] T008 Run `cd api && npx jest myChat chat.gateway agentScopedRoutes routeRoles` and `bun run build`; `agentScopedRoutes.spec.ts` must see the new scoped route. If it lists routes by hand, add `GET /me/chats` there
- [X] T009 Regenerate: `cd api && bun run generate:swagger`, `cd app && bun run build:api`, `cd admin && bun run build:api`. Keep only the `getMyChats` hunks in `api/swagger-spec.json`, `app/slices/setup/api/data/repositories/api/*.gen.ts` and `admin/slices/setup/api/data/repositories/api/*.gen.ts`; restore every other hunk with `git show HEAD:<path> > <path>` followed by re-applying the wanted hunk (depends on T006)

### App: data and store

- [X] T010 Extend the own-list call with `agentId` and `search` through the layers: `IChatListQuery` in `app/slices/chat/domain/chat.types.ts`, `listMine(query)` in `app/slices/chat/domain/chat.gateway.ts`, `app/slices/chat/domain/chat.service.ts` and `app/slices/chat/data/chat.gateway.ts` (send a parameter only when it has a value, as `archived` is sent today) (depends on T009)
- [X] T011 [P] Write `app/slices/chat/stores/chat.test.ts` against a fake service for the rules of data-model.md: answers upsert into `byId`; `loadHistory` fills `currentIds`, `closedIds`, `closedTotal`; a searched answer leaves `closedTotal` alone; an answer whose generation is stale is dropped; `loadMoreHistory` appends and stops at the total; `refreshHistory` keeps the search; `resetForAccount` empties everything and drops an answer in flight. Must fail before T012
- [X] T012 Rewrite `app/slices/chat/stores/chat.ts` to the shape in data-model.md: `byId`, `history`, `loadHistory`, `loadMoreHistory`, `refreshHistory`, `syncHistory`, `closedCountFor`, `currentFor`, `closedFor`, `historyStateFor`; `getMine` upserts; page size 30 as a named constant with its reason. Leave `sessions`, `showArchived`, `setShowArchived` and the old `listMine()` in place for now, marked for removal in T049, so the old page keeps working until Phase 9 (depends on T010, T011)

### App: the panel view

- [X] T013 [P] Write `app/slices/agent/utils/panelView.test.ts`: `parsePanelView` for every row of the address table in data-model.md including the two fallbacks; `panelLocation` round-trips; `stepBack` conversation → list → chat → null; `counterLabel` for null, 0, 1, 99, 100. Must fail before T014
- [X] T014 Write `app/slices/agent/utils/panelView.ts` with `parsePanelView`, `panelLocation`, `stepBack`, `counterLabel` (pure, no Vue imports) (depends on T013)
- [X] T015 Write `app/slices/agent/composables/useAgentPanelView.ts`: `view` computed from the route, `toChat`, `toList`, `toConversation(chatId)`, `back` as `router.push`; one `keydown` listener for Escape active while the view is not the chat, skipped when a `[role="dialog"]` is in the document, when a `data-overview-mode="overlay"` element is open, or when the event target is the agents search field (depends on T014)

**Checkpoint**: `GET /me/chats?agentId=…&archived=true` answers one agent's closed rows; the store and the view parser pass their tests; nothing visible has changed.

---

## Phase 3: User Story 1 — find an earlier conversation without leaving the agent (P1) 🎯 MVP

**Goal**: the switch in the header and the list of this agent's conversations.

**Independent Test**: quickstart Scenario 1.

### Tests for User Story 1

- [X] T016 [P] [US1] Write `app/slices/chat/utils/historyGroups.test.ts`: rows from today, yesterday, six days ago, seven days ago and an unparsable date land in `today`, `this_week`, `this_week`, `earlier`, `earlier`; empty groups are omitted; order inside a group is kept; a row at 00:10 local on the day of `now` is `today`. Must fail before T017

### Implementation for User Story 1

- [X] T017 [US1] Write `app/slices/chat/utils/historyGroups.ts`: `groupClosed(conversations, now)` returning ordered groups keyed `today`, `this_week`, `earlier`, by local calendar day (depends on T016)
- [X] T018 [P] [US1] Add to `app/slices/chat/i18n/locales/en.json` the keys `history.group_today`, `history.group_this_week`, `history.group_earlier`, `history.running`, `history.empty_agent_title`, `history.empty_agent_hint`, `history.load_failed`, `history.retry`; to `app/slices/agent/i18n/locales/en.json` the keys `sheet.view_label`, `sheet.view_chat`, `sheet.view_history`, `sheet.view_history_count` (plural). Run `bun run i18n:sync` and review the generated Russian
- [X] T019 [P] [US1] Write `app/slices/chat/components/chat/history/Row.vue` from `list/Card.vue`: a `button` with title (title, else first 80 characters of the summary, else `session.fallback_title`), one-line preview, the running or Closed mark, resolved or unresolved only when `insights` is present and the row is closed, message count, time through `useFormat()`; hooks `data-history-row` and `data-state`; emits `pick`. The card's private relative-time function is not carried over
- [X] T020 [US1] Write `app/slices/chat/components/chat/history/List.vue`: reads `currentFor`, `closedFor`, `historyStateFor` from the store by `agentId`; running row first, then groups from `groupClosed` with headings; Sync button calling `syncHistory`; a sentinel at the end that calls `loadMoreHistory` when it comes into view; skeleton, empty and error states with Retry; hooks from contracts/ui.md; emits `to-chat` for the running row and `open(id)` for a closed one (depends on T012, T017, T019)
- [X] T021 [US1] Write `app/slices/chat/components/chat/history/Provider.vue`: props `agentId` and `view`; renders `List`; for a conversation view shows a placeholder until Phase 4; emits `open`, `to-chat`, `back` (depends on T020)
- [X] T022 [US1] In `app/slices/agent/components/agent/workspace/Provider.vue`: use `useAgentPanelView`; keep `AgentChatProvider` mounted under `v-show` for the chat view; render `ChatHistoryProvider` when the view is not the chat and wire its events to `toConversation`, `toChat`, `back`; call `chatStore.loadHistory(id)` when the open agent changes, swallowing a failure (depends on T015, T021)
- [X] T023 [US1] In `app/slices/agent/components/agent/workspace/Sheet.vue`: make the fold line three groups (identity growing, conversation group, actions growing and right-aligned); add the switch per contracts/ui.md with `aria-pressed`, the counter from `counterLabel(chatStore.closedCountFor(agent.id))` and the exact number in the accessible name; the sheet takes the view and emits `to-chat` / `to-list`, which the workspace wires to the composable (depends on T014, T022)
- [X] T024 [US1] Check FR-005 by hand and in `specs/036-agent-history-switch/e2e/shots.mjs`: unsent composer text and the feed's scroll position survive Chat → History → Chat; an answer started before switching is complete after returning. If the hidden chat loses scroll, save and restore it in `app/slices/agent/components/agent/workspace/Provider.vue` around the `v-show` change
- [X] T025 [US1] Browser check, quickstart Scenario 1 at 1440 px list view: order, groups, counter, only this agent's rows, second agent opens in Chat with its own counter; console and network clean

**Checkpoint**: Story 1 works alone. The old History page still exists and still works.

---

## Phase 4: User Story 2 — read a closed conversation in place (P1)

**Goal**: a closed conversation opens where the list was, read-only, with the way back.

**Independent Test**: quickstart Scenario 2.

- [X] T026 [P] [US2] Add to `app/slices/chat/i18n/locales/en.json`: `history.back`, `session.read_only`, `session.to_current`; run `bun run i18n:sync`
- [X] T027 [US2] Create `app/slices/chat/components/chat/history/Conversation.vue` from `detail/Provider.vue`: prop `chatId`; the record comes from `chatStore.byId` after `getMine` (the request is for `pending` only); bar with the back control, the title and the Closed mark; the messages block unchanged (load older, thinking, sources, ratings); the read-only line with the button to the current chat in place of a composer; "not found" state with the way back; when the record is not archived emit `to-chat`; the right rail is left out here and comes back in Phase 6; height from the panel, not `100vh` (depends on T012)
- [X] T028 [US2] In `app/slices/chat/components/chat/history/Provider.vue` render `Conversation` for a conversation view, keyed by `chatId`, while `List` stays mounted and hidden so its scroll and search survive (depends on T027)
- [X] T029 [US2] Verify the Escape order of FR-022 in the browser: conversation → list → chat → nothing; with the New chat confirmation or the share panel open, Escape closes only that. Adjust the skip rules in `app/slices/agent/composables/useAgentPanelView.ts` if either is wrong
- [X] T030 [US2] Browser check, quickstart Scenario 2 at 1440 px: open, load older, open a source, rate a reply, Escape twice, reload on an open conversation, browser Back, a made-up `chat=` id; console and network clean

**Checkpoint**: Stories 1 and 2 together replace the old page for reading.

---

## Phase 5: User Story 3 — find a conversation by what it was about (P2)

**Goal**: search over title and last message across all of the agent's conversations.

**Independent Test**: quickstart Scenario 3.

- [X] T031 [P] [US3] Add to `app/slices/chat/i18n/locales/en.json`: `history.search`, `history.search_none`, `history.search_scope`; run `bun run i18n:sync`
- [X] T032 [US3] In `app/slices/chat/components/chat/history/List.vue` add the search field: focused when the list appears; 250 ms after the last keystroke calls `loadHistory(agentId, text)`; the running row is filtered by the same text in the browser (it is one row); the no-match state with what search covers; the field is restored from `historyStateFor(agentId).search` when the list is shown again after a conversation (depends on T020)
- [X] T033 [US3] Clear the search on leaving History: in `app/slices/chat/components/chat/history/Provider.vue`, on unmount call `loadHistory(agentId)` with no text when the stored search is not empty, so the next visit starts with the full list and the counter's source stays fresh
- [X] T034 [US3] Run `node specs/036-agent-history-switch/e2e/seed.mjs --count 200` and do quickstart Scenario 3: list within a second, counter `99+`, the unique word finds one row from far down, nonsense gives the no-match text, search survives opening a conversation and is gone after Chat, a fragment of the own id finds nothing

---

## Phase 6: User Story 4 — the conversation's Overview (P2)

**Goal**: the old right rail, whole, beside the messages when there is room and over them when there is not.

**Independent Test**: quickstart Scenario 4.

- [X] T035 [P] [US4] Add to `app/slices/chat/i18n/locales/en.json`: `session.overview`, `session.overview_show`, `session.overview_hide`; run `bun run i18n:sync`
- [X] T036 [P] [US4] Move `app/slices/chat/components/chat/detail/NavMap.vue` to `app/slices/chat/components/chat/history/NavMap.vue` unchanged (the component name becomes `ChatHistoryNavMap`); `detail/Provider.vue` keeps working by using the new name until it is deleted in T050
- [X] T037 [US4] Write `app/slices/chat/components/chat/history/Overview.vue` from the right rail of `detail/Provider.vue`: counts, Summary & insights with all four marks and the "no summary yet" state, `ChatHistoryNavMap`, Export with the three formats; props: the record and the navigation items; emits `jump` and `export`; hook `data-overview` (depends on T036)
- [X] T038 [US4] In `app/slices/chat/components/chat/history/Conversation.vue` make the reading view a container: at 880 px and above the Overview is a 300 px column to the right; below, an Overview control in the bar (`aria-expanded`, `data-overview-toggle`) shows it over the messages with `data-overview-mode="overlay"`; `jump` scrolls to the message and closes the overlay; Escape closes the overlay first; the overlay is closed whenever a conversation opens. Put the 880 px reason from research R9 in a comment (depends on T027, T037)
- [X] T039 [US4] Compare exports. Done another way than written: the export path was not touched (same store action, same route), all three formats download from the Overview, and the JSON file saved by the browser is byte-identical to the route's own answer. The old page was not run side by side. Originally: export one conversation as JSON, MD and CSV from `main` (old page) and from this branch; the files must be identical
- [X] T040 [US4] Browser check, quickstart Scenario 4: column at 1440 px list view, overlay in Orbit view, jump from Navigation in both, Escape closes the overlay and not the conversation

---

## Phase 7: User Story 6 — the same in a narrow panel (P2)

**Goal**: Orbit column and phone show everything without clipping or sideways scroll.

**Independent Test**: quickstart Scenario 6.

- [X] T041 [US6] In `app/slices/agent/components/agent/workspace/Sheet.vue`: below 700 px of sheet width hide the labels of the switch and of New chat visually (names and tooltips stay), keep the counter; below 520 px the agent actions drop to the second row and the conversation group stays in the first; replace the unconditional icon-only rule for the New chat trigger with one under the 700 px condition (depends on T023)
- [X] T042 [US6] In `app/slices/chat/components/chat/history/Row.vue` and `app/slices/chat/components/chat/history/Conversation.vue`: the preview and the title shorten with an ellipsis, nothing wraps the bar to two lines, the read-only line wraps its button under the text instead of overflowing (depends on T019, T038)
- [X] T043 [US6] Browser check, quickstart Scenario 6, in the Orbit column at 1440 px and at 390×844: Stories 1, 2 and 4 again; `document.documentElement.scrollWidth <= innerWidth` on every view; the New chat confirmation and the share panel stay inside the screen

---

## Phase 8: User Story 7 — New chat sits with the switch (P3)

**Goal**: New chat in the conversation group; history reflects it at once.

**Independent Test**: quickstart Scenario 7.

- [X] T044 [US7] In `app/slices/bridle/components/bridle/chat/NewChat.vue` emit `confirmed` in `onConfirm` before `startNewChat`; confirm with `ls admin/slices/bridle/components/bridle/chat/` that admin has no twin of this file, and that `app/slices/share` still renders it without listening
- [X] T045 [US7] In `app/slices/agent/components/agent/workspace/Sheet.vue` move `BridleChatNewChat` from the actions row into the conversation group and turn `confirmed` into `to-chat`; give the group the positioned wrapper the confirmation anchors to and check the card at 390 px (research R10) (depends on T041, T044)
- [X] T046 [US7] In `app/slices/agent/components/agent/workspace/Provider.vue` watch `bridleStore.newChatBlock(id)` and call `chatStore.refreshHistory(id)` when it leaves `busy`. First read `archiveTranscript` on the API side: if the index row is marked archived before the answer, the refresh is enough; if not, call `syncHistory(id)` instead. Write which it was in the PR (research R11)
- [X] T047 [US7] Browser check, quickstart Scenario 7: from the chat, from the list and from an open closed conversation; counter one higher and the closed conversation first under Today without Sync; unavailable states unchanged

---

## Phase 9: User Story 5 — the top tabs go away and old links still arrive (P2, done last)

**Goal**: one place for history. Runs after every other story because it removes the old way.

**Independent Test**: quickstart Scenario 5.

- [X] T048 [US5] Turn `app/slices/chat/pages/chats/index.vue` into a redirect to `/agents` and `app/slices/chat/pages/chats/[id].vue` into: `getMine(id)`, then `navigateTo(panelLocation(agentId, …), { replace: true })` to the conversation view when it is archived and to the chat when it is not; on a 404 show `session.not_found_title` / `session.not_found_hint` with a link to `/agents`. Import the builder from `#agent/utils/panelView`
- [X] T049 [US5] Remove from `app/slices/chat/stores/chat.ts` what T012 left for the old page: `sessions`, `showArchived`, `setShowArchived`, the page-shaped `listMine()`; update `app/slices/chat/stores/chat.test.ts` (depends on T048)
- [X] T050 [US5] Delete `app/slices/chat/components/chat/list/Provider.vue`, `app/slices/chat/components/chat/list/Card.vue` and `app/slices/chat/components/chat/detail/Provider.vue`; a grep in `app/` for `ChatListProvider`, `ChatListCard`, `ChatDetailProvider` and `ChatDetailNavMap` must be empty (depends on T048)
- [X] T051 [P] [US5] Remove the `nav` block with the Agents and History tabs from `app/slices/common/components/layout/Provider.vue`, and `navActive` if nothing else uses it; the logo link stays
- [X] T052 [P] [US5] Remove the History links from `app/slices/common/components/landing/header/Provider.vue` (desktop and menu) and `app/slices/common/components/landing/footer/Provider.vue`
- [X] T053 [US5] Remove the keys of the deleted page from `app/slices/chat/i18n/locales/en.json` (`history.title`, `history.lede`, `history.filter_current`, `history.filter_earlier`, `history.empty_title`, `history.empty_hint`, `history.empty_cta`, `history.empty_earlier_title`, `history.empty_earlier_hint`, `session.refresh`; `history.sync` and `history.syncing` stay, the new list uses them) and `nav.history` from `app/slices/common/i18n/locales/en.json`, grepping each key in `app/` first; run `bun run i18n:sync` and `bun run i18n:check` (depends on T050, T051, T052)
- [X] T054 [US5] Keep `/chats` in `PROTECTED_PREFIXES` of `app/slices/user/auth/middleware/auth.global.ts` and in `app/slices/user/auth/domain/sessionRoutes.test.ts` (the redirects need a signed-in person); update the comment in `app/slices/share/pages/share.vue` only if it describes the page rather than the prefix. Then a grep for `/chats` in `app/slices` (`.vue` and `.ts`, generated SDK excluded) must show only the two redirect pages, the auth prefix and its test
- [X] T055 [US5] Browser check, quickstart Scenario 5: no tabs, `/chats`, `/chats/<closed id>`, `/chats/<running id>`, the link as a User without access to that agent

---

## Phase 10: Polish and gates

- [X] T056 Twin check, in words for the PR: grep in `admin/slices` for `MyChats`, `getMyChats`, `NewChat`, `panelView`, `history.` keys and the deleted component names; state for `chat`, `agent`, `common` and `bridle` why admin needed nothing. Confirm the regenerated admin SDK diff is only the `getMyChats` parameters
- [X] T057 [P] Quickstart Scenario 8 (who sees what): Admin and User each see only their own rows and counter for the same agent; `GET /me/chats?agentId=<unreachable>` with the User's token is 404; `GET /me/chats` with no new parameter answers as on `main`
- [X] T058 [P] Accessibility pass over the new pieces: the switch is reachable by Tab and announces its pressed position; icon-only controls have names; rows are buttons; the overlay Overview returns focus to its control on close; focus rings visible in both themes
- [X] T059 All gates, commands recorded for the PR: `cd api && npx jest myChat chat.gateway agentScopedRoutes routeRoles && bun run build`; `cd app && bun test slices/chat slices/agent slices/bridle slices/share && npx nuxt typecheck`; `cd admin && npx nuxt typecheck`; root `bun run locale:check && bun run i18n:check && bun run test:scripts`. Restore generated files that typecheck rewrote
- [ ] T060 **Not done as written** (no `shots.mjs`, see T003). The same views were photographed in the Playwright session at 1440 px (list view), in the Orbit column and at 390 px, and read; the scratch database was left as it is, since it is not shared. Originally: run `node specs/036-agent-history-switch/e2e/shots.mjs --out <scratchpad>/shots` for the final evidence, read every screenshot, then `seed.mjs --clean`
- [X] T061 Bump `version` in the root `package.json`; without it the merge produces no release tag
- [ ] T062 Commit with `feat(app): chat history inside the agent (CLEAN-248)` (API commit scoped `feat(api):`), push, open the PR into `main` with the ticket link, the commands run, the browser-check result, the twin statement, the export comparison and the Complexity Tracking waiver; put the PR URL on the ticket and move it to review
- [ ] T063 After CI is green, merge as the DREAM account (`gh api user` first), watch `Release Platform` and the deploy run, confirm the `v<version>` tag exists, re-check Scenario 1 and Scenario 5 on production with the read-only account, then move CLEAN-248 to Done with the release tag in the comment

---

## What was run (2026-11-26)

Local stack: the API of this branch on a scratch database (`ranch-e2e-248`), MinIO for the transcripts, the scripted runtimes of the 035 evidence, the app console of this branch. `e2e/seed.mjs --count 200` made the conversations. Browser: Playwright, signed in as the seeded Owner and User.

- **API** (curl, both accounts): one agent's closed rows and their total; the running row; search finds the one seeded title from 205 rows; a search equal to the Owner's own id finds nothing; a User asking for an agent they do not reach gets 404; a 101-character search gets 400; no new parameter answers as before.
- **1440 px, list view**: the switch with the counter (99+, exact number in the name); list order and groups; further pages on scroll (31 → 61 rows); search in about 270 ms; the no-match text; reading with the Overview as a column; jump from Navigation; export in three formats; Escape conversation → list (search kept) → chat → nothing; reload and Back; a made-up id; unsent text and an answer in flight both survive History; New chat from a closed conversation (counter 205 → 206, the closed one first under Today without Sync, New chat then unavailable with its reason).
- **Orbit column (599 px) and 390 px**: icons instead of labels with the counter visible, no sideways scroll, nothing clipped; the Overview behind its control, closed by Escape without leaving the conversation and by a jump; the New chat confirmation inside the screen.
- **Old addresses**: `/chats` → agents; `/chats/<closed>` → that conversation in its agent; `/chats/<running>` → the chat; an unknown id → "not found"; no History link left in the header, the footer or the landing page.
- **User account**: its own three rows and its own counter (2), none of the Owner's.

Two things the checks found and the code now handles: Escape on the New chat confirmation also stepped back from the conversation (the panel now listens in the capture phase and leaves the key to whatever is open); on a phone the agent's name was cut to three letters (the status keeps its dot and gives up its word below 520 px).

The scripted runtime of the 035 evidence did not answer the hub's `sync` request, so New chat was refused after five seconds on this stack; it answers now (`specs/035-tool-reconnect-chat-queue/evidence/runtime.mjs`).

Not checked here: production. Export on the local stack needed port 3333 forwarded to the scratch API, because the dev build takes the export client's address from `app/.env`; in a release build that address is the build argument.

## Dependencies

```text
Phase 1 ─▶ Phase 2 ─▶ US1 (P3) ─▶ US2 (P4) ─▶ US4 (P6) ─▶ US6 (P7) ─▶ US7 (P8) ─▶ US5 (P9) ─▶ Polish
                         └──────▶ US3 (P5) ────────────────┘
```

- **Phase 2** blocks everything: T006/T007 before T009, T009 before T010, T010/T011 before T012, T013 before T014, T014 before T015.
- **US1** needs Phase 2 only. It is the MVP.
- **US2** needs US1 (the list is how a conversation is reached; the address also reaches it directly).
- **US3** needs US1 only and can be built beside US2.
- **US4** needs US2.
- **US6** needs US1, US2 and US4, because it checks all three narrow.
- **US7** needs US1 (the group in the sheet) and T041.
- **US5** is last by decision, not by code: its tasks delete what the earlier phases are compared against (T039 needs the old page).

## Parallel opportunities

- Phase 1: T002 and T003.
- Phase 2: T004, T005 (API specs) with T011 (store test) and T013 (view test) once their inputs exist; T006 and T007 touch different files.
- US1: T016, T018 and T019 together; then T020.
- US2 with US3: T026/T027 beside T031/T032 only if two people work, since both stories touch `List.vue` or `Provider.vue` at their ends (T028, T033).
- US4: T035 and T036 together.
- US5: T051 and T052 together.
- Polish: T057 and T058.

Example for US1:

```text
T016 historyGroups.test.ts   ┐
T018 en.json keys + sync     ├─ in parallel
T019 Row.vue                 ┘
T017 historyGroups.ts ─▶ T020 List.vue ─▶ T021 Provider.vue ─▶ T022 workspace ─▶ T023 sheet
```

## Implementation strategy

1. **MVP**: Phases 1 to 3. The switch and the per-agent list work; the old page is untouched, so nothing is lost if work stops here.
2. **Reading**: Phase 4, then Phase 6. After these the new place does everything the old page did for one conversation.
3. **Search and narrow**: Phases 5 and 7.
4. **New chat**: Phase 8.
5. **Removal**: Phase 9, only when Phases 3 to 8 have passed their browser checks.
6. **Ship**: Phase 10. One PR; a ticket comment after each phase says what landed and what is next.
