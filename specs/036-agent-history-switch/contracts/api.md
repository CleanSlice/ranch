# Contract: API

One route changes. Everything else the history uses (`GET /me/chats/:id`, `/messages`, `/feedback`, `/export`, `POST /me/chats/sync`) is used as it is.

## `GET /me/chats` (`getMyChats`)

### Query

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `archived` | boolean | `false` | unchanged: `false` lists running conversations, `true` closed ones |
| `page` | integer ≥ 1 | 1 | unchanged |
| `perPage` | integer 1..100 | 50 | unchanged |
| `agentId` | string | none | **new**. Only conversations with this agent |
| `search` | string, 1..100 characters after trimming | none | **new**. Title or last message contains it, case-insensitive. An empty or whitespace-only value is treated as absent |

### Response

Unchanged: `{ items: ChatSessionDto[], total, page, perPage }`, most recently active first. `total` counts the rows matching all filters.

### Rules

1. The caller's own rule is applied first and cannot be widened by any parameter: channel `bridle`, the caller's own external id from the token, agents the caller reaches.
2. `agentId` naming an agent the caller does not reach, or one that does not exist, answers **404** with the same body as every other agent-scoped route. It never answers an empty list for such an agent and never confirms that the agent exists.
3. `search` matches `title` and `preview` only. It does not match the external user id.
4. With neither new parameter the answer is byte-for-byte what it is today.
5. Unknown parameters are refused as today.

### Cases the spec file must hold

| Case | Expected |
|------|----------|
| `agentId` of a reachable agent | gateway called with that `agentId`, own channel and external id; only that agent's rows |
| `agentId` of an unreachable agent | 404, gateway not called |
| `agentId` + `archived=true` | closed rows of that agent; `total` is their count |
| `search` | gateway called with the trimmed text |
| `search` of spaces | treated as no search |
| `search` longer than 100 | 400 |
| search text equal to a fragment of the caller's external id | no row matches on that ground (gateway: the id branch is absent when the filter names one external user) |
| a User's token and another person's conversations with the same agent | never in the answer, with or without filters |
| no new parameters | the same call to the gateway as before this change |

### Not changed

- `GET /chats` (admin list) and the `list_chats` tool.
- `POST /me/chats/sync`: already takes `agentId` and is already agent-scoped.
- No new tool: this is not an admin-console capability.

## Generated clients

`api/swagger-spec.json` gains the two query parameters on `getMyChats`. `app` and `admin` SDKs are regenerated from it; no hand-written type stands in for them.
