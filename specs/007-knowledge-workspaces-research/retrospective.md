# Knowledge (`reins`) — current-state retrospective

**Date**: 2026-08-26 · **Tracker**: [CLEAN-48](https://dreamvention.atlassian.net/browse/CLEAN-48)

This is the evidence document behind `spec.md`. It answers one question the spec
only states as an outcome: **where does the data on the Query and Graph tabs
actually come from?** Everything below was read out of the repository at
`955516f`; file references are `path:line`.

---

## 1. What exists today

| Surface | Where | What it does |
|---|---|---|
| Sidebar entry "Knowledges" | `admin/slices/reins/plugins/menu.ts` | Main group, sort 30 |
| List | `pages/knowledges/index.vue` → `components/knowledge/list/Provider.vue` | Setup wizard until the service is ready, then one flat table of every base |
| Create | `pages/knowledges/create.vue` | Name + description only |
| Base shell | `pages/knowledges/[id].vue` | Header, index status, **Index** button, 4 tabs |
| General | `[id]/edit.vue` | Name + description |
| Sources | `[id]/sources.vue` | Add file / url / text, add-from-sitemap, add-from-zip, list, delete |
| Graph | `[id]/graph.vue` | Entity picker, max depth, max nodes, Sigma canvas, legend |
| Query | `[id]/query.vue` | Question, mode, top-K, answer + references |
| Agent binding | `admin/slices/agent/agent/components/agent/item/Form.vue:210-235` | Checkbox column of every base |
| Template binding | `admin/slices/agent/template/components/template/item/Form.vue:147` | Same |
| Agent read-only view | `agent/knowledge/Tab.vue` | Lists the bases resolved for that agent |
| Agent runtime | `api/src/slices/reins/knowledge/knowledge.tool.ts` | MCP tool `query_knowledge` |

There is **no `app/` (end-user console) surface at all** — knowledge is
admin-only, as the original design deliberately scoped it.

`README.md:97` still describes the slice as "Access control / API keys". It is
the knowledge slice. Documentation drift.

There are **no tests** anywhere under `api/src/slices/reins/` or
`admin/slices/reins/`.

---

## 2. Where the data comes from — the ingest side

All three source types funnel into a single external retrieval service
(LightRAG), one document at a time, only when an operator presses **Index**:

- **file** — uploaded to S3 under `knowledges/{knowledgeId}/…`
  (`source/data/source.gateway.ts:44`), downloaded again at index time and
  forwarded as a multipart upload.
- **url** — *not* fetched at add time. At index time `ranch-api` fetches the
  page itself with a browser user-agent and reduces the HTML to text with a
  regex stripper (`lightrag/data/lightragHttp.client.ts`, `stripHtmlToText`),
  then posts that text.
- **text** — posted verbatim.

Bulk entry points: multi-file upload (cap 250 files,
`source/source.controller.ts:38`), zip archive (cap 1 GiB, processed in the
background), and `sitemap.xml` import, which creates one `url` source per
discovered page.

Indexing is incremental in one direction only: `runIndex` skips any source that
already has a document id (`knowledge/domain/knowledge.service.ts`, `if
(source.indexed) continue`). **A source is never re-fetched or re-indexed.** A
URL source is frozen at whatever the page said the first time it was indexed.

---

## 3. Where the data comes from — the retrieval side (the actual finding)

Ranch computes a per-base namespace, `workspaceOf(id) =
knowledge_<uuid-without-dashes>` (`lightrag/data/workspace.ts`), and the
original design recorded the intent plainly:

> "Each `Knowledge` row maps to one LightRAG workspace (namespace-level
> isolation inside a single LightRAG instance)."
> — `docs/superpowers/specs/2026-04-23-reins-lightrag-integration-design.md:75`

That isolation does not exist in the running system. Two independent reasons:

**(a) Ranch only attaches the namespace to writes.**

| Call | Namespace sent? | Evidence |
|---|---|---|
| ingest text | yes | `lightragHttp.client.ts` — `workspace` in the JSON body |
| ingest file | yes | `form.append('workspace', …)` |
| **query** | **no** | `query()` builds `{query, mode, top_k, include_references}` — `input.workspace` is accepted by the interface and then dropped |
| **graph** | **no** | `getGraph()` sends only `label`, `max_depth`, `max_nodes` |
| **graph labels** | **no** | `getGraphLabels()` sends nothing |
| **delete documents** | **no** | scoped by document id instead, which happens to work |

`KnowledgeGateway.getGraphLabels()` / `.getGraph()` do not even take a knowledge
id (`knowledge/data/knowledge.gateway.ts`), and the HTTP routes for them sit
*above* `/:id` in the controller — `GET /knowledges/graph` is a **global**
endpoint, not a per-base one (`knowledge.controller.ts:100-118`).

**(b) The retrieval service does not accept a per-request namespace anyway.**

LightRAG's `workspace` is an *instance-level* setting, fixed at process start
(`WORKSPACE` env var or `--workspace` CLI flag) and documented as **immutable
after initialization**. Isolating two corpora means running two configured
instances — the project's own "multi-site deployment" guidance. There is no
per-request workspace field and no per-document filter on query
(`QueryParam` has modes and token budgets, no document/id scoping).

And the deployed instance sets no workspace at all: neither
`k8s/platform/lightrag/deployment.yaml` nor `api/docker-compose.yml` defines
`WORKSPACE`. Everything lands in the default namespace.

### What that means in the product

1. Every knowledge base writes into **one shared corpus**.
2. **Query on base A answers from A, B, C and everything else ever indexed.**
   That is the direct cause of "не понятно, откуда большинство данных берётся".
3. The **Graph tab and its Entity list show the whole instance**, not the base
   you opened. The picker is not "entities of this base" — it is "entities of
   everything".
4. The `query_knowledge` tool's headline feature — "omit `knowledge_id` to
   search all your bound bases" — fans out N calls that all hit the same corpus
   and return near-identical answers at N× the LLM cost
   (`knowledge.tool.ts`, multi-base branch).
5. Deletion is the one thing that *is* scoped, because it works by document id.
6. Nothing enforces that a base an agent is bound to is the base that answers.

---

## 4. Settings nobody can interpret

| Setting | Where | Reality |
|---|---|---|
| `entityTypes` | DB column, DTOs, domain types, admin mapper | **Dead.** Never sent anywhere. Grep shows reads and writes only within the persistence and API-typing layers. The design intended it to constrain entity extraction; nothing consumes it. |
| `relationshipTypes` | same | **Dead**, same story. |
| `workspace` column | `Knowledge.workspace @unique` | Written as `'pending'` then patched to `workspaceOf(id)` on create; **never read at runtime** — the 2026-05-01 refactor replaced it with the pure function and kept the column for its unique constraint. |
| Graph **Max depth** / **Max nodes** | Graph tab | Forwarded, but against a global corpus their meaning is arbitrary — they bound a traversal over everyone's data. |
| Query **Mode** (hybrid/local/global/naive) | Query tab | Forwarded, unexplained in the UI. The `mix` mode — the one the upstream project recommends when a reranker is on — is not offered. |
| Query **Top K** | Query tab | Forwarded, unexplained. |
| Setup step "Restart LightRAG" | Setup wizard | Asks the operator to copy `make dev` or a `kubectl rollout restart` into a terminal to apply credentials chosen in the UI. |

Note that the **General tab shows only name and description** — the two array
settings are no longer even editable (`components/knowledge/item/Form.vue`), yet
they remain in the schema, the DTOs and the generated SDK. What the user
perceives as "непонятные настройки" is the residue: knobs that exist in the
contract, are described in the docs, and do nothing.

---

## 5. Status that is not true

- `Source.indexed` is derived as `lightragDocId !== null`
  (`source/data/source.mapper.ts`). The id it stores is a **track id returned at
  submission**; the service processes the document asynchronously afterwards.
  So the badge means *submitted*, not *searchable*.
- `Knowledge.indexStatus = 'ready'` is set when at least one source got a track
  id back (`knowledge.service.ts`, `runIndex`).
- Consequence: a base can read **ready / Indexed** while nothing is retrievable
  yet, and there is no per-source progress, no per-source error — every failure
  in a run is flattened into one truncated `indexError` string ("5 source(s)
  failed: … ; ...").
- There is a `track_status` endpoint the client already calls for deletion
  (`resolveDocIdsByTrackId`) — the pipeline state exists, it is just never
  surfaced.

---

## 6. UI defects, root-caused

**Tabs never highlight the active one** — `pages/knowledges/[id].vue:100-112`.
The link carries `class="border-b-2 border-transparent … text-muted-foreground"`
and `active-class="border-primary text-foreground"`. Both pairs set the same CSS
properties (border-color, color) at the same specificity, so the winner is
stylesheet order, not attribute order — the base utilities win and the active
state is invisible. Neighbouring navs (`setting/nav/Menu.vue`,
`llm/nav/Menu.vue`) have the same conflict but survive it because their active
class also sets `bg-muted`, which nothing else claims. Secondary: there is no
`[id]/index.vue`, so opening `/knowledges/:id` directly renders the shell with
an empty body and no tab selected at all.

**Entity picker freezes the page** —
`components/knowledge/graph/Provider.vue`. `loadLabels()` pulls every graph
label in one call and the template renders one `SelectItem` per label with no
search, no windowing, no paging. Two multipliers: the labels are global (§3), so
the list grows with the whole instance rather than with your base; and the
select mounts the full option list on open. On a real corpus that is thousands
of DOM nodes in one synchronous mount.

**Other rough edges**

- List: client-side substring search only, no pagination, no sort, no grouping
  (`list/Provider.vue`).
- Binding UI: a `max-h-64` scroll box of checkboxes over *every* base, in both
  the agent and the template form.
- `Agent.knowledgeIds` is a bare `String[]` with no foreign key
  (`agent/agent/agent.prisma`) — deleting a base silently leaves dangling ids on
  agents and templates.
- The Query tab's mode selector is a raw `<select>` while the rest of the
  console uses the design-system `Select`.
- The base shell polls every 3 s while indexing (`useIntervalFn`) — fine, but it
  is the only progress signal that exists.

---

## 7. Known patterns we do not have

Ordered by what would move the needle for Ranch, not by effort.

| # | Pattern | State today |
|---|---|---|
| 1 | **Retrieval isolation / tenancy** | Intended, never realized (§3) |
| 2 | **Grouping / navigation above a flat list** | Absent — one flat, unpaginated list; the half of the workspace ask that survives (D4) |
| 3 | **Honest ingestion pipeline state** (queued → parsing → chunked → embedded → searchable, per source) | Absent (§5) |
| 4 | **Incremental refresh & re-crawl** (re-index one source, scheduled sitemap refresh, ETag/Last-Modified) | Absent — index once, forever |
| 5 | **Content-hash dedup** | Only name/URL dedup, so the same document under two names indexes twice |
| 6 | **Reranking** | Deferred in the original design, still off |
| 7 | **`mix` retrieval mode** | Not offered |
| 8 | **Citations that resolve back to a source** | References return raw file paths; nothing links to the Source row or the stored file |
| 9 | **Chunk inspection** ("what did this document actually become?") | Absent — no way to debug a bad answer |
| 10 | **Retrieval evaluation** (golden Q/A, regression on re-index) | Absent — though `paddock` already ships a judge-panel harness for agents |
| 11 | **Query logging + cost metering** | Absent — `usage` meters agents, not knowledge queries |
| 12 | **Referential integrity / access control on bindings** | Absent (§6) |
| 13 | **Extraction quality** (readability/markdown instead of regex tag-strip; PDF/table handling) | Regex stripper, acknowledged as "crude" in its own comment |
| 14 | **Empty-context handling** | A query with no relevant context still returns a generated answer; nothing tells the user "not in this base" |
| 15 | **Per-base retrieval prompt / persona** | Absent |
| 16 | **End-user surface** | Absent — no `app/slices/reins` |
| 17 | **Tests** | Absent for the whole slice |

---

## 8. Best cases for Ranch (proposals)

1. **A base that is actually a base.** One base, one isolated area, one thing an
   agent is given — the model the code already assumes and the product owner
   confirms. Everything else on this list gets easier once an answer can be
   traced to the base it came from.

2. **Rancher's own operations knowledge** — the admin agent already exists and
   already has an MCP tool; a curated base of runbooks, the k8s manifests and
   the CLI docs makes it genuinely useful instead of generically chatty.
3. **Template-level default knowledge as a product feature.** Ship a template
   *with* its knowledge, so cloning an agent clones what it knows.
4. **Paddock for knowledge.** The judge-panel evaluation harness
   (`api/src/slices/paddock/`) already scores agent answers against expected
   behaviour. Pointing it at a per-base golden Q/A set turns "did the re-index
   break retrieval?" into a number.
5. **Knowledge queries in `usage`.** Every query is an LLM call today and none
   of it is metered.
6. **An `app/` surface** — let the end user drop a file into the base their
   agent reads, without an admin round-trip.

---

## 9. Risks to carry into planning

The scope questions below were answered in `spec.md`. The product answer of
2026-08-27 — Ranch is personal, and an agent given one base must not reach into
or inspect another — reversed two earlier decisions; the reasoning is kept here
because it is what makes them re-litigable.

- **Isolation has a footprint, and it is now the central engineering problem.**
  Isolating a corpus costs a running retrieval process: ten isolated bases would
  reserve roughly 5 CPU and 10 GiB idle at the current per-instance request
  (`k8s/platform/lightrag/deployment.yaml`), before counting the two 10 GiB
  volumes that manifest also claims. Grouping several bases behind one process
  was the earlier escape (D2, first version), and the product answer closes it:
  bases sharing a pool is exactly the leak that is forbidden. Since every storage
  backend here is Postgres — where the isolation namespace is a logical field in
  shared tables — an area costs a process, not a database. **Planning owes an
  arrangement, not a compromise**: right-sized instances, start-on-demand, a
  pool, or a ceiling that is reported rather than silently exceeded.
- **The transition is a full re-index, and it is affordable.** The shared pool
  holds every base's content with no marker that retrieval honours, so it cannot
  be split after the fact — every source is re-processed into its own area.
  Nothing is lost and the operator supplies nothing: `ingestByType` in
  `source/data/source.gateway.ts` already rebuilds every type from Ranch's own
  storage — text from `Source.content`, web addresses by re-fetching
  `Source.url`, files by downloading `Source.url` from S3. The costs are model
  usage, a window in which bases answer incompletely, and sources whose origin
  has since disappeared. **Decided (D3, reversed): one automatic, resumable
  re-index, reported per base.**
- **The agent tool's fan-out becomes correct rather than wasteful.**
  `knowledge.tool.ts` already issues one retrieval per bound base
  (`Promise.all(targetIds.map(…))`). Today that is N queries against one shared
  pool — pure waste. Once each base is its own area it becomes the only way to
  read several bases at once, and what changes is that the answer must attribute
  each part to the base it came from.
- **Not seeing is part of the requirement.** The product answer forbids an agent
  from *looking at* what another base holds, not only from quoting it. The graph,
  the entity list, and any tool description that enumerates bases are therefore
  in scope for isolation — not just `/query`.
- **`entityTypes` / `relationshipTypes` are in the generated SDK.** Removing them
  is a contract change across `api`, `admin` and `app` type generation.
- **The setup wizard's manual restart step** becomes worse, not better, as the
  number of instances grows. With a process per base, "who restarts what, and
  when" is a design question rather than a footnote — creating a base has to
  bring its area up without an operator pasting a command.
- **`Knowledge.workspace` is a column nobody reads.** It is written as `'pending'`
  and patched to `workspaceOf(id)` on create, then never read at runtime (§4).
  Once the namespace becomes load-bearing, planning has to decide whether that
  column becomes the source of truth or is dropped in favour of the pure
  function — keeping both is how the two drift apart.
