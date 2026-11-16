# Contract: HTTP routes and agent tools

DTOs are written in `api/`, emitted to `api/swagger-spec.json`, and
regenerated into both consoles (`bun run build:api`). Nothing here is
hand-written on the console side.

## Limits

| Route | Who | Does |
|-------|-----|------|
| `GET /agent-limits` | Owner, Admin | `[{ agentId, enabled, atLimit, needsLimits }]` for every agent |
| `GET /agents/:id/limits` | Owner, Admin | `{ perMinute, perHour, perDay }` with nulls, or `null` when off |
| `PUT /agents/:id/limits` | Owner, Admin | body `{ perMinute?, perHour?, perDay? }` (null or absent = not limited); all null = switch off |
| `GET /agents/:id/limits/enabled` | any signed-in role | `{ enabled }` — nothing else |
| `GET /agents/:id/load` | Owner, Admin | the load snapshot (data-model) |

None of them is `@Public()`. `publicRoutes.spec.ts` keeps its counts.

`PUT /agents/:id` and `POST /agents` accept an optional `limits` object of the
same shape and apply it in the same transaction as the rest of the update.

### Refusals of a save (HTTP 400, `code` in the body)

| `code` | When |
|--------|------|
| `PUBLIC_AGENT_NEEDS_LIMITS` | the request sets `isPublic: true` or changes limits, and the agent would be public with no limit |
| `LIMIT_OUT_OF_RANGE` | a value is not a whole number from 1 to 1 000 000 |
| `LIMIT_WINDOWS_CONTRADICT` | a longer window allows fewer requests than a shorter one |

A request that sets neither `isPublic` nor `limits` is never refused by these
rules, so a legacy public agent without limits can still be renamed.

## Sending a message over HTTP

`POST /api/agent/:agentId/message` and `/message/sync`, when a limit is full:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42

{ "code": "RATE_LIMITED", "retryAfterSec": 42, "window": "minute" }
```

The sync route answers at once; it does not start waiting for the agent.

When the request is accepted **and the caller presented a credential**:

```http
X-RateLimit-Remaining: 17
X-RateLimit-Reset: 38
```

for the window with the least room (`Reset` in seconds). Anonymous callers get
neither header.

## Not on any anonymous surface

`AgentDto`, `GET /agents/public` and the status stream carry no limit value,
no usage and no "at limit" mark. A spec pins this.

## Agent tools (`api/src/slices/agent/limit/agentLimit.tool.ts`)

| Tool | Audience | Input | Result | `confirm` |
|------|----------|-------|--------|-----------|
| `list_agent_limits` | Owner | — | per agent: id, name, `isPublic`, `enabled`, limits, `atLimit`, `needsLimits`; plus the names at their limit now and the names public without limits | no |
| `get_agent_limits` | Owner | agent id or name | limits, `needsLimits`, the three windows (used / limit / wait), in progress, refused in the last hour (total, by window, time of the latest), operator and agent-to-agent traffic not counted, the minutes of the last hour that saw traffic, 30-day peaks | no |
| `set_agent_limits` | Owner | agent id or name; `perMinute`, `perHour`, `perDay` (number or null) | the limits as saved | yes, when any value is raised or removed; no when limits are only tightened or first set |
| `set_agent_visibility` | Owner | agent id or name; `isPublic`; optional `allowedOrigins` (scheme + host + optional port); optional `perMinute`, `perHour`, `perDay` | `isPublic`, origins and limits as saved, `restartSuggested` | yes, when a private agent becomes public or any limit is raised or removed; no when it becomes private or limits are only tightened |

All four carry `topic`, `title` and `template`. The audience is Owner — the
token of the Ranch admin agent (`requireOperator`) — which is narrower than
the routes above: an Admin has these capabilities in the console only.
`set_agent_limits` and `set_agent_visibility` return the same refusal codes as
the routes, as text the agent can relay; `set_agent_visibility` adds
`ORIGIN_INVALID` and follows `PUT /agents/:id`: limits are written before the
agent record.
