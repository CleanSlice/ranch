# Contract: Sources — tool result, runtime ↔ hub event, hub ↔ browser frame

**Feature**: [../spec.md](../spec.md) · **Decisions**: [../research.md](../research.md) R2, R5

One shape travels the whole way; each hop adds what only it knows.

## 1. `ISource` — the shape

```ts
type ISource =
  | { kind: 'knowledge'; id: string; name: string; knowledgeId: string; knowledgeName: string | null }
  | { kind: 'web'; url: string; title: string | null };
```

- `id` is the Ranch `Source.id`. `name` is `Source.name` as it was at lookup time.
- `url` must be `http(s)`; anything else is dropped by the first consumer that
  sees it (runtime extractor, then hub validator, then client renderer).
- No descriptions, excerpts, scores, storage paths or internal endpoints. A
  source entry is what a reader may see (FR-035).

## 2. Tool result — `sources` key (any tool, any server)

A tool result that consulted sources carries a top-level array:

```jsonc
{
  "answer": "…",
  "knowledge_id": "k1",
  "knowledge_name": "Legal",
  "references": [ /* unchanged, Ranch-internal */ ],
  "sources": [
    { "kind": "knowledge", "id": "src-1", "name": "Contract 2025.pdf", "knowledgeId": "k1", "knowledgeName": "Legal" }
  ]
}
```

- `query_knowledge` (Ranch) emits it: one entry per distinct `sourceId`, in
  reference order; references with `sourceId: null` are skipped and logged.
  The fan-out form `{ results: [...] }` carries `sources` on each result; the
  runtime extractor walks `results[]` too.
- Runtime built-ins emit it through `Tool.sources?(params, result)`:
  - `web_search` → one `web` entry per result (`title`, `url`);
  - `web_fetch`, `browser` → one `web` entry `{ url, title: null }` when the
    call succeeded (no `error`).
- MCP results: the runtime parses each `content[].text` that is JSON and reads
  `sources` (and `results[].sources`). Non-JSON text is ignored.
- Dedup key: knowledge `id`; web normalised `url` (lower-case scheme and host,
  fragment removed, trailing slash kept as given).

### What the model is shown

The runtime appends to the serialised tool result, after the JSON, one block:

```
Sources you may cite: [^3] «Contract 2025.pdf» (knowledge: Legal) · [^4] https://example.com/… (web)
```

Numbers are the turn registry's and stable within the turn. The system prompt
section `# Citing sources` (present only when the client advertises the
`sources` capability) tells the model to use exactly these, after the sentence,
and never to write its own list.

## 3. Capability — client → hub → runtime

Clients that can draw sources add `'sources'` to the `capabilities` list they
send at connect (`auth.capabilities`), next to `streaming`, `images`, `files`,
`thinking`, `proposals`. The hub forwards the list on every inbound message as
today; the runtime gates the prompt section, the per-result block and the
`sources` event on it. Without it: no instruction, markers stripped from
outgoing text, no event.

## 4. Runtime → hub event — `sources`

Emitted once per bubble, after `stream_end` (streamed) or `message`
(non-streamed) for that `messageId`, and only when the bubble cites at least
one source.

```ts
socket.emit('sources', {
  type: 'sources',
  clientId: string,     // recipient, as on `message`
  messageId: string,    // the bubble being annotated
  text: string,         // corrected bubble text: unknown markers removed, survivors renumbered 1..k
  sources: ISource[],   // in citation order; index + 1 === the number in `text`
  ts: number,
});
```

- Numbers in `text` are dense and start at 1 for every bubble.
- A bubble that cites nothing gets no event; its text is unchanged (FR-009).
- Hub behaviour on receipt: validate (shape, `https?` urls, `sources.length ≤ 50`),
  write `ChatMessageSource` rows (upsert on `(messageId, n)`), then relay §5.
  An invalid event is logged and dropped; the bubble stays as streamed.
- An older hub ignores the event name. An older runtime never emits it.

## 5. Hub → browser frame — `sources`

```ts
{
  type: 'sources',
  messageId: string,
  text: string,
  sources: Array<{
    n: number;                    // 1-based, dense
    kind: 'knowledge' | 'web';
    name: string;                 // Source.name, or page title / readable address
    url?: string;                 // web only
    knowledgeName?: string | null;
    canOpen: boolean;             // knowledge: policy open AND source exists; web: always true (url validated)
    myRating?: 1 | -1;            // knowledge only; the recipient's own rating
  }>,
  ts: number,
}
```

- `id`, `knowledgeId` and any storage detail are **not** forwarded; the client
  addresses a source by `(messageId, n)`.
- `canOpen` is computed when the frame is relayed and again whenever history is
  served; it is never stored (FR-016c).
- Same object appears as `sources` on `TranscriptMessageDto` and
  `ChatMessageDto` entries (history), so one component renders both.

## 6. Non-capable channels

Telegram, Slack, the sync HTTP reply and any client without the capability get
the text with every `[^n]` marker removed and no list (FR-036). The runtime
does the stripping; the hub's sync path strips again defensively.
