# Quickstart: Validating the Rancher & Agent Usage Panel Redesign

**Feature**: 002-rancher-usage-panel

## Prerequisites

- Local stack set up once: `make setup` (deps, PostgreSQL via Docker, migrations, k3d) — see `Makefile` at repo root.
- At least one LLM credential, the Rancher template, and the deployed Rancher admin agent (the Rancher page wizard walks through this).
- Usage data present: agents report usage on graceful shutdown / 23:50 UTC; for local validation, insert a few `Usage` rows spanning several days/models/agents via `cd api && bun run studio` (Prisma Studio) — enough rows (>7 day|model entries) to exercise pagination.

## Run

```bash
# API (NestJS, watch mode)
bun run dev:api

# Admin (regenerates the SDK from swagger on predev, then Nuxt on :3001)
bun run dev:admin
```

If the SDK was generated before the new endpoint existed: restart `dev:admin` or run `cd admin && bun run build:api` once the API is up, and confirm `usageControllerFindOverview` appears in `admin/slices/setup/api/data/repositories/api/sdk.gen.ts`.

## API checks

```bash
cd api && bun run test          # includes the overview aggregation unit tests
curl -s http://localhost:3333/usage/overview -H "Authorization: Bearer <admin-jwt>" | jq
```

Expected: shape per [contracts/api-usage-overview.md](./contracts/api-usage-overview.md) — `totals.costUsd` equals the sum of `last30days[].costUsd`; `byAgent` sorted by cost desc; empty DB gives zeroed shape, not an error.

## UI validation scenarios (map to spec acceptance scenarios)

Open the admin at `http://localhost:3001`.

### Rancher page (`/rancher`) — User Story 1 & 2

1. **Tiles gone, layout right**: no Agents/Templates/Skills/LLMs/Knowledges tiles anywhere; chat centered; usage panel to its right; exactly one metrics block (SC-005).
2. **Views**: switch Total → Calls → Agent; numbers change accordingly (Total/Calls = all agents from `/usage/overview`; Agent = Rancher agent only, with live today figures). Active tab visibly highlighted.
3. **Pagination**: with >7 daily entries, page through Prev/Next; position indicator updates; all days reachable (SC-004). With ≤7 entries, no pagination controls.
4. **Refresh**: the page's refresh button updates the panel's active view (FR-010).
5. **Wizard untouched**: with an incomplete setup (fresh DB), the step wizard renders exactly as before and no panel appears (FR-009).
6. **Narrow screen**: shrink below `lg` — panel stacks under the chat, no truncation.

### Agent page (`/agents/<id>`, any non-Rancher agent) — User Story 3

7. **Panel present with full parity**: chat tab shows logs (top) and usage panel (bottom) on the right; Agent view shows today model / in-out tokens / calls and 30d cost / top model / input / output / calls — every field the old UsageCard had (SC-003).
8. **Coexistence**: collapse logs → usage panel gets the height and logs collapse to a button; collapse usage → logs expand back; chat never moves or shrinks (SC-006).
9. **Overview tab**: the Usage card there renders the same panel (same fields/views).
10. **Empty agent**: open an agent that never reported usage → "No usage reported yet" state, tabs still visible (FR-008).

## Type/lint gates

```bash
cd api && bun run lint && bun run test
# Admin has no test harness; pure-TS additions (domain/data/stores) are checked via tsc
# (repo convention — no vue-tsc; see memory note "Ranch typecheck via tsc")
```

## Done when

All 10 scenarios above pass, API tests are green, and the generated SDK contains the overview operation without hand edits.
