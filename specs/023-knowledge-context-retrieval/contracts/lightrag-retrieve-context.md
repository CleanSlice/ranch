# Contract: `ILightragClient.retrieveContext`

**Feature**: [spec.md](../spec.md) | **Decisions**: research D1, D2, D3, D7

The one new call into LightRAG. The console's `query` is untouched.

## Signature

```ts
interface IRetrieveContextInput {
  knowledgeId: string;   // routes to the base's instance or the shared pool, intent 'read'
  query: string;
  mode?: QueryModeTypes; // default CONTEXT_QUERY_MODE — set by the T002 measurement
                         // (research D2, expected 'naive'); QueryModeTypes gains 'mix'
}

interface IContextResult {
  chunks: { text: string; filePath: string; chunkId: string | null }[];
  relations: { source: string; target: string; description: string }[];
  references: { referenceId: string; filePath: string }[];
  via: 'query_data' | 'only_need_context';
}

abstract retrieveContext(input: IRetrieveContextInput): Promise<IContextResult>;
```

## Request 1 — structured (preferred)

`POST {baseUrl}/query/data`, headers as every other call (`X-API-Key` when
configured), bounded by `CONTEXT_TIMEOUT_MS = 30_000` (reason: research D7).

```json
{
  "query": "<query>",
  "mode": "<CONTEXT_QUERY_MODE>",
  "top_k": 20,
  "chunk_top_k": 12,
  "include_references": true
}
```

Reasons for the numbers are in research D3 and sit beside the constants in
code. The mode constant carries the T002 measurement as its reason
(research D2, F11); the route exists on the Mazda instance (`v1.4.16`,
research F10).

Response read:

| Response | Client result |
|---|---|
| `200` with `status: "success"` | `chunks` ← `data.chunks[]` (`content` → `text`, `file_path` → `filePath`, `chunk_id` → `chunkId`); `relations` ← `data.relationships[]` (`src_id`, `tgt_id`, `description`); `references` ← `data.references[]`; `via: 'query_data'` |
| `200` with `status: "failure"` | empty result (`chunks: []`, `relations: []`, `references: []`), `via: 'query_data'`. `metadata.failure_reason` goes into one `log` line. Not an error. |
| `404` | fall through to request 2 |
| any other non-2xx | `LightragClientError` from `ensureOk`, as for `query` |
| aborted by the bound | `LightragTimeoutError('/query/data', 30000)` |

## Request 2 — text context (fallback on 404 only)

`POST {baseUrl}/query`, same bound.

```json
{
  "query": "<query>",
  "mode": "mix",
  "top_k": 20,
  "chunk_top_k": 12,
  "only_need_context": true,
  "include_references": true
}
```

`response` is the context template (research F6). The client parses the
fenced JSON arrays under "Knowledge Graph Data (Relationship)" and "Document
Chunks" and the `[n] file_path` lines under "Reference Document List".
Entities are ignored. If the "Document Chunks" fence is missing or does not
parse, the call fails with `LightragClientError` naming the parse — never a
silent empty result, never the raw text as a passage. `via:
'only_need_context'`.

## Both paths

- A chunk item without string `content` and `file_path` is dropped; the
  count of dropped items is logged at `warn`.
- Order is preserved exactly.
- The first time a base URL answers on each path the client logs
  `context via <path> for <baseUrl>` once (research D1).
- No field of the response that a model wrote at query time is forwarded:
  `response` text (outside the fences), `llm_response`, prompts.

## Tests (`lightragHttp.client.spec.ts`)

1. Sends `/query/data` with the body above; maps chunks, relations,
   references; `via: 'query_data'`.
2. `status: "failure"` → empty result, not a throw.
3. `404` on `/query/data` → `/query` with `only_need_context: true`; fenced
   JSON parsed; `via: 'only_need_context'`.
4. `404` then unparseable text → `LightragClientError`.
5. Hanging `/query/data` → `LightragTimeoutError` after 30 s (fake timers),
   no timer left behind.
6. `500` → `LightragClientError` passes through untouched.
