# Research: Sources in Chat Answers

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Inventory**: [analysis.md](./analysis.md)

Each entry answers one question the plan could not leave open. Facts come from
ranch `origin/main` at `02c1154b` and runtime `origin/main` at `f2e0048`
(2026-10-07); file references are to those trees.

---

## R1. Who owns the registry of consulted sources — runtime or hub

**Decision**: The **runtime** builds a per-turn registry from the raw tool
results and is the only thing that numbers, validates and strips citation
markers. The **hub** owns knowledge identity (names, policy, counters,
ratings) and never parses text.

**Rationale**: Only the runtime sees every tool result: `web_search`,
`web_fetch` and `browser` never pass through the hub, and the hub sees a
knowledge lookup only as an MCP call whose answer the model may or may not
use. The loop already has one place where every `(call, raw result)` pair is
in hand before the context-budget cap is applied
(`loop.service.ts:396-413`, between `tool.execute` and `capPayload`), so a
registry built there cannot lose entries to truncation (analysis §"The model
may not see every source"). Conversely, the hub is the only side that knows
what a `sourceId` is, whether its base is open to readers, and who is reading.

**Alternatives considered**:
- *Hub parses `[^n]` out of relayed text and maps them to the last
  `query_knowledge` result.* Rejected: it never sees web results, and it would
  have to guess which lookup a marker refers to.
- *Model cites by raw identifier (`[^src:…]`).* Rejected: long opaque tokens
  cost tokens and are mis-copied; a small integer the runtime handed out is
  what models reliably reproduce.

---

## R2. How a tool result declares its sources

**Decision**: A tool result may carry a top-level **`sources` array** in one
shape, regardless of the tool:

```ts
{ kind: 'knowledge', id: string, name: string, knowledgeId: string, knowledgeName: string | null }
{ kind: 'web',       url: string, title: string | null }
```

- Ranch's `query_knowledge` adds `sources` to its result, derived from the
  `references` it already computes (`knowledge.service.ts:403-453`): one entry
  per distinct `sourceId`, references with `sourceId: null` skipped (they are a
  defect to log, not to cite).
- Runtime built-ins add it through a new optional hook on `Tool`,
  `sources?(params, result): ISource[]`, a sibling of `stepLabel`
  (`tool.types.ts:84`): `web_search` maps `{title,url}`; `web_fetch` and
  `browser` return `{ url, title: null }`.
- MCP results arrive as `[{type:'text', text:'<json>'}]` (`mcp.gateway.ts:465`),
  so the extractor parses `content[].text` as JSON and reads `sources` from it.
  Any MCP tool from any server that follows the shape is picked up; nothing is
  keyed on the tool's name, which carries an unknown server prefix
  (`<cfg.name>__query_knowledge`).

**Rationale**: One contract, discoverable from the result itself, lets Ranch
and the runtime evolve separately (Constitution: "an older runtime paired with
a newer platform simply produces answers without sources"). It also keeps the
model-facing text free of a second, tool-specific format.

**Alternatives considered**:
- *Runtime parses `references[].sourceId` directly.* Rejected: couples the
  runtime to one Ranch DTO; a rename on one side silently kills citations.
- *`structuredContent` on the MCP result.* Rejected for now: the runtime drops
  it today (`mcp.gateway.ts:465`) and the serialised `content` is what the
  model reads anyway; the same `sources` key works in both places if that
  changes later.

---

## R3. How the model is told to cite, and when

**Decision**: Citing is **opt-in per client**, through a new `sources` entry in
the client's `capabilities` list (the same list that already gates `thinking`:
`runtime.service.ts:110-112`). When present:

1. The system prompt gains a short `# Citing sources` section via a new
   `citationsPrompt` option on `buildPrompt`
   (`agent.service.ts:60-137`; the opts type is duplicated in three places and
   all three change). The text says: cite with `[^n]` using only the numbers
   listed under *Sources you may cite* in tool results; place the marker after
   the sentence; never write your own list of sources; do not cite what you did
   not look up.
2. Each tool result that yielded sources is handed to the model with an
   appended line per source: `Sources you may cite: [^3] «Contract 2025.pdf»
   (knowledge: Legal) · [^4] «https://…» (web)`. Numbers are the registry's
   running index for the turn, so a source first seen in call 2 keeps its
   number in call 5.

When the capability is absent nothing is added, and any `[^n]` the model
produces anyway is **stripped** from the outgoing text (FR-036): the model has
no numbers to cite, so a marker there is noise.

**Rationale**: Capability gating is the runtime's existing mechanism for
"only clients that can draw it"; Telegram, Slack and older Bridle bundles
never advertise it and are untouched. Putting the numbers in the tool result
rather than the prompt is what makes a citation a lookup, not a guess
(Constitution VII).

**Alternatives considered**:
- *Always instruct, strip on non-capable channels.* Rejected: it spends tokens
  on every Telegram turn for nothing and tempts the model into citing on
  channels that cannot show it.
- *Instruction in the knowledge tool's description* (Ranch side). Rejected:
  web sources would have no instruction at all, and the description is shared
  by every client.

---

## R4. Numbering, validation and renumbering

**Decision**: Per **bubble**, right after it is complete:

- Markers whose number is not in the turn's registry are removed from the
  text (FR-005).
- Surviving markers are renumbered densely in order of first appearance
  (FR-003), and the bubble's `sources` array is emitted in that order.
- A marker inside a fenced or inline code span is left untouched and not
  counted (edge case "text that looks like a citation").
- The corrected text replaces the bubble text in the assistant event
  (`data.messages[].text`, and `data.text` for the whole turn), so history and
  live view agree.

**Rationale**: The loop learns a streamed bubble is finished when `streamSend`
returns its `messageId` (`loop.service.ts:295-318`), and `stream_end` has
already gone out by then. Validating per bubble at that moment, and sending the
result as its own event (R5), avoids the ordering problem the runtime survey
flagged, and gives multi-bubble turns a clean rule: a bubble numbers its own
citations. The registry stays per turn so numbers in tool results do not
collide across iterations.

**Alternatives considered**:
- *Validate once in `sendFinalResponse`.* Rejected: streamed bubbles are
  already on screen with raw markers; there would be no clean message id to
  patch.
- *Keep the model's numbers (no renumbering).* Rejected: a turn whose fifth
  lookup was the only one cited would show `[^5]` as its first chip.

---

## R5. How sources reach the browser

**Decision**: A new runtime → hub socket event, **`sources`**, emitted once per
bubble after validation, capability-gated like `thinking`:

```ts
{ type: 'sources', clientId, messageId, text, sources: ISource[], ts }
```

`text` is the corrected bubble text. The hub relays it to the client as a
frame of the same name; the browser store patches the bubble by `messageId`
(text and sources together) — Constitution IV, "pushes patch the same record".
`message`, `stream` and `stream_end` are unchanged.

Until the `sources` frame arrives, the client renders a `[^n]` marker as a
**neutral chip without a number** (FR-007: never raw); the frame turns chips
into numbers and adds the list. Bubbles that never receive a frame keep no
chips — markers left in the text are stripped at render time on the client as
a last line of defence.

**Rationale**: Mirrors the one capability-gated side channel that already
exists (`sendThinking`, `bridle.repository.ts:319-328`, with its module /
service / gateway plumbing), leaves the streaming path untouched, and gives
the hub one event to persist from (R7). Older hubs ignore an unknown event;
older clients never advertise the capability and never receive it.

**Alternatives considered**:
- *Extend `stream_end` / `message` payloads.* Rejected: the final text and
  the validated list are not known when `stream_end` fires (R4).
- *A `sources` wire part.* Rejected: parts describe content the model sent;
  this is metadata about a bubble, and unknown inbound parts are dropped
  silently on the runtime side, which hides mistakes.

---

## R6. What the runtime persists

**Decision**: The assistant event gains a display-only **`data.sources`** key
alongside `data.messages`, keyed per bubble (`{ messageId, sources }`), and
bubble texts are the corrected ones (R4). Prompt builders keep reading
`data.text` only (all five providers do: e.g. `claude.repository.ts:876`).

**Rationale**: Same pattern as `messages` and user `attachments` — the
convention is written down at `runtime.service.ts:194-196`. It keeps the
runtime's own transcript complete for any hub. It counts against the context
budget's byte estimate, which is why entries carry no descriptions or content,
only ids, names and URLs.

**Known limit**: compaction keeps only the last 20 events verbatim
(`compaction.service.ts:100-136`); older `data.sources` are summarised away.
Ranch does not depend on this key (R7).

---

## R7. What the hub persists, and what history reads

**Decision**: On every `sources` frame the hub writes one **`ChatMessageSource`**
row per entry (chat slice) and only then relays the frame; Ranch history
(transcript endpoints of both consoles and the share page) **overlays sources
from this table by `messageId`**, never from the runtime JSONL.

**Rationale**: Three spec requirements need a Ranch-side record anyway —
citation counts per knowledge source (FR-027), the "cited in a conversation
this reader can read" check behind opening a document (FR-016b), and survival
past runtime compaction (FR-010). One table serves all three. Writing before
relaying means the first frame a client sees already has a persisted twin, so
a rating sent a second later finds its row.

**Alternatives considered**:
- *Read `data.sources` from the JSONL in `TranscriptReaderService`.* Rejected
  as the primary path (compaction); kept out entirely to avoid two sources of
  truth that can disagree.

---

## R8. Where ratings live, and what identifies the rater

**Decision**: **`SourceRating`** in the `reins/source` slice: `(sourceId FK →
Source, cascade; messageId; authorId; rating ±1)`, unique per
`(sourceId, messageId, authorId)`. No relation to `ChatSession`, so deleting a
conversation leaves ratings in place (FR-032). `authorId` follows
`ChatFeedback`: the console login's id, `admin` for the admin console, the
visitor id for a shared link — the same identity the hub already derives
(`chatIdentity.ts:93`).

**Rationale**: The spec says a rating belongs to the knowledge source and
outlives the chat. `ChatFeedback` is the toggle/identity pattern to copy, not
the table to extend — it cascades from the session.

---

## R9. The viewing policy and the reader-facing document route

**Where the route lives**: `bridle.controller.ts` (`api/agent/:agentId/…`), the
one controller whose `BridleChatAuthGuard` already resolves all three reader
identities (console JWT, admin, share visitor). The `reins` controllers carry
no guards today — debt cited in plan.md, not extended to readers.

**Decision**: `Knowledge.readerAccess: 'closed' | 'open'`, default `closed`,
editable only through the knowledge update path the console already uses. A
new reader-facing route serves a cited document only when **all** hold:

1. the `ChatMessageSource` row `(messageId, n)` exists and is `kind: knowledge`;
2. the requester may read that conversation — the row's `clientId` equals the
   requester's identity, or the requester is Owner/Admin;
3. `Knowledge.readerAccess === 'open'` for the row's `knowledgeId` **at request
   time** (FR-016c: closing takes effect for links already handed out);
4. the `Source` row still exists (FR-017).

The route answers with the same content disposition logic the admin route uses
(`source.controller.ts:164`, `SourceContentQueryDto`). Frames and history carry
no URL for knowledge sources; the client builds the route from `(messageId, n)`
and the hub tells it `canOpen` per entry, computed at serve time from the
policy — so a toggle flips every list on the next load.

**Rationale**: The spec forbids opening a base to browsing or address-guessing;
keying the route on the citation, not the source, makes "cited in a chat you
can read" the primary key rather than an afterthought. Evaluating the policy
per request rather than stamping it on rows is what FR-016c asks for.

---

## R10. Counters in the knowledge console

**Decision**: No stored counters. `ChatMessageSource.sourceId` is a nullable FK
to `Source` with `onDelete: SetNull` (the row keeps `name` for FR-017), so the
source list reads `_count` of citations and the two rating counts through
Prisma relation counts and sorts on them server-side.

**Rationale**: Three derived numbers kept in sync by hand is the classic drift
bug; relation counts are exact by construction (FR-031: a withdrawn rating is a
deleted row, so it is simply not counted). Volumes here are thousands of rows
per base, not millions.

---

## R11. Agent tools (Constitution V)

**Decision**: Operator-audience changes in `reins`, next to the console
capabilities they mirror:

- **`set_knowledge_reader_access`** (new, `knowledgeAdmin.tool.ts`) —
  `{ id, access: "open"|"closed", confirm }`, `destructive: true` because it
  widens who may read documents; refuses without `confirm`
  (`confirmed()`), description ends with `CONFIRM_SENTENCE`.
- **`get_knowledge`** (existing) shows `readerAccess` through the DTO.
- **`list_knowledge_sources`** (existing, `source.tool.ts`) gains `sort` /
  `order` and returns `cited`, `likes`, `dislikes` — "a read tool returning
  what the screen shows" (docs/agent-tools.md) rather than a second stats tool.

No tool for rating, hiding or opening a source: those are things a reader does
inside a chat, not console capabilities — stated here so the gate is answered,
not waived.

**Alternatives considered**: a `reader_access` parameter on `update_knowledge`
— rejected because one tool would then need `confirm` for one of its fields
and not the others.

## R12. Rendering and the twin stylesheet

**Decision**: `renderMarkdown` (both consoles) gains a pre-pass that turns
`[^n]` outside code into `<sup class="chat-cite" data-n="n">n</sup>` (or the
neutral form while pending), `sup` and `data-n` join the DOMPurify allow-list,
and chip styling lands in `bridle/assets/chat-md.css` in both consoles,
byte-identical as today. The source list, hide/show control and rating buttons
are a new `Sources.vue` under the bubble in both `bridle` slices, with
`app` strings in `en.json` and `ru` generated (`docs/i18n.md`); `admin` stays
English.

**Rationale**: `.chat-md` rules live in exactly one file per console by
agreement (memory: "Ranch chat markdown twin stylesheet"); chips are markdown
styling, the list is a component.

---

## R13. Verify before building: what the retrieval service's answer carries

**Open check, not a decision**: LightRAG is asked with `include_references:
true` (`lightragHttp.client.ts:250`) and its `response` text may contain its
own `[1]`-style markers and a trailing references block, matching
`references[].reference_id`. Ranch currently passes `answer` through. If those
markers exist, `query_knowledge` must strip them (and any "References" footer)
from `answer` before adding `sources`, or the model will copy `[1]` next to our
`[^n]`. Task for Phase 2: run one query against a dev base, record the raw
shape in `contracts/`, and add the strip only if needed.
