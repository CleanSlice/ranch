# Data Model: Rancher & Agent Usage Panel Redesign

**Feature**: 002-rancher-usage-panel · **Date**: 2026-08-03

## Persistence

**No database changes.** The feature is computed entirely from the existing `Usage` table:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | PK |
| `agentId` | string | Usage outlives the agent record (name lookups fall back to raw ID) |
| `llmCredentialId` | string \| null | Optional link; irrelevant to this feature |
| `model` | string | Pricing key for `costUsd(model, in, out)` |
| `date` | Date (UTC day start) | Unique with `agentId + model` (`agentId_model_date`) |
| `inputTokens` / `outputTokens` / `callCount` | number | Upserted by agent reports |

Today's live figures for a *single* agent additionally come from the S3 file `data/usage.json` (existing mechanism, per-agent endpoint only — see research R2).

## API contract types (new)

### `IOverviewUsageResponse` — `api/src/slices/usage/domain/usage.types.ts`

Mirrors `ICredentialUsageResponse` (same grain, same consumers' expectations), scoped to *all* agents:

```
IOverviewUsageResponse {
  last30days: IUsageDailyEntry[]     // rolled up per `${date}|${model}` across all agents, newest first
  totals: { inputTokens, outputTokens, callCount, costUsd }
  topModel: string | null            // most tokens over the window
  byAgent: Array<{                   // one row per agent with usage, sorted by costUsd desc
    agentId, agentName,              // agentName falls back to agentId for deleted agents
    inputTokens, outputTokens, callCount, costUsd
  }>
}
```

`IUsageDailyEntry` is reused as-is (`date, model, inputTokens, outputTokens, callCount, costUsd`).

### Gateway addition — `IUsageGateway.findRecentAll(days: number): Promise<IUsageData[]>`

Same shape as `findRecentForAgent`/`findRecentForCredential` minus the filter; `where: { date: { gte: since } }`.

## Admin domain types (new) — `admin/slices/usage/domain/usage.types.ts`

```
IOverviewUsage {
  last30days: IUsageDailyEntry[]     // existing admin domain type reused
  totals: IUsageTotals               // existing
  topModel: string | null
  byAgent: IOverviewAgentUsage[]
}

IOverviewAgentUsage {
  agentId: string
  agentName: string
  inputTokens: number
  outputTokens: number
  callCount: number
  costUsd: number
}
```

Mapped defensively from the generated SDK response by `UsageMapper` (new `toOverviewUsage(raw: unknown)`), following the existing `toAgentUsage` pattern.

## Store state — `admin/slices/usage/stores/usage.ts`

| State | Type | Purpose |
|-------|------|---------|
| `byAgent` | `Record<string, IAgentUsage>` | Existing per-agent cache (unchanged) |
| `overview` | `IOverviewUsage \| null` | New: cached all-agents aggregate |

New actions: `fetchOverview()` (delegates to service → gateway → SDK), `getOverview()`.

## UsagePanel view model (component-local, not persisted)

| State | Type / values | Rules |
|-------|---------------|-------|
| `view` | `'total' \| 'calls' \| 'agent'` | Default `'total'`. Switching resets `page` to 1. `'agent'` requires an `agentId` prop; when absent (Rancher admin agent missing — spec edge case) the tab is disabled and the panel stays on `'total'` with an explanatory hint. |
| `page` | number ≥ 1 | Client-side over the active view's `last30days`; page size 7; controls hidden when total rows ≤ 7 (FR-004). |
| `collapsed` | boolean | Only when the host passes `collapsible` (agent chat tab side stack). |

Data sources per view:

| View | Source | Fields shown |
|------|--------|--------------|
| `total` | `fetchOverview()` | 30d totals (costUsd emphasized), top model, paginated daily rows, per-agent breakdown (`byAgent`) |
| `calls` | `fetchOverview()` | Same window, callCount emphasized (totals + per-day callCount) |
| `agent` | `fetchForAgent(agentId)` | Today snapshot (model, in/out tokens, calls) + 30d totals (cost, top model, input, output, calls) + paginated daily rows — full parity with today's `UsageCard` fields (FR-005) |

Empty states (FR-008): view resolves but `totals.callCount === 0` → "No usage reported yet"; fetch failure → non-blocking error text with retry via the page-level refresh (FR-010).

## Validation rules

- All token/call/cost numbers render through `Intl.NumberFormat` (counts) and USD currency format with up to 4 fraction digits (sub-cent costs, spec edge case).
- Daily rows are sorted newest-first server-side; the panel must not re-sort (single source of ordering).
- Aggregate totals MUST equal the sum of the returned `last30days` entries (server computes both from the same rolled-up array — invariant tested in the API unit test).

## State transitions

```
panel mounted ──fetch(view sources)──▶ loading ──ok──▶ data | empty
                                            └──err──▶ error (retryable via refresh)
view switched ──▶ page := 1 ──▶ (reuse cached store data if present, else fetch)
day rollover / refresh ──▶ refetch active sources (FR-010, edge case "day boundary")
```
