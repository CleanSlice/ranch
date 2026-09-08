# Quickstart — validating CLEAN-67

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [contracts/](./contracts/)

## Prerequisites

- `make dev` running (api:3000, app:3001, admin:3002) with an agent deployed and connected.
- A test workbook. Do **not** use customer files; build one with the fixture script:

```bash
cd api && bun run ts-node src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts ./tmp
# writes supplier-invoice.xlsx (3 sheets: two visible with merged headers, formula totals, blank separator rows; one hidden)
```

Expected answers for `supplier-invoice.xlsx` are printed by the script and also asserted in `documentText.extractor.spec.ts` / `attachment.tool.spec.ts`.

## 1. Automated checks (API)

```bash
cd api && bun run test -- --testPathPattern 'bridle|transcriptReader|chatExport'
```

Expected: all green, including the new specs:

| Spec | Proves |
|---|---|
| `documentText.extractor.spec.ts` | merged value once with span; row numbers; `(rows a–b empty)`; `[=]` on formula cells; hidden sheet header-only; budget cut at row boundary with exact omitted counts; float/percent/date rendering; DOCX table rows |
| `transcriptReader.service.spec.ts` | `splitAttachmentBlocks` on new, legacy fenced, legacy notice, attachment-only, multi-attachment, and "user typed the marker" inputs; parse failure leaves text intact |
| `attachment.service.spec.ts` | header carries the id; spreadsheet hint present; preview respects both spreadsheet constants |
| `attachment.tool.spec.ts` | non-agent caller rejected; other agent's id rejected; describe/read/aggregate/find on the reference workbook match expected values; hidden sheet gated; cell cap enforced |
| `chatExport.spec.ts` | markdown/csv show typed text + attachment names, never the dump |

## 2. Story 1 — bubble after reload (admin)

1. Open an agent in admin → Chat tab. Attach `supplier-invoice.xlsx`, type `распарси`, send.
2. Observe: bubble shows `распарси` + one chip. Note the bubble height.
3. Reload the page.
   - **Expected**: same bubble, same height ± one line; no `[Attached file:` text; the chip is present and downloadable.
4. Toggle DEBUG on → the user bubble shows "What the agent received"; expand it → the full block with `— id: <uuid>` and the sheet sections. Toggle DEBUG off → disclosure gone.
5. Send a message with **only** a file and no text; reload. **Expected**: chip, no empty grey block, no dump.
6. Open the same agent's conversation in **Chats** (history) and in **Export → markdown**. **Expected**: typed text + attachment names; no dump.
7. Regression: a conversation recorded **before** this branch (any agent with an older attachment) — reload it. **Expected**: dump hidden, chip shown.
8. When CLEAN-66 (public share link) is on `main`: open the shared view. **Expected**: same compact bubble.

## 3. Story 2 — what the agent receives

With DEBUG on, expand "What the agent received" for the message from step 2.2 and check against [contracts/agent-facing-document.md §3](./contracts/agent-facing-document.md):

- workbook line lists 3 sheets, sheet 3 `hidden`;
- `R1: A1[A1:AN1]=ТОВ "Асканія-Флора"` appears **once**; the string does not appear 40 times anywhere;
- `(rows 7–9 empty)` line present; total rows carry `[=]`;
- each sheet header says `rows a–b included · n rows omitted`;
- size: the block for the reference workbook is < 30 % of the size the same file produced on `main` (compare `agentText.length` from the transcript endpoint before/after; the spec target is ≥ 70 % smaller).

## 4. Story 3 — correct, verifiable numbers

Restart the agent once (it reads its MCP list at boot), then ask in the same chat:

| Ask | Expected |
|---|---|
| `Сумма по каждому листу` | Sheet 1 = 194 677.80, Sheet 2 = 1 476, Sheet 3 mentioned as hidden or asked about; each with sheet + range cited; a `query_attachment` tool call visible in the debug panel |
| `Сумма колонки F на первом листе без строк итогов` | 162 231.50 (aggregate with `include_computed: false`, or range excluding the total rows) |
| `Какая позиция самая дорогая на листе 2` | the row from the fixture's expected answers, cited by row number |
| `Какая сумма на четвёртом листе?` | "there is no fourth sheet" — no number invented |

## 5. Story 4 — follow-up turns

Ask 5 more questions about the workbook. In the transcript endpoint (`GET /api/agent/:id/transcript`), confirm that only the first user turn carries `agentText` with the document; later turns are plain text. Usage per turn (admin usage panel) should not step up with each question.

## 6. Regression of other kinds

Attach a `.txt`, a `.png`, and a text-layer `.pdf` in one message. **Expected**: png as image, txt inlined, pdf inlined; chips restore after reload; nothing else changed.
