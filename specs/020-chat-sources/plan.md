# Implementation Plan: Sources in Chat Answers

**Branch**: `feat/CLEAN-138-chat-sources` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md) | **Ticket**: [CLEAN-138](https://dreamvention.atlassian.net/browse/CLEAN-138)

**Input**: Feature specification from `specs/020-chat-sources/spec.md`; current-state inventory in [analysis.md](./analysis.md).

## Summary

An agent's answer gets numbered citation chips in the text and a list of the
sources behind them under the bubble; internal (knowledge) sources can be
liked or disliked and, when the base's keeper allows it, opened; the knowledge
console shows how often each source was cited and how it was rated.

Technically: the **runtime** builds a per-turn registry of consulted sources
from raw tool results (a `sources` key every source-bearing tool result
carries), tells the model which numbers it may cite — only for clients that
advertise a `sources` capability — then, per finished bubble, drops unknown
markers, renumbers the survivors densely and emits one new `sources` socket
event with the corrected text and the list. The **hub** records each cited
source as a row, relays the event, and overlays the same rows onto history;
ratings live on the knowledge source; a per-base `readerAccess` policy gates a
new, guarded, citation-keyed document route. Both consoles render chips and
the list from the same stylesheet and twin components. Decisions and their
reasons: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript throughout. Ranch `api/` NestJS 10 on Node (bun as runner), `admin/` and `app/` Nuxt 3 + Vue 3 + Pinia; runtime bun + TypeScript (`CleanSlice/runtime`, clone at `E:/code/dream/cleanslice/runtime`).

**Primary Dependencies**: Prisma 6 (per-slice `*.prisma` merged by `prisma-import`), Socket.IO (runtime ↔ hub ↔ browser), `marked` + DOMPurify for chat markdown, zod for `@Tool` parameters, MCP SDK for the hub's tool server, LightRAG HTTP for retrieval.

**Storage**: PostgreSQL via Prisma (one new column, two new tables); runtime session JSONL on the agent volume (one new display-only key); browser `localStorage` copy of app conversations (field rides along).

**Testing**: api — jest, run directly (`cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`; never `bun run test` beside a dev API); admin/app — `bun test slices` + `npx nuxt typecheck`; root — `bun test scripts` (includes the `chat-md.css` twin check) and `bun run locale:check`; runtime — `bun test`, `bunx tsc --noEmit -p tsconfig.json` (baseline noise in `bridleAttachments.spec.ts`).

**Target Platform**: Linux containers (api, runtime); browsers for both consoles and the share page.

**Project Type**: Web platform (API + two consoles) plus a separate runtime repo. Two PRs: ranch and runtime, each carrying `CLEAN-138`.

**Performance Goals**: No visible delay added to answers (SC-010): the registry is built from results already in hand, validation is a regex pass over one bubble, and the `sources` event follows `stream_end` by milliseconds. Source list and counters load with the existing paged source query (one query, relation counts).

**Constraints**: Backward compatible in every direction — old runtime / new hub, new runtime / old hub, old client bundles (no capability → no change). Nothing beyond name, kind, base name and web URL leaves the API for a source (FR-035). Markers never reach a reader raw (FR-007) — three lines of defence: runtime strips for non-capable clients, client renders unknown markers as neutral chips then strips leftovers.

**Scale/Scope**: Tens of sources per answer at most (hub caps an event at 50 entries); thousands of citation rows per knowledge base; ~25 files in ranch, ~12 in the runtime.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|---|---|---|
| I | The slice is the unit | ✅ | Slices touched are named below. Cross-slice needs go through public services: `bridle` (hub) calls `chat`'s `ChatSourceService` to record/overlay rows and `reins/source`'s `SourceRatingService` + `SourceService.readContent`; `chat` history calls the same two. No slice reads another's Prisma model. |
| II | Twin consoles (NON-NEGOTIABLE) | ✅ | `bridle` and `chat` change in **both** consoles: chips + `Sources` component + store patch in `admin/slices/bridle` and `app/slices/bridle`; `sources` on the history message type and bubble in `admin/slices/chat` and `app/slices/chat`. The share page reuses `app/slices/bridle` and needs nothing of its own. `reins` exists in `admin` only — the policy toggle and counters have no twin by construction. The PR states this in words. |
| III | Secrets stay behind `api/` | ✅ | No new credential. Source entries carry no storage URI (`Source.url` for files is an S3 URI and is never forwarded); documents stream through the API as today. |
| IV | One entity, one store | ✅ | `sources` is a field on the existing message record, patched by `messageId` from the `sources` frame; `myRating` changes via the store's `patch()` with rollback; hide/show is component state (not an entity). No parallel map of "fresher" sources. |
| V | Console is a window, chat is the hands | ✅ | New console capabilities and their tools: reader-access toggle → `set_knowledge_reader_access` (operator, `destructive: true`, `confirm`); counters + sort in the source list → `list_knowledge_sources` gains `sort` and returns `cited/likes/dislikes`; `get_knowledge` shows `readerAccess`. Rating, hiding and opening a source are reader actions inside a chat, not console capabilities — stated, not waived. |
| VI | English is the source | ✅ | New `app` strings in `app/slices/bridle/i18n/locales/en.json` and `app/slices/chat/...`, `ru` via `bun run i18n:sync`; `admin` English-only. Source names, titles and URLs are shown as received. |
| VII | A rule stays a rule | ✅ | Whether a marker is drawn is a lookup against the registry; numbering is a rule. The only model-made decision (where to place a citation) is bounded to numbers it was handed; no threshold, no classifier, no new semantic judgment is introduced by the platform. |
| — | Generated code is generated | ✅ | DTO changes → `cd api && bun run build` then `bun run build:api` in both consoles; no hand-written SDK types. |
| — | Tracker / surface marking | ✅ | CLEAN-138, `[ADMIN][APP]`; the ticket body names API and runtime work too. |

**Gate result (pre-research)**: pass. **Gate result (post-design)**: pass — see *Complexity Tracking* for one cited piece of debt that is not copied.

## Project Structure

### Documentation (this feature)

```text
specs/020-chat-sources/
├── spec.md              # requirements (clarified 2026-10-07)
├── analysis.md          # current-state inventory of ranch + runtime
├── plan.md              # this file
├── research.md          # R1–R13 decisions
├── data-model.md        # Knowledge.readerAccess, ChatMessageSource, SourceRating, JSONL key, browser types
├── quickstart.md        # end-to-end validation
├── contracts/
│   ├── sources.md       # ISource, tool-result key, capability, runtime event, browser frame
│   └── api.md           # REST routes, DTO additions, tool signatures
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code

**Runtime** (`CleanSlice/runtime`, separate PR; paths under `src/slices/`)

```text
agent/tool/domain/tool.types.ts                 # Tool.sources?(params, result): ISource[]
agent/tool/data/repositories/websearch/…        # web_search.sources → {title,url}
agent/tool/data/repositories/webfetch/…         # web_fetch.sources → {url}
agent/tool/data/repositories/browser/…          # browser.sources → {url}
runtime/loop/domain/sources.ts            (new) # registry, extractor (incl. MCP content JSON), validate+renumber, strip, "Sources you may cite" block
runtime/loop/domain/sources.spec.ts       (new)
runtime/loop/domain/loop.types.ts               # ISource, ILoopContext.citeSources, sendSources?
runtime/loop/domain/loop.service.ts             # registry in run(); capture in executeToolCalls before capPayload; per-bubble validate → sendSources; data.sources on assistant event; strip when !citeSources
runtime/loop/domain/loop.sources.spec.ts  (new) # makeLoop pattern from loop.bubbles.spec.ts
agent/agent/domain/agent.service.ts             # citationsPrompt opt → "# Citing sources" section (3 duplicated opts types)
agent/agent/agent.module.ts
runtime/runtime/domain/runtime.service.ts       # capabilities.includes('sources') → citeSources + prompt + sendSources closure
setup/channel/domain/channel.gateway.ts         # sendSources?(to, messageId, text, sources)
setup/channel/domain/channel.service.ts
setup/channel/channel.module.ts
setup/channel/data/repositories/bridle/bridle.repository.ts   # emit 'sources'
```

**Ranch** (this repo)

```text
api/src/slices/
├── bridle/
│   ├── domain/bridle.types.ts                  # IBridleOutgoingEvent 'sources'; IBridleSourceFrameEntry
│   ├── handlers/bridleAgentWs.handler.ts       # @SubscribeMessage('sources'): validate → ChatSourceService.record → relay
│   ├── domain/bridleSync.service.ts            # strip markers in the sync reply (FR-036)
│   ├── bridle.controller.ts                    # transcript: overlay sources; reader routes (content, rating) under BridleChatAuthGuard
│   └── dtos/transcript.dto.ts                  # sources on TranscriptMessageDto
├── chat/
│   ├── chatMessageSource.prisma          (new) # ChatMessageSource
│   ├── domain/chatSource.service.ts      (new) # record(frame) · forMessages(ids, viewer) → entries with canOpen/myRating
│   ├── data/chatSource.gateway.ts        (new)
│   ├── dtos/chatMessage.dto.ts                 # sources on ChatMessageDto
│   ├── chat.controller.ts / myChat.controller.ts   # overlay on GET messages
│   └── chat.module.ts
├── reins/knowledge/
│   ├── knowledge.prisma                        # readerAccess
│   ├── dtos/{knowledge,updateKnowledge}.dto.ts · domain/knowledge.types.ts · data/knowledge.{gateway,mapper}.ts
│   ├── knowledge.tool.ts                       # query_knowledge result gains `sources`; strip retrieval's own markers if R13 says so
│   └── knowledgeAdmin.tool.ts (+spec)          # set_knowledge_reader_access; get_knowledge shows readerAccess
├── reins/source/
│   ├── sourceRating.prisma               (new) # SourceRating
│   ├── domain/sourceRating.service.ts    (new) # rate/unrate with the citation precondition
│   ├── data/sourceRating.gateway.ts      (new)
│   ├── dtos/{source,filterSources}.dto.ts      # cited/likes/dislikes; sort
│   ├── data/source.gateway.ts                  # findPage: relation counts + orderBy
│   └── source.tool.ts (+spec)                  # list_knowledge_sources: sort + counters
└── (migration) api/prisma/migrations/2026MMDDhhmmss_chat_sources/

admin/slices/
├── bridle/stores/bridle.ts                     # 'sources' capability; socket.on('sources') → patch by messageId; transcript keeps sources
├── bridle/components/bridle/Message.vue        # <BridleSources> under the bubble
├── bridle/components/bridle/Sources.vue  (new) # list, hide/show, open, like/dislike
├── bridle/utils/markdown.ts                    # [^n] → <sup class="chat-cite">; allow sup/data-n
├── bridle/assets/chat-md.css                   # .chat-cite (byte-identical twin)
├── chat/{domain/chat.types.ts,data/chat.mapper.ts,components/chat/message/Bubble.vue}
└── reins/{domain/knowledge.types.ts,data/knowledge.{mapper,gateway}.ts,stores/knowledge.ts,
           components/knowledge/overview/Provider.vue (policy toggle),
           components/knowledge/sources/Provider.vue (3 columns, sort)}

app/slices/
├── bridle/data/bridle.gateway.ts               # CAPABILITIES += 'sources'; socket.on('sources')
├── bridle/data/bridle.mapper.ts                # toSources(frame); toTranscript keeps sources
├── bridle/domain/bridle.types.ts               # IBridleSource; IBridleMessage.sources
├── bridle/stores/bridle.ts                     # onSources (patch by id), recoverFromTranscript keeps sources, rate()/unrate() with rollback
├── bridle/components/bridle/chat/Message.vue   # <BridleChatSources>
├── bridle/components/bridle/chat/Sources.vue (new)
├── bridle/utils/markdown.ts · assets/chat-md.css
├── bridle/i18n/locales/en.json (+ generated ru.json)
└── chat/{domain/chat.types.ts,data/chat.mapper.ts,components/chat/message/Bubble.vue,i18n/locales/en.json}
```

**Structure Decision**: Every change lands in the slice that owns the concept
(Constitution I): the *citation* is a chat fact (`chat`), the *rating* and the
*policy* are knowledge facts (`reins`), the *wire* is the hub's (`bridle`). The
reader-facing routes sit in `bridle.controller.ts` because that is the only
controller that already authenticates all three reader identities (console
JWT, admin, share visitor) through `BridleChatAuthGuard` — the `reins`
controllers carry no guards today, which is cited as debt below and not
extended to readers.

## Complexity Tracking

| Item | Why it is here | Simpler alternative rejected because |
|---|---|---|
| A new `sources` socket event instead of a field on `stream_end` | The validated list and corrected text exist only after `stream_end` has gone out (R4/R5) | Holding `stream_end` until validation would delay every streamed answer's completion, and the final frame already drives "streaming: false" in both stores |
| Citation rows in the hub **and** `data.sources` in the runtime JSONL | Hub rows serve counts, the open-check and history past compaction; the JSONL key keeps the runtime's transcript complete for any hub (R6/R7) | Reading sources from the JSONL alone loses them at compaction; dropping the JSONL key makes the runtime's history depend on Ranch |
| Debt cited, not copied: `reins` controllers have no `@UseGuards` | Reader-facing document and rating routes are placed under `BridleChatAuthGuard` in `bridle.controller.ts`; the unguarded admin routes are out of scope for this ticket and noted on CLEAN-138 for a follow-up | Adding a guard to `reins` here would widen the PR into an auth change for the whole knowledge console |

## Phase 0 — Research

Done: [research.md](./research.md), R1–R13. R13 is a verification task carried
into Phase 2 (what the retrieval service's answer text contains).

## Phase 1 — Design

Done: [data-model.md](./data-model.md), [contracts/sources.md](./contracts/sources.md),
[contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md).

### Delivery order (for `/speckit-tasks`)

1. **Contract first, both repos**: `ISource`, the tool-result `sources` key in
   `query_knowledge`, the `sources` event — each side can ship alone.
2. **Runtime PR**: extractor + registry + validate/renumber + prompt + event +
   JSONL key, capability-gated. Deployed, it changes nothing until a client
   advertises `sources`.
3. **Ranch, data**: migration (column + two tables), `ChatSourceService`,
   `SourceRatingService`, counters + sort in the source query.
4. **Ranch, hub**: `sources` handler (record → relay), transcript and chat
   history overlay, reader routes, sync-reply strip.
5. **Ranch, consoles**: capability, store patch, chips + `Sources` component
   in both `bridle` slices, history bubbles in both `chat` slices, policy
   toggle and columns in `reins`, i18n.
6. **Agent tools + specs**, OpenAPI regen, twin checks, quickstart run.

### Twin-console statement (for the PR)

`admin` and `app` both change in `bridle` and `chat`; the share page is
`app/bridle` reused; `reins` is admin-only by design. `chat-md.css` stays
byte-identical (`bun test scripts`).
