# Tasks: Tools That Reconnect, a Start That Explains Itself, and a Chat Queue

**Input**: Design documents from `/specs/035-tool-reconnect-chat-queue/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/runtime.md, contracts/api.md, contracts/ui.md, quickstart.md

**Ticket**: CLEAN-245 (every commit carries it). The Bridle SDK widget is CLEAN-246 and has no task here.

**Tests**: included — the contracts name them, and the constitution's quality gate asks for the commands that were run.

**Screenshots**: every manual check in a browser is driven through Playwright and leaves a PNG in `specs/035-tool-reconnect-chat-queue/evidence/` (requested with `/speckit-tasks`). File names are given in the tasks. Screenshots are taken against the local stack with test accounts only; no token, key or DSN may be visible in a frame.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an unfinished task
- **[Story]**: US1 reconnect · US2 status · US3 queue · US4 queue controls

## Path Conventions

- `runtime/…` — the worktree `/Users/maksymtmk/my-knowledge/runtime-CLEAN-245` of `CleanSlice/runtime`, branch `feat/CLEAN-245-tool-reconnect`
- `api/…`, `admin/…`, `app/…`, `docs/…`, `specs/…` — the worktree `/Users/maksymtmk/my-knowledge/ranch-CLEAN-245`, branch `feat/CLEAN-245-tool-reconnect-chat-queue`

---

## Phase 1: Setup

- [X] T001 Create the runtime worktree from `origin/main` (fetch first; the tag is `v0.39.0`): `git -C /Users/maksymtmk/my-knowledge/runtime worktree add -b feat/CLEAN-245-tool-reconnect ../runtime-CLEAN-245 origin/main`; run `bun install` and `bun test` there and record the baseline result
- [X] T002 In `/Users/maksymtmk/my-knowledge/ranch-CLEAN-245`: `bun install`, `cd api && npx prisma generate && bun run build`, then `bun run typecheck` and `cd api && bun run test` for a baseline; note any failure that exists before this work (the date-format tests are known)
- [ ] T003 [P] Create `specs/035-tool-reconnect-chat-queue/evidence/README.md` listing the screenshot names from T033, T051, T063 and T071 and how they are produced (Playwright, local stack, viewport 1440×900 and 400×800)
- [ ] T004 [P] Write `specs/035-tool-reconnect-chat-queue/evidence/shots.mjs`: a Playwright script (uses the Playwright MCP browser when free, otherwise `playwright-core` with the cached Chromium, as in CLEAN-240) with helpers `login(console, role)`, `openChat(agentId)`, `shot(name)`, reading URLs and test accounts from the local `.env.project`; never prints a value

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared vocabulary — the tool-state shape on both sides of the socket, and the places it travels.

- [X] T005 [P] Runtime: add `runtime/src/slices/setup/mcp/domain/retryPolicy.ts` — `nextDelayMs(attempt, rand)` (5, 10, 20, 40 s then `MCP_RETRY_MAX_MS`, ±20 %), `isBrokenConnection(err)`, `isRefused(err)`, re-export `isLostSession`; and `retryPolicy.spec.ts` covering the table and each classifier (research R2, R4)
- [X] T006 [P] Runtime: add `runtime/src/slices/setup/mcp/domain/toolState.ts` — types `IToolServerState`, `IToolState`, `phaseOf(servers, startedAt, now, graceMs)` with the 15 s rule for a later drop, `redactError(message)`; and `toolState.spec.ts` (research R6, data-model)
- [X] T007 [P] API: add `api/src/slices/agent/agent/domain/toolState.types.ts` and `domain/toolState.ts` — `parseReport(raw)` (known sets, ≤ 20 servers, lengths cut, invalid → null), `summaryOf(state)`, `reasonOf(state)`, `detailOf(state)` with redaction; and `toolState.spec.ts` (contracts/api.md)
- [X] T008 API: add `api/src/slices/agent/agent/domain/agentToolState.service.ts` — in-memory map, `accept(agentId, report)`, `clear(agentId)`, `summary(agentId)`, `detail(agentId)`, `changes$()`; register it in the agent module; `agentToolState.service.spec.ts` for accept/clear/changes (depends on T007)
- [X] T009 API: hub — handle `tool_state` in `api/src/slices/bridle/handlers/bridleAgentWs.handler.ts` (calls `ensureRegistered`, then `AgentToolStateService.accept`), clear in `unregisterAgent` in `api/src/slices/bridle/data/bridle.gateway.ts`, add the event types to `api/src/slices/bridle/domain/bridle.types.ts`; spec: a valid report is stored, an invalid one changes nothing, a disconnect clears (depends on T008)

**Checkpoint**: a report sent by hand over the agent socket is held by the API and gone on disconnect.

---

## Phase 3: User Story 1 — an agent gets its tools back (P1) 🎯 MVP

**Goal**: a server that failed at boot or dropped later comes back without a restart.

**Independent Test**: quickstart Scenario 1 (the 20 November replay) and Scenario 4.

### Tests for User Story 1

- [X] T010 [P] [US1] Extend `runtime/src/slices/setup/mcp/data/mcp.gateway.reconnect.spec.ts`: boot failure keeps the server as `retrying`; a later open lists tools; a read is repeated once on a broken connection; a write is not and returns the "outcome unknown" error; 401/403 → `refused` and no further open; concurrent callers share one attempt
- [X] T011 [P] [US1] Extend `runtime/src/slices/setup/mcp/domain/mcp.service.spec.ts`: the retry timer swaps tools into the registry on success; `settle(budget)` returns within its budget; a server removed from config stops its timer; tools that arrive late are still scoped per actor

### Implementation for User Story 1

- [X] T012 [US1] `runtime/src/slices/setup/mcp/data/mcp.gateway.ts`: register the server in `statics` before `open()`; on failure keep it with `state: 'retrying'`, no client; add `MCP_CONNECT_TIMEOUT_MS` around `open()`; add `attempt(name)` (shared in-flight promise), `status()` and `onChange(cb)`; export `McpUnavailableError`
- [X] T013 [US1] `runtime/src/slices/setup/mcp/data/mcp.gateway.ts`: widen `withSession` — lost session as today; broken connection → `reopen`, repeat once only when the tool's `effect === 'read'`, else the "outcome unknown" error and the server marked `retrying`; refusal → `refused`; update `staticTool.execute` error texts per contracts/runtime.md (depends on T012, T005)
- [X] T014 [US1] `runtime/src/slices/setup/mcp/domain/mcp.gateway.ts` + `domain/mcp.service.ts` + `mcp.module.ts`: extend `IMcpGateway` with `status/attempt/onChange`; `McpService` owns one backoff timer per `retrying` server (`nextDelayMs`), calls `swapServerTools(registry, name, tools)` on success, stops on `refused`/removal/shutdown; add `settle(budgetMs)` (depends on T012)
- [X] T015 [US1] `runtime/src/index.ts`: pass the live `tools` registry to the MCP module so late servers can be swapped in; keep the first `loadAll` awaited; log one line per state change in the existing `mcp` log style (depends on T014)
- [X] T016 [US1] `runtime/src/slices/runtime/runtime/domain/runtime.service.ts`: in `visibleToolsFor`, call `mcp.settle(3000)` before `scopeTools` when any server is `retrying` (research R3); spec that a turn waits at most the budget (depends on T014)
- [X] T017 [US1] Run `bun test` in the runtime worktree; then quickstart Scenario 1 on the local cluster with an image built from this branch: stop the API, delete the agent pod, start the API after 90 s, ask a document question — save the runtime log excerpt (no tokens) to `specs/035-tool-reconnect-chat-queue/evidence/us1-replay.log.txt`

**Checkpoint**: the incident no longer needs a restart. Nothing is visible in a console yet.

---

## Phase 4: User Story 2 — a slow start says what it waits for (P1)

**Goal**: the wait is named, the limited state is visible, an incident opens, the model tells the truth.

**Independent Test**: quickstart Scenarios 2 and 3.

### Tests for User Story 2

- [X] T018 [P] [US2] `runtime/src/slices/agent/agent/domain/toolServersPrompt.spec.ts`: absent when all connected; "still trying to reconnect" for `retrying`; "needs an administrator" for `refused`
- [X] T019 [P] [US2] `api/src/slices/agent/agent/domain/agentToolState.service.spec.ts`: alert once after `TOOLS_LIMITED_ALERT_MS`; not while `stopped`/`pending`/`deploying`; quiet with two replicas; `noteRunning` on recovery
- [X] T020 [P] [US2] API route and tool specs: `GET /agents/:id/tool-state` is 404 for a User and for an Admin outside reach, returns the detail to a manager; add the route to `api/src/slices/user/…/userRoutes.spec.ts` and `routeRoles.spec.ts`; `agentAdmin.tool.spec.ts` returns `tools`; a frame and an `agent_status` event never contain a server name
- [X] T021 [P] [US2] `admin/slices/agent/agent/utils/toolState.spec.ts` and `app/slices/agent/utils/toolState.spec.ts`: wording per state and audience; a non-manager never gets a name

### Implementation for User Story 2 — runtime

- [X] T022 [US2] `runtime/src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts` (+ `channel.gateway.ts`, `channel.module.ts` pass-through): `reportToolState(state)` emitting `tool_state`, best effort, debounced 500 ms; send the current state after every `register`; wire `mcp.onChange` → report in `runtime/src/index.ts` (depends on T014, T006)
- [X] T023 [US2] `runtime/src/slices/agent/agent/domain/prompts/toolServers.prompt.ts` + `agent.service.ts` (`BuildPromptOpts`, the inline opts of `buildPrompt`, the section pushed beside `hint`) + `agent.types.ts` (`PromptSectionName`) + `runtime.service.ts` (feeds it from `mcp.status()`); text per research R14
- [X] T024 [US2] Runtime: bump `runtime/package.json` to `0.40.0`; `bun test`; open the pull request in `CleanSlice/runtime` titled with CLEAN-245; merge when green as the DREAM account; tag `v0.40.0`, push the tag, watch `Release` and `Publish Runtime Image` and note their conclusions on the ticket

### Implementation for User Story 2 — API

- [X] T025 [US2] `api/src/slices/bridle/data/bridle.gateway.ts` + `handlers/bridleClientWs.handler.ts`: `agent_status` carries `tools` (summary) on handshake and is re-broadcast on `AgentToolStateService.changes$()`
- [X] T026 [US2] `api/src/slices/agent/agent/domain/agentStatusFrame.ts` + `agentStatusService.ts`: frame gains `tools`; `stream$()` merges tool-state changes so a change emits a frame
- [X] T027 [US2] `api/src/slices/agent/agent/agent.controller.ts` + `dtos/agentToolState.dto.ts` + the agent DTO/mapper: `AgentDto.toolState`; `GET /agents/:id/tool-state` with `@ManagesAgent`; then `cd api && bun run generate:swagger`, `cd admin && bun run build:api`, `cd app && bun run build:api`
- [X] T028 [US2] `api/src/slices/agent/event/domain/agentEvent.types.ts` (`'limited'`), `agentEvent.service.ts` (`recordLimited`, reuse `attachFailure`; recovery through `noteRunning`), `notificationText.ts` (wording per contracts/api.md); the 30 s sweep and `TOOLS_LIMITED_ALERT_MS` in `agentToolState.service.ts` (depends on T008)
- [X] T029 [US2] `api/src/slices/agent/agent/agentAdmin.tool.ts`: `get_agent_status` returns `tools` and its description explains `connecting` / `limited` / `refused`; check the entry against the checklist in `docs/agent-tools.md`

### Implementation for User Story 2 — consoles

- [X] T030 [P] [US2] `admin`: `slices/agent/agent/utils/toolState.ts` (one derivation: label, detail line, tone), `stores/agentStatus.ts` (+ `tools` from the frame), a gateway call for `tool-state` fetched only while the summary is set, `composables/useAgentLifecycle.ts` (overlay "Connecting tools…" with the detail), `components/agent/status/ToolState.vue` (badge **Limited tools**), and its use in `components/agent/chat/Tab.vue`, `status/Dot.vue` tooltip, `workspace/RailItem.vue`, `utils/agentSummary.ts`
- [X] T031 [P] [US2] `app`: `slices/bridle/stores/bridle.ts` (`agentTools` map from `onAgentStatus`), `slices/agent/utils/toolState.ts` + `utils/agentStatus.ts`, `components/agent/chat/Provider.vue` (header line; manager wording for Admin/Owner with the detail fetch), `workspace/RailItem.vue`, `slices/share/utils/shareInfo.ts`; keys in `slices/agent/i18n/locales/en.json`, `slices/bridle/i18n/locales/en.json`, `slices/share/i18n/locales/en.json` including the missing `status.unreachable`; then `bun run i18n:sync`
- [ ] T032 [US2] Twin check for T030/T031: grep `toolState` and `agent_status` in both trees, confirm both consoles show the same states, and write the paragraph for the pull request naming what each console needed
- [ ] T033 [US2] Quickstart Scenarios 2 and 3 on the local stack with Playwright (`evidence/shots.mjs`), saving to `specs/035-tool-reconnect-chat-queue/evidence/`: `us2-admin-connecting.png`, `us2-admin-limited-chat.png`, `us2-admin-limited-list.png`, `us2-admin-refused.png`, `us2-app-user-starting.png`, `us2-app-user-limited.png`, `us2-share-limited.png`, `us2-admin-cleared.png`; also assert in the script that the User's page HTML and its network responses contain no server name; ask the Ranch agent "what is wrong with «agent»?" and save `us2-rancher-answer.png`; confirm one `limited` incident and its closing

**Checkpoint**: the 20 November state would have been on screen within a minute and in the alert channel within six.

---

## Phase 5: User Story 3 — type while the agent is not ready (P2)

**Goal**: the composer is always open; what cannot be taken yet waits, in order, and is sent once.

**Independent Test**: quickstart Scenario 5, steps 1, 2, 4, 5, 6.

### Tests for User Story 3

- [ ] T034 [P] [US3] `admin/slices/bridle/utils/queue.spec.ts` and `app/slices/bridle/utils/queue.spec.ts`: cap of three; `canTake` truth table (socket, hub, agent state, `tools: connecting`, open turn, limit); `limited` is ready; `nextToSend` skips blocked; held reasons; the 24-hour rule
- [ ] T035 [P] [US3] Store specs in `admin/slices/bridle/stores/` and `app/slices/bridle/stores/`: a send while not ready queues and clears the draft; a fourth is refused and the draft kept; one message per turn; restored from storage; not sent when the lock is held elsewhere; cleared on account change

### Implementation for User Story 3

- [ ] T036 [P] [US3] `admin/slices/bridle/utils/queue.ts` and `app/slices/bridle/utils/queue.ts`: the pure rules of data-model.md (`canQueue`, `canTake`, `held`, `nextToSend`, `move`, `remove`) — same functions, each console's own state type
- [ ] T037 [P] [US3] `admin/slices/bridle/utils/storageKeys.ts` and `app/slices/bridle/utils/storageKeys.ts`: `queueKey(userId, conversationKey)` and its place in the account sweep; in `app` the share visitor id is the user part
- [ ] T038 [US3] `app/slices/bridle/stores/bridle.ts`: extract `isAnswering(key)` from `newChatBlock` and use it there, so "answering" has one derivation (research R9)
- [ ] T039 [US3] `admin/slices/bridle/stores/bridle.ts`: `queue` on the conversation record; `enqueue`, `drain` (one per open turn, `clientMessageId` = entry id, Web Lock `bridle-queue:<key>` with `ifAvailable`, `storage` event to mirror other tabs), load/save through `queueKey`; `sendMessage` routes through `canTake`; reset in `resetForAccount` (depends on T036, T037)
- [ ] T040 [US3] `app/slices/bridle/stores/bridle.ts`: the same on a `queues` map beside `drafts`; `drain` respects `isLimited`; reset in `resetForAccount` and listed where `accountScope.client.ts` expects it (depends on T036, T037, T038)
- [ ] T041 [US3] `admin/slices/bridle/components/bridle/Provider.vue` + `Input.vue` + `admin/slices/agent/agent/components/agent/chat/Tab.vue`: remove agent state from `inputDisabled` (only "may not write" disables), keep the drop zone in step, the "three are waiting" line under the input
- [ ] T042 [US3] `admin/slices/bridle/components/bridle/queue/Provider.vue` + `queue/Item.vue`: the panel above the composer — header "Queued · N", rows with text and attachment count, held line; mounted in `Provider.vue`
- [ ] T043 [US3] `app/slices/bridle/components/bridle/chat/Queue.vue` + `QueueItem.vue` + `chat/Provider.vue` + `chat/Input.vue`: the same panel and the full-queue line, strings in `slices/bridle/i18n/locales/en.json`; `bun run i18n:sync`; confirm the share page shows it through the shared provider
- [ ] T044 [US3] Twin check for T039–T043: grep `enqueue`, `drain`, `queueKey` in both trees; write the pull-request paragraph (what differs: state shape, "answering", limit wait)
- [ ] T045 [US3] Quickstart Scenario 5 steps 1, 2, 4, 5, 6 with Playwright in `admin`, `app` and on a share link (two contexts for the two-tab step), saving `us3-admin-queued-3.png`, `us3-admin-full.png`, `us3-admin-drained.png`, `us3-admin-during-answer.png`, `us3-app-queued.png`, `us3-app-drained.png`, `us3-share-queued.png`, `us3-app-queued-400w.png`; assert in the script, from the conversation, that each message appears exactly once and in order

**Checkpoint**: nobody waits for an agent before typing.

---

## Phase 6: User Story 4 — change your mind about what is queued (P3)

**Goal**: reorder, remove, edit, fold — by pointer and by keyboard.

**Independent Test**: quickstart Scenario 5, steps 3 and 7.

### Tests for User Story 4

- [ ] T046 [P] [US4] Extend both `queue.spec.ts`: move up/down at the edges; edit returns text and attachments and removes the entry; remove drops attachments; a blocked entry is skipped and the rest drains
- [ ] T047 [P] [US4] `admin/slices/bridle/composables/useQueueOrder.spec.ts` and `app/slices/bridle/composables/useQueueOrder.spec.ts`: `Alt+↑/↓` moves and reports the new position; pointer drag yields `onMove(from, to)`

### Implementation for User Story 4

- [ ] T048 [P] [US4] `admin/slices/bridle/composables/useQueueOrder.ts` and `app/slices/bridle/composables/useQueueOrder.ts`: handle drag (pointer events, modelled on `admin/slices/skill/composables/useSortableList.ts`) and keyboard move with an `aria-live` announcement (research R12)
- [ ] T049 [US4] Store actions in `admin/slices/bridle/stores/bridle.ts` and `app/slices/bridle/stores/bridle.ts`: `moveQueued`, `removeQueued`, `editQueued` (back to the draft and staged attachments; replace-or-cancel when the composer is not empty), `clearQueue`, `resumeQueue` (the held "Send now"), marking an entry `blocked` with its reason
- [ ] T050 [US4] Row controls and folding in `admin/slices/bridle/components/bridle/queue/{Provider.vue,Item.vue}` and `app/slices/bridle/components/bridle/chat/{Queue.vue,QueueItem.vue}`: handle, edit, remove, the `⋯` menu, the chevron (remembered per conversation for the session), held actions, blocked reason, list semantics and labels; `app` strings in `en.json` then `bun run i18n:sync`
- [ ] T051 [US4] Quickstart Scenario 5 steps 3 and 7 with Playwright in both consoles, keyboard only for one pass, saving `us4-admin-reordered.png`, `us4-admin-menu.png`, `us4-admin-folded.png`, `us4-admin-edit-back.png`, `us4-admin-held-stopped.png`, `us4-app-reordered.png`, `us4-app-held-stale.png` (queue an entry, set its `queuedAt` back two days in storage, reload), `us4-app-blocked.png`; assert the order sent equals the order shown and the removed one never appears

**Checkpoint**: the queue is something a person controls.

---

## Phase 7: Polish, release, proof

- [ ] T052 [P] `docs/state.md`: the queue's storage key and its sweep step; `docs/operations/`: a short page (or section of the incidents page) on the `limited` incident, `TOOLS_LIMITED_ALERT_MS`, `MCP_START_GRACE_MS`, and what `refused` means; `docs/agent-tools.md` only if T029 changed the checklist's examples
- [ ] T053 [P] Check `CLAUDE.md` and `.specify/memory/constitution.md` against what was built; change both in this pull request only if a rule became wrong (expected: no change)
- [ ] T054 Run and record: `bun run typecheck`, `bun run locale:check`, `bun run i18n:check`, `bun run test:scripts`, `cd api && bun run test`, `bun test slices` in `admin` and in `app`, `bun test` in the runtime; fix what this work broke
- [ ] T055 Quickstart Scenario 6 (old runtime 0.39.0 against the new API and consoles) with one screenshot `compat-old-runtime.png`: today's status line, no tool state, the queue works
- [ ] T056 Review `specs/035-tool-reconnect-chat-queue/evidence/`: every PNG named in T033, T045, T051, T055 exists, none shows a secret, an e-mail other than the test accounts, or a DSN; commit the folder
- [ ] T057 Bump the root `package.json` version above the highest `v*` tag; commit; push; open the pull request into `main` titled with CLEAN-245, with the twin paragraphs from T032 and T044, the commands from T054 and the screenshots linked; put the link on the ticket
- [ ] T058 When CI is green: `gh api user` (DREAM account), `gh pr merge <n> --merge`; watch `Release Platform`, then the tag's `Build, push & deploy`; report both conclusions
- [ ] T059 Production: restart the assistant so it runs runtime 0.40.0; as the test Owner call `GET /agents/:id/tool-state`; with Playwright queue three messages during the restart and save `prod-admin-queue.png` and `prod-app-queue.png` (test accounts only); confirm they are answered in order, once
- [ ] T060 Close out: tick this file, comment on CLEAN-245 with what shipped and what was and was not verified, move it to In Testing, leave CLEAN-246 in the backlog with a link to the released behaviour, remove both worktrees, update the memory note

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup → Foundational → stories.
- **US1** needs T005, T006 only (runtime). It is releasable alone.
- **US2** needs US1's gateway (`status`, `onChange`) and T007–T009.
- **US3** needs nothing from US1/US2 at run time; it reads `tools` as optional. It can be built in parallel with US2 once Phase 2 is done.
- **US4** needs US3.
- Polish needs all four.

### Release order inside the work

T024 (runtime 0.40.0) before T057 (Ranch). The runtime is safe against today's API; the API is safe against old runtimes.

### Parallel Opportunities

- T003, T004 with T001/T002.
- T005, T006, T007 together.
- T010 ‖ T011; T018–T021 together.
- T030 (admin) ‖ T031 (app) after T025–T027.
- T034 ‖ T035; T036 ‖ T037; then T039 (admin) and T040 (app) touch different trees.
- T046 ‖ T047 ‖ T048.
- T052 ‖ T053.

## Parallel Example: User Story 2

```text
# after T025–T027
T030  admin: status line, badge, detail fetch
T031  app:   header line, rail, share notice, i18n
# then
T032  twin check → T033 screenshots
```

## Implementation Strategy

### MVP First

Phases 1–3: the runtime reconnects. Tagging 0.40.0 at that point would already end the class of incident, invisibly. It is not tagged until T022–T023 are in, so one runtime release carries both the cure and the report.

### Incremental Delivery

1. Runtime 0.40.0 (US1 + the runtime half of US2).
2. One Ranch release with the API and both consoles (US2, US3, US4).
3. Production restart of agents, then the checks of T059.

## Notes

- Do not touch the main clones (`/Users/maksymtmk/my-knowledge/ranch`, `/Users/maksymtmk/my-knowledge/runtime`): other sessions work there. Use a scratch database and free ports for the local stack.
- Never print a value from `.env.project`; never let one into a screenshot or a log excerpt.
- `ru.json` is generated by `bun run i18n:sync`, never written first.
- The Mazda fork is not released from here.
