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
