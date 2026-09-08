# Quickstart — validating CLEAN-69

## Automated

```bash
cd api && bun run test -- --testPathPattern 'sheetStructure|documentText|attachment.tool|attachment.service|workbook.reader'
```

Expected: green. `sheetStructure.spec.ts` covers: table block with header and data span; column-index row joins the header; footer pairs with left labels, computed flag, text-only lines; title pairs; two tables on one sheet; sheet with no dense rows; label to the right; two numbers sharing one label; merged label span.

## Manual (live agent, after restart)

1. Attach `supplier-invoice.xlsx` (built by `api/src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts`), send "какая сумма поставок на каждом листе?".
2. In DEBUG → "What the agent received": every visible sheet shows `tables:` and `after <range>:` lines before its rows; sheet 2 lists five pairs including transport and payable with cells.
3. The answer names, per sheet, the label and cell of the line used; for sheet 2 it lists discount/transport/payable as separate lines; it states that sheet 1 has no transport line. A `query_attachment` call with `op: "structure"` or `describe` is visible in the debug panel.
4. Ask "прочитай структуру второго листа" → the agent relays tables and closing lines from `structure`.
5. Regression: a plain CSV-like sheet (header + rows, nothing else) shows one table and no `after` line; a `.txt` attachment is unchanged.
