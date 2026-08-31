# Quickstart Validation: Agent Files — Visible Copy Model & Safe Sync

**Spec**: [spec.md](./spec.md) | **Contract**: [contracts/sync-api.md](./contracts/sync-api.md)

## Prerequisites

- `api` running with migrated DB (`cd api && bun run migrate && bun run dev`)
- `admin` running (`cd admin && bun run dev`), logged in as owner
- One deployable test agent (dev installation), its pod able to reach S3
- After DTO changes: `cd api && bun run generate:swagger && cd ../admin && bun run build:api`

## Unit tests (api, jest)

```bash
cd api && bun run test
```

Must cover (new specs): baseline computation (`max(lastSyncAt, lastPullAt - margin)`, null cases), at-risk filtering by `LastModified`, 409 vs pass-through decision, `lastPullAt`/`lastSyncAt` persistence hooks.

## E2E scenario 1 — conflict warning (US1, P1)

1. Start/restart the test agent; wait for Running. **Expect**: agent DTO shows fresh `lastPullAt`.
2. In the Files tab, edit any file (e.g. `SOUL.md`) and save — this makes the S3 copy newer than baseline.
3. Press **Sync**. **Expect**: confirmation dialog listing that file with its timestamp; no sync happened yet (pushed count absent, file content unchanged).
4. Cancel. **Expect**: S3 edit intact (re-open file).
5. Press **Sync** again, confirm. **Expect**: sync runs, result shows pushed count, `lastSyncAt` updates.
6. Press **Sync** once more without editing anything. **Expect**: no dialog (FR-004), immediate sync.

## E2E scenario 2 — no false alarm after restart (edge case)

1. Edit a file in the Files tab while agent is Running.
2. Restart the agent; wait for Running (pod pulled fresh copy incl. the edit).
3. Press **Sync**. **Expect**: no confirmation dialog (baseline = new `lastPullAt`).

## E2E scenario 3 — visibility hint (US2, P2)

1. Open Files tab of a **Running** agent. **Expect**: banner explaining S3-copy-vs-pod model with Sync CTA and markers; per-file last-modified visible.
2. Stop the agent, reopen Files tab. **Expect**: no banner.

## E2E scenario 4 — admin agent honesty (US3, P3)

1. In rancher chat ask: "создай агента и привяжи базу знаний". **Expect**: real `http` calls (`POST /agents`, `PUT /agents/{id}` with `knowledgeIds`) with the result reported — or an honest failure report + manual path. No narrated success without calls.
2. Ask it to update an agent file. **Expect**: reply mentions restart requirement and offers restart.
3. Propagation: deploy the API (template reseeds via source-hash check), restart the rancher agent (template files resync), then verify its SOUL.md contains the "Creating Agents & Binding Knowledge" section.

## Legacy agent check

Agent deployed before the feature, never restarted/synced since: both markers null → Sync behaves exactly as before (no 409). Restart it once → markers appear.
