# Tasks: Knowledge Retrieval Hands the Agent the Found Passages, Not Another Model's Answer

**Input**: Design documents from `/specs/023-knowledge-context-retrieval/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included — the spec's Done-when requires specs beside the slice (SC-005), and the repo's rule is the failing test first. Every test task is written and seen to fail before the implementation task that follows it.

**Organization**: grouped by user story. US1 is the defect; US2 makes it safe; US3 proves nothing regressed; US4 is the separable console flag.

**Ticket**: [CLEAN-184](https://dreamvention.atlassian.net/browse/CLEAN-184) — `[ADMIN][API]`, labels `api`, `admin`, `mazda`. Branch `fix/CLEAN-184-knowledge-context-retrieval`, worktree `E:/code/dream/cleanslice/ranch/worktrees/knowledge-context`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md
- Paths are repository-relative

## Path Conventions

Monorepo: `api/src/slices/reins/…` (NestJS), `admin/slices/reins/…` (Nuxt). Tests live beside the code as `*.spec.ts` and run with `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>` — never `bun run test` while a dev API runs. `cd api && bun run build` is the typecheck.

---

## Phase 1: Setup (evidence before code)

**Purpose**: prove, on real data, that the passages route holds the answer the agent failed to give; take the "before" measurement while the old path is still deployed. T002 is what answers "will this actually fix the agent's answers": if the AFS table does not come back from `/query/data` for the production question, the design changes before a line is written.

- [x] T001 Prepare the worktree: `cd api && npx prisma-import --force && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx prisma generate`; confirm `NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/reins` and `bun run build` are green on the untouched branch; note any baseline failure in `specs/023-knowledge-context-retrieval/research.md` under a new "F12. Baseline" heading
- [x] T002 **Done 2026-10-28** — result in research F13, decisions in D14: `/query/data` works on 1.4.16; mode `naive`; chunks ~4 600 chars; the natural AFS question retrieves the Genius answer sheets (also in prod) and older charts, never the 26MY deck; the deck surfaces for queries in its own wording. Original instructions kept for a re-run: evidence gate against the Mazda instance on `mai-dev` (read-only; the `mazda` AWS profile is enough — same LightRAG `v1.4.16`, same corpus: base "Mazda", 751 sources vs 759 on prod; the 26MY Mazda3 Spec Deck is present as DOCX + CSVs, the PDF has no text layer); `AWS_PROFILE=mazda aws eks update-kubeconfig --region us-east-2 --name mai-dev-use2-eks`, then `kubectl -n ranch port-forward svc/lightrag 9621:9621`; `GET /health` for `core_version` / `api_version`; then `POST /query/data` with `{"query":"For the Mazda3 hatchback what trim levels come with adaptive headlights?","mode":"<m>","top_k":20,"chunk_top_k":12,"include_references":true}` for `<m>` in `naive`, `global`, `mix`, and the hub question `"what is Mazda"` in the same three modes; record in `research.md` (F13) per mode and question: HTTP status, chunk count, rank and `file_path` of the first chunk whose `content` holds the AFS trim table, total chunk characters, elapsed ms; apply the D2 selection rule and set `CONTEXT_QUERY_MODE` from it; if no mode returns the table, stop and revise D2/D3 before Phase 2. Send the `X-API-Key` from the `lightrag-api` secret in the request headers; never print it
- [x] T003 [P] **Done 2026-10-28, research F15** (sync route, bearer + reset per run; medians 6.6 / 4.5 / 2.4 s, uncached 24.5 / 30.9 / 10.2 s; Q1 hedged 1/3). "Before" timing for SC-004 on `mai-dev`, **before the fork PR from T035 is merged into `dev`** (the old path is still deployed there, image `api-20261023-160054`): create an agent on dev bound to the "Mazda" base, ask it the AFS question and two table questions from `quickstart.md` step 5, three runs each, record question→first-token time and the `query_knowledge` duration from the session events in `research.md` (F14); confirm the dev agent shows the same hedged AFS answer as prod did (if it answers correctly every time on dev, say so — the corpus or model differs and the staging proof is weaker); keep the raw tool result of one AFS run as the "before" sample for the PR
- [ ] T004 [P] Post the Phase 1 findings as a checkpoint comment on CLEAN-184 (what T002 showed, go/no-go, any change to D2/D3)

---

## Phase 2: Foundational (types every story builds on)

**Purpose**: the shapes from data-model.md, so client, service, fitting and tool can be written against them in parallel.

- [x] T005 Add `'mix'` to `QueryModeTypes` and add `IRetrieveContextInput`, `IContextChunk`, `IContextRelation`, `IContextResult` (with `via: 'query_data' | 'only_need_context'`) in `api/src/slices/reins/lightrag/domain/lightrag.types.ts` per `contracts/lightrag-retrieve-context.md`
- [x] T006 Add `abstract retrieveContext(input: IRetrieveContextInput): Promise<IContextResult>` to `api/src/slices/reins/lightrag/domain/lightrag.client.ts` and a stub implementation that throws `not implemented` in `api/src/slices/reins/lightrag/data/lightragHttp.client.ts` so the build stays green
- [x] T007 [P] Add `IKnowledgePassage`, `IKnowledgeContextResult` to `api/src/slices/reins/knowledge/domain/knowledge.types.ts` per data-model.md ("Service → tool"); leave `reason` on `IKnowledgeQueryResult` untouched until US4
- [x] T008 [P] Create `api/src/slices/reins/knowledge/domain/knowledgeContext.ts` with the constants and their reasons as comments: `TOOL_RESULT_BUDGET_CHARS = 12_000`, `MIN_BUDGET_PER_BASE = 2_000`, `MAX_FACTS = 8`, `MAX_FACT_CHARS = 200`, the `…[cut +N chars]` marker form, and the exported types for the fitting input/output (function body comes in US2)
- [x] T009 Add `abstract retrieveKnowledgeContext(knowledgeId, query, mode?)` to `api/src/slices/reins/knowledge/domain/knowledge.gateway.ts` and implement it in `api/src/slices/reins/knowledge/data/knowledge.gateway.ts` as a pass-through to `this.lightrag.retrieveContext(...)`; `cd api && bun run build` green

**Checkpoint**: types compile; nothing behaves differently yet.

---

## Phase 3: User Story 1 — The agent answers from the document's own words (Priority: P1) 🎯 MVP

**Goal**: `query_knowledge` returns verbatim passages bound to their source, no text written by the retrieval service; the Mazda AFS case is a jest regression.

**Independent Test**: `knowledge.tool.spec.ts` Mazda regression passes (passages contain "2.5 S Premium" and "2.5 Turbo Premium Plus", source is the spec deck, no refusal sentence anywhere in the serialized result); `lightragHttp.client.spec.ts` shows `/query/data` is called with the contract body and parsed; on the installation from T002 the AFS question is answered directly (quickstart steps 1–4).

### Tests for User Story 1 (write first, watch them fail)

- [x] T010 [P] [US1] In `api/src/slices/reins/lightrag/data/lightragHttp.client.spec.ts` add cases 1, 2, 5, 6 from `contracts/lightrag-retrieve-context.md`: `/query/data` request body and mapping of chunks/relations/references with `via: 'query_data'`; `status: "failure"` → empty result; hanging call → `LightragTimeoutError` at 30 s with no timer left; `500` passes through as `LightragClientError`
- [x] T011 [P] [US1] In the same spec add cases 3 and 4: `404` on `/query/data` → `/query` with `only_need_context: true` and the fenced-JSON context parsed (`via: 'only_need_context'`); `404` then text without a "Document Chunks" fence → `LightragClientError` naming the parse
- [x] T012 [P] [US1] In `api/src/slices/reins/knowledge/knowledge.tool.spec.ts` switch the harness mock from `knowledgeService.query` to `retrieveContext` returning `IKnowledgeContextResult`, and add the **Mazda AFS regression**: a chunk whose text holds the AFS trim table under `filePath: '26MY Mazda3 Spec Deck.pdf'` → `passages[0].text` contains "2.5 S Premium" and "2.5 Turbo Premium Plus", `passages[0].source` is the deck, `source_id` is the resolved row, and the serialized result contains none of: "I do not have sufficient information", "not able to provide", "[no-context]"
- [x] T013 [P] [US1] In `knowledge.tool.spec.ts` add: zero chunks and zero facts → `reason: 'no_relevant_content'`, `passages: []`, `sources: []`; a chunk with identical text twice → one passage; a chunk whose `filePath` resolves to no row → kept with `source_id: null`, absent from `sources`, one `warn` logged

### Implementation for User Story 1

- [x] T014 [US1] Implement `retrieveContext` in `api/src/slices/reins/lightrag/data/lightragHttp.client.ts`: `CONTEXT_TIMEOUT_MS = 30_000` with the D7 reason, `/query/data` body per contract (`CONTEXT_QUERY_MODE` from T002 with the F13 measurement as its comment, `top_k: 20`, `chunk_top_k: 12` as named constants with the D3 reasons; do not touch the body of `query()` — the fork keeps its own `'global'` default there, research D13), `extractContextResult` for the structured body, `status: "failure"` → empty result with one `log` line, non-404 errors through `ensureOk`, `bounded(...)` as for every other call; T010 green
- [x] T015 [US1] Add the 404 fallback in the same file: second request to `/query` with `only_need_context: true`, `parseContextText` that reads the "Knowledge Graph Data (Relationship)" and "Document Chunks" JSON fences and the "Reference Document List" lines (research F6), throws `LightragClientError` when the chunks fence is missing or unparseable; log `context via <path> for <baseUrl>` once per base URL and path; T011 green
- [x] T016 [US1] Implement `KnowledgeService.retrieveContext(knowledgeId, query)` in `api/src/slices/reins/knowledge/domain/knowledge.service.ts`: `get` + `requireReadable`, `complete` flag, the empty-isolated-base veto returning `reason: 'no_relevant_content'` without calling the gateway, `gateway.retrieveKnowledgeContext`, per-chunk binding through `resolveReference` on `filePath` and `resolveAdoptedReferences` via `listDocuments` when any passage is unresolved (same `warn` on failure as `query`), dedup by exact text keeping first occurrence, `facts` from relations as `"<source> — <target>: <description>"` capped by `MAX_FACTS` / `MAX_FACT_CHARS`, `references` one per distinct `filePath` for `sourcesOf`
- [x] T017 [US1] Rewire `KnowledgeTool.query` in `api/src/slices/reins/knowledge/knowledge.tool.ts` to call `retrieveContext`, build the per-base block (`knowledge_id`, `knowledge_name`, `complete`, `passages[{source, source_id, text}]`, `facts`, `sources` via the existing `sourcesOf`, `reason` / `error` as today), keep the fan-out and shared-pool rule and the timeout wording untouched; `truncated: false` for now (US2 fills it); T012, T013 green
- [x] T018 [US1] Replace `BASE_DESCRIPTION` and the comment above it in `knowledge.tool.ts` with the text from `contracts/query-knowledge-result.md` ("Tool description"), including the "Phrasing lookups" paragraph (research D14: spec-sheet vocabulary, exact trim names, model year, one more lookup in document terms before concluding); keep the dynamic suffix in `describeForRequest`; update the existing description assertion in `knowledge.tool.spec.ts` if it quotes the old sentence
- [x] T019 [US1] Add the per-lookup `log` line in `knowledge.tool.ts` (base id, `via`, chunks received, passages kept/omitted, serialized size, elapsed ms — research D10); run `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/reins/lightrag src/slices/reins/knowledge/knowledge.tool.spec.ts && bun run build`

**Checkpoint**: US1 complete — commit 1 (`fix(reins): query_knowledge hands the agent the retrieved passages, not a generated answer (CLEAN-184)`); results may still exceed the budget on big bases until US2.

---

## Phase 4: User Story 2 — Every lookup result fits the agent's window, whole (Priority: P2)

**Goal**: each tool result is ≤ 12 000 characters of compact JSON, whole passages in relevance order, `truncated` / `omitted_passages` honest, budget divided across bases.

**Independent Test**: the budget cases in `knowledge.tool.spec.ts` pass (30×1 000-character chunks → ≤ 12 000, parses, `truncated: true`, correct `omitted_passages`; a 14 000-character single passage → cut with marker; two bases → each block ≤ 6 000); quickstart steps 5–7 on the installation show every result under budget.

### Tests for User Story 2 (write first)

- [x] T020 [P] [US2] Create `api/src/slices/reins/knowledge/domain/knowledgeContext.spec.ts` for the pure functions: `excerptAround(text, queryTerms, maxChars)` — picks the window with the most term hits, snaps to line boundaries, falls back to the head, marks cut sides with `…[+N chars before]` / `…[+N chars after]`, never changes the kept characters; `fitContextToBudget(block, query, budgetChars)` — frame cost counted, dedup on full text before cutting, passage 1 whole up to 5 000 (else cut with the after-mark), passages 2+ as ≤ 2 000-char excerpts, added in order while they fit, facts after passages and dropped first, `omitted` / `truncated` / per-passage `cut` reported, `JSON.stringify(block).length` ≤ budget in every case. Use twelve realistic ~4 600-char chunks (F13 sizes) as the main fixture and assert at least four passages survive
- [x] T021 [P] [US2] In `knowledge.tool.spec.ts` add the budget cases from `contracts/query-knowledge-result.md` tests 2–4 and 6: 30 chunks × 1 000 chars → serialized text ≤ 12 000, `JSON.parse` succeeds, `truncated: true`, `omitted_passages` = 30 − kept; one 14 000-char chunk → passage 1 cut at 5 000 with the mark; twelve 4 600-char chunks → ≥ 4 passages, passage 1 whole, passages 2+ ≤ 2 000 and marked; two bound bases → each block ≤ 6 000 and the envelope parses; passages filling the budget → `facts` absent

### Implementation for User Story 2

- [x] T022 [US2] Implement `excerptAround` and `fitContextToBudget` in `api/src/slices/reins/knowledge/domain/knowledgeContext.ts` per data-model.md "Fitting" (constants `FIRST_PASSAGE_MAX_CHARS = 5_000`, `PASSAGE_MAX_CHARS = 2_000` with the D14/F13 reason beside them; a small English stopword list in the same file), returning the fitted block and `{ kept, omitted, cut }`; T020 green
- [x] T023 [US2] In `knowledge.tool.ts`: serialize this tool's result compactly (`JSON.stringify(value)` via a local `okCompact`, leaving the shared `ok()` alone), compute `budgetPerBase = max(MIN_BUDGET_PER_BASE, floor(TOOL_RESULT_BUDGET_CHARS / queryIds.length))`, run each block through `fitContextToBudget`, set `truncated` / `omitted_passages`, feed `kept/omitted` into the T019 log line; T021 green; `bun run build`

**Checkpoint**: US2 complete — commit 2 (`fix(reins): fit query_knowledge results to the runtime's window (CLEAN-184)`).

---

## Phase 5: User Story 3 — Nothing the knowledge tool already guarantees is lost (Priority: P2)

**Goal**: isolation, empty-base veto, shared-pool-once, per-base failure isolation, timeout wording, source binding and the CLEAN-138 `sources` list all hold on the new path, proven by the existing specs moved onto it plus one new isolation case.

**Independent Test**: `knowledge.isolation.spec.ts` and `knowledge.tool.spec.ts` pass with their fakes serving `/query/data`; the new case shows a passage from an unbound base never reaches the caller; quickstart steps 11–13.

### Tests for User Story 3 (write first)

- [x] T024 [P] [US3] In `api/src/slices/reins/knowledge/knowledge.isolation.spec.ts` make the fake `fetch` serve `/query/data` for K1 (a chunk with the Falkirk fact, `file_path: 'src-k1'`), K2 (`status: 'failure'`) and the shared endpoint (a poisoned chunk), switch the gateway mock to `retrieveKnowledgeContext` → `client.retrieveContext`, and drive SC-001 through `service.retrieveContext`: K1 answers with the passage bound to its row; K2 → `no_relevant_content` with no borrowed passage; the empty isolated base is not fetched; a `done` base with its instance down throws `ServiceUnavailableException` and never hits the shared endpoint; the pre-migration base reads the shared endpoint
- [x] T025 [P] [US3] In `knowledge.isolation.spec.ts` add the US3 scenario 4 case: an agent-visible result built from two bases where only K1 is bound → no chunk text from K2 appears anywhere in the serialized output (reuse the tool harness pattern from `knowledge.tool.spec.ts` SC-002 if the service-level case cannot express it)
- [x] T026 [P] [US3] In `knowledge.tool.spec.ts` confirm the carried-over cases still assert the same guarantees on the new path: unreachable base named with the timeout sentence (now mentioning `/query/data` and 30 000 ms); shared-pool bases asked once; fan-out blocks each carry their own `sources`; CLEAN-138 "no references, no sources — an empty list"; adjust only the mock shapes, never the assertions' intent

### Implementation for User Story 3

- [x] T027 [US3] Fix whatever T024–T026 expose in `knowledge.service.ts` / `knowledge.tool.ts` / `lightragHttp.client.ts` (expected: the timeout path string, the `complete` flag on `no_relevant_content`, the `sources` list on fan-out blocks); do not weaken a test to pass
- [x] T028 [US3] Run the whole slice: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/reins && bun run build`; then the full `npx jest` once; record the counts for the PR

**Checkpoint**: US1–US3 complete — commit 3 (`test(reins): the knowledge guarantees hold on the passages path (CLEAN-184)`); post a checkpoint comment on CLEAN-184.

---

## Phase 6: User Story 4 — The console's written answer stays, and a half-refusal is marked as one (Priority: P3)

**Goal**: `POST /knowledges/:id/query` unchanged for real answers; a partial refusal comes back as `reason: 'partial_refusal'` and the admin Query tab says so.

**Independent Test**: detection cases in `knowledge.isolation.spec.ts` pass for every sentence in `contracts/console-query-refusal.md`; the console regression case shows prose stays prose; `npx nuxt typecheck` in admin is clean with the regenerated SDK; quickstart steps 14–15.

### Tests for User Story 4 (write first)

- [x] T029 [P] [US4] In `knowledge.isolation.spec.ts` ("no-relevant-content detection") add `isPartialRefusal` cases for each listed sentence (including "No relevant context found for the query.") → true, and for a real answer and the `[no-context]` answer → false; add a `KnowledgeService.query` case: fake `/query` returning a partial-refusal sentence → `answer: null`, `reason: 'partial_refusal'`; fake returning prose → `answer` is the prose and `reason` is absent

### Implementation for User Story 4

- [x] T030 [US4] Add `isPartialRefusal(answer)` beside `isNoRelevantContentAnswer` in `api/src/slices/reins/knowledge/domain/knowledge.service.ts` with the phrase list and its provenance comment; in `query()` check it after the existing detector and return `answer: null, reason: 'partial_refusal'`; widen `reason` on `IKnowledgeQueryResult` in `api/src/slices/reins/knowledge/domain/knowledge.types.ts`; T029 green
- [x] T031 [US4] Widen the enum on `KnowledgeQueryResultDto.reason` in `api/src/slices/reins/knowledge/dtos/knowledgeRecord.dto.ts` (`@ApiPropertyOptional({ enum: ['no_relevant_content', 'partial_refusal'] })`), then regenerate: `cd api && bun run build && bun run generate:swagger && cd ../admin && bun run build:api`; review the SDK diff — keep only this enum change unless older drift is confirmed typecheck-clean, and say so in the PR
- [x] T032 [US4] In `admin/slices/reins/components/knowledge/query/Provider.vue` branch the `result.answer === null` box on `result.reason === 'partial_refusal'` with the copy from `contracts/console-query-refusal.md`; keep the existing copy for `no_relevant_content`; `cd admin && npx nuxt typecheck` clean (not the `typecheck` script that regenerates)

**Checkpoint**: US4 complete — commit 4 (`fix(admin,api): the console marks a partial refusal from the retrieval model as one (CLEAN-184)`).

---

## Phase 7: Polish, validation and delivery

**Purpose**: docs that must stay true, the staging proof the ticket's Done-when demands, and the PR.

- [ ] T033 [P] Add a short paragraph to `api/src/slices/reins/README.md` after the shared-pool note (L37): the agent path returns verbatim passages from `/query/data` (fallback `only_need_context`) and composes its own answer; the console path still asks LightRAG for a written answer; the 12 000-character budget and why
- [ ] T034 [P] Walk the review checklist at the end of `docs/agent-tools.md` for `query_knowledge` and note the four answers in the PR body draft (tool in slice with metadata; nothing destructive; no secret in results; calls the service, not a copy)
- [x] T035 **Done 2026-10-28** (fork PR #52 merged into dev, image api-20261028-164624, agent restarted; Q1 5/5 direct, Q6 correct on the final answer, Q5 wrong-confident — research F16). Get the change onto `mai-dev` (research D11/D13): create a fork branch in `E:/code/coso/mazda-ai-ranch` from `origin/dev`, merge this ranch branch into it (expect no conflict in `reins` — only `queryKnowledge.dto.ts`' default and `query()`'s mode line differ, both untouched), open the fork PR into `dev` with the CLEAN-184 id and label `mazda`, let `mai-dev-ranch-images` build it; confirm the 26MY Mazda3 Spec Deck is indexed in a base on `mai-dev` (upload and index it once if not); then run `quickstart.md` steps 1–4 (SC-001, SC-003): five AFS runs, all direct, each citing a source that holds the answer (on this corpus the Genius sheet or the deck — research D14); then the sheet-free set (quickstart Q2–Q5) once each, which is what proves the deck path; save one shortened real tool result and the log line for the PR. **If fewer than 5/5 are direct**: inspect the saved tool results — if the answer is present in the passages and the model still hedges, tighten the description (T018) and re-run; if the passages lack it, record which documents came back and raise it on T042 rather than changing the mode (F13 showed no mode retrieves the deck for that wording); record the outcome in `research.md` (F15)
- [x] T036 **Done 2026-10-28, research F16** (every lookup 9.7–12k chars, via query_data; US3 and console steps not re-run manually — covered by the specs). Run `quickstart.md` steps 5–7 (SC-002: budget on table questions and fan-out) and 11–15 (US3 guarantees, SC-006 console); record results
- [x] T037 **Done 2026-10-28, research F16** (lookups 236–345 ms; Q1 first run 4.2 s vs 24.5 s before; CONTEXT_TIMEOUT_MS stays 30 s). "After" timing per `quickstart.md` steps 9–10, same questions as T003; build the before/after table; if any lookup's p95 nears 30 s, raise `CONTEXT_TIMEOUT_MS` with the measured number (FR-012)
- [x] T038 **Done 2026-10-28** (api 159 suites / 2 244 tests, build, admin typecheck; lint clean apart from CRLF). Final gates: `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest && bun run build`; `cd admin && npx nuxt typecheck`; eslint on changed `api` files with `--rule 'prettier/prettier: ["error", {"endOfLine": "auto"}]'`
- [x] T039 **Done: PR #153, merged 2026-10-28 (70b2a262).** Open the PR into `main` titled `fix(reins): query_knowledge hands the agent the retrieved passages, not another model's answer (CLEAN-184)` with: endpoint/mode used (with the F13 table) and the path the deployment took (from the log), the shortened real tool result, the before/after table, the gate commands and counts, the twin-console statement (`reins` is admin-only; `chat` unaffected — `sources` shape unchanged), the T034 checklist answers, the note that `reins/nestjs/` (separate repository) has the same defect, the surface relabel, and the fork PR from T035; put both PR links on CLEAN-184 and move it to In Testing (transition 51)
- [x] T040 **Done 2026-10-28: fork PR #52 (chore/catch-up-upstream-18) merged into dev; mai-dev answers Q1 5/5.** After the ranch PR merges: rebase or re-merge the fork branch from T035 onto the merged `main` change (so the fork's `dev` carries the upstream commit, not a divergent copy), merge the fork PR into `dev`, confirm `mai-dev` still answers the AFS question 5/5 on the built image
- [x] T042 **Done 2026-10-28: CLEAN-185, linked to CLEAN-184.** Follow-up ticket for the retrieval gap (research F13/D14), `[API]`, labels `api`, `mazda`: for the natural-language AFS question no mode of LightRAG 1.4.16 on the Mazda base returns a chunk of the 26MY Mazda3 Spec Deck (DOCX or the Equipment-and-Features CSV) at any rank up to the server budget, while queries in the deck's wording return them at ranks 1–3; the deck's PDF is indexed as one 169-character chunk (image-only PDF, OCR not applied on that installation). Candidate directions, not decisions: enable OCR for image PDFs there; a reranker binding; keyword/BM25 hybrid; chunking the equipment CSVs row-wise with the header repeated. Attach the F13 table; link from CLEAN-184 (created 2026-10-28 as part of planning — see the ticket link in research F13 if already done)
- [ ] T041 Promote to Mazda production: fork PR `dev` → `main` with the CLEAN-184 id, `mai-prod-ranch-images` build, ArgoCD rollout; repeat the AFS question once on `mazda-ai.mycoso.cloud` and the two table questions; note the result on CLEAN-184 and move the ticket to Done (transition 41)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001 first; T002 next (go/no-go for the design); T003 and T004 in parallel after T002.
- **Phase 2 (Foundational)**: after T002's go. T005 → T006; T007, T008 in parallel with T006; T009 after T005 and T007.
- **US1 (Phase 3)**: after Phase 2. Tests T010–T013 in parallel; T014 → T015 (client); T016 after T007/T009; T017 after T014, T016; T018, T019 after T017.
- **US2 (Phase 4)**: T020 and T022 need only T008 and can start during US1; T021 and T023 need T017.
- **US3 (Phase 5)**: needs T017 (and T023 for the serialized-size assertions); T024–T026 in parallel; T027 after them; T028 last.
- **US4 (Phase 6)**: independent of US1–US3 after T005; can be done any time, kept last so the agent-path commits land first.
- **Phase 7**: T033, T034 any time after US1; T035–T037 need all four stories deployed; T038, T039 last.

### User Story Dependencies

- **US1**: Phase 2 only.
- **US2**: pure function independent; tool integration depends on US1's block shape.
- **US3**: verification over US1 (+ US2 for size cases); no new behaviour beyond fixes it exposes.
- **US4**: independent.

### Parallel Opportunities

- Phase 1: T003 ∥ T004.
- Phase 2: T006 ∥ T007 ∥ T008.
- US1 tests: T010 ∥ T011 ∥ T012 ∥ T013; then T014/T015 (client) ∥ T016 (service).
- US2: T020 + T022 (pure fitting) ∥ US1 implementation.
- US3 tests: T024 ∥ T025 ∥ T026.
- US4 can run beside US2/US3 (different files: service detector + DTO + admin component).
- Phase 7: T033 ∥ T034 while the staging run (T035–T037) is in progress.

---

## Parallel Example: User Story 1

```bash
# Tests first, four files/areas at once:
Task: "T010 client spec: /query/data mapping, failure status, 30 s timeout, 500 pass-through"
Task: "T011 client spec: 404 fallback to only_need_context, unparseable context fails loudly"
Task: "T012 tool spec: Mazda AFS regression on the retrieveContext mock"
Task: "T013 tool spec: empty → no_relevant_content, dedup, unresolved passage"

# Then client and service in parallel:
Task: "T014+T015 lightragHttp.client.ts retrieveContext with fallback"
Task: "T016 knowledge.service.ts retrieveContext"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 — the evidence gate (T002) decides whether `mix` + 12 chunks surfaces the AFS table at all. This is the cheapest possible answer to "will this fix the agent's answers" and it comes before any code.
2. Phase 2 — types.
3. Phase 3 — US1. **Stop and validate**: the Mazda regression in jest, then one deploy and the five AFS runs (T035 can be run early on US1 alone to de-risk, then repeated at the end).

### Incremental Delivery

1. US1 → the agent reads passages (commit 1). Results may be large.
2. US2 → results always fit (commit 2). Now safe for big bases.
3. US3 → guarantees proven (commit 3).
4. US4 → console flag (commit 4).
5. Staging proof, timings, PR.

### What this fixes and what it cannot

- **Removed outright**: a refusal sentence written by LightRAG's model reaching the agent; the agent weighing three generated answers against each other. After US1 the tool result cannot contain such a sentence — the Mazda regression test asserts it.
- **Made explicit to the model**: an empty lookup refutes nothing; answer directly when a passage answers (T018).
- **Still the agent model's job**: reading a table out of a passage and composing the reply. The five-run staging check (T035) is the gate for that, with two recorded next moves if it fails (description tightening; `naive` mode).
- **Still LightRAG's job**: retrieving the right chunk. T002 checks this before coding; chunking that splits a table across chunks would show there, and would be a separate finding.

## Notes

- Tests fail first, then the implementation task; do not weaken an assertion to pass.
- Commit after each story checkpoint with the `CLEAN-184` id; checkpoint comments on the ticket after Phase 1, after US3, and with the PR.
- `.specify/scripts/python/__pycache__/*.pyc` get rewritten by the SpecKit scripts; restore them before committing.
