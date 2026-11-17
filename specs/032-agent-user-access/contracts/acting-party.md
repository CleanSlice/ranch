# Contract: who an agent is acting for, and a role on every route

Part A of the plan, ticket CLEAN-232. Two repositories: `CleanSlice/runtime`
and `api/` here. Facts behind it: [research.md](../research.md) R6, R14 to R18.

## 1. The acting token

A person's identity reaches a tool call as a token the API signs, never as a
statement by the agent.

**Minted by the hub**, with every message a signed-in console socket sends
(`BridleGateway.sendToAgent`, next to the `user` field of CLEAN-80), and by
the HTTP message routes for a console requester:

| Claim | Value |
|-------|-------|
| `typ` | `acting` |
| `sub` | the person's user id |
| `aud` | `agent:<id>` of the agent the message goes to |
| `sid` | the person's console session id |
| `exp` | 60 minutes from minting |

Signed with the API's JWT secret, like every other token. It carries no role:
the role and the access lists are read from the database when the token is
used (FR-040). `JwtAuthGuard` refuses `typ: acting` as a bearer, as it refuses
`embed`, so the token opens nothing by itself.

**Carried by the runtime** verbatim. The message gets
`acting: { token, role, surface }`; `role` and `surface` (`app` or `admin`,
from the socket's origin) are for the prompt only (section 4). The runtime
keeps the token on `ToolContext` for the turn and puts it on every
`tools/list` and `tools/call` to the Ranch MCP server:

```json
{ "_meta": { "ranch/actor": { "kind": "person", "token": "<acting token>" } } }
{ "_meta": { "ranch/actor": { "kind": "trusted", "via": "internal" } } }
{ "_meta": { "ranch/actor": { "kind": "trusted", "via": "channel-admin" } } }
{ "_meta": { "ranch/actor": { "kind": "guest" } } }
```

| Situation in the runtime | Actor |
|--------------------------|-------|
| the message carried an acting token | `person` with that token |
| no token, the turn is internal (cron, heartbeat, recovery) | `trusted` / `internal` |
| no token, `ctx.isAdmin` true by an id from `TELEGRAM_BOT_ADMIN_IDS` | `trusted` / `channel-admin` |
| anything else (share visitor, anonymous widget, messenger user) | `guest` |
| a delegated worker | its parent's actor |

The actor is set by runtime code from the channel message. Nothing the model
writes, and no tool argument, can change it.

**What is proven and what is stated.** A person is proven: the agent cannot
make an acting token, and one minted for another agent is refused (`aud`).
The `trusted` kinds are the agent speaking for itself — a job on its own
schedule, an administrator its own configuration names — and are bounded by
the agent's own token, which is also signed by the API. `guest` and a missing
actor have no management power. So no party gets management power on an
agent's word alone.

## 2. What the API does with it

`effectiveCaller(req)` in `api/src/slices/mcp/tooling.ts`. It is the one place
that answers "who is this for"; `callerIsOperator`, `requireOperator`,
`isListedForRequest` and the agent rules of Part B all read it.

| Bearer | Actor | Effective caller |
|--------|-------|------------------|
| a person's console token | ignored | that person |
| agent runtime, role `Agent` | `person`, valid | that person, for `person` tools only; otherwise the agent itself |
| agent runtime, role `Agent` | other | the agent itself: `agent` and `everyone` tools, as today |
| agent runtime, role `Owner` (Ranch admin agent) | `trusted` | the agent: full power, as today |
| same | `person`, token valid | that person: role and access lists read from the database now |
| same | `person`, token invalid, expired, wrong `aud`, session ended, user gone or inactive | guest |
| same | `guest`, absent, malformed | guest |

A token is valid when the signature verifies, `typ` is `acting`, `aud` equals
the bearer's `sub`, it has not expired, and session `sid` is still alive.

The catalogue is per caller: `tools/list` carries the same `_meta`, and the
API returns only the tools the effective caller may call
(`isListedForRequest` already runs per request). The runtime asks once per
turn and caches per actor for 60 seconds. The model is therefore never shown
a tool that would refuse it (FR-042), and the runtime needs no knowledge of
Ranch's roles.

Audiences, one per tool class:

| Audience | Who | Tools |
|----------|-----|-------|
| `everyone` | any caller | attachment, knowledge search |
| `agent` | the calling agent, for itself | today's self-service tools |
| `person` | a signed-in person, any role | `pin_agent`; browser and integration tools, which now read the person from the actor instead of a `userId` argument |
| `manage-agent` | whoever may manage the agent named in the call (section 5) | stop, start, restart, delete, files, secrets, channels, limits, share link, logs, peers of one agent |
| `admin` | Owner, Admin | the rest of today's operator tools, the 16 paddock tools, agent access |
| `owner` | Owner | where the console route is Owner-only: user role and deletion, API keys, event destinations, settings, upgrade |

`manage-agent` tools are listed for a caller who may manage at least one
agent, and check the named agent at call time with the "not found" of FR-008.

Refusals: `OPERATOR_REFUSAL` for a person who lacks the role; for a guest,
"This needs a signed-in administrator."

## 3. Release order, old runtimes, lost sessions

A runtime older than this change sends no actor, so its calls are a guest's:
the Ranch assistant on an old image loses management tools until redeployed.
That is the intended direction of failure.

1. `CleanSlice/runtime` releases: carries the acting token, sends the actor,
   lists per actor, recovers a lost session. Inert against today's API.
2. Ranch raises the runtime version it deploys; the admin agent is redeployed.
3. The API change is merged and released.

**Lost sessions.** The API keeps MCP sessions in memory
(`statelessMode: false` in `app.module.ts`), so every API restart or release
invalidates the runtime's session, and the runtime does not reconnect: tool
calls answer `Session not found` (-32000) until the agent restarts. That is
what the second screenshot of 2026-11-17 shows. The runtime now drops the
client on a 404 / `Session not found`, reconnects and retries the call once;
if that fails the tool result is "Ranch is not reachable right now", with no
suggestion of another route.

## 4. What the assistant is told about the person

The runtime adds one short block to the system prompt of the turn, built from
`acting.role` and `acting.surface` and the actor kind:

```text
You are talking to <email>, a User, in the user console.
The tools you have in this conversation are the ones this person may use.
When they ask for something you have no tool for, say in one sentence that
their account cannot do that. Do not attempt it another way, do not describe
the management console, do not suggest steps they cannot take.
```

Variants for Admin, Owner, a guest and a trusted party. The block is display
and guidance only; it grants nothing. The Rancher template's own text about
the management console moves inside its admin-only blocks, which the runtime
already strips for non-admins (`stripAdminBlocks`).

## 5. Who may manage an agent

One function, `AgentPermissionService.canManage(caller, agent)`, used by the
management routes and the `manage-agent` tools:

```text
canManage = caller is Owner
         OR (caller is Admin AND reaches(caller, agent))
         OR (agent.createdById = caller.id AND reaches(caller, agent))
```

`Agent.createdById` is written when an agent is created: from the console
token on `POST /agents`, from the acting token on `create_agent`, null for a
trusted party and for every agent that exists today.

The third line does nothing for a User yet, because only Owner and Admin can
create agents. It is there so that opening creation to Users is one change —
who may call `POST /agents` — and not a second pass over every route and
tool: a User who creates an agent can stop, change and delete it, in the
console and through the assistant, and nobody else's.

## 6. A role on every route

`RolesGuard` becomes global, registered after `JwtAuthGuard` in
`api/src/app.module.ts`. A route with no `@Roles` is treated as
`@Roles(Admin)`: closed to `User` and to `Agent` tokens. `@Public()` and the
machine guards (`BridleApiKeyGuard`, `ApiKeyGuard`, the peer guards) are
unaffected.

Routes that state `@Roles(User)` after this change, and nothing else may:

| Routes | Why a User needs them |
|--------|-----------------------|
| `GET /auth/me`, session routes | their own session |
| `GET /agents`, `GET /agents/status`, `GET /agents/:id` | the agents they reach (CLEAN-231 filters them) |
| `GET /agents/:agentId/limits/enabled` | the chat's limit notice |
| `/me/chats…` | their own conversations |
| `/agents/:agentId/share-link…` | sharing an agent they reach (already `User`) |
| `PUT`/`DELETE /agents/:id/pin` | their pins (CLEAN-231) |

Routes that state `Agent`: exactly those the runtime calls with its own
token, taken from the runtime's API gateways (`runtime/init`, `agent/skill`,
`bot/usage`, browser login, agent status) before the guard goes global.

Everything else found open by the audit moves to Admin by default: agent
files, file import and proposals, agent secrets, logs, usage, templates and
template files, template install, skills, knowledge bases and sources, model
credentials, settings, paddock, integrations, browser sessions. The admin
console is used only by Owner and Admin, so none of its screens change; the
user console calls none of these.

The management routes of one agent (`PUT`, `DELETE /agents/:id`, restart,
stop, start, files, secrets, channels, limits, logs) keep their role and add
`canManage`. When creation opens to Users they are the routes whose role
drops to `User`, with `canManage` already in place.

Three pinned sets, each a spec that fails when a route joins the set
unannounced: `publicRoutes.spec.ts` (exists), `userRoutes.spec.ts` and
`agentRoutes.spec.ts` (new, same shape).

## 7. What proves it

- Runtime: specs for the actor chosen in each row of section 1, the `_meta`
  on list and call, the per-actor catalogue cache, the reconnect on a lost
  session, the prompt block per audience. `bun test`,
  `bunx tsc --noEmit -p tsconfig.json`.
- API: `effectiveCaller` over the table in section 2, including a forged,
  expired, wrong-audience and ended-session token; the three route specs; one
  spec that lists and calls every tool as a guest, a User, an Admin and the
  Owner; `canManage` over its three lines.
- End to end, local stack with a real runtime: as a User, "delete agent X"
  gets a one-sentence refusal with no tool call; as the Owner it works;
  restart the API mid-conversation and the next tool call succeeds.
