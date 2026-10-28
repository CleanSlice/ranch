# Implementation Plan: Knowledge Retrieval Hands the Agent the Found Passages, Not Another Model's Answer

**Branch**: `fix/CLEAN-184-knowledge-context-retrieval` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Ticket**: [CLEAN-184](https://dreamvention.atlassian.net/browse/CLEAN-184)

**Input**: Feature specification from `/specs/023-knowledge-context-retrieval/spec.md`; the verbatim brief in [brief.md](brief.md), whose proposed design is adopted where research confirmed it and adjusted where it did not (budget derivation, entities, the server's third canned phrase).

## Summary

The agent's knowledge lookup asks LightRAG for a *written answer* and keeps
only that paragraph, so the agent reads another model's hesitation as "the
documents do not say". The fix moves the agent path onto LightRAG's
no-generation route and hands the agent the matched chunks verbatim, each
bound to its source, inside a size the runtime will never cut:

1. **Client**: `retrieveContext` → `POST /query/data` (structured chunks,
   relations, references; present on the pinned v1.5.6 per-base image), with
   a one-shot fallback to `POST /query` + `only_need_context` on 404 for an
   unpinned shared pool ([contract](contracts/lightrag-retrieve-context.md)).
2. **Service / gateway**: `retrieveContext` beside `query`, reusing every
   guard `query` has — readability, the empty-isolated-base veto, the
   `complete` flag, reference resolution now applied per chunk.
3. **Tool**: `query_knowledge` returns `passages[]` (verbatim, with source
   name and id — the best match whole up to 5 000 characters, the rest as
   marked excerpts of up to 2 000 around the query terms, research D14),
   optional short `facts`, `truncated` / `omitted_passages`, and the
   CLEAN-138 `sources` list, fitted by a pure function to 12 000 characters
   of compact JSON per call, divided across bases on fan-out
   ([contract](contracts/query-knowledge-result.md)). Its description says
   what the result now is, that an empty lookup refutes nothing, and that
   lookups are phrased in the documents' vocabulary.
4. **Console**: unchanged written answer; a partial refusal from the
   retrieval model is reported as `reason: 'partial_refusal'` and shown as
   such in the admin Query tab ([contract](contracts/console-query-refusal.md)).

No table, no migration, no new endpoint in `api`, no runtime change. One
enum value on an existing DTO, so the admin SDK is regenerated.

## Technical Context

**Language/Version**: TypeScript 5; NestJS 11 in `api`; Vue 3 / Nuxt 4 in `admin` (one copy line).

**Primary Dependencies**: `api`: existing `fetch`-based `LightragHttpClient`, `zod` tool parameters, the `#mcp` `@Tool` decorator; LightRAG HTTP API (`/query/data`, `/query`). Nothing added.

**Storage**: none touched. Source rows are read for binding (`SourceService.findByKnowledge`, `listDocuments` for adopted names), as `query` does today.

**Testing**: `jest` in `api`, run directly (`NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/reins`); `bun run build` is the `api` typecheck; `npx nuxt typecheck` in `admin`; `bun run generate:swagger` + `bun run build:api` regenerate the SDK. Quickstart lists the gates.

**Target Platform**: the API on Node. Where it matters — the Mazda installation — the API is the fork `mazda-ai-ranch` (`dev` → `mai-dev`, `main` → `mai-prod`) against one shared LightRAG **v1.4.16** on Bedrock Haiku 4.5 with isolation off (research F10); `/query/data` exists there. This repository's own deployments run v1.5.6 per base and `:latest` on the pool; the fallback covers them.

**Project Type**: web service (`api`) with a one-line console change (`admin`).

**Performance Goals**: median agent answer time for knowledge questions does not rise and is expected to fall (SC-004); one lookup under `CONTEXT_TIMEOUT_MS = 30_000`, under the MCP client's 60 s.

**Constraints**: each tool result ≤ 12 000 characters of serialized text and always valid JSON (FR-005; derivation research D6); the runtime's 16 000 cap is not raised (FR-013); no model call on the API side; the console path keeps generating.

**Scale/Scope**: one slice (`api/reins`) across three layers plus one tool; ~6 source files, ~3 spec files; one admin component line and a regenerated SDK; the Mazda base (756 sources, 216 MB) is the reference load.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan answers |
|-----------|--------|-----------------------|
| **I. The slice is the unit** | Pass | Everything lives in `api/src/slices/reins`: `lightrag/` (client + types), `knowledge/` (gateway, service, domain fitting function, tool, DTO). The tool keeps reading agent bindings through `IAgentGateway` / `ITemplateGateway` as today; the `sources` shape is the `chat` slice's published contract (`IChatSourceInput`), used, not reached into. The admin change is inside `admin/slices/reins`. Nothing in `common`. |
| **II. Twin consoles** | Pass | `reins` exists in `admin` only — grepped `app/slices` for `reins`, `queryKnowledge`, `KnowledgeQueryResultDto`: nothing. The twin slice this touches by contract is `chat`: the tool keeps `sources` / `results[].sources` byte-for-byte in shape, so neither console's chat changes; the runtime's `extractSources` was read to confirm (research F2). The PR states this in words. |
| **III. Secrets stay behind `api/`** | Pass | No credential introduced. LightRAG's API key keeps travelling in the client's `headers()`; the tool result carries passage text, source names and ids — no key, no endpoint URL. The GHCR read in research used an anonymous pull token and printed labels only. |
| **IV. One entity, one store** | Pass | The admin Query tab keeps its single `result` from the `reins` store's `query()`; the new `reason` value is rendered from that same object. No new store, fetch or feed. |
| **V. The console is a window, the chat is the hands** | Pass | This *is* the agent's tool for the console's Query capability; its metadata (`topic`, `title`, `template`, audience = the calling agent's bound bases) is unchanged, it is not destructive, its result holds no secret, it calls the same `KnowledgeService` the controller calls (a sibling method, by design — research D4), and `knowledge.tool.spec.ts` is extended. Checklist at the end of `docs/agent-tools.md` walked: all four items hold. |
| **VI. English is the source, translations are generated** | Pass | `admin` is English-only; the one new copy line is a literal there, as the rest of the tab. No `app` string. Passage text is server content shown as received — never reformatted or translated, on either path. |
| **VII. A rule stays a rule** | Pass | Every decision in the path is a rule: endpoint by status code (404 → fallback), passages kept by a size comparison in received order, dedup by string equality, binding by the existing id → name → url lookup, refusal detection by a fixed phrase list grown from observed sentences. No model is asked anything by the API. The one model step left — LightRAG's keyword extraction for graph modes (research F5) — is upstream retrieval machinery whose output never reaches the agent; it is named, timed on staging, and `naive` is the recorded escape hatch (D2). |

**Additional constraints**

| Constraint | Status | Note |
|------------|--------|------|
| Generated code is generated | Pass | `reason` widens on `KnowledgeQueryResultDto`; `api/swagger-spec.json` and the admin SDK are regenerated. The admin's `IQueryResult` stays an alias of the generated DTO. |
| Tracker is Jira `CLEAN` | Pass | CLEAN-184; branch, commits and PR carry it. |
| Surface marking is honest | **Action owed** | The ticket is `[API]` with label `api`. D9 adds one copy line in `admin/slices/reins` and a regenerated SDK: retitle to `[ADMIN][API]` and add the `admin` label when implementation starts (or drop the admin copy line and keep the generic no-content box — then the ticket stays `[API]`; the plan recommends the former, SC-006 asks for a *visible* flag). |

**Quality gates owed at the end**

1. Typecheck and tests for `api` and `admin`, commands named in the PR (quickstart, "Gates").
2. The twin-console statement above, in words, in the PR.
3. The reason behind each number, in code beside the constant: `TOOL_RESULT_BUDGET_CHARS = 12_000` (D6), `MIN_BUDGET_PER_BASE = 2_000` (D6), `FIRST_PASSAGE_MAX_CHARS = 5_000` and `PASSAGE_MAX_CHARS = 2_000` (D14, F13 chunk sizes), `CONTEXT_TIMEOUT_MS = 30_000` (D7; F13 measured 0.7–6 s), `CONTEXT_QUERY_MODE = 'naive'` (D2 rule on F13), `chunk_top_k = 12` and `top_k = 20` (D3), `MAX_FACTS = 8` / `MAX_FACT_CHARS = 200` (D5).

**Result: gate passed. No violations; Complexity Tracking is empty.**

**Post-design re-check (after Phase 1)**: unchanged. The design adds no
project, dependency, table or endpoint. Two things surfaced and are
recorded rather than waived: the keyword-extraction model call that remains
inside LightRAG for graph modes (Principle VII, named above with its escape
hatch), and the surface relabel (`[ADMIN][API]`) that D9 makes honest.

## Project Structure

### Documentation (this feature)

```text
specs/023-knowledge-context-retrieval/
├── brief.md             # the verbatim input
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: F1–F9 findings, D1–D12 decisions
├── data-model.md        # Phase 1: IContextResult, IKnowledgeContextResult, tool block, fitting
├── quickstart.md        # Phase 1: gates + manual checks SC-001..SC-006
├── contracts/
│   ├── lightrag-retrieve-context.md
│   ├── query-knowledge-result.md
│   └── console-query-refusal.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
api/src/slices/reins/
├── lightrag/
│   ├── domain/
│   │   ├── lightrag.types.ts        # + 'mix'; + IRetrieveContextInput, IContextResult, IContextChunk, IContextRelation
│   │   └── lightrag.client.ts       # + abstract retrieveContext
│   └── data/
│       ├── lightragHttp.client.ts   # + retrieveContext, CONTEXT_TIMEOUT_MS, /query/data → /query fallback, parsers
│       └── lightragHttp.client.spec.ts  # + 6 cases (contract)
├── knowledge/
│   ├── domain/
│   │   ├── knowledge.types.ts       # + IKnowledgePassage, IKnowledgeContextResult; reason widens
│   │   ├── knowledge.gateway.ts     # + abstract retrieveKnowledgeContext
│   │   ├── knowledge.service.ts     # + retrieveContext (shares guards with query); + isPartialRefusal; query() sets partial_refusal
│   │   └── knowledgeContext.ts      # NEW: fitContextToBudget (pure) + constants with reasons
│   ├── data/
│   │   └── knowledge.gateway.ts     # + retrieveKnowledgeContext → lightrag.retrieveContext
│   ├── dtos/knowledgeRecord.dto.ts  # reason enum widens
│   ├── knowledge.tool.ts            # query() → retrieveContext; compact serialization; budget; BASE_DESCRIPTION rewritten; log line
│   ├── knowledge.tool.spec.ts       # + Mazda AFS regression, budget, cut, fan-out budget, dedup, facts yield, empty, unresolved
│   ├── knowledge.isolation.spec.ts  # fake serves /query/data; isolation on the new path; partial-refusal detection cases
│   └── README.md                    # + paragraph: agent path returns passages, console path generates
api/swagger-spec.json                # regenerated (gitignored locally; CI regenerates)

admin/slices/reins/
├── components/knowledge/query/Provider.vue   # one branch on reason === 'partial_refusal'
└── data/api/…types.gen.ts (generated)        # via `bun run build:api`
```

**Structure Decision**: the feature stays inside the existing `reins` slice
and its three layers (`domain` / `data` / tool), adding one pure domain file
for the fitting rule so the budget is testable without a tool harness. The
admin change is confined to the component that already renders the result.

## Delivery order

Four commits, each green on its own, in this order — the agent path first
because it is the defect, the console flag last because it is separable:

1. **Client** (`lightrag/`): types, `retrieveContext`, fallback, parsers,
   spec. Gate: client spec + `bun run build`.
2. **Service + gateway + fitting**: `retrieveContext` in gateway and
   service, `knowledgeContext.ts` with the fitting function and constants,
   isolation spec moved to `/query/data`. Gate: `jest src/slices/reins`.
3. **Tool**: new result, compact serialization, budget, description,
   log line, README paragraph, tool spec incl. the Mazda regression. Gate:
   tool spec + build. Checkpoint comment on CLEAN-184.
4. **Console flag**: `isPartialRefusal`, `reason` widening, swagger + admin
   SDK regen, Query tab copy, detection cases. Gate: build, regen diff
   reviewed, `npx nuxt typecheck` in admin. Relabel the ticket.

Then the staging run (quickstart steps 1–15), the time tables, and the PR.

**Reaching Mazda** (research D13): after this PR merges to `main`, the
change is merged into `mazda-ai-ranch` `dev` as the fork takes every
upstream change, built by `mai-dev-ranch-images`, verified on `mai-dev`,
then promoted to the fork's `main`. The change deliberately leaves the
fork's `mode: 'global'` lines alone so that merge is clean.

## Risks

- **The mode.** Settled by T002 (research F13): `naive` — 0.7–1.5 s,
  no model call, bounded on the hub question where `mix` took 21.7 s; no
  mode retrieved the deck's table for the natural question, so richness
  bought nothing.
- **What the base retrieves.** For the production question LightRAG
  returns the Genius answer sheets first (present in prod too) and older
  model-year charts after; the 26MY deck's table only surfaces for queries
  in its own wording (F13). The passages path hands the agent exactly that
  — which fixes the reported failure (a refusal was read as evidence) but
  cannot make the deck rank higher. The description's vocabulary guidance
  (D14) is the in-scope lever; the retrieval gap is its own ticket (T042).
  The sheet-free question set in the quickstart is what proves the deck
  path on staging.

- **The shared pool's `:latest` lacks `/query/data`** → the fallback path
  carries production; its parser depends on upstream prompt templates. The
  log line names the path, so a deployment on the fallback is visible, and
  pinning the shared pool to the same digest as the instances is the real
  fix (out of scope; noted in the PR).
- **Rephrasings still diverge** (in a graph mode, because keyword
  extraction varies, F5) → the agent now sees fewer passages, not a
  refusal, and the description says an empty lookup refutes nothing. In
  `naive` the same wording retrieves the same chunks.
- **Twelve chunks of a table-heavy deck exceed the budget every time** →
  expected and handled by `truncated`; if the AFS table itself is split
  across chunks and the second half is dropped, raising `chunk_top_k` is
  the wrong lever — fitting keeps order, so the table chunk must rank
  first; verify on staging step 4 and record.
- **Escaping overhead larger than the 15 % assumed** (code-heavy content) →
  the derivation keeps ~1 800 characters of headroom; the budget test
  asserts on the serialized string the runtime measures, so a regression is
  caught in jest, not in the chat.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Empty.
