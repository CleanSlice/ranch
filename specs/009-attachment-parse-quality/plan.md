# Implementation Plan: Attached Document Display and Extraction Quality

**Branch**: `feat/CLEAN-67-attachment-parse-quality` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Jira**: [CLEAN-67](https://dreamvention.atlassian.net/browse/CLEAN-67)

**Input**: Feature specification from `specs/009-attachment-parse-quality/spec.md`

## Summary

Two visible defects, one root cause: the text a person typed and the text the model is fed are the same persisted string, and for spreadsheets that string is neither compact nor faithful.

The plan attacks it in four independent slices, in this order:

1. **Split at read time** (Story 1). `TranscriptReaderService` learns the grammar of the attachment block and returns `text` (typed) plus `agentText` (what the model got). Every replay surface — admin chat, chat history, export, the coming share view — is fixed by that one change, including conversations persisted before this ticket. The admin chat shows `agentText` only under the DEBUG toggle. No runtime change, no migration.
2. **Faithful spreadsheet representation** (Story 2). The CSV dump becomes a sparse, coordinate-addressed format: merged regions once with their span, row numbers, `[=]` on formula cells, blank-row markers, hidden sheets header-only, per-sheet included/omitted accounting, budget cut only at row boundaries. Word tables keep their rows. One shared workbook reader feeds both the preview and the tool.
3. **Deterministic computation** (Story 3, decision B). A `query_attachment` MCP tool in the bridle slice (`describe` / `read` / `aggregate` / `find`) reads the stored bytes by attachment id under the caller's own agent and returns computed numbers with the range and the audit of what was counted. The attachment id is added to the block header so the model can call it.
4. **Bounded replay cost** (Story 4). With the tool as the source of truth, the inline spreadsheet block becomes a preview bounded by two new constants; later turns no longer carry a 100k-character dump in history.

Design decisions and their alternatives are in [research.md](./research.md) (D1–D10); shapes in [data-model.md](./data-model.md); wire formats in [contracts/](./contracts/); acceptance walk-through in [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.2.x (workspace), NestJS 11 API built for Node; Nuxt 4 / Vue 3 front-ends (`ssr: false`).

**Primary Dependencies**:
- API — `exceljs ^4.4.0` (already present; the fix uses `cell.isMerged`/`master`/`address`/`formula`/`numFmt`, `worksheet.state`/`actualRowCount`/`actualColumnCount`/`model.merges`), `mammoth ^1.12.2` (`convertToHtml` instead of `extractRawText`), `pdf-parse ^2.4.5` (unchanged), `zod` (tool parameters), the in-repo `#mcp` `@Tool` decorator + registry, `@nestjs/swagger`. **No new dependencies.**
- Admin / App — existing bridle and chat slices, `@hey-api/openapi-ts` generated SDKs, `lucide-vue-next` icons, app i18n via `bun run i18n:sync`.

**Storage**: unchanged. Attachment bytes in S3 under the agent prefix (`IBridleAttachmentGateway`), transcript JSONL written by the runtime. No DB table, no Prisma migration. The tool parses the workbook on demand from the stored bytes; no cached parse.

**Testing**: API — Jest, colocated specs, fixtures built with exceljs in-test (house style of `documentText.extractor.spec.ts`); a generated reference workbook set with known answers (D9). Admin/App — no test runner configured; front-end acceptance via [quickstart.md](./quickstart.md).

**Target Platform**: Linux API in k8s; evergreen browsers for admin/app.

**Project Type**: Turborepo monorepo, CleanSlice vertical slices (`domain` → `data` → `stores` → `components`). Touched slices: `api/src/slices/bridle`, `api/src/slices/agent/file` (transcript reader), `api/src/slices/chat` (history DTO + export), `api/src/slices/mcpServer` (seeder entry) and `api/src/slices/agent/agent` (MCP injection), `admin/slices/bridle`, `admin/slices/chat`, `app/slices/chat`.

**Performance Goals**: transcript split adds no measurable latency (pure string scan per user event); workbook parse for a 10 MB file under 1 s per tool call; preview block for the reference workbook ≥ 70 % smaller than today's output (SC-002).

**Constraints**: caller of `query_attachment` must be an agent token and may only read its own attachments (never a cross-agent read); `text` must never lose content on a parse failure (D1 step 4); legacy transcripts must split without metadata; all limits are exported constants (`MAX_EXTRACTED_TEXT_CHARS`, `SPREADSHEET_INLINE_BUDGET_CHARS`, `SPREADSHEET_PREVIEW_ROWS_PER_SHEET`, `MAX_QUERY_CELLS`); no customer files committed as fixtures.

**Scale/Scope**: ~6 API files changed + 3 new (`workbook.reader.ts`, `attachment.tool.ts`, `attachmentBlocks.ts` for the split), 2 DTOs, 1 seeder entry, 1 controller injection; admin: store + `Message.vue` + chat `Bubble.vue`; app: chat `Bubble.vue` + one i18n key. Both front-end SDKs regenerated.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template (every principle is a `[PRINCIPLE_N_NAME]` placeholder, never ratified). As in 007, the gate is evaluated against the rules this repository actually enforces (`CLAUDE.md`, `.cursor/rules/project.mdc`, `docs/i18n.md`, slice conventions):

| Rule (de facto) | Status | Notes |
|---|---|---|
| Jira CLEAN ticket, branch `{type}/CLEAN-<n>-slug`, PR into `main` | PASS | CLEAN-67, `feat/CLEAN-67-attachment-parse-quality` |
| Vertical slices; upper layers depend on `domain` interfaces only | PASS | Tool and reader live in `bridle/domain` + a slice-level `attachment.tool.ts` exactly like `reins/knowledge/knowledge.tool.ts`; the transcript split is a pure `domain` function |
| Generated SDK/types regenerated, never hand-written | PASS | `generate:swagger` → `build:api` in admin and app is an explicit step in [contracts/transcript-and-history.md](./contracts/transcript-and-history.md) |
| App is bilingual via `en.json` + `i18n:sync`; admin English-only | PASS | one new app key for the history chip; admin strings inline |
| Reuse existing infrastructure, no parallel mechanisms | PASS | `IBridleAttachmentGateway`, `TranscriptReaderService`, `#mcp` registry, seeder pattern, DEBUG toggle all reused; no new storage or bucket |
| Do not weaken auth | PASS | tool rejects non-agent tokens and cross-agent ids; no new unauthenticated route |
| No customer data in the repo | PASS | fixtures generated (D9) |

**Gate result: PASS**, with the same caveat as 007: the constitution is unratified, so this table is the operative standard.

### Post-design re-check (after Phase 1)

Re-evaluated against research D1–D10, the data model and the three contracts. Still **PASS**. Two places a reviewer may expect something else, made explicit:

1. **The typed/agent split happens on read, not on write** (D1). Writing a separate field is the cleaner design but belongs to the external runtime; read-time splitting by grammar is the only option that also repairs already persisted conversations. Deferred item recorded in research.
2. **A fourth built-in MCP entry pointing at the same URL** (D5). The registry has no per-server tool filtering, so `Ranch`, `Knowledge` and the new `Documents` entry all expose the same tool list; the runtime already tolerates that for the first two. Per-server filtering is a deferred follow-up, not a blocker.

No entries for Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-attachment-parse-quality/
├── plan.md                              # this file
├── spec.md
├── research.md                          # Phase 0 — findings F1–F7, decisions D1–D10
├── data-model.md                        # Phase 1 — read model, derived shapes, constants
├── quickstart.md                        # Phase 1 — automated + manual validation
├── contracts/
│   ├── agent-facing-document.md         # block grammar (write) and split (read); spreadsheet/DOCX body format
│   ├── query-attachment-tool.md         # MCP tool schema, results, errors, availability
│   └── transcript-and-history.md        # DTO/export changes, admin + history UI contract
├── checklists/requirements.md
└── tasks.md                             # Phase 2 — /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
api/src/slices/
├── bridle/
│   ├── domain/
│   │   ├── attachment.constants.ts      # + SPREADSHEET_INLINE_BUDGET_CHARS, SPREADSHEET_PREVIEW_ROWS_PER_SHEET, MAX_QUERY_CELLS
│   │   ├── attachment.service.ts        # header with id + spreadsheet hint; preview budget for spreadsheets
│   │   ├── attachmentBlocks.ts          # NEW — block builders + splitAttachmentBlocks() (pure, shared with chat export)
│   │   ├── attachmentBlocks.spec.ts     # NEW
│   │   ├── workbook.reader.ts           # NEW — exceljs → WorkbookSummary / SheetSection / CellRef with fidelity rules
│   │   ├── workbook.reader.spec.ts      # NEW
│   │   ├── documentText.extractor.ts    # spreadsheet → contract §3 format via the reader; DOCX via convertToHtml → text
│   │   ├── documentText.extractor.spec.ts
│   │   └── __fixtures__/
│   │       └── buildReferenceWorkbooks.ts  # NEW — generated reference set + expected answers
│   ├── attachment.tool.ts               # NEW — @Tool query_attachment (describe/read/aggregate/find)
│   ├── attachment.tool.spec.ts          # NEW
│   ├── bridle.module.ts                 # + BridleAttachmentTool provider
│   └── dtos/transcript.dto.ts           # + agentText
├── agent/
│   ├── file/domain/transcriptReader.service.ts   # user events: text = typed, agentText = full (uses splitAttachmentBlocks)
│   ├── file/domain/transcriptReader.service.spec.ts  # NEW or extended
│   └── agent/agent.controller.ts        # getMcps: inject DOCUMENTS_MCP_ID for every agent
├── mcpServer/domain/mcpServer.seeder.ts # + DOCUMENTS_MCP_ID built-in entry
└── chat/
    ├── dtos/chatMessage.dto.ts          # + attachments, agentText (debug only)
    ├── chat.controller.ts / myChat.controller.ts   # pass attachments through; agentText gated by types
    └── domain/chatExport.ts (+ .spec)   # markdown/csv print typed text + attachment names

admin/slices/
├── bridle/
│   ├── stores/bridle.ts                 # IBridleMessageData.agentText; toBridleMessage copies text/agentText
│   └── components/bridle/Message.vue    # "What the agent received" disclosure under DEBUG
└── chat/components/chat/message/Bubble.vue   # attachment name chips

app/slices/chat/
├── components/chat/message/Bubble.vue   # attachment name chips
└── i18n/locales/en.json                 # chip label key (ru via bun run i18n:sync)
```

**Structure Decision**: every change stays inside the slices that already own the behaviour. The two genuinely new units — the workbook reader and the tool — sit in `bridle` because that slice owns attachment bytes and the send-time expansion; the transcript split is a pure function in `bridle/domain` imported by `agent/file` and `chat`, mirroring how `chat` already imports `TranscriptMessage` from `agent/file`.

## Delivery order and checkpoints

Independent slices, each shippable and each a Jira checkpoint comment (large task):

| # | Slice | Stories | Verifies with |
|---|---|---|---|
| 1 | Read-time split + DTOs + admin DEBUG disclosure + history chips + export | 1 | quickstart §2, Jest `attachmentBlocks`, `transcriptReader`, `chatExport` |
| 2 | Workbook reader + new spreadsheet format + DOCX tables + id in header + fixtures | 2 | quickstart §3, Jest `workbook.reader`, `documentText.extractor`, `attachment.service` |
| 3 | `query_attachment` tool + seeder entry + MCP injection | 3 | quickstart §4, Jest `attachment.tool` |
| 4 | Spreadsheet preview budget (constants) | 4 | quickstart §5 |

Slice 4 is a constants flip once 3 is in; it is listed separately so the size change is a conscious step, not a side effect.

## Risks

- **Runtime restart needed for the tool to appear**: the runtime reads its MCP list at boot. Quickstart §4 says so; release notes must too.
- **Tool list exposure**: agents that previously had neither Ranch nor Knowledge attached will now list rancher tools as well (owner-guarded at call time). Accepted for now; per-server filtering is a deferred follow-up.
- **Grammar collision**: a person typing a line that starts with `[Attached file: ` would trip the split only if the rest also parses as valid blocks; the parser falls back to leaving the text intact (D1 step 4) and a Jest case covers it.
- **Very wide merged regions with long text**: emitted once, untruncated, at the master cell — could dominate a row line; acceptable, and the preview budget still holds at row boundaries.
