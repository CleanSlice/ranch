# Implementation Plan: "New Chat", Full History and the Pinned Ranch Agent in the Customer Console

**Branch**: `feat/CLEAN-136-share-new-chat` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Ticket**: [CLEAN-136](https://dreamvention.atlassian.net/browse/CLEAN-136)

**Input**: Feature specification from `/specs/019-share-new-chat/spec.md`; planning inputs: "нужно добавить кнопку new chat в share и app экраны", then "включи оба в CLEAN-136" (server history in the app chat; the pinned Ranch admin agent).

## Summary

Three gaps between the customer console and the admin console, closed together
because the first depends on the second:

- **"New chat"** on the share page and in the console's agent chat. Confirming
  it closes the current conversation — kept as a separate, read-only entry in
  history — and starts an empty one the agent knows nothing about. Unavailable,
  with the reason shown, whenever a real reset cannot be guaranteed.
- **The conversation the server holds**, shown in the console chat wherever it
  is opened: the person's messages and the agent's, earlier ones a scroll away.
  Today the console shows only what this browser has seen.
- **The Ranch admin agent first in the agent list**, marked, as in the admin
  console.

The approach is to finish what is already there rather than add beside it:

1. **The existing archive route becomes honest** ([contract](contracts/archive-transcript.md)).
   It refuses when the agent is off the hub or still answering, asks the agent
   to push its files before closing so the last exchange is included, and
   resets the conversation only after the old one is safely set aside.
2. **The hub gets one operation for "this conversation was reset"**
   ([contract](contracts/conversation-reset.md)): the agent forgets, the replay
   buffer is dropped, and one numbered frame tells every socket on the
   conversation. Both transcript routes use it.
3. **The chat index row moves with the conversation**, so the closed
   conversation is listed once, at once, with its ratings and summary.
4. **The console loads the transcript and merges it by one pure rule**
   ([contract](contracts/chat-history.md)) — the admin console's rule, plus one
   clause for the copy the app keeps in the browser. That copy stops being the
   conversation and becomes what the server does not hold yet.
5. **One `bridle` component and one store action** serve both "New chat" hosts
   ([contract](contracts/new-chat-ui.md)). The store answers *why* the action
   is unavailable, not just whether.
6. **Console history shows closed conversations** under an "Earlier" filter.
7. **The rail reads `isAdmin`** and puts flagged agents first
   ([contract](contracts/agent-rail.md)).

No table, column or migration. No new endpoint. One new socket frame. A
companion change in the runtime repository closes the last gap for FR-011.

## Technical Context

**Language/Version**: TypeScript 5. Vue 3 single-file components in the consoles; NestJS in `api`; Bun for scripts and console tests.

**Primary Dependencies**: Nuxt 4 with `@nuxtjs/i18n` 10 and Pinia 3 (`app`, `admin`); NestJS 11 with socket.io 4 and Prisma 6 (`api`); `@hey-api/openapi-ts` generated SDKs in both consoles. Nothing added.

**Storage**: Agent session files in object storage, through `IFileGateway` (`read`, `saveRaw`, `delete`). Postgres `ChatSession` through `IChatGateway` — existing columns only. Browser `localStorage` for the customer console's copy of a conversation — kept, with a narrower role (research D14).

**Testing**: `jest` in `api` (`*.spec.ts`, run directly: `npx jest <path>`); `bun test slices` in each console (`*.test.ts`, pure utilities). Typecheck: `bun run build` in `api`, `npx nuxt typecheck` in each console. `bun run i18n:check`, `bun run locale:check`.

**Target Platform**: Current evergreen browsers, desktop and phone widths; the API on Node in the existing deployment.

**Project Type**: Web application — two browser consoles over one API with a websocket hub, in a slice-per-feature monorepo. The agent runtime is a separate repository.

**Performance Goals**: An empty conversation on screen within 2 s of confirming in 95% of resets (SC-001); every other open screen empty within 2 s (SC-008); loaded history on screen within 2 s of the chat opening (SC-009). First paint does not wait for the network: the stored copy shows at once and the load replaces it. The reset adds one agent round trip (the push); its duration is measured in quickstart step 9.

**Constraints**: No reset is reported that did not happen (FR-010). The route must hold without the browser's cooperation. A history load never duplicates or drops what is on screen (FR-022) and a failed one changes nothing (FR-024). One extra request per conversation open, none per reconnect. No hand-written `ru.json`. Admin stays English-only and gains no text. Access to the routes is not widened.

**Scale/Scope**: 3 projects touched (`api`, `app`, `admin`), 7 slices (`api`: `bridle`, `chat`; `app`: `bridle`, `share`, `agent`, `chat`; `admin`: `bridle`). 1 route completed, 1 sibling route re-pointed, 2 hub operations, 1 index operation, 1 socket frame, 1 new component, 3 new pure utilities with tests, 22 English strings. One companion PR in `CleanSlice/runtime`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan answers |
|-----------|--------|-----------------------|
| **I. The slice is the unit** | Pass | `api/bridle` owns the routes and the hub; `api/chat` owns the index and exposes `archiveSession` on `IChatGateway`, which `BridleModule` already imports. `app/bridle` owns the conversation, so the button, the reset, the history load and the merge rule live there; `app/share` and `app/agent` place `bridle`'s public component in their headers and pass a descriptor. `app/agent` owns the rail and its order. `app/chat` owns the history page. No code lands in `common`. |
| **II. Twin consoles** | Pass | `bridle` — both sides change: app gains the action, the history load and two listeners; admin gains the `conversation_reset` listener (FR-019). The merge rule is the twin that matters most: app's `mergeTranscript` is written against admin's `loadTranscript`, the test cases state where they agree and name the one clause where they differ (the stored copy), and the interim text match is inherited, not reinvented (research D14, F9). `agent` — app gains `isAdmin`, the pin and the mark; admin already has all three (`useAgentRailEntries.ts`, `RailItem.vue`), checked, needs nothing; landing differs between the consoles by a recorded decision (spec 006 R6) and stays different. `chat` — app gains the Earlier filter and marker; admin already has both, checked. `share` — the visitor page exists only in app; admin's `share` slice is the owner's link menu, grepped for `transcript` / `archive` / `reset`: the only hits are the menu's own copied-state reset. The admin button's own gaps are recorded as debt, not copied. |
| **III. Secrets stay behind `api/`** | Pass | No credential is introduced. The share token keeps travelling per request in `X-Share-Token`, never through shared client config, and is never logged. The production check in research F8 used the platform credentials from `.env.project` read-only and printed neither them nor a token. |
| **IV. One entity, one store** | Pass | The conversation stays one record per key in the `bridle` store. The loaded transcript is merged *into* that record, not held beside it; the HTTP reset and the socket frame empty it through one function. New state (`history`, `resetting`, `agentOnline`, `epochs`) is keyed in the store. `isAdmin` is a field on the agent record the rail already renders from. The history page is moved off `useAsyncData`'s `data` onto the `chat` store's `sessions` in the lines this feature touches — existing debt fixed, not extended. |
| **V. The console is a window, the chat is the hands** | Pass | No admin-console capability is added or changed: the admin console gains a listener, not an action. Resetting one's own conversation, reading one's own history and the order of a list are not things the Ranch agent should do on a person's behalf. No tool is owed. |
| **VI. English is the source, translations are generated** | Pass | 22 strings go into the `bridle`, `chat` and `agent` slices' `en.json`; `bun run i18n:sync` generates `ru`. Which hint, confirmation or notice is shown is chosen in script and travels as a key. Loaded messages are what people and the agent wrote and are shown as received. Admin gains no string. |
| **VII. A rule stays a rule** | Pass | Every decision is a lookup or a comparison: "agent reachable" is hub registration; "turn open" is three flags and a clock (D4); "already in the transcript" is an id or a text-and-time match (D14); "belongs to a closed conversation" is an age against the hub's replay window (D14); "pinned" is a flag. No model is called. The one approximation — identical text within two minutes — is named as interim, with what removes it. |

**Additional constraints**

| Constraint | Status | Note |
|------------|--------|------|
| Generated code is generated | Pass | The archive route gains a response DTO and declared refusals; `api/swagger-spec.json` and both SDKs are regenerated, not edited. The transcript route and the agent DTO are used as generated. |
| Tracker is Jira `CLEAN` | Pass | CLEAN-136; branch, commits and PR carry it. |
| Surface marking is honest | **Action taken** | The ticket is `[ADMIN][APP][API]` with all three labels: `api` changes, `app` carries most of the work, `admin` gains one listener. |

**Quality gates owed at the end**

1. Typecheck and tests for `api`, `app` and `admin`, with the commands named in the PR (quickstart, "Gates").
2. The twin-console statement from the table above, in words, in the PR.
3. The reason behind each number: `TURN_SILENCE_MS = 75_000` (D4), `ARCHIVE_SYNC_TIMEOUT_MS = 5_000` with its measurement (D5), `UNSAVED_KEEP_MS = 600_000` tied to the hub's replay window (D14), the ±2-minute text match inherited from admin (F9), page size 50 (D15).

**Result: gate passed. No violations; Complexity Tracking is empty.**

**Post-design re-check (after Phase 1, repeated after the second scope
update)**: unchanged. The design added no project, dependency, table or
endpoint. Three things surfaced that the constitution cares about, each
recorded rather than waived: the unauthenticated transcript routes this
feature leans on (research D12 — debt, cited, follow-up owed); the history
page's `useAsyncData` rendering (fixed in the lines touched); and a merge rule
that now exists in both consoles (Principle II — one pure function in app,
tested against admin's cases).

## Project Structure

### Documentation (this feature)

```text
specs/019-share-new-chat/
├── plan.md                        # this file
├── spec.md                        # what and why
├── research.md                    # Phase 0 — findings F1–F10, decisions D1–D17, what is left out
├── data-model.md                  # Phase 1 — states and transitions; nothing new is stored
├── quickstart.md                  # Phase 1 — gates and 18 validation scenarios
├── contracts/
│   ├── archive-transcript.md      # the HTTP route: order of operations, refusals, guarantees
│   ├── conversation-reset.md      # the socket frame and the two hub operations
│   ├── new-chat-ui.md             # where the button is, what it says, the copy
│   ├── chat-history.md            # what a person sees after a load; the merge rule; paging
│   └── agent-rail.md              # order and mark of the agent list
├── checklists/
│   └── requirements.md
└── tasks.md                       # Phase 2 — created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
api/src/slices/bridle/
├── bridle.controller.ts               # CHG  archiveTranscript: the nine steps; resetTranscript → hub.resetConversation
├── bridle.controller.spec.ts          # CHG  refusals, ordering, compensation, nothing-to-close
├── dtos/transcript.dto.ts             # CHG  ArchiveTranscriptResponseDto
├── domain/bridle.gateway.ts           # CHG  isTurnOpen, resetConversation on the port
├── domain/bridle.types.ts             # CHG  conversation_reset frame type, refusal codes
├── data/bridle.gateway.ts             # CHG  turn state on IClientChannel, the two operations
└── data/bridle.gateway.channels.spec.ts  # CHG  isTurnOpen, resetConversation
api/src/slices/chat/
├── domain/chat.gateway.ts             # CHG  archiveSession on the port
├── data/chat.gateway.ts               # CHG  archiveSession
└── data/chat.gateway.spec.ts          # CHG  row moves; no row is a no-op; ratings stay attached
api/swagger-spec.json                  # GEN

app/slices/bridle/
├── components/bridle/chat/NewChat.vue # NEW  button + inline confirmation → <BridleChatNewChat>
├── components/bridle/chat/Provider.vue# CHG  composer keyed on the epoch; load older at the top, reading position kept
├── stores/bridle.ts                   # CHG  loadHistory, loadOlder, history state; startNewChat, onReset, agentOnline, resetting, epochs, newChatBlock
├── domain/bridle.types.ts             # CHG  onReset / onAgentStatus on IBridleChannelEvents; transcript page type
├── domain/bridle.gateway.ts           # CHG  transcriptPage (was transcriptTail), archiveTranscript on the port
├── domain/bridle.service.ts           # CHG  the same two
├── data/bridle.gateway.ts             # CHG  transcriptPage with cursor; archiveTranscript; two socket listeners
├── data/bridle.mapper.ts              # CHG  attachments, nextCursor, hasMore on a transcript page
├── utils/transcriptMerge.ts           # NEW  mergeTranscript — the rule
├── utils/transcriptMerge.test.ts      # NEW  the rule as cases (contracts/chat-history.md)
├── utils/newChat.ts                   # NEW  newChatBlock rule, refusal code → notice key
├── utils/newChat.test.ts              # NEW
├── utils/transcriptTail.ts            # —    untouched: turn recovery keeps its own rule (D14)
└── i18n/locales/{en,ru}.json          # CHG  16 keys (ru generated)
app/slices/share/components/share/page/Provider.vue   # CHG  the button in the page header
app/slices/agent/
├── components/agent/chat/Provider.vue # CHG  the button in the chat header
├── components/agent/workspace/Rail.vue     # CHG  railOrder after the search filter
├── components/agent/workspace/RailItem.vue # CHG  the shield and its label
├── domain/agent.types.ts              # CHG  isAdmin on IAgentData
├── data/agent.mapper.ts               # CHG  reads isAdmin
├── utils/railOrder.ts                 # NEW
├── utils/railOrder.test.ts            # NEW
└── i18n/locales/{en,ru}.json          # CHG  1 key (ru generated)
app/slices/chat/
├── stores/chat.ts                     # CHG  sessions, showArchived; listMine(archived) replaces the collection
├── domain/…, data/chat.gateway.ts     # CHG  archived passed through to getMyChats
├── components/chat/list/Provider.vue  # CHG  Current / Earlier filter; renders from the store
├── components/chat/list/Card.vue      # CHG  Closed marker
└── i18n/locales/{en,ru}.json          # CHG  5 keys (ru generated)
app/slices/setup/api/data/repositories/api/   # GEN

admin/slices/bridle/stores/bridle.ts   # CHG  conversation_reset listener
admin/slices/setup/api/data/repositories/api/ # GEN
```

Companion, separate repository and PR (`CleanSlice/runtime`, same ticket):

```text
src/slices/runtime/runtime/runtime.module.ts   # CHG  on session_clear: cancel the session's tasks, then clear
```

**Structure Decision**: The existing monorepo layout — `api/src/slices/<slice>`
with domain / data / dtos, and `app|admin/slices/<slice>` with components /
stores / domain / data / utils. One new component and three new pure utilities
in `app`; everything else is a change to a file that already owns the
behaviour.

## Delivery order

Each step leaves `main` shippable. History comes before the action because the
action's honesty depends on it.

1. **The rail** (`app/agent`): `isAdmin`, `railOrder`, the mark. US6. Independent
   of everything else; smallest, first.
2. **History** (`app/bridle`): `transcriptPage`, `mergeTranscript` and its
   cases, `loadHistory` on first `welcome`, attachments in the mapper, paging.
   US5 — the reported defect is fixed here, before any button exists.
3. **Hub and index** (`api`): turn state, `isTurnOpen`, `resetConversation`,
   `archiveSession`, their specs. `resetTranscript` re-pointed.
4. **The route** (`api`): the nine steps and their specs; spec file and SDKs
   regenerated.
5. **Listeners** (`app`, `admin`): `conversation_reset` in both stores,
   `agent_status` in the app. From here an admin-console reset empties the
   customer console at once — FR-019.
6. **The action** (`app`): `newChat.ts` and its test, the store action, the
   component, the two hosts, the copy, `i18n:sync`. US1, US2 (reset half), US3.
7. **History page** (`app/chat`): the store collection, the filter, the marker.
   US2 (history half), FR-018.
8. **Runtime companion** (other repository): task cancellation on
   `session_clear`.

Steps 1–2 can ship as their own PR ahead of the rest: they need no API change
and fix what was reported on production. Ticket comments at steps 2, 4, 6
and 8, per the delivery cycle for a large task.

## Risks

| Risk | Likelihood | Answer |
|------|------------|--------|
| The merge shows a message twice or drops one | The part of this plan most likely to be wrong | The rule is a pure function with the cases in `contracts/chat-history.md`; quickstart step 15 reloads at five moments against the admin console's view |
| Two identical messages within two minutes read as one after a reload | Low, known | Inherited from admin; named in the PR; removed when the runtime stores wire ids |
| The server's copy trails the live exchange and a reload hides the newest answer | Low | The stored copy keeps anything newer than the page's tail for ten minutes; quickstart step 15, "within two seconds" |
| The stored copy is dropped although the conversation is live (agent's storage sync broken for more than ten minutes) | Low | The agent still has its context and the messages return on screen when storage catches up. How far storage normally trails is measured in quickstart step 15 and written in the PR next to the ten-minute bound |
| The agent's push takes longer than SC-001 allows | Unknown until measured | Measured in quickstart step 9; the timeout and the criterion are adjusted with the number, not guessed (D5) |
| The embed, in another repository, calls the archive route and now gets `409` when the agent is off the hub | Low — no caller is known in this repository | Named in the PR; the embed's handling of a non-200 is checked before merge |
| A reset from one owner empties a conversation another owner is reading | By design of the shared `admin` conversation | The console confirmation exists for this; FR-019 makes it visible rather than silent |
| Late answer from a turn silent > 75 s | Rare | Companion runtime change (D13); stated in the PR if it ships later |

## Complexity Tracking

No violations to justify.
