# Current State: Where a Source Is Today, in Ranch and in the Runtime

**Feature**: [spec.md](./spec.md) · **Ticket**: [CLEAN-138](https://dreamvention.atlassian.net/browse/CLEAN-138)

**Read on**: 2026-10-05 — ranch `origin/main` at `02c1154b`, runtime `origin/main` at `f2e0048`.

This is the inventory the spec stands on: what already exists, where a source is
lost on the way to the reader, and what has to be added. It records facts and
the questions they raise for the plan; it does not choose a design.

## The path of an answer today

```
person ──▶ Bridle hub (ranch api) ──▶ runtime ──▶ model
                                        │  ▲
                                        │  └─ tool result (JSON as text)
                                        ▼
                             query_knowledge (ranch MCP tool) ──▶ LightRAG
                             web_search / web_fetch / browser (runtime tools)

model ──▶ runtime ──▶ `stream` / `stream_end` / `message` ──▶ hub ──▶ browser
                └──▶ session JSONL (S3) ──▶ ranch transcript reader ──▶ history
```

A source exists at exactly one point of this path — inside the tool result the
model reads — and nowhere after it.

## Ranch

### Knowledge already reports its sources

- `query_knowledge` (`api/src/slices/reins/knowledge/knowledge.tool.ts:101`) is
  the only way an agent reaches knowledge. It is callable by an agent runtime
  only, limited to the knowledge bases bound to that agent, and fans out over
  them.
- Each result is `{ knowledge_id, knowledge_name, answer, complete, references }`
  (`knowledge.service.ts:403`), and each reference is
  `{ referenceId, filePath, sourceId, sourceName }`
  (`knowledge.types.ts:128`). `resolveReference` (`knowledge.service.ts:69`)
  matches what LightRAG returns to a `Source` row by id, then name, then URL;
  an unmatched reference keeps `sourceId: null` on purpose.
- So the internal half of the feature has its data: **which knowledge sources an
  answer drew on is already known, by id and name, at the moment of the lookup.**
- `answer` is text LightRAG already generated. Whether that text carries
  LightRAG's own reference markers, and how they relate to `referenceId`, was
  not checked and decides how the model can be asked to cite.
- Granularity is the document. Nothing returns a passage, a page or a score.

### A knowledge source

- `Source` (`api/src/slices/reins/source/source.prisma`): `type` is
  `file | url | text`, plus `name`, optional `url`, `mimeType`, `knowledgeId`.
  No counters, no ratings.
- Its content is served from `GET knowledges/:knowledgeId/sources/:sourceId/content`
  (`source.controller.ts:164`) — a route of the knowledge console, used by the
  platform team. Nothing serves a source to a console user or a share visitor.
  **Decided 2026-10-07**: readers get the document itself, viewable and
  downloadable, behind a new per-knowledge-base viewing policy that is off by
  default (spec Story 5, FR-016–FR-016d). `Knowledge`
  (`api/src/slices/reins/knowledge/knowledge.prisma`) has no such setting today,
  and the content route checks only the platform login — a reader-facing route
  has to prove both the policy and "cited in a conversation this reader can
  read".
- The `reins` slice exists in `admin` only. The customer console has no
  knowledge screens.

### The chat knows nothing about sources

- Wire, hub → browser: an agent message is `{ type, text, parts, messageId, ts }`
  (`api/src/slices/bridle/data/bridle.gateway.ts`). Parts are text, image, file
  and ui.
- Browser: `IBridleMessage` (`app/slices/bridle/domain/bridle.types.ts:100`, and
  its twin in `admin`) has `id, role, text, ts, seq, delivery, attachments,
  streaming, cached, proposal`. No sources.
- History: `TranscriptReaderService.read`
  (`api/src/slices/agent/file/domain/transcriptReader.service.ts:159`) reads the
  runtime's JSONL and keeps, for an assistant event, either its `text` or its
  recorded `messages` bubbles (`{ id, text, ts }`). `TranscriptMessageDto` and
  `ChatMessageDto` carry `id, role, text, ts, attachments, agentText`.
- Rendering: `renderMarkdown` (`app/slices/bridle/utils/markdown.ts:16`, twin in
  `admin`) is `marked` + a DOMPurify allow-list. `[^1]` passes through as
  literal text today; `sup` is not on the allow-list. Styling lives in one
  `bridle/assets/chat-md.css` per console, kept byte-identical.

### Feedback exists for a message, not for a source

- `ChatFeedback` (`api/src/slices/chat/chat.prisma`): one row per
  `(sessionId, messageId, authorId)`, `rating` 1 or -1, `source` =
  `admin | app | telegram`. It hangs off `ChatSession` and is deleted with it.
- Shown in the conversation history views of both consoles
  (`admin/slices/chat/composables/useChatFeedback.ts`,
  `app/slices/chat/stores/chat.ts`). The live Bridle chat has no rating control.
- It is the pattern to follow for toggling and identity, but not the place to
  store source ratings: the spec needs them to outlive the conversation and be
  counted per knowledge source (FR-026, FR-032).

## Runtime

### No knowledge, no citations of its own

- No built-in knowledge tool, and no mention of citing, sources or footnotes in
  any prompt or post-processing (`src/slices/agent/tool/data/tool.gateway.ts:44`;
  system prompt sections in `agent.service.ts:60`). The final text goes out
  unchanged apart from the silent-reply check.
- Knowledge arrives as an MCP tool served by ranch, named
  `<server>__query_knowledge`. The runtime hands back the MCP `content` array
  as-is and drops `structuredContent` and `_meta`
  (`src/slices/setup/mcp/data/mcp.gateway.ts:463`). Every provider adapter then
  serialises the result to one JSON string for the model. **The references reach
  the model as text and the runtime never looks at them.**

### External lookups already carry an address

| Tool | Result | Title | Address |
|---|---|---|---|
| `web_search` | array of `{ title, url, description }` | yes | yes |
| `web_fetch` | `{ url, content, length, truncated }` | stripped, not returned | yes |
| `browser` | `{ url, text, length }` | no | yes |
| `http` | `{ status, body }` | no | only in the call |

### The way out has no slot for sources

- Events to the hub (`src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts:290-425`): `message`,
  `stream` (accumulated full text, every 100 ms), `stream_end`, `typing`,
  `thinking`, `debug` (admins only), `session_activity`. The three message
  events carry `{ clientId, text, parts, messageId, ts }` and nothing else.
- Tool calls and results are deliberately kept off the wire for visitors; only
  `thinking` step labels go out.
- One turn can produce several bubbles — one `messageId` per model iteration that
  had text.
- A capability list travels with every inbound message (`streaming`, `images`,
  `files`, `ui`, `thinking`) and already gates `thinking`. It is the existing
  way to turn a new event on only for a client that can draw it.

### The transcript can hold them, with one risk

- Session JSONL, one `Event` per line. An assistant event is
  `{ text, messages? }`, where `messages` is a display-only list of bubbles the
  prompt builders ignore (`loop.service.ts:473`). User events carry
  `attachments` the same way. An extra display-only key on the assistant event
  is an established pattern and would come back through the ranch transcript
  reader once that reader is taught to keep it.
- **Compaction rewrites the file**: past 60 events or 200 KB it becomes
  `[summary, last 20 events, …]` (`compaction.service.ts:140`). Anything stored
  only on an older assistant event is gone. How much history the consoles show
  after CLEAN-136 (archived session files) decides whether this matters for the
  spec's "sources survive a reload" (FR-010).

### The model may not see every source

- Tool results are capped before they reach the model — 16 000 characters, and
  arrays lose their tail first (`contextBudget.ts:27`); the copy on disk stays
  whole. A registry of consulted sources has to be built from the full result,
  not from what the model was shown, or long lookups will lose entries.

## What can be built on, what is missing

| Step | Exists | Missing |
|---|---|---|
| Knowing the internal sources of a lookup | `references` with `sourceId` and `sourceName` | passage-level detail (out of scope) |
| Knowing the external sources | `url` on every web tool, `title` on search | a title from fetch and browser |
| Asking the model to cite | sectioned system prompt, capability gating | the instruction itself; a numbering the model and the platform agree on |
| Checking a citation is real | every call and result pass one place in the loop | a per-turn registry of what was consulted |
| Carrying sources to the browser | stable `messageId`, capability gating | a field or event for sources |
| Keeping them in history | display-only keys on transcript events; ranch reader | the key, the reader mapping, survival of compaction |
| Drawing them | markdown renderer and one stylesheet per console | chips, the list, the hide control — in both consoles and the share page |
| Rating a source | message feedback as a pattern | a rating that belongs to the knowledge source |
| Statistics | the source list in the knowledge console | counters, sorting, and an agent tool for them |

## Questions the plan must answer

1. **Who numbers.** Does the model invent `[^n]` and the platform map them, or
   does the tool result hand the model ready identifiers to cite? The second is
   the only one where "a citation points at something consulted" (FR-005) is a
   lookup rather than a guess.
2. **Where sources are attached** when one turn is several bubbles: to the bubble
   that cites, or to the turn.
3. **Where the registry lives** — runtime (sees every tool) or hub (owns
   knowledge identity). Both repos change either way; the question is which one
   owns the rule.
4. **History beyond compaction** — whether sources are also kept on the ranch
   side, since ratings must be anyway.
5. **Messengers.** The citing instruction must be limited to clients that
   declare they can draw sources, or raw placeholders will appear in Telegram
   and Slack (FR-036).
6. **An old runtime with a new platform, and the reverse** — both must degrade
   to "an answer without sources".
