# Data Model: Sources in Chat Answers

**Feature**: [spec.md](./spec.md) · **Decisions**: [research.md](./research.md)

Three stores hold a piece of this feature: the runtime's session transcript,
the Ranch database (two slices), and the browser's Pinia store. Each entity is
listed once, under the store that owns it.

## Ranch database

### `Knowledge` (existing, `reins/knowledge`) — one new column

| Field | Type | Notes |
|---|---|---|
| `readerAccess` | `String @default("closed")` | `closed` \| `open`. Whether readers of an agent's answers may open and download documents of this base that were cited to them (FR-016a). Never per source. |

- Migration: add column with default; every existing row becomes `closed`
  (spec Story 5 scenario 1).
- Exposed on `KnowledgeDto` / `IKnowledgeRecord`, editable through
  `UpdateKnowledgeDto.readerAccess` (same path as `name`/`description`) and
  through the `update_knowledge` / `set_knowledge_reader_access` tools.
- Validation: enum of exactly two values; anything else is a 400.

### `ChatMessageSource` (new, `chat`) — a source as cited by one bubble

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `agentId` | `String` | the agent that answered |
| `clientId` | `String` | the Bridle identity the answer was sent to (`admin`, console `sub`, visitor id). Who may read this conversation. |
| `sessionKey` | `String` | `bridle:<clientId>` — joins to `ChatSession.sessionKey` when the index row exists; no FK (the index row may arrive later via sync). |
| `messageId` | `String` | the bubble's wire `messageId` |
| `n` | `Int` | the citation number inside that bubble, 1-based, dense |
| `kind` | `String` | `knowledge` \| `web` |
| `sourceId` | `String?` FK → `Source`, `onDelete: SetNull` | knowledge only. Null after the source is deleted — the row stays, the name stays (FR-017). |
| `knowledgeId` | `String?` | knowledge only; kept as a plain column so the row survives the base being deleted |
| `knowledgeName` | `String?` | as it was when cited; shown when more than one base is involved (FR-013) |
| `name` | `String` | source name (knowledge) or page title / readable address (web) |
| `url` | `String?` | web only; `https?` only (FR-015), validated on write |
| `createdAt` | `DateTime @default(now())` | |

- `@@unique([messageId, n])` — the natural key the client uses for opening and
  rating.
- `@@index([sourceId])` for counts; `@@index([agentId, sessionKey])` for the
  history overlay; `@@index([clientId])`.
- Written by the hub on each `sources` frame, before relaying (R7). Idempotent
  on the unique key: a duplicate frame (reconnect replay) upserts.
- Deleted with nothing: a conversation removed from the index does not remove
  citation rows (FR-032), they are the audit of what was cited.

### `SourceRating` (new, `reins/source`) — one person's verdict on one citation

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `sourceId` | `String` FK → `Source`, `onDelete: Cascade` | the knowledge source rated (FR-026, FR-032 "removing a source removes its numbers") |
| `messageId` | `String` | the bubble the rating was given under (FR-022: one per source per answer) |
| `authorId` | `String` | same identity as `ChatFeedback.authorId` |
| `rating` | `Int` | `1` \| `-1` |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | flips keep the row |

- `@@unique([sourceId, messageId, authorId])`.
- Withdrawing a rating deletes the row (FR-031: not counted).
- Precondition on write: a `ChatMessageSource` row `(messageId, n)` with
  `kind: knowledge`, `sourceId = :sourceId` exists and its `clientId` is the
  requester's (or requester is Owner/Admin). External sources cannot be rated
  (FR-021): there is no `sourceId` to rate.

### Derived numbers (no columns)

| Shown as | Computed as |
|---|---|
| cited | `count(ChatMessageSource where sourceId = s.id)` |
| likes | `count(SourceRating where sourceId = s.id and rating = 1)` |
| dislikes | `count(SourceRating where sourceId = s.id and rating = -1)` |

Prisma relation counts on `Source` (`_count.citations`, filtered rating
counts), sortable server-side. `SourceDto` gains `cited`, `likes`, `dislikes`
(integers, zero when none).

### `ChatFeedback` (existing) — unchanged

Message-level rating stays as it is (spec Assumptions).

## Runtime transcript (JSONL)

### `assistant` event — one new display-only key

```jsonc
{
  "id": "…", "type": "assistant", "ts": 1760000000000,
  "data": {
    "text": "…corrected full turn text…",
    "messages": [{ "id": "<messageId>", "text": "…corrected bubble text…", "ts": 0 }],
    "sources": [
      { "messageId": "<messageId>", "sources": [ /* ISource[] in citation order */ ] }
    ]
  }
}
```

- `ISource` is the wire shape from [contracts/sources.md](./contracts/sources.md).
- Prompt builders keep reading `data.text` only; `sources` is never shown to
  the model (R6).
- Survives compaction only inside the last 20 events; Ranch does not rely on
  it (R7).

### Per-turn registry (in memory, `LoopService.run`)

| Field | Notes |
|---|---|
| `entries: ISource[]` | index + 1 is the number handed to the model |
| key for dedup | knowledge: `id`; web: normalised `url` (scheme+host lowercased, fragment dropped) |
| `numberOf(source)` | returns the existing number or appends |

Lives for one `run()`; nothing is persisted from it except what a bubble cites.

## Browser (Pinia, both consoles)

### `IBridleMessage` (existing, twin) — one new optional field

```ts
sources?: IBridleSource[]   // present once the `sources` frame (live) or the
                            // transcript (history) delivered them; absent = none
```

```ts
interface IBridleSource {
  n: number;                   // citation number, 1-based, dense
  kind: 'knowledge' | 'web';
  name: string;
  url?: string;                // web only
  knowledgeName?: string | null;
  canOpen: boolean;            // knowledge: policy open AND source still exists; web: url is https?
  myRating?: 1 | -1;           // knowledge only; the viewer's own verdict
}
```

- Patched into the existing record by `messageId` (Constitution IV); the
  `sources` frame also patches `text`.
- `myRating` changes optimistically through the store's `patch()` with a
  rollback (docs/state.md rule 5).
- Persisted to the browser's stored copy like `attachments` (not session-only):
  a reload without a server transcript still shows the list.
- The hide/show state is **component state**, not stored (spec Assumptions:
  per answer, per view).

### `IChatMessage` (existing, `chat` slice history views, twin) — same field

The history mappers copy `sources` from `ChatMessageDto` / `TranscriptMessageDto`
unchanged; the chat-detail bubble renders the same `Sources` component.

## State transitions

**Citation (per bubble)**: `model text with [^k]` → *validate* (unknown `k`
dropped) → *renumber* (dense, first-appearance order) → `sources` frame →
`ChatMessageSource` rows → relayed → bubble patched. No later transition; rows
are immutable except `sourceId → null` on source deletion.

**Rating**: `none` → `liked` / `disliked` (create) → the other (update) →
`none` (delete). Each step is one request; the client applies it first and
rolls back on failure (FR-023).

**Reader access**: `closed` ⇄ `open`, by a knowledge manager or the operator
tool with `confirm`. Read at request time by the document route and when
computing `canOpen` for frames and history; nothing is stamped on rows.
