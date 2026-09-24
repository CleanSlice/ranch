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
`title` and `template`, or a destructive tool without a `confirm` parameter.
The reviewer enforces the rest: the checklist at the end of this document.

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
`requireOperator`, `requireAgent`, `callerIsOperator`, `callerAgentId`,
`confirmed`, `stripSecrets`, `CONFIRM_SENTENCE`.

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

| audience | listing | inside every method |
|---|---|---|
| Operator (the Ranch admin agent; token carries Owner) | class `implements IConditionallyListedTool`, `isListedForRequest → callerIsOperator(req)` | `requireOperator(httpRequest)` |
| Agent self-service (any runtime) | `callerAgentId(req) !== null` (+ a feature flag where one exists) | `requireAgent(httpRequest)` |
| Everyone | always | — |

One class, one audience. Split classes when a slice needs two (as `peer/` does).

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
| `import_agent_files` | `WorkspaceArchiveService` + `FileProposalService.proposeImport` → `apply`; an archive comes as a chat attachment or an https link — the local file picker stays in the console, as its description says |

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
- Does anything destructive lack `confirm`?
- Does any result echo a secret?
- Does the tool call the controller's service, or its own copy of the logic?
