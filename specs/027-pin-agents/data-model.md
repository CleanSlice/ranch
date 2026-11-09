# Data Model: Pin agents (CLEAN-216)

One attribute on one existing entity. No new entity, relation or index.

## Agent (existing)

| Field | Type | Default | Change |
|---|---|---|---|
| `pinned` | boolean | `false` | **new** |

- **Meaning**: the agent is kept ahead of unpinned agents in every list of
  both consoles and marked with a pin icon. Installation-wide: one value per
  agent, shared by every user.
- **Written by**: `PUT /agents/:id` with `{ pinned }` (Owner / Admin), the
  `pin_agent` tool (operator audience). Nothing else writes it; create leaves
  the default.
- **Read by**: every agent read (`GET /agents`, `GET /agents/:id`,
  `GET /agents/public`, `GET /agents/admin/current`, every tool result that
  returns an agent).
- **Independent of**: `status`, `workflowId`, pod state, `isPublic`,
  `allowedOrigins`, `isAdmin`, `debugEnabled`. Changing it changes none of
  them and raises no status event (FR-007, research R7).
- **Lifecycle**: lives and dies with the row; `DELETE /agents/:id` removes it
  with the agent.

### Migration

`api/prisma/migrations/20261109120000_agent_pinned/migration.sql`

```sql
-- Additive (CLEAN-216): one installation-wide flag that keeps an agent at
-- the top of every list in both consoles. Decides nothing for the pod.
ALTER TABLE "Agent" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
```

No index: lists are ordered client-side over the full set the API already
returns (tens of rows), and `findAll` keeps `orderBy createdAt desc`.

## Console records (existing stores)

Both consoles' `IAgentData` gain `pinned: boolean`, mapped from the generated
`AgentDto.pinned` with the same `=== true` guard the mappers use for the
other booleans. `IAgentUpdateInput` / `IUpdateAgentData` gain
`pinned?: boolean`, mapped to the generated `UpdateAgentDto`.

### Derived views (not stored)

| View | Where | Rule |
|---|---|---|
| Rail order (app side rail, app List view, app Drum) | `app/slices/agent/utils/railOrder.ts` | `isAdmin` first, then `pinned`, then the rest; stable inside each block |
| Orbit order (app) | `app/slices/agent/utils/orbitLayout.ts` | `pinned` block first; inside a block: status rank, then `isAdmin`, then arrival index |
| Rail order (admin) | `admin/slices/agent/agent/utils/railOrder.ts` (new, twin of the app's) | same as the app rail |
| Landing agent (admin `/agents`) | `admin/.../pages/agents/index.vue` | Rancher, else first pinned (by the rail rule), else newest updated |

### Optimistic state

The toggle patches the record (`pinned: next`) and keeps the rollback the
store hands back; the server's reply upserts the truth. No separate "pinning"
status on the record: the control's own `busy` / `toggling` flag lives in the
composable, like `restart` / `stop` / `start`.
