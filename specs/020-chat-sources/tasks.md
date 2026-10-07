# Tasks: Sources in Chat Answers

**Input**: Design documents from `/specs/020-chat-sources/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md), [analysis.md](./analysis.md)

**Tracker**: [CLEAN-138](https://dreamvention.atlassian.net/browse/CLEAN-138) · ranch branch `feat/CLEAN-138-chat-sources` (from `origin/main` `02c1154b`) · runtime branch `feat/CLEAN-138-chat-sources` to be cut from `origin/main` `f2e0048` in `E:/code/dream/cleanslice/runtime`

**Tests**: required by the constitution's quality gate 2 and by `docs/agent-tools.md` (a spec beside every tool). The rules that decide what a reader sees — source extraction, marker validation and renumbering, the stripping rule, the reader-access check, the citation-keyed precondition — are pure functions or services with a jest/bun spec listed *before* the code they cover. Screens are verified through [quickstart.md](./quickstart.md); there is no component-test harness in either console.

**Organization**: grouped by user story. Ranch paths are repository-relative; runtime paths are relative to the runtime clone and prefixed `runtime:`. "R4", "R9" refer to [research.md](./research.md). Line numbers were read at the base commits above and may drift.

## Status after the implementation pass (2026-10-07)

Both PRs are open: ranch [#137](https://github.com/CleanSlice/ranch/pull/137),
runtime [#23](https://github.com/CleanSlice/runtime/pull/23) (merge first).
CLEAN-138 is In Testing. Unit-level gates are green in both repos (API 1908
tests, admin 161, app 147, runtime 203 + the baseline telegramFile failure,
scripts 76, locale check clean, both consoles typecheck).

Still open, and why:

- **Quickstart in a browser** — the browser halves of T043, T049, T058, T062,
  T072, T079 and the whole of T082 (compatibility pass) were not walked: no
  agent with a bound knowledge base was available in this session.
- **T081** (LightRAG answer markers) needs a dev base; not verified.
- **T083** (tools visible in the Rancher Tools panel) needs a running stack.
- **ru.json** for the new app strings (T037, T057, T061, T070): `CLAUDE_API_KEY`
  in `.env.project` answers 401, so `i18n:sync` could not run.
- Follow-ups filed: CLEAN-146, CLEAN-147, CLEAN-148 (T088).

Decided while building: the hub takes a cited source's knowledge base from the
`Source` row and refuses to link a source outside the agent's bound bases (both
from the security review); `SourceAccessService` lives in `bridle`, not
`reins/source`, so the knowledge slice never depends on the chat slice; ratings
are checked for "cited to you" in the bridle controller and the reins service
only stores them; inline document display is limited to pdf/image/text with
nosniff and a sandbox CSP; likes/dislikes sorting ranks the filtered base's ids
in memory because Prisma cannot order by a filtered relation count.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 as numbered in spec.md

---

## Phase 1: Setup (contract and schema, both repos)

**Purpose**: the one shape everything else agrees on, and the database it lands in.

- [X] T001 Cut the runtime branch: in `E:/code/dream/cleanslice/runtime` run `git fetch origin main` and `git switch -c feat/CLEAN-138-chat-sources origin/main` (the clone sits on `fix/CLEAN-124-context-budget`; do not touch its uncommitted `.gitignore`)
- [X] T002 [P] Define `ISource` and `ISourceFrameEntry` per `contracts/sources.md` §1/§5 in `runtime:src/slices/runtime/loop/domain/loop.types.ts` (export; add `citeSources?: boolean` and `sendSources?: (messageId: string, text: string, sources: ISource[]) => void` to `ILoopContext`)
- [X] T003 [P] Define the hub-side types in `api/src/slices/bridle/domain/bridle.types.ts`: `IBridleSource` (= `ISource`), `IBridleSourcesEvent` (`type: 'sources'`, `clientId`, `messageId`, `text`, `sources`, `ts`), add `'sources'` to `IBridleOutgoingEvent['type']` and `sources?` to the frame; update the frame-shape comment in `api/src/slices/bridle/handlers/bridleAgentWs.handler.ts:31-39`
- [X] T004 [P] Add `readerAccess String @default("closed")` with a comment to `api/src/slices/reins/knowledge/knowledge.prisma`
- [X] T005 [P] Create `api/src/slices/chat/chatMessageSource.prisma` with model `ChatMessageSource` exactly as in `data-model.md` (fields, `@@unique([messageId, n])`, indexes, `sourceId` FK to `Source` with `onDelete: SetNull`; add the back-relation `citations ChatMessageSource[]` to `Source` in `api/src/slices/reins/source/source.prisma`)
- [X] T006 [P] Create `api/src/slices/reins/source/sourceRating.prisma` with model `SourceRating` as in `data-model.md` (`sourceId` FK cascade, `@@unique([sourceId, messageId, authorId])`; back-relation `ratings SourceRating[]` on `Source`)
- [X] T007 Generate the migration: `cd api && bun run migrate` (needs `.env.dev`; local DB per memory "Ranch local DB run"), rename the folder to `api/prisma/migrations/<timestamp>_chat_sources/`, check it adds one column with default `'closed'` and two tables, and that `bun run build` (typecheck) passes

---

## Phase 2: Foundational (the pipeline every story stands on)

**Purpose**: a source consulted by the agent reaches the hub as a recorded, relayed `sources` frame. Without this no story can be shown.

**⚠️ CRITICAL**: US1–US6 all read from what this phase produces.

### Runtime — registry, validation, event

- [X] T008 [P] Write `runtime:src/slices/runtime/loop/domain/sources.spec.ts` (bun) covering: `extractSources` reads `sources` and `results[].sources` from a plain object and from MCP `[{type:'text',text:'<json>'}]`, ignores non-JSON text, drops non-`https?` web urls; `SourceRegistry.numberOf` dedups knowledge by `id` and web by normalised url and keeps numbers stable across calls; `citeBlock(entries)` renders `Sources you may cite: [^3] «name» (knowledge: Legal) · [^4] https://… (web)`; `finalizeBubble(text, registry)` removes unknown `[^k]`, leaves markers inside fenced/inline code, renumbers survivors densely by first appearance and returns `{ text, sources }` in that order; `stripMarkers(text)` removes every `[^n]` outside code
- [X] T009 Implement `runtime:src/slices/runtime/loop/domain/sources.ts` so T008 passes: `extractSources`, `SourceRegistry`, `citeBlock`, `finalizeBubble`, `stripMarkers`, `normaliseUrl` (lower-case scheme+host, drop fragment)
- [X] T010 Add `sources?(params: unknown, result: unknown): ISource[]` to `Tool` in `runtime:src/slices/agent/tool/domain/tool.types.ts` next to `stepLabel` (L84), with a doc comment pointing at `contracts/sources.md`
- [X] T011 In `runtime:src/slices/runtime/loop/domain/loop.service.ts`: create one `SourceRegistry` per `run()` (beside `bubbles`, ~L102); in `executeToolCalls` after the raw `result` is known and before `capPayload` (~L396-413) collect `tool.sources?.(params, result) ?? extractSources(result)` into the registry and, when `ctx.citeSources`, append `citeBlock(newEntries)` to the serialised result the model sees (the history copy, not the JSONL event); thread the registry through the `executeToolCalls` signature
- [X] T012 In `runtime:src/slices/runtime/loop/domain/loop.service.ts`: after `streamSend` returns a `messageId` (~L295-318, where `onBubble` fires) and in the non-streamed `ctx.send` path of `sendFinalResponse` (~L503), run `finalizeBubble` when `ctx.citeSources` (else `stripMarkers`); replace the bubble text with the corrected one; call `ctx.sendSources?.(messageId, text, sources)` when `sources.length > 0`; write `data.sources: [{ messageId, sources }]` and the corrected `data.text` / `data.messages[].text` on the assistant event (~L473-481)
- [X] T013 Write `runtime:src/slices/runtime/loop/domain/loop.sources.spec.ts` with the `makeLoop` pattern from `loop.bubbles.spec.ts:21-69`: a scripted tool returning `{ sources: [...] }` → the model text `"A [^1] B [^7]"` yields a `sendSources` call with `text "A [^1] B"` and one source, and the assistant event carries `data.sources`; with `citeSources: false` no call is made and the text has no markers; a knowledge source cited in two bubbles gets number 1 in each
- [X] T014 [P] Add the capability-gated prompt: new `citationsPrompt?: string` on all three duplicated opts types (`runtime:src/slices/agent/agent/domain/agent.service.ts:6-30` `BuildPromptOpts`, `:137` inline opts, `runtime:src/slices/agent/agent/agent.module.ts:12`) rendered as a `# Citing sources` section before `# Agent Instructions`; text in a new `runtime:src/slices/agent/agent/domain/prompts/citations.ts` (cite with `[^n]` only from "Sources you may cite", after the sentence, never write your own list, do not cite what you did not look up)
- [X] T015 [P] Channel plumbing for the event: `sendSources?(to, messageId, text, sources)` on `IChannelGateway` in `runtime:src/slices/setup/channel/domain/channel.gateway.ts`, pass-through in `runtime:src/slices/setup/channel/domain/channel.service.ts` (beside `sendThinking`, ~L125) and `runtime:src/slices/setup/channel/channel.module.ts` (~L274); emit `socket.emit('sources', { type:'sources', clientId: to, messageId, text, sources, ts: Date.now() })` in `runtime:src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts` after `sendThinking` (~L319-328)
- [X] T016 Wire it in `runtime:src/slices/runtime/runtime/domain/runtime.service.ts`: `const citeSources = !isInternal && msg.channel !== 'internal' && msg.capabilities?.includes('sources') === true` (beside the `thinking` gate, ~L110-112); pass `citeSources`, `sendSources` closure (→ `this.deps.channel.sendSources`) and `citationsPrompt` (only when `citeSources`) into the loop context and `buildPrompt` (~L290-300)
- [X] T017 Runtime gates: `bun test` (baseline noise: `telegramFile` when the whole suite runs, `bridleAttachments.spec.ts` tsc overloads) and `bunx tsc --noEmit -p tsconfig.json`

### Ranch hub — `query_knowledge` sources, record, relay

- [X] T018 [P] Extend `api/src/slices/reins/knowledge/knowledge.tool.spec.ts`: a query result with references `[{sourceId:'s1', sourceName:'Doc'}, {sourceId:null}]` yields `sources: [{ kind:'knowledge', id:'s1', name:'Doc', knowledgeId, knowledgeName }]` (null skipped, one warn), on both the single and the fan-out `{ results }` shape
- [X] T019 In `api/src/slices/reins/knowledge/knowledge.tool.ts` `query()` (L101-180) add `sources` to each result per `contracts/sources.md` §2 (dedup by `sourceId`, skip null with `this.logger.warn`); keep `references` as is
- [X] T020 [P] Write `api/src/slices/chat/domain/chatSource.service.spec.ts` (jest): `record()` upserts rows on `(messageId, n)`, sets `sourceId` only when the `Source` exists (else null, name kept), rejects an event with >50 entries or a non-`https?` web url; `forMessages(messageIds, viewer)` returns `SourceEntryDto[]` per message with `canOpen` = (`knowledge` ∧ `sourceId≠null` ∧ (`readerAccess==='open'` ∨ viewer is admin)) or (`web` ∧ url present), `myRating` from `SourceRatingService` for the viewer, and never includes `sourceId`/`knowledgeId`
- [X] T021 Implement `api/src/slices/chat/data/chatSource.gateway.ts` (Prisma upsert/findMany on `ChatMessageSource`, `findBySessionMessages`) and `api/src/slices/chat/domain/chatSource.service.ts` (`record`, `forMessages`, `isCitedTo(agentId, messageId, n, clientId)` → row or null) so T020 passes; inject `IKnowledgeGateway.findExistingByIds` for the policy and `SourceRatingService` for `myRating` (both via the owning slices' exported providers); export from `api/src/slices/chat/chat.module.ts`
- [X] T022 Add `@SubscribeMessage('sources')` to `api/src/slices/bridle/handlers/bridleAgentWs.handler.ts` (beside `stream_end`, ~L137-171): validate shape, `await chatSources.record({ agentId, clientId, sessionKey: 'bridle:'+clientId, messageId, sources })`, then `this.hub.handleAgentEvent(agentId, { type:'sources', clientId, messageId, text, sources: entries })` where `entries` come from `forMessages([messageId], { clientId })`; invalid → `logger.warn` and drop; import `ChatModule` into `api/src/slices/bridle/bridle.module.ts`
- [X] T023 Extend `api/src/slices/bridle/bridle.controller.spec.ts` (or the handler spec) with: a `sources` event is recorded then routed with `seq`; a malformed one is dropped and nothing is written
- [X] T024 Ranch api gates: `cd api && bun run build` and `NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/bridle src/slices/chat src/slices/reins`

**Checkpoint**: with a client that advertises `sources`, the hub logs a recorded `sources` frame per cited bubble. Nothing is drawn yet.

---

## Phase 3: User Story 1 — See what an answer is based on (Priority: P1) 🎯 MVP

**Goal**: chips in the text, a numbered list under the bubble, in the live chat of both consoles and the share page, surviving reload and history.

**Independent Test**: quickstart §1 — ask a K1-only question in the app chat; chips and list appear; reload and admin chat history show the same.

### Transcript and history overlay

- [X] T025 [P] [US1] Add `sources?: SourceEntryDto[]` (new DTO class per `contracts/api.md` §4, in `api/src/slices/chat/dtos/sourceEntry.dto.ts`) to `TranscriptMessageDto` in `api/src/slices/bridle/dtos/transcript.dto.ts` and to `ChatMessageDto` in `api/src/slices/chat/dtos/chatMessage.dto.ts`
- [X] T026 [US1] Overlay sources in `GET :agentId/transcript` (`api/src/slices/bridle/bridle.controller.ts:612`): after `TranscriptReaderService.read`, call `chatSources.forMessages(ids, viewer)` and attach per message; same in `GET chats/:id/messages` (`api/src/slices/chat/chat.controller.ts:119-164`, viewer admin) and `GET me/chats/:id/messages` (`api/src/slices/chat/myChat.controller.ts`, viewer `sub`)
- [X] T027 [US1] Regenerate SDKs: `cd api && bun run build`, then `cd admin && bun run build:api` and `cd app && bun run build:api`; commit only the generated files that belong to this ticket (memory: regen may carry older tickets' types)

### App console (`app/slices/bridle`, also serves the share page)

- [X] T028 [P] [US1] Add `IBridleSource` and `IBridleMessage.sources?` to `app/slices/bridle/domain/bridle.types.ts:100-152` per `data-model.md` §Browser; add `IBridleSourcesFrame` beside `IBridleReply` (:374-384)
- [X] T029 [P] [US1] Add `'sources'` to `CAPABILITIES` and `socket.on('sources', …)` in `app/slices/bridle/data/bridle.gateway.ts` (~L101, L142-149); add `BridleMapper.toSourcesFrame` and keep `sources` in `toTranscript` (`app/slices/bridle/data/bridle.mapper.ts:30-38, 105-136`)
- [X] T030 [US1] In `app/slices/bridle/stores/bridle.ts`: `onSources(conv, frame)` patches the message with `frame.messageId` (`text` + `sources`) through the existing replace path and persists; register it in `channelEvents` (~L1092-1136); keep `sources` in `recoverFromTranscript` (~L698-741, `missedReplies` appends)
- [X] T031 [P] [US1] Extend `app/slices/bridle/utils/transcriptMerge.test.ts` and `transcriptTail.test.ts`: a transcript message with `sources` keeps them after merge and after tail recovery
- [X] T032 [P] [US1] Write `app/slices/bridle/utils/citations.test.ts` and `citations.ts`: `markCitations(markdown, { numbered })` turns `[^n]` outside code into `<sup class="chat-cite" data-n="n">n</sup>` (or `<sup class="chat-cite chat-cite--pending"></sup>` when the bubble has no `sources` yet) and strips nothing else; `stripCitations(markdown)` for the final line of defence
- [X] T033 [US1] In `app/slices/bridle/utils/markdown.ts:16-44`: run `markCitations` before `marked.parse` when the caller passes `{ citations: 'numbered' | 'pending' | 'strip' }`; add `sup` to `ALLOWED_TAGS` and `data-n` to `ALLOWED_ATTR`
- [X] T034 [P] [US1] Add `.chat-md .chat-cite` (chip: small, rounded, accent background, `cursor: pointer`), `.chat-cite--pending` (neutral dot) and `.chat-cite--active` to `app/slices/bridle/assets/chat-md.css`; copy the file byte-for-byte to `admin/slices/bridle/assets/chat-md.css`; `bun test scripts` must pass
- [X] T035 [US1] Create `app/slices/bridle/components/bridle/chat/Sources.vue`: props `sources: IBridleSource[]`, `messageId`; ordered list `n. name` with a kind marker (knowledge / web icon + `$t`), entry ids `src-<messageId>-<n>`; exposes `reveal(n)` that scrolls the entry into view and sets `chat-cite--active` on it for 1.5 s; no bookmark (FR-028)
- [X] T036 [US1] In `app/slices/bridle/components/bridle/chat/Message.vue`: render with `citations: message.sources ? 'numbered' : message.streaming ? 'pending' : 'strip'` (:57-59); mount `<BridleChatSources>` below the bubble and above the meta row (:95) when `message.sources?.length`; delegate clicks on `.chat-cite` to `sources.reveal(n)`
- [X] T037 [P] [US1] Add keys under `chat` in `app/slices/bridle/i18n/locales/en.json`: `sources_title` "Sources", `source_kind_knowledge` "Knowledge", `source_kind_web` "Web", `source_open` "Open {name}"; run `bun run i18n:sync` and commit the generated `ru.json`

### Admin console (`admin/slices/bridle`, not a copy of the app store)

- [X] T038 [P] [US1] In `admin/slices/bridle/stores/bridle.ts`: add `sources?: IBridleSourceEntry[]` to `IBridleMessageData` (:91-126); add `'sources'` to the capabilities literal (:821); `socket.on('sources')` beside `stream_end` (~L1091-1111) patching the message by `messageId` (`text`, `sources`); keep `sources` in `toBridleMessage` (:396-410) and in `fetchTranscriptPage` (:312-336)
- [X] T039 [P] [US1] Mirror T032/T033 in `admin/slices/bridle/utils/citations.ts` (+ `citations.test.ts`) and `admin/slices/bridle/utils/markdown.ts` (the two renderers differ; port the pre-pass and the allow-list additions, not the file)
- [X] T040 [US1] Create `admin/slices/bridle/components/bridle/Sources.vue` (same behaviour as T035, English strings) and mount it in `admin/slices/bridle/components/bridle/Message.vue` after the parts loop (:125-186) and before the time row (:188); pass the citations mode into `BridleMarkdown`

### History views (`chat` slice, both consoles)

- [X] T041 [P] [US1] Add `sources?` to `IChatMessage` and copy it in the mapper: `admin/slices/chat/domain/chat.types.ts` + `admin/slices/chat/data/chat.mapper.ts:111-129`, `app/slices/chat/domain/chat.types.ts` + `app/slices/chat/data/chat.mapper.ts:108-126`
- [X] T042 [US1] Render chips and `<BridleChatSources>` / `<BridleSources>` in `app/slices/chat/components/chat/message/Bubble.vue` (:25-27 markdown call) and `admin/slices/chat/components/chat/message/Bubble.vue` (reuses bridle `Markdown`)
- [X] T043 [US1] Console gates: `cd admin && npx nuxt typecheck && bun test slices`, `cd app && npx nuxt typecheck && bun test slices`, `bun run locale:check`; then quickstart §1 in a browser (app chat, share page, admin chat, admin history)

**Checkpoint**: US1 is the MVP — citations and the list, shown and persisted, in every place a conversation is drawn.

---

## Phase 4: User Story 5 — Decide whether readers may open our documents (Priority: P2)

**Goal**: a per-base `readerAccess` policy, off by default, editable in the knowledge console and through the Ranch agent. Comes before US2 because US2 opens documents and must not ship ahead of the switch.

**Independent Test**: quickstart §5.1 and §5.4 — toggle in the Overview card, `get_knowledge` shows it, the tool refuses without `confirm`.

- [X] T044 [P] [US5] Carry `readerAccess` through the API: `KnowledgeDto` (`api/src/slices/reins/knowledge/dtos/knowledge.dto.ts`), `UpdateKnowledgeDto` with `@IsOptional() @IsIn(['closed','open'])` (`dtos/updateKnowledge.dto.ts`), `IKnowledgeRecord` / `IUpdateKnowledgeData` (`domain/knowledge.types.ts`), mapper (`data/knowledge.mapper.ts:53-70`) and update spread (`data/knowledge.gateway.ts:166-177`)
- [X] T045 [P] [US5] Extend `api/src/slices/reins/knowledge/knowledgeAdmin.tool.spec.ts`: `set_knowledge_reader_access` is listed for the operator only, refuses without `confirm` and calls nothing, updates on `confirm` and returns `{ id, name, readerAccess }`; `get_knowledge` result includes `readerAccess`
- [X] T046 [US5] Add `set_knowledge_reader_access` to `api/src/slices/reins/knowledge/knowledgeAdmin.tool.ts` per `contracts/api.md` §6 (`topic: ToolTopics.Knowledge`, `title`, `template`, `destructive: true`, `confirmed(args, …)`, `CONFIRM_SENTENCE`, `requireOperator`, same `service.update` the controller uses)
- [X] T047 [US5] Regenerate SDKs (as T027); add `readerAccess` to `IKnowledge` / `IUpdateKnowledgeInput` and the mapper in `admin/slices/reins/domain/knowledge.types.ts`, `admin/slices/reins/data/knowledge.mapper.ts`
- [X] T048 [US5] Add the toggle "Readers may open cited documents" with a one-line explanation to the Details card in `admin/slices/reins/components/knowledge/overview/Provider.vue` (:198-236); include it in `dirty` (:128-135) and `save()` (:137-154) → `store.update(id, { readerAccess })`
- [X] T049 [US5] Gates: api jest for `reins/knowledge`, `cd admin && npx nuxt typecheck`; quickstart §5.1, §5.4

**Checkpoint**: the policy exists and is editable; no document opens yet.

---

## Phase 5: User Story 2 — Tell our sources from outside ones, and open them (Priority: P2)

**Goal**: web entries open in a new tab; knowledge entries open the document only when the base is `open` and only for the reader it was cited to; the list says which base when several are involved.

**Independent Test**: quickstart §2 and §5.2–5.3.

- [X] T050 [P] [US2] Add `sources?()` to the three runtime web tools (files registered in `runtime:src/slices/agent/tool/data/tool.gateway.ts:44-82`): `web_search` → one `web` entry per `{title,url}`; `web_fetch` and `browser` → `{ kind:'web', url, title:null }` when the result has no `error`; cover in `runtime:src/slices/runtime/loop/domain/sources.spec.ts`
- [X] T051 [P] [US2] Write `api/src/slices/reins/source/domain/sourceAccess.service.spec.ts`: `openCited({ agentId, messageId, n, requester })` → 404 when no row or `row.clientId !== requester.clientId` (unless admin), 404 when `kind!=='knowledge'` or `sourceId===null`, 403 `READER_ACCESS_CLOSED` when the base is `closed` and the requester is not admin, otherwise the `readContent` stream; the policy is read on every call
- [X] T052 [US2] Implement `api/src/slices/reins/source/domain/sourceAccess.service.ts` so T051 passes, using `ChatSourceService.isCitedTo` (chat slice export), `IKnowledgeGateway.findExistingByIds` and `SourceService.readContent`; export from `api/src/slices/reins/source/source.module.ts`
- [X] T053 [US2] Add `GET :agentId/message/:messageId/source/:n/content` to `api/src/slices/bridle/bridle.controller.ts` under `BridleChatAuthGuard`, modelled on the attachment download route (:541-575): `disposition` query, `Content-Disposition` + exposed header, `pipeline` the stream; import `SourceModule` into `bridle.module.ts`
- [X] T054 [US2] Extend `api/src/slices/bridle/bridle.controller.spec.ts`: console user opens own cited document when `open`; share visitor the same with `X-Share-*` headers; other user → 404; `closed` → 403; admin → 200 regardless
- [X] T055 [P] [US2] App: in `Sources.vue` (T035) render web entries as `<a target="_blank" rel="noopener">` with title or readable host+path; knowledge entries as a button when `canOpen` (→ `store.openSource(messageId, n)` fetching the route as a blob with the bridle auth headers from `app/slices/bridle/data/bridle.gateway.ts:43-61`, open in a new tab or download by `Content-Disposition`), plain text with `$t('chat.source_locked')` tooltip otherwise; show `knowledgeName` as a suffix when the list has more than one distinct base
- [X] T056 [P] [US2] Admin: same in `admin/slices/bridle/components/bridle/Sources.vue`, fetching through the admin `apiClient` (always `canOpen` for knowledge since admin is exempt, but respect `canOpen=false` for a deleted source)
- [X] T057 [P] [US2] i18n keys in `app/slices/bridle/i18n/locales/en.json`: `source_locked` "Not available to open", `source_gone` "This document is no longer in the knowledge base"; `bun run i18n:sync`
- [X] T058 [US2] Gates (api jest `bridle`, `reins/source`; consoles typecheck + `bun test slices`; runtime `bun test`); quickstart §2, §5.2, §5.3 including the two `curl` checks (403, 404)

**Checkpoint**: two kinds, distinguishable, external opens, internal opens only behind the switch and only for its reader.

---

## Phase 6: User Story 3 — Hide the sources (Priority: P2)

**Goal**: one control per message hides and shows its list; chips stay; a chip click on a hidden list opens it.

**Independent Test**: quickstart §3.

- [X] T059 [P] [US3] App `Sources.vue` (T035): `hidden` ref (component state, default `false`), toggle `<button :aria-expanded>` with `$t('chat.sources_hide')` / `$t('chat.sources_show')` and an eye icon; `reveal(n)` sets `hidden=false` first; keyboard operable (native button)
- [X] T060 [P] [US3] Admin `Sources.vue` (T040): same, English labels "Hide sources" / "Show sources"
- [X] T061 [P] [US3] i18n keys `sources_hide` "Hide sources", `sources_show` "Show sources" in `app/slices/bridle/i18n/locales/en.json`; `bun run i18n:sync`
- [ ] T062 [US3] Quickstart §3 in both consoles and the share page

**Checkpoint**: lists can be put away per message.

---

## Phase 7: User Story 4 — Say whether one of our sources helped (Priority: P3)

**Goal**: like/dislike on knowledge entries only, optimistic with rollback, remembered per reader, stored on the knowledge source.

**Independent Test**: quickstart §4.

- [X] T063 [P] [US4] Write `api/src/slices/reins/source/domain/sourceRating.service.spec.ts`: `rate({ agentId, messageId, n, requester, rating })` requires `isCitedTo`, `kind==='knowledge'`, `sourceId!==null` (410 `SOURCE_GONE`), upserts on `(sourceId, messageId, authorId)`; `unrate` deletes and is idempotent; `mine(messageIds, authorId)` returns `{ [messageId+n]: rating }`
- [X] T064 [US4] Implement `api/src/slices/reins/source/data/sourceRating.gateway.ts` and `domain/sourceRating.service.ts` so T063 passes; export from `source.module.ts`; `ChatSourceService.forMessages` (T021) now fills `myRating` from it
- [X] T065 [US4] Add `PUT` and `DELETE :agentId/message/:messageId/source/:n/rating` to `api/src/slices/bridle/bridle.controller.ts` under `BridleChatAuthGuard` with `SourceRatingDto { rating: @IsIn([1,-1]) }` in `api/src/slices/bridle/dtos/sourceRating.dto.ts`; `authorId = requester.clientId`; spec cases in `bridle.controller.spec.ts`: own citation ok, other reader 404, web entry 404, deleted source 410, DELETE 204 twice
- [X] T066 [US4] Regenerate SDKs (as T027)
- [X] T067 [P] [US4] App store `app/slices/bridle/stores/bridle.ts`: `rateSource(conv, messageId, n, rating | null)` — optimistic `patch` of `message.sources[n-1].myRating` with rollback and a toast via the existing error path on failure; gateway methods `rateSource` / `unrateSource` in `app/slices/bridle/data/bridle.gateway.ts` (bridle auth headers so share visitors work)
- [X] T068 [P] [US4] Admin store `admin/slices/bridle/stores/bridle.ts`: the same action against the admin `apiClient`
- [X] T069 [US4] Both `Sources.vue`: like/dislike buttons on `kind==='knowledge'` entries only, pressed state from `myRating`, same click → withdraw, other → flip (toggle logic as `admin/slices/chat/composables/useChatFeedback.ts:17-26`); disabled with `source_gone` tooltip when `canOpen===false` because the source is gone; nothing on web entries; no bookmark
- [X] T070 [P] [US4] i18n keys `source_helpful` "This source helped", `source_not_helpful` "This source did not help", `source_rating_failed` "Couldn't save your rating" in `app/slices/bridle/i18n/locales/en.json`; `bun run i18n:sync`
- [X] T071 [US4] History views: `myRating` arrives via `forMessages` (T026); make the chat-history bubbles (T042) call the same rate action through the chat stores (`app/slices/chat/stores/chat.ts`, `admin/slices/chat/stores/chat.ts`) using the bridle routes with the session's `agentId`
- [ ] T072 [US4] Gates + quickstart §4 (including the API-down rollback and the share-visitor rating)

**Checkpoint**: ratings land on the knowledge source and survive reload.

---

## Phase 8: User Story 6 — See which sources earn their place (Priority: P3)

**Goal**: cited / likes / dislikes per source in the knowledge console, sortable, and from the Ranch agent.

**Independent Test**: quickstart §6.

- [X] T073 [P] [US6] `FilterSourcesDto` gains `sort?: 'createdAt'|'cited'|'likes'|'dislikes'` and `order?: 'asc'|'desc'` (`api/src/slices/reins/source/dtos/filterSources.dto.ts`); `SourceDto` gains `cited`, `likes`, `dislikes` (`dtos/source.dto.ts`); `ISourceData` / `ISourceFilter` in `domain/source.types.ts`
- [X] T074 [US6] In `api/src/slices/reins/source/data/source.gateway.ts` `findPage` (~L251): select `_count: { citations: true }` and the two filtered rating counts (`ratings` where `rating=1` / `-1` via `_count` with `where`, or two grouped queries merged by id), map to the three integers, `orderBy` per `sort`/`order` (default `createdAt asc`); jest cases in `api/src/slices/reins/source/data/source.gateway.spec.ts` (or the existing source spec): zero when none, sort by each column, deleted conversation leaves counts, deleted source removes them
- [X] T075 [P] [US6] Extend `api/src/slices/reins/source/source.tool.spec.ts`: `list_knowledge_sources` accepts `sort`/`order` and rows include the three counts
- [X] T076 [US6] Add `sort`/`order` params and pass-through to `list_knowledge_sources` in `api/src/slices/reins/source/source.tool.ts` (:95); description mentions "which sources are cited most / rated worst"
- [X] T077 [US6] Regenerate SDKs (as T027); add `cited`, `likes`, `dislikes` to `ISource`, `sort`/`order` to `ISourceFilter`, mapper `toSource` and `listSources` in `admin/slices/reins/{domain/knowledge.types.ts,data/knowledge.mapper.ts,data/knowledge.gateway.ts,stores/knowledge.ts}`
- [X] T078 [US6] Add columns *Cited*, *Likes*, *Dislikes* (zero shown as `0`) and clickable sortable headers (state refs beside `search`/`status`/`type`, :67-79; default order unchanged) to `admin/slices/reins/components/knowledge/sources/Provider.vue` (:385-401 headers, :405 rows)
- [ ] T079 [US6] Gates (api jest `reins/source`, admin typecheck); quickstart §6 including the Rancher question

**Checkpoint**: the numbers the ratings were collected for are visible.

---

## Phase 9: Polish & cross-cutting

- [X] T080 [P] Strip markers in the sync reply: `stripMarkers` equivalent in `api/src/slices/bridle/domain/bridleSync.service.ts` (~L105-111) before returning `text`; jest case in its spec (FR-036)
- [ ] T081 [P] R13 verification: run one `query_knowledge` against a dev base with an indexed document and record the raw `answer` in `contracts/sources.md` §2 as an appendix; if it carries `[1]`-style markers or a "References" footer, strip them in `knowledge.tool.ts` (T019) with a spec case, so the model does not copy them next to `[^n]`
- [ ] T082 [P] Compatibility pass (quickstart §8): old client bundle vs new runtime, new client vs old runtime (`origin/main` runtime), new runtime vs old hub — note results in `quickstart.md`
- [ ] T083 [P] Agent-tools doc check against `docs/agent-tools.md` "Review checklist": `set_knowledge_reader_access` and `list_knowledge_sources` visible in the Rancher chat Tools panel under *Knowledge*; no secret in any result
- [X] T084 [P] Update `docs/state.md`? — no: nothing new to teach. Update `README.md` chat section with one paragraph on sources and the `sources` capability; add the `sources` frame to the Bridle SDK/embed notes if `docs/` or the embed README lists capabilities (grep `'thinking'` in `docs/` and `app/public`)
- [X] T085 Full gate run on a clean tree (both repos) exactly as quickstart §0; fix what fails
- [X] T086 Runtime PR into `main` of `CleanSlice/runtime`: `feat(runtime): cite consulted sources — registry, [^n] validation, `sources` event (CLEAN-138)`; link on CLEAN-138; note it is inert without the client capability
- [X] T087 Ranch PR into `main`: `feat: chat sources — citations, source list, reader access policy, source ratings (CLEAN-138)`, body with the twin-console statement (admin+app `bridle` and `chat` changed; share page reuses app bridle; `reins` admin-only), the gate commands run, the debt note (unguarded `reins` controllers; admin `fetchTranscriptPage` drops `proposals`), and the PR URL on the ticket; move CLEAN-138 to **In Testing** (transition 51)
- [X] T088 Follow-up tickets in CLEAN, linked from CLEAN-138: `[API] Guard the reins knowledge controllers`, `[ADMIN] fetchTranscriptPage drops proposals`, `[APP] message-level like/dislike in the live chat`

---

## Dependencies & execution order

```
Phase 1 (T001–T007) ──► Phase 2 (T008–T024) ──► US1 (T025–T043) ──► US5 (T044–T049) ──► US2 (T050–T058)
                                                      │                                    │
                                                      ├──► US3 (T059–T062)                 │
                                                      └──► US4 (T063–T072) ──► US6 (T073–T079)
                                                                                           │
                                                                                 Polish (T080–T088)
```

- **US1 first**: it is the MVP and every other story renders inside its `Sources.vue`.
- **US5 before US2**: documents open only behind the policy (spec Story 5 rationale).
- **US3** depends only on US1. **US4** depends on US1 (and shares `isCitedTo` with US2 but not US2's routes). **US6** needs US4's ratings table to have something to count, but its API/console work can start after Phase 1.
- Runtime work (T001–T002, T008–T017, T050) is a separate PR and can proceed in parallel with all ranch phases from Phase 2 on; the runtime PR merges first.

## Parallel opportunities

- Phase 1: T002–T006 together (five files, two repos).
- Phase 2: the runtime block (T008–T017) and the ranch block (T018–T024) are independent; inside the runtime block T014 and T015 run beside T011–T013.
- US1: T028, T029, T031, T032, T034, T037 (app) ‖ T038, T039 (admin) ‖ T041 (chat types) — then T030/T033/T035/T036 (app) ‖ T040 (admin) ‖ T042.
- US2: T050 (runtime) ‖ T051–T054 (api) ‖ T055–T057 (consoles, against mocked `canOpen`).
- US4: T063–T065 (api) ‖ T067/T068 (stores) ‖ T070 (i18n).
- Polish: T080–T084 all at once.

## Implementation strategy

1. **MVP = Phase 1 + Phase 2 + US1** (T001–T043): a reader sees what an answer is based on, in every place a conversation is drawn. Ship the runtime PR as soon as Phase 2's runtime block is green — it is inert until a client advertises `sources`.
2. **Increment 2 = US5 + US2 + US3**: the policy, opening documents, hiding.
3. **Increment 3 = US4 + US6**: ratings and the numbers they feed.
4. Polish, gates, PRs, ticket to In Testing.

Each increment ends with its quickstart section walked in a browser and its gate commands recorded for the PR body (constitution quality gate 2).
