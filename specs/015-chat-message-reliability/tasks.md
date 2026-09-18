---

description: "Task list for chat message reliability (CLEAN-102)"
---

# Tasks: Chat message reliability — nothing lost, nothing doubled, same after reload

**Input**: Design documents from `/specs/015-chat-message-reliability/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/bridle-socket.md](./contracts/bridle-socket.md),
[quickstart.md](./quickstart.md)

**Branch / ticket**: `fix/CLEAN-102-chat-message-reliability` · CLEAN-102

**Tests**: No test-first mandate. Direction from the request: *"тести как удобно, лишь
выявить причину и исправить дефект"*. Each story ends with a **Verify** task that uses
whatever is quickest for that defect — the scripted socket probe, a jest spec next to the
hub code, `bun test` for a pure function, or a headless browser script. A defect counts as
fixed only when its verify task was run and the result written into `research.md`.

**SSOT**: Direction from the request — fix duplicated state at the source so the class of
defect does not return (research D12). It shapes Phase 2 (one conversation record per key)
and Phase 8 (one agent record per id), and is written down as a project rule in T053.

**Organization**: Grouped by user story. US2 comes before US1 although both are P1: it has
no API dependency, is the smallest change, and removes the artifact asked about first
(wrong order).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md
- Paths are relative to the repository root

## Local stack (for every Verify task)

API `http://localhost:3333`, app `:3000`, admin `:3001`, local `CleanSlice/runtime`
connected as `agent-bb620efe-abb5-4123-8ace-6d9b963387c7`; login `RANCH_LOGIN` /
`RANCH_PASS` from `.env.project` (never print them). Every Owner/Admin login shares the
chat identity `admin`, so a probe run steals events from an open admin tab until T010
lands — reload that tab afterwards.

---

## Phase 1: Setup

**Purpose**: Tools to reproduce and verify; nothing user-visible.

- [X] T001 Save the scripted socket client used for research E1–E4 as `specs/015-chat-message-reliability/probe.mjs`: modes `normal` (send with ack callback + `clientMessageId`, log every event with `messageId`, `seq`, clock skew), `steal` (two sockets, first one sends, report what each received), `gap` (drop the socket after the first `typing`, reconnect after 25 s, report events), new mode `offline` (send while the agent is disconnected, print ack and any synthetic agent message). Read `API_URL`, `AGENT_ID` from env with the local defaults above; read credentials from `.env.project`; resolve `socket.io-client` via `createRequire` from the repo root; print no secrets.
- [X] T002 [P] Replace the placeholder test scripts with `"test": "bun test slices"` in `app/package.json` and `admin/package.json` so pure-function tests under `slices/**/utils/*.test.ts` run with `cd app && bun test` / `cd admin && bun test`.
- [X] T003 [P] Create a headless browser harness `specs/015-chat-message-reliability/e2e/chat.e2e.mjs` run with `bunx playwright` (install browsers on first run; do **not** add Playwright to any `package.json`): helpers to log in to the app (`:3000`) and the admin (`:3001`), open an agent chat, send a message, read the rendered bubbles in DOM order (role + text + time), read scroll position, and start a page with a skewed clock (`addInitScript` overriding `Date.now` by +120 000 ms). If Playwright cannot be installed on this machine, record that in `research.md` and fall back to the manual steps in `quickstart.md`.
- [ ] T004 With T003 (or by hand), observe the four defects not yet seen in a browser and write what happened under a new "Observed in browser" heading in `specs/015-chat-message-reliability/research.md`: F1 (reply above question with the clock +2 min), F8 (no scroll on send in admin; forced scroll on every chunk in app), F5 (landing hero chat → agent page: does the chat stay connected, does the answer arrive), F3 (admin: Rancher panel + agent Chat tab open together). Mark each hypothesis confirmed or refuted; if F5 or F3 is refuted, note it on T028 / T009 before doing them.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared shapes, the pure logic both clients use, one conversation record per
key in the admin store (SSOT), and a hub that can talk to more than one socket per
identity. **No user story work starts before this phase is done.**

- [X] T005 [P] Extend the message and thinking-block types in `app/slices/bridle/domain/bridle.types.ts` with optional `seq: number`, `delivery: 'sending' | 'slow' | 'delivered' | 'failed'`, `failureCode?: string`, and add `BridleDeliveryStates` / `IBridleSendAck` (`accepted` with `messageId`, `ts`, `duplicate?` | `rejected` with `code`, `message?`) exactly as in data-model.md and contracts/bridle-socket.md; keep every new field optional so stored conversations still load.
- [X] T006 [P] Create `app/slices/bridle/utils/chatFlow.ts`: pure `buildChatFlow(messages, blocks, { locale, now })` returning flow items `{ key, seq, kind: 'message' | 'block' | 'day', ... }` ordered **only by `seq`**, inserting a `day` item where the calendar day of `ts` changes between consecutive messages, plus `nextSeq(items)` and `numberLegacy(messages)` (assign `seq` in array order to items that lack one). Cover in `app/slices/bridle/utils/chatFlow.test.ts`: reply stamped 2 minutes earlier than the question still renders after it; equal `ts`; day boundary; legacy messages without `seq`.
- [X] T007 [P] Create `app/slices/bridle/utils/delivery.ts`: constants `SLOW_MS = 5000`, `FAILED_MS = 30000`, pure reducer `nextDelivery(state, event)` for events `sent | tick(elapsedMs) | ackAccepted | ackRejected(code) | pageLoad | resend`, implementing the state machine in data-model.md (a late `ackAccepted` moves `failed` to `delivered`; `pageLoad` turns `sending`/`slow` into `failed` with `TIMEOUT`). Cover every transition in `app/slices/bridle/utils/delivery.test.ts`.
- [X] T008 [P] Mirror T006 and T007 for the admin as `admin/slices/bridle/utils/chatFlow.ts`, `admin/slices/bridle/utils/delivery.ts` with their `.test.ts` files, adapted to the admin's `IBridleMessageData` / `IThinkingBlock` (status `'thinking' | 'done'`) shapes; add a header comment in all four files naming the twin file so they are changed together.
- [X] T009 SSOT for admin chat state — refactor `admin/slices/bridle/stores/bridle.ts` from one global `messages` / `thinkingBlocks` / socket / `isTyping` / `isConnected` / `isAgentConnected` / transcript cursor into a record keyed by conversation `"<agentId>:<channel>"` (mirroring `app/slices/bridle/stores/bridle.ts`): per-key state object with `messages`, `thinkingBlocks`, `closedTurns`, `nextSeq`, `lastHubSeq`, flags, cursor and its own socket; actions take the key (`connect(apiUrl, agentId, channel)`, `sendMessage(key, …)`, `loadTranscript`, `loadOlderTranscript`, `clearMessages(key)`, `resetTranscript`); keep `markdownEnabled`, panel open/close, debug storage global. Update every consumer to pass and read its own key: `admin/slices/bridle/components/bridle/Provider.vue`, `admin/slices/bridle/components/bridle/Input.vue`, `admin/slices/rancher/components/rancher/Provider.vue`, `admin/slices/agent/agent/composables/useAgentLifecycle.ts`. Remove the mount-time `store.clearMessages()` "previous agent leaks through" workaround in `Provider.vue` — it exists only because of the singleton.
- [X] T010 Several sockets per identity in the hub — in `api/src/slices/bridle/data/bridle.gateway.ts` change `clients` from one registration per `clientKey` to `Map<clientKey, Map<socketId, registration>>`: `registerClient` adds, `unregisterClient(clientId, agentId, socketId)` removes that socket only and clears `activeTurns` for the key when the last one leaves, `sendToClient` / `handleAgentEvent` / `broadcastAgentStatus` / `handleDebugEvent` send to **every** socket of the key, `prompt` / `capabilities` forwarded to the agent come from the sending socket, `health` / `agentHealth` / `listAgents` count sockets. Update the abstract class in `api/src/slices/bridle/domain/bridle.gateway.ts` and the callers in `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`. Add cases to `api/src/slices/bridle/data/bridle.gateway.spec.ts`: two sockets of one identity both receive an agent event; disconnecting one leaves the other receiving.
- [X] T011 Verify Phase 2: `cd api && bun run test -- bridle`, `cd app && bun test`, `cd admin && bun test`, `cd admin && npx nuxt typecheck`; run `node specs/015-chat-message-reliability/probe.mjs steal` and confirm **both** sockets now receive `typing` and the answer (before: only the second one did — research E3). Record the output in `research.md`.

**Checkpoint**: the hub fans out to every view; the admin keeps one conversation record per key; ordering and delivery logic exist as tested pure functions.

---

## Phase 3: User Story 2 — The conversation reads in the order it happened, each message once (P1) 🎯 MVP

**Goal**: Question above its answer regardless of clock skew; no message twice; sending
scrolls to the bottom, incoming content never pulls a reader back down.

**Independent Test**: quickstart scenarios 1, 2 and 10 — clock +2 min, send, multi-message
answer, follow-up mid-turn, reload; scroll up and send; two tabs.

- [X] T012 [US2] In `app/slices/bridle/stores/bridle.ts` assign `seq` from a per-conversation counter on every append: `appendMessage`, the new-bubble branch of `onStream`, `onMessage`, and when `onThinking` opens a block (replace `ts: Math.max(e.ts, lastTs + 1)` with `ts: e.ts` plus `seq`); in `hydrate` run `numberLegacy` over stored messages and restore the counter; keep `ts` untouched for display.
- [X] T013 [US2] In `app/slices/bridle/components/bridle/chat/Provider.vue` replace the `chatFlow` computed (currently `items.sort((a, b) => a.ts - b.ts)`) with `buildChatFlow` from `#bridle/utils/chatFlow` (use the slice's existing alias), keying rows by the item `key`.
- [X] T014 [US2] Scroll rule in `app/slices/bridle/components/bridle/chat/Provider.vue`: measure "near bottom" (within 80 px) **before** the DOM grows and follow incoming changes only then; in `onSend` always call `scrollToBottom()` after `nextTick`; keep the instant jump on mount.
- [X] T015 [US2] In `admin/slices/bridle/stores/bridle.ts` assign `seq` per conversation on every push (`message`, `stream` new bubble, `stream_end` new bubble, `sendMessage` echo, thinking block open — drop the `Math.max(... lastTs + 1)` anchor); `loadTranscript` numbers messages in returned order starting at 1 and sets the counter; `loadOlderTranscript` numbers the prepended page with values **below** the current minimum so existing items keep their `seq`.
- [X] T016 [US2] In `admin/slices/bridle/components/bridle/Provider.vue` build the flow with `buildChatFlow` from `admin/slices/bridle/utils/chatFlow.ts` instead of the `ts` sort, and scroll to the bottom on send regardless of position (keep the near-bottom rule for incoming content).
- [X] T017 [US2] Echo the sender's message to the identity's other sockets: in `api/src/slices/bridle/data/bridle.gateway.ts` `sendToAgent`, after handing the message to the agent, send `{ type: 'user_message', messageId, text, attachments?, ts }` to every socket of the key **except** the sending one (pass the sending `socketId` in from `api/src/slices/bridle/handlers/bridleClientWs.handler.ts`); add the type to `api/src/slices/bridle/domain/bridle.types.ts`; cover in `bridle.gateway.spec.ts`.
- [X] T018 [P] [US2] Handle `user_message` in the app: `socket.on('user_message')` in `app/slices/bridle/data/bridle.gateway.ts` (+ `onUserMessage` in `app/slices/bridle/domain/bridle.gateway.ts` events), and in `app/slices/bridle/stores/bridle.ts` append it as a delivered user message unless a message with that `id` already exists.
- [X] T019 [P] [US2] Handle `user_message` in `admin/slices/bridle/stores/bridle.ts` the same way (skip when the id is already in that conversation).
- [X] T020 [US2] Verify US2: `bun test` for chatFlow in both clients; with T003 run the skewed-clock scenario in app and admin and assert DOM order question → answer live and after reload; assert scroll-on-send from the top and no movement on incoming content while scrolled up; two pages of one login, send from the first, assert both show question once and answer once. Write results into `research.md` ("Observed in browser").

**Checkpoint**: wrong order and the scroll complaint are fixed and demonstrable on their own.

---

## Phase 4: User Story 1 — What I sent is never silently lost (P1)

**Goal**: Every send is acknowledged or visibly fails; failed messages survive a reload and
can be resent once without retyping; the landing → agent page handoff keeps the chat alive.

**Independent Test**: quickstart scenarios 5 and 6, plus `probe.mjs normal` / `offline`.

- [X] T021 [US1] Wire contract types in `api/src/slices/bridle/domain/bridle.types.ts`: optional `clientMessageId` on the browser → hub `message` payload and the `BridleSendAck` union from contracts/bridle-socket.md.
- [X] T022 [US1] In `api/src/slices/bridle/data/bridle.gateway.ts` make `sendToAgent` take an optional `clientMessageId` and a `withAck` flag and **return** `{ status: 'accepted', messageId, ts, duplicate? } | { status: 'rejected', code: 'AGENT_OFFLINE' }`: forward `clientMessageId` to the agent as `messageId` when present (else mint one as today); keep a per-`clientKey` seen-id cache (10-minute TTL, max 200) and answer a repeat with `duplicate: true` **without** forwarding; when the agent is offline return the rejection and send the synthetic "Agent is not connected" agent message **only** when `withAck` is false. Update the abstract signature in `api/src/slices/bridle/domain/bridle.gateway.ts` and the HTTP callers (`bridle.controller.ts`, `domain/bridleSync.service.ts`) to the new return type without changing their behaviour.
- [X] T023 [US1] In `api/src/slices/bridle/handlers/bridleClientWs.handler.ts` `handleMessage`: accept the socket.io ack callback, call it exactly once on every path — `rejected/EMPTY` (nothing to send), `rejected/SHARE_REJECTED` (before the existing `bridle_error` + disconnect), `rejected/ATTACHMENT_FAILED` (alongside the existing `message_error`), or the result of `sendToAgent`; behave exactly as today when no callback is passed (embed widget).
- [X] T024 [P] [US1] Add cases to `api/src/slices/bridle/handlers/bridleClientWs.handler.spec.ts` and `api/src/slices/bridle/data/bridle.gateway.spec.ts`: accepted ack carries the client's id; agent offline → rejection and **no** synthetic message with ack, synthetic message without ack; same `clientMessageId` twice → second is `duplicate` and the agent receives one message; attachment failure → rejection plus `message_error`.
- [X] T025 [US1] App transport: in `app/slices/bridle/domain/bridle.gateway.ts` change `IBridleChannel.send` to `send(text, attachmentIds, clientMessageId): Promise<IBridleSendAck>`; in `app/slices/bridle/data/bridle.gateway.ts` emit with `socket.timeout(30_000).emit('message', { text, attachmentIds?, clientMessageId }, cb)` and resolve a timeout as `{ status: 'rejected', code: 'TIMEOUT' }`.
- [X] T026 [US1] App store delivery in `app/slices/bridle/stores/bridle.ts`: `sendMessage` uses `crypto.randomUUID()` as the message `id` and `clientMessageId`, appends with `delivery: 'sending'`, starts a 5 s timer to `slow`, applies the ack through `nextDelivery` (on accept replace `ts` with the ack's `ts`), persists `delivery` with the conversation; `hydrate` applies `pageLoad` to every stored `sending`/`slow` message; new actions `resend(conv, id)` (same id, same text and attachment ids) and `discard(conv, id)`; when not connected, append the message as `failed` with `failureCode: 'OFFLINE'` instead of handing the text back to the composer — keep the CLEAN-72 draft hand-back only for the session-ended path in `onRejected`; `pending` no longer blocks a second send (FR: follow-up while the agent answers) — gate the composer on uploads only.
- [X] T027 [US1] Admin store delivery in `admin/slices/bridle/stores/bridle.ts`: same rules as T026 on the per-conversation record — uuid as `id` + `clientMessageId`, emit with ack + 30 s timeout, never emit into a null or disconnected socket (mark `failed/OFFLINE` instead), `resend` / `discard` actions; persist non-delivered messages (text + attachment references, no image bytes) under `localStorage["bridle:outbox:<agentId>:<channel>"]`; after `loadTranscript` merge the outbox under the transcript, dropping an entry whose id is in the transcript **or** (interim, until the runtime persists ids — research E2) whose exact text appears in a transcript user message within ±2 minutes of its send time; mark that fallback with a comment pointing at T044.
- [X] T028 [US1] Channel ownership in the app (research D7/F5): in `app/slices/bridle/stores/bridle.ts` turn `connect` / `disconnect` into reference-counted `acquire(conv)` / `release(conv)` — `channels: Map<key, { channel, holders, closeTimer? }>`, `release` at zero schedules the close after 3 s and `acquire` cancels it; a release with holders left must **not** touch `pending`, thinking blocks or the connection state. Switch the watcher in `app/slices/bridle/components/bridle/chat/Provider.vue` to acquire/release. Check the other mount points still behave: `app/slices/common/components/landing/hero/Provider.vue`, `app/slices/agent/components/agent/chat/Provider.vue`, `app/slices/share/components/share/page/Provider.vue`.
- [ ] T029 [US1] Verify US1: `probe.mjs normal` prints an `accepted` ack with the client's id; `probe.mjs offline` (stop the local runtime first) prints `rejected/AGENT_OFFLINE` and no agent bubble; jest specs from T024 pass; with T003: send → reload within 1 s → message present once; runtime stopped → send → reload → message present, not delivered → start runtime → Resend → delivered, one answer, one copy after another reload; Discard → gone after reload; landing hero question → click through to the agent page mid-answer → question once, no "Reconnecting…", answer continues. Record results in `research.md`.

**Checkpoint**: nothing a person sends can disappear without a visible state.

---

## Phase 5: User Story 5 — I can see when a message was sent and whether it got through (P2)

**Goal**: Time under every message, date separators, delivery state with Resend / Discard
under the person's own messages. (Placed before US3/US4 because it is the visible half of
US1 and shares its code.)

**Independent Test**: quickstart scenarios 3 and 4.

- [X] T030 [US5] Add keys to `app/slices/bridle/i18n/locales/en.json` — delivery (`sending`, `slow`, `not_delivered`, `not_delivered_hint` "The agent did not receive this message — it will be gone unless you resend it", per-code variants for `AGENT_OFFLINE` / `OFFLINE` / `TIMEOUT` / `ATTACHMENT_FAILED`), actions (`resend`, `discard`), day separators (`today`, `yesterday`) — following `docs/i18n.md`; then run `bun run i18n:sync` from the repo root to generate `ru.json`. Do not hand-write `ru.json`.
- [X] T031 [US5] In `app/slices/bridle/components/bridle/chat/Message.vue` render under each bubble the time of day via `Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })` with the full date-time in `title`; for the person's messages render the delivery line from `message.delivery` (nothing extra when delivered, spinner + `slow` text, `not_delivered` + hint + Resend / Discard buttons emitting `resend` / `discard`); copy decided in script travels as an i18n key, templates use `$t`.
- [X] T032 [US5] In `app/slices/bridle/components/bridle/chat/Provider.vue` render `day` flow items as a centred separator (`today` / `yesterday` keys, otherwise a localised long date) and wire `resend` / `discard` from `Message.vue` to the store actions from T026.
- [X] T033 [P] [US5] Admin equivalents in English only: time + tooltip + delivery line + Resend / Discard in `admin/slices/bridle/components/bridle/Message.vue`; day separators and action wiring in `admin/slices/bridle/components/bridle/Provider.vue`.
- [ ] T034 [US5] Verify US5 with T003: every bubble shows a time; times identical before and after reload; throttled network shows the loading state after ~5 s; runtime stopped shows "not delivered" under the message within 35 s; app in `ru` shows Russian wording, admin English.

---

## Phase 6: User Story 4 — The answer shows up when the agent has answered (P2)

**Goal**: Events that arrive while a browser is reconnecting are replayed; a transient
disconnect no longer kills the turn; a dead turn says so.

**Independent Test**: quickstart scenario 8, `probe.mjs gap`.

- [X] T035 [US4] Sequence + replay buffer in `api/src/slices/bridle/data/bridle.gateway.ts`: per-`clientKey` counter stamped as `seq` on **every** event routed to a browser (`handleAgentEvent`, `sendToClient`, `user_message`, status, debug); per-key ring buffer (last 500 events or 10 minutes) filled **whether or not a socket is registered**; idle eviction of counter + buffer 10 minutes after the key's last socket left; `replaySince(clientKey, lastSeq)` returning buffered events in order; `currentSeq(clientKey)`. Add to the abstract class in `api/src/slices/bridle/domain/bridle.gateway.ts`.
- [X] T036 [US4] In `api/src/slices/bridle/handlers/bridleClientWs.handler.ts` `handleConnection`: read optional numeric `lastSeq` from the handshake `auth`, emit `welcome` as `{ clientId, seq: currentSeq }`, then emit `replaySince(lastSeq)` to **this** socket before it is added to the fan-out set, so replay and live traffic cannot interleave out of order.
- [X] T037 [P] [US4] Spec cases in `api/src/slices/bridle/data/bridle.gateway.spec.ts` and `bridleClientWs.handler.spec.ts`: event routed with no socket registered is replayed on reconnect with `lastSeq`; events at or below `lastSeq` are not replayed; buffer bounds and idle eviction; `welcome.seq` lower than the client's `lastSeq` (hub restarted).
- [X] T038 [US4] App client in `app/slices/bridle/data/bridle.gateway.ts` + `app/slices/bridle/stores/bridle.ts`: pass `lastSeq` from the store in the `auth` function (called on every reconnect); store `lastHubSeq` per conversation and persist it with the conversation; ignore any event whose `seq` ≤ `lastHubSeq`; on `welcome` with a lower `seq` reset `lastHubSeq` and run the transcript reconcile (T040); in `onDisconnected` stop calling `closeAllTurns` and stop clearing `pending` — leave the turn open and let the watchdog decide.
- [X] T039 [US4] Same in `admin/slices/bridle/stores/bridle.ts`: `lastSeq` in the socket `auth` callback, per-conversation `lastHubSeq`, drop stale `seq`, no `_closeAllTurns()` / `isTyping = false` on a transient `disconnect`, `welcome.seq` fallback to `loadTranscript` merge.
- [X] T040 [US4] Safety net + visible failure: add `transcriptTail(agentId, channel)` to `app/slices/bridle/domain/bridle.gateway.ts` / `app/slices/bridle/data/bridle.gateway.ts` using the generated SDK call for `GET /api/agent/:agentId/transcript` (if the SDK lacks it, regenerate with `cd app && bun run build:api`, do not hand-write types); when the watchdog in `app/slices/bridle/stores/bridle.ts` expires with a turn still open, fetch the tail, append assistant messages newer than the last one on screen, and if there are none show a "the agent did not finish this turn" notice (new key in `en.json`, then `i18n:sync`). Same behaviour in `admin/slices/bridle/stores/bridle.ts` using its existing `fetchTranscriptPage`.
- [ ] T041 [US4] Verify US4: `probe.mjs gap` extended to send `lastSeq` on reconnect now reports the missed `stream_end` after reconnecting (before: none — research E4); jest specs from T037 pass; with T003: go offline across the end of a turn, come back, answer visible within 10 s with no duplicate bubble; restart the API during the gap and confirm the transcript fallback path runs (on this Windows machine the transcript route returns nothing — see research "Local-environment note" — so assert the *notice*, and validate the recovery itself on the cluster).

---

## Phase 7: User Story 3 — A reloaded conversation looks like the one I watched (P2)

**Goal**: One bubble per agent message after reload, same boundaries and formatting.
**The decisive change is in `CleanSlice/runtime`, not in this repository.**

**Independent Test**: quickstart scenario 9, on the cluster.

- [X] T042 [US3] Add cases to `api/src/slices/agent/file/domain/transcriptReader.service.spec.ts` proving the reader already does the right thing once the runtime writes per-message events: several consecutive `assistant` events in one turn come back as separate messages in file order; events with equal `ts` keep file order; `transient` partial chunks are still dropped. Fix `transcriptReader.service.ts` only if a case fails.
- [X] T043 [US3] **Separate repository — confirm with the requester before starting; needs its own CLEAN ticket, branch and PR in `CleanSlice/runtime` (`E:/code/dream/cleanslice/runtime`).** In `src/slices/runtime/loop/domain/loop.service.ts` persist one `assistant` event per message emitted to the channel, with the wire `messageId` as the event `id`, instead of one event per turn with the accumulated `fullText` in `sendFinalResponse`; persist the incoming `messageId` as the `id` of the `user` event. Keep the model-facing history equivalent (the next LLM call must still see the whole turn). Desirable: emit a `persisted` acknowledgement to the hub after the user event is written.
- [ ] T044 [US3] After T043 ships: remove the interim text-match fallback from T027 (match by id only) and treat a `persisted` ack, if implemented, as the `delivered` signal in `api/src/slices/bridle/data/bridle.gateway.ts`; update contracts/bridle-socket.md accordingly.
- [ ] T045 [US3] Verify US3 on the cluster: agent answers in ≥ 3 messages with list, inline code and bold; compare live view, admin after reload and the app's `/chats/:id` page — same count, boundaries and formatting, no glued sentences. Until T043 ships this is expected to **fail** and must be reported as failing, not skipped.

---

## Phase 8: User Story 6 — An agent shows the same status everywhere (P3) — SSOT

**Goal**: One agent record per id; every screen renders from it; fetches upsert into it;
pushes patch it. Independent of Phases 3–7 — can ship as its own PR.

**Independent Test**: quickstart scenario 11.

- [X] T046 [US6] SSOT in `admin/slices/agent/agent/stores/agent.ts`: add `byId(id)` (computed lookup into `agents`), `upsert(agent)` (replace by id or append), `patch(id, partial)` returning a rollback function; make `fetchById` upsert its result before returning, `fetchAdmin` likewise; keep `fetchAll` as the collection load; route the existing optimistic status flips in `update` / restart / stop through `patch`.
- [X] T047 [US6] In `admin/slices/agent/agent/stores/agentStatus.ts` `applyMessage`: write `status.agent` into the agent store with `useAgentStore().patch(status.agent.id, status.agent)` (upsert when the id is unknown), remove the record on `deleted`, and make the store's own `agents` map a derived view of the agent store (or delete it and update its readers) so there is no second copy.
- [X] T048 [US6] Render from the store: in `admin/slices/agent/agent/components/agent/workspace/Main.vue` keep `useAsyncData(() => agentStore.fetchById(id))` for loading/error only and pass `computed(() => agentStore.byId(props.id))` to the template and to `useAgentLifecycle`; in `admin/slices/agent/agent/composables/useAgentLifecycle.ts` replace every `agent.value = { ...agent.value, status }` with `agentStore.patch(agentId, { status })` + rollback, and drop `liveAgent` merging that T047 makes redundant; do the same for `admin/slices/agent/agent/components/agent/edit/Provider.vue` and the two `fetchById` calls in `admin/slices/agent/file/components/agentFile/Provider.vue`.
- [X] T049 [US6] In `admin/slices/agent/agent/components/agent/workspace/Provider.vue` pass `agentStore.agents` (via `storeToRefs`) to `AgentWorkspaceRail` instead of the `useAsyncData` `data` ref, and make sure `RailItem.vue` shows `statusReason` for the row; check the other list consumers read the store too: `admin/slices/agent/agent/pages/agents/index.vue`, `admin/slices/chat/components/chat/list/Provider.vue`, `admin/slices/paddock/components/paddock/evaluation/list/Provider.vue`, `admin/slices/llm/composables/useLlmUsageOverview.ts`.
- [X] T050 [P] [US6] Same SSOT in the app: `app/slices/agent/stores/agent.ts` (`byId`, `upsert`, `patch`; `fetchById`, `create`, `update`, `restart` upsert; `fetchPublic` stays separate — public cards are a different projection), and render from the store in `app/slices/agent/components/agent/Provider.vue`, `app/slices/agent/components/agent/chat/Provider.vue` (its optimistic `agent.value = { ...status: 'deploying' }` becomes `patch` + rollback) and `app/slices/agent/components/agent/workspace/Provider.vue`.
- [X] T051 [US6] Check the server side of the same defect: `useAgentLifecycle` says "Backend syncStatus runs on each fetchById". In `api/src/slices/agent/agent/` find where status is reconciled and whether the list endpoint (`findAll`) and the `/agents/status/stream` SSE reconcile too; if a non-selected agent's status can stay stale in the database until someone opens it, make the periodic reconciler / stream cover every agent, and add a spec next to the service. Record the finding in `research.md` either way.
- [ ] T052 [US6] Verify US6: on the agents screen trigger a deploy that ends in `failed` — list row, header pill and Overview card change together within 10 s without reload and the reason is on the row; repeat with a different agent selected; `cd admin && npx nuxt typecheck`, `cd app && npx nuxt typecheck`.

---

## Phase 9: Polish & cross-cutting

- [X] T053 [P] Write the SSOT rule down so the defect class does not return: `docs/state.md` — "an entity lives once in its Pinia store; fetches upsert; pushes patch; components render by id; `useAsyncData` is for loading state, not a render source; optimistic changes go through a store action with rollback" — with the agent store and the chat conversation record as the two worked examples; link it from `AGENTS.md` and `CLAUDE.md`.
- [ ] T054 [P] Update `README.md` / `docs/operations/` where they describe the chat socket protocol (ack, `clientMessageId`, `seq` / `lastSeq`, `user_message`, several sockets per identity) — point to `specs/015-chat-message-reliability/contracts/bridle-socket.md` rather than duplicating it.
- [ ] T055 Full gate: `cd api && bun run lint && bun run test`; `cd app && bun test && npx nuxt typecheck`; `cd admin && bun test && npx nuxt typecheck` (not `bun run typecheck` in `app/` — it regenerates the SDK); confirm no generated file under `*/slices/setup/api/data/repositories/api/` is staged unless T040 required a regeneration.
- [ ] T056 Run every scenario in `specs/015-chat-message-reliability/quickstart.md`, fill the "Observed" results into `research.md`, and update `spec.md` success-criteria status honestly — including anything that still fails (US3 until T043).
- [ ] T057 Delivery cycle: CLEAN-102 checkpoint comments after each phase, Conventional Commits with `(CLEAN-102)` — `fix(api):`, `fix(app):`, `fix(admin):` — PR into `main` with the ticket linked, PR URL on the ticket, move to In Testing; a separate ticket + PR for T043 in `CleanSlice/runtime`; if Phase 8 ships on its own, give it its own PR from the same ticket or a new one, as the requester prefers.

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1** → no dependencies. T004 informs T009 and T028 (it confirms or refutes F3 / F5).
- **Phase 2** → blocks Phases 3–7. T009 blocks every admin chat task; T010 blocks T017, T022, T035.
- **Phase 3 (US2)** → after Phase 2. No API dependency except T017–T019.
- **Phase 4 (US1)** → after Phase 2; T026/T027 build on the `seq` work of T012/T015 (same files — do not run in parallel with Phase 3).
- **Phase 5 (US5)** → after Phase 4 (renders what US1 stores).
- **Phase 6 (US4)** → after Phase 2; touches the same store files as Phases 3–4, so sequence it after them.
- **Phase 7 (US3)** → T042 any time; T043 is external; T044–T045 after T043.
- **Phase 8 (US6)** → independent of all chat phases; can run in parallel with them (different slices) or ship first.
- **Phase 9** → last.

### Same-file serialisation

`app/slices/bridle/stores/bridle.ts`: T012 → T018 → T026 → T028 → T038 → T040.
`admin/slices/bridle/stores/bridle.ts`: T009 → T015 → T019 → T027 → T039 → T040.
`api/src/slices/bridle/data/bridle.gateway.ts`: T010 → T017 → T022 → T035.
`api/src/slices/bridle/handlers/bridleClientWs.handler.ts`: T010 → T017 → T023 → T036.

### Parallel opportunities

- Phase 1: T002, T003 alongside T001.
- Phase 2: T005, T006, T007, T008 together; T009 (admin) and T010 (API) are different projects and can run side by side.
- Phase 3: T018 (app) and T019 (admin) together after T017.
- Phase 4: T024 (specs) alongside T025–T027; T026 (app) and T027 (admin) are different projects.
- Phase 5: T033 (admin) alongside T030–T032 (app).
- Phase 6: T037 alongside T038–T039; T038 (app) and T039 (admin) side by side.
- Phase 8 as a whole, and T050 (app) alongside T046–T049 (admin).

## Parallel example: Phase 2

```text
Task: "T006 chatFlow.ts + tests in app/slices/bridle/utils/"
Task: "T007 delivery.ts + tests in app/slices/bridle/utils/"
Task: "T008 admin twins in admin/slices/bridle/utils/"
Task: "T010 several sockets per identity in api/src/slices/bridle/data/bridle.gateway.ts"
# then, on its own: T009 admin store refactor
```

## Implementation strategy

### MVP

Phase 1 → Phase 2 → **Phase 3 (US2)**. That alone fixes the wrong order, the scroll
complaint and — through T010 — the reproduced "the tab that sent gets nothing" defect,
which is the likeliest cause of hung answers. Stop, verify with T011 and T020, demo.

### Incremental delivery

1. MVP above → PR 1 (or keep on the branch and continue).
2. Phase 4 + Phase 5 (US1 + US5): acknowledged sends, outbox, time and delivery state.
3. Phase 6 (US4): replay after reconnect.
4. Phase 8 (US6, SSOT for agents): independent; ship whenever convenient.
5. Phase 7 (US3): gated on the runtime change (T043) — schedule it with whoever owns `CleanSlice/runtime`.

## Notes

- Verify tasks are the definition of done for a story; "should work" is not a result —
  write the observed output into `research.md`.
- Every wire change is additive and optional (embed widget compatibility).
- The hub's new state is in memory; the plan assumes one API instance, as the hub already does.
- Commit after each task or logical group; never commit `.env.project` or regenerated SDK files by accident.
