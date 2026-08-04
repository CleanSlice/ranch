# API Contract: GET /usage/overview

**Feature**: 002-rancher-usage-panel · **Status**: new endpoint · **Module**: `api/src/slices/usage/usage.controller.ts`

## Request

```
GET /usage/overview
```

- **Auth**: same as the existing usage GET endpoints (admin API auth; no `BridleApiKeyGuard` — that guard is only for the agent-report POST).
- **Query params**: none in v1. The window is fixed at 30 days, matching `GET /agents/:agentId/usage` and `GET /llms/:id/usage`.

## Response `200 OK`

```jsonc
{
  "last30days": [            // rolled up per date|model across ALL agents, newest first
    {
      "date": "2026-08-03",  // UTC day key (YYYY-MM-DD)
      "model": "claude-sonnet-5",
      "inputTokens": 123456,
      "outputTokens": 23456,
      "callCount": 42,
      "costUsd": 1.2345      // computed server-side via model-pricing costUsd()
    }
  ],
  "totals": {                // sums over last30days (invariant: totals == Σ entries)
    "inputTokens": 999999,
    "outputTokens": 88888,
    "callCount": 512,
    "costUsd": 12.3456
  },
  "topModel": "claude-sonnet-5",   // most total tokens in window; null when no usage
  "byAgent": [               // one row per agent with usage, sorted by costUsd desc
    {
      "agentId": "agt_...",
      "agentName": "Rancher",      // falls back to agentId when the agent was deleted
      "inputTokens": 123,
      "outputTokens": 45,
      "callCount": 6,
      "costUsd": 0.0123
    }
  ]
}
```

Envelope: whatever the global interceptor applies to the existing usage GETs (admin unwraps via `unwrapEnvelope`) — this endpoint must not differ.

## Semantics & guarantees

- **Source**: DB `Usage` rows only (`date >= today-30d`, UTC day starts). Does **not** merge per-agent live `data/usage.json` snapshots — the current day may be understated until agents report (accepted limitation, research R2). The per-agent endpoint keeps its live merge; clients needing fresh today-figures for one agent use `GET /agents/:agentId/usage`.
- **Empty workspace / no usage**: `200` with `last30days: []`, zeroed `totals`, `topModel: null`, `byAgent: []` — never an error (spec edge case "partial data in total view").
- **Deleted agents**: usage rows outlive agents; `agentName` falls back to the raw `agentId` (same behavior as `GET /llms/:id/usage`).
- **Cost**: computed server-side per `date|model` entry; clients never price tokens.

## Errors

| Status | Condition |
|--------|-----------|
| 401/403 | Standard admin auth failures (global guard) |
| 500 | Unexpected — DB unavailable etc.; no partial responses |

## SDK impact

Swagger regen exposes the operation as `usageControllerFindOverview` in `admin/slices/setup/api/data/repositories/api/sdk.gen.ts` (via `cd admin && bun run build:api`). Generated files are never hand-edited.

## Test obligations (API Jest)

1. Multi-agent, multi-model rows aggregate to correct `date|model` grain and `totals` (invariant: totals equal the sum of entries).
2. `topModel` picks the highest-token model; `null` on empty.
3. `byAgent` sorted by cost desc; deleted agent → name falls back to ID.
4. Empty table → zeroed shape, `200`.
