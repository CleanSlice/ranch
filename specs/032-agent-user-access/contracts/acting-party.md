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
| `manage-agent` | whoever may manage the agent named in the call (section 5) | stop, start, restart, update, delete, status, environment, MCP servers, files, secrets, channels, limits and visibility, logs, peers of one agent (35 tools; the list is pinned in `toolAudience.spec.ts`). The share-link tools stay `admin` until Part B |
| `admin` | Owner, Admin | the rest of today's operator tools, the 16 paddock tools, agent access |
| `owner` | Owner | where the console route is Owner-only: user role and deletion, event destinations, and which agent is the Ranch admin agent (`set_agent_admin`, `isAdmin` on `create_agent`) |

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
         OR (agent is not the Ranch admin agent AND caller is Admin AND reaches(caller, agent))
         OR (agent is not the Ranch admin agent AND agent.createdById = caller.id AND reaches(caller, agent))
```

The caller is a party: a person, a trusted agent (allowed, as before) or a
guest (never). `reaches` sits behind an interface, `IAgentReach`, whose
default provider answers yes for everybody; Part B replaces the provider.

**The Ranch admin agent is the Owner's alone.** Its workspace files are its
instructions, and its secrets, schedule and restart are Owner power for
whoever changes them: an Admin who could rewrite its `HEARTBEAT.md` would get
a scheduled turn that runs as a trusted party. So neither the Admin line nor
the creator line applies to it. For the same reason, which agent is the Ranch
admin agent is the Owner's decision: `POST` and `DELETE
/agents/:id/promote-admin` are `@Roles(Owner)`, `set_agent_admin` is an
`owner` tool, and `isAdmin` on `POST /agents` and on `create_agent` is
refused for anybody else.

A refusal is never told apart from an unknown agent. The routes marked
`@ManagesAgent('id' | 'agentId')` answer 404 `Agent not found` for both,
from one global guard (`AgentManageGuard`); the tools get `null` from
`AgentPermissionService.manageable` for both and give their ordinary "not
found".

`Agent.createdById` is written when an agent is created: from the console
token on `POST /agents`, from the acting token on `create_agent`, null for a
trusted party and for every agent that exists today. It is never updated, and
never sent to a client as a bare id: `AgentDto.createdBy` is `{ id, name,
email }` for an Owner or Admin reader (null name and email for a removed
account) and null for everybody else.

The third line does nothing for a User yet, because only Owner and Admin can
create agents. It is there so that opening creation to Users is one change —
who may call `POST /agents` — and not a second pass over every route and
tool: a User who creates an agent can stop, change and delete it, in the
console and through the assistant, and nobody else's.

## 6. A role on every route

`RolesGuard` becomes global, registered after `JwtAuthGuard` in
`api/src/app.module.ts`. A route with no `@Roles` is treated as
`@Roles(Admin)`: closed to `User` and to `Agent` tokens.

**How a machine route is recognised: it is `@Public()`.** `RolesGuard` skips
`@Public()` routes, as `JwtAuthGuard` does, and keeps no list of machine
guards. That one rule covers every route behind `BridleApiKeyGuard`,
`ApiKeyGuard`, the A2A guards, and the controllers that verify a share,
extension or signed-link token by hand, because the JWT guard is already
global: such a route cannot work without `@Public()`, or the JWT guard would
refuse the machine's credential as a bad token before its own guard ran. A
marker of its own (`@MachineRoute()`) would have been a second list to keep
in step with the first. `routeRoles.spec.ts` asserts the premise: every
route behind a machine guard is `@Public()`.

Routes that state `@Roles(User)` after this change, and nothing else may
(`userRoutes.spec.ts`, 17 routes and the 5 MCP endpoints):

| Routes | Why a User needs them |
|--------|-----------------------|
| `GET /auth/me` | their own session. Login, register, refresh and logout are `@Public()`: they run when there is no access token. There is no other session route |
| `GET /agents`, `GET /agents/status`, `GET /agents/:id` | the agents they reach (CLEAN-231 filters them) |
| `GET /agents/:agentId/limits/enabled` | the chat's limit notice |
| `/me/chats…` (8 routes) | their own conversations |
| `/agents/:agentId/share-link…` (4 routes) | sharing an agent they reach (already `User`) |
| `PUT`/`DELETE /agents/:id/pin` | their pins. Not built yet: CLEAN-231 adds the routes and this row |

That is everything the user console calls with a User's token. Its agent
screens also call create, update, delete, restart, stop, start,
`GET /agents/capacity` and `GET /agent-links`; those were Admin before this
change and stay Admin.

Routes that state `Agent` (`agentRoutes.spec.ts`): **one**, plus the MCP
endpoints.

| Route | Who calls it |
|-------|--------------|
| `GET /agents/:id/mcps` | a runtime reading its own MCP list. The handler refuses an agent asking about another agent. The current runtime no longer calls it (the workflow puts the servers into the pod's environment), so it is kept for older images and can go when they are gone |

The inventory of T026 came out shorter than planned. The runtime uses
`RANCH_API_TOKEN` for one thing, the bearer of the Ranch MCP server
(`setup/mcp/data/mcp.gateway.ts`). Every REST call it makes (usage, browser
sessions and login, integrations, MCP OAuth, the session host) authenticates
with `BRIDLE_API_KEY` and lands on a `@Public()` route behind
`BridleApiKeyGuard`. Inside the API, the token is minted in
`AgentDeployService.deploy`, handed to the workflow as an environment
variable and substituted into the MCP servers' `authValue`; nothing in the
API calls its own REST routes with it. The paddock runner sets a sandbox
value that authenticates nowhere.

**The MCP endpoints stay open to every authenticated bearer**: a person of
any role, or an agent. `POST`, `GET`, `DELETE /mcp/mcp`, `GET /mcp/sse` and
`POST /mcp/messages` carry `@AnyBearer()` (User or Agent), given to
`McpModule.forRoot` through its `decorators` option. Without it they would
fall to the Admin default and no agent could reach a tool. What a caller may
list and call there is decided per tool, by its audience. The session
diagnostics next to them (`GET /teams/:teamId/sessions/debug`, which lists
live session ids) are `@Roles(Admin)` through `diagnosticDecorators`.

Everything else found open by the audit moves to Admin by default: agent
files, file import and proposals, agent secrets, logs, usage, templates and
template files, template install, skills, knowledge bases and sources, model
credentials, settings, paddock, integrations, browser sessions. The admin
console is used only by Owner and Admin, so none of its screens change; the
user console calls none of these.

The audit (`api/scripts/audit-routes.mjs`, `audit-before.txt` and
`audit-after.txt` here): of 252 routes, 136 let any valid token through
before and none does after. Admin goes from 61 to 183 routes (124 of them by
the default), Owner from 5 to 7, User from 5 to 17; 29 public and 16 machine
routes are unchanged, and an agent's token passes 1 REST route where it
passed 137. The scratch version of the script reported 137 open routes: it
lost the decorators under a comment and read `POST /agent-events` (public,
behind `ApiKeyGuard`) as open. Nothing changes for an Admin except the two
promote-admin routes and the Ranch admin agent's own management routes.

The management routes of one agent (`PUT`, `DELETE /agents/:id`, restart,
stop, start, its environment, metrics and MCP status, files, secrets,
channels, logs, the write of limits, and every peer route: card, peers,
candidates, preview, state, delegations; 46 routes, pinned in
`agentManage.guard.spec.ts`) keep their role and add `canManage`, reads
included. When creation opens to Users they are the routes whose role drops
to `User`, with `canManage` already in place.

Four places ask the same rule in the handler, because the marker cannot say
it:

- `GET /agents/:id/mcps`: a runtime reads its own list there, and the guard
  reads an agent's token as a guest. A person must manage the agent.
- `POST /agents/:agentId/peers` with `peerAgentId`, and the
  `connect_agent_peer` and `preview_agent_card` tools: a connection has two
  ends, and the caller must manage the peer too. Otherwise an Admin could
  give an agent of theirs a line to the Ranch admin agent. Same 404 as an
  unknown agent. `peers/candidates` and `list_peer_candidates` offer only
  agents the caller may manage.
- `POST /agents/restart-by-template/:templateId`, `restart_template_agents`
  and `redeploy_skill_agents`: an agent the caller may not manage is left
  running and counted in `skipped`, never named.
- `GET /agents`, `GET /agents/:id`, `GET /agents/status` and
  `GET /agents/public`: an agent the reader may not manage comes as its
  reader view (`agentReaderView.ts`), which is what the user console draws:
  `config` empty, `knowledgeIds` empty, `debugEnabled` false, and
  `llmCredentialId`, `workflowId`, `statusReason`, `launchContext`,
  `firstDeployedAt`, `lastDeployStartedAt`, `lastPullAt`, `lastSyncAt` null.

**An agent's token is an `Agent` on routes.** The Ranch admin agent's token
carries `Owner`, and the runtime's `exec` tool (admin-only, so available to
any Owner or Admin in the management console) can print it. Left as is, an
Admin could take that token and call any route as the Owner, around the
ceiling and the Owner-only checks alike. `RolesGuard` therefore treats a
bearer whose `sub` starts with `agent:` as the `Agent` role, whatever roles
it carries. Its Owner power exists only through tools, where the party is
checked. The Rancher template's instructions to fall back to raw HTTP with
that token are removed; the MCP endpoint stays open to every authenticated
bearer.

Three pinned sets, each a spec that fails when a route joins the set
unannounced: `publicRoutes.spec.ts` (exists), `userRoutes.spec.ts` and
`agentRoutes.spec.ts` (new). The two new ones read the routes from the
module graph of `AppModule` and each handler's metadata, the way the guards
do, so they see the MCP controllers built at boot. `routeRoles.spec.ts` adds
the statement the three sets leave open: outside the public set, the real
guard refuses a token that holds no role on every route of the application.

**On the chat surface an agent's token is not an administrator either.**
`bridle/*` is `@Public()` and verifies tokens itself.
`clientIdFromJwtPayload` maps a token with an Owner or Admin role to the
shared `admin` conversation, and used to do so for the Ranch admin agent's
service token, which carries Owner: that token could read and write the
conversation every Owner and Admin shares, over HTTP and the websocket. A
bearer whose `sub` starts with `agent:` is now its own client
(`agent:<id>`), never `admin`, whatever roles it carries. No acting token
is minted for it (`consoleSessionOf` refuses an `agent:` subject), so a
message sent with it is a guest's at the tools. Nothing in the API or the
runtime relied on the old reading: the paddock runner talks to the agent in
process, and agent-to-agent delegation goes through the hub directly.

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
