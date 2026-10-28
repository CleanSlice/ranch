# Data Model: Knowledge Retrieval Hands the Agent the Found Passages

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

No table, column or migration. Everything here is in-flight data: what the
retrieval service returns, what the service binds to its rows, and what the
tool hands the agent. One enum widens on an existing API response.

## Retrieval service → client (`IContextResult`)

What `LightragHttpClient.retrieveContext` returns, whichever endpoint served
it (research D1).

| Field | Type | From `/query/data` | From `/query` + `only_need_context` |
|---|---|---|---|
| `chunks[]` | `IContextChunk[]` | `data.chunks[]` | the "Document Chunks" JSON fence |
| `chunks[].text` | string, verbatim | `content` | `content` |
| `chunks[].filePath` | string | `file_path` | `file_path` |
| `chunks[].chunkId` | string \| null | `chunk_id` | absent → null |
| `relations[]` | `IContextRelation[]` | `data.relationships[]` | the "Relationship" JSON fence |
| `relations[].source` / `.target` | string | `src_id` / `tgt_id` | `entity1` / `entity2` |
| `relations[].description` | string | `description` | `description` |
| `references[]` | `{ referenceId, filePath }[]` | `data.references[]` | the "Reference Document List" lines |
| `via` | `'query_data' \| 'only_need_context'` | — | — |

Rules:
- Order is the service's order; the client does not re-rank (spec,
  Assumptions).
- `status: 'failure'` with `failure_reason: 'no_results'` from `/query/data`,
  or an empty context from `/query`, is an **empty result** (`chunks: []`,
  `relations: []`), not an error.
- A chunk without string `content` or `file_path` is dropped and counted in
  a `warn` line; the parser never invents a field.
- `entities` are read and discarded (research D2).

## Service → tool (`IKnowledgeContextResult`)

What `KnowledgeService.retrieveContext(knowledgeId, query)` returns for one
base. Mirrors `IKnowledgeQueryResult` so the tool treats both the same way
for `complete`, `reason` and errors.

| Field | Type | Notes |
|---|---|---|
| `knowledgeId` | string | |
| `complete` | boolean | `migrationState === 'done'`, as today |
| `reason` | `'no_relevant_content'` (optional) | set when `passages` and `facts` are both empty **or** when the empty-isolated-base veto fired (then the service was not even called) |
| `passages[]` | `IKnowledgePassage[]` | bound chunks, service order, deduplicated by `text` |
| `passages[].text` | string | verbatim |
| `passages[].filePath` | string | as reported, kept for logging and for the unresolved case |
| `passages[].sourceId` | string \| null | by `resolveReference` then `resolveAdoptedReferences` on `filePath` |
| `passages[].sourceName` | string \| null | the row's name when resolved |
| `facts[]` | string[] | `"<source> — <target>: <description>"`, at most 8, each cut to 200 characters |
| `references[]` | `IKnowledgeQueryReference[]` | one per distinct `filePath`, resolved the same way — what `sourcesOf` already consumes |

State the service guards before any of this is built (unchanged from
`query`): `requireReadable` (a `done` base whose instance is not `ready`
throws the existing `ServiceUnavailableException`); the empty-isolated-base
veto; the `complete` flag.

## Tool → agent (one base)

The JSON the model reads, fitted to the budget (research D5, D6). Full
contract with examples in
[contracts/query-knowledge-result.md](contracts/query-knowledge-result.md).

| Key | Type | Notes |
|---|---|---|
| `knowledge_id` | string | |
| `knowledge_name` | string \| null | |
| `complete` | boolean | |
| `passages[]` | `{ source, source_id, text }[]` | `source` is the row's name, or the reported `file_path` when unresolved; `source_id` null when unresolved |
| `facts[]` | string[] | present only when non-empty after fitting |
| `truncated` | boolean | true when any passage was dropped or cut |
| `omitted_passages` | number | dropped count; present when `truncated` |
| `sources[]` | `IChatSourceInput[]` | one per distinct resolved row; `kind: 'knowledge'` |
| `reason` | `'no_relevant_content'` | with `passages: []`, `sources: []`, no `facts` |
| `error` | string | per-base failure, wording unchanged |

Fan-out: `{ results: [<one base>, …] }`, as today.

### Fitting (pure function, `knowledge/domain/knowledgeContext.ts`)

Input: the per-base result above before fitting, and a character budget.
Output: the fitted result and `{ kept, omitted, cut }` counts for the log.

1. Serialize the frame with `passages: []` and no `facts`; that is the
   fixed cost.
2. Dedup by full chunk text (first occurrence wins), before any cutting.
3. Passage 1 travels whole when its text is ≤ `FIRST_PASSAGE_MAX_CHARS`
   (5 000); longer, it is cut to that length with `…[+N chars after]`.
4. Every further passage is an excerpt of ≤ `PASSAGE_MAX_CHARS` (2 000):
   the window with the most query-term hits (tokens ≥ 3 letters, stopwords
   dropped, case-insensitive), snapped to line boundaries; the head of the
   chunk when no term matches; `…[+N chars before]` / `…[+N chars after]`
   on the sides that were cut. `cut: true` on the passage when either
   mark is present.
5. Add passages in order while `size(frame + passages) ≤ budget`; the rest
   are dropped and counted. If even passage 1 does not fit, cut it to
   `budget − frame − marker`.
6. Facts only when **no passage was omitted** (that is what "yield to
   passages when the budget is tight" means in code), and then in order
   while they fit; never drop a kept passage for a fact.
7. `omitted_passages` = passages not kept; `truncated` = omitted > 0 or
   any passage was cut.
8. `sources` are derived from the **kept** passages — one entry per
   resolved `source_id`, in first-seen order — and measured with them; an
   unresolved passage contributes none. (CLEAN-138's "what the answer drew
   on" is what the agent received, not what the server retrieved.)
9. Measurement reserves the keys written last (`truncated`,
   `omitted_passages`), so the final block never exceeds the budget by its
   own bookkeeping.

Reasons (research D14, F13): chunks on the reference base are ~4 600
characters, so whole passages meant two per call; the rule above carries
four to six while keeping the best match intact.

Budget per base: `max(2000, floor(12000 / queriedBases))`.

## Console path: one enum widens

`IKnowledgeQueryResult.reason` and `KnowledgeQueryResultDto.reason`:
`'no_relevant_content' | 'partial_refusal'`. `answer` is `null` for both.
The admin's `IQueryResult` is the regenerated DTO; the Query tab branches on
`reason` for its copy. Nothing else on the console path changes.

## Entities the spec names, mapped

| Spec entity | Here |
|---|---|
| Passage | `IKnowledgePassage` → tool `passages[]` item |
| Knowledge lookup result | `IKnowledgeContextResult` → one tool block |
| Partial refusal | `isPartialRefusal()` on the console path; absent on the agent path |
