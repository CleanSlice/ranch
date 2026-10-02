# Tasks: "New Chat", Full History and the Pinned Ranch Agent in the Customer Console

**Input**: Design documents from `/specs/019-share-new-chat/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tracker**: [CLEAN-136](https://dreamvention.atlassian.net/browse/CLEAN-136) · branch `feat/CLEAN-136-share-new-chat`

**Base**: `origin/main` `76f8b367`, re-fetched 2026-10-02 before these tasks were written. Four commits had landed since the research was taken; CLEAN-137 moved chat message rendering into `Avatar` / `Bubble` components but left the stores, the hub and the routes alone, and the line numbers below were re-read at this commit.

**Tests**: asked for by the plan (quality gate 1) and listed in each contract under "Specs owed". Hub, route and index behaviour is tested with `jest` in `api`; the three rules that decide what a person sees — the transcript merge, the "New chat" availability rule, the rail order — are pure functions tested with `bun test`. Each test is listed before the code it covers and is written to fail first. There is no component-test harness: what a screen shows is verified through [quickstart.md](./quickstart.md).

**Organization**: tasks are grouped by user story. All paths are repository-relative. "D4", "F9" refer to [research.md](./research.md).

## Status after the first implementation pass (2026-10-02)

Code, pure rules and specs are in for every phase. What is still open, and why:

- **Russian translations** — T021, T031, T039, T045, T055. The 22 English keys
  are in the three `en.json` files; `bun run i18n:sync` is refused with
  `401 API key is invalid` for the `CLAUDE_API_KEY` in `.env.project`.
  `i18n:check` therefore reports 22 problems and CI will fail on it until the
  key is replaced and the sync is run. `ru.json` was not written by hand.
- **Quickstart in a browser** — T022, T023, T032, T040, T046, T047, T050,
  T056, T060. No scenario was walked against a running stack: what a screen
  shows, the two measurements (agent push time, transcript lag) and the
  revoked-link path are unverified. The unit-level gates in those tasks did
  run and are green.
- **Runtime PR** — T057. The change is committed and pushed
  (`CleanSlice/runtime`, branch `fix/CLEAN-136-cancel-on-session-clear`,
  `b1c0079`); the pull request is not opened because the `GITHUB_TOKEN` in the
  runtime clone's `.env.project` answers `401 Bad credentials`.
- **Before merge** — T059 (final clean-tree gate run), T061 (the embed's
  handling of a `409`), T062–T064.

Decided while building, and recorded in [data-model.md](./data-model.md):
the merge numbers the page *below* the kept tail instead of from 1; a
transcript message stands in for one on-screen message, not for all with the
same text; a turn stays open through `typing`; the stored copy is capped at
100 messages; replayed frames older than the loaded page's tail are dropped.

T011 found the committed app SDK stale: regenerating it also brought in types
from CLEAN-80 and CLEAN-116 that were already in the API. `npx nuxt typecheck`
is clean with them; they are left in rather than reverted.

Baseline that is not this change: `documentText.extractor.spec.ts › extracts
the text layer of a pdf` fails in `api` on `main` in this checkout.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 visitor starts over · US2 console user starts over and keeps the old conversation · US3 a new chat never pretends · US4 the owner keeps what a visitor left · US5 the conversation is the same wherever it is opened · US6 the Ranch admin agent is first

## Path conventions

- Hub port and implementation: `api/src/slices/bridle/domain/bridle.gateway.ts`, `api/src/slices/bridle/data/bridle.gateway.ts`; its per-conversation spec is `api/src/slices/bridle/data/bridle.gateway.channels.spec.ts`
- Routes: `api/src/slices/bridle/bridle.controller.ts`, spec `api/src/slices/bridle/bridle.controller.spec.ts`
- App conversation store: `app/slices/bridle/stores/bridle.ts`; port, service, gateway, mapper under `app/slices/bridle/{domain,data}/`
- App pure rules: `app/slices/bridle/utils/*.ts` with `*.test.ts` beside them
- App strings: `app/slices/<slice>/i18n/locales/en.json` is the source; `ru.json` and `app/i18n.sync.json` are written by `bun run i18n:sync` only
- Generated SDKs: `app/slices/setup/api/data/repositories/api/`, `admin/slices/setup/api/data/repositories/api/` — regenerated, never edited

## Rules that apply to every task

- Code containing a regular expression or a `$` is written with the editor, never through a shell heredoc or `node -e` — the shell drops backslashes.
- In console tests only `toBe` and `toEqual` typecheck. Write `expect(list.length).toBe(2)`, not `toHaveLength`.
- Pure utilities under test are written with plain index `for` loops, `slice()` and `as` casts — no `for…of` with an inner `while`, no non-null `!` on an indexed array. `bun test` 1.3.13 on Windows hangs and crashes on that shape. If `bun test slices` hangs, run the new test file alone with `timeout 90 bun test <file>`.
- `api` tests are run with `npx jest <path>` from `api/`. `bun run test` regenerates Prisma and takes a running dev API down with it. The `api` typecheck is `bun run build`.
- A console is typechecked with `npx nuxt typecheck`, not `bun run typecheck` — the script regenerates the SDK first. `admin` has 8 known `monaco-editor` errors on `main`.
- Never edit `ru.json` as a first step. Add English, then `bun run i18n:sync`.
- What a person or the agent wrote, and what the server sent, is rendered as received. Only the words the console writes itself get keys.
- No `.chat-md` rules and no prose classes in a component: chat markdown styling lives in `app/slices/bridle/assets/chat-md.css` and its byte-identical admin twin (CLEAN-137, `scripts/chat-md-twin.test.ts`).
- A change in `app/slices/{agent,bridle,chat,share}` is not finished until the same symbol was grepped in `admin/slices/`; the PR says what was found (Principle II).
- Every number introduced carries its reason in a comment at the constant: `TURN_SILENCE_MS`, `ARCHIVE_SYNC_TIMEOUT_MS`, `UNSAVED_KEEP_MS`, `PERSISTED_MATCH_WINDOW_MS`.

---

## Phase 1: Setup

**Purpose**: a known baseline before anything moves.

- [X] T001 Run the baseline gates and record the results in the start-of-implementation comment on CLEAN-136: `bun test slices` in `app/` and in `admin/`; `npx nuxt typecheck` in `app/` and in `admin/` (expect exactly the 8 known `monaco-editor` errors); `npx jest src/slices/bridle src/slices/chat` and `bun run build` in `api/`; `bun run i18n:check` and `bun run locale:check` at the root. If `node_modules/monaco-editor` is missing, run `bun install` at the root first.
- [X] T002 Confirm the branch is on the current `origin/main` (fetch over HTTPS with `GITHUB_TOKEN`, wrapped in `timeout 60`; SSH hangs on a passphrase prompt). If anything landed in `app/slices/bridle/stores/bridle.ts`, `admin/slices/bridle/stores/bridle.ts`, `api/src/slices/bridle/` or `api/src/slices/chat/`, re-read the anchors named in the tasks below before starting.

---

## Phase 2: Foundational — a reset the server can stand behind

**Purpose**: the hub's two operations, the index move and the completed archive route ([contracts/archive-transcript.md](./contracts/archive-transcript.md), [contracts/conversation-reset.md](./contracts/conversation-reset.md)). Nothing visible changes yet, except that an admin-console reset now emits a frame.

**⚠️ Blocks US1, US2, US3 and US4.** It does **not** block US5 or US6: they need no API change and, per the plan's delivery order, ship first.

### Tests (write first, confirm they fail)

- [X] T003 [P] In `api/src/slices/bridle/data/bridle.gateway.channels.spec.ts`, add `describe('BridleGateway — an open turn')` and `describe('BridleGateway — resetting a conversation')`, building the gateway the way the existing blocks do. Turn cases: `isTurnOpen` is `false` for a conversation the hub never saw; `true` right after `sendToAgent` was accepted; `false` after the first agent `message` when no stream or thinking turn is open; `true` after a `stream` frame and `false` after the `stream_end` for the same `messageId`; `true` after a `thinking` step and `false` after `thinking { done: true }`; `false` in every open case once 75 000 ms pass without an agent event (drive the clock with `jest.useFakeTimers` / `jest.setSystemTime`). Reset cases: after `resetConversation`, every registered socket received exactly one `{ type: 'conversation_reset', ts, seq }`; the agent's `send` received `{ type: 'session_clear', channel: <clientId> }`; `replaySince(clientId, agentId, 0)` returns only the reset frame; `isTurnOpen` is `false`; a later routed event has a `seq` greater than the reset frame's; calling it for a conversation with no sockets and no agent does not throw.
- [X] T004 [P] In `api/src/slices/chat/data/chat.gateway.spec.ts`, add cases for `archiveSession(agentId, sessionKey, archivedSessionKey)` using the file's existing Prisma stub (extend the stub with `updateMany` on `chatSession` if it lacks it): a row with the live key gets the archived key and `archived: true` and keeps its `id`, `externalUserId`, counts and `summary`; no row with the live key is a no-op that does not throw; a row of another agent with the same key is untouched.
- [X] T005 In `api/src/slices/bridle/bridle.controller.spec.ts`, extend the builder at L41–L169: add `isAgentConnected`, `isTurnOpen`, `syncAgent`, `resetConversation` to the `hub` mock, add a `chats = { archiveSession: jest.fn() }` mock and pass it as the new last constructor argument. Add `describe('BridleController — closing a conversation')` with the cases from the contract's "Specs owed": agent not connected → `ConflictException` with `{ code: 'AGENT_OFFLINE' }`, `fileGateway` untouched; turn open → `ConflictException` `{ code: 'TURN_IN_PROGRESS' }`, untouched; `syncAgent` rejects → `ServiceUnavailableException` `{ code: 'SYNC_FAILED' }`, untouched; happy path → `syncAgent` called with `(agentId, 5000)` before `fileGateway.read`, `saveRaw` before `delete`, `chats.archiveSession` called with `(agentId, 'bridle:<channel>', 'bridle:<channel>.<ts>.archived')`, `hub.resetConversation(agentId, channel)` called once, answer is `{ archivedPath }`; live file missing (read throws `{ status: 404 }`) or empty → answer `{}`, no `saveRaw`, `resetConversation` still called once; `delete` throws → the archived copy is deleted, the error propagates, `resetConversation` not called; `archiveSession` throws → the call still resolves and `resetConversation` is called. Add one case to the existing reset block: `resetTranscript` calls `hub.resetConversation`, not `clearAgentSession`. Keep the existing share-channel cases at L606–L650 green.

### Implementation

- [X] T006 [P] In `api/src/slices/bridle/domain/bridle.types.ts`, add `IBridleConversationResetEvent { type: 'conversation_reset'; ts: number; seq: number }` and `export const BridleResetErrorCodes = { AgentOffline: 'AGENT_OFFLINE', TurnInProgress: 'TURN_IN_PROGRESS', SyncFailed: 'SYNC_FAILED' } as const`. In `api/src/slices/bridle/domain/bridle.gateway.ts`, add abstract `isTurnOpen(agentId: string, clientId: string): boolean` and `resetConversation(agentId: string, clientId: string): void` with doc comments taken from the contract, and remove `clearAgentSession` from the port.
- [X] T007 In `api/src/slices/bridle/data/bridle.gateway.ts`: add `const TURN_SILENCE_MS = 75_000` beside `REPLAY_MAX_AGE_MS` (L36) with the reason from D4. Extend `IClientChannel` (L48) with `awaitingSince: number | null`, `openStreams: Set<string>`, `lastAgentEventAt: number` and initialise them in `channelFor` (L106). In `sendToAgent`, after the message is handed to the agent (L391), set `channel.awaitingSince = now`. In `handleAgentEvent` (L454), when the channel exists: set `lastAgentEventAt = Date.now()`, clear `awaitingSince`, add `data.messageId` to `openStreams` on `stream`, delete it on `stream_end`. Implement `isTurnOpen` per [data-model.md](./data-model.md) ("In memory: the hub"), reading the existing `activeTurns` map by `clientKey`. Implement `resetConversation`: clear the three fields and the `activeTurns` entry, empty `channel.buffer`, call the now-`private` `clearAgentSession` (L527), then `route(channel, { type: 'conversation_reset', ts: Date.now() })` when the channel exists. Leave `seq`, `sockets` and `seen` alone. T003 passes.
- [X] T008 [P] In `api/src/slices/chat/domain/chat.gateway.ts`, add abstract `archiveSession(agentId: string, sessionKey: string, archivedSessionKey: string): Promise<void>` with a comment saying why the row moves instead of being recreated (D7). Implement it in `api/src/slices/chat/data/chat.gateway.ts` with `prisma.chatSession.updateMany({ where: { agentId, sessionKey }, data: { sessionKey: archivedSessionKey, archived: true } })`. T004 passes.
- [X] T009 [P] In `api/src/slices/bridle/dtos/transcript.dto.ts`, add `ArchiveTranscriptResponseDto` with one `@ApiPropertyOptional()` field `archivedPath?: string`, described as present only when a conversation was closed.
- [X] T010 In `api/src/slices/bridle/bridle.controller.ts`: inject `IChatGateway` as the last constructor parameter with `@Inject(forwardRef(() => IChatGateway))` (L152; `BridleModule` already imports `ChatModule`). Add `const ARCHIVE_SYNC_TIMEOUT_MS = 5_000` with the reason from D5. Rewrite `archiveTranscript` (L740) to the nine steps of the contract, in order: `requireChannelAccess`; `hub.isAgentConnected` else `ConflictException({ code: AGENT_OFFLINE })`; `hub.isTurnOpen` else `ConflictException({ code: TURN_IN_PROGRESS })`; `await hub.syncAgent(agentId, ARCHIVE_SYNC_TIMEOUT_MS)` — a rejection or `agentOnline: false` becomes `ServiceUnavailableException({ code: SYNC_FAILED })`, and the time the push took is logged; read; on a 404 or empty content go straight to `hub.resetConversation` and return `{}`; `saveRaw`; `delete`, and on its failure delete the copy just written before rethrowing; `chats.archiveSession` inside a `try` that logs and continues; `hub.resetConversation`; return `{ archivedPath }`. Declare `@ApiOkResponse({ type: ArchiveTranscriptResponseDto })`, `@ApiConflictResponse`, `@ApiServiceUnavailableResponse`, and rewrite the `@ApiOperation` description (L722) to say what the route now guarantees. In `resetTranscript` (L698) replace `this.hub.clearAgentSession` (L717) with `this.hub.resetConversation`. T005 passes.
- [X] T011 Regenerate the spec and both SDKs: `cd api && bun run build && bun run generate:swagger`, then `cd app && bun run build:api` and `cd admin && bun run build:api`. Check with `git diff --stat` that the generated change is confined to `archiveBridleTranscript` and its types; anything else means the committed spec was stale — say so in the PR rather than reverting it silently.
- [X] T012 Run `npx jest src/slices/bridle src/slices/chat` and `bun run build` in `api/`; all green. Comment on CLEAN-136: the route is complete, nothing calls it yet.

**Checkpoint**: `curl -X POST …/transcript/archive` with a console bearer closes a conversation, refuses with `409` while the agent is answering or stopped, and an admin-console "New chat" now emits `conversation_reset`.

---

## Phase 3: User Story 5 — The conversation is the same wherever it is opened (Priority: P1) 🎯 MVP

**Goal**: the console chat and the share page show the conversation the server holds — the person's messages and the agent's — with earlier ones a scroll away, and never a duplicate ([contracts/chat-history.md](./contracts/chat-history.md)).

**Independent Test**: hold a conversation in the admin console; open the same agent in the customer console in a private window; the same messages are there, the person's included (quickstart 14).

**Depends on**: Setup only.

### Tests (write first, confirm they fail)

- [X] T013 [P] [US5] Create `app/slices/bridle/utils/transcriptMerge.test.ts` importing `mergeTranscript` from `./transcriptMerge`, with `now` passed explicitly and messages built by a small local factory. One test per row of the contract's "Specs owed" list: empty local + page → the page in order, `seq` 1..n; local equal to the page by text and time but with different ids → the page, each message once; an undelivered user message (`delivery: 'sending'`, then `'failed'`) not in the page → kept last, state intact; a `streaming: true` bubble → kept; an agent message with `ts` after the page's newest → kept, at or before it → dropped; a delivered user message older than the tail minus 120 000 ms → dropped; the same text twice, 180 000 ms apart, one in the page → the other kept; `cached: true` messages with an empty page, `ts = now − 660 000` → dropped; the same with `ts = now − 60 000` → kept; `page = null` → local returned unchanged; a proposal bubble present locally and in the page → one bubble carrying the page's status. Also assert the function does not mutate its inputs.

### Implementation

- [X] T014 [P] [US5] In `app/slices/bridle/domain/bridle.types.ts`, add `IBridleTranscriptPage { messages: IBridleMessage[]; nextCursor: string | null; hasMore: boolean }` and an optional session-only `cached?: true` on `IBridleMessage`, documented as "came from the stored copy; never persisted".
- [X] T015 [US5] Create `app/slices/bridle/utils/transcriptMerge.ts`: `export const PERSISTED_MATCH_WINDOW_MS = 120_000` (the admin console's value, `admin/slices/bridle/stores/bridle.ts:654`, interim until the runtime stores wire ids), `export const UNSAVED_KEEP_MS = 600_000` (the hub's `REPLAY_MAX_AGE_MS`, reason from D14), and `mergeTranscript(local, page, now): IBridleMessage[]` implementing the table in D14. Read `loadTranscript` in the admin store (L1733–L1826) as the reference and keep its order of decisions; the only addition is the `cached` clause. Number the result with the existing `numberLegacy` / `nextSeq` helpers the store imports from `#bridle/utils/chatFlow` — transcript part from 1, kept local tail after it. Index loops only (see the rules above). T013 passes.
- [X] T016 [P] [US5] In `app/slices/bridle/data/bridle.mapper.ts`, add `toTranscriptPage(dto, agentId): IBridleTranscriptPage`: the messages as `toTranscript` (L104) builds them, plus `attachments` mapped from the DTO's references with `url: /api/agent/${encodeURIComponent(agentId)}/attachment/${id}` — the shape `onUserMessage` builds in the store (L1012) — plus `nextCursor` and `hasMore`. Make `toTranscript` return `toTranscriptPage(...).messages` so there is one mapping.
- [X] T017 [US5] Replace `transcriptTail` with `transcriptPage(agentId, channel, cursor?, share?): Promise<IBridleTranscriptPage>` in `app/slices/bridle/domain/bridle.gateway.ts` (L68), `app/slices/bridle/domain/bridle.service.ts` (L49) and `app/slices/bridle/data/bridle.gateway.ts` (L269), passing `cursor` in the query when given. Update the port's comment: it is now also the history path. In the store, `recoverFromTranscript` (L637) calls `transcriptPage(...)` and uses `.messages`; `app/slices/bridle/utils/transcriptTail.ts` is not touched.
- [X] T018 [US5] In `app/slices/bridle/stores/bridle.ts`: add `history = ref<Record<string, { loaded: boolean; cursor: string | null; hasMore: boolean; loadingOlder: boolean }>>({})` and a read helper `historyFor(key)`. In `hydrate` (L330) mark every restored message `cached: true`; in `persist` (L364) strip `cached` together with `streaming`. Add `async function loadHistory(conv)`: needs `hubClientIds.get(key)`; returns at once when that id starts with `anon-` (research D14) or when `history[key].loaded`; fetches `transcriptPage`; on failure logs and leaves everything as it is with `loaded` still false; on success sets `conversations.value[key] = mergeTranscript(messagesFor(key), page, Date.now())`, renumbers the session's thinking blocks after the merged list the way the admin store does (L1780–L1817), sets `nextSeqs`, stores `cursor` / `hasMore`, sets `loaded`, and calls `persist(conv)`. Call `void loadHistory(conv)` at the end of `onWelcome` (L979), after the client id is stored. Export `historyFor` and `loadHistory`.
- [X] T019 [US5] In the same store, add `async function loadOlder(conv): Promise<number>`: no-op returning 0 unless `hasMore`, a `cursor` and not `loadingOlder`; fetches the next page; drops messages whose id is already on screen; prepends the rest numbered below the current minimum `seq` (admin reference: `loadOlderTranscript`, L1911–L1951); updates `cursor` / `hasMore`; returns how many were added. Older pages are not written to the stored copy. Export it.
- [X] T020 [US5] In `app/slices/bridle/components/bridle/chat/Provider.vue`: on the scroll container (`scrollEl`, L301) add a scroll handler that, at `scrollTop === 0`, records `scrollHeight`, awaits `bridleStore.loadOlder(activeConversation)`, and after `nextTick` sets `scrollTop` to the height difference so the message that was at the top stays there. Above the list render one line: `$t('chat.older_loading')` while `historyFor(key).loadingOlder`, else `$t('chat.older_hint')` while `hasMore`. Make sure the existing follow-the-bottom watcher (L172) does not scroll a reader down when older messages are prepended — it watches `messages.length`; guard it with the `loadingOlder` flag.
- [ ] T021 [P] [US5] Add `chat.older_loading` ("Loading earlier messages…") and `chat.older_hint` ("Scroll up for earlier messages") to `app/slices/bridle/i18n/locales/en.json`, then run `bun run i18n:sync` and commit `en.json`, `ru.json` and `app/i18n.sync.json` together.
- [ ] T022 [US5] Open a conversation whose history carries a message with a file and confirm `app/slices/bridle/components/bridle/chat/Message.vue` (L84) renders the attachment from the mapped reference; if the attachment list needs a field the transcript does not carry (`readableByAgent`), default it in `toTranscriptPage` rather than in the component. Twin check: grep `loadTranscript` and `isInTranscript` in `admin/slices/bridle/` and note in the PR that the admin rule was read, not changed.
- [ ] T023 [US5] Gates: `bun test slices` and `npx nuxt typecheck` in `app/`, `bun run i18n:check`, `bun run locale:check`. Then quickstart scenarios 14, 15, 16 and 17 against a local stack, including the "measure here" line of scenario 15. Comment on CLEAN-136 with the result and the measured transcript lag.

**Checkpoint**: the defect reported on production is fixed. This phase and Phase 8 can ship as their own PR.

---

## Phase 4: User Story 1 — Visitor starts over with a clean conversation (Priority: P1)

**Goal**: "New chat" on the share page: confirm, empty conversation, an agent that remembers nothing ([contracts/new-chat-ui.md](./contracts/new-chat-ui.md)).

**Independent Test**: tell the agent a code word on a share link, press "New chat", ask for the word — empty screen, the agent does not know (quickstart 1).

**Depends on**: Phase 2. Phase 3 first is the plan's order: without it a reload after the reset still paints the stored copy.

### Tests (write first, confirm they fail)

- [X] T024 [P] [US1] Create `app/slices/bridle/utils/newChat.test.ts` for `newChatBlock(input)` and `newChatFailureKey(code)` from `./newChat`. `newChatBlock` takes `{ resetting, messageCount, connected, hasClientId, agentOnline, answering }` and returns the first match of the table in [data-model.md](./data-model.md): `busy`, `empty`, `offline`, `agent_offline`, `answering`, else `null`. One test per row and one per precedence pair (resetting beats empty; empty beats offline; offline beats agent_offline; agent_offline beats answering); `agentOnline: undefined` counts as offline. `newChatFailureKey`: `'AGENT_OFFLINE'` → `'chat.new_chat_failed_agent_offline'`, `'TURN_IN_PROGRESS'` → `'chat.new_chat_failed_answering'`, anything else including `undefined` → `'chat.new_chat_failed'`.

### Implementation

- [X] T025 [US1] Create `app/slices/bridle/utils/newChat.ts` with the two functions and an exported `NewChatBlocks` union type. T024 passes.
- [X] T026 [P] [US1] Add `archiveTranscript(agentId, channel, share?): Promise<void>` to `app/slices/bridle/domain/bridle.gateway.ts`, `app/slices/bridle/domain/bridle.service.ts` and `app/slices/bridle/data/bridle.gateway.ts`, calling the generated `BridleApi.archiveBridleTranscript({ path: { agentId }, query: { channel }, ...(headers ? { headers } : {}), throwOnError: true })` with `shareHeaders(share)` exactly as `transcriptPage` does. Errors are not caught in the gateway beyond `this.execute`.
- [X] T027 [P] [US1] In `app/slices/bridle/domain/bridle.types.ts`, add `onReset(seq?: number): void` to `IBridleChannelEvents`. In `app/slices/bridle/data/bridle.gateway.ts` `openChannel` (L89), add `socket.on('conversation_reset', (raw) => events.onReset(mapper.toSeq(raw)))` beside the other listeners.
- [X] T028 [US1] In `app/slices/bridle/stores/bridle.ts`: add `resetting = ref<Record<string, boolean>>({})` and `epochs = ref<Record<string, number>>({})`. Add `function applyReset(conv)`: the existing `reset(conv)` (L1247), then `delete history.value[conv.key]`, then `epochs.value[key] = (epochs.value[key] ?? 0) + 1`. Add `onReset: (seq) => { if (acceptSeq(key, seq)) applyReset(conv) }` to `channelEvents` (L895). Add `async function startNewChat(conv)`: return if `resetting[key]`; set it; call `getService().archiveTranscript(conv.agentId, hubClientIds.get(key), conv.share)`; on success `applyReset(conv)`; on failure leave the conversation untouched and set `errors.value[key] = { key: newChatFailureKey(codeOf(err)) }`, where `codeOf` reads `response.data.code` — except a `403` on a share conversation, which sets nothing (the share page's interceptor owns that state); `finally` clear `resetting[key]`. Add `newChatBlock(key)` calling the pure function with what the store knows now: `agentOnline: true` and `answering: false` until Phase 6 wires them. Export `startNewChat`, `newChatBlock`, `epochFor(key)`.
- [X] T029 [US1] Create `app/slices/bridle/components/bridle/chat/NewChat.vue` (auto-imported as `<BridleChatNewChat>`), props `{ conversation: IBridleConversation }`. A `<button>` in the idiom of the header's Restart button (`app/slices/agent/components/agent/chat/Provider.vue:228`) with `Icon name="message-square-plus"` and `$t('chat.new_chat')`; disabled when `newChatBlock(key)` is not null; `aria-busy` and a spinning `loader-2` when it is `busy`. Pressing it opens an inline confirmation anchored to the button, hand-rolled like the share panel's (`app/slices/share/components/share/panel/Provider.vue`, L115 onward): the sentence chosen in script as a key — `chat.new_chat_confirm_share` when `conversation.share` is set, `chat.new_chat_confirm_console` otherwise — a confirm button (`chat.new_chat_yes`) and a cancel button (`chat.new_chat_cancel`). Escape, an outside mousedown and Cancel close it; focus goes to Cancel on open and back to the button on close. Confirm closes it and calls `bridleStore.startNewChat(conversation)`. No state about the conversation lives in the component.
- [X] T030 [US1] In `app/slices/share/components/share/page/Provider.vue`, add `relative` to the header row (L328) and place `<BridleChatNewChat :conversation="conversation" />` at its right end, after the name block (L353). It renders only in the `ready` branch, which is where the header is.
- [ ] T031 [P] [US1] Add to `app/slices/bridle/i18n/locales/en.json` under `chat`: `new_chat`, `new_chat_hint`, `new_chat_empty`, `new_chat_starting`, `new_chat_confirm_share`, `new_chat_confirm_console`, `new_chat_yes`, `new_chat_cancel`, `new_chat_failed` — texts from the contract's copy table, verbatim. Run `bun run i18n:sync`.
- [ ] T032 [US1] Gates as in T023, then quickstart scenarios 1 and 2, and scenario 4 step 4 (two share tabs). Comment on CLEAN-136: the action works on the share page.

**Checkpoint**: a visitor can start over; the other tab empties with it.

---

## Phase 5: User Story 2 — Console user starts over and keeps the old conversation (Priority: P1)

**Goal**: the same action in the console's agent chat; the closed conversation is in the person's history under "Earlier"; everyone on a shared conversation sees the reset.

**Independent Test**: code word test in the console, then Chats → Earlier shows the closed conversation with the code word in it (quickstart 3).

**Depends on**: Phase 4.

- [X] T033 [US2] In `app/slices/agent/components/agent/chat/Provider.vue`, place `<BridleChatNewChat v-if="agent" :conversation="{ key: agent.id, agentId: agent.id }" />` in the header actions before `<SharePanelProvider>` (L226). Build the descriptor in a `computed` so its identity is stable. The header row is already `relative`.
- [X] T034 [US2] In `admin/slices/bridle/stores/bridle.ts`, inside `connect` beside the `agent_status` listener (L896), add `socket.on('conversation_reset', (data: { seq?: number }) => { if (!acceptHubSeq(c, data?.seq)) return; this.clearMessages(c.key); saveOutbox(c.key, []); clearDebugFromStorage(agentId) })` — the same three things `resetTranscript` does after its request (L1687–L1702). Comment: the frame is how a reset made in the customer console or in another tab reaches this one (CLEAN-136). No text is added to admin.
- [X] T035 [P] [US2] Add an `archived = false` parameter to `listMine` in `app/slices/chat/domain/chat.gateway.ts` (L18), `app/slices/chat/domain/chat.service.ts` (L22) and `app/slices/chat/data/chat.gateway.ts` (L30), passed as `query: { page, perPage, ...(archived ? { archived: true } : {}) }` to the generated `getMyChats`.
- [X] T036 [US2] In `app/slices/chat/stores/chat.ts`, add `sessions = ref<IChatSession[]>([])` and `showArchived = ref(false)`. `listMine()` reads `showArchived`, replaces `sessions` with the result's items and returns nothing a component renders; add `setShowArchived(value)` that sets the flag and reloads. Export both refs (docs/state.md rules 1, 3, 4).
- [X] T037 [US2] In `app/slices/chat/components/chat/list/Provider.vue`: keep `useAsyncData` for `pending` / `refresh` only and render `chatStore.sessions` through `storeToRefs` instead of `result.value?.items` (L8). Above the grid add a two-button segmented filter bound to `showArchived` with `$t('history.filter_current')` and `$t('history.filter_earlier')`. When "Earlier" is selected and the list is empty, show `history.empty_earlier_title` / `history.empty_earlier_hint` instead of the "no chats yet" block and its call to action.
- [X] T038 [P] [US2] In `app/slices/chat/components/chat/list/Card.vue`, show a small muted marker with `$t('session.closed')` beside the heading when `session.archived`.
- [ ] T039 [P] [US2] Add to `app/slices/chat/i18n/locales/en.json`: `history.filter_current`, `history.filter_earlier`, `history.empty_earlier_title`, `history.empty_earlier_hint`, `session.closed` — texts from the contract. Run `bun run i18n:sync`.
- [ ] T040 [US2] Twin check and gates: grep `archived` in `admin/slices/chat/` and confirm the admin list already has the filter (L119) and the badge (L157) — nothing to change. `bun test slices` and `npx nuxt typecheck` in `app/` and `admin/`, `bun run i18n:check`, `bun run locale:check`. Then quickstart scenarios 3 and 4 (both directions of step 2–3).

**Checkpoint**: US1 and US2 work; a reset from either console reaches the other.

---

## Phase 6: User Story 3 — A new chat never pretends (Priority: P2)

**Goal**: the action is unavailable, with the reason shown, when a real reset cannot be guaranteed; a failure is shown as a failure; nothing in flight leaks into the new conversation.

**Independent Test**: try a reset with the agent stopped, mid-answer, and with the route blocked — each ends with a real new conversation or the old one intact and a message saying why (quickstart 5–7).

**Depends on**: Phase 4.

- [X] T041 [P] [US3] In `app/slices/bridle/domain/bridle.types.ts`, add `onAgentStatus(connected: boolean): void` to `IBridleChannelEvents`. In `app/slices/bridle/data/bridle.gateway.ts` `openChannel`, add `socket.on('agent_status', (raw) => events.onAgentStatus((raw as { connected?: unknown } | null)?.connected === true))`. The frame is not numbered; do not pass it through `toSeq`.
- [X] T042 [US3] In `app/slices/bridle/stores/bridle.ts`: add `agentOnline = ref<Record<string, boolean>>({})`, set by `onAgentStatus` in `channelEvents` and deleted when the channel closes in `release` (L1080). Feed `newChatBlock(key)` the real inputs: `connected` from `connectionFor(key) === Connected`, `hasClientId` from `hubClientIds.has(key)`, `agentOnline` from the new ref, `answering` when `isPending(key) || hasOpenThinking(key) || messagesFor(key).some((m) => m.streaming)`. Remove the Phase 4 placeholders.
- [X] T043 [US3] In `app/slices/bridle/components/bridle/chat/NewChat.vue`, map the block reason to a hint key in script — `null` → `chat.new_chat_hint`, `empty` → `chat.new_chat_empty`, `offline` → `chat.new_chat_offline`, `agent_offline` → `chat.new_chat_agent_offline`, `answering` → `chat.new_chat_answering`, `busy` → `chat.new_chat_starting` — and put it in the button's `title` and in a visually hidden element referenced by `aria-describedby`. If the reason changes while the confirmation is open, close the confirmation.
- [X] T044 [US3] In `app/slices/bridle/components/bridle/chat/Provider.vue`, key `<BridleChatInput>` (L418) on `bridleStore.epochFor(activeConversation.key)` so the composer remounts empty after a reset (FR-003). Confirm in the store that `applyReset` leaves no staged file (`clearStaged`) and no undelivered message (`delete conversations.value[key]`), and that a `slowTimers` entry of a discarded message cannot fire `applyDelivery` afterwards — `reset` already clears them at L1249.
- [ ] T045 [P] [US3] Add to `app/slices/bridle/i18n/locales/en.json` under `chat`: `new_chat_offline`, `new_chat_agent_offline`, `new_chat_answering`, `new_chat_failed_agent_offline`, `new_chat_failed_answering` — texts from the contract. Run `bun run i18n:sync`.
- [ ] T046 [US3] Revoked link: with the share page open, revoke the link and confirm a "New chat" — the `403` must reach `watchForbidden` in `app/slices/share/components/share/page/Provider.vue` (L235) and turn the page invalid, with no notice set by `startNewChat`. If the generated client returns the error as a result instead of throwing, the interceptor still sees it; verify, do not assume.
- [ ] T047 [US3] Gates as in T023, then quickstart scenarios 5, 6, 7, 10, 11, 12 and 13. Comment on CLEAN-136.

**Checkpoint**: every way a reset can fail ends with the conversation intact and a sentence saying why.

---

## Phase 7: User Story 4 — The owner keeps what a visitor left behind (Priority: P3)

**Goal**: a visitor's closed conversation is listed once, complete, with what was attached to it. The behaviour is delivered by Phase 2; this phase proves it for the share channel and measures the push.

**Independent Test**: as a visitor, three exchanges, "New chat", one more message; in the admin console's Chats the closed conversation is under Archived, complete, and the live one holds the single new message (quickstart 9).

**Depends on**: Phases 2 and 4.

- [X] T048 [P] [US4] In `api/src/slices/chat/domain/chatSync.service.spec.ts`, add a case beside the existing one (L68): a file `data/sessions/bridle:share-ab12.2026-10-02T09-14-03-512Z.archived.jsonl` is parsed as `channel: 'bridle'`, `externalUserId: 'share-ab12'`, `archived: true`, `sessionKey` equal to the file's basename — and when the index already holds a row with that `sessionKey` (the one `archiveSession` moved) and the same size, reconcile skips it and creates no second row.
- [X] T049 [US4] If T048 fails, fix `parseName` / the size map in `api/src/slices/chat/domain/chatSync.service.ts` (L145–L229) so the moved row and the archived file meet under one key; if it passes as written, leave the service untouched and say so in the PR.
- [ ] T050 [US4] Quickstart scenarios 8 and 9 against a local stack, including step 4 (a rating survives) and the "measure here" line: record how long the route waited for the agent's push. If it is not comfortably under two seconds, raise it on CLEAN-136 before changing `ARCHIVE_SYNC_TIMEOUT_MS` or SC-001 (D5).

---

## Phase 8: User Story 6 — The Ranch admin agent is first in the list (Priority: P3)

**Goal**: the app rail shows flagged agents first, with the shield ([contracts/agent-rail.md](./contracts/agent-rail.md)).

**Independent Test**: with three agents and the admin agent not the newest, `/agents` shows it first and marked (quickstart 18).

**Depends on**: Setup only. First in the plan's delivery order.

### Tests (write first, confirm they fail)

- [X] T051 [P] [US6] Create `app/slices/agent/utils/railOrder.test.ts` for `railOrder` from `./railOrder`: a flagged agent last in the input is first in the output; the rest keep their relative order; no flagged agent → the input order; two flagged → both first, in input order; the input array is not mutated.

### Implementation

- [X] T052 [P] [US6] Add `isAdmin: boolean` to `IAgentData` in `app/slices/agent/domain/agent.types.ts` and read it in `toEntity` in `app/slices/agent/data/agent.mapper.ts` (beside `isPublic`, L42) as `o.isAdmin === true`. Add `isAdmin: false` to the `demoAgent` literal in `app/slices/common/components/landing/hero/Provider.vue` (L120) so it still satisfies the type.
- [X] T053 [US6] Create `app/slices/agent/utils/railOrder.ts`: `railOrder<T extends { isAdmin: boolean }>(agents: readonly T[]): T[]` — flagged first, stable, index loops. Reference: `admin/slices/agent/agent/composables/useAgentRailEntries.ts:98`. T051 passes.
- [X] T054 [US6] In `app/slices/agent/components/agent/workspace/Rail.vue`, apply `railOrder` to the result of the search filter in `filtered` (L21). In `app/slices/agent/components/agent/workspace/RailItem.vue`, add `isAdmin?: boolean` to the `agent` prop type (L3) and render `<Icon name="shield" :size="13" class="shrink-0 text-primary" :title="$t('rail.admin_agent')" :aria-label="$t('rail.admin_agent')" />` after the name when it is set. Do not touch `resolveLanding` in `app/slices/agent/composables/useLastAgent.ts` or `app/slices/agent/pages/agents/index.vue`.
- [ ] T055 [P] [US6] Add `rail.admin_agent` ("Ranch admin agent") to `app/slices/agent/i18n/locales/en.json`. Run `bun run i18n:sync`.
- [ ] T056 [US6] Gates as in T023, then quickstart scenario 18. Twin statement for the PR: the admin rail already pins and marks; landing differs between the consoles by decision (spec 006, R6) and was left alone.

---

## Phase 9: Companion change in the runtime (separate repository)

**Purpose**: close the one gap the hub cannot — a turn silent for more than 75 seconds that then speaks (D13). Own branch and PR in `CleanSlice/runtime`, same ticket.

- [ ] T057 In the `CleanSlice/runtime` clone, branch `fix/CLEAN-136-cancel-on-session-clear` from its up-to-date `origin/main`. In `src/slices/runtime/runtime/runtime.module.ts` (L204), make the `onBridleSessionClear` handler cancel the session's running tasks — the `cancelAll(sessionId)` the stop command uses (`src/slices/bot/bot/domain/bot.service.ts:73`), with `sessionId = "bridle:" + channel` — before `this.session.clear("bridle", channel)`. Add a `*.spec.ts` beside the module's existing specs: a task running for the session is cancelled and the session cleared, in that order; a task of another session is untouched. Run `bun test` and `bunx tsc --noEmit -p tsconfig.json`; the `telegramFile` flake and the `bridleAttachments.spec.ts` overload errors are baseline there. Open the PR, link it on CLEAN-136.

---

## Phase 10: Polish & cross-cutting

- [X] T058 [P] In `docs/state.md`, extend the closing paragraph about the chat conversation record: in `app` the record is written by the socket **and** by the transcript load, the transcript is the authority for what it holds, and the browser's stored copy is a cache of what the server does not hold yet. One paragraph; no new rule.
- [ ] T059 Run every gate from quickstart "Gates" from a clean tree, in order, and paste the commands and results into the PR description. `git status` must show no regenerated SDK noise beyond T011's change.
- [ ] T060 Walk all 18 quickstart scenarios once more end to end against the final build, Russian included (scenario 12). Record the two measurements — the agent's push time (scenario 9) and the transcript lag (scenario 15) — in the PR next to `ARCHIVE_SYNC_TIMEOUT_MS` and `UNSAVED_KEEP_MS`.
- [ ] T061 Before merge, check how the embed (the `bridle` repository) handles a non-200 from `POST …/transcript/archive`; it can now answer `409` when the agent is off the hub. Write what was found in the PR.
- [ ] T062 Write the PR description: the three gaps and how each is closed; the twin-console statement in words (plan, Constitution Check, row II); each number with its reason; what is knowingly not closed (the interim text match; unauthenticated non-share transcript routes, D12; the admin button's own gaps); the runtime PR's link and whether it has shipped.
- [ ] T063 Create the follow-up tickets in Jira `CLEAN`, assigned and labelled, and link them from CLEAN-136: `[ADMIN]` switch the admin "New chat" to the archive route and fix its warning text; `[API]` require a bearer on transcript routes for channels that are neither `share-` nor `anon-`; `[APP]` decide who may see the Ranch admin agent in the customer console; `[API]` the chat index count that trails the transcript (research F8).
- [ ] T064 Commit with `feat(app): … (CLEAN-136)` per logical group, open the PR into `main`, put its URL on CLEAN-136, post the end-of-implementation comment, and move the ticket to In Testing (transition 51 — the board has no In Review column).

---

## Dependencies & Execution Order

### Phase dependencies

```text
Phase 1 Setup
   ├── Phase 8  US6 rail ───────────────────────────┐
   ├── Phase 3  US5 history ──────────┐             │
   └── Phase 2  Foundational (api) ───┤             │
                                      ▼             │
                              Phase 4  US1 share    │
                                 ├── Phase 5  US2 console + history page
                                 ├── Phase 6  US3 never pretends
                                 └── Phase 7  US4 owner keeps (proof)
Phase 9 runtime companion — independent, any time after Phase 2's contract is fixed
Phase 10 Polish — after everything that is shipping
```

- **US5** and **US6** depend on nothing but Setup. They are PR 1.
- **US1** needs Phase 2 for the route and the frame. It is ordered after US5 because a reset is only honest on a screen that loads from the server; technically it runs without it.
- **US2**, **US3** and **US4** build on US1's store action and component.
- Phase 2's T003, T004, T006, T008, T009 are independent files; T005 and T010 are the controller pair; T007 needs T006; T010 needs T006–T009; T011 needs T010.

### Same-file sequencing

`app/slices/bridle/stores/bridle.ts` is touched by T017, T018, T019, T028 and T042 — one at a time, in that order. `app/slices/bridle/data/bridle.gateway.ts` by T017, T026, T027, T041. `app/slices/bridle/domain/bridle.types.ts` by T014, T027, T041. `app/slices/bridle/i18n/locales/en.json` by T021, T031, T045 — each followed by its own sync. `app/slices/bridle/components/bridle/chat/Provider.vue` by T020 and T044.

### Within each story

Tests first and failing, then types, then the pure rule, then data layer, then the store, then the component, then copy and sync, then gates and quickstart.

---

## Parallel example: Phase 2

```bash
# Three spec files, no shared code:
Task: "T003 hub cases in api/src/slices/bridle/data/bridle.gateway.channels.spec.ts"
Task: "T004 archiveSession cases in api/src/slices/chat/data/chat.gateway.spec.ts"
Task: "T009 ArchiveTranscriptResponseDto in api/src/slices/bridle/dtos/transcript.dto.ts"

# Then, still independent of each other:
Task: "T006 types and port in api/src/slices/bridle/domain/"
Task: "T008 archiveSession in api/src/slices/chat/"
```

## Parallel example: PR 1

```bash
# US6 and US5 share no file:
Task: "T051–T056 the rail, in app/slices/agent/"
Task: "T013–T023 history, in app/slices/bridle/"
```

---

## Implementation strategy

### MVP first — PR 1

1. Phase 1.
2. Phase 8 (US6) and Phase 3 (US5), in either order or side by side.
3. **Stop and validate**: quickstart 14–18. This fixes both things reported on production and needs no API change — ship it.

### PR 2 — the action

4. Phase 2 (api), then Phase 4 (US1), Phase 5 (US2), Phase 6 (US3), Phase 7 (US4).
5. **Stop and validate** after each phase at its checkpoint.
6. Phase 10.

If PR 2 is opened before PR 1 is merged, stack its branch on PR 1's branch rather than on `main`.

### Runtime companion

7. Phase 9, any time. The ranch PR says whether it has shipped; SC-007's "zero cases" is fully met only when it has.

### Ticket comments

Start (T001), after T012, T023, T032, T047 and at the end (T064): a few sentences each, what landed and what is next.

---

## Notes

- 64 tasks: Setup 2 · Foundational 10 · US5 11 · US1 9 · US2 8 · US3 7 · US4 3 · US6 6 · Runtime 1 · Polish 7.
- The merge (T013, T015, T018) is the part most likely to be wrong. Do not move past T023 with a failing reload case in quickstart 15.
- `transcriptTail.ts` and its test stay as they are: turn recovery keeps its own rule (D14).
- Nothing here adds a table, a column, a migration or an endpoint. If a task seems to need one, stop and re-read the contract.
