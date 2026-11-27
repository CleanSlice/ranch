# Contract: where "reach" is enforced

The checklist behind FR-007, FR-008 and SC-002. Three mechanisms
([research.md](../research.md) R4):

- **S** — `@AgentScoped(source)` + `AgentAccessGuard`: 404 when the person
  does not reach the agent named by the request.
- **F** — the handler filters its result with
  `AgentAccessService.reachableIds(caller)`.
- **A** — `assertReaches(caller, child.agentId)` after loading a child record
  addressed by its own id.

`agentScopedRoutes.spec.ts` fails when a route that takes an agent id is in
neither this list nor the exemption list at the bottom.

Paths are under `api/src/slices/`.

## Agents

| Controller | Routes | How |
|------------|--------|-----|
| `agent/agent/agent.controller.ts` | `GET /agents`, `GET /agents/status` | F |
| | `GET /agents/admin/current` | A (404 when the caller does not reach the admin agent) |
| | `GET /agents/:id`, `/metrics`, `/env`, `/mcps`, `/mcp-status` | S `id` |
| | `PUT /agents/:id`, `DELETE /agents/:id` | S `id` |
| | `POST`/`DELETE /agents/:id/promote-admin`, `POST /agents/:id/restart`, `/stop`, `/start` | S `id` |
| | `POST /agents/restart-by-template/:templateId` | F (restarts only reached agents of the template) |
| `agent/agentChannel` | `GET`/`PUT /agents/:id/channels` | S `id` |
| `agent/toolCatalog` | `GET /agents/:id/tools` | S `id` |
| `agent/limit` | `GET /agent-limits` | F |
| | `GET`/`PUT /agents/:agentId/limits`, `/limits/enabled`, `/load` | S `agentId` |
| `agent/event` | `GET /agent-events`, `/agent-incidents` | F, and S on the `agentId` query when present |
| `agent/file` (`file`, `fileImport`, `fileProposal`) | everything under `agents/:agentId/files` | S `agentId`, at class level |
| `agent/secret` | everything under `agents/:agentId/secrets` | S `agentId`, at class level |
| `agent/peer` | everything under `agents/:agentId` | S `agentId`, at class level; `peers/candidates` also F |
| | `GET /agent-links` | F (a link is shown when both ends are reached) |
| `agent/shareLink` | everything under `agents/:agentId/share-link` | S `agentId`, at class level |
| `agent/pin` (new) | `PUT`/`DELETE /agents/:id/pin` | S `id` |

## Conversations

| Controller | Routes | How |
|------------|--------|-----|
| `chat/chat.controller.ts` | `GET /chats` | F, and S on the `agentId` query |
| | `POST /chats/sync` | S body `agentId` |
| | `/chats/:id` and below | A |
| `chat/myChat.controller.ts` | `GET /me/chats` | F |
| | `/me/chats/:id` and below | A |
| `bridle/bridle.controller.ts` | `:agentId/message`, `/message/sync` | inside `resolveRequester`, console persons only |
| | `:agentId/attachment…`, `…/source/:n/…` | inside `BridleChatAuthGuard`, console persons only |
| | `:agentId/transcript`, `/transcript/archive` | inside `requireChannelAccess`, console persons only |
| | `GET list` | F when the caller is a console person |
| `bridle/handlers/bridleClientWs.handler.ts` | handshake, inbound `message` | `reaches`, console persons only; sockets closed on change (R5) |

## Everything else that names an agent

| Controller | Routes | How |
|------------|--------|-----|
| `log/log.controller.ts` | `GET /agents/:agentId/logs` | S `agentId` |
| `usage/usage.controller.ts` | `GET /agents/:agentId/usage` | S `agentId` |
| | `GET /llms/:id/usage` (`byAgent`), `GET /usage/overview` | F (rows of unreached agents dropped; totals recomputed from what is left) |
| `paddock/evaluation` | `POST /paddock-evaluations`, `GET` with `agentId` | S body / query `agentId`; list F |
| | `/paddock-evaluations/:id` and below | A |
| `paddock/scenario` | list, create, generate with `agentId` | S query / body `agentId`; list F |
| `skill/skill.controller.ts` | `GET /skills/:id/agents` | F |
| `browser/browser.extension.controller.ts` | `POST /browser/extension/token` | S body `agentId` |

## Exempt, with the reason

| Route | Why |
|-------|-----|
| `GET /agents/public`, `POST /share/resolve`, `GET /agents/:agentId/files/raw?token=` | public or share-token surfaces (FR-011) |
| `SSE /agents/status/stream` | public, carries no identity; known debt ([research.md](../research.md) R5) |
| `api/agent/*` for share visitors, anonymous visitors and embed tokens | not a person's account (FR-011) |
| `POST /agents/:agentId/usage`, `mcp-servers/…/oauth/*`, `browser/internal/*`, `integrations/internal/*` | agent runtime, `BridleApiKeyGuard` |
| `a2a/agents/:agentId/…` | agent to agent, peer guards |
| `POST /agent-events`, `POST /auth/embed/token` | API key, no person |
| `/ws/agent` | agent runtime |

## Agent tools (`/mcp/mcp`)

Not exempt. A tool is called for an effective caller
([acting-party.md](./acting-party.md)); every tool that lists agents filters
with `reachableIds`, every tool that takes an agent id checks `reaches`, with
the same "not found".

## Roles on these routes

Which role may call each route is settled by CLEAN-232
([acting-party.md](./acting-party.md), section 4), before this checklist is
applied: by then every route above except the few stated for `User` already
requires Admin. This checklist adds *which agents* on top.

## As built (CLEAN-231)

Where the code differs from the tables above, and why. The pinned truth is
`api/src/slices/user/agentAccess/guards/agentScopedRoutes.spec.ts`; the live
check is `e2e/http.mjs`.

- **Management routes carry `@ManagesAgent`, not S.** CLEAN-232 marked the
  47 management routes of one agent (update, delete, restart, stop, start,
  env, metrics, MCP status, channels, files, secrets, logs, the limits
  write, every peer route). `canManage` asks the lists through `IAgentReach`,
  which is `AgentAccessService` now, so those routes are covered without a
  second marker. No route carries both.
- **S routes** (`@AgentScoped`, 25): `GET /agents/:id`, `/agents/:id/tools`,
  `POST`/`DELETE /agents/:id/promote-admin` (Owner only), the two pin routes,
  the limits reads and `/load`, the four share-link routes,
  `GET /agents/:agentId/usage`; on the query: `/agent-events`,
  `/agent-incidents`, `/chats`, `/paddock-evaluations`, `/paddock-scenarios`;
  on the body: `/chats/sync`, `/me/chats/sync`, `POST /paddock-evaluations`,
  `POST /paddock-scenarios`, `/paddock-scenarios/generate`,
  `/browser/extension/token`.
- **For a person the lists apply to, the guard also answers 404 for an id
  that names no agent.** Several routes do not 404 an unknown agent by
  themselves (a list with an agent filter answers an empty page), which
  would have told a hidden agent from a missing one. The Owner is not looked
  up for and gets the route's own behaviour.
- **`GET /agents/:agentId/usage` now answers 404 for an agent that does not
  exist**, for every caller. It used to answer an empty report.
- **`GET /agents/:id/mcps`** is exempt from both markers: the handler asks
  `canManage` for a person and the own id for an agent runtime (CLEAN-232).
- **`GET /api/agent/:agentId/health`** asks the lists too, for a console
  person's bearer; it is not in the table above.
- **The socket**: the listener that closes a person's sockets lives in
  `bridleClientWs.handler.ts` (it holds the sockets), not in
  `bridle.gateway.ts`. The refusal is `bridle_error { code: 'AGENT_NOT_FOUND' }`
  at the handshake, on a message, and when access is taken away. For a
  console person the lists apply to, an agent that does not exist is refused
  the same way.
- **`POST /me/chats/sync`** with no `agentId` skips agents the caller no
  longer reaches.
- **`SSE /agents/status/stream`** stays exempt; since CLEAN-232 it carries
  status facts only (id, status, pod phase), no name and no configuration.
- **An account that no longer exists reaches nothing.** The bearer guard
  verifies a token's signature and does not read the user row, so a deleted
  person's access token is accepted until it expires. Their access row goes
  with the account, and "no row" reads as "not limited": without this a
  restricted person who was deleted would have reached every agent for as
  long as the token lived. The read of the lists starts from the account,
  and no account means no agent. On deletion every socket of the account is
  closed without asking the lists again.
- **`POST /browser/extension/import-state`** asks the lists on every use,
  for the account that minted the token, with its role as the database has
  it now: 404 when that account is gone, disabled, or no longer reaches the
  agent the token names. The token lives up to 365 days.
- **`POST /chats/sync` and `sync_chats` with no agent named** walk and count
  only the agents the caller reaches.
- **`GET /rancher/status` and `get_rancher_status`** name the Ranch admin
  agent by its flag, so no marker covers them. They answer the setup state
  (`hasLlm`, `hasS3`, `template`, `hasAdmin`) to every Owner and Admin, and
  `admin` as the caller may read the agent: null when their lists do not
  reach it, its reader view when they may not manage it, the whole row for
  the Owner. The only other route that returns that agent without naming
  its id is `GET /agents/admin/current`, which already asked the lists.

### Amended 2026-11-27 (CLEAN-268)

Two things changed in what "reach" comes to. Neither changes which agents a
person reaches.

- **A result narrowed by the lists says so.** On 2026-11-27 an Admin limited
  to one agent asked the assistant for the incidents of the month; the lists
  came back empty, correctly, and the answer was "there are none". Every
  tool that lists or sums across agents and filters by reach now adds
  `scope` to its result when, and only when, the caller's lists narrowed
  something: "Only the agents this person can use are covered. That is an
  access limit: other agents may have records this result does not show."
  No agent, no id, no number. Absent for the Owner, a trusted party, a
  person whose lists limit and deny nothing, and a call that named one
  agent. The tools: `list_agent_events`, `list_agent_incidents`,
  `list_agent_limits`, `list_chats`, `sync_chats`, `get_usage_overview`,
  `llm_usage`, `list_paddock_evaluations`, `list_paddock_scenarios`,
  `list_skill_agents`. The routes are unchanged here: a console page shows
  the rows it is given, and the consoles do not claim "none on the
  installation". `delete_llm` now counts, instead of naming, the agents out
  of reach in its result after the deletion as well as before it.
- **Records about the Ranch assistant are the Owner's.** `AgentReach` has a
  second reading, `forRecords()`: the same reach with the assistant taken
  out, for anybody the lists apply to. It is asked where a route or a tool
  returns what Ranch keeps about an agent rather than the agent:
  - `@AgentScoped(source, { records: true })`, 404 as for an agent that does
    not exist: `GET /agents/:agentId/usage`, `GET /agents/:agentId/limits`,
    `GET /agents/:agentId/load`, `POST` and `GET /paddock-evaluations`,
    `GET` and `POST /paddock-scenarios`, `POST /paddock-scenarios/generate`;
  - the record's own 404: every `/paddock-evaluations/:id…` route, and
    `GET` / `PATCH` / `DELETE /paddock-scenarios/:id`;
  - filtered: `GET /usage/overview` and `GET /llms/:id/usage` (the
    assistant is in no row and no total: its spend stays in the
    installation's totals for the Owner alone), `GET /agent-limits`,
    `GET /paddock-evaluations`, `GET /paddock-scenarios`.

  The matching tools answer `reason: "owner_only"` to a person who has the
  assistant, and their lists say what was left out (`notIncluded`); see
  `docs/agent-tools.md`, "The assistant's records". Left as they were, for
  whoever reaches the assistant: `GET /agents/:id` and the status routes,
  `GET /agents/:agentId/limits/enabled`, `/agents/:id/tools`,
  `/agent-events` and `/agent-incidents` (a row says that it was down and
  who noticed, nothing anybody said to it).

- **What is done to the Ranch assistant outside the manage rule is the
  Owner's too.** `@AgentScoped('agentId', { ownerManaged: true })` on the
  four `/agents/:agentId/share-link` routes: 404 for the assistant to
  anybody but the Owner, as its management routes answer. The visitor's
  side is untouched, so an existing link keeps working until the Owner
  revokes it. `GET /agent-links` leaves out a pair with the assistant at
  either end. The tools: the four share-link tools and `start_mcp_oauth`
  for the agent-wide connection answer `reason: "owner_only"`.

- **The installation's statistics (CLEAN-265, merged under this change)
  follow the same two rules.** `GET /stats/installation` and
  `get_installation_stats` already left the assistant's conversations out
  for anybody but the Owner and named it in `reach.ownerOnly`; its tokens,
  calls, cost, days, row among the agents, projection and limit refusals
  are left out now too, so the view and the usage overview still agree.
  Its incidents stay. `reach.limited` is the route's "narrowed"; the tool
  adds `scope` and `notIncluded` beside it.

Pinned by `api/src/slices/mcp/narrowedLists.spec.ts` and
`api/src/slices/user/agentAccess/guards/agentRecordsRoutes.spec.ts`.
