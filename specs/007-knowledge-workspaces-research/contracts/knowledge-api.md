# Contract — knowledge HTTP API and agent tool

**Feature**: [spec.md](../spec.md) · **Plan**: [plan.md](../plan.md)

Ranch's HTTP contract is generated, not hand-written: `api/swagger-spec.json`
comes from the controllers and DTOs, and both consoles derive their clients from
it. This document therefore specifies the contract as **the change to make in the
controllers and DTOs**, and the regeneration that must follow. Nothing here is
edited by hand in a generated file.

Regeneration, in order, after any change below:

```bash
cd api   && bun run generate:swagger
cd admin && bun run build:api
cd app   && bun run build:api
```

---

## 1. Base-scoped graph — breaking

Today both graph endpoints are registered above `/:id` in
`knowledge.controller.ts` and take no base id, so they describe the whole
installation. That is the surface FR-004 forbids.

| Today | Becomes | Note |
|---|---|---|
| `GET /knowledges/graph/labels` | `GET /knowledges/:id/graph/labels` | gains `?search=` and `?limit=` |
| `GET /knowledges/graph?label=&maxDepth=&maxNodes=` | `GET /knowledges/:id/graph?label=&maxDepth=&maxNodes=` | served by that base's instance |

`GET /knowledges/:id/graph/labels`

- Query: `search` (optional, substring, case-insensitive), `limit` (optional,
  default 50, max 200)
- Response: `{ labels: string[], total: number, truncated: boolean }`
- Filtering happens in ranch-api: upstream's `/graph/label/list` returns an
  unfiltered list with no search of its own (research R7).
- `404` when the base does not exist; `503` with a stated reason when the base's
  instance is not ready — never an empty list, which reads as "nothing indexed"
  (FR-029).

The domain gateway signatures gain the base id they currently lack:
`getGraph(knowledgeId, input)` and `getGraphLabels(knowledgeId, input)`.

**Breaking for**: `admin` graph page and its store. No `app` surface exists.

---

## 2. Query — response gains attribution

`POST /knowledges/:id/query` keeps its shape and gains provenance.

Response:

```jsonc
{
  "answer": "…",
  "knowledgeId": "…",              // new — which base answered
  "complete": true,                // new — false while migrationState != done
  "references": [
    {
      "referenceId": "1",
      "filePath": "…",             // kept, as upstream returns it
      "sourceId": "…",             // new — resolves to a Source row
      "sourceName": "…"            // new — what to display
    }
  ]
}
```

`sourceId` is resolvable because ingest carries the source id in `file_source`
(research R4). A reference that cannot be resolved keeps `sourceId: null` rather
than being dropped — an unresolvable reference is a defect to see, not to hide.

When the base holds nothing relevant, the response says so explicitly instead of
returning a generated answer (FR-003):

```jsonc
{ "answer": null, "reason": "no_relevant_content", "knowledgeId": "…", "references": [] }
```

**Breaking for**: nothing — additive fields plus a new `answer: null` case the
console must handle.

---

## 3. Base resource — fields removed and added

`CreateKnowledgeDto` / `UpdateKnowledgeDto`:

- **removed**: `entityTypes`, `relationshipTypes` (never sent anywhere in the
  product's history — retrospective §4, FR-020). This is the contract change
  called out in the spec's assumptions.

Knowledge response gains:

- `instanceState`: `absent | starting | ready | failed | stopping`
- `instanceError`: `string | null`
- `migrationState`: `notStarted | inProgress | done | failed`
- `indexStatus`: unchanged name, now derived from sources — `empty | indexing |
  partial | ready`

`POST /knowledges` may now fail with `409` and a stated reason when cluster
capacity has no room for another retrieval instance (FR-008, research R2). The
message names the ceiling; it does not fail silently or fall back to a shared
pool.

**Breaking for**: `admin` knowledge form and types in both consoles (both
regenerate).

---

## 4. Source list — honest per-source state

`GET /knowledges/:knowledgeId/sources` — each item gains:

- `indexState`: `queued | processing | indexed | failed`
- `indexError`: `string | null`
- `indexedAt`: ISO string or null

The existing boolean `indexed` is **removed**: it meant `lightragDocId !== null`,
which is "submitted", not "searchable" (`source.mapper.ts:29`). Keeping both a
truthful state and a misleading boolean is how the misleading one survives.

New: `POST /knowledges/:knowledgeId/sources/:sourceId/reindex` — retries a single
failed source without touching the rest of the batch (FR-032).

**Breaking for**: the `admin` sources table.

---

## 5. Agent tool `query_knowledge` — the isolation surface

The MCP tool in `knowledge.tool.ts` is dynamically described per caller
(`IDynamicallyDescribedTool`). Two requirements land on it:

1. **The description lists only the caller's bound bases.** It is built from
   `effectiveKnowledgeIds` — the agent's own list, falling back to the template
   default (`agent.controller.ts:273`) — and never from a full base list. A
   description that names an unbound base is itself the disclosure FR-004
   forbids, before any query is made.
2. **The result attributes each block to its base.** The existing fan-out
   (`Promise.all(targetIds.map(…))`) becomes one retrieval per bound base against
   that base's own instance, and the tool returns blocks tagged with
   `knowledgeId` and `knowledgeName` (FR-006).

Failure of one base does not silently narrow the answer: the result names the
base that could not be reached (spec edge case).

`knowledge_id` stays an optional parameter and is **validated against the
caller's bound set** — a request naming an unbound base is refused, not
best-effort answered.

---

## 6. Endpoints that do not change

`GET /knowledges`, `GET /knowledges/status`, `GET /knowledges/:id`,
`POST /knowledges/:id/index`, `PUT /knowledges/:id`, `DELETE /knowledges/:id`,
and every `sources` write route keep their paths and request shapes. `DELETE`
gains the obligation to stop the base's instance and remove its area; that is
behaviour, not contract.
