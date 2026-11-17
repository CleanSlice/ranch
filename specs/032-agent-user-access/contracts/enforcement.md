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
