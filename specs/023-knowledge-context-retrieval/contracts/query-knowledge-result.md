# Contract: the `query_knowledge` tool result and description

**Feature**: [spec.md](../spec.md) | **Decisions**: research D5, D6, D8, D10

What the agent runtime receives from `query_knowledge`, and what the tool
tells the model about it. Parameters (`knowledge_id?`, `query`) do not
change; neither does the `@Tool` metadata (`topic: Knowledge`, title,
template).

## Result — one base

Compact JSON (`JSON.stringify(value)`), at most **12 000 characters**
(`TOOL_RESULT_BUDGET_CHARS`, derivation in research D6).

```json
{"knowledge_id":"knowledge-…","knowledge_name":"Mazda","complete":true,
 "passages":[
   {"source":"26MY Mazda3 Spec Deck.pdf","source_id":"source-…","text":"<verbatim chunk text, may be long, may contain a table>"},
   {"source":"26MY Mazda3 Spec Deck.pdf","source_id":"source-…","text":"<verbatim chunk text>"}
 ],
 "facts":["Adaptive Front-lighting System — 2.5 S Premium: standard equipment on …"],
 "truncated":true,"omitted_passages":4,
 "sources":[{"kind":"knowledge","id":"source-…","name":"26MY Mazda3 Spec Deck.pdf","knowledgeId":"knowledge-…","knowledgeName":"Mazda"}]}
```

| Key | Rule |
|---|---|
| `passages[].text` | verbatim, contiguous text of the chunk. Passage 1: the whole chunk up to 5 000 characters. Passages 2+: an excerpt of up to 2 000 characters around the query terms (data-model "Fitting"). Any cut side carries `…[+N chars before]` / `…[+N chars after]`; a cut passage also has `cut: true`. Nothing is paraphrased or reordered |
| `passages[].source` | the Source row's name; the reported `file_path` when no row resolved |
| `passages[].source_id` | the Source row id; `null` when unresolved (logged at `warn`) |
| order | the retrieval service's order, duplicates by exact text removed |
| `facts` | omitted when empty; at most 8; each ≤ 200 characters; never present when a passage had to be dropped to make room |
| `truncated` / `omitted_passages` | `truncated` always present; `omitted_passages` present when `truncated` |
| `sources` | one entry per distinct resolved `source_id` **among the kept passages**, in first-seen order — the CLEAN-138 shape `extractSources` reads; a dropped passage's document is not listed, an unresolved one is not citable |

### No relevant content

```json
{"knowledge_id":"knowledge-…","knowledge_name":"Mazda","complete":true,
 "reason":"no_relevant_content","passages":[],"truncated":false,"sources":[]}
```

Returned when the service found no chunk and no fact, and when the
empty-isolated-base veto fired (the service was not called).

### A base that failed

Unchanged:

```json
{"knowledge_id":"knowledge-…","knowledge_name":"Mazda",
 "error":"Knowledge base Mazda is not answering right now (LightRAG /query/data timed out after 30000 ms). It is most likely restarting: say so to the user and try again in a few minutes instead of repeating the call straight away."}
```

The timeout sentence keeps its wording; only the path and the number inside
the parenthesis follow the new call.

## Result — several bases

```json
{"results":[ {<one base>}, {<one base>}, … ]}
```

Fan-out rule unchanged: one block per isolated base, the shared pool asked
once through its first bound id. Budget per block:
`max(2000, floor(12000 / blocks))`; the whole envelope therefore stays
≤ 12 000 + framing.

## Fitting rules

See [data-model.md](../data-model.md), "Fitting". Pure function,
`fitContextToBudget(block, budgetChars)`; the tool calls it per block.

## Tool description (`BASE_DESCRIPTION`)

Replaces the current text. Dynamic suffix (the list of bound bases) stays.

> Search your bound knowledge bases and get back the matching document
> fragments **verbatim**, each with the document it came from. You compose
> the answer from those fragments yourself; nothing in the result was
> written by another model. MUST be called FIRST, before drafting any
> response, when the user asks about a topic that could plausibly be covered
> by your bound knowledge bases (see the list below). Do NOT hedge with
> phrases like "isn't explicitly detailed" or "based on what I know" before
> calling this tool — drafting an answer first and then querying is a bug.
> When the request contains several independent questions, issue all of
> those calls in the same turn rather than one after another: they run
> concurrently. Prefer this over web_search for anything that could be in
> user-uploaded content.
>
> Reading the result: `passages` are exact excerpts (tables and lists come
> through as text); when a passage answers the question directly, answer
> with confidence and cite its source — do not add "I cannot guarantee" or
> "check the spec sheet". `truncated: true` means more matches existed than
> fit; ask a narrower question if you need them. A lookup that returns no
> passages or `no_relevant_content` only means *that phrasing* matched
> nothing; it never contradicts a passage another lookup returned. `facts`
> are short graph relations, secondary to passages.
>
> Phrasing lookups: the documents are spec sheets, order forms and
> manuals — search in their vocabulary. Use the official feature name
> ("Adaptive Front-Lighting System (AFS)", not "adaptive headlights"), the
> exact trim names, and the model year. If a lookup in the visitor's words
> brings nothing from the document that should hold the answer, run one
> more lookup in spec-sheet terms before concluding anything. The
> knowledge_id parameter is optional and rarely worth setting: one call
> covers everything bound to you.

The comment above the constant that quotes "198 s / 35 s" is replaced by
the staging measurement for the new path, or removed if none is taken; the
batching instruction stays because the calls still run concurrently.

## Tests (`knowledge.tool.spec.ts`)

Existing cases keep their intent with `knowledgeService.retrieveContext`
mocked instead of `query`. New:

1. **Mazda AFS regression**: a mocked context returning the AFS trim chunk →
   the result's `passages[].text` contains "2.5 S Premium" and "2.5 Turbo
   Premium Plus", `passages[].source` is the spec deck, and the serialized
   text contains no sentence from a refusal list.
2. **Budget**: 30 chunks of 1 000 characters → serialized result ≤ 12 000,
   parses, `truncated: true`, `omitted_passages` equals the drop count,
   kept passages are the first N in order.
3. **Over-long single passage** (14 000 characters) → one passage, cut,
   marker present, result ≤ 12 000.
4. **Fan-out budget**: two bases → each block ≤ 6 000; the envelope parses.
5. **Dedup**: two chunks with identical text → one passage.
6. **Facts yield**: with passages filling the budget, `facts` absent.
7. **Empty**: zero chunks → `reason: 'no_relevant_content'`, `sources: []`.
8. **Unresolved passage**: kept with `source_id: null`, absent from
   `sources`, one `warn`.
9. **Sources shape**: unchanged from the CLEAN-138 cases.
10. Isolation, unreachable-base and timeout-wording cases: unchanged
    assertions on the new path.
