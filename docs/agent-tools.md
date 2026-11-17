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
- **Descriptions** are read by the model. Say what the tool returns and what
  to call next on the usual failure ("call list_agents to find the id").

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

Every `tools/list` and `tools/call` is made for one of three parties:

| party | who | power |
|---|---|---|
| `person` | a signed-in console account, proven | the role that account has in the database now |
| `trusted` | the agent acting for itself: a scheduled job, a heartbeat, an administrator its own configuration names | whatever the agent's token carries |
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
that admits Owner and Admin, or states no role, is an `admin` tool. A tool
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

### The audience of every tool class

| Tool file (under `api/src/slices/`) | Audience | The console route it mirrors |
|---|---|---|
| `agent/agent/agentAdmin.tool.ts` | `admin` | `agents`: Owner, Admin |
| `agent/agentChannel/agentChannel.tool.ts` | `admin` | `agents/:id/channels`: Owner, Admin |
| `agent/event/agentEvent.tool.ts` | `admin`; `owner` for `set_notification_destination`, `send_test_notification`, `remove_notification_destination` | `agent-events`, `agent-incidents`, reading the destination: Admin. Setting, testing, removing it: Owner |
| `agent/file/file.tool.ts` | `admin` | `agents/:agentId/files`: no role stated |
| `agent/limit/agentLimit.tool.ts` | `admin` | `agent-limits`, `agents/:agentId/limits`: Owner, Admin |
| `agent/peer/peerAdmin.tool.ts` | `admin` | `agents/:agentId/peers`: Owner, Admin |
| `agent/peer/peerSelf.tool.ts`, `agent/peer/askAgent.tool.ts` | `agent` | none: an agent's own peers |
| `agent/secret/secret.tool.ts` | `admin` | `agents/:agentId/secrets`: no role stated |
| `agent/shareLink/shareLink.tool.ts` | `admin` | `agents/:agentId/share-link`: User. Narrower than the route until "who may manage this agent" exists |
| `agent/template/templateAdmin.tool.ts`, `agent/templateInstall/templateInstall.tool.ts` | `admin` | `templates`: no role stated |
| `bridle/attachment.tool.ts` | `everyone` | none: reads an attachment of the calling agent |
| `browser/browser.tool.ts` | `person` | `browser/sessions`: the caller's own sessions |
| `chat/chat.tool.ts` | `admin` | `chats`: Owner, Admin |
| `integration/integration.tool.ts` | `person` | `integrations`: the caller's own accounts |
| `llm/llm.tool.ts` | `admin` | `llms`: no role stated |
| `log/log.tool.ts` | `admin` | `agents/:agentId/logs`: no role stated |
| `mcpServer/mcpServer.tool.ts`, `mcpServer/mcpProbe.tool.ts`, `mcpServer/oauth/mcpOauth.tool.ts` | `admin` | `mcp-servers`: Owner, Admin |
| `paddock/evaluation/evaluation.tool.ts`, `paddock/scenario/scenario.tool.ts` | `admin` | `paddock-evaluations`, `paddock-scenarios`: no role stated |
| `rancher/rancher.tool.ts` | `admin` | `agents`, `templates`, `skills`, `llms`, `settings`, usage: Owner and Admin, or no role stated |
| `reins/knowledge/knowledge.tool.ts` | `everyone` | none: searches the bases of the calling agent |
| `reins/knowledge/knowledgeAdmin.tool.ts`, `reins/source/source.tool.ts` | `admin` | `knowledges`, `knowledges/:id/sources`: no role stated |
| `reins/knowledge/knowledgeDocuments.tool.ts` | `agent` | none: the documents of the calling agent's bases |
| `setting/setting.tool.ts` | `admin` | `settings`: no role stated |
| `skill/skill.tool.ts` | `admin` | `skills`: no role stated |
| `upgrade/upgrade.tool.ts` | `admin` | `upgrade`: Owner, Admin |
| `usage/usage.tool.ts` | `admin` | `usage/overview`: no role stated |
| `user/apiKey/apiKey.tool.ts` | `admin` | `api-keys`: Owner, Admin |
| `user/user/user.tool.ts` | `admin`; `owner` for `set_user_role`, `delete_user` | `users`: Admin. `users/:id/role` and `DELETE users/:id`: Owner |

"No role stated" routes admit any signed-in account today and are due to
become Admin (specs/032, a role on every route); the tools are already there.
`api/src/slices/mcp/toolAudience.spec.ts` pins this table: a new tool file,
or a changed audience, fails it until the table there is updated.

One class, one audience, with a method-level exception only where one route
of a controller is narrower than the rest. Split classes when a slice needs
two unrelated audiences (as `peer/` does).

## Destructive tools

```ts
parameters: z.object({
  id: z.string(),
  confirm: z.boolean().describe('Set true only after the person confirmed in the chat.'),
}),
…
const agent = await this.agents.findById(id);
if (!agent) return ok({ error: `Agent ${id} not found — call list_agents` });
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

Audience: `admin`, as their routes. The routes admit Owner and Admin, and
so do the tools: an Owner or Admin talking to the Ranch admin agent, or the
agent acting for itself.

| Tool (topic `agents`, audience `admin`) | Backing |
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
  the slice, with topic/title/template, gated to the right audience, with a
  spec?
- Which audience does each new tool declare, and does the console route
  agree? Read the controller's `@Roles` next to the `@ToolAudience`. A tool
  wider than its route is a hole; a tool narrower than its route says why.
- Does any tool take the person as an argument (`userId`, `subject`)? It
  should take them from `requirePerson`, or check the argument against the
  party.
- Does the spec call the tool as the Ranch admin agent answering a User, and
  is it refused?
- Does anything destructive lack `confirm`?
- Does any result echo a secret?
- Does the tool call the controller's service, or its own copy of the logic?
