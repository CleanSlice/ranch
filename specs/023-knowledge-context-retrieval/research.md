# Research: Knowledge Retrieval Hands the Agent the Found Passages

**Feature**: [spec.md](spec.md) | **Date**: 2026-10-28 | **Ticket**: CLEAN-184

Everything below was read in the code on `origin/main` at `db1dda16`
(2026-10-28). The agent runtime was read from the local clone of
`CleanSlice/runtime` on `feat/CLEAN-138-chat-sources` (release 0.31.0), which
is the branch that introduced the `sources` shape this feature must keep.
LightRAG was read from upstream `HKUDS/LightRAG` at `main` and at the exact
revision the per-base instances run (F4). The CleanSlice MCP the brief asks
to consult (`get-started`, `list-categories`, `search`, `read-doc`) is not
connected in this session either; the slice conventions were taken from the
existing code and specs instead, which is what that MCP would have pointed at.

## Findings

### F1. The agent path today, end to end

1. **Runtime** calls the MCP tool `query_knowledge`; the MCP gateway returns
   the tool's `content` array as the raw tool result
   (`runtime/src/slices/setup/mcp/data/mcp.gateway.ts:455-465`).
2. **Tool** `api/src/slices/reins/knowledge/knowledge.tool.ts:111-197`:
   resolves the caller's bound bases, fans out over isolated bases and asks
   the shared pool once, calls `KnowledgeService.query(id, query)` per base,
   strips LightRAG's own `[n]` markers and References footer from the answer
   (CLEAN-138, R13), attaches `sources` built from the resolved references,
   returns `{…}` for one base or `{ results: [...] }` for several. Errors
   per base are folded into the block (`error: …`), with the timeout wording
   from CLEAN-96.
3. **Service** `knowledge.service.ts:478-547`: `requireReadable`, the
   empty-isolated-base veto (`complete && !hasIndexed` → `no_relevant_content`
   without calling LightRAG), `gateway.searchKnowledge`, the canned-refusal
   check `isNoRelevantContentAnswer`, reference resolution
   (`resolveReference` by source id → name → url, then
   `resolveAdoptedReferences` through `listDocuments` for renamed documents).
4. **Gateway** `data/knowledge.gateway.ts:245-258` → `lightrag.query(...)`.
5. **Client** `lightrag/data/lightragHttp.client.ts:235-258`: `POST /query`
   with `{ query, mode: 'hybrid', top_k: 10, include_references: true }`
   under `QUERY_TIMEOUT_MS = 50_000`; `extractQueryResult` (L532) keeps
   `body.response` and `body.references[] { reference_id, file_path }` only.

So the agent receives one paragraph written by LightRAG's model per base,
never the chunks. The brief's root cause holds line for line.

### F2. What the runtime does with the result

- `loop.service.ts:505` caps the model's copy of every tool result with
  `capPayload(resultEvent.data, maxToolOutputChars)`, `maxOutputChars =
  16_000` (`init.types.ts:216`). The transcript keeps the full result.
- `capPayload` is structure-aware for objects and arrays, but an MCP result
  is `[{ type: 'text', text: '<json>' }]`: one string. `cap()` slices a
  string that does not fit (`contextBudget.ts:34-38`) and appends
  `…[truncated +N chars]`. The JSON inside is cut mid-structure. **The budget
  has to be met by the API.**
- `sizeOf` is `JSON.stringify(value).length` (`contextBudget.ts:83`) over
  `{ toolUseId, result }`. The tool's text is therefore measured *after* JSON
  escaping: every `"` in it becomes `\"`, every newline `\n`. Passage text is
  prose with quotes and line breaks, so the escaped size runs some 5–15 %
  above the raw string. This is why 12 000 raw characters, not 15 000, is
  the budget (D6).
- `sources.ts:extractSources` parses each MCP text item as JSON and reads
  `sources` and `results[].sources` off it; entries are
  `{ kind: 'knowledge', id, name, knowledgeId, knowledgeName }`. Any result
  that keeps those keys keeps citations working (FR-008).

### F3. The console path

`POST /knowledges/:id/query` (`knowledge.controller.ts:206-214`,
`operationId: queryKnowledge`) → `KnowledgeService.query` → the same client
call. The admin Query tab (`admin/slices/reins/components/knowledge/query/Provider.vue:75-85`)
shows the "no content relevant" box when `answer === null` and the text
otherwise; `reason` is typed `'no_relevant_content'` only
(`knowledgeRecord.dto.ts:23-24`), and the admin reads the generated
`KnowledgeQueryResultDto` as its `IQueryResult`. Modes offered: `hybrid`,
`local`, `global`, `naive` (`queryKnowledge.dto.ts:6`); `topK` default 25.

### F4. Which LightRAG is deployed, and what it offers

- Per-base instances are pinned by digest
  (`instance/data/instance.manifest.ts:19`). The GHCR manifest for that
  digest (read anonymously on 2026-10-28) carries
  `org.opencontainers.image.version: v1.5.6`,
  `revision: b33c6b0812cddf39206e48a9810112e51f025274`, built 2026-08-06.
- `lightrag/api/routers/query_routes.py` **at that revision** defines
  `POST /query`, `POST /query/stream` and **`POST /query/data`**.
  `QueryRequest.mode` is `local | global | hybrid | naive | mix | bypass`,
  default `mix`; `only_need_context`, `top_k`, `chunk_top_k`,
  `include_references` (default true), `include_chunk_content`,
  `enable_rerank`, `max_total_tokens` all exist. `/query` has no
  `llm_generated` field at this revision; when the model's content is empty
  it answers the literal `"No relevant context found for the query."` — a
  third canned phrase our detector does not know (D9).
- `/query/data` returns `{ status, message, data, metadata }`;
  `data.chunks[] { content, file_path, chunk_id, reference_id }`,
  `data.entities[]`, `data.relationships[]`,
  `data.references[] { reference_id, file_path }`. `aquery_data` sets
  `only_need_context = True` on a copy of the params and passes through
  `kg_query` / `naive_query` raw data; `status: 'failure'` with
  `metadata.failure_reason: 'no_results'` when nothing matched.
- The shared pool (`k8s/platform/lightrag/deployment.yaml:54`,
  `api/docker-compose.yml:161`) runs `:latest`, whichever digest the node
  pulled last. `/query/data` predates August 2026 upstream, so it is there
  in practice, but it is not pinned. Hence the 404 fallback in D1 and the
  log line that names the path used.
- Server defaults (`lightrag/constants.py` at `main`): `DEFAULT_TOP_K = 40`,
  `DEFAULT_CHUNK_TOP_K = 20`, `DEFAULT_COSINE_THRESHOLD = 0.2`,
  `DEFAULT_RERANK_BINDING = "null"`, chunk target `DEFAULT_CHUNK_P_SIZE =
  2000` characters. Twenty 2 000-character chunks is ~40 000 characters: the
  server's defaults alone overflow the budget threefold, so the client asks
  for fewer and the tool still trims (D5, D6).

### F5. What still calls a model on the no-generation path

Read in `lightrag/operate.py` (`main`): `kg_query` (modes `local`,
`global`, `hybrid`, `mix`) calls `get_keywords_from_query` **before**
building the context, and that is an LLM call unless `hl_keywords` /
`ll_keywords` are supplied or cached. It runs for `/query/data` and for
`only_need_context` alike. `naive_query` makes no model call before
retrieval (vector search on the query embedding only).

So "no LightRAG-side generation" is true of the *answer*; the keyword step
remains for graph modes. It is seconds, not the tens of seconds generation
took, and its output never reaches the agent. It is also the one place two
rephrasings can diverge in *which* chunks come back. D2 chooses the mode
with this in view and asks the staging check to time it.

### F6. The text form of the context (fallback path)

With `only_need_context: true`, `/query` returns `response` built from
`PROMPTS["kg_query_context"]` (or `naive_query_context`): sections
"Knowledge Graph Data (Entity)", "Knowledge Graph Data (Relationship)",
"Document Chunks" and "Reference Document List", each a fenced block; the
chunk and graph blocks are JSON arrays (one object per entity / relation /
chunk, chunks carrying `reference_id`, `file_path`, `content`), the reference
list is `[n] file_path` lines. The JSON fences are parseable, so the
fallback can produce the same `IContextResult` as `/query/data`, with a
parser that fails loudly rather than guessing when the fences are absent.

### F7. How passages bind to source rows

Chunks carry `file_path`, the same string the references carry today
(`toReference`, client L560). `resolveReference` matches it to a Source row
by id, then name, then url; `resolveAdoptedReferences` maps a stale name
through `listDocuments`. Binding a passage is therefore the existing
resolution applied to the chunk's `file_path`; `reference_id` is not needed
for attribution and is dropped from the tool result (the agent cites by
`[^n]` over `sources`, CLEAN-138).

### F8. Tests that pin the current guarantees

- `knowledge.tool.spec.ts` (552 lines): SC-002 adversarial queries never
  reach an unbound base; FR-006 fan-out attribution; unreachable base named;
  shared-pool asked once; timeout wording; CLEAN-138 sources and
  `stripRetrievalCitations`.
- `knowledge.isolation.spec.ts` (426 lines): real client + real routing
  against a fake `fetch` keyed by endpoint (L92-L170); SC-001 isolation;
  empty base not asked; migrated base with instance down fails loudly;
  no-relevant-content detection; reference resolution; adopted references.
- `lightragHttp.client.spec.ts` (134 lines): timeouts per call class, abort
  signal, pass-through of other failures.

All three fake `/query` with `{ response, references }`. The new path needs
the fakes to serve `/query/data` with `{ status, data: { chunks, … } }`, and
the tool spec's `knowledgeService.query` mock becomes `retrieveContext`.

### F9. Scope markers that stay true

- `reins/README.md:37` describes the one-query-for-the-shared-pool rule;
  unchanged. The README says nothing about generation on the agent path;
  a short paragraph is owed (plan, Delivery order).
- The duplicate client in the separate `reins/nestjs/` repository is not in
  this tree; it is named in the PR as having the same defect.
- The hypothesis about the chat hiding intermediate text behind "Thought
  for a moment" is not touched here.

### F10. Where the Mazda base actually runs (added 2026-10-28, from `mazda-ai-gitops` and `mazda-ai-ranch`)

The installation that reported the defect is not deployed from this
repository's manifests. Read in `E:/code/coso/mazda-ai-gitops` (`main`,
`49fd58a`) and `E:/code/coso/mazda-ai-ranch` (fork, `origin/dev` at
`9e46f0fd`, `origin/main`):

- **Code**: the fork `connectsolutions/mazda-ai-ranch`. CodeBuild
  (`mai-<env>-ranch-images`) builds the fork's `dev` branch for `mai-dev`
  (`dev-mazda-ai.mycoso.cloud`) and `main` for `mai-prod`
  (`mazda-ai.mycoso.cloud`), then bumps `image.tag` in
  `helm/ranch-api/values.<env>.yaml`; ArgoCD rolls it out. The fork tracks
  this repository through periodic `chore/catch-up-upstream-N` merges
  (#50 is the latest on `dev`). A fix merged to `CleanSlice/ranch` `main`
  reaches Mazda only through such a merge.
- **LightRAG**: one shared instance per environment, chart
  `helm/ranch-lightrag`, image **`ghcr.io/hkuds/lightrag:v1.4.16`** (pinned
  tag, both envs), service `lightrag.ranch.svc.cluster.local:9621` in
  namespace `ranch`, Postgres storage for KV/vector/graph, LLM
  `aws_bedrock` / `us.anthropic.claude-haiku-4-5-20251001-v1:0`, embedding
  `amazon.titan-embed-text-v2:0` (1024). No `REINS_INSTANCE_ISOLATION` in
  the API values → isolation off, every base on this shared instance. The
  v1.5.6 digest in `instance.manifest.ts` and the `:latest` in this repo's
  `k8s/` are a different deployment and do not apply to Mazda.
- **v1.4.16 has `POST /query/data`** (upstream `query_routes.py` at that
  tag): `mode` default `mix` with `naive | local | global | hybrid | mix |
  bypass`, `only_need_context`, `top_k`, `chunk_top_k`,
  `include_references`, `include_chunk_content`; `/query` answers
  `"No relevant context found for the query."` on empty content, no
  `llm_generated`. D1's structured route is available on Mazda; the 404
  fallback stays as insurance for any other deployment.
- **Access for the evidence gate**: AWS profiles `mazda` (dev) and
  `mazda-prod` (prod), region `us-east-2`, EKS clusters `mai-dev-use2-eks`
  / `mai-prod-use2-eks`; LightRAG is not exposed outside the cluster, so
  `kubectl port-forward -n ranch svc/lightrag 9621:9621` is the way in. The
  machine this plan was written on has only a `default` AWS profile and no
  kube contexts — T002 needs those credentials first.

### F11. The fork already learned something about query modes on the Mazda corpus

Fork commit `ac87454a` (2026-09-30, "query knowledge in global mode by
default") changed the agent query to `mode: input.mode ?? 'global'` with
this reason in code: *hybrid's local half fetches every edge of the seed
entities before truncating, so a broad question about a hub ("what is
Mazda", 2621 relations) outlived `QUERY_TIMEOUT_MS` and kept running in
LightRAG after we gave up; global is bounded by `top_k` and answered the
same facts.* The fork's console default is `global` too
(`queryKnowledge.dto.ts`). These are the only two `reins` files where the
fork differs from this repository's `main` (file-level diff, 2026-10-28).

Consequence: `mix` contains that same local half. On the Mazda graph a
hub-shaped question through `/query/data` in `mix` mode can hit the same
edge explosion before any token budget applies. The mode for the passages
path cannot be chosen from upstream defaults; it is chosen by measurement
on the Mazda instance (D2, revised).

### F13. T002 evidence gate, run 2026-10-28 on `mai-dev` (read-only)

Setup: `mazda` dev keys from `.env.project` (account `489364174951`
verified with `sts get-caller-identity` before anything else), scratch
kubeconfig for `mai-dev-use2-eks`, `kubectl -n ranch port-forward
svc/lightrag 9621:9621`, API key from the `lightrag-api` secret (field
`apiKey`). `GET /health`: core `1.4.16`, api `0291`, LLM `aws_bedrock`
`us.anthropic.claude-haiku-4-5-20251001-v1:0`, embedding
`amazon.titan-embed-text-v2:0`, no rerank binding. Document store: 769
documents, 750 processed, 19 failed.

**Route**: `POST /query/data` answers `200 / status: success` in `naive`,
`global` and `mix`; `naive` reports empty keywords (no model call), the
graph modes report extracted keywords. D1 holds without the fallback.

**Timing** (`top_k 20`, `chunk_top_k 12`, two runs each where given):

| question | naive | global | mix |
|---|---|---|---|
| AFS trims (Mazda3 hatchback) | 1.45 s, 0.71 s | 3.28 s, 1.00 s | 6.10 s, 3.09 s |
| "what is Mazda" (hub) | 0.73 s | 1.52 s | **21.65 s** |

F11 confirmed: the hub question in `mix` costs twenty seconds while
`naive` and `global` stay around a second.

**Chunk sizes**: 2 100–6 000 characters each (median ≈ 4 600); twelve
chunks ≈ 52 000 characters. The server's own `max_total_tokens` (30 000)
cuts a `chunk_top_k 60` request at 21 chunks ≈ 94 000 characters. At the
12 000-character budget (D6) **two whole passages fit**, three at best.

**What the natural question retrieves** — the finding that matters:

- In every mode, at `chunk_top_k` 12 and 60, **no chunk of the 26MY Mazda3
  Spec Deck comes back** for "For the Mazda3 hatchback what trim levels
  come with adaptive headlights?" — neither the DOCX (20 chunks in the
  store) nor the `… - Equipment and Features - Hatchback.csv` (4 chunks,
  the AFS row). The PDF form of the deck has one chunk of 169 characters
  (image-only PDF; the text layer is arrows and a footer).
- Ranks 1–2 in every mode are `Genius_Test_Results_RAG.docx` / `.md`:
  a document that contains **this exact question with its corrected
  answer** ("Test 4 — Which trims have adaptive headlights … Correct
  answer: … 2.5 S Premium and the 2.5 Turbo Premium Plus …").
  `Genius_Correct_QA.docx` / `.md` ("Correct Answers and Correct
  Behaviours (Reinforcement Set)") are in the store too. The dev base
  therefore answers Q1 from an answer sheet, not from the deck.
- Ranks 3–12: 2025 and 2023 safety-feature charts, 2021–2024 Mazda3 order
  guides, MX-5 trim CSVs — mostly older model years that also carry an
  AFS row. On a base without the answer sheet, these are what a passages
  result would hand the agent.
- The deck chunks **are** retrievable: a query in the document's own
  vocabulary (the CSV header row plus "Headlights - adaptive
  Front-Lighting System (AFS)") returns the 26MY deck at ranks 1, 2, 3 and
  11 in `naive`. The gap is between the visitor's words ("adaptive
  headlights", "trim levels") and the deck's ("adaptive Front-Lighting
  System (AFS)", `Std` / `-` columns) under Titan v2 embeddings — a
  retrieval-wording gap, not a missing document.

**Mode by the D2 rule**: rule (1) — the deck's table returned — is met by
no mode for the natural question; rules (2) and (3) pick **`naive`**
(fastest, bounded on the hub, no model call). Recorded as the default;
see the open points below before Phase 2.

**Open points this run raises** (decided with the ticket owner, not here):

1. Are `Genius_Test_Results_RAG` / `Genius_Correct_QA` in the production
   base? If yes, production retrieval for Q1 is the answer sheet too and
   the original failure needs re-reading; if no, the dev staging proof of
   Q1 must exclude them (remove from the dev base for the run, or test
   with questions the sheet does not contain).
2. Two passages per call is thin. Options: accept (top-2 verbatim chunks);
   or a rule-based excerpt per passage (a contiguous window of N
   characters around the query terms, with cut markers) so 6–8 passages
   fit — a calculation, still verbatim, but a design change to D5/D6.
3. The wording gap is outside this ticket's code path but decides Q1 on a
   clean base. Cheapest lever inside the ticket: the tool description
   (FR-009) tells the agent to query in spec-sheet vocabulary (official
   feature names such as "Adaptive Front-Lighting System", trim names,
   model year). Beyond that it is an indexing/embedding topic for its own
   ticket.

### F14. Second production example (owner, 2026-10-28)

Asked about 2026 CX-30 trims and pricing, the agent made two lookups and
relayed both refusals as the base's answer: "I do not have complete
information about the full 2026 Mazda CX-30 trim lineup specifications in
the provided context" and "I do not have sufficient information in the
provided context to answer your query about the 2026 CX-30 Aire Edition
Turbo pricing and trim details", then told the visitor the base lacks the
data and to check the 26MY CX-30 Order Form and Price Bulletin. The dev
base holds `26my-cx-30-spec-deck-final-effective-0612026` as DOCX plus
`- Product Summary.csv` and `- Equipment & Features.csv` (F13 listing), so
the trim line-up at least is indexed; whether the CX-30 price bulletin is
in the base was not checked. Same defect as F1; two new refusal
phrasings added to the console detector (contract, D9); a CX-30 trims
question added to the quickstart as the second regression, with its
answer key to be taken from that deck during T003.

Third example, same day, same base, "show me the 2025 trims" (CX-30): the
lookups returned "I do not have sufficient information in the provided
context" and "I don't have access to the 2025 Mazda CX-30 specification
document", and the agent told the visitor the system "cannot retrieve this
information reliably" — the phrasing "don't have access to" joins the
detector. And the counter-example that shows the nondeterminism: the same
"what trims are available for CX-30 2026" asked in the admin chat minutes
later came back with the full eight-trim table and two cited sources. Same
retrieval, different generation; the passages path removes the generation.
That admin screenshot also shows the agent's opening sentence ("I'll check
the 2026 CX-30 documents…") rendered twice — once as its own bubble, once
glued to the final answer — which is the chat-rendering hypothesis from the
brief and belongs to the `chat`/`bridle` twins, not here.

## Decisions

### D1. Endpoint: `POST /query/data`, falling back to `POST /query` + `only_need_context` on 404

**Decision**: `LightragHttpClient.retrieveContext` calls `/query/data`
first. A `404` (route absent on an older `:latest`) triggers one retry
against `/query` with `only_need_context: true`, parsed from the fenced JSON
blocks (F6). Any other status is an error, as for `query`. The path taken is
logged once per base URL at `log` level ("context via /query/data" /
"context via /query only_need_context") so a maintainer can see which one a
deployment is on.

**Rationale**: the per-base instances are v1.5.6 and have the structured
route (F4); the shared pool is `:latest` and almost certainly has it, but
"almost" is not a plan. The fallback costs one extra request only on a
deployment that lacks the route, and the structured route returns the same
fields without a parser.

**Alternatives**: `only_need_context` only — one code path, but a text
parser on the main road and dependent on prompt templates that upstream
edits freely. `/query/data` only — simplest, but a `:latest` rollback would
take the agent path down with a 404 nobody expects.

### D2. Mode: chosen by the evidence gate among `naive`, `global`, `mix`; `naive` is the proposed default (revised after F11)

**Decision**: one constant `CONTEXT_QUERY_MODE` in the client, set from
T002's measurement on the Mazda instance, which runs the AFS question and
the hub question "what is Mazda" through `/query/data` in all three modes
and records, per mode: whether a chunk with the AFS trim table comes back
and at what rank, total chunk characters, and elapsed time. Selection
rule, in order: (1) the table is returned; (2) the hub question finishes
well inside `CONTEXT_TIMEOUT_MS`; (3) among the remaining modes, the one
with no model call. By that rule the expected pick is **`naive`**: vector
top-k over chunks, no keyword-extraction call (F5), no graph walk (F11),
deterministic for the same wording — and verbatim chunks are exactly what
this feature wants. `QueryModeTypes` gains `'mix'` regardless, so the
console and the client share one type.

Passages come from `data.chunks`. `data.relationships` feed the optional
`facts` only in a graph mode; in `naive` there are none and `facts` is
simply absent (FR-002 says MAY). `data.entities` are never sent.

**Rationale**: the spec's assumption "the richest mode the instance
supports" was written before F11. Richness that can run past the timeout
on a hub question is not richer for the agent, who then gets the timeout
sentence. The fork's measurement is on the very corpus the defect came
from.

**Alternatives**: `mix` — vector chunks plus graph-reached chunks; the
right choice only if T002 shows it bounded on the hub question and
materially better at surfacing the table. `global` — the fork's current
mode; bounded by `top_k`, but its chunks are reached through relations,
and for a passages result the vector pass matters more. `hybrid` — ruled
out by F11.

### D3. What the client asks for

`chunk_top_k: 12`, `top_k: 20`, `include_references: true`, `enable_rerank`
left to the server (no rerank binding is configured in either deployment,
F4; upstream skips reranking without one). **Reason for 12**: at the
~2 000-character chunk target, twelve chunks are ~24 000 characters, twice
the budget — enough that the tool's trimming decides what the agent sees
by relevance rather than the server deciding by count, and not so many that
the instance ships 40 000 characters per call that are then thrown away.
**Reason for 20** entities/relations: `facts` are capped at 8 in the tool
(D5); asking for more than twice that is waste. Both are named constants
with these reasons beside them.

### D4. One new method per layer, the old path untouched

- `ILightragClient.retrieveContext(input: IRetrieveContextInput): Promise<IContextResult>`
  beside `query` (the console keeps `query`).
- `IKnowledgeGateway.retrieveKnowledgeContext(knowledgeId, query, mode?)`
  beside `searchKnowledge`.
- `KnowledgeService.retrieveContext(knowledgeId, query): Promise<IKnowledgeContextResult>`
  beside `query`, sharing `requireReadable`, the empty-isolated-base veto, the
  `complete` flag, `resolveReference` + `resolveAdoptedReferences` (applied
  to each chunk's `file_path`, F7), and the same logging on a failed
  `listDocuments`.
- The tool calls `retrieveContext`; `query` stays for the console.

**Rationale**: FR-011 says the console keeps its written answer; sharing a
method with a flag would couple the two paths that the spec deliberately
separates. The guarantees US3 lists are reused by calling the same private
helpers, not by copying them.

### D5. The result the agent sees

Per base: `knowledge_id`, `knowledge_name`, `complete`, `passages[]`
(`source`, `source_id`, `text` — verbatim chunk content), `facts[]`
(strings, ≤ 8, each ≤ 200 characters, from relationships as
`"<src> — <tgt>: <description>"`), `truncated`, `omitted_passages`,
`sources[]` (CLEAN-138 shape, resolved rows only). A base with zero chunks
and zero facts: `reason: 'no_relevant_content'`, `passages: []`,
`sources: []`. A failed base: `error` as today. Several bases:
`{ results: [...] }`. Full shape in
[contracts/query-knowledge-result.md](contracts/query-knowledge-result.md).

Deduplication by exact `text` within one call, first occurrence wins
(relevance order). Unresolved passages keep `source: <file_path as
reported>`, `source_id: null`, are logged, and are not listed in `sources`
(a reader could not open or rate them — the CLEAN-138 rule).

### D6. The budget: 12 000 characters of the serialized tool text, per call

**Decision**: the tool serializes its result compactly
(`JSON.stringify(value)`, not the pretty-printed `ok()`), measures the
string, and fits it to `TOOL_RESULT_BUDGET_CHARS = 12_000`: passages are
added whole in the order received until the next would overflow; the rest
are dropped and counted in `omitted_passages`; `facts` are added only after
all kept passages and are dropped first when tight; a single passage longer
than the whole budget is cut to fit with a trailing `…[cut +N chars]`
marker, so a one-chunk answer is never empty. With N queried bases the
budget per base is `floor(12 000 / N)`, never below 2 000. The fitting
function is pure (`knowledge/domain/knowledgeContext.ts`) and tested on its
own.

**Derivation**: runtime cap 16 000 (F2) − JSON escaping of the text once it
sits inside the `content` array and the `{ toolUseId, result }` envelope
(≤ ~15 % of prose, F2) − the envelope itself (~60 characters) leaves
headroom of at least ~1 800 characters at 12 000. The spec's "about 12 000"
is kept as an exact constant with this reason beside it.

**Why compact JSON**: indentation and newlines in pretty-printed JSON are
budget spent on nothing; the model reads compact JSON as well. The other
tools keep `ok()`.

### D7. Timeout for the context call: 30 s, measured before it is final

**Decision**: `CONTEXT_TIMEOUT_MS = 30_000`, a new constant beside
`QUERY_TIMEOUT_MS` (which stays 50 s for the console path). Reason: the
generation that justified 50 s is gone; what remains is the keyword call
(seconds), the embedding, and the vector/graph reads — the same class of
work as the 30 s status reads already bound. It stays under the MCP
client's 60 s so the agent gets the timeout sentence, not a transport
error. The staging run records the observed times; if the p95 sits near 30
s the constant is raised in the same PR with the number (FR-012).

### D8. Tool description tells the truth

`BASE_DESCRIPTION` is rewritten: the result is verbatim document fragments
with their source; answer from them and cite the source; a lookup that
found nothing does not refute a lookup that found the answer; when the
fragments answer directly, answer with confidence and no "cannot guarantee"
hedge. Keep: call before drafting; batch independent questions in one turn
(they still run concurrently). The comment with "198 s / 35 s" is replaced
by the new measurement from the staging run or, if none is taken, by the
plain statement that calls are concurrent. Text in
[contracts/query-knowledge-result.md](contracts/query-knowledge-result.md).

### D9. The console flags partial refusals through `reason`

**Decision**: `isPartialRefusal(answer)` recognises, case-insensitively:
"I do not have sufficient information", "do not have enough information",
"does not contain enough information", "not able to provide a complete",
"insufficient information in the provided knowledge base", and the server's
own empty-content text "No relevant context found for the query." (F4). On
the console path a match returns `answer: null, reason: 'partial_refusal'`;
`reason` becomes `'no_relevant_content' | 'partial_refusal'` in
`IKnowledgeQueryResult` and the DTO, the SDK is regenerated, and the admin
Query tab shows a distinct one-line copy for `partial_refusal` ("The
retrieval model could not answer from this base; the documents may still
hold it — try the agent or a narrower question."). The agent path never
sees these sentences any more, so no detection is needed there.

**Rationale**: SC-006 asks for a *visible* flag; reusing the no-content box
would call a model's hesitation "no content", which is the misreading this
ticket is about. The list is grown from observed sentences (the production
one and the server's literal), not from a guess — the same rule
`indexFailure.ts` follows for its markers.

**Consequence for surface marking**: one copy line in `admin/slices/reins`
plus the regenerated SDK. The ticket is relabelled `[ADMIN][API]` with the
`admin` label added (constitution, "Surface marking is honest").

### D10. Observability

One `log`-level line per lookup from the tool: base id, path used (D1),
chunks received, passages kept / omitted, serialized size, elapsed ms. One
`warn` per unresolved passage, as the tool already does for references.
This is what the PR's "before/after" and SC-002 are read from on staging.

### D11. Where "staging" is for the manual check (revised after F10)

`mai-dev` (`dev-mazda-ai.mycoso.cloud`), built from the fork's `dev`
branch. The staging run therefore needs the change on a fork branch merged
into `dev` (D13), a CodeBuild run, and the spec deck indexed in a base there
— whether `mai-dev` already holds the 26MY Mazda3 Spec Deck is not known
from the repositories and is checked first; if not, it is uploaded there
once. Where that is impossible, the fallback is the local stack
(`api/docker-compose.yml`, LightRAG pinned to `v1.4.16` for the check, not
`:latest`) with the deck ingested into one base — slower, same checks. The
"after" numbers for SC-004 come from `mai-dev`; the "before" numbers
(T003) can be taken on `mai-prod` read-only, where the old path still runs.

### D13. Delivery into the Mazda fork

The fix lands in `CleanSlice/ranch` `main` first (this ticket's PR). To
reach Mazda it is then merged into `mazda-ai-ranch` `dev` the way the fork
already takes upstream (`chore/catch-up-upstream-N`), verified on `mai-dev`,
and promoted to `main` → `mai-prod`. To keep that merge clean, this change
**does not touch the body of `LightragHttpClient.query` or the console
mode default** — the fork's `'global'` lines stay theirs; the new
`retrieveContext` is a separate method with its own mode constant. The
fork's `queryKnowledge.dto.ts` default (`global`) is untouched by D9, which
only widens `reason`.

### D14. After the evidence gate (decided 2026-10-28; the owner confirmed the answer sheets exist in production as well)

**Answer sheets.** `Genius_Test_Results_RAG` and `Genius_Correct_QA` are
in the production base too (owner, 2026-10-28). So production retrieval
for the AFS question also ranked the answer sheet first, and the agent
still hedged — which confirms the defect is in what the agent *received*
(generated prose and a refusal), not in what LightRAG found. Q1 stays the
regression exactly as asked; on this corpus the source it cites will be
the sheet or the deck, and SC-001 reads "cites a source that holds the
answer". The deck path is proven separately by questions the sheets do
not contain (quickstart, "sheet-free set": curb weight, fuel tank,
ground clearance, manual-transmission trims — checked against both sheets
on 2026-10-28).

**Passage size** (replaces the "whole passages only" rule of D6). Chunks on
the Mazda base run ~4 600 characters (F13); whole passages give two per
call. The fitting rule becomes: the **first passage travels whole** up to
`FIRST_PASSAGE_MAX_CHARS = 5_000` (the best match most often holds the
answer, and tables are long; a typical chunk fits); **every further
passage is a contiguous excerpt** of at most `PASSAGE_MAX_CHARS = 2_000`
characters — the window with the most query-term hits (tokens of three or
more letters, stopwords dropped, case-insensitive), snapped to line
boundaries, the head of the chunk when nothing matches — with
`…[+N chars before]` / `…[+N chars after]` marks on the cut sides. That
is 5 000 + 3 × 2 000 ≈ four passages per call, five or six when the top
chunk is short. Still verbatim (a contiguous span, marked where it was
cut), still a calculation (constitution VII). Dedup compares full chunk
text before excerpting.

**Description** (adds to D8). The tool tells the agent to phrase lookups
in the documents' own vocabulary — official feature names ("Adaptive
Front-Lighting System (AFS)" rather than "adaptive headlights"), exact
trim names, the model year — and, when a lookup in the visitor's words
returns nothing from the document that should hold the answer, to issue a
second lookup in spec-sheet terms before concluding. That is the one lever
inside this ticket for the wording gap in F13.

**Follow-up ticket** (not this change): the retrieval gap itself — Titan
v2 embeddings do not bridge the visitor's words to the deck's table
chunks, and the deck's PDF is indexed as one 169-character chunk (image
PDF, no OCR on that installation). Raised as its own CLEAN issue with the
F13 numbers; see tasks T042.

### D12. Things deliberately not done

- No change to the runtime's `maxOutputChars` (FR-013).
- No re-ranking or summarising on the API side.
- No change to `/query` for the console beyond D9.
- `data.entities` not forwarded (D2).
- `reference_id` not forwarded (F7).
- The `reins/nestjs/` duplicate: PR note only.
