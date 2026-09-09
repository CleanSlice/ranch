# Quickstart — validating CLEAN-71

## Automated
```bash
cd api && bun run test -- --testPathPattern 'attachment.tool'
```

## Manual (live agent, restarted after deploy)
1. Attach `supplier-invoice.xlsx` (fixture builder in `api/src/slices/bridle/domain/__fixtures__/`), ask "какая итоговая сумма по документу и из чего она складывается?".
2. Debug panel shows one `query_attachment` call with `op: "aggregate"` and a `ranges` list covering the per-sheet lines; the answer lists each addend with its sheet and cell, and the result equals the tool's `value`.
3. Ask for "самая большая позиция во всём документе" → one `aggregate` `max` over the item ranges of both sheets; the answer names the cell.
4. Ask a per-sheet question → the single-range call and its answer are unchanged.
