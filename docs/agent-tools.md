# Agent tools: a module is not done until the agent can do it

Applies to `api/` (where tools live) and to anyone adding a capability to the
admin console.

## The one rule that explains the rest

**The console is a window; the chat is the hands.** Ranch was designed so an
operator can say "create a researcher agent on the Claude credential with the
docs knowledge base, connect it to «billing» and restart it" and have it
happen. Every screen in the admin console is a convenience over something the
agent can also do through a tool.

The defect this rule exists for (CLEAN-109): feature by feature, the console
gained screens whose actions had no tool. "Register the GitHub MCP server" got
"I can't do that from here" — not because the platform couldn't, but because
nobody handed the agent the tool. So, alongside tests:

> **A module that adds or changes a console capability ships the matching
> agent tool, with a topic, a title, a starter template, the right audience
> gating, and a spec — in the same PR.**

The API enforces the shape: it refuses to boot a tool without `topic`,
`title` and `template`, a tool without an audience, or a destructive tool
without a `confirm` parameter. The reviewer enforces the rest: the checklist
at the end of this document.

## Definition of done for a capability

| The console can… | …so the API must have |
|---|---|
| list / show | a read tool (`list_x`, `get_x`) returning what the screen shows, minus secrets |
| create / edit | a write tool taking the same fields as the DTO, calling the same service |
| delete / revoke / replace all / change a role / restart everything | a **destructive** tool with `confirm: true` that names what it is about to do |
| upload a file from the person's machine | nothing — say in a nearby tool's description that this stays in the console |
| show something only after a restart | the tool's result says so ("restart required") |

Plus: a spec beside the tool, and the tool visible in the chat's Tools panel
(open the Rancher chat, press the wrench; if your topic is not there, the API
did not boot your tool).

## Where a tool lives

```
api/src/slices/<slice>/<name>.tool.ts        # the provider class with @Tool methods
api/src/slices/<slice>/<name>.tool.spec.ts   # its spec
api/src/slices/<slice>/<slice>.module.ts     # providers: [..., <Name>Tool]
```

The tool class injects the **same** gateways/services the slice's controller
injects and calls them the way the controller does. A tool never re-implements
a rule the controller has; if the controller validates, the tool validates
through the same service. Reference module: `api/src/slices/agent/peer/`
(`peerAdmin.tool.ts` for operator tools, `peerSelf.tool.ts` for agent
self-service, `askAgent.tool.ts` for a tool that describes itself per caller).

Shared helpers: `api/src/slices/mcp/tooling.ts` — `ok`, `err`,
`requireOperator`, `requireOwner`, `requirePerson`, `requireAgent`,
`callerIsOperator`, `callerIsOwner`, `callerPerson`, `callerAgentId`,
`audienceAllows`, `confirmed`, `stripSecrets`, `CONFIRM_SENTENCE`. For
specs, `api/src/slices/mcp/testing.ts` has `asTrustedAgent`, `asPerson`,
`asGuest`.

## The `@Tool` metadata

```ts
@Tool({
  name: 'register_mcp_server',          // snake_case verb_noun; never renamed once shipped
  topic: ToolTopics.McpServers,         // an accordion of the Tools panel
  title: 'Register an MCP server',      // ≤ 60 chars, sentence case, no period
  template: 'Register the MCP server at «url» named «name»',  // ≤ 200 chars, «…» placeholders
  effect: 'write',                      // 'read' or 'write'; required
  destructive: false,                   // true ⇒ confirm parameter required
  description: '…what it does, what it returns, what to do next…',
  parameters: z.object({ … }),
})
```

- **Topics** are in `api/src/slices/mcp/decorators/topics.ts`. Add one there
  before using it; keep them mirroring console sections.
- **Templates are starters, not forms.** They exist so a newcomer can come up
  with an example message for that tool; the person edits freely. Write them
  as one imperative English sentence; placeholders are `«noun»`, never an id
  the person would not know (say `«agent name»`; the model resolves names via
  `list_*`).
- **`effect`** says what the tool does to the platform (CLEAN-240): `read`
  when calling it changes nothing anyone else could notice, `write`
  otherwise. A tool that stores something, starts a job, sends something or
  mints a link is a `write`, however small. The assistant's access levels are
  a rule over this mark — "Basic" is the tools filed as `read` plus the
  person's own — so a write filed as a read reaches people who were given
  "see and ask". A destructive tool is always a `write`; the API refuses to
  boot otherwise, and `tool-metadata.spec.ts` asks why a `read` tool is named
  `create_…`, `set_…`, `delete_…` and the like.
- **Descriptions** are read by the model. Say what the tool returns and what
  to call next on the usual failure ("call list_agents to find the id").
- **A refusal names only a tool the caller has.** The next move in a result
  must be one this caller can make. An agent that was not found is answered
  with `agentNotFound(httpRequest, id)` from `#/mcp/tooling`, never with a
  sentence of the tool's own: it names `list_agents` for an operator and for
  any signed-in person (a `reader` tool since CLEAN-231, so every person has
  it), and for a caller that is nobody says only that there is no such agent
  for this caller.

## Audiences

An audience is decided by the party a call is made for, not by the agent's
token (CLEAN-232).

The Ranch admin agent calls these tools with its own token, and that token
carries Owner. Until CLEAN-232 "operator" meant "the token carries Owner", so
the agent did Owner things for whoever was chatting with it: a User could ask
it to delete any agent, and it did. The token still says what the agent may
do at most. What a call may do is the lesser of that and what the party
behind the call may do.

### The party

Every `tools/list` and `tools/call` is made for one of four parties:

| party | who | power |
|---|---|---|
| `person` | a signed-in console account, proven | the role that account has in the database now |
| `trusted` | the agent acting for itself: a scheduled job, a heartbeat, an administrator its own configuration names | whatever the agent's token carries |
| `peer` | another agent's question, proven (CLEAN-236) | none: a guest's. It carries the chain the question travelled and the person it was started for |
| `guest` | everyone else, and every call that names nobody | none |

A person is proven by an acting token. The hub signs one with every message
a signed-in console person sends (`acting` on the message, next to `user`);
it names the person, the one agent the message goes to and the person's
console session, lasts 60 minutes and carries no role. The runtime carries it
verbatim to each Ranch tool call of that turn, in
`_meta["ranch/actor"] = { kind: "person", token }`, and the API turns it back
into the person: signature, agent, session still alive, account still active,
role read from the database (`ActingPartyService`).

The agent cannot make an acting token, and one minted for another agent is
refused. As a bearer the token opens nothing: `JwtAuthGuard` and every other
verifier refuse it.

A colleague's question is proven by a hand-over token (CLEAN-236). When one
agent passes a question to another agent of this Ranch, the API signs a token
that names the receiving agent, the connection the question travels through,
every agent it has passed and the person the chain was started for, and
delivers it with the message (`handover` on the message). The receiving
runtime carries it on that turn's tool calls as
`_meta["ranch/actor"] = { kind: "peer", token }`, and the API turns it back
into the party (`HandoverService`). Power never travels with a hand-over: a
peer party is admitted to `everyone` and `agent` tools only and is refused by
`requirePerson`, so a question cannot tell the agent it reaches to rewire
itself. What the token is for is the next hop: `ask_agent` checks every
connection against the person the chain was started for, and refuses an agent
that is already in the chain. An invalid or expired token is a guest.

**No actor means guest.** A runtime that sends no `_meta["ranch/actor"]`, an
actor it cannot prove, a share visitor, a messenger user, an anonymous
widget: all guests. A guest gets `everyone` and `agent` tools and no
management tool, whatever the agent's token carries. That is the direction
this fails in on purpose: an agent on an old runtime image loses its
management tools until it is redeployed.

A person who calls the MCP endpoint with their own console token is that
person; the stated actor is ignored.

### The audiences

One per tool, declared with `@ToolAudience`:

| audience | who may list and call it | in every method |
|---|---|---|
| `everyone` | any caller | nothing |
| `agent` | an agent runtime, for itself (the token names the agent, whoever it is answering) | `requireAgent(httpRequest)` |
| `person` | a signed-in person of any role | `const { userId } = requirePerson(httpRequest)` |
| `reader` | a signed-in person of any role, or whoever `admin` admits (so the Ranch admin agent on its own schedule keeps the tool) | `requirePersonOrOperator(httpRequest)`, then only what `AgentAccessService` says the caller reaches |
| `manage-agent` | whoever may manage at least one agent: an Owner or Admin, an agent with an Owner token acting for itself, a person who created an agent. And, tool by tool, a person the assistant setting gave that tool, when they talk through the assistant (CLEAN-254) | `const agent = await this.permission.manageable(manageCaller(httpRequest), id)` and the tool's own "not found" when it is null |
| `admin` | an Owner or Admin; an agent with an Owner token acting for itself | `requireOperator(httpRequest)` |
| `owner` | the Owner; an agent with an Owner token acting for itself | `requireOwner(httpRequest)` |

```ts
@ToolAudience('admin')          // the class: every @Tool method in it
@Injectable()
export class UserTool implements IConditionallyListedTool {
  async isListedForRequest(req: Request) {
    return Promise.resolve(callerIsOperator(req));
  }

  @ToolAudience('owner')        // one method that is narrower than its class
  @Tool({ name: 'delete_user', … })
  async deleteUser(args, _context, httpRequest) {
    requireOwner(httpRequest);
    …
  }
}
```

**Which audience: the role of the console route the tool mirrors.** Read the
controller's `@Roles`. A route that is Owner-only is an `owner` tool. A route
that admits Owner and Admin, or states no role (which asks for Admin since
the role guard is global), is an `admin` tool. A route marked
`@ManagesAgent(...)` is a `manage-agent` tool: see "Managing one agent"
below. A tool
that acts on the caller's own things (their browser sessions, their
integration accounts) is a `person` tool and takes the person from
`requirePerson`, never from an argument: an id the model writes is not proof
of anything. Where an Owner or Admin may act for another user, keep the
argument and check it against the party.

Three locks, in this order:

1. The audience. The catalogue lists a tool only for a party its audience
   includes, and `tools/call` refuses any other with "not available to this
   caller", before the tool is resolved. This one has no fallback: a tool
   with no audience is listed for nobody, and does not boot.
2. `isListedForRequest`, where a class has more to say than its audience
   (`ask_agent` is listed only for an agent that has peers).
3. The `require*` call at the top of the method, for the day one of the
   first two is refactored.

The catalogue is therefore per party. The runtime lists with the same
`_meta` it calls with, so the model is never shown a tool that would refuse
it, and it needs no knowledge of Ranch's roles. The console's Tools panel
shows what an agent's token may hold, which is the catalogue for the
`trusted` party.

What each refusal says: a person who lacks the role, or an agent acting for
itself without it, gets `OPERATOR_REFUSAL`; a guest gets "This needs a
signed-in administrator."; a `person` tool with nobody behind the call gets
"This needs a signed-in person."

### Managing one agent

A tool that acts on ONE agent is a `manage-agent` tool, and it answers two
questions in two places.

Whether it is listed: for a caller who may manage at least one agent. An
Owner or Admin always; the Ranch admin agent acting for itself; a person
below Admin only when they created an agent, which the MCP handler asks the
agent slice once per call and notes on the call's request
(`callerManagesAgents`). A plain agent's token manages nothing, whoever it
names.

One more caller is listed single tools of this audience (CLEAN-254): a person
below Admin who talks **through the assistant** and whose assistant setting
holds the tool. The Owner or an Admin gives a User "Restart an agent" in the
setting; that User created no agent and never will, so without this the
switch did nothing. The handler asks the assistantAccess slice once per call
(`ASSISTANT_GRANT_RESOLVER`), keeps the names whose audience is
`manage-agent`, and notes them on the call's request; `audienceAllows` is
asked with the tool's name and answers for that tool alone
(`callerGrantedTool`). Holding `restart_agent` lists `restart_agent`, not
`delete_agent`. It is true for nobody else: not through another agent, not
with the person's own console token, not for a guest, not with the assistant
switched off for them.

Whether this call may touch the agent it names: one rule,
`AgentPermissionService.canManage`, the same one the console routes marked
`@ManagesAgent('id' | 'agentId')` go through.

```text
canManage(caller, agent) =
     caller is the Owner
  OR (agent is not the Ranch admin agent AND caller is an Admin AND caller reaches the agent)
  OR (agent is not the Ranch admin agent AND caller created the agent AND caller reaches the agent)
  OR (agent is not the Ranch admin agent AND the tool this call runs was given
      to the caller through the assistant setting AND caller reaches the agent)
```

A trusted party is allowed, a guest never. `reaches` is the access lists of
CLEAN-231 (`IAgentReach`, provided by `AgentAccessService`).

The fourth line exists for tools only. `manageCaller(httpRequest)` puts
`grantedThroughAssistant` on the party when the tool the handler is running
is one of the names it noted for this call, so the line is about that tool:
a User given `restart_agent` who gets `delete_agent` called for them by any
route is refused at the audience, and would be refused here too. A console
request builds its caller with `AgentPermissionService.callerOfBearer`,
which never sets it: a User manages nothing on the management routes by
having been given an ability in the chat. Which agents is not widened either:
they are the ones the person reaches, and never the Ranch admin agent.

So a class that holds only `manage-agent` tools answers its listing hook with
`callerHoldsManageTools(httpRequest)`: the caller manages an agent, or the
setting gave them at least one such tool. The audience has already decided
about the tool at hand by the time the hook runs.

**What this opens, by level.** The levels are a rule over area and effect
(see "What the assistant offers a person"), and `manage-agent` tools are
within a User's ceiling. Basic holds every tool that only reads, so a User
on Basic, which is what a User has with nothing configured, is answered by
the reading tools of this audience about every agent they reach: status,
environment preview (credential values masked), configured tool servers,
channels (no bot tokens), workspace files and their export, secret names
(never values), limits, pod logs, connections. Standard adds the tools that
change an agent. An installation that does not want that for Users narrows
the Users' setting with a custom pick; the access lists decide which agents
either way.

**The Ranch admin agent is the Owner's alone.** Its workspace files are its
instructions, and its secrets, schedule and restart are Owner power for
whoever changes them: an Admin who could rewrite its `HEARTBEAT.md` would get
a scheduled turn that runs as a trusted party. Making an agent the Ranch
admin agent is an `owner` tool for the same reason (`set_agent_admin`, and
`isAdmin` on `create_agent`).

```ts
@ToolAudience('manage-agent')   // on the class when every tool names one agent,
@Tool({ name: 'stop_agent', … }) // on the method when the class also has fleet tools
async stopAgent(args, _context, httpRequest) {
  const agent = await this.permission.manageable(manageCaller(httpRequest), args.id);
  if (!agent) return notFound(args.id);   // unknown, or not this caller's: one answer
  …
}
```

`manageable` returns null both for an agent that does not exist and for one
the caller may not manage, and the tool gives its ordinary "not found" for
both, so a refusal never confirms that an agent exists. The routes do the
same with a 404. Resolve by name only among the agents the caller may manage
(`AgentLimitTool.resolveAgent`).

The `manage-agent` tools:

| Tool file | Tools |
|---|---|
| `agent/agent/agentAdmin.tool.ts` | `stop_agent`, `start_agent`, `delete_agent`, `get_agent_status`, `get_agent_env`, `list_agent_mcps` (`get_cluster_capacity` stays `admin`; `pin_agent` is `person`) |
| `rancher/rancher.tool.ts` | `restart_agent`, `update_agent` (`create_agent` and the rest stay `admin`; `list_agents` and `get_agent` are `reader`; `set_agent_admin` is `owner`) |
| `agent/agentChannel/agentChannel.tool.ts` | `get_agent_channels`, `set_agent_channels` |
| `agent/file/file.tool.ts` | `list_agent_files`, `read_agent_file`, `write_agent_file`, `create_agent_file`, `import_agent_files`, `delete_agent_file`, `sync_agent_files`, `export_agent_files` |
| `agent/secret/secret.tool.ts` | `list_agent_secrets`, `set_agent_secret`, `delete_agent_secret`, `replace_agent_secrets` |
| `agent/limit/agentLimit.tool.ts` | `get_agent_limits`, `set_agent_limits`, `set_agent_visibility` (`list_agent_limits` stays `admin`) |
| `log/log.tool.ts` | `get_agent_logs` |
| `agent/peer/peerAdmin.tool.ts` | `list_agent_peers`, `list_peer_candidates`, `preview_agent_card`, `list_agent_delegations`, `connect_agent_peer`, `import_external_agent`, `import_agent_from_card`, `refresh_agent_peer`, `remove_agent_peer` |

`create_agent` records who created the agent: the person the call is made
for (`callerPerson(httpRequest)?.userId`), nobody for a trusted party. It is
written once and no tool or route changes it.

### The audience of every tool class

| Tool file (under `api/src/slices/`) | Audience | The console route it mirrors |
|---|---|---|
| `agent/agent/agentAdmin.tool.ts` | `admin`; `manage-agent` for the six tools that name one agent; `person` for `pin_agent` (`PUT`/`DELETE agents/:id/pin`: User) | `agents`: Owner, Admin; `PUT`/`DELETE agents/:id`, restart, stop, start: `@ManagesAgent` |
| `agent/agentChannel/agentChannel.tool.ts` | `manage-agent` | `agents/:id/channels`: Owner, Admin, `@ManagesAgent` |
| `agent/event/agentEvent.tool.ts` | `admin`; `owner` for `set_notification_destination`, `send_test_notification`, `remove_notification_destination` | `agent-events`, `agent-incidents`, reading the destination: Admin. Setting, testing, removing it: Owner |
| `agent/file/file.tool.ts` | `manage-agent` | `agents/:agentId/files`: Admin by default, `@ManagesAgent` |
| `agent/limit/agentLimit.tool.ts` | `admin`; `manage-agent` for `get_agent_limits`, `set_agent_limits`, `set_agent_visibility` | `agent-limits`, `agents/:agentId/limits`: Owner, Admin; the write is `@ManagesAgent` |
| `agent/peer/peerAdmin.tool.ts` | `manage-agent`, and a person: each tool answers for what the person the call is made for may see, so an agent acting for itself is refused. `set_agent_peer_visitors` takes somebody who manages both agents | `agents/:agentId/peers`: Owner, Admin; the writes are `@ManagesAgent`; `PUT …/peers/:peerId/visitors` |
| `agent/peer/peerSelf.tool.ts` | `person` (CLEAN-236; it was `agent`, so a visitor with no account could connect and remove an agent's colleagues) | none: the colleagues of the agent the person is talking to, among the agents that person reaches |
| `agent/peer/askAgent.tool.ts` | `agent` | none. The colleagues it offers and accepts are decided per call, for the party: see "Whose colleague" below |
| `agent/secret/secret.tool.ts` | `manage-agent` | `agents/:agentId/secrets`: Admin by default, `@ManagesAgent` |
| `agent/shareLink/shareLink.tool.ts` | `admin` | `agents/:agentId/share-link`: User. Narrower than the route until "who may manage this agent" exists |
| `agent/template/templateAdmin.tool.ts`, `agent/templateInstall/templateInstall.tool.ts` | `admin` | `templates`: no role stated |
| `bridle/attachment.tool.ts` | `everyone` | none: reads an attachment of the calling agent |
| `browser/browser.tool.ts` | `person` | `browser/sessions`: the caller's own sessions |
| `chat/chat.tool.ts` | `admin` | `chats`: Owner, Admin |
| `integration/integration.tool.ts` | `person` | `integrations`: the caller's own accounts |
| `llm/llm.tool.ts` | `admin` | `llms`: no role stated |
| `log/log.tool.ts` | `manage-agent` | `agents/:agentId/logs`: Admin by default, `@ManagesAgent` |
| `mcpServer/mcpServer.tool.ts`, `mcpServer/mcpProbe.tool.ts`, `mcpServer/oauth/mcpOauth.tool.ts` | `admin` | `mcp-servers`: Owner, Admin |
| `paddock/evaluation/evaluation.tool.ts`, `paddock/scenario/scenario.tool.ts` | `admin` | `paddock-evaluations`, `paddock-scenarios`: no role stated |
| `rancher/rancher.tool.ts` | `admin`; `manage-agent` for `restart_agent`, `update_agent`; `reader` for `list_agents`, `get_agent` (`GET agents`, `GET agents/:id`: User); `owner` for `set_agent_admin` | `agents`, `templates`, `skills`, `llms`, `settings`, usage: Owner and Admin, or no role stated. `agents/:id/promote-admin`: Owner |
| `reins/knowledge/knowledge.tool.ts` | `everyone` | none: searches the bases of the calling agent |
| `reins/knowledge/knowledgeAdmin.tool.ts`, `reins/source/source.tool.ts` | `admin` | `knowledges`, `knowledges/:id/sources`: no role stated |
| `reins/knowledge/knowledgeDocuments.tool.ts` | `agent` | none: the documents of the calling agent's bases |
| `setting/setting.tool.ts` | `admin` | `settings`: no role stated |
| `skill/skill.tool.ts` | `admin` | `skills`: no role stated |
| `upgrade/upgrade.tool.ts` | `admin` | `upgrade`: Owner, Admin |
| `usage/usage.tool.ts` | `admin` | `usage/overview`: no role stated |
| `user/agentAccess/agentAccess.tool.ts` | `admin` | `users/:id/agent-access`: Admin. Who may read and change whose access, and the ceiling, are the service's, the same for both |
| `user/apiKey/apiKey.tool.ts` | `admin` | `api-keys`: Owner, Admin |
| `user/user/user.tool.ts` | `admin`; `owner` for `set_user_role`, `delete_user` | `users`: Admin. `users/:id/role` and `DELETE users/:id`: Owner |

A route that states no role asks for Admin: `RolesGuard` is a global guard
and that is its default (CLEAN-232), so "no role stated" and "Owner, Admin"
are the same audience. An agent runtime's own token is an `Agent` on routes
whatever roles it carries, so the Ranch admin agent reaches none of these
routes over REST: its power exists through these tools only, where the
party is checked.
`api/src/slices/mcp/toolAudience.spec.ts` pins this table and the list of
`manage-agent` tools: a new tool file, or a changed audience, fails it until
the tables there are updated.

### What the assistant offers a person: the grant

A third question, asked only when a signed-in Admin or User talks **through
the Ranch assistant** (CLEAN-240, `api/src/slices/user/assistantAccess/`): of
the tools their audience admits, which ones were they given. The Owner sets
it per role (default: Admins everything, Users Basic) and per account, as a
level or a custom pick.

- It only takes away. The audience filters first; `AssistantToolPolicyService`
  is a `CallerToolPolicy` the catalogue asks afterwards, for `tools/list` and
  `tools/call` alike. Nothing in a setting can give a role what it does not
  have. The policy is registered on the application's one `ToolCatalogService`
  at start, and the MCP handler lists from that same instance: a catalogue
  built anywhere else knows no policy and narrows nothing.
- One thing it does open, inside the role's ceiling (CLEAN-254): a
  `manage-agent` tool the setting holds works for a person who manages no
  agent, on the agents they reach. See "Managing one agent". A setting never
  decides which agents; the access lists do.
- A level is a rule over a tool's `topic`, `effect` and audience
  (`assistantLevels.ts`): **Basic** = every `read` plus every `person` tool;
  **Standard** = Basic plus `write` in agents, agent workspace, knowledge,
  skills, peers and paddock; **Full** = everything. A new tool lands in the
  right levels by itself; `mcp/assistantGrant.spec.ts` holds one named tool
  per area to it.
- Not governed: the Owner, the assistant acting for itself, a guest, a person
  calling the MCP endpoint with their own console token, any other agent, and
  the tools of audience `everyone` and `agent` — the assistant needs those to
  hold any conversation.
- `get_my_assistant_access` (`person`) is always listed for a person and
  cannot be switched off. It says what their role has and their setting
  leaves out, so the assistant can answer "that is not included for you, the
  Owner decides" instead of "I have no such tool". The guidance is in that
  tool's description, not in the assistant's `SOUL.md`: a description reaches
  a running pod with the next `tools/list`, an agent-owned file does not.
- Whether a person has the assistant at all is the same setting's switch,
  and it is asked through reach (below): the assistant is not an entry in the
  access lists, and `set_user_agent_access` refuses its id.

### Which agents: reach

The audience says what kind of caller may use a tool. Which agents it may
use it on is a second question, answered by the access lists of CLEAN-231
(`AgentAccessService`, `api/src/slices/user/agentAccess/`): a person whose
role is Admin or User reaches an agent unless it is on their denied list, or
their allowed list is not empty and does not hold it. The Owner, a trusted
agent and every caller that is not a person reach every agent.

The caller of that question is the party the call is made for,
`callerParty(httpRequest)`, so an Admin asking through the assistant is
limited exactly as in the console. Three shapes, the same as on the routes:

| The tool | Does |
|---|---|
| lists agents, or rows that belong to agents | `const reach = await this.access.reachableIds(callerParty(httpRequest))`, then `reach.filter(rows, (row) => row.agentId)`; a list paged in the database passes `reach.where()` to its gateway as `agentScope`. Totals are summed after the filter |
| takes an agent id and is not `manage-agent` | finds the agent, then `await this.access.reaches(callerParty(httpRequest), id)`; when either fails, `return agentNotFound(httpRequest, id)` |
| takes the id of a record that belongs to an agent (a chat, an evaluation, a scenario) | loads the record, asks `reaches` about its `agentId`, and answers the tool's own "not found" for the record |

A `manage-agent` tool needs none of this: `AgentPermissionService.manageable`
already asks the lists (they are its `IAgentReach`).

An agent the caller does not reach is an agent that does not exist: the same
words as for an id that names nothing, never the agent's name, and nothing
read or changed before the answer. `api/src/slices/mcp/toolReach.spec.ts`
runs every tool that lists agents or takes an agent id as an Admin limited
to two agents of three and holds each of them to that; a new such tool joins
its tables.

| Tools | How reach is applied |
|---|---|
| `list_agents`, `get_agent` (`reader`) | only reached agents; an agent the caller may not manage comes as its reader view (no `config`, credential, knowledge binding or deploy history); `pinned` is the person's own |
| `pin_agent` (`person`) | pins for the person the call is made for; an unreached agent is not found; an agent acting for itself is refused |
| `get_assistant_access`, `set_assistant_role_access` (`owner`); `get_user_assistant_access`, `set_user_assistant_access`, `reset_user_assistant_access` (`admin`); `get_my_assistant_access` (`person`) | no agent id: they are about the one assistant. `AssistantAccessService` asks who may edit whom (an Admin: Users only, and never above the Admin's own grant); a change that takes abilities away answers "who loses what" until `confirm: true` |
| `get_user_agent_access`, `set_user_agent_access` (`admin`) | `AgentAccessService.view` / `adjust` as the party: an Admin sees and may name only agents they reach, and meets the ceiling |
| the 35 `manage-agent` tools | through `manageable` |
| `list_agent_limits`, `list_skill_agents`, `get_usage_overview`, `llm_usage`, `list_paddock_evaluations`, `list_paddock_scenarios` | filtered; usage totals are of the reached agents |
| `list_chats`, `list_agent_events`, `list_agent_incidents` | `agentScope` in the query; an `agentId` argument is checked |
| `agent_usage`, the four share-link tools, `sync_chats`, `start_mcp_oauth`, `run_paddock_evaluation`, `list_agent_paddock_scenarios`, `create_paddock_scenario`, `generate_paddock_scenarios` | the agent id is checked |
| `get_chat`, `get_chat_messages`, `summarize_chat`, `export_chat`, the paddock evaluation tools by id, `get` / `update` / `delete_paddock_scenario` | the record's agent is checked |
| `delete_llm` | names the agents that would lose their model only when the caller reaches them; the rest are counted |
| `restart_template_agents`, `redeploy_skill_agents` | an agent the caller may not manage is skipped and counted, never named |

One class, one audience, with a method-level exception where one route of a
controller is narrower than the rest, or where a class holds fleet tools
next to tools that name one agent. Split classes when a slice needs two
unrelated audiences (as `peer/` does).

### Whose colleague

A connection from agent A to an agent B of this Ranch exists for a person
only when that person reaches B (CLEAN-236). Every tool and route that lists,
names or uses a connection asks `PeerAccessService` for the party the call is
made for, and gets one of three answers per connection
(`agent/peer/domain/peerAccess.ts`):

| answer | when | what the caller gets |
|---|---|---|
| `full` | the person reaches B; or, for an agent outside this Ranch, the connection is shared, is theirs, or they manage A | the connection as it is |
| `masked` | they do not reach B, and somebody who manages both agents opened the connection to visitors | "A colleague": skills only, no name, id, address, status or description. It can be asked, and neither removed nor closed |
| `hidden` | anything else | nothing, in the words used for a connection that does not exist |

A guest and a peer party with nobody behind it reach no agent, so they are
served by open connections alone. An agent outside this Ranch that a person
added from the chat without managing A is theirs (`ownerUserId`) and serves
their turns only; one added by somebody who manages A is the agent's.

A tool that names a connection therefore never reads the row and then decides:
it asks for the caller's view and treats `hidden` as absent. The specs that
pin it are `peerAccess.spec.ts`, `peer.service.spec.ts`, `askAgent.tool.spec.ts`
and the scenarios in `specs/033-identity-boundaries/e2e/`.

## Destructive tools

```ts
parameters: z.object({
  id: z.string(),
  confirm: z.boolean().describe('Set true only after the person confirmed in the chat.'),
}),
…
const agent = await this.agents.findById(id);
if (!agent) return agentNotFound(httpRequest, id);
const refusal = confirmed(args, `delete agent «${agent.name}» and its workspace`);
if (refusal) return refusal;
```

The API cannot see the chat; the argument is the only server-side proof that
the model went through a confirmation step. The description ends with
`CONFIRM_SENTENCE`. Mark `destructive: true` on anything that deletes,
revokes, replaces wholesale, changes a role, restarts a fleet or interrupts
work.

### Confirm by proposal (writes the person must see first)

A write whose *content* matters — a file edit, an import — refines the rule
(CLEAN-112, `agent/file/file.tool.ts`): the first call, without `confirm`,
**creates a proposal** (`FileProposalService`) and returns `{ proposalId,
status: 'pending' }`; the person sees a card in the chat with the diff and
Apply / Edit / Skip. The confirming call carries `confirm: true` **and** that
`proposalId`, and applies exactly that proposal — so a yes for one change can
never be spent on another, and the console's Apply and the agent's confirm
meet in the same service. Use this shape whenever the person needs to see
what will be written, not only that something will be.

| Tool (topic `agent_workspace`) | Backing |
|---|---|
| `list_agent_files`, `read_agent_file` | `IFileGateway.list` / `readRange` (same slices as the console) |
| `write_agent_file`, `create_agent_file` | `FileProposalService.propose` → `apply` (confirm by proposal) |
| `import_agent_files` | `WorkspaceArchiveService` + `FileProposalService.proposeImport` → `apply`; an archive comes as a chat attachment or an https link — the local file picker stays in the console, as its description says. Plain attachments (`attachmentIds`, CLEAN-192) go through `resolveSelectedFiles`: matched by exact file name, replaced on a unique match, added to `targetFolder` on none, and an ambiguous name comes back as `needs_choice` for the agent to ask about before anything is staged |

The Skills library (CLEAN-205) follows the same rule for its two new
capabilities: the group a skill belongs to travels through `create_skill` and
`update_skill` (`group`, same enum as the DTOs), and the shared display order
has `reorder_skills` (topic `skills`, audience `admin`), which calls the
`SkillOrderService` the console's `PATCH /skills/order` uses — a concurrent
console save surfaces as the same 409 and the tool says "try again". The order
is the library's only; it never changes what agents or templates receive.

Request limits (CLEAN-224) refine the rule the other way: `confirm` depends on
the *direction* of the change. Setting limits for the first time or lowering
them protects the agent and goes through at once; raising or removing any of
them — switching limits off included — lets more through and waits for the
person, with the refusal naming the exact change ("raise the limit per hour
from 100 to 200"). The tool is `destructive: true` so the boot check
guarantees the parameter, and `loosenedWindows` decides whether a call needs it.
Visibility follows the same direction: making a private agent public opens it
to anonymous visitors and waits for the person; making it private does not.

Audience: `admin` for the fleet view, as its route. The three tools that
name one agent are `manage-agent`: they resolve the agent, by id or by name,
only among the agents the caller may manage, so a limit on the Ranch admin
agent is the Owner's to change.

| Tool (topic `agents`) | Backing |
|---|---|
| `list_agent_limits` | `AgentLimitService.summary` over `IAgentGateway.findAll`, as `GET /agent-limits` does, joined with each agent's name, `isPublic` and limit values: `enabled`, `atLimit`, `needsLimits` per agent, plus `atLimitNow` and `publicWithoutLimits` as lists of names. No usage figures |
| `get_agent_limits` | `AgentLimitService.snapshot` (what `GET /agents/:id/load` shows): limits, `needsLimits`, the three windows, requests in progress, refusals in the last hour — total, by window, and when the latest was — operator and agent-to-agent traffic as `notCountedLastHour`, 30-day peaks, and the last hour as `lastHour.activeMinutes`: only the minutes that saw traffic, not sixty rows. Counts only — nothing about who sent a request |
| `set_agent_limits` | `resolveLimitChange` → `AgentLimitService.setLimits`, as `PUT /agents/:id/limits` does; the three refusal codes come back as `{ error, code }` with the sentence to relay. A public agent cannot be left without a limit, confirmed or not |
| `set_agent_visibility` | The save of the Access and Request limit blocks of the agent Overview, as `PUT /agents/:id` does it: `resolveLimitChange` → `AgentLimitService.setLimits` (only when the call names a limit) → `IAgentGateway.update` with `isPublic` and, when given, `allowedOrigins`. Origins are tidied like the form (trim, trailing slash) and must be scheme + host + optional port, else `ORIGIN_INVALID`. Going public without a limit is refused with `PUBLIC_AGENT_NEEDS_LIMITS`, confirmed or not. `confirm` when a private agent becomes public or a limit is raised or removed. It restarts nothing: the result carries `restartSuggested` when the flag or the origins changed, as the console marks a pending restart, and points at `restart_agent` |

`set_agent_visibility` is a tool of its own rather than two more fields on
`update_agent`: that one takes an id only, has no `confirm`, and lives in
`rancher/`, away from the rule and from `loosenedWindows`. Folding visibility
in would have made renaming an agent a destructive call.

## Secrets

Parameters may carry secrets. Results never do. Strip `apiKey`, `authValue`,
`password`, `secret`, `token` before `ok(...)` (`stripSecrets` does the
common cases) and acknowledge "set" operations without echoing the value. The
one exception is `create_api_key`, which returns the key once, exactly as the
console does. `api/src/slices/mcp/tool-secrets.spec.ts` feeds every
secret-taking tool a sentinel and asserts it never comes back — add your tool
there when it takes a secret.

## Tests

`<name>.tool.spec.ts`, jest, in the style of `peerAdmin.tool.spec.ts`:
listed / not listed per audience; one happy path per tool asserting the
gateway call and the result; not-found with the next move; every destructive
tool refuses without `confirm` and touches nothing; no secret in any result.

A spec builds its request by hand, and a request from an agent that names no
party is a guest's. So say who the call is for, with the helpers of
`api/src/slices/mcp/testing.ts`:

```ts
const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:agent-ops', email: '', roles } }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));   // the agent, for itself
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));
const answeringUser = () =>                                              // the same agent, answering a User
  asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.User);
```

The case that matters most for an `admin` or `owner` tool is the last one:
the agent's token carries Owner, the person does not, and the tool refuses.

Run jest directly — `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.
Never `bun run test` while a dev API is running.

## Why "after restart" appears in the panel

A pod reads its tool list once at boot. When the API ships a new tool, the
running pod does not have it until a restart; the API records what each pod
was last told (`AgentToolListing`) and the panel marks the difference. That is
expected after every deploy that adds tools — the Restart button in the panel
clears it.

## Keeping this rule where coding agents look

`CLAUDE.md` states the rule and links here. The graft skill
(`.claude/skills/graft/SKILL.md`) and the Cursor graft rule
(`.cursor/rules/graft.mdc`) carry a short pointer block between
`<!-- ranch:agent-tools:start -->` and `<!-- ranch:agent-tools:end -->`.
`graft init` rewrites those files; `node scripts/ensure-agent-tools-rule.mjs`
puts the block back (it is idempotent and `make init` runs it).

## Review checklist

- Does the PR add or change a console capability? Then: is there a tool, in
  the slice, with topic/title/template/effect, gated to the right audience,
  with a spec?
- Is each new tool's `effect` right? A tool that stores, starts, sends or
  mints anything is a `write`. Filed as a `read` it lands in the assistant's
  Basic level and reaches people who were only given "see and ask".
- Which audience does each new tool declare, and does the console route
  agree? Read the controller's `@Roles` next to the `@ToolAudience`. A tool
  wider than its route is a hole; a tool narrower than its route says why.
- Does any tool take the person as an argument (`userId`, `subject`)? It
  should take them from `requirePerson`, or check the argument against the
  party.
- Does the spec call the tool as the Ranch admin agent answering a User, and
  is it refused?
- Does the tool list agents, take an agent id, or take the id of something
  that belongs to an agent? Then it asks `AgentAccessService` for the party
  the call is made for (see "Which agents: reach"), answers an unreached
  agent as one that does not exist, and is in `toolReach.spec.ts`.
- Does the tool name one agent? Then it is `manage-agent`, it resolves the
  agent with `AgentPermissionService.manageable`, and the spec shows an Admin
  getting "not found" for the Ranch admin agent in the same words as for an
  id that does not exist.
- Does the tool list, name or use an agent's colleagues? Then it takes the
  caller's view from `PeerAccessService` (see "Whose colleague"), answers a
  hidden connection as one that does not exist, and a masked one without its
  name, id or address.
- Does anything destructive lack `confirm`?
- Does any result echo a secret?
- Does the tool call the controller's service, or its own copy of the logic?
