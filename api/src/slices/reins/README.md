# reins (knowledge / RAG)

Ranch stores sources, hands them to LightRAG, and reads the graph back. A few
things about that boundary are not obvious from the code and have each cost a
day of debugging, so they are written down here.

## LightRAG has no per-knowledge isolation

`workspaceOf(knowledgeId)` builds a name and every ingest call carries it, but
**LightRAG ignores it**. A workspace there belongs to the instance, set by the
`WORKSPACE` env var or `--workspace` at startup; the document and query
endpoints have no per-request equivalent. For the PostgreSQL storages every row
lands in the workspace the container was started with, which is `default` when
nothing is configured.

Consequences, all of them live today:

- Every knowledge base shares one pile of documents, one entity graph, one set
  of vectors.
- A query is not scoped to a base. An agent bound to base A can be answered
  from base B's documents, with no error and nothing visible in the admin.
- Deleting "all documents" deletes them for every base at once.
- Citations come back naming documents the base does not contain. Measured on
  dev: a base holding three CX-3 files was asked about a CX-70 and answered,
  with all thirteen references drawn from the other base on that instance.
- Access control by base is fiction. The only way to keep a document out of an
  agent's answer is not to upload it.

Real isolation means one LightRAG instance per base, each with its own
`WORKSPACE` against the shared Postgres (the upstream docs describe this
layout). That is an infrastructure change and a cost decision, not something
the API can work around. Per-request workspaces are an open feature request
upstream, not a version we can move to. Until that changes, treat the LightRAG
index as global and keep one base per environment if answers must not mix.

Two places in the code follow from this and should be reverted together the day
isolation exists: `knowledge.tool.ts` issues one query for all bound bases
instead of one per base (asking each returned N copies of one answer and paid
for N), and the admin knowledge list warns as soon as a second base appears.
A design note weighing the alternatives lives in
`docs/superpowers/specs/2026-08-24-knowledge-isolation-design.md`.

## The agent reads passages; the console reads an answer

Two different calls into LightRAG, on purpose (CLEAN-184). The console's
Query tab asks `POST /query` and shows the answer LightRAG's own model
wrote; when that model declines in its own words ("I do not have sufficient
information in the provided context…") the API reports
`reason: partial_refusal` instead of handing the sentence over as the
base's answer. The agent's `query_knowledge` asks `POST /query/data`
(falling back to `/query` with `only_need_context` on a deployment that
predates the route) and receives the matched chunks **verbatim**, each
bound to its Source row, plus the `sources` list the chat cites from. The
agent composes the answer itself; no refusal from another model can reach
it any more — one such refusal, read as evidence, is what produced a wrong
hedged answer on a Mazda base while the right table sat in the same result
set.

The result is kept under 12 000 characters of compact JSON per call
(`knowledge/domain/knowledgeContext.ts`): the runtime cuts a tool result at
16 000 as one string, and an MCP result is one string to it, so a cut
would land mid-JSON. Chunks on the reference base run ~4 600 characters,
so the best match travels whole and the rest as excerpts around the query
terms, with `truncated` and `omitted_passages` saying what was left out.
Mode `naive` by measurement: `mix` took twenty seconds on a hub question
over the Mazda graph where `naive` took under one, and no mode retrieved
more of the right document — the numbers and the alternatives are in
`specs/023-knowledge-context-retrieval/research.md`.

`query_knowledge` searches contents, so "what documents, models or years
do you have" had no tool behind it: an agent either recited the coverage
its prompt hard-codes or, on a production base, followed a skill that
called the REST source list through the `http` tool with
`${RANCH_API_TOKEN}` placeholders the tool never expands, and narrated the
errors to the visitor (CLEAN-198). `list_knowledge_documents`
(`knowledge/knowledgeDocuments.tool.ts`) is the agent's view of the source
list: names only, bound bases only, with a `coverage` summary read off the
names — documents per year (`2026`, `26MY`, `my26`) and per product code
(`CX-5`, `Mazda3`), the first year in a name winning over the dates that
trail it. The operator keeps `list_knowledge_sources`, which takes any
base and shows ids and index state.

## Indexing costs about an hour per megabyte

Ingest is not chunk-and-embed. Every chunk goes through the LLM twice: once to
extract entities and relations, then again in the merge pass whenever an entity
accumulated enough descriptions to need summarising. Both phases scale with
chunk count, and chunk count follows the length of the text, not the number of
files.

Measured on the dev cluster (Haiku on Bedrock, `max_async = 4`):

| | |
|---|---|
| 1 MB of markdown | 217 chunks |
| extraction | ~20 min |
| entity merge | ~35 min |
| a 3 KB order form | 1 chunk, under a minute |

So a single owner's manual outlasts a hundred order forms, and a 28 MB
documentation set is a full day of pipeline time. Two things follow. Splitting
a large PDF into smaller files does not make it faster - the text volume is
unchanged, and `MAX_PARALLEL_INSERT` caps document-level concurrency anyway.
And an index run's wait (`indexBudgetMs`) is a bound, not a promise: documents
routinely outlive the run that submitted them, which is why the row keeps its
resume handle and `IndexReconcileService` confirms them afterwards.

If indexing has to go faster, the levers in order of effect are LLM
concurrency, then chunk size (fewer, larger chunks means fewer calls in both
phases, at the cost of graph detail), then not graph-indexing bulky reference
material at all.

**Check that a concurrency setting actually took effect.** The dev instance ran
at `max_async = 4`, the default, while its manifest set `MAX_ASYNC_LLM=8`;
`MAX_PARALLEL_INSERT` from the same manifest did apply. Upstream renamed
`MAX_ASYNC` to `MAX_ASYNC_LLM` and kept the old name as a deprecated alias, so
an image from before that rename honours only `MAX_ASYNC` and silently ignores
the new one - which is the likeliest explanation, though it was not confirmed
against the running image. Setting both names is the version-agnostic fix.

Either way, trust `GET /health` over the manifest: it reports the values in
force. The manifest itself is not in this repo - the Mazda cluster's LightRAG is
an ArgoCD app (`ranch-lightrag`) from `connectsolutions/mazda-ai-gitops`, path
`helm/ranch-lightrag`.

## A failure that passes on its own is retried on its own

Bedrock answers `ServiceUnavailableException` in waves of ten to fifteen
minutes (on dev 2026-09-17, 170 in a row between 00:14 and 00:27). LightRAG's
own retry is five attempts a few seconds apart, so it gives up inside the wave
and marks the document `failed`; the row records that, and nothing a person
could press recovered it: an Index run or a Reindex re-uploads, LightRAG
refuses the duplicate of the failed copy it still holds (`Original doc_id: X,
Status: failed`), and the row fails again with that message. The only thing
that clears a failed LightRAG document is `POST /documents/reprocess_failed`,
which re-queues everything it holds in PENDING, PROCESSING or FAILED.

So the reconciler does that. A failure whose message reads as transient
(`source/domain/indexFailure.ts`: the Bedrock wrapper's `RetryError`, a 5xx
from LightRAG, a lost connection, a refusal naming a *failed* original) earns
a retry slot on the row, `indexRetryAt`, after 5, then 15, then 60 minutes;
three retries and the row is an honest `failed`. When the slot comes and the
base's pipeline is idle, `retryFailed` puts the row back in flight under the
handle LightRAG really holds (a refusal's original, not the rejected copy) and
the pipeline is nudged; a document LightRAG no longer holds at all is uploaded
again. The usual confirm pass stamps it or records the next failure. Messages
not on the list are permanent on purpose: a wrong "permanent" costs one look,
a wrong "transient" hides a broken file behind "Retrying" for over an hour.
Add to the list from a log line, not from a guess.

Two consequences for anyone reading a row. `retrying` is a fourth source
status, derived (`indexError` set, `indexRetryAt` set, no `indexedAt`), and
is neither `failed` nor `processing` in the counts. And the reconciler now
records a LightRAG-side failure it meets on a row it was confirming instead of
dropping the handle; before that the row stayed `processing` with nothing to
confirm, which is how a base read "Indexing…" for four days over one document.
LightRAG's `updated_at` on the failed verdict travels with the row when it is
re-queued (`indexRequeuedOverAt`); seeing that same verdict again is "not
reached yet", any other timestamp is a new failure.

## LightRAG can be up and answer nothing

On 2026-09-18 LightRAG's Postgres pod was moved to another node on the Mazda
dev cluster. The data survived (PVC) and Postgres was back within a minute, but
LightRAG kept its pool of connections to the pod that was gone: `/health` and
`/documents/pipeline_status` answered in half a second, everything that touches
the database hung, and its log went silent. It does not recover by itself;
deleting the LightRAG pod is the fix. Agents saw only the MCP client's own
60 s limit (`MCP error -32001: Request timed out`), which sent people looking
at MCP.

Every call in `LightragHttpClient` is therefore bounded and a cut-short one is
a `LightragTimeoutError`: 30 s for status reads, 50 s for a query (under the
MCP client's 60 s, so `query_knowledge` answers in words), two minutes for an
upload, five for a delete. When the document listing times out, the source
gateway stops talking to that instance for the run or pass (each upload would
only run into its own limit, one after another), leaves every row as it was,
and logs one error line that names the state: "answers /health but /documents
timed out ... restart the LightRAG pod". That line is the one to alert on.

## Changing the extraction model requires clearing the LLM cache

LightRAG caches every extraction and summary response in `lightrag_llm_cache`,
keyed by the content of the chunk and the prompt. **The model is not part of
that key.** Swap `LLM_MODEL`, re-index the same documents, and LightRAG serves
the previous model's answers straight from cache: the run takes hours, costs
money on the handful of uncached chunks, and rebuilds a graph identical to the
one you were trying to replace. Nothing in the logs says "cache hit", and the
`LLM output format error` warnings reappear because malformed cached output is
re-parsed on every rebuild.

The `DELETE /documents` endpoint does not clear this table. When changing the
extraction model, in order:

```sql
TRUNCATE lightrag_llm_cache;
```

then clear the documents, then re-index. Verify the run is real before waiting
on it - fresh rows should appear for the current hour:

```sql
SELECT date_trunc('hour', create_time) AS hour, count(*)
FROM lightrag_llm_cache WHERE cache_type = 'extract' GROUP BY 1 ORDER BY 1;
```

The same applies to the embedding model, with a bigger blast radius: embedding
dimension is fixed when the vector tables are created, so changing it needs the
vector storage recreated, not just the cache emptied.

## Picking an extraction model

Entity and relation extraction asks the model for records in a fixed field
layout. Models that do not hold that layout produce records that fail to parse,
which is logged as `LLM output format error` and drops the record silently -
relations suffer worst, because a relation needs all five fields while an
entity survives on four.

Measured on the same 1181-chunk corpus:

| model | relations per chunk | format errors |
|---|---|---|
| `amazon.nova-lite-v1:0` | 12.6 | ~1 per 3 chunks |
| `amazon.nova-pro-v1:0` | 7.6 | ~1 per 3 chunks |
| `us.anthropic.claude-haiku-4-5-...` | 23.0 | 0 in ~2000 calls |

Neither Nova model is usable for this. If a model has to be evaluated, index
one document dense with short capitalised terms and punctuation inside names -
tables of UI gestures and part names are what broke the Nova models - and count
the warnings:

```bash
kubectl -n <ns> logs deploy/lightrag --since=10m | grep -c "LLM output format error"
```

Note that this counter reads the *parse* step, so it also fires when cached
output from an older model is re-parsed. Clear the cache first or the number
describes the previous model.

## A PDF without a text layer is read by Textract before LightRAG sees it

LightRAG reads PDFs with `pypdf`, which returns the text layer and nothing
else. A scanned form or a photographed page has none, so the document fails
inside LightRAG with "only whitespace" (17 of the first 651 files on dev did).
The `extraction` sub-slice runs first: when a PDF lands, `pdf-parse` measures
its text per page; under 40 characters a page it is treated as a scan and sent
to AWS Textract, the recognised text is stored next to the file as
`<key>.ocr.txt`, and the index run ingests that text under the source id
instead of uploading the file. The row carries `textState`
(`none | pending | ready | failed`) plus `textUrl` and `textError`; an index
run waits on `pending`, reports `failed` with the reason, and never writes
those columns itself. Boot re-queues `pending` rows, since the queue lives in
the API process.

A CSV goes in as text too, one line per row, each line prefixed with the
document's name and its column labels (`domain/tabularText.ts`, CLEAN-195):
a row like "Fuel Tank Capacity (gallons),,FWD 13.2 / AWD 12.7" names no model
or year, those live in the file name only, so a question that names them
never landed on the chunk while the retrieval service chunks by tokens and a
header at the top of the file is lost after the first chunk. A CSV that does
not parse as a table (one column, header only) is uploaded as the file it is.
Sources indexed before this change keep their old chunks until a Reindex.

Settings (`knowledge` group, env fallback in brackets): `ocr_enabled`
(`REINS_OCR_ENABLED`, default on) and `ocr_max_pages` (`REINS_OCR_MAX_PAGES`,
default 500; Textract bills per page). The Textract client is built from the
same `integrations/aws_*` settings as S3 and reads multi-page files straight
from the bucket (so never from a local MinIO), so the API's IAM identity needs `textract:DetectDocumentText`,
`textract:StartDocumentTextDetection` and `textract:GetDocumentTextDetection`
on top of `s3:GetObject`. Without them every scan lands in `failed` with an
`AccessDenied` reason on the row, which is visible and harmless.
`POST /knowledges/:id/sources/:sourceId/extract` (the "Re-extract text" row
action in admin) re-runs extraction for a PDF added before OCR was on or
allowed.
